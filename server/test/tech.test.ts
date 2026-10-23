/**
 * 테크 v4.6 (2026-10-24 개편 — _workspace/06_tech_overhaul_draft.md §10): 4티어 42노드, 병종 수치 절대 점수, 재정·행정 양자택일, 기지 효과.
 * 노드 표·가격식·합산·계산식 연결·프로토콜. (v4.3 의 32노드 시험을 새 표에 맞춰 다시 썼다.)
 */
import { describe, expect, it } from 'vitest';
import {
  POSTURE,
  TECH_NODES,
  TECH_NODE_COUNT,
  TECH_STAT,
  TERRAIN,
  UNIT,
  isClaimable,
  techCount,
  techMaskWith,
  techNodeCost,
  techOwned,
  techPrereqMet,
  techExclusiveBlocker,
  techStatValues,
  type C2S_GameCommand,
  type S2C_SnapshotDelta,
  type S2C_SnapshotFull,
} from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { flagValue } from '../src/game/combat.js';
import { flagCap, garrisonUpkeepPermille, regenMilliPerTick, troopCap } from '../src/game/economy.js';
import { baseEqTiles } from '../src/game/production.js';
import { moveCostPermille, speedMilliAt, supplyPermille, tileCost } from '../src/game/rules.js';
import { buildMatchConfig } from '../src/game/snapshot.js';
import { NEUTRAL, createGameState, makeFlag, setTileOwner, type Flag, type GameState, type PlayerState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { TECH_PRIORITY, TECH_PRIORITY_SWORD } from '../src/game/bot.js';

const id = (code: string): number => TECH_NODES.find((n) => n.code === code)!.id;

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup));
}

/** 서버 경로(cmd_buy_tech)로 codes 를 순서대로 산다. 골드는 넉넉히 채운다. 반환 = 각 구매의 ack·이벤트 */
function buyAll(sim: Simulation, pid: number, codes: string[]) {
  const results: { accepted: boolean; reason?: string; cost?: number }[] = [];
  let seq = 1;
  for (const c of codes) {
    sim.state.players[pid].goldMilli = 100_000_000;
    sim.enqueue(1, pid, { type: 'cmd_buy_tech', clientSeq: seq++, nodeId: id(c) } as C2S_GameCommand);
    const out = sim.step();
    const ack = out.personal.find((p) => p.playerId === pid && p.msg.type === 'cmd_ack')!.msg as { accepted: boolean; reason?: string };
    const ev = out.broadcast.find((m) => m.type === 'tech_purchased' && m.playerId === pid) as { cost: number } | undefined;
    results.push({ accepted: ack.accepted, reason: ack.reason, cost: ev?.cost });
  }
  return results;
}

/** 테크만 바꾼 플레이어 상태 (직접 대입 — 계산식 단위 테스트용) */
function giveTech(p: PlayerState, ...codes: string[]): void {
  let m = 0;
  for (const c of codes) m = techMaskWith(m, id(c));
  p.techMask = m;
  p.techPurchased = codes.length;
  p.statPm = techStatValues(m);
}

function findOpenArea(s: GameState, r: number): number {
  const W = s.map.width;
  const H = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('no open area');
}

function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number } & Partial<Flag>): Flag {
  const f = makeFlag({
    id: s.nextFlagId++,
    ownerId: o.ownerId,
    slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length,
    unit: o.unit,
    troopsMilli: o.troops * 1000,
    initialTroops: o.troops,
    posTileId: o.pos,
    anchorTileId: o.pos,
    originTileId: o.pos,
  });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}

const ALL = TECH_NODES.reduce((m, n) => techMaskWith(m, n.id), 0);

