import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { POSTURE, TERRAIN, UNIT, isClaimable, type C2S_GameCommand, type ServerMessage } from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { snapshotPresence, stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { holdProgress } from '../src/game/gauge.js';
import { threatened } from '../src/game/rules.js';
import { newOutbox } from '../src/game/outbox.js';
import { NEUTRAL, createGameState, ledgerImbalance, makeFlag, rebuildAllyMatrix, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup));
}

/** 반경 r 디스크가 전부 중립 육지·비기지이고 맵 안쪽인 중심 타일 (tileId ASC 첫 번째) */
function findOpenArea(s: GameState, r: number, skip = 0): number {
  const W = s.map.width;
  const H = s.map.height;
  let k = 0;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    const disk = s.graph.disk(t, r);
    if (disk.every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) {
      if (k++ === skip) return t;
    }
  }
  throw new Error('no open area');
}

function plainify(s: GameState, c: number, r: number): void {
  for (const t of s.graph.disk(c, r)) s.map.terrain[t] = TERRAIN.PLAIN;
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
  s.ledger.initial += o.troops * 1000; // 테스트가 직접 넣은 병력도 장부에 올린다
  return f;
}

/** 순수 4a/4b 결투: 1000 대 1000 */
function duel(aUnit: 0 | 1 | 2, dUnit: 0 | 1 | 2, dTerrain: number, opts: { aTerrain?: number; aPosture?: 0 | 1; dPosture?: 0 | 1 } = {}) {
  const s = makeSim().state;
  const c = findOpenArea(s, 3);
  plainify(s, c, 3);
  const a = c;
  const d = c + 1;
  s.map.terrain[a] = opts.aTerrain ?? TERRAIN.PLAIN;
  s.map.terrain[d] = dTerrain;
  const fa = addFlag(s, { ownerId: 1, unit: aUnit, troops: 1000, pos: a, posture: opts.aPosture ?? POSTURE.ATTACK, state: 'ENGAGED' });
  const fd = addFlag(s, { ownerId: 2, unit: dUnit, troops: 1000, pos: d, posture: opts.dPosture ?? POSTURE.DEFEND, state: 'ENGAGED' });
  const out = newOutbox();
  let t = 0;
  while (!fa.routed && !fd.routed && t < 2000) {
    t++;
    s.tick = t;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
  }
  return { ticks: t, a: Math.floor(fa.troopsMilli / 1000), d: Math.floor(fd.troopsMilli / 1000), aRouted: fa.routed, dRouted: fd.routed, out };
}

