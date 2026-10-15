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
  it('#1 검→검 평원: 양쪽 패주 ≈37.6초 (v4.5 손실률 1.5% → 0.9%: 22.6초 × 5/3)', () => {
    const r = duel(UNIT.SWORD, UNIT.SWORD, TERRAIN.PLAIN);
    expect(r.aRouted && r.dRouted).toBe(true);
    expect(Math.abs(r.ticks - 188)).toBeLessThanOrEqual(3);
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
  // v4.5: #6 상륙 전투 폐지 (물 위에 깃발이 서지 않는다)
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

describe('깃발 접촉 = 8방향 (사용자 결정 2026-10-11)', () => {
  it('토폴로지: contactNeighbors 8개(대각선 포함), touching = 체비셰프 ≤ 1, 이동 이웃은 4방향 그대로', () => {
    const { s, c, W } = scenario();
    expect([...s.graph.contactNeighbors(c)]).toEqual([c - W - 1, c - W, c - W + 1, c - 1, c + 1, c + W - 1, c + W, c + W + 1]);
    expect(s.graph.touching(c, c + W + 1)).toBe(true);
    expect(s.graph.touching(c, c)).toBe(true);
    expect(s.graph.touching(c, c + 2)).toBe(false);
    expect([...s.graph.neighbors(c)]).toEqual([c - W, c - 1, c + 1, c + W]);
  });

  it('대각선 접촉 → 깃발 전투 개시 (공격 태세 vs 방어 태세)', () => {
    const { sim, s, c, W } = scenario();
    setTileOwner(s, c, 2, false);
    setTileOwner(s, c + W + 1, 1, false);
    const d = addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const a = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c + W + 1, anchor: c + W + 1, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'IDLE', idleSinceTick: 0 });
    const r = run(sim, 1);
    expect(r.all.map((m) => m.type)).toContain('combat_started');
    expect(a.inCombat && d.inCombat).toBe(true);
    expect(a.posTileId).toBe(c + W + 1); // 대각선 그대로 — 이동 없이 교전
  });

  it('대각선 ZOC: 다음 칸·현재 칸이 모두 적 방어 깃발과 접촉하면 행군이 멈춘다 (4방향이면 현재 칸은 비접촉)', () => {
    const { sim, s, c, W } = scenario();
    for (const t of [c, c + 1, c + 2, c + 3]) setTileOwner(s, t, 1, false);
    setTileOwner(s, c + W + 1, 2, false);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + W + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, anchor: c + 3, posture: POSTURE.DEFEND, state: 'MARCHING' });
    const r = run(sim, 30);
    expect(f.posTileId).toBe(c);
    expect(f.blocked).toBe(true);
    expect(f.inCombat).toBe(false); // 방어 ↔ 방어는 싸우지 않는다
    expect(r.all.find((m) => m.type === 'flag_blocked')).toMatchObject({ flagId: f.id });
  });

  it('대각선 적 깃발이 있으면 진척도가 줄지 않는다 (holdProgress)', () => {
    const { sim, s, c, W } = scenario();
    for (const t of s.graph.disk(c, 1)) setTileOwner(s, t, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED', progressMilli: 500, targetTileId: c + 1 });
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + W + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 5);
    expect(f.progressMilli).toBe(500);
  });

  it('땅 점령은 4방향 그대로: marchFront 에 대각선 칸이 들어가지 않는다', () => {
    const { sim, s, c, W } = scenario();
    for (const t of s.graph.disk(c, 2)) setTileOwner(s, t, 1, false);
    setTileOwner(s, c + W + 1, 2, false); // 대각선만 적
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'IDLE', idleSinceTick: 0 });
    run(sim, 3);
    expect(f.state).toBe('IDLE'); // 재점화 없음
    expect(s.owners[c + W + 1]).toBe(2);
    setTileOwner(s, c + 1, 2, false); // 옆(4방향) 칸이 적이 되면 재점화
    run(sim, 1);
    expect(f.state).toBe('ENGAGED');
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
    setTileOwner(s2, c2, 1, false); // v4.5: 손실률 0.9% — 중립 칸이면 노출 소모(≥ 1/tick)가 마지막 병력을 먼저 지워 패주 대신 attrited 가 된다
    const weak = addFlag(s2, { ownerId: 1, unit: UNIT.SWORD, troops: 50, pos: c2, posture: POSTURE.ATTACK, state: 'ENGAGED', originTileId: s2.players[1].homeTileId });
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
  /**
   * 감소 대상 공격 깃발: IDLE(밀지 않음), 진척 500, 타깃 X.
   * v4.2 교체 사유: IDLE 공격 깃발은 옆 칸이 적·중립이면 그 자리에서 재점화(A-59)하므로, 옆 칸(반경 1)을 전부 내 땅으로 둔다.
   */
  function decayScenario() {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 1)) setTileOwner(s, t, 1, false);
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
    // v4.5: g 를 자기 땅(대각선 접촉 칸)에 — 남의 땅이면 손실률 0.9% 에서 노출 소모가 마지막 병력을 지워 패주 대신 attrited
    const gPos = c + s.map.width + 1;
    setTileOwner(s, gPos, 2, false);
    const g = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 60, pos: gPos, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    let routTick = -1;
    run(sim, 400, () => { // v4.5: 손실률 0.9% → 패주까지 더 오래
      if (routTick < 0 && g.routed) {
        routTick = sim.state.tick;
        expect(f.progressMilli).toBe(500); // 패주 tick: 4a 스냅숏에 g 가 있다
      }
    });
    expect(routTick).toBeGreaterThan(1);
    expect(f.routed).toBe(false);
    // 패주 다음 tick 부터 감소 → 400 tick 이 끝나면 0
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
  // v4.2 교체 사유: 공격 깃발은 국경에 닿는 순간부터 옆 칸을 정지 점령(halted)한다 — 병력 100 기병은 앵커 전에 소진될 수 있어 flag_engaged 대신 halted 관측
  it('발령 → 행군 → 정지 점령(halted) → 중립 점령 (실제 명령 경로), 회계 불변식 매 tick', () => {
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
    let haltedSeen = false;
    const r = run(sim, 300, () => {
      if (s.flags.some((f) => f.id === 1 && f.halted && f.state === 'MARCHING')) haltedSeen = true;
    });
    expect(r.personal[0]).toMatchObject({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: 1, posture: POSTURE.ATTACK });
    const ts = r.all.map((m) => m.type);
    expect(ts).toContain('flag_issued');
    expect(haltedSeen).toBe(true);
    expect(s.players[1].tiles).toBeGreaterThan(tiles0);
  });

  // v4.2 교체 사유: 앵커 원(반경 6) 공격 폐기 [A-53]. "front 가 빌 때까지 원 안을 민다" → "노선 옆 칸(폭 3)을 먹으며 앵커까지 가고 옆 칸까지 먹고 IDLE"
  it('직선 쟁기 폭 3: 경로 옆 칸 전부 점령 → 앵커 ENGAGED(옆 칸) → IDLE, 태세는 ATTACK 유지, 2분 뒤 자동 귀환(지정 기지 없음)', () => {
    const { sim, s, c, W } = scenario();
    setTileOwner(s, c - 7, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1200, pos: c - 7, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    const before = new Set<number>();
    for (let t = 0; t < s.owners.length; t++) if (s.owners[t] === 1) before.add(t);
    let idleTick = -1;
    const r = run(sim, 600, () => {
      if (idleTick < 0 && f.state === 'IDLE') idleTick = s.tick;
    });
    expect(idleTick).toBeGreaterThan(0);
    expect(f.posTileId).toBe(c);
    expect(f.posture).toBe(POSTURE.ATTACK);
    expect(r.all.some((m) => m.type === 'flag_posture_changed')).toBe(false);
    const eng = r.all.find((m) => m.type === 'flag_engaged' && m.flagId === f.id);
    expect(eng).toMatchObject({ posture: POSTURE.ATTACK, frontTileCount: 3 }); // 앵커 칸 옆: c+1, c±W (c-1 은 이미 내 땅)
    expect(r.all.find((m) => m.type === 'flag_idle' && m.flagId === f.id)).toMatchObject({ reason: 'front_cleared' });
    // 회랑 = 행 c-8..c+1 + 위·아래 행 c-7..c (폭 3). 그 밖은 새로 먹은 칸이 없다
    const expected = new Set<number>();
    for (let k = -8; k <= 1; k++) expected.add(c + k);
    for (let k = -7; k <= 0; k++) {
      expected.add(c + k - W);
      expected.add(c + k + W);
    }
    for (const t of expected) expect(s.owners[t]).toBe(1);
    for (let t = 0; t < s.owners.length; t++) if (s.owners[t] === 1 && !before.has(t)) expect(expected.has(t)).toBe(true);
    // IDLE 2분(600 tick) → 자동 귀환, returnBaseTileId = null [A-59][A-61]
    const r2 = run(sim, idleTick + 600 - s.tick + 1);
    expect(r2.all.find((m) => m.type === 'flag_recalled' && m.flagId === f.id)).toBeTruthy();
    expect(f.state).toBe('RETURNING');
    expect(f.returnBaseTileId).toBeNull();
  });

  it('유지비: 출전 검 2개 → 그로스의 9%', () => {
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
    // v4.2 교체 사유: IDLE(allied) 공격 깃발도 옆에 비동맹 칸(여기선 중립)이 있으면 같은 tick 4단계에서 재점화한다 [A-59].
    // 동맹 칸(c)은 marchFront 에서 빠지므로 다시는 타깃이 되지 않는다
    expect(r.all.find((m) => m.type === 'flag_idle' && m.flagId === f.id)).toMatchObject({ reason: 'allied' });
    expect(f.targetTileId).not.toBe(c);
    run(sim, 30);
    expect(s.owners[c]).toBe(2);
    expect(f.targetTileId).not.toBe(c);
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

describe('QA 후속 (I-2, m-9, m-10, I-1)', () => {
  // v4.2 교체 사유: QA I-2 수락 경로 폐기 [A-62] — 귀환 중엔 모든 명령 거절(전투 중이어도), 붙잡히면 서버가 자동 이탈 대기
  it('v4.2 [A-62]: 교전 중 귀환 깃발 — 회수·재지정·태세 전부 RETURNING 거절, 자동 이탈 대기(auto), 패주 깃발은 ROUTED', () => {
    const sim = makeSim();
    const s = sim.state;
    const c = findOpenArea(s, 3);
    plainify(s, c, 3);
    const back = addFlag(s, { ownerId: 1, unit: 0, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'RETURNING', returnTileId: s.players[1].homeTileId });
    addFlag(s, { ownerId: 2, unit: 2, troops: 1000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED', targetOwnerId: 1 });
    const out1 = sim.step();
    expect(back.inCombat).toBe(true);
    expect(out1.broadcast.find((m) => m.type === 'flag_disengage_started' && m.flagId === back.id)).toMatchObject({ auto: true, untilTick: 1 + 15 });
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 1, flagId: back.id });
    sim.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 2, flagId: back.id, anchorTileId: c + 2 });
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 3, flagId: back.id, posture: POSTURE.ATTACK });
    const out = sim.step();
    const acks = out.personal.filter((p) => p.msg.type === 'cmd_ack').map((p) => p.msg);
    expect(acks).toEqual([1, 2, 3].map((q) => expect.objectContaining({ clientSeq: q, accepted: false, reason: 'RETURNING' })));
    expect(out.broadcast.some((m) => m.type === 'flag_disengage_started')).toBe(false); // 이미 대기 중 — 재개시 없음
    back.routed = true;
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 4, flagId: back.id });
    expect(sim.step().personal.find((p) => p.msg.type === 'cmd_ack')?.msg).toMatchObject({ accepted: false, reason: 'ROUTED' });
    expect(ledgerImbalance(s)).toBe(0);
  });

  it('I-1: flag_posture_changed 에 targetOwnerId (내 땅 앵커 → 254)', () => {
    const sim = makeSim();
    const s = sim.state;
    const home = s.players[1].homeTileId;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: 0, troops: 60, anchorTileId: home, originBaseTileId: null });
    sim.step();
    const f = s.flags.find((x) => x.ownerId === 1)!;
    for (let i = 0; i < 30; i++) sim.step();
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 2, flagId: f.id, posture: POSTURE.ATTACK });
    const ev = sim.step().broadcast.find((m) => m.type === 'flag_posture_changed');
    expect(ev).toMatchObject({ flagId: f.id, posture: POSTURE.ATTACK, targetOwnerId: 254 });
  });

  it('m-10: 봇(connId 0) 명령 ack 은 fromBot 표시, m-9: 종료 후 남은 사람 명령은 NOT_IN_GAME ack', () => {
    const sim = makeSim();
    sim.enqueue(0, 2, { type: 'cmd_buy_tech', clientSeq: 9, nodeId: 3 });
    sim.enqueue(5, 1, { type: 'cmd_buy_tech', clientSeq: 10, nodeId: 3 });
    const out = sim.step();
    expect(out.personal.find((p) => p.playerId === 2)?.fromBot).toBe(true);
    expect(out.personal.find((p) => p.playerId === 1)?.fromBot).toBeUndefined();
    sim.enqueue(5, 1, { type: 'cmd_buy_tech', clientSeq: 11, nodeId: 0 });
    sim.enqueue(0, 2, { type: 'cmd_buy_tech', clientSeq: 12, nodeId: 0 });
    expect(sim.flushPending()).toEqual([{ playerId: 1, msg: { type: 'cmd_ack', clientSeq: 11, accepted: false, reason: 'NOT_IN_GAME' } }]);
    expect(sim.flushPending()).toEqual([]);
  });
});