describe('v4.6 노드 표', () => {
  it('42노드 · 갈래 7 × 티어 4 · 부모 = 같은 갈래 한 티어 아래 · 마스크 53비트 안전 정수', () => {
    expect(TECH_NODES.length).toBe(TECH_NODE_COUNT);
    expect(TECH_NODE_COUNT).toBe(42);
    expect(new Set(TECH_NODES.map((n) => n.branch)).size).toBe(7);
    for (let b = 0; b < 7; b++) expect([1, 2, 3, 4].map((t) => TECH_NODES.filter((n) => n.branch === b && n.tier === t).length)).toEqual([1, 2, 2, 1]);
    expect(TECH_NODES.filter((n) => n.tier === 1).every((n) => n.parent === null)).toBe(true);
    for (const n of TECH_NODES.filter((x) => x.tier === 4)) expect(n.parentAlt).toBeDefined();
    expect(ALL).toBe(2 ** 42 - 1);
    expect(Number.isSafeInteger(ALL)).toBe(true);
    expect(techCount(ALL)).toBe(42);
    expect(techMaskWith(0, 41)).toBe(2 ** 41);
    expect(techMaskWith(techMaskWith(0, 3), 3)).toBe(8); // 이미 보유면 그대로
    expect(techOwned(2 ** 41, 41)).toBe(true);
    expect(techOwned(2 ** 41, 40)).toBe(false);
  });
  it('노드 스탯 매핑 (설계 §10 표 그대로) — 병종 수치는 점수, 노드당 스탯 하나', () => {
    const s = (c: string) => TECH_NODES[id(c)];
    expect(s('MIL-1')).toMatchObject({ stat: TECH_STAT.COMBAT_ATK, op: 'add', value: 10 });
    expect(s('MIL-3A')).toMatchObject({ stat: TECH_STAT.COMBAT_ATK, value: 20 });
    expect(s('MIL-3B')).toMatchObject({ stat: TECH_STAT.COMBAT_DEF, value: 20 });
    expect(s('MIL-4')).toMatchObject({ stat: TECH_STAT.MORALE_DROP, value: -150 });
    expect(s('SPE-1')).toMatchObject({ stat: TECH_STAT.COMBAT_DEF_SPEAR, op: 'add', value: 10 });
    expect(s('SPE-2A')).toMatchObject({ stat: TECH_STAT.UPKEEP_WEIGHT_SPEAR, op: 'set', value: 450 });
    expect(s('SPE-4')).toMatchObject({ stat: TECH_STAT.COMBAT_DEF_SPEAR, value: 30, tier: 4 });
    expect(s('SPE-3B')).toMatchObject({ stat: TECH_STAT.SPEED_SPEAR, value: 10 }); // 창병 약점 보완(느린 속도)
    expect(s('SWO-2B')).toMatchObject({ stat: TECH_STAT.CAPTURE_MULT_SWORD, op: 'add', value: -100 });
    expect(s('SWO-3B')).toMatchObject({ stat: TECH_STAT.CAPTURE_MULT_SWORD, op: 'add', value: -100 });
    expect(s('SWO-4')).toMatchObject({ stat: TECH_STAT.MORALE_DROP_SWORD, value: -200 }); // 검병은 공격·방어 보너스를 크게 주지 않는다
    expect(s('CAV-2A')).toMatchObject({ stat: TECH_STAT.CONVERT_CAVALRY, op: 'set', value: 1200 });
    expect(s('CAV-4')).toMatchObject({ stat: TECH_STAT.COMBAT_ATK_CAVALRY, value: 30 });
    expect(s('CAV-3A')).toMatchObject({ stat: TECH_STAT.UPKEEP_WEIGHT_CAVALRY, op: 'set', value: 1300 });
    expect(s('CAV-3B')).toMatchObject({ stat: TECH_STAT.MORALE_FULL_BONUS_CAVALRY, value: 50 });
    expect(s('MOB-2B')).toMatchObject({ stat: TECH_STAT.DISENGAGE_TICKS, op: 'set', value: 10, name: '철수 훈련' });
    expect(s('MOB-3B')).toMatchObject({ stat: TECH_STAT.RETURN_SPEED, op: 'set', value: 2200, name: '급속 귀환' });
    expect(s('MOB-4')).toMatchObject({ stat: TECH_STAT.MORALE_RECOVER, value: 300 });
    expect(s('TER-2B')).toMatchObject({ stat: TECH_STAT.BASE_DMG, value: -200 });
    expect(s('TER-3B')).toMatchObject({ stat: TECH_STAT.BASE_RECOVER, value: 500 });
    expect(s('TER-4')).toMatchObject({ stat: TECH_STAT.CAPITAL_PROD, value: 300 });
  });
  it('전부 보유 시 스탯 값 (양자택일 상대는 서버에서 못 사지만 표 합산은 순수 함수)', () => {
    const v = techStatValues(ALL);
    expect(v[TECH_STAT.ATK_COST]).toBe(960);
    expect(v[TECH_STAT.DEF_COST]).toBe(1060);
    expect(v[TECH_STAT.COMBAT_ATK]).toBe(30); // 점수
    expect(v[TECH_STAT.COMBAT_DEF]).toBe(20);
    expect(v[TECH_STAT.SPEED]).toBe(20);
    expect(v[TECH_STAT.NEUTRAL_COST]).toBe(1000 - 60 - 80);
    expect(v[TECH_STAT.SLOT_BONUS]).toBe(1); // [A-74] 최대 +1
    expect(v[TECH_STAT.DISENGAGE_TICKS]).toBe(10);
    expect(v[TECH_STAT.RETURN_SPEED]).toBe(2200);
    expect(v[TECH_STAT.UPKEEP_COEF]).toBe(72);
    expect(v[TECH_STAT.SUPPLY_COEF]).toBe(15);
    expect(v[TECH_STAT.TROOP_CAP]).toBe(1000); // 병력 상한 노드는 이번 개편에서 뺐다
  });
  it('무테크 기본: 전투·이동 점수 0, 기지 3칸 1000, 길이 = TECH_STAT_COUNT', () => {
    const v = techStatValues(0);
    expect(v.length).toBe(47);
    expect([v[TECH_STAT.COMBAT_ATK], v[TECH_STAT.COMBAT_DEF], v[TECH_STAT.SPEED]]).toEqual([0, 0, 0]);
    expect([v[TECH_STAT.BASE_DMG], v[TECH_STAT.BASE_RECOVER], v[TECH_STAT.CAPITAL_PROD]]).toEqual([1000, 1000, 1000]);
  });
});

