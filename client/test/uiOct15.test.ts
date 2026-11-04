/**
 * v4.5 (프로토콜 §22, 2026-10-15) 클라이언트 반영:
 *  틱당 전투 손실 숫자(합산·스로틀·상한) · 생산 hover(기지 행 + 영토 행) · 방어 태세 경로(적 땅 회피·멈춤 칸) ·
 *  물 통행 불가 경로 · flag_idle unreachable 피드/태그 · 테크 17·19 상세 행
 */
import { describe, expect, it } from 'vitest';
import { DISENGAGE_TICKS, POSTURE, TECH_NODES, type ProductionRow, type S2C_MatchConfig } from '@civwar/shared';
import { AGG_MS, BUSY_FLAGS, FLOAT_LIFE_MS, LossFloaters, MAX_LIVE, MAX_PER_FLAG, floatAnim, lossText } from '../src/render/lossFloaters.js';
import { productionRows, sumRows } from '../src/ui/production.js';
import { computeRoute, moveField, walkPath } from '../src/input/route.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameModel } from '../src/state/gameModel.js';
import { describeEvent } from '../src/state/feed.js';
import { techDetailRows } from '../src/ui/techTree.js';

// ───────────── 1. 틱당 전투 손실 숫자 ─────────────

describe('§22.3 틱당 전투 손실 −n — 합산·스로틀·상한', () => {
  it('평소: 깃발별 숫자, 합산 창(2 tick)이 지나면 새 숫자', () => {
    const lf = new LossFloaters();
    lf.ingest(10, [[14, 4500], [22, 4500]], 0);
    lf.ingest(12, [[14, 4400]], 400);
    const a = lf.active(400);
    expect(a.map((f) => [f.flagId, f.milli])).toEqual([
      [14, 4500],
      [22, 4500],
      [14, 4400],
    ]);
    expect(a[0].seq).toBe(1);
    expect(a[2].seq).toBe(2);
  });

  it('바로 다음 tick(0.2초)은 같은 숫자에 더한다 — 한 깃발 위에 숫자가 쌓이지 않게', () => {
    const lf = new LossFloaters();
    lf.ingest(10, [[14, 4500]], 0);
    lf.ingest(11, [[14, 4400]], 200);
    expect(lf.active(200).map((f) => f.milli)).toEqual([8900]);
  });

  it(`깃발당 떠 있는 숫자 최대 ${MAX_PER_FLAG}개 — 오래된 것부터 버린다`, () => {
    const lf = new LossFloaters();
    for (let i = 0; i < 5; i++) lf.ingest(10 + 2 * i, [[14, 1000 * (i + 1)]], i * 400);
    const a = lf.active(1600);
    expect(a.filter((f) => f.flagId === 14).map((f) => f.milli)).toEqual([4000, 5000]);
  });

  it('같은 tick 을 두 번 넣어도 한 번만 (렌더 프레임마다 불러도 된다)', () => {
    const lf = new LossFloaters();
    lf.ingest(10, [[14, 4500]], 0);
    lf.ingest(10, [[14, 4500]], 16);
    expect(lf.active(16)).toHaveLength(1);
  });

  it('합산: 합산 창 안에 들어온 같은 깃발 손실은 한 숫자에 더한다', () => {
    const lf = new LossFloaters();
    lf.ingest(10, [[14, 4500]], 0);
    lf.ingest(11, [[14, 4000]], AGG_MS - 10);
    const a = lf.active(AGG_MS);
    expect(a).toHaveLength(1);
    expect(a[0].milli).toBe(8500);
  });

  it('스로틀: 교전 깃발이 많으면(busy) 합산 창이 길어진다 — 0.6초 뒤 tick 도 같은 숫자에 합쳐진다', () => {
    const lf = new LossFloaters();
    const many = (k: number) => Array.from({ length: BUSY_FLAGS + 1 }, (_, i) => [i + 1, k] as [number, number]);
    lf.ingest(10, many(1000), 0);
    lf.ingest(13, many(1000), 600);
    const a = lf.active(600);
    expect(a).toHaveLength(BUSY_FLAGS + 1);
    expect(a.every((f) => f.milli === 2000)).toBe(true);
  });

  it(`상한 ${MAX_LIVE}개: 넘치면 중요한(내·선택) 깃발 → 손실 큰 깃발 순으로 남긴다`, () => {
    const lf = new LossFloaters();
    const losses: [number, number][] = Array.from({ length: MAX_LIVE + 10 }, (_, i) => [i + 1, 1000 + i]);
    lf.ingest(10, losses, 0, (id) => id === 1);
    const a = lf.active(0);
    expect(a).toHaveLength(MAX_LIVE);
    expect(a.some((f) => f.flagId === 1 && f.important)).toBe(true); // 손실이 가장 작아도 중요하면 남는다
    expect(a.some((f) => f.flagId === 2)).toBe(false); // 작은 손실부터 버려진다
    expect(a.some((f) => f.flagId === MAX_LIVE + 10)).toBe(true);
  });

  it('수명이 지나면 사라지고, 사라진 깃발은 정리된다', () => {
    const lf = new LossFloaters();
    lf.ingest(10, [[14, 4500], [22, 4500]], 0);
    lf.retain((id) => id !== 22);
    expect(lf.active(10).map((f) => f.flagId)).toEqual([14]);
    expect(lf.active(FLOAT_LIFE_MS)).toHaveLength(0);
  });

  it('표시 문자열·애니메이션: 소수 1자리, 100 이상 정수, 올라가며 사라짐', () => {
    expect(lossText(4500)).toBe('−4.5');
    expect(lossText(1000)).toBe('−1.0');
    expect(lossText(123456)).toBe('−123');
    expect(floatAnim(0).dy).toBe(-0);
    expect(floatAnim(1).alpha).toBe(0);
    expect(floatAnim(0.5).alpha).toBe(1);
    expect(floatAnim(1).dy).toBeLessThan(floatAnim(0.3).dy);
  });
});

