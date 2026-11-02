/**
 * v4.4 규칙 (사용자 2026-10-14, 프로토콜 §21): 기지 방어 · 우클릭 재지정 태세 · 멸망·합병 · 기지 생산력 · 생산 지역 · 지명.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_PROD_RECOVER_PER_MIN_PERMILLE,
  COMBAT_BASE_DEF_PERMILLE,
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  POSTURE,
  TERRAIN,
  TICKS_PER_MIN,
  UNIT,
  UNIT_DEF_PERMILLE,
  isClaimable,
  type ServerMessage,
} from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { flagValue } from '../src/game/combat.js';
import { baseOccupiedByHostile } from '../src/game/gauge.js';
import { distribute } from '../src/game/production.js';
import { buildMapInit, buildSnapshotFull, flagBits } from '../src/game/snapshot.js';
import { NEUTRAL, baseProdPm, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMapForPlayers } from '../src/map/generate.js';
import { PLACE_NAME_POOL, assignPlaceNames } from '../src/map/placeNames.js';

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup, undefined, undefined, 1));
}

function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number; anchor?: number } & Partial<Flag>): Flag {
  const f = makeFlag({
    id: s.nextFlagId++,
    ownerId: o.ownerId,
    slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length,
    unit: o.unit,
    troopsMilli: o.troops * 1000,
    initialTroops: o.troops,
    posTileId: o.pos,
    anchorTileId: o.anchor ?? o.pos,
    originTileId: o.pos,
  });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, anchor: _a, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}

function run(sim: Simulation, n: number) {
  const all: ServerMessage[] = [];
  const personal: ServerMessage[] = [];
  for (let i = 0; i < n && !sim.finished; i++) {
    const out = sim.step();
    all.push(...out.broadcast);
    personal.push(...out.personal.map((p) => p.msg));
    expect(ledgerImbalance(sim.state)).toBe(0);
  }
  return { all, personal };
}

/** 기지 b 의 점령 가능한 4방향 이웃 하나 */
const landNeighbor = (s: GameState, b: number): number => s.graph.neighbors(b).find((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x])!;

describe('v4.4 기지 방어 — 깃발이 내 기지 칸 위에 선다', () => {
  it('발령 앵커 = 내 수도 → DEFEND, 출발도 수도라 그 칸에서 바로 ENGAGED (귀환·소멸 아님)', () => {
    const sim = makeSim();
    const s = sim.state;
    const cap = s.players[1].homeTileId;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.SPEAR, troops: 60, anchorTileId: cap, posture: 1, originBaseTileId: null });
    const r = run(sim, 2);
    expect(r.personal[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
    const f = s.flags.find((x) => x.ownerId === 1)!;
    expect(f.posTileId).toBe(cap);
    expect(f.state).toBe('ENGAGED');
    expect(f.posture).toBe(POSTURE.DEFEND);
    run(sim, 50);
    expect(s.flags.includes(f)).toBe(true);
  });

  it('×1.5 는 지형 보정을 대체한다 (곱하지 않음) — 내 기지만, 공격 태세·남의 기지는 지형 그대로', () => {
    const s = makeSim().state;
    const cap = s.players[1].homeTileId;
    s.map.terrain[cap] = TERRAIN.HILLS;
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: cap, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    expect(flagValue(s, d, [d])).toBe(Math.floor((UNIT_DEF_PERMILLE[UNIT.SPEAR] * COMBAT_BASE_DEF_PERMILLE) / 1000)); // 1950, 언덕 1300 과 곱하지 않음
    // 같은 칸이 남의 것이 되면 지형 보정
    setTileOwner(s, cap, 2, false);
    expect(flagValue(s, d, [d])).toBe(Math.floor((UNIT_DEF_PERMILLE[UNIT.SPEAR] * COMBAT_TERRAIN_DEF_POSTURE_PERMILLE[TERRAIN.HILLS]) / 1000));
    setTileOwner(s, cap, 1, false);
    d.posture = POSTURE.ATTACK;
    expect(flagValue(s, d, [d])).toBe(1350); // v4.5 (§22): 공격 태세도 내 기지 위면 ×1.5 (900 → 1350)
  });

  it('기지 위 방어 깃발이 있으면 공격 깃발은 먼저 깃발 전투를 이겨야 한다 — 체력 피해 0', () => {
    const sim = makeSim();
    const s = sim.state;
    const b = s.players[2].homeTileId;
    const nb = landNeighbor(s, b);
    setTileOwner(s, nb, 1, false);
    const hp0 = s.bases[s.baseIndexOf.get(b)!].hpMilli;
    const d = addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 400, pos: b, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const a = addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 400, pos: nb, anchor: b, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 100_000 });
    expect(baseOccupiedByHostile(s, b, 1)).toBe(true);
    expect(baseOccupiedByHostile(s, b, 2)).toBe(false);
    let hit = false;
    for (let i = 0; i < 400 && !a.routed && !d.routed; i++) {
      run(sim, 1);
      if (!d.routed && s.bases[s.baseIndexOf.get(b)!].hpMilli < hp0) hit = true;
    }
    expect(hit).toBe(false);
    expect(a.routed).toBe(true); // 기병 공격 1180 vs 창 방어 1300 × 1.5
  });
});