describe('v4.6 선행·양자택일', () => {
  it('T4 는 T3A 또는 T3B 중 하나만 보유해도 열린다 (parentAlt)', () => {
    const only = (...codes: string[]) => codes.reduce((m, c) => techMaskWith(m, id(c)), 0);
    expect(techPrereqMet(only('ECO-1', 'ECO-2A', 'ECO-3A'), id('ECO-4'))).toBe(true);
    expect(techPrereqMet(only('ECO-1', 'ECO-2B', 'ECO-3B'), id('ECO-4'))).toBe(true);
    expect(techPrereqMet(only('ECO-1', 'ECO-2A'), id('ECO-4'))).toBe(false);
    expect(techPrereqMet(0, id('ECO-4'))).toBe(false);
  });
  it('재정·행정 T2 는 양자택일 — 상대 보유 시 EXCLUSIVE_BLOCKED, 자기 갈래만', () => {
    const only = (...codes: string[]) => codes.reduce((m, c) => techMaskWith(m, id(c)), 0);
    expect(techExclusiveBlocker(only('ECO-1', 'ECO-2A'), id('ECO-2B'))).toBe(id('ECO-2A'));
    expect(techExclusiveBlocker(only('TER-1', 'TER-2B'), id('TER-2A'))).toBe(id('TER-2B'));
    expect(techExclusiveBlocker(only('MIL-1', 'MIL-2A'), id('MIL-2B'))).toBeNull(); // 군사는 둘 다 가능
    const sim = makeSim();
    const r = buyAll(sim, 1, ['ECO-1', 'ECO-2A', 'ECO-2B', 'TER-1', 'TER-2B', 'TER-2A', 'ECO-3B', 'ECO-3A', 'ECO-4']);
    expect(r.map((x) => x.reason ?? 'OK')).toEqual(['OK', 'OK', 'EXCLUSIVE_BLOCKED', 'OK', 'OK', 'EXCLUSIVE_BLOCKED', 'PREREQ_MISSING', 'OK', 'OK']);
    expect(techOwned(sim.state.players[1].techMask, id('ECO-2B'))).toBe(false);
    expect(sim.state.players[1].techPurchased).toBe(6);
  });
});

