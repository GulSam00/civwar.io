/**
 * 2026-10-19 QA v4.5 경미 클라이언트 표시 3건 + 영토 이름 겹침 정리
 *  m-5 이벤트로 깃발 state 즉시 갱신 · m-6 테크 골드 행(기지 포함) · m-7 교전 연결선 = 서버 간선 규칙 · 이름 겹침/조각난 영토/아이콘 피하기
 */
import { describe, expect, it } from 'vitest';
import { TECH_NODES, type S2C_SnapshotDelta } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { techDetailRows } from '../src/ui/techTree.js';
import { techStatsOf } from '../src/ui/techInfo.js';
import { combatPairs, type CombatFlagLike } from '../src/render/combatPairs.js';
import { createTopologyView } from '../src/render/topology.js';
import { LABEL_DIM_ALPHA, LABEL_MAX_PX, layoutTerritoryLabels, territoryAnchors } from '../src/render/territoryLabels.js';

const delta = (tick: number, over: Partial<S2C_SnapshotDelta> = {}): S2C_SnapshotDelta => ({
  type: 'snapshot_delta', tick, tileChanges: [], playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [], ...over,
});

function modelWithFlag(): GameModel {
  const m = new GameModel({
    type: 'match_config', seed: 1, topology: 'square', width: 2, height: 2, totalLandTiles: 4, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  });
  m.apply({ type: 'map_init', terrain: [1, 4], spawns: [], bases: [] });
  m.apply({ type: 'snapshot_full', tick: 0, owners: [1, 1, 0, 3], players: [], flags: [], bases: [], alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9600, endgameRushActive: false });
  m.apply({ type: 'flag_issued', tick: 1, flagId: 1, playerId: 1, slotIndex: 0, unit: 1, posture: 0, troops: 50, originTileId: 0, anchorTileId: 3, targetOwnerId: 0, etaTick: 30, engageEtaTick: 28 });
  return m;
}

describe('m-5 깃발 state 는 이벤트에서 즉시 갱신 (flagStats 는 1초 주기)', () => {
  it('flag_engaged / flag_idle / flag_recalled / flag_routed → 같은 tick 에 state 가 바뀌고, 다음 flagStats 가 서버 값으로 덮어쓴다', () => {
    const m = modelWithFlag();
    expect(m.flags.get(1)!.state).toBe('MARCHING');
    m.apply({ type: 'flag_engaged', tick: 10, flagId: 1, posture: 0, frontTileCount: 2 });
    expect(m.flags.get(1)!.state).toBe('ENGAGED');
    m.apply({ type: 'flag_idle', tick: 11, flagId: 1, reason: 'unreachable', autoRecallTick: 50 } as never);
    expect(m.flags.get(1)!.state).toBe('IDLE');
    m.apply({ type: 'flag_recalled', tick: 12, flagId: 1, returnTileId: 0 });
    expect(m.flags.get(1)!.state).toBe('RETURNING');
    m.apply(delta(13, { flagStats: [[1, 49, 'MARCHING']] })); // 서버 값이 항상 이긴다
    expect(m.flags.get(1)!.state).toBe('MARCHING');
    m.apply({ type: 'flag_routed', tick: 14, flagId: 1, returnTileId: 0 } as never);
    expect(m.flags.get(1)!.state).toBe('RETURNING');
  });
  it('모르는 깃발 id 의 이벤트는 무시 (예외 없음)', () => {
    const m = modelWithFlag();
    expect(() => m.apply({ type: 'flag_idle', tick: 3, flagId: 99, reason: 'unreachable', autoRecallTick: 9 } as never)).not.toThrow();
  });
});

describe('m-6 테크 상세 "골드 순수입" = production 합 기준 (기지 골드 포함)', () => {
  const node = TECH_NODES.find((n) => n.code === 'ECO-4')!; // GOLD 노드
  const bit = 2 ** node.id;
  it('incomeNow 가 있으면 그 값이 "지금", 구매 후는 GOLD 스탯 비로 환산', () => {
    const d = techDetailRows(node, { techMask: 0, goldWeight: 100000, upkeepPm: 0, incomeNow: { net: 12.5, gross: 12.5 } });
    const row = d.rows[1];
    expect(row.label).toContain('골드');
    expect(row.before).toBe('+12.5/초'); // 영토분만 계산하던 때는 기지 골드가 빠져 HUD 와 달랐다
    const ratio = techStatsOf(bit)[node.stat] / techStatsOf(0)[node.stat];
    expect(row.after).toBe(`+${(12.5 * ratio).toFixed(1)}/초`);
    expect(row.changed).toBe(true);
  });
  it('이미 보유한 노드: "보유" 쪽이 HUD 값, "없을 때" 는 더 낮다', () => {
    const d = techDetailRows(node, { techMask: bit, incomeNow: { net: 20, gross: 20 }, goldWeight: 1 });
    expect(d.rows[1].after).toBe('+20.0/초');
    expect(parseFloat(d.rows[1].before.slice(1))).toBeLessThan(20);
  });
  it('incomeNow 없으면 예전 goldWeight 식 (영토분)', () => {
    const d = techDetailRows(node, { techMask: 0, goldWeight: 100000, upkeepPm: 0 });
    expect(d.rows[1].label).toContain('골드 수입');
  });
});

