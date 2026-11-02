/**
 * 클라이언트 상태 리듀서 테스트.
 * 실제 서버 시뮬레이션(봇 전원)이 내보내는 메시지를 JSON 왕복 후 GameModel 에 적용해,
 * 매 snapshot_full 직전 모델이 full 과 완전히 같은지(불일치 0) 확인한다 — qa-headless 재구성 모델과 같은 기준.
 */
import { describe, expect, it } from 'vitest';
import { FLAG_BIT, MAP_SIZE_PRESETS, rleEncode, type S2C_MatchConfig, type ServerMessage } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMap } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));

function runSim(seed: number, size: 'S' | 'M', n: number, ticks: number, lateJoinEvery = 0) {
  const P = MAP_SIZE_PRESETS[size];
  const map = generateMap(seed, P.w, P.h, n);
  const state = createGameState(
    map,
    Array.from({ length: n }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })),
    'HARD',
  );
  const sim = new Simulation(state, CivBot);
  const model = new GameModel(wire(buildMatchConfig(state)));
  model.apply(wire(buildMapInit(state)));
  model.apply(wire(buildSnapshotFull(state)));
  const mismatches: string[] = [];
  let fulls = 0;
  let late: GameModel | null = null;
  const seen = new Set<string>();
  while (!sim.finished && state.tick < ticks) {
    const out = sim.step();
    for (const m0 of out.broadcast) {
      const m = wire(m0) as ServerMessage;
      seen.add(m.type);
      if (m.type === 'snapshot_full') {
        fulls++;
        for (const d of model.diffAgainstFull(m)) mismatches.push(`t${m.tick} ${d}`);
        if (late) for (const d of late.diffAgainstFull(m)) mismatches.push(`late t${m.tick} ${d}`);
      }
      model.apply(m);
      late?.apply(m);
    }
    // 중간 입장(관전·재접속) 흉내: tick 사이에 개인 부트스트랩을 받은 두 번째 모델
    if (lateJoinEvery && state.tick % lateJoinEvery === 13) {
      late = new GameModel(wire(buildMatchConfig(state)));
      late.apply(wire(buildMapInit(state)));
      late.apply(wire(buildSnapshotFull(state)));
    }
  }
  return { model, mismatches, fulls, seen, state };
}

describe('GameModel — 서버 시뮬레이션 재구성', () => {
  it('부트스트랩 → delta·이벤트 적용 → 매 snapshot_full 과 불일치 0 (M 10인 HARD 봇, 2000 tick)', () => {
    const r = runSim(4242, 'M', 10, 2000);
    expect(r.fulls).toBeGreaterThanOrEqual(79);
    expect(r.mismatches.slice(0, 10)).toEqual([]);
    // 깃발·전투 이벤트가 실제로 섞여 있어야 의미가 있다
    for (const t of ['flag_issued', 'flag_engaged', 'snapshot_delta', 'flag_ended']) expect(r.seen.has(t)).toBe(true);
    expect(r.model.flags.size).toBeGreaterThan(0);
  });

  it('중간 입장 모델도 불일치 0 (S 6인, 1200 tick, 25 tick 마다 새 부트스트랩)', () => {
    const r = runSim(77, 'S', 6, 1200, 25);
    expect(r.mismatches.slice(0, 10)).toEqual([]);
  });
});

function cfg(width = 4, height = 3): S2C_MatchConfig {
  return {
    type: 'match_config',
    seed: 1,
    topology: 'square',
    width,
    height,
    totalLandTiles: 10,
    tickMs: 200,
    hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random',
    botDifficulty: 'NORMAL',
    constants: {},
  };
}