describe('v4.6 가격식 [A-69] — 4티어', () => {
  it('cost = floor(BASE[tier] × (1000 + 60n) / 1000) — n = 0 / 8 / 14', () => {
    expect([1, 2, 3, 4].map((t) => techNodeCost(t, 0))).toEqual([160, 360, 700, 1200]);
    expect([1, 2, 3, 4].map((t) => techNodeCost(t, 8))).toEqual([236, 532, 1036, 1776]);
    expect([1, 2, 3, 4].map((t) => techNodeCost(t, 14))).toEqual([294, 662, 1288, 2208]);
  });
  it('서버 구매 경로: 9번째(n=8) T3 = 1036, 15번째(n=14) T2 = 662 (갈래 무관 총 구매 수)', () => {
    const sim = makeSim();
    const eight = ['MIL-1', 'ECO-1', 'TER-1', 'MOB-1', 'SPE-1', 'SWO-1', 'CAV-1', 'MOB-2A'];
    const r = buyAll(sim, 1, [...eight, 'MOB-3A', 'ECO-2A', 'TER-2A', 'MIL-2A', 'MIL-2B', 'SPE-2A', 'SPE-2B']);
    expect(r.every((x) => x.accepted)).toBe(true);
    expect(r.map((x) => x.cost)).toEqual([160, 169, 179, 188, 198, 208, 217, 511, 1036, 554, 576, 597, 619, 640, 662]);
    expect(sim.state.players[1].techPurchased).toBe(15);
    expect(techNodeCost(1, sim.state.players[1].techPurchased)).toBe(304);
  });
});

describe('v4.6 구매 거절', () => {
  it('PREREQ_MISSING: 부모 미보유 (T2·T3) — 형제는 안 사도 된다', () => {
    const sim = makeSim();
    const r = buyAll(sim, 1, ['MIL-2A', 'MIL-3A', 'MIL-1', 'MIL-3A', 'MIL-2A', 'MIL-3A']);
    expect(r.map((x) => x.reason ?? 'OK')).toEqual(['PREREQ_MISSING', 'PREREQ_MISSING', 'OK', 'PREREQ_MISSING', 'OK', 'OK']);
    expect(sim.state.players[1].techMask).toBe(techMaskWith(techMaskWith(techMaskWith(0, id('MIL-1')), id('MIL-2A')), id('MIL-3A')));
  });
  it('ALREADY_OWNED: 이미 산 노드, 골드 차감 없음', () => {
    const sim = makeSim();
    buyAll(sim, 1, ['CAV-1']);
    const p = sim.state.players[1];
    p.goldMilli = 5_000_000;
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 99, nodeId: id('CAV-1') });
    const out = sim.step();
    expect(out.personal.find((x) => x.playerId === 1)!.msg).toMatchObject({ accepted: false, reason: 'ALREADY_OWNED' });
    expect(out.broadcast.some((m) => m.type === 'tech_purchased')).toBe(false);
    expect(p.techPurchased).toBe(1);
  });
  it('INSUFFICIENT: 골드 부족 · BAD_REQUEST: 범위 밖 nodeId (42)', () => {
    const sim = makeSim();
    sim.state.players[1].goldMilli = 159_999;
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, nodeId: 0 });
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 2, nodeId: 42 });
    const acks = sim.step().personal.map((x) => x.msg);
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 1, accepted: false, reason: 'INSUFFICIENT' });
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 2, accepted: false, reason: 'BAD_REQUEST' });
  });
});