describe('v4.4 재지정(우클릭) = 항상 이동, 태세는 도착지로', () => {
  it('내 땅 → DEFEND, 적·중립 → ATTACK, 내 기지 → 기지 위로 가서 방어(회수 아님)', () => {
    const sim = makeSim();
    const s = sim.state;
    const cap = s.players[1].homeTileId;
    const mine = s.graph.disk(cap, 1).find((x) => x !== cap && s.owners[x] === 1 && isClaimable(s.map.terrain[x]))!;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: mine, anchor: mine, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    sim.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 1, flagId: f.id, anchorTileId: cap });
    const r = run(sim, 1);
    expect(r.personal[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
    expect(r.all.find((m) => m.type === 'flag_posture_changed')).toBeUndefined();
    run(sim, 40);
    expect(f.posTileId).toBe(cap);
    expect(f.state).toBe('ENGAGED');
    expect(s.flags.includes(f)).toBe(true);
    // 방어 깃발 + 중립 칸 = 공격으로 자동 전환 (v5.6)
    const neutral = s.graph.disk(cap, 4).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]))!;
    sim.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 2, flagId: f.id, anchorTileId: neutral });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK });
  });

});

describe('v4.4 멸망·합병 — 기지를 모두 잃으면 즉시 멸망, 남은 땅은 마지막 기지를 점령한 쪽에', () => {
  it('수도(유일 기지) 함락 → 같은 tick player_eliminated(byPlayerId, annexedTiles) + 전 영토 이전 + 깃발 소멸', () => {
    const sim = makeSim();
    const s = sim.state;
    const cap = s.players[2].homeTileId;
    expect(s.players[2].baseTiles).toEqual([cap]);
    const nb = landNeighbor(s, cap);
    setTileOwner(s, nb, 1, false);
    // p2 영토를 조금 넓혀 둔다 (수도와 이어지지 않은 칸 포함)
    const far = s.graph.disk(cap, 6).filter((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x])).slice(0, 5);
    for (const x of far) setTileOwner(s, x, 2, false);
    const g = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 100, pos: far[0], posture: POSTURE.ATTACK, state: 'IDLE', idleSinceTick: s.tick });
    s.bases[s.baseIndexOf.get(cap)!].hpMilli = 300;
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: nb, anchor: cap, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 100_000 });
    const p2Tiles = s.players[2].tiles;
    const p1Tiles = s.players[1].tiles;
    let elim: ServerMessage | undefined;
    let delta: ServerMessage | undefined;
    for (let i = 0; i < 5 && !elim; i++) {
      const r = run(sim, 1);
      elim = r.all.find((m) => m.type === 'player_eliminated');
      delta = r.all.find((m) => m.type === 'snapshot_delta');
    }
    expect(elim).toMatchObject({ playerId: 2, byPlayerId: 1, annexedTiles: p2Tiles - 1 }); // 수도는 base_captured 로 먼저 넘어감
    expect(s.players[2].alive).toBe(false);
    expect(s.players[2].tiles).toBe(0);
    expect(s.players[1].tiles).toBe(p1Tiles + p2Tiles);
    for (const x of far) expect(s.owners[x]).toBe(1);
    expect(s.flags.includes(g)).toBe(false);
    // 칸 이전은 같은 tick 델타 tileChanges 에
    if (delta?.type !== 'snapshot_delta') throw new Error('no delta');
    for (const x of far) expect(delta.tileChanges).toContainEqual([x, 1]);
  });

  it('기지가 남아 있으면 수도를 잃어도 살아 있다 / 연쇄: 합병 받을 쪽이 이미 멸망했으면 그를 멸망시킨 쪽에', () => {
    const sim = makeSim();
    const s = sim.state;
    const p2 = s.players[2];
    const neutralBase = s.map.baseTiles.find((b) => s.owners[b] === NEUTRAL)!;
    setTileOwner(s, neutralBase, 2, false);
    setTileOwner(s, p2.homeTileId, 3, false);
    run(sim, 1);
    expect(p2.alive).toBe(true);
    // 연쇄: 3 의 마지막 기지를 2 가 가져갔다가, 같은 tick 에 2 가 기지를 전부 4 에게 잃는다 → 3 의 합병 대상(2)은 멸망 → 2 를 멸망시킨 4 에게
    setTileOwner(s, p2.homeTileId, 4, false); // 앞에서 3 에게 준 2 의 수도는 치운다 (3 의 기지 = 자기 수도뿐)
    const cap3 = s.players[3].homeTileId;
    setTileOwner(s, cap3, 2, false); // p3.lastBaseLostTo = 2
    setTileOwner(s, cap3, 4, false); // p2 가 잃음
    setTileOwner(s, neutralBase, 4, false); // p2 의 마지막 기지 → p2.lastBaseLostTo = 4
    const r = run(sim, 1);
    const ev = r.all.filter((m) => m.type === 'player_eliminated');
    expect(ev.map((m) => m.type === 'player_eliminated' && [m.playerId, m.byPlayerId])).toEqual([
      [2, 4],
      [3, 4],
    ]);
    expect(s.players[2].tiles + s.players[3].tiles).toBe(0);
  });
});