describe('4.15 대표 전투 재현 (1000 대 1000)', () => {
  it('#1 검→검 평원: 양쪽 패주 ≈22.6초', () => {
    const r = duel(UNIT.SWORD, UNIT.SWORD, TERRAIN.PLAIN);
    expect(r.aRouted && r.dRouted).toBe(true);
    expect(Math.abs(r.ticks - 113)).toBeLessThanOrEqual(2);
  });
  it('#2 검→창 평원: 방어 ≈225', () => {
    const r = duel(UNIT.SWORD, UNIT.SPEAR, TERRAIN.PLAIN);
    expect(r.aRouted).toBe(true);
    expect(Math.abs(r.d - 225)).toBeLessThanOrEqual(5);
  });
  it('#3 검→창 언덕 ≈405 / 산 ≈519', () => {
    expect(Math.abs(duel(UNIT.SWORD, UNIT.SPEAR, TERRAIN.HILLS).d - 405)).toBeLessThanOrEqual(5);
    expect(Math.abs(duel(UNIT.SWORD, UNIT.SPEAR, TERRAIN.MOUNTAIN).d - 519)).toBeLessThanOrEqual(5);
  });
  it('#4 기병→검 평원: 공격 ≈148', () => {
    const r = duel(UNIT.CAVALRY, UNIT.SWORD, TERRAIN.PLAIN);
    expect(r.dRouted).toBe(true);
    expect(Math.abs(r.a - 148)).toBeLessThanOrEqual(5);
  });
  it('#5 조우전 기병↔검 (둘 다 공격): 기병 ≈148', () => {
    const r = duel(UNIT.CAVALRY, UNIT.SWORD, TERRAIN.HILLS, { dPosture: POSTURE.ATTACK });
    expect(Math.abs(r.a - 148)).toBeLessThanOrEqual(5); // 지형은 방어 태세에만 → 언덕이어도 무관
  });
  it('#6 무테크 상륙 검→검 평원: 방어 ≈195', () => {
    const r = duel(UNIT.SWORD, UNIT.SWORD, TERRAIN.PLAIN, { aTerrain: TERRAIN.SHALLOW });
    expect(r.aRouted).toBe(true);
    expect(Math.abs(r.d - 195)).toBeLessThanOrEqual(5);
  });
  it('방어 ↔ 방어는 싸우지 않는다', () => {
    const r = duel(UNIT.SWORD, UNIT.SWORD, TERRAIN.PLAIN, { aPosture: POSTURE.DEFEND });
    expect(r.ticks).toBe(2000);
    expect(r.a).toBe(1000);
  });
  it('combat_started / flag_routed / combat_ended 이벤트', () => {
    const r = duel(UNIT.SWORD, UNIT.SPEAR, TERRAIN.PLAIN);
    const ts = r.out.broadcast.map((m) => m.type);
    expect(ts.filter((x) => x === 'combat_started')).toHaveLength(1);
    expect(ts).toContain('flag_routed');
    const end = r.out.broadcast.find((m) => m.type === 'combat_ended');
    expect(end).toMatchObject({ winnerSideKey: 2, routedFlagIds: [1] });
  });
});

/** 풀 시뮬레이션 + 수동 배치 공용 */
function scenario(seed = 4242) {
  const sim = makeSim(seed);
  const s = sim.state;
  const c = findOpenArea(s, 8);
  plainify(s, c, 8);
  return { sim, s, c, W: s.map.width };
}

function run(sim: Simulation, n: number, check?: (out: ReturnType<Simulation['step']>) => void) {
  const all: ServerMessage[] = [];
  const personal: ServerMessage[] = [];
  for (let i = 0; i < n; i++) {
    const out = sim.step();
    all.push(...out.broadcast);
    personal.push(...out.personal.map((p) => p.msg));
    expect(ledgerImbalance(sim.state)).toBe(0);
    check?.(out);
  }
  return { all, personal };
}