describe('v4.6 효과 합산 [A-71] — 구매 순서 무관', () => {
  it('같은 노드 집합을 다른 순서로 사면 statPm·techMask 가 같다 (서버 경로)', () => {
    const set = ['MOB-1', 'CAV-1', 'MOB-2A', 'CAV-2A', 'CAV-3A', 'ECO-1', 'ECO-2B', 'SPE-1', 'SPE-2A', 'SPE-3B', 'TER-1', 'TER-2A'];
    const orders = [
      set,
      ['TER-1', 'SPE-1', 'ECO-1', 'CAV-1', 'MOB-1', 'TER-2A', 'SPE-2A', 'ECO-2B', 'CAV-2A', 'MOB-2A', 'SPE-3B', 'CAV-3A'],
      ['ECO-1', 'ECO-2B', 'SPE-1', 'SPE-2A', 'SPE-3B', 'CAV-1', 'CAV-2A', 'CAV-3A', 'MOB-1', 'MOB-2A', 'TER-1', 'TER-2A'],
    ];
    const res = orders.map((o) => {
      const sim = makeSim();
      expect(buyAll(sim, 1, o).every((x) => x.accepted)).toBe(true);
      const p = sim.state.players[1];
      return JSON.stringify([p.techMask, p.statPm]);
    });
    expect(new Set(res).size).toBe(1);
    const v = JSON.parse(res[0])[1] as number[];
    expect(v[TECH_STAT.SPEED] + v[TECH_STAT.SPEED_CAVALRY]).toBe(30); // MOB-1 + MOB-2A + CAV-1 (점수)
    expect(v[TECH_STAT.COMBAT_DEF] + v[TECH_STAT.COMBAT_DEF_SPEAR]).toBe(10); // SPE-1
    expect(v[TECH_STAT.SPEED_SPEAR]).toBe(10); // SPE-3B 행군 장화
    expect(v[TECH_STAT.NEUTRAL_COST]).toBe(860);
  });
  it('techStatValues 는 마스크만의 함수 (노드 하나만 있을 때 정확히 그 스탯 하나만 바뀐다)', () => {
    const base = techStatValues(0);
    for (const n of TECH_NODES) {
      const v = techStatValues(techMaskWith(0, n.id));
      expect(v[n.stat]).toBe(n.op === 'add' ? base[n.stat] + n.value : n.value);
      expect(v.filter((x, i) => x !== base[i]).length).toBe(1); // 노드당 스탯 하나
    }
  });
});