// ───────────── 2. 생산 hover ─────────────

describe('§22.5 생산 hover — 기지 행 + 영토 행 1개', () => {
  // 프로토콜 §22.5 예시 그대로
  const rows: ProductionRow[] = [
    { kind: 'base', baseTileId: 1290, tiles: 100, prodPm: 1000, troopsPerSecMilli: 11850, goldGrossPerSecMilli: 1040, goldNetPerSecMilli: 780 },
    { kind: 'base', baseTileId: 2412, tiles: 60, prodPm: 500, troopsPerSecMilli: 3550, goldGrossPerSecMilli: 310, goldNetPerSecMilli: 232 },
    { kind: 'territory', baseTileId: null, tiles: 412, prodPm: 1000, troopsPerSecMilli: 47100, goldGrossPerSecMilli: 4120, goldNetPerSecMilli: 3090 },
  ];
  const names: Record<number, string> = { 1290: '알더미어', 2412: '레이븐홀트' };

  it('기지 행(지명·생산력 %·환산 칸 60/100) + 영토 행(실제 칸, 생산력 없음) — "기타" 없음', () => {
    const r = productionRows(rows, 'troops', (t) => names[t], (t) => t === 1290);
    expect(r.map((x) => [x.kind, x.label, x.prodPct, x.tiles, x.capital ?? false])).toEqual([
      ['base', '알더미어', 100, 100, true],
      ['base', '레이븐홀트', 50, 60, false],
      ['territory', '영토', null, 412, false],
    ]);
    expect(r.some((x) => x.label === '기타')).toBe(false);
  });

  it('행 합 = 총합 (병력·순골드)', () => {
    const tot = sumRows(rows);
    const tr = productionRows(rows, 'troops', (t) => names[t]);
    const gd = productionRows(rows, 'gold', (t) => names[t]);
    expect(tr.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(tot.troopsMilli / 1000, 9);
    expect(gd.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(tot.netMilli / 1000, 9);
    expect(tot.troopsMilli).toBe(62500);
  });

  it('기지가 없으면 영토 행 하나, 영토 칸이 없으면 기지 행만', () => {
    expect(productionRows([rows[2]], 'gold', () => undefined).map((x) => x.label)).toEqual(['영토']);
    expect(productionRows([rows[0]], 'gold', () => undefined).map((x) => x.kind)).toEqual(['base']);
  });
});

// ───────────── 3·4. 경로: 물 통행 불가 · 방어 태세 적 땅 회피 ─────────────

const W = 10;
const H = 6;
const id = (r: number, c: number) => r * W + c;
const LAND = 1;
const DEEP = 0;
const SHALLOW = 6;

function model(terrain: number[], owners: number[]): GameModel {
  const cfg = {
    type: 'match_config', seed: 1, topology: 'square', width: W, height: H, totalLandTiles: W * H, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  } as unknown as S2C_MatchConfig;
  const g = new GameModel(cfg);
  g.terrain = Uint8Array.from(terrain);
  g.owners = Uint8Array.from(owners);
  g.ready = true;
  return g;
}
const grid = (f: (r: number, c: number) => number) => {
  const a: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) a.push(f(r, c));
  return a;
};

describe('§22.1 물은 통행 불가 — 경로 미리보기', () => {
  const topo = createTopologyView('square', W, H);

  it('얕은 물(호수)도 깊은 물처럼 지나가지 않는다 — 막힌 열이면 도달 불가', () => {
    const t = grid((_, c) => (c === 5 ? SHALLOW : LAND));
    const f = moveField(topo, t, id(2, 8));
    expect(walkPath(topo, t, f, id(2, 2), id(2, 8)).at(-1)).not.toBe(id(2, 8));
    expect(f[id(2, 2)]).toBe(0x7fffffff);
  });

  it('호수에 틈이 있으면 돌아간다 — 경로에 물 칸이 없다', () => {
    const t = grid((r, c) => (c === 5 && r <= 3 ? SHALLOW : LAND));
    const f = moveField(topo, t, id(1, 8));
    const p = walkPath(topo, t, f, id(1, 2), id(1, 8));
    expect(p.at(-1)).toBe(id(1, 8));
    expect(p.some((x) => t[x] === SHALLOW || t[x] === DEEP)).toBe(false);
    expect(p).toContain(id(4, 5)); // 틈(4·5행)으로
  });

  it('물 앵커 = 전부 도달 불가', () => {
    const t = grid((r, c) => (r === 0 && c === 0 ? DEEP : LAND));
    const f = moveField(topo, t, id(0, 0));
    expect(Array.from(f).every((d) => d === 0x7fffffff)).toBe(true);
  });
});

describe('§22.12 방어 태세 경로 — 적 땅 회피, 막히면 앞에서 멈춤', () => {
  const topo = createTopologyView('square', W, H);
  // 나(1) = 0..2열 + 8..9열(월경지), 적(2) = 4..5열 전부, 중립 = 3·6·7열
  const owners = grid((_, c) => (c <= 2 || c >= 8 ? 1 : c === 4 || c === 5 ? 2 : 0));
  const terrain = grid(() => LAND);
  const BASE = id(2, 0);
  const ANCHOR = id(2, 9);

  it('적 땅 벽 너머 내 땅으로 방어 이동 = 막힘 — 적 땅 바로 앞(지형 거리 최소 칸)에서 멈춘다', () => {
    const g = model(terrain, owners);
    const field = moveField(topo, terrain, ANCHOR);
    const r = computeRoute(g, topo, field, 1, BASE, ANCHOR, false);
    expect(r.blocked).toBe(true);
    expect(r.stopTile).toBe(id(2, 3)); // 3열(중립)에서 앵커와 지형 거리 최소
    expect(r.path[0]).toBe(BASE);
    expect(r.path.at(-1)).toBe(id(2, 3));
    expect(r.path.some((t) => owners[t] === 2)).toBe(false); // 적 땅을 밟지 않는다
    expect(r.corridor).toEqual([]);
  });

  it('같은 지점이라도 공격 태세는 적 땅을 지나 앵커까지 (막힘 없음)', () => {
    const g = model(terrain, owners);
    const field = moveField(topo, terrain, ANCHOR);
    const r = computeRoute(g, topo, field, 1, BASE, ANCHOR, true);
    expect(r.blocked).toBe(false);
    expect(r.stopTile).toBeNull();
    expect(r.path.at(-1)).toBe(ANCHOR);
  });

  it('적 땅에 틈(중립)이 있으면 돌아서 앵커까지 — 경로에 적 땅 없음', () => {
    const o2 = owners.slice();
    o2[id(5, 4)] = 0;
    o2[id(5, 5)] = 0;
    const g = model(terrain, o2);
    const field = moveField(topo, terrain, ANCHOR);
    const r = computeRoute(g, topo, field, 1, BASE, ANCHOR, false);
    expect(r.blocked).toBe(false);
    expect(r.path.at(-1)).toBe(ANCHOR);
    expect(r.path.some((t) => o2[t] === 2)).toBe(false);
    expect(r.path).toContain(id(5, 4));
  });

  it('동맹 땅은 지나간다', () => {
    const g = model(terrain, owners);
    g.alliances.set('1-2', { a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    const field = moveField(topo, terrain, ANCHOR);
    const r = computeRoute(g, topo, field, 1, BASE, ANCHOR, false);
    expect(r.blocked).toBe(false);
    expect(r.path.at(-1)).toBe(ANCHOR);
  });
});

// ───────────── 피드·모델: flag_idle unreachable ─────────────

describe('§22.12 flag_idle "unreachable"', () => {
  it('내 깃발이면 피드 + 토스트 "적 땅에 막혀 방어 깃발이 멈췄습니다"', () => {
    const e = describeEvent({ type: 'flag_idle', tick: 2290, flagId: 31, reason: 'unreachable', autoRecallTick: 2890 }, { me: 1, nick: (n) => `P${n}`, flagOwner: () => 1, tickMs: 200 });
    expect(e?.text).toContain('적 땅에 막혀 방어 깃발이 멈췄습니다');
    expect(e?.toast).toBe(true);
    expect(describeEvent({ type: 'flag_idle', tick: 2290, flagId: 31, reason: 'unreachable', autoRecallTick: 2890 }, { me: 1, nick: (n) => `P${n}`, flagOwner: () => 2, tickMs: 200 })).toBeNull();
  });

  it('모델이 멈춘 이유를 기억하고(지도 "막힘" 태그), 재지정하면 지운다', () => {
    const g = model(grid(() => LAND), grid(() => 1));
    g.flags.set(31, {
      id: 31, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.DEFEND, troops: 100, posTileId: 0, anchorTileId: 5, targetOwnerId: 254, state: 'IDLE',
      targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false, disengaging: false, orderCooldownUntilTick: 0,
      disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null,
    });
    g.applyEvent({ type: 'flag_idle', tick: 2290, flagId: 31, reason: 'unreachable', autoRecallTick: 2890 });
    expect(g.flagIdleReason.get(31)).toBe('unreachable');
    g.applyEvent({ type: 'flag_retargeted', tick: 2300, flagId: 31, anchorTileId: 7, targetOwnerId: 254, posture: POSTURE.DEFEND, cooldownUntilTick: 2315, etaTick: 2400, engageEtaTick: 2400, auto: false });
    expect(g.flagIdleReason.has(31)).toBe(false);
  });
});

// ───────────── 테크 17·19 ─────────────

describe('§22.7 테크 급속 귀환(MOB-2B) · 철수 훈련(MOB-3B) — v5.8 에 효과 교환, id 20·22', () => {
  const ctx = { consts: undefined, techMask: 2 ** 18, goldWeight: 0, upkeepPm: 0 }; // 행군로 MOB-1 보유
  const n20 = TECH_NODES.find((n) => n.code === 'MOB-2B')!;
  const n22 = TECH_NODES.find((n) => n.code === 'MOB-3B')!;
  it('노드 이름·설명 (shared)', () => {
    expect(n20.name).toBe('급속 귀환');
    expect(n22.name).toBe('철수 훈련');
  });
  it('철수 훈련: 상세 "이탈 대기 시간 (무테크) → (노드 값)" (v5.9: 1.6초 → 1.0초)', () => {
    const d = techDetailRows(n22, ctx as Parameters<typeof techDetailRows>[1]);
    expect(d.rows[0]).toMatchObject({ label: '이탈 대기 시간', before: `${((DISENGAGE_TICKS * 200) / 1000).toFixed(1)}초`, after: `${((n22.value * 200) / 1000).toFixed(1)}초`, changed: true });
  });
  it('급속 귀환: 상세 "귀환 속도 배율 ×1.70 → ×2.00" (행군로 보유 기준)', () => {
    const d = techDetailRows(n20, ctx as Parameters<typeof techDetailRows>[1]);
    expect(d.rows[0]).toMatchObject({ before: '×1.70', after: '×2.00', changed: true });
    expect(d.rows[0].label).toContain('귀환 속도');
  });
});