describe('ZOC · 대치 · 태세', () => {
  it('방어 태세 적 인접 → 인접 칸 이동 금지 = 대치, 공격 전환 시 다음 tick 전투', () => {
    const { sim, s, c, W } = scenario();
    // c = p2 방어 주둔. p1 깃발은 c-W(인접)에서 c+W(내 땅)로 가려 한다 → 최단 경로가 c 를 지난다
    setTileOwner(s, c, 2, false);
    setTileOwner(s, c - W, 1, false);
    setTileOwner(s, c + W, 1, false);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c - W, anchor: c + W, posture: POSTURE.DEFEND, state: 'MARCHING' });
    const r = run(sim, 30);
    expect(f.posTileId).toBe(c - W);
    expect(f.blocked).toBe(true);
    expect(f.inCombat).toBe(false);
    expect(r.all.find((m) => m.type === 'flag_blocked')).toMatchObject({ flagId: f.id, byFlagIds: [1] });
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 1, flagId: f.id, posture: POSTURE.ATTACK });
    const r2 = run(sim, 1);
    expect(r2.personal).toContainEqual({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: f.id, posture: POSTURE.ATTACK });
    expect(f.inCombat).toBe(true);
    expect(r2.all.map((m) => m.type)).toContain('combat_started');
    expect(r2.all.map((m) => m.type)).toContain('flag_unblocked');
  });

  it('태세 전환: SAME_POSTURE / 쿨타임 25 tick POSTURE_COOLDOWN / IN_COMBAT', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const cmd = (seq: number, posture: 0 | 1): C2S_GameCommand => ({ type: 'cmd_set_posture', clientSeq: seq, flagId: f.id, posture });
    sim.enqueue(1, 1, cmd(1, POSTURE.DEFEND));
    sim.enqueue(1, 1, cmd(2, POSTURE.ATTACK));
    sim.enqueue(1, 1, cmd(3, POSTURE.DEFEND));
    const r = run(sim, 1);
    const t0 = s.tick;
    expect(r.personal).toEqual([
      { type: 'cmd_ack', clientSeq: 1, accepted: false, reason: 'SAME_POSTURE' },
      { type: 'cmd_ack', clientSeq: 2, accepted: true, flagId: f.id, posture: POSTURE.ATTACK },
      { type: 'cmd_ack', clientSeq: 3, accepted: false, reason: 'POSTURE_COOLDOWN' },
    ]);
    expect(f.postureCooldownUntilTick).toBe(t0 + 25);
    run(sim, 23);
    sim.enqueue(1, 1, cmd(4, POSTURE.DEFEND));
    expect(run(sim, 1).personal[0]).toMatchObject({ reason: 'POSTURE_COOLDOWN' }); // t0+24
    sim.enqueue(1, 1, cmd(5, POSTURE.DEFEND));
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true }); // t0+25
    f.inCombat = true;
    sim.enqueue(1, 1, cmd(6, POSTURE.ATTACK));
    s.flags.find((x) => x.id === f.id)!.postureCooldownUntilTick = 0;
    expect(run(sim, 1).personal[0]).toMatchObject({ reason: 'IN_COMBAT' });
  });
});

describe('이탈 대기 · 패주', () => {
  it('전투 중 회수 → 3초 대기(실효값 ×0.5) → broke_away, 패주 깃발 명령은 ROUTED', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 2, false);
    setTileOwner(s, c + 1, 1, false);
    const atk = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c + 1, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
    const def = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 1);
    expect(def.inCombat).toBe(true);
    const a0 = atk.troopsMilli;
    const d0 = def.troopsMilli;
    sim.enqueue(2, 2, { type: 'cmd_flag_recall', clientSeq: 1, flagId: def.id });
    const r = run(sim, 16); // 명령 tick + DISENGAGE_TICKS
    expect(r.personal[0]).toMatchObject({ accepted: true, flagId: def.id });
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toBeTruthy();
    // 검 방어(1000×0.5=500) vs 검 공격 1000 → 수비가 2배 잃는다
    expect(d0 - def.troopsMilli).toBeGreaterThan(1.8 * (a0 - atk.troopsMilli));
    expect(r.all.find((m) => m.type === 'flag_disengaged')).toMatchObject({ flagId: def.id, reason: 'broke_away' });
    expect(def.breakaway).toBe(true);
    expect(def.inCombat).toBe(false);
    run(sim, 1);
    expect(def.inCombat).toBe(false); // breakaway: 첫 칸 이동 전 교전 대상 아님

    // 패주 깃발: 조작 불가
    const { sim: sim2, s: s2, c: c2 } = scenario();
    const weak = addFlag(s2, { ownerId: 1, unit: UNIT.SWORD, troops: 50, pos: c2, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    addFlag(s2, { ownerId: 2, unit: UNIT.SPEAR, troops: 1000, pos: c2 + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const rr = run(sim2, 20);
    expect(weak.routed).toBe(true);
    expect(weak.state).toBe('RETURNING');
    expect(rr.all.map((m) => m.type)).toContain('flag_routed');
    sim2.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 9, flagId: weak.id, anchorTileId: c2 });
    sim2.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 10, flagId: weak.id, posture: POSTURE.DEFEND });
    sim2.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 11, flagId: weak.id });
    const acks = run(sim2, 1).personal;
    expect(acks.map((a) => (a as { reason?: string }).reason)).toEqual(['ROUTED', 'ROUTED', 'ROUTED']);
  });
});