describe('m-7 교전 연결선 = 서버 engagedPair 와 같은 규칙', () => {
  const topo = createTopologyView('square', 10, 10);
  const touching = (a: number, b: number) => topo.touching(a, b);
  const f = (id: number, owner: number, tile: number, posture: 0 | 1, over: Partial<CombatFlagLike> = {}): CombatFlagLike => ({
    id, ownerId: owner, posTileId: tile, posture, inCombat: true, state: 'ENGAGED', routed: false, troops: 10, breakaway: false, ...over,
  });
  it('방어 대 방어 · 귀환 공격 대 방어 → 선 없음, 공격 대 방어 → 선 있음, 동맹 → 없음', () => {
    const ATK = 0, DEF = 1; // POSTURE
    expect(combatPairs([f(1, 1, 55, DEF as 1), f(2, 2, 56, DEF as 1)], touching, () => false)).toHaveLength(0);
    expect(combatPairs([f(1, 1, 55, ATK, { state: 'RETURNING' }), f(2, 2, 56, DEF as 1)], touching, () => false)).toHaveLength(0);
    expect(combatPairs([f(1, 1, 55, ATK), f(2, 2, 56, DEF as 1)], touching, () => false)).toHaveLength(1);
    expect(combatPairs([f(1, 1, 55, ATK), f(2, 2, 56, DEF as 1)], touching, () => true)).toHaveLength(0);
  });
  it('방금 패주한 깃발·병력 0 깃발·분리 깃발은 선을 만들지 않는다', () => {
    for (const bad of [{ routed: true }, { troops: 0 }, { breakaway: true }]) {
      expect(combatPairs([f(1, 1, 55, 0, bad), f(2, 2, 56, 0)], touching, () => false)).toHaveLength(0);
    }
  });
});

describe('영토 이름 정리', () => {
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const id = (x: number, y: number) => ({ x, y });
  it('글자 최대 크기 17px (2026-10-24: 20 → 17, 예전 30)', () => {
    expect(LABEL_MAX_PX).toBe(17);
  });
  it('겹치면 큰 영토 이름이 남고 작은 쪽은 줄거나 사라진다', () => {
    const anchors = [
      { owner: 1, x: 100, y: 100, tiles: 5000 },
      { owner: 2, x: 102, y: 101, tiles: 100 },
    ];
    const placed = layoutTerritoryLabels(anchors, () => 'NAMENAME', id, 6, measure, { w: 800, h: 600 });
    expect(placed.map((p) => p.owner)).toEqual([1]);
  });
  it('조각난 영토: 이름은 가장 큰 연결 덩어리 가운데에 붙는다', () => {
    const W = 20;
    const topo = createTopologyView('square', W, 3);
    const o = new Array(W * 3).fill(0);
    for (let c = 0; c < 3; c++) o[W + c] = 1; // 작은 조각 3칸 (왼쪽)
    for (let c = 10; c < 19; c++) o[W + c] = 1; // 큰 조각 9칸 (오른쪽)
    const [a] = territoryAnchors(o, W * 3, (t) => topo.tileCenter(t), () => true, (t) => topo.neighbors(t));
    expect(a.tiles).toBe(12);
    expect(a.pieceTiles).toBe(9);
    expect(a.x).toBeGreaterThanOrEqual(10);
    expect(a.x).toBeLessThanOrEqual(19);
    const [old] = territoryAnchors(o, W * 3, (t) => topo.tileCenter(t), () => true); // neighbors 없으면 예전 방식(전체)
    expect(old.pieceTiles).toBe(12);
  });
  it('깃발·기지 아이콘 위에 놓이면 비껴 놓고, 비킬 자리가 없으면 흐리게 표시한다', () => {
    const a = [{ owner: 1, x: 300, y: 300, tiles: 2500 }];
    const base = layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 })[0];
    const icon = { x0: 290, y0: 290, x1: 310, y1: 310 };
    const moved = layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 }, undefined, [icon])[0];
    expect(moved.y).not.toBe(base.y);
    expect(moved.dim).toBeUndefined();
    const wall = { x0: 200, y0: 150, x1: 400, y1: 450 }; // 사방이 막힘 → 제자리 + dim
    const dimmed = layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 }, undefined, [wall])[0];
    expect(dimmed.y).toBe(base.y);
    expect(dimmed.dim).toBe(true);
    expect(LABEL_DIM_ALPHA).toBeLessThan(0.9);
  });
  it('2026-10-24 HUD 패널(blocked) 아래로는 놓이지 않는다 — 줄여 보고 안 되면 생략, 비킬 자리는 위아래로 3줄까지', () => {
    const a = [{ owner: 1, x: 300, y: 300, tiles: 2500 }];
    const panel = { x0: 0, y0: 0, x1: 800, y1: 600 }; // 화면 전체가 패널 → 생략
    expect(layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 }, undefined, [], [panel])).toEqual([]);
    const base = layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 })[0];
    const strip = { x0: 250, y0: base.y - 8, x1: 350, y1: base.y + 8 }; // 이름 자리에 걸친 아이콘 → 비껴 놓음
    const moved = layoutTerritoryLabels(a, () => 'AB', id, 6, measure, { w: 800, h: 600 }, undefined, [strip])[0];
    expect(moved.y).not.toBe(base.y);
    expect(LABEL_MAX_PX).toBeLessThanOrEqual(17);
  });
});