describe('v4.4 기지 생산력', () => {
  it('1000 → 점령 500 → 재점령 250 → 분당 +167 선형 회복 → 1000 상한, base_captured.newProdPm · 스냅숏 prodPm', () => {
    const sim = makeSim();
    const s = sim.state;
    const B = s.map.baseTiles.find((b) => s.owners[b] === NEUTRAL)!;
    const base = s.bases[s.baseIndexOf.get(B)!];
    expect(baseProdPm(base)).toBe(1000);
    const nb = landNeighbor(s, B);
    const capture = (owner: number) => {
      setTileOwner(s, nb, owner, false);
      base.hpMilli = 200;
      base.lockUntilTick = 0;
      for (const f of s.flags.filter((x) => x.posTileId === nb)) s.ledger.exhausted += f.troopsMilli; // 테스트가 치우는 병력도 장부에
      s.flags = s.flags.filter((f) => f.posTileId !== nb);
      addFlag(s, { ownerId: owner, unit: UNIT.SWORD, troops: 400, pos: nb, anchor: B, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 100_000 });
      for (let i = 0; i < 5; i++) {
        const ev = run(sim, 1).all.find((m) => m.type === 'base_captured');
        if (ev) return ev;
      }
      throw new Error('not captured');
    };
    expect(capture(1)).toMatchObject({ tileId: B, toPlayerId: 1, newProdPm: 500 });
    expect(baseProdPm(base)).toBe(500);
    // 바로 다시 (회복 1 tick 분 이하 → 여전히 500 근처). 정확히 보려고 회복분을 되돌리지 않고 공식 확인
    const before = baseProdPm(base);
    const ev2 = capture(3);
    expect(ev2).toMatchObject({ toPlayerId: 3, newProdPm: Math.floor(before / 2) });
    // 깨끗한 값으로: 500 → 250 연속
    base.prodScaled = 500 * TICKS_PER_MIN;
    const ev3 = capture(1);
    expect(ev3).toMatchObject({ newProdPm: 250 });
    run(sim, TICKS_PER_MIN);
    expect(baseProdPm(base)).toBe(250 + BASE_PROD_RECOVER_PER_MIN_PERMILLE);
    expect(buildSnapshotFull(s).bases.find((b) => b.tileId === B)!.prodPm).toBe(250 + BASE_PROD_RECOVER_PER_MIN_PERMILLE);
    run(sim, 5 * TICKS_PER_MIN);
    expect(baseProdPm(base)).toBe(1000);
  });

  // v4.5 (§22): 생산 지역 모델 폐기 — 기지 행 + 영토 행 테스트는 v45.test.ts

  it('distribute: 합 보존, 잔여는 가중치 최대 항목', () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distribute(7, [0, 5, 2])).toEqual([0, 5, 2]);
    expect(distribute(5, [0, 0])).toEqual([5, 0]);
    expect(distribute(0, [])).toEqual([]);
  });
});