describe('게이지', () => {
  it('게이지 레이스: 같은 tick 동시 1000 → flagId 작은 쪽 낙찰, 나머지 captured_by_other', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c - 1, 1, false);
    setTileOwner(s, c + 1, 2, false);
    const common = { unit: UNIT.SWORD, troops: 1000, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'ENGAGED' as const, targetTileId: c, progressMilli: 999, spendBudgetMilli: 375_000 };
    const f1 = addFlag(s, { ownerId: 1, pos: c - 1, ...common });
    const f2 = addFlag(s, { ownerId: 2, pos: c + 1, ...common });
    const r = run(sim, 1);
    expect(s.owners[c]).toBe(1);
    expect(f1.progressMilli).toBe(0);
    expect(f2.progressMilli).toBe(0);
    expect(r.all.find((m) => m.type === 'flag_progress_lost')).toMatchObject({ flagId: f2.id, tileId: c, cause: 'captured_by_other' });
    const delta = r.all.find((m) => m.type === 'snapshot_delta');
    expect(delta && delta.type === 'snapshot_delta' && delta.tileChanges).toContainEqual([c, 1]);
  });

  it('v4.1 되돌리기 폐지: 거리 2 방어 깃발은 공격 게이지를 막지 못한다 → 점령, 방어 병력 지출 0', () => {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 2)) setTileOwner(s, t, 2, false);
    setTileOwner(s, c - 3, 1, false);
    // p1 공격 깃발: c-2(적 땅)를 민다. p2 창 방어 깃발: 거리 2 (인접 아님 → 전투 없음, v4.0 이면 되돌리기)
    const atk = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 300, pos: c - 3, anchor: c - 2, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
    const def = addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 2000, pos: c + 1, anchor: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 40);
    expect(atk.inCombat || def.inCombat).toBe(false);
    expect(s.owners[c - 2]).toBe(1);
    expect(def.troopsMilli).toBe(2000_000); // 방어 태세 깃발은 게이지 단계에서 아무것도 쓰지 않는다
  });
});

