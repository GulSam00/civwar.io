/**
 * 테크 v4.3 (01b_tech-tree-v4.3-proposal.md, 사용자 승인 2026-10-11) — 노드 표·가격식·합산·계산식 연결·프로토콜.
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
  techStatValues,
  type C2S_GameCommand,
  type S2C_SnapshotDelta,
  type S2C_SnapshotFull,
} from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { flagValue } from '../src/game/combat.js';
import { flagCap, garrisonUpkeepPermille, regenMilliPerTick, troopCap } from '../src/game/economy.js';
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

describe('v4.3 노드 표', () => {
  it('32노드 · 갈래 7 · 부모 = 같은 갈래 한 티어 아래 · 비트마스크 uint32', () => {
    expect(TECH_NODES.length).toBe(TECH_NODE_COUNT);
    expect(TECH_NODE_COUNT).toBe(32);
    expect(new Set(TECH_NODES.map((n) => n.branch)).size).toBe(7);
    expect(TECH_NODES.filter((n) => n.tier === 1).every((n) => n.parent === null)).toBe(true);
    const all = TECH_NODES.reduce((m, n) => techMaskWith(m, n.id), 0);
    expect(all).toBe(0xffffffff);
    expect(techCount(all)).toBe(32);
    expect(techMaskWith(0, 31)).toBe(2 ** 31); // 비트 31 도 양수
  });
  it('노드 스탯 매핑 (표 2.3 그대로)', () => {
    const s = (c: string) => TECH_NODES[id(c)];
    expect(s('SPE-1')).toMatchObject({ stat: TECH_STAT.COMBAT_DEF_SPEAR, op: 'add', value: 50 });
    expect(s('SPE-2A')).toMatchObject({ stat: TECH_STAT.UPKEEP_WEIGHT_SPEAR, op: 'set', value: 450 });
    expect(s('SWO-2B')).toMatchObject({ stat: TECH_STAT.CAPTURE_MULT_SWORD, op: 'set', value: 950 });
    expect(s('CAV-2A')).toMatchObject({ stat: TECH_STAT.CONVERT_CAVALRY, op: 'set', value: 1070 });
    expect(s('CAV-3')).toMatchObject({ stat: TECH_STAT.UPKEEP_WEIGHT_CAVALRY, op: 'set', value: 1300 });
    // v4.5 (01c 승인): 조선술·상륙정 → 철수 훈련(이탈 대기 15 → 10)·급속 귀환(귀환 ×1.5 → ×2.2). id·부모·스탯 칸(11·13) 유지
    expect(s('MOB-2B')).toMatchObject({ id: 17, parent: 15, stat: TECH_STAT.DISENGAGE_TICKS, op: 'set', value: 10, name: '철수 훈련' });
    expect(s('MOB-3B')).toMatchObject({ id: 19, parent: 17, stat: TECH_STAT.RETURN_SPEED, op: 'set', value: 2200, name: '급속 귀환' });
    expect(s('MIL-2A')).toMatchObject({ stat: TECH_STAT.COMBAT_ATK, value: 30 });
    expect(s('MIL-3B')).toMatchObject({ stat: TECH_STAT.COMBAT_DEF, value: 40 });
  });
  it('전부 보유 시 스탯 최대치 (01b 2.4)', () => {
    const v = techStatValues(0xffffffff);
    expect(v[TECH_STAT.ATK_COST]).toBe(910);
    expect(v[TECH_STAT.DEF_COST]).toBe(1060);
    expect(v[TECH_STAT.GOLD]).toBe(1300);
    expect(v[TECH_STAT.REGEN]).toBe(1060);
    expect(v[TECH_STAT.NEUTRAL_COST]).toBe(860);
    expect(v[TECH_STAT.TROOP_CAP]).toBe(1140);
    expect(v[TECH_STAT.SPEED]).toBe(1300);
    expect(v[TECH_STAT.SLOT_BONUS]).toBe(1); // [A-74] 최대 +1
    expect(v[TECH_STAT.DISENGAGE_TICKS]).toBe(10); // v4.5 철수 훈련
    expect(v[TECH_STAT.RETURN_SPEED]).toBe(2200); // v4.5 급속 귀환
    expect(v[TECH_STAT.UPKEEP_COEF]).toBe(72);
    expect(v[TECH_STAT.SUPPLY_COEF]).toBe(15);
  });
});

describe('v4.3 가격식 [A-69]', () => {
  it('cost = floor(BASE[tier] × (1000 + 60n) / 1000) — n = 0 / 8 / 14', () => {
    expect([1, 2, 3].map((t) => techNodeCost(t, 0))).toEqual([160, 360, 700]);
    expect([1, 2, 3].map((t) => techNodeCost(t, 8))).toEqual([236, 532, 1036]);
    expect([1, 2, 3].map((t) => techNodeCost(t, 14))).toEqual([294, 662, 1288]);
  });
  it('서버 구매 경로: 9번째(n=8) T3 = 1036, 15번째(n=14) T1 = 294 (갈래 무관 총 구매 수)', () => {
    const sim = makeSim();
    const eight = ['MIL-1', 'ECO-1', 'TER-1', 'MOB-1', 'SPE-1', 'SWO-1', 'CAV-1', 'MOB-2A'];
    const r = buyAll(sim, 1, [...eight, 'MOB-3A', 'ECO-2A', 'ECO-2B', 'TER-2A', 'TER-2B', 'MIL-2A', 'SPE-2A']);
    expect(r.every((x) => x.accepted)).toBe(true);
    expect(r.map((x) => x.cost)).toEqual([160, 169, 179, 188, 198, 208, 217, 511, 1036, 554, 576, 597, 619, 640, 662]);
    expect(sim.state.players[1].techPurchased).toBe(15);
    // n = 15: T1 = floor(160 × 1.90) = 304
    expect(techNodeCost(1, sim.state.players[1].techPurchased)).toBe(304);
  });
});

describe('v4.3 구매 거절', () => {
  it('PREREQ_MISSING: 부모 미보유 (T2·T3) — 형제는 안 사도 된다', () => {
    const sim = makeSim();
    const r = buyAll(sim, 1, ['MIL-2A', 'MIL-3A', 'MIL-1', 'MIL-3A', 'MIL-2A', 'MIL-3A']);
    expect(r.map((x) => x.reason ?? 'OK')).toEqual(['PREREQ_MISSING', 'PREREQ_MISSING', 'OK', 'PREREQ_MISSING', 'OK', 'OK']);
    // MIL-2B 는 사지 않았다 — MIL-3A 는 MIL-2A 만 필요
    expect(sim.state.players[1].techMask).toBe((1 << id('MIL-1')) | (1 << id('MIL-2A')) | (1 << id('MIL-3A')));
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
  it('INSUFFICIENT: 골드 부족 (기존 코드 재사용) · BAD_REQUEST: 범위 밖 nodeId', () => {
    const sim = makeSim();
    sim.state.players[1].goldMilli = 159_999;
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, nodeId: 0 });
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 2, nodeId: 32 });
    const acks = sim.step().personal.map((x) => x.msg);
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 1, accepted: false, reason: 'INSUFFICIENT' });
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 2, accepted: false, reason: 'BAD_REQUEST' });
  });
});

describe('v4.3 효과 합산 [A-71] — 구매 순서 무관', () => {
  it('같은 노드 집합을 다른 순서로 사면 statPm·techMask 가 같다 (서버 경로)', () => {
    const set = ['MOB-1', 'CAV-1', 'MOB-2A', 'CAV-2A', 'CAV-3', 'ECO-1', 'ECO-2B', 'SPE-1', 'SPE-2A', 'SPE-3', 'TER-1', 'TER-2A'];
    const orders = [
      set,
      ['TER-1', 'SPE-1', 'ECO-1', 'CAV-1', 'MOB-1', 'TER-2A', 'SPE-2A', 'ECO-2B', 'CAV-2A', 'MOB-2A', 'SPE-3', 'CAV-3'],
      ['ECO-1', 'ECO-2B', 'SPE-1', 'SPE-2A', 'SPE-3', 'CAV-1', 'CAV-2A', 'CAV-3', 'MOB-1', 'MOB-2A', 'TER-1', 'TER-2A'],
    ];
    const res = orders.map((o) => {
      const sim = makeSim();
      expect(buyAll(sim, 1, o).every((x) => x.accepted)).toBe(true);
      const p = sim.state.players[1];
      return JSON.stringify([p.techMask, p.statPm]);
    });
    expect(new Set(res).size).toBe(1);
    const v = JSON.parse(res[0])[1] as number[];
    expect(v[TECH_STAT.SPEED] + v[TECH_STAT.SPEED_CAVALRY]).toBe(1400); // MOB-1 + MOB-2A + CAV-1
    expect(v[TECH_STAT.COMBAT_DEF] + v[TECH_STAT.COMBAT_DEF_SPEAR]).toBe(1100); // SPE-1 + SPE-3
    expect(v[TECH_STAT.NEUTRAL_COST]).toBe(860);
  });
  it('techStatValues 는 마스크만의 함수 (모든 부분집합에서 증분이 더해진다)', () => {
    const base = techStatValues(0);
    for (const n of TECH_NODES) {
      const v = techStatValues(1 << n.id);
      expect(v[n.stat]).toBe(n.op === 'add' ? base[n.stat] + n.value : n.value);
      expect(v.filter((x, i) => x !== base[i]).length).toBe(1); // 노드당 스탯 하나
    }
  });
});

describe('v4.3 계산식 연결', () => {
  it('유지비: ECO-2B 계수 90 → 72, CAV-3 기병 가중치 1600 → 1300, SPE-2A 창병 600 → 450', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const h = p.homeTileId;
    for (let i = 0; i < 3; i++) addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: h });
    expect(garrisonUpkeepPermille(s, p)).toBe(342); // (4800 − 1000) × 90 / 1000
    giveTech(p, 'ECO-1', 'ECO-2B');
    expect(garrisonUpkeepPermille(s, p)).toBe(273); // 3800 × 72 / 1000 = 273.6
    giveTech(p, 'CAV-1', 'CAV-2A', 'CAV-3');
    expect(garrisonUpkeepPermille(s, p)).toBe(261); // (3900 − 1000) × 90 / 1000
    giveTech(p, 'CAV-1', 'CAV-2A', 'CAV-3', 'ECO-1', 'ECO-2B');
    expect(garrisonUpkeepPermille(s, p)).toBe(208); // 2900 × 72 / 1000 = 208.8
    s.flags.length = 0;
    for (let i = 0; i < 4; i++) addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: h });
    giveTech(p);
    expect(garrisonUpkeepPermille(s, p)).toBe(126); // (2400 − 1000) × 90 / 1000
    giveTech(p, 'SPE-1', 'SPE-2A');
    expect(garrisonUpkeepPermille(s, p)).toBe(72); // (1800 − 1000) × 90 / 1000
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
  it('이동속도: MOB-1/2A 공통 + CAV-1·SPE-2B 병종 (평원, speedMilli = floor(140 × UNIT × speedPm / 10⁶))', () => {
    const s = makeSim().state;
    const c = findOpenArea(s, 2);
    for (const t of s.graph.disk(c, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    const sw = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c });
    const cav = addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 100, pos: c });
    const sp = addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: c });
    const p = s.players[1];
    const sp3 = () => [speedMilliAt(s, sw, c), speedMilliAt(s, cav, c), speedMilliAt(s, sp, c)];
    expect(sp3()).toEqual([140, 203, 105]);
    giveTech(p, 'MOB-1');
    expect(sp3()).toEqual([161, 233, 120]);
    giveTech(p, 'MOB-1', 'MOB-2A', 'CAV-1', 'SPE-1', 'SPE-2B');
    expect(sp3()).toEqual([182, 284, 147]); // ×1.30 / ×1.40 / ×1.40
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
    // 같은 floor 안에서 곱하므로 floor(행군 × 배율) 과 최대 1 차이 (milli)
    expect(Math.abs(ret0 - (march * 1500) / 1000)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(ret1 - (march1 * 2200) / 1000)).toBeLessThanOrEqual(2.2);
    expect(ret1 * 1000).toBeGreaterThan(ret0 * 1000 * 1.4);
    expect(march1).toBeGreaterThan(march); // MOB-1 행군로 +15% 만큼
  });
  it('슬롯: MOB-3A 로만 +1, 전부 사도 +1 (최대 +1)', () => {
    const p = makeSim().state.players[1];
    p.tiles = 390;
    expect(flagCap(p)).toBe(4);
    giveTech(p, 'MOB-1', 'MOB-2A', 'MOB-3A');
    expect(flagCap(p)).toBe(5);
    p.techMask = 0xffffffff;
    p.statPm = techStatValues(p.techMask);
    expect(flagCap(p)).toBe(5);
  });
  it('병력 상한·재생: TER-2B/3B, ECO-3B', () => {
    const p = makeSim().state.players[1];
    p.tiles = 390;
    p.troopsMilli = 1000_000;
    const cap0 = troopCap(p);
    const r0 = regenMilliPerTick(p);
    giveTech(p, 'TER-1', 'TER-2B', 'TER-3B', 'ECO-1', 'ECO-2B', 'ECO-3B');
    expect(troopCap(p)).toBe(Math.floor((cap0 * 1140) / 1000));
    expect(regenMilliPerTick(p)).toBeGreaterThan(r0);
  });
  it('점령비용: MIL-1·MIL-3A(공격자), MIL-2B(방어자), TER-1/2A(중립), SWO-2B(검병), TER-3A 보급선', () => {
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
    // 보급선: 기지에서 21~40 칸 떨어진 칸 (상한 1600 에 안 닿는 거리)
    const p = s.players[1];
    const dOf = (t: number) => Math.min(...p.baseTiles.map((b) => s.graph.distance(b, t)));
    const far = s.owners.findIndex((_, t) => dOf(t) >= 21 && dOf(t) <= 40);
    const d = dOf(far);
    giveTech(p);
    expect(supplyPermille(s, p, far)).toBe(1000 + 20 * (d - 10));
    giveTech(p, 'TER-1', 'TER-2A', 'TER-3A');
    expect(supplyPermille(s, p, far)).toBe(1000 + 15 * (d - 10));
  });
  it('깃발 전투값: 공격 태세 = MIL-2A + 병종 ATK, 방어 태세 = MIL-3B + 병종 DEF (태세별로 나뉜다)', () => {
    const s = makeSim().state;
    const c = findOpenArea(s, 2);
    for (const t of s.graph.disk(c, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    const att = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: c, posture: POSTURE.ATTACK });
    const def = addFlag(s, { ownerId: 1, unit: UNIT.SPEAR, troops: 100, pos: c, posture: POSTURE.DEFEND });
    const p = s.players[1];
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1000, 1300]);
    giveTech(p, 'MIL-1', 'MIL-2A', 'SWO-1', 'SWO-2B', 'SWO-3');
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1140, 1300]); // 1000 × 1.14, 방어 불변
    giveTech(p, 'MIL-1', 'MIL-2B', 'MIL-3B', 'SPE-1', 'SPE-2A', 'SPE-3');
    expect([flagValue(s, att, [att]), flagValue(s, def, [def])]).toEqual([1000, 1482]); // 1300 × 1.14
  });
  it('편성비: CAV-2A 기병 1.15 → 1.07 (풀 차감)', () => {
    const sim = makeSim();
    const p = sim.state.players[1];
    const L = sim.state.ledger;
    p.troopsMilli = 200_000;
    const c0 = L.conversion;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.CAVALRY, troops: 100, anchorTileId: p.homeTileId, originBaseTileId: null });
    sim.step();
    expect(L.conversion - c0).toBe(15_000); // 풀 차감 115
    giveTech(p, 'CAV-1', 'CAV-2A');
    p.troopsMilli = 200_000;
    const c1 = L.conversion;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 2, unit: UNIT.CAVALRY, troops: 100, anchorTileId: p.homeTileId, originBaseTileId: null });
    sim.step();
    expect(L.conversion - c1).toBe(7_000); // 풀 차감 107
  });
});

describe('v4.3 프로토콜·봇', () => {
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
    const mask = 1 << id('CAV-1');
    expect(full!.players.find((x) => x.id === 1)).toMatchObject({ techMask: mask, techCount: 1 });
    expect(delta!.playerDeltas.find((d) => d.id === 1)!.techMask).toBe(mask);
  });
  it('봇 목록: 4종 × 16, 부모가 앞, EASY(검 고정) 목록엔 기병 노드 없음', () => {
    for (const l of [...TECH_PRIORITY, ...TECH_PRIORITY_SWORD]) {
      expect(l.length).toBe(16);
      let m = 0;
      for (const n of l) {
        const par = TECH_NODES[n].parent;
        expect(par === null || ((m >>> par) & 1) === 1).toBe(true);
        m = techMaskWith(m, n);
      }
    }
    for (const l of TECH_PRIORITY_SWORD) expect(l.some((n) => TECH_NODES[n].code.startsWith('CAV'))).toBe(false);
    expect(TECH_PRIORITY[3].slice(0, 4).map((n) => TECH_NODES[n].code)).toEqual(['MOB-1', 'CAV-1', 'MOB-2A', 'CAV-2B']);
    expect(TECH_PRIORITY_SWORD[3].slice(0, 4).map((n) => TECH_NODES[n].code)).toEqual(['MOB-1', 'SWO-1', 'MOB-2A', 'SWO-2A']);
  });
});