describe('v4.4 지명', () => {
  it('풀 ≥ 100, 중복 없음, 한글 (v4.5: 서양식 판타지 음차 — 2~7음절)', () => {
    expect(PLACE_NAME_POOL.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PLACE_NAME_POOL).size).toBe(PLACE_NAME_POOL.length);
    for (const n of PLACE_NAME_POOL) expect(n).toMatch(/^[가-힣]{2,7}$/);
  });

  it('시드 결정론 · 매치 안 고유 · map_init.baseNames 가 bases 와 같은 길이', () => {
    expect(assignPlaceNames(123, 24)).toEqual(assignPlaceNames(123, 24));
    expect(assignPlaceNames(123, 24)).not.toEqual(assignPlaceNames(124, 24));
    const big = assignPlaceNames(9, 300);
    expect(new Set(big).size).toBe(300);
    const s = makeSim().state;
    const mi = buildMapInit(s);
    expect(mi.baseNames!.length).toBe(mi.bases.length);
    expect(new Set(mi.baseNames).size).toBe(mi.bases.length);
    expect(makeSim().state.baseNames).toEqual(s.baseNames);
  });
});

describe('v4.4 봇 기지 수비', () => {
  it('마지막 기지(수도) 근처 적 공격 깃발 → 그 기지를 앵커로 창병 방어 발령 (출발도 그 기지)', async () => {
    const { decideBot } = await import('../src/game/bot.js');
    const map = generateMapForPlayers(4242, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 1);
    const cap = s.players[2].homeTileId;
    s.players[2].troopsMilli = 400_000;
    const near = s.graph.disk(cap, 5).find((x) => s.graph.distance(x, cap) === 5 && isClaimable(s.map.terrain[x]))!;
    addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 150, pos: near, anchor: cap, posture: POSTURE.ATTACK, state: 'MARCHING' });
    const cmds = decideBot(s, 2, 30, s.players[2].bot);
    const guard = cmds.find((c) => c.type === 'cmd_flag_issue' && c.anchorTileId === cap);
    expect(guard).toMatchObject({ type: 'cmd_flag_issue', unit: UNIT.SPEAR });
  });

  it('마지막이 아닌 기지는 체력이 깎이는 중일 때만 수비대 발령', async () => {
    const { decideBot } = await import('../src/game/bot.js');
    const map = generateMapForPlayers(4242, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 1);
    const p = s.players[2];
    const extra = s.map.baseTiles.find((b) => s.owners[b] === NEUTRAL)!;
    setTileOwner(s, extra, 2, false);
    p.troopsMilli = 400_000;
    const nb = landNeighbor(s, extra);
    addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 150, pos: nb, anchor: extra, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const issuedAt = (t: number) => decideBot(s, 2, t, p.bot).some((c) => c.type === 'cmd_flag_issue' && c.anchorTileId === extra);
    expect(issuedAt(30)).toBe(false);
    const bs = s.bases[s.baseIndexOf.get(extra)!];
    bs.hpMilli -= 1000;
    bs.lastDamageTick = 29;
    expect(issuedAt(30)).toBe(true);
  });

  it('v5.6: 봇은 재지정이 미룬 태세 전환을 쿨타임이 끝난 뒤 cmd_set_posture 로 낸다', async () => {
    const { decideBot } = await import('../src/game/bot.js');
    const map = generateMapForPlayers(4242, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 1);
    const p = s.players[2];
    const f = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 200, pos: p.homeTileId, anchor: p.homeTileId, posture: POSTURE.ATTACK, state: 'MARCHING' });
    f.botPlannedPosture = POSTURE.DEFEND;
    f.orderCooldownUntilTick = 40;
    const posts = (t: number) => decideBot(s, 2, t, p.bot).filter((c) => c.type === 'cmd_set_posture' && c.flagId === f.id);
    expect(posts(30)).toEqual([]);
    expect(f.botPlannedPosture).toBe(POSTURE.DEFEND);
    expect(posts(40)).toMatchObject([{ posture: POSTURE.DEFEND }]);
    expect(f.botPlannedPosture).toBeNull();
  });
});