describe('v4.1 진척도 자동 감소 (4.7 e) · 정체 재정의 (4.7 f)', () => {
  /** 감소 대상 공격 깃발: IDLE(밀지 않음), 진척 500, 타깃 X */
  function decayScenario() {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const X = c + 1;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'IDLE', idleSinceTick: 0, targetTileId: X, progressMilli: 500 });
    return { sim, s, c, X, f };
  }

  it('밀지 않으면 tick 당 20 감소, 0 도달 시 decayed 1회, 타깃 유지', () => {
    const { sim, f, X } = decayScenario();
    run(sim, 1);
    expect(f.progressMilli).toBe(480);
    const r = run(sim, 40);
    expect(f.progressMilli).toBe(0);
    const lost = r.all.filter((m) => m.type === 'flag_progress_lost');
    expect(lost).toEqual([expect.objectContaining({ flagId: f.id, tileId: X, cause: 'decayed', tick: 25 })]);
    expect(f.targetTileId).toBe(X); // sticky
  });

  it('주변 경계: 거리 1 적 깃발(대치, 방어↔방어 무전투) → 유지 / 거리 2 → 감소', () => {
    for (const [dist, expected] of [
      [1, 500],
      [2, 300],
    ] as const) {
      const { sim, s, c, f } = decayScenario();
      f.posture = POSTURE.DEFEND; // 전투 없이 "주변 적" 규칙만 본다
      const W = s.map.width;
      addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + dist * W, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
      run(sim, 10);
      expect(f.inCombat).toBe(false);
      expect(f.progressMilli).toBe(expected);
    }
  });

  it('동맹 깃발은 유지 근거가 아니다 / 패주 깃발은 presentEnemy 가 아니다', () => {
    const { sim, s, c, f } = decayScenario();
    f.posture = POSTURE.DEFEND;
    s.alliances.push({ a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    rebuildAllyMatrix(s);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + s.map.width, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    run(sim, 5);
    expect(f.progressMilli).toBe(400);
    // 패주 깃발 (holdProgress 직접)
    const g = addFlag(s, { ownerId: 3, unit: UNIT.SWORD, troops: 10, pos: c - 1, posture: POSTURE.DEFEND, state: 'IDLE' });
    expect(holdProgress(s, snapshotPresence(s), f)).toBe(true);
    g.routed = true;
    expect(holdProgress(s, snapshotPresence(s), f)).toBe(false);
  });

  it('전투 중 유지 → 상대 패주 tick 도 유지(4a 스냅숏) → 다음 tick 부터 감소', () => {
    const { sim, s, c, f } = decayScenario();
    const g = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 60, pos: c + s.map.width, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    let routTick = -1;
    run(sim, 200, () => {
      if (routTick < 0 && g.routed) {
        routTick = sim.state.tick;
        expect(f.progressMilli).toBe(500); // 패주 tick: 4a 스냅숏에 g 가 있다
      }
    });
    expect(routTick).toBeGreaterThan(1);
    expect(f.routed).toBe(false);
    // 패주 다음 tick 부터 감소 → 200 tick 이 끝나면 0
    expect(f.progressMilli).toBe(0);
  });

  it('패주한 공격 깃발의 진척도는 즉시 0 (기존 규칙)', () => {
    const { sim, s, c, f } = decayScenario();
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 2000, pos: c + s.map.width, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    f.troopsMilli = 60_000;
    s.ledger.initial -= 440_000;
    run(sim, 200, () => {
      if (!f.routed) expect(f.progressMilli).toBe(500); // 전투 중 유지
    });
    expect(f.routed).toBe(true);
    expect(f.progressMilli).toBe(0);
  });

  it('ENGAGED·ATTACK 인데 AP 0 이라 못 미는 깃발: updateStall(f, 0) → 25 tick 뒤 flag_stalled, 진척도는 감소', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    // initialTroops 1 → 예산 15 milli/tick, 상한 375 milli → availAP 영원히 0
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1, pos: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'ENGAGED', targetTileId: c + 1, progressMilli: 300 });
    f.troopsMilli = 100_000;
    s.ledger.initial += 99_000;
    const r = run(sim, 30);
    expect(f.stalled).toBe(true);
    expect(r.all.find((m) => m.type === 'flag_stalled')).toMatchObject({ flagId: f.id });
    expect(f.progressMilli).toBe(0);
    expect(r.all.filter((m) => m.type === 'flag_progress_lost' && m.cause === 'decayed')).toHaveLength(1);
  });

  it('threatened [A-43]: 관할 원 안 칸을 미는 적 ENGAGED 공격 깃발 → calmTicks 0', () => {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 2)) setTileOwner(s, t, 2, false);
    setTileOwner(s, c - 3, 1, false);
    const def = addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + 2, anchor: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 3);
    expect(def.calmTicks).toBe(3);
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 300, pos: c - 3, anchor: c - 2, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
    run(sim, 3);
    expect(threatened(s, def)).toBe(true);
    expect(def.calmTicks).toBe(0);
  });

});