describe('v4.2 공격 = 깃발 옆 칸 (4.4a) · 귀환 (4.4 v4.2)', () => {
  it('IDLE 공격 깃발 재점화: 옆 칸이 다시 적이 되면 그 자리에서 ENGAGED (이동 없음) [A-59]', () => {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 1)) setTileOwner(s, t, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'IDLE', idleSinceTick: 0 });
    run(sim, 3);
    expect(f.state).toBe('IDLE');
    setTileOwner(s, c + 1, 2, false);
    const r = run(sim, 1);
    expect(f.state).toBe('ENGAGED');
    expect(f.posTileId).toBe(c);
    expect(r.all.find((m) => m.type === 'flag_engaged' && m.flagId === f.id)).toMatchObject({ frontTileCount: 1 });
    run(sim, 60);
    expect(s.owners[c + 1]).toBe(1);
    expect(f.state).toBe('IDLE');
  });

  it('대상: 동맹 칸 제외, 중립·제3자 포함 (A-51) — 동맹 땅 위에 서서 옆 칸을 먹는다', () => {
    const { sim, s, c, W } = scenario();
    s.alliances.push({ a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    rebuildAllyMatrix(s);
    setTileOwner(s, c, 2, false); // 깃발이 선 칸 = 동맹 땅
    setTileOwner(s, c - 1, 2, false); // 동맹
    setTileOwner(s, c + 1, 3, false); // 제3자
    // c ± W 는 중립
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 800, pos: c, anchor: c + 5, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    run(sim, 1);
    expect(f.halted).toBe(true);
    run(sim, 80);
    expect(s.owners[c - 1]).toBe(2);
    expect(s.owners[c + 1]).toBe(1);
    expect(s.owners[c - W]).toBe(1);
    expect(s.owners[c + W]).toBe(1);
  });

  it('고립 영토 생성: 동맹 땅을 지나 먹은 칸은 내 본토와 연결되지 않아도 된다 [A-56]', () => {
    const { sim, s, c } = scenario();
    s.alliances.push({ a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    rebuildAllyMatrix(s);
    const home = c - 8;
    setTileOwner(s, home, 1, false);
    for (let k = -7; k <= 0; k++) for (const d of [-s.map.width, 0, s.map.width]) setTileOwner(s, c + k + d, 2, false); // 폭 3 동맹 회랑
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 800, pos: home, anchor: c + 2, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    run(sim, 300);
    expect(s.owners[c + 1]).toBe(1);
    // home 과 연결된 내 땅 성분 밖에 내 땅이 있다
    const comp = new Set<number>([home]);
    const q = [home];
    for (let i = 0; i < q.length; i++) for (const n of s.graph.neighbors(q[i])) if (s.owners[n] === 1 && !comp.has(n)) (comp.add(n), q.push(n));
    expect(comp.has(c + 1)).toBe(false);
  });

  it('물 위 깃발: 해안 이웃을 정지 점령한다 (beach 폐기 → marchFront)', () => {
    const { sim, s, c } = scenario();
    s.map.terrain[c] = TERRAIN.SHALLOW;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 600, pos: c, anchor: c + 4, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    s.owners[c - 1] = 1; // 출발 쪽 (기록 없이 — tiles 파생은 이 테스트에서 안 본다)
    s.players[1].tiles += 1;
    run(sim, 1);
    expect(f.halted).toBe(true);
    run(sim, 40);
    expect(s.owners[c + 1]).toBe(1);
  });

  it('방어 태세 행군은 공격하지 않는다 / 걷는 중 예산 누적 0', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c - 7, 1, false);
    setTileOwner(s, c, 1, false);
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 800, pos: c - 7, anchor: c, posture: POSTURE.DEFEND, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    const tiles0 = s.players[1].tiles;
    run(sim, 20, () => {
      expect(d.halted).toBe(false);
      expect(d.spendBudgetMilli).toBe(0);
    });
    expect(s.players[1].tiles).toBe(tiles0);
    // 내 땅만 걷는 공격 깃발: 옆 칸 없음 → 걷기만, 예산 누적 0
    const { sim: sim2, s: s2, c: c2 } = scenario();
    for (let k = -7; k <= 0; k++) for (const t of s2.graph.disk(c2 + k, 1)) setTileOwner(s2, t, 1, false);
    const a = addFlag(s2, { ownerId: 1, unit: UNIT.SWORD, troops: 800, pos: c2 - 7, anchor: c2 - 1, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    run(sim2, 20, () => {
      if (a.state === 'MARCHING') {
        expect(a.halted).toBe(false);
        expect(a.spendBudgetMilli).toBe(0);
      }
    });
  });

  it('breakaway 깃발은 한 칸 이동하기 전엔 정지 점령하지 않는다 [A-55]', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 800, pos: c, anchor: c + 6, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING', breakaway: true });
    let movedTick = -1;
    run(sim, 20, () => {
      if (f.breakaway) {
        expect(f.halted).toBe(false);
        expect(f.spendBudgetMilli).toBe(0);
      } else if (movedTick < 0) {
        movedTick = s.tick;
        expect(f.posTileId).toBe(c + 1);
        expect(f.halted).toBe(true);
      }
    });
    expect(movedTick).toBeGreaterThan(1);
  });

  it('전투 우선: 정지 점령 중 적 방어 깃발이 붙으면 halted 해제·예산 동결, 진척도 유지', () => {
    const { sim, s, c, W } = scenario();
    setTileOwner(s, c - 1, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c - 1, anchor: c + 6, posture: POSTURE.ATTACK, targetOwnerId: NEUTRAL, state: 'MARCHING' });
    run(sim, 2);
    expect(f.halted).toBe(true);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 1000, pos: c - 1 + W, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 1);
    expect(f.inCombat).toBe(true);
    expect(f.halted).toBe(false);
    const bud = f.spendBudgetMilli;
    const prog = f.progressMilli;
    run(sim, 5);
    expect(f.spendBudgetMilli).toBe(bud);
    expect(f.progressMilli).toBe(prog);
  });

  it('유지비 = 출전 깃발 전부 [A-60 변경]: 태세·상태 무관, 패주만 제외, 상한 700 (순증 ≥ 0)', () => {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 2)) setTileOwner(s, t, 1, false);
    // 검 방어 ENGAGED + 기병 공격 MARCHING(내 땅 안) + 창 IDLE = 1000 + 1600 + 600 = 3200 → 과금 2200 × 90 / 1000 = 198
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: c - 1, anchor: c + 1, posture: POSTURE.ATTACK, state: 'MARCHING' });
    addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: c + s.map.width, posture: POSTURE.ATTACK, state: 'IDLE', idleSinceTick: 0 });
    const routed = addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 0, pos: c - s.map.width, posture: POSTURE.ATTACK, state: 'RETURNING', routed: true, returnTileId: c });
    void routed;
    run(sim, 1);
    expect(s.players[1].upkeepPm).toBe(198);
    // 상한: 기병 7개 = 11200 → 과금 10200 × 0.09 = 918 → 700
    const { sim: sim2, s: s2, c: c2 } = scenario();
    for (const t of s2.graph.disk(c2, 2)) setTileOwner(s2, t, 1, false);
    for (let k = 0; k < 7; k++) addFlag(s2, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: c2, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim2, 1);
    expect(s2.players[1].upkeepPm).toBe(700);
  });

  it('지정 기지 회수 [A-61]: NOT_BASE / NOT_OWNED_BASE 거절, 지정 기지로 이동해 귀환, 잃으면 폴백 후 복귀 안 함', () => {
    const sim = makeSim();
    const s = sim.state;
    const p = s.players[1];
    const myBase = p.baseTiles[0];
    // 남의 기지 하나를 p1 에게 준다 (지정 대상), 다른 하나는 남의 것으로 둔다
    const others = s.map.baseTiles.filter((b) => s.owners[b] !== 1);
    const target = others.sort((a, b) => s.graph.distance(a, myBase) - s.graph.distance(b, myBase) || a - b)[0];
    const foreign = others.find((b) => b !== target)!;
    setTileOwner(s, target, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 300, pos: myBase, anchor: myBase, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    const nonBase = s.graph.neighbors(myBase).find((t) => !s.map.isBase[t])!;
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 1, flagId: f.id, baseTileId: nonBase });
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 2, flagId: f.id, baseTileId: foreign });
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 3, flagId: f.id, baseTileId: target });
    const r = run(sim, 1);
    expect(r.personal.map((m) => (m.type === 'cmd_ack' ? m.reason ?? 'OK' : ''))).toEqual(['NOT_BASE', 'NOT_OWNED_BASE', 'OK']);
    expect(f.state).toBe('RETURNING');
    expect(f.returnBaseTileId).toBe(target);
    expect(f.returnTileId).toBe(target);
    const rec = r.all.find((m) => m.type === 'flag_recalled');
    expect(rec).toMatchObject({ flagId: f.id, returnTileId: target });
    const d0 = r.all.find((m) => m.type === 'snapshot_delta');
    expect(d0 && d0.type === 'snapshot_delta' && d0.flagReturnBase).toContainEqual([f.id, target]);
    run(sim, 3);
    expect(s.graph.distance(f.posTileId, target)).toBeLessThan(s.graph.distance(myBase, target));
    // 지정 기지 상실 → 다음 tick 폴백(출발 기지), returnBaseTileId = null. 되찾아도 다시 가지 않는다
    setTileOwner(s, target, 2, false);
    run(sim, 1);
    expect(f.returnBaseTileId).toBeNull();
    expect(f.returnTileId).toBe(myBase);
    setTileOwner(s, target, 1, false);
    run(sim, 1);
    expect(f.returnTileId).toBe(myBase);
    const r2 = run(sim, 400);
    expect(r2.all.find((m) => m.type === 'flag_ended' && m.flagId === f.id)).toMatchObject({ reason: 'recalled' });
  });

  it('귀환 ×1.5 (패주 포함) [A-63] · ZOC 무시 [A-62]', async () => {
    const { speedMilliAt } = await import('../src/game/rules.js');
    const { s, c } = scenario();
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c, posture: POSTURE.ATTACK, state: 'MARCHING' });
    expect(speedMilliAt(s, f, c)).toBe(140); // FLAG_SPEED_BASE_MILLI 140 [A-64]
    f.state = 'RETURNING';
    expect(speedMilliAt(s, f, c)).toBe(210);
    f.routed = true;
    expect(speedMilliAt(s, f, c)).toBe(210);
    // ZOC: 적 방어 깃발 옆 칸을 지나가는 귀환 깃발은 멈추지 않는다 (같은 배치의 행군 깃발은 대치)
    for (const state of ['RETURNING', 'MARCHING'] as const) {
      const sc = scenario();
      const { sim: sm, s: ss, c: cc } = sc;
      setTileOwner(ss, cc + 6, 1, false);
      const g = addFlag(ss, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: cc, anchor: cc + 6, posture: POSTURE.DEFEND, state, returnTileId: cc + 6, originTileId: cc + 6 });
      addFlag(ss, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: cc + 2, posture: POSTURE.DEFEND, state: 'ENGAGED' }); // 경로 위 (방어↔방어 = 무전투)
      run(sm, 30);
      if (state === 'RETURNING') expect(!ss.flags.includes(g) || g.posTileId > cc + 2).toBe(true);
      else {
        expect(g.posTileId).toBe(cc + 1);
        expect(g.blocked).toBe(true);
      }
    }
  });

  it('귀환 깃발은 공격 쪽이 될 수 없다: 귀환(공격 태세) ↔ 적 방어 깃발 인접 = 전투 없음', () => {
    const { sim, s, c } = scenario();
    const back = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.ATTACK, state: 'RETURNING', returnTileId: c + 8, originTileId: c + 8 });
    setTileOwner(s, c + 8, 1, false);
    addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 500, pos: c + 1 + s.map.width, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 5, () => expect(back.inCombat).toBe(false));
  });

  it('자동 이탈 대기 → broke_away → 귀환 계속 (붙잡은 적 공격 깃발)', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c + 8, 1, false);
    const back = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'RETURNING', returnTileId: c + 8, originTileId: c + 8 });
    addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 300, pos: c - 1, anchor: c - 1, posture: POSTURE.ATTACK, state: 'IDLE', idleSinceTick: 0 });
    const r = run(sim, 40);
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toMatchObject({ flagId: back.id, auto: true });
    expect(r.all.find((m) => m.type === 'flag_disengaged' && m.flagId === back.id)).toMatchObject({ reason: 'broke_away' });
    expect(back.posTileId).not.toBe(c);
    expect(back.state).toBe('RETURNING');
  });
});