describe('v4.6 계산식 연결', () => {
  it('유지비: ECO-2B 계수 90 → 72, CAV-3A 기병 가중치 1600 → 1300, SPE-2A 창병 600 → 450', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const h = p.homeTileId;
    for (let i = 0; i < 3; i++) addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: h });
    expect(garrisonUpkeepPermille(s, p)).toBe(342);
    giveTech(p, 'ECO-1', 'ECO-2B');
    expect(garrisonUpkeepPermille(s, p)).toBe(273);
    giveTech(p, 'CAV-1', 'CAV-2A', 'CAV-3A');
    expect(garrisonUpkeepPermille(s, p)).toBe(261);
    giveTech(p, 'CAV-1', 'CAV-2A', 'CAV-3A', 'ECO-1', 'ECO-2B');
    expect(garrisonUpkeepPermille(s, p)).toBe(208);
    s.flags.length = 0;
    for (let i = 0; i < 4; i++) addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: h });
    giveTech(p);
    expect(garrisonUpkeepPermille(s, p)).toBe(126);
    giveTech(p, 'SPE-1', 'SPE-2A');
    expect(garrisonUpkeepPermille(s, p)).toBe(72);
  });
  it('유지비 감소가 실제 골드 정산에 들어간다 (같은 깃발, upkeepPm 낮음)', () => {
    const a = makeSim();
    const b = makeSim();
    for (const sim of [a, b]) for (let i = 0; i < 3; i++) addFlag(sim.state, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: sim.state.players[1].homeTileId });
    giveTech(b.state.players[1], 'ECO-1', 'ECO-2B');
    giveTech(a.state.players[1], 'ECO-1');
    a.step();
    b.step();
    expect(a.state.players[1].upkeepPm).toBe(342);
    expect(b.state.players[1].upkeepPm).toBe(273);
  });
  it('이동속도: 점수 가산 — 공통 MOB-1/2A + 병종 CAV-1 (평원, speedMilli = floor(140 × (UNIT + 10 × 점수) / 1000))', () => {
    const s = makeSim().state;
    const c = findOpenArea(s, 2);
    for (const t of s.graph.disk(c, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    const sw = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c });
    const cav = addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: c });
    const sp = addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: c });
    const p = s.players[1];
    const sp3 = () => [speedMilliAt(s, sw, c), speedMilliAt(s, cav, c), speedMilliAt(s, sp, c)];
    expect(sp3()).toEqual([140, 203, 105]);
    giveTech(p, 'MOB-1'); // +10점 = +100‰
    expect(sp3()).toEqual([154, 217, 119]);
    giveTech(p, 'MOB-1', 'MOB-2A', 'CAV-1'); // 공통 +20점, 기병 +30점
    expect(sp3()).toEqual([168, 245, 133]);
  });
  it('v4.5 MOB-2B 철수 훈련: 전투 중 회수 → 이탈 대기 10 tick (무테크 15)', () => {
    for (const [codes, expectTicks] of [[[], 15], [['MOB-1', 'MOB-2B'], 10]] as [string[], number][]) {
      const sim = makeSim();
      const s = sim.state;
      const p = s.players[2];
      giveTech(p, ...codes);
      const c = s.players[2].homeTileId;
      const x = s.graph.neighbors(c).find((t) => !s.map.isBase[t])!;
      setTileOwner(s, x, 1, false);
      addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: x, anchorTileId: c, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
      const d = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      sim.step();
      expect(d.inCombat).toBe(true);
      sim.enqueue(2, 2, { type: 'cmd_flag_recall', clientSeq: 1, flagId: d.id });
      const out = sim.step();
      const ev = out.broadcast.find((m) => m.type === 'flag_disengage_started') as { untilTick: number; tick: number } | undefined;
      expect(ev).toBeTruthy();
      expect(ev!.untilTick - ev!.tick).toBe(expectTicks);
    }
  });
  it('v4.5 MOB-3B 급속 귀환: 귀환 속도 ×1.5 → ×2.2 (행군 속도는 그대로)', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const pos = s.players[1].homeTileId;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos });
    const march = speedMilliAt(s, f, pos);
    f.state = 'RETURNING';
    const ret0 = speedMilliAt(s, f, pos);
    giveTech(p, 'MOB-1', 'MOB-2B', 'MOB-3B');
    f.state = 'MARCHING';
    const march1 = speedMilliAt(s, f, pos);
    f.state = 'RETURNING';
    const ret1 = speedMilliAt(s, f, pos);
    expect(Math.abs(ret0 - (march * 1500) / 1000)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(ret1 - (march1 * 2200) / 1000)).toBeLessThanOrEqual(2.2);
    expect(ret1 * 1000).toBeGreaterThan(ret0 * 1000 * 1.4);
    expect(march1).toBeGreaterThan(march);
  });
  it('슬롯: MOB-3A 로만 +1, 전부 사도 +1 (최대 +1)', () => {
    const p = makeSim().state.players[1];
    p.tiles = 390;
    expect(flagCap(p)).toBe(4);
    giveTech(p, 'MOB-1', 'MOB-2A', 'MOB-3A');
    expect(flagCap(p)).toBe(5);
    p.techMask = ALL;
    p.statPm = techStatValues(p.techMask);
    expect(flagCap(p)).toBe(5);
  });
  it('병력 재생: ECO-3B 곡창 (병력 상한 노드는 이번 개편에서 없음)', () => {
    const p = makeSim().state.players[1];
    p.tiles = 390;
    p.troopsMilli = 1000_000;
    const cap0 = troopCap(p);
    const r0 = regenMilliPerTick(p);
    giveTech(p, 'ECO-1', 'ECO-2B', 'ECO-3B');
    expect(troopCap(p)).toBe(cap0);
    expect(regenMilliPerTick(p)).toBeGreaterThan(r0);
  });
  it('점령비용: MIL-1·MIL-2A(공격자), MIL-2B(방어자), TER-1/2A(중립), SWO-2B(검병), TER-3A 보급선', () => {
    const s = makeSim().state;
    const c = findOpenArea(s, 2);
    for (const t of s.graph.disk(c, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    const sw = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c });
    const X = c + 1;
    const neutral0 = tileCost(s, sw, X);
    giveTech(s.players[1], 'TER-1', 'TER-2A');
    expect(tileCost(s, sw, X)).toBeLessThan(neutral0);
    giveTech(s.players[1]);
    setTileOwner(s, X, 2, false);
    const enemy0 = tileCost(s, sw, X);
    giveTech(s.players[1], 'MIL-1', 'MIL-2A', 'MIL-3A');
    const enemyAtk = tileCost(s, sw, X);
    giveTech(s.players[1], 'MIL-1', 'MIL-2A', 'MIL-3A', 'SWO-1', 'SWO-2B');
    const enemySwo = tileCost(s, sw, X);
    giveTech(s.players[2], 'MIL-1', 'MIL-2B');
    const enemyDef = tileCost(s, sw, X);
    expect(enemyAtk).toBeLessThan(enemy0);
    expect(enemySwo).toBeLessThanOrEqual(enemyAtk);
    expect(enemyDef).toBeGreaterThanOrEqual(enemySwo);
    const p = s.players[1];
    const dOf = (t: number) => Math.min(...p.baseTiles.map((b) => s.graph.distance(b, t)));
    const far = s.owners.findIndex((_, t) => dOf(t) >= 21 && dOf(t) <= 40);
    const d = dOf(far);
    giveTech(p);
    expect(supplyPermille(s, p, far)).toBe(1000 + 20 * (d - 10));
    giveTech(p, 'TER-1', 'TER-2A', 'TER-3A');
    expect(supplyPermille(s, p, far)).toBe(1000 + 15 * (d - 10));
  });
  it('깃발 전투값(모델 1): 병종 기본 ‰ + 10‰ × 점수 — 공격 태세 COMBAT_ATK+병종, 방어 태세 COMBAT_DEF+병종', () => {
    const s = makeSim().state;
    const c = findOpenArea(s, 2);
    for (const t of s.graph.disk(c, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    const att = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c, posture: POSTURE.ATTACK });
    const def = addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: c, posture: POSTURE.DEFEND });
    const p = s.players[1];
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1000, 1300]);
    giveTech(p, 'MIL-1', 'SWO-1'); // 공격 +10 +10 = +20점
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1200, 1300]); // 방어 불변
    giveTech(p, 'MIL-1', 'MIL-2B', 'MIL-3B', 'SPE-1', 'SPE-2B'); // 방어 +20(공통) +20(창병) = +40점, 공격 +10
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1100, 1700]);
  });
  it('편성비: 기병 1.30 → CAV-2A 1.20 (풀 차감, 병종 기본은 창 0.9 / 검 1.0 / 기 1.3)', () => {
    const sim = makeSim();
    const p = sim.state.players[1];
    const L = sim.state.ledger;
    p.troopsMilli = 200_000;
    const c0 = L.conversion;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.CAVALRY, troops: 100, anchorTileId: p.homeTileId, originBaseTileId: null });
    sim.step();
    expect(L.conversion - c0).toBe(30_000);
    giveTech(p, 'CAV-1', 'CAV-2A');
    p.troopsMilli = 200_000;
    const c1 = L.conversion;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 2, unit: UNIT.CAVALRY, troops: 100, anchorTileId: p.homeTileId, originBaseTileId: null });
    sim.step();
    expect(L.conversion - c1).toBe(20_000);
  });
});