describe('게이지 (계속)', () => {
  it('발령 → 행군 → 교전 → 중립 점령 (실제 명령 경로), 회계 불변식 매 tick', () => {
    const sim = makeSim();
    const s = sim.state;
    const home = s.players[1].homeTileId;
    let anchor = -1;
    for (const t of s.graph.disk(home, 5)) {
      if (s.graph.distance(t, home) === 5 && s.owners[t] === NEUTRAL && isClaimable(s.map.terrain[t])) {
        anchor = t;
        break;
      }
    }
    expect(anchor).toBeGreaterThanOrEqual(0);
    const tiles0 = s.players[1].tiles;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.CAVALRY, troops: 100, anchorTileId: anchor, originBaseTileId: null });
    const r = run(sim, 300);
    expect(r.personal[0]).toMatchObject({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: 1, posture: POSTURE.ATTACK });
    const ts = r.all.map((m) => m.type);
    expect(ts).toContain('flag_issued');
    expect(ts).toContain('flag_engaged');
    expect(s.players[1].tiles).toBeGreaterThan(tiles0);
  });

  it('공격 깃발은 앵커를 먹어도 방어로 바뀌지 않고 front 가 빌 때까지 계속 민다 (4.3a 재파생 폐지)', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c - 7, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1200, pos: c - 7, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'ENGAGED' });
    const tiles0 = s.players[1].tiles;
    let anchorTick = -1;
    const r = run(sim, 400, () => {
      if (anchorTick < 0 && s.owners[c] === 1) anchorTick = s.tick;
    });
    const captured = s.players[1].tiles - tiles0;
    console.log(`[one-flag] sword 1200 neutral: captured ${captured} tiles, anchor at tick ${anchorTick}, end state ${s.flags.find((x) => x.id === f.id)?.state ?? 'gone'}`);
    expect(anchorTick).toBeGreaterThan(0);
    expect(r.all.some((m) => m.type === 'flag_posture_changed')).toBe(false);
    expect(f.posture).toBe(POSTURE.ATTACK);
    expect(captured).toBeGreaterThan(30); // 앵커(7칸)를 훨씬 넘어 계속 점령
  });

  it('주둔 유지비: 내 땅 ENGAGED 검 2개 → 그로스의 9%', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    setTileOwner(s, c + 1, 1, false);
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 1);
    expect(s.players[1].upkeepPm).toBe(90);
  });
});

describe('기지 · 동맹', () => {
  it('기지 체력 0 → base_captured, 체력 50%, 락 25 tick', () => {
    const sim = makeSim();
    const s = sim.state;
    const b = s.bases.find((x) => s.owners[x.tileId] === NEUTRAL)!;
    const nb = s.graph.neighbors(b.tileId).find((x) => isClaimable(s.map.terrain[x]))!;
    setTileOwner(s, nb, 1, false);
    b.hpMilli = 500;
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: nb, anchor: b.tileId, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'ENGAGED', spendBudgetMilli: 100_000 });
    const r = run(sim, 3);
    expect(r.all.find((m) => m.type === 'base_captured')).toMatchObject({ tileId: b.tileId, fromPlayerId: 0, toPlayerId: 1, newHpPct: 50 });
    expect(s.owners[b.tileId]).toBe(1);
    expect(s.players[1].baseTiles).toContain(b.tileId);
  });

  it('동맹: 제안·수락 → 상대 향한 깃발 IDLE(allied), 최소 유지 전 파기 거절, BREAKING 150 tick 후 해제', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 2, false);
    setTileOwner(s, c - 1, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 300, pos: c - 1, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
    sim.enqueue(1, 1, { type: 'cmd_ally_propose', clientSeq: 1, targetPlayerId: 2 });
    let r = run(sim, 1);
    const prop = r.all.find((m) => m.type === 'ally_proposed');
    expect(prop).toMatchObject({ fromPlayerId: 1, toPlayerId: 2, proposalId: 1 });
    sim.enqueue(2, 2, { type: 'cmd_ally_respond', clientSeq: 1, proposalId: 1, accept: true });
    r = run(sim, 1);
    expect(r.all.map((m) => m.type)).toEqual(expect.arrayContaining(['ally_formed', 'flag_idle']));
    expect(f.state).toBe('IDLE');
    expect(s.alliances).toHaveLength(1);
    sim.enqueue(1, 1, { type: 'cmd_ally_break', clientSeq: 2, allyPlayerId: 2 });
    expect(run(sim, 1).personal[0]).toMatchObject({ reason: 'MIN_DURATION' });
    sim.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 3, flagId: f.id, anchorTileId: c });
    expect(run(sim, 1).personal[0]).toMatchObject({ reason: 'ALLIED' });
    run(sim, 300);
    sim.enqueue(1, 1, { type: 'cmd_ally_break', clientSeq: 4, allyPlayerId: 2 });
    r = run(sim, 1);
    expect(r.all.find((m) => m.type === 'ally_break_started')).toMatchObject({ byPlayerId: 1 });
    r = run(sim, 150);
    expect(r.all.find((m) => m.type === 'ally_broken')).toMatchObject({ a: 1, b: 2, reason: 'cooldown_elapsed' });
    expect(s.alliances).toHaveLength(0);
  });

  it('Lockout: 생존자 전원 동맹 → 150 tick 뒤 강제 해제 + 300 tick 재체결 금지', () => {
    const sim = makeSim();
    const s = sim.state;
    for (let id = 3; id < s.players.length; id++) s.players[id].alive = false;
    sim.enqueue(1, 1, { type: 'cmd_ally_propose', clientSeq: 1, targetPlayerId: 2 });
    sim.enqueue(2, 2, { type: 'cmd_ally_propose', clientSeq: 1, targetPlayerId: 1 }); // 상호 제안 → 즉시 성립
    let r = run(sim, 2);
    expect(r.all.find((m) => m.type === 'alliance_lockout')).toMatchObject({ phase: 'countdown' });
    r = run(sim, 150);
    expect(r.all.find((m) => m.type === 'alliance_lockout' && m.phase === 'dissolved')).toBeTruthy();
    expect(s.alliances).toHaveLength(0);
    sim.enqueue(1, 1, { type: 'cmd_ally_propose', clientSeq: 2, targetPlayerId: 2 });
    expect(run(sim, 1).personal[0]).toMatchObject({ reason: 'ALLY_FROZEN' });
  });
});