function bootstrap(): GameModel {
  const m = new GameModel(cfg());
  const terrain = [0, 0, 0, 0, 1, 1, 2, 3, 1, 5, 4, 6];
  m.apply({ type: 'map_init', terrain: rleEncode(terrain), spawns: [{ playerId: 1, tileId: 4, homeTileId: 4 }], bases: [4, 7] });
  m.apply({
    type: 'snapshot_full',
    tick: 25,
    owners: rleEncode([0, 0, 0, 0, 1, 1, 0, 2, 0, 0, 0, 0]),
    players: [
      { id: 1, tiles: 2, troops: 150, gold: 200, goldWeight: 2000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
      { id: 2, tiles: 1, troops: 150, gold: 200, goldWeight: 1000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
    ],
    flags: [],
    bases: [
      { tileId: 4, ownerId: 1, hpPct: 100 },
      { tileId: 7, ownerId: 2, hpPct: 100 },
    ],
    alliances: [],
    allyProposals: [],
    allianceFreezeUntilTick: null,
    lockoutDissolveTick: null,
    thresholdPct: 60,
    ticksRemaining: 9575,
    endgameRushActive: false,
  });
  return m;
}

const emptyDelta = (tick: number) => ({
  type: 'snapshot_delta' as const,
  tick,
  tileChanges: [] as [number, number][],
  playerDeltas: [],
  flagMoves: [] as [number, number][],
  flagStats: [] as [number, number, 'MARCHING' | 'ENGAGED' | 'RETURNING' | 'IDLE'][],
  flagProgress: [] as [number, number][],
  flagTargets: [] as [number, number | null][],
  baseHp: [] as [number, number][],
  flagsGone: [] as number[],
  flagFlags: [] as [number, 0 | 1, number, number][],
});

describe('GameModel — 단위', () => {
  it('부트스트랩: RLE 지형·소유자 디코드, 수도·기지', () => {
    const m = bootstrap();
    expect(m.ready).toBe(true);
    expect(Array.from(m.terrain!)).toEqual([0, 0, 0, 0, 1, 1, 2, 3, 1, 5, 4, 6]);
    expect(m.owners[5]).toBe(1);
    expect(m.owners[7]).toBe(2);
    expect(m.capitalTiles.has(4)).toBe(true);
    expect(m.isLand(11)).toBe(false); // SHALLOW
    expect(m.isLand(10)).toBe(true);
    expect(m.ticksRemaining).toBe(9575);
  });

  it('full 이전 delta 는 무시', () => {
    const m = new GameModel(cfg());
    m.apply({ ...emptyDelta(3), tileChanges: [[1, 1]] });
    expect(m.owners[1]).toBe(0);
    expect(m.ready).toBe(false);
  });

  it('flag_issued → delta(move/stats/progress/flags) → flag_ended', () => {
    const m = bootstrap();
    m.apply({ type: 'flag_issued', tick: 26, flagId: 9, playerId: 1, slotIndex: 0, unit: 2, posture: 0, troops: 100, originTileId: 4, anchorTileId: 6, targetOwnerId: 0, etaTick: 40, engageEtaTick: 38 });
    expect(m.flags.get(9)!.state).toBe('MARCHING');
    m.apply({
      ...emptyDelta(26),
      tileChanges: [[6, 1]],
      flagMoves: [[9, 5]],
      flagStats: [[9, 98, 'ENGAGED']],
      flagProgress: [[9, 37]],
      flagTargets: [[9, 8]],
      flagFlags: [[9, 0, FLAG_BIT.IN_COMBAT | FLAG_BIT.BLOCKED, 51]],
      playerDeltas: [{ id: 1, tiles: 3, troops: 40, gold: 210, goldWeight: 4300, upkeepPm: 0, techMask: 0 }],
    });
    const f = m.flags.get(9)!;
    expect([f.posTileId, f.troops, f.state, f.progressPct, f.targetTileId, f.postureCooldownUntilTick]).toEqual([5, 98, 'ENGAGED', 37, 8, 51]);
    expect([f.inCombat, f.blocked, f.routed, f.stalled]).toEqual([true, true, false, false]);
    expect(m.owners[6]).toBe(1);
    expect(m.dirtyTiles).toContain(6);
    expect(m.players.get(1)!.troops).toBe(40);
    // 다음 tick flagProgress 에 없으면 0
    m.apply(emptyDelta(27));
    expect(m.flags.get(9)!.progressPct).toBe(0);
    m.apply({ type: 'flag_ended', tick: 28, flagId: 9, reason: 'recalled', refunded: 80 });
    expect(m.flags.has(9)).toBe(false);
  });

  it('flag_posture_changed 는 targetOwnerId 를 덮어쓴다 (QA I-1), 이탈 대기 → 패주 시 null', () => {
    const m = bootstrap();
    m.apply({ type: 'flag_issued', tick: 26, flagId: 1, playerId: 1, slotIndex: 0, unit: 1, posture: 1, troops: 60, originTileId: 4, anchorTileId: 5, targetOwnerId: 254, etaTick: 30, engageEtaTick: 28 });
    m.apply({ type: 'flag_posture_changed', tick: 27, flagId: 1, posture: 0, cooldownUntilTick: 52, auto: false, targetOwnerId: 254 });
    expect(m.flags.get(1)!.posture).toBe(0);
    m.apply({ type: 'flag_disengage_started', tick: 28, flagId: 1, untilTick: 43, auto: false });
    expect(m.flags.get(1)!.disengageUntilTick).toBe(43);
    m.apply({ type: 'flag_routed', tick: 30, flagId: 1, returnTileId: 4 });
    expect(m.flags.get(1)!.disengageUntilTick).toBeNull();
  });

  it('tech_purchased·동맹·base_captured·tileChanges 의 기지 소유자', () => {
    const m = bootstrap();
    // v4.3: nodeId 15 = MOB-1
    m.apply({ type: 'tech_purchased', tick: 26, playerId: 1, nodeId: 15, cost: 160, newFlagCap: 3, techMask: 1 << 15 });
    expect([m.players.get(1)!.techMask, m.players.get(1)!.techCount]).toEqual([1 << 15, 1]);
    m.apply({ type: 'ally_formed', tick: 26, a: 1, b: 2 });
    expect(m.isAlly(2, 1)).toBe(true);
    m.apply({ type: 'ally_break_started', tick: 330, a: 1, b: 2, byPlayerId: 1, breakAtTick: 480 });
    expect(m.alliances.get('1-2')!.state).toBe('BREAKING');
    expect(m.isAlly(1, 2)).toBe(true); // BREAKING 도 동맹 (§4 isAlly)
    m.apply({ type: 'ally_broken', tick: 480, a: 1, b: 2, reason: 'cooldown_elapsed' });
    expect(m.isAlly(1, 2)).toBe(false);
    m.apply({ ...emptyDelta(481), tileChanges: [[7, 1]] });
    expect(m.bases.get(7)!.ownerId).toBe(1);
  });

  it('troopCap·flagCap 문서식 (§8)', () => {
    const m = bootstrap();
    // 2026-10-24 개편: 병력 상한 노드는 없다. MOB-1(18), MOB-2A(19), MOB-4(23, 슬롯 +1)
    const mk = (...ids: number[]) => ids.reduce((x, i) => x + 2 ** i, 0);
    expect(m.troopCapOf({ tiles: 9, techMask: 0 })).toBe(280);
    expect(m.troopCapOf({ tiles: 9, techMask: mk(12, 13, 15, 17) })).toBe(280);
    expect(m.flagCapOf({ tiles: 600, techMask: mk(18, 19, 21, 23) })).toBe(6);
    expect(m.flagCapOf({ tiles: 1200, techMask: 2 ** 42 - 1 })).toBe(7);
    expect(m.flagCapOf({ tiles: 9, techMask: mk(18, 19, 21, 23) })).toBe(4);
  });
});