describe('v4.6 기지 효과 (행정 갈래)', () => {
  it('요새화 TER-2B: 기지 체력 피해(와 tick 당 피해 상한)가 20% 줄어든다', () => {
    const lossWith = (codes: string[]) => {
      const sim = makeSim();
      const s = sim.state;
      const B = s.players[2].homeTileId;
      giveTech(s.players[2], ...codes);
      const around = s.graph.neighbors(B).filter((t) => isClaimable(s.map.terrain[t]));
      for (const t of around) setTileOwner(s, t, 1, false);
      addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 2000, pos: around[0], anchorTileId: B, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 750_000 });
      const base = s.bases[s.baseIndexOf.get(B)!];
      const hp0 = base.hpMilli;
      for (let i = 0; i < 10; i++) sim.step();
      return hp0 - base.hpMilli;
    };
    const plain = lossWith([]);
    const fort = lossWith(['TER-1', 'TER-2B']);
    expect(plain).toBeGreaterThan(0);
    expect(fort).toBeLessThan(plain);
    expect(fort).toBeLessThanOrEqual(Math.floor(plain * 0.85));
    expect(fort).toBeGreaterThan(0);
  });
  it('기지 재건 TER-3B: 함락 뒤 생산력 회복이 1.5배 빠르다', () => {
    const recovered = (codes: string[]) => {
      const sim = makeSim();
      const s = sim.state;
      const p = s.players[1];
      giveTech(p, ...codes);
      const b = s.bases[s.baseIndexOf.get(p.homeTileId)!];
      b.prodScaled = 300 * 400; // 생산력 40%
      for (let i = 0; i < 20; i++) sim.step();
      return b.prodScaled - 300 * 400;
    };
    const base = recovered([]);
    const fast = recovered(['TER-1', 'TER-2B', 'TER-3B']);
    expect(base).toBe(20 * 167);
    expect(fast).toBe(20 * Math.floor((167 * 1500) / 1000));
  });
  it('수도 승격 TER-4: 수도 기지의 환산 칸이 100 → 130 (일반 기지 60 그대로)', () => {
    const s = makeSim().state;
    const p = s.players[1];
    expect(baseEqTiles(s, p.homeTileId)).toBe(100);
    giveTech(p, 'TER-1', 'TER-2A', 'TER-3A', 'TER-4');
    expect(baseEqTiles(s, p.homeTileId)).toBe(130);
    const other = s.players[2];
    expect(baseEqTiles(s, other.homeTileId)).toBe(100); // 다른 사람의 수도는 그 사람 테크 기준
  });
});