describe('결정론 (전투·게이지 포함)', () => {
  function scripted(seed: number): { hash: string; types: Set<string> } {
    const { sim, s, c, W } = scenario(seed);
    for (const t of s.graph.disk(c, 3)) setTileOwner(s, t, 2, false);
    setTileOwner(s, c - 4, 1, false);
    setTileOwner(s, c - 5, 1, false);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 600, pos: c - 3, anchor: c - 2, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 400, pos: c + W, anchor: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 900, pos: c - 5, anchor: c - 1, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'MARCHING' });
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 300, pos: c - 5, anchor: c - 2 + W, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'MARCHING' });
    const h = createHash('sha256');
    const types = new Set<string>();
    for (let i = 0; i < 400; i++) {
      if (i === 5) {
        for (let p = 1; p <= 4; p++) {
          const home = s.players[p].homeTileId;
          const anchor = s.graph.disk(home, 4).find((t) => s.graph.distance(t, home) === 4 && s.owners[t] === NEUTRAL && isClaimable(s.map.terrain[t]));
          if (anchor !== undefined) sim.enqueue(p, p, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.SWORD, troops: 60, anchorTileId: anchor, originBaseTileId: null });
        }
      }
      if (i === 120) sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 2, flagId: 4 });
      const out = sim.step();
      expect(ledgerImbalance(s)).toBe(0);
      h.update(JSON.stringify(out));
      for (const m of out.broadcast) {
        types.add(m.type);
        if (m.type === 'snapshot_delta' && m.tileChanges.length) types.add('tileChanges');
      }
    }
    return { hash: h.digest('hex'), types };
  }
  it('같은 입력 → 같은 출력 해시 (400 tick)', () => {
    const a = scripted(77);
    expect(a.hash).toBe(scripted(77).hash);
    for (const ty of ['flag_issued', 'flag_engaged', 'combat_started', 'combat_ended', 'tileChanges']) expect(a.types).toContain(ty);
  });
});