describe('v4.6 프로토콜·봇', () => {
  it('snapshot_full.players[].techMask/techCount, snapshot_delta.playerDeltas[].techMask, match_config.constants.TECH_NODES', () => {
    const sim = makeSim();
    expect((buildMatchConfig(sim.state).constants as Record<string, unknown>).TECH_NODES).toEqual(TECH_NODES);
    buyAll(sim, 1, ['CAV-1']);
    let full: S2C_SnapshotFull | undefined;
    let delta: S2C_SnapshotDelta | undefined;
    for (let i = 0; i < 30 && !full; i++)
      for (const m of sim.step().broadcast) {
        if (m.type === 'snapshot_full') full = m;
        if (m.type === 'snapshot_delta' && m.playerDeltas.some((d) => d.id === 1)) delta ??= m;
      }
    const mask = 2 ** id('CAV-1');
    expect(full!.players.find((x) => x.id === 1)).toMatchObject({ techMask: mask, techCount: 1 });
    expect(delta!.playerDeltas.find((d) => d.id === 1)!.techMask).toBe(mask);
  });
  it('53비트 마스크가 JSON 왕복에서 정수 그대로다 (노드 41 보유)', () => {
    const mask = techMaskWith(techMaskWith(0, 41), 33);
    expect(JSON.parse(JSON.stringify({ techMask: mask })).techMask).toBe(mask);
    expect(techCount(mask)).toBe(2);
  });
  it('봇 목록: 4종, 부모가 앞, 양자택일 상대 없음, EASY(검 고정) 목록엔 기병 노드 없음', () => {
    for (const l of [...TECH_PRIORITY, ...TECH_PRIORITY_SWORD]) {
      expect(l.length).toBeGreaterThanOrEqual(16);
      let m = 0;
      for (const n of l) {
        expect(techPrereqMet(m, n)).toBe(true);
        expect(techExclusiveBlocker(m, n)).toBeNull();
        m = techMaskWith(m, n);
      }
    }
    for (const l of TECH_PRIORITY_SWORD) expect(l.some((n) => TECH_NODES[n].code.startsWith('CAV'))).toBe(false);
    expect(TECH_PRIORITY[3].slice(0, 4).map((n) => TECH_NODES[n].code)).toEqual(['MOB-1', 'CAV-1', 'MOB-2A', 'CAV-2B']);
    expect(TECH_PRIORITY_SWORD[3].slice(0, 4).map((n) => TECH_NODES[n].code)).toEqual(['MOB-1', 'SWO-1', 'MOB-2A', 'SWO-2A']);
  });
});
