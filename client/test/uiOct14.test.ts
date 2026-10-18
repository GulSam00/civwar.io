/**
 * 2026-10-14 UI 요청 — 순수 함수 검증:
 *  창 드래그 자르기(clampOffset) · 공격력/방어력(unitCombatStats, 서버 flagValue 와 같은 식·지형 제외) ·
 *  내 부대 칩(myUnitChips) · 떠 있는 버튼 상태(flagActionState) · 영토 이름 위치(territoryAnchors/layoutTerritoryLabels) ·
 *  기지 아이콘 크기(baseIconSize). §21 연결분은 uiOct14b.test.ts
 */
import { describe, expect, it } from 'vitest';
import {
  POSTURE,
  TECH_NODES,
  TECH_STAT,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  techCombatPm,
  techStatValues,
  type FlagSnapshot,
  type S2C_MatchConfig,
} from '@civwar/shared';
import { clampOffset } from '../src/ui/draggable.js';
import { fmtPm, unitCombatStats } from '../src/ui/techInfo.js';
import { flagActionState, myUnitChips } from '../src/ui/unitChips.js';
import { LABEL_MAX_PX, LABEL_MIN_PX, labelSizePx, layoutTerritoryLabels, territoryAnchors } from '../src/render/territoryLabels.js';
import { baseIconSize } from '../src/render/renderer.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameModel } from '../src/state/gameModel.js';

describe('창 드래그 — 화면 가장자리 자르기', () => {
  const bounds = { width: 1000, height: 700 };
  const box = { left: 300, top: 100, width: 400, height: 300 };

  it('범위 안이면 그대로', () => {
    expect(clampOffset({ x: 50, y: -40 }, box, bounds)).toEqual({ x: 50, y: -40 });
  });

  it('왼쪽·위로 넘기면 창 끝이 0 에 붙는다', () => {
    expect(clampOffset({ x: -900, y: -900 }, box, bounds)).toEqual({ x: -300, y: -100 });
  });

  it('오른쪽·아래로 넘기면 창 끝이 경계에 붙는다', () => {
    // 오른쪽 끝 = 300 + 400 + x = 1000 → x = 300, 아래 끝 = 100 + 300 + y = 700 → y = 300
    expect(clampOffset({ x: 5000, y: 5000 }, box, bounds)).toEqual({ x: 300, y: 300 });
  });

  it('창이 경계보다 크면 왼쪽·위쪽을 맞춘다 (제목 줄이 늘 보이게)', () => {
    const big = { left: 20, top: 30, width: 1200, height: 900 };
    expect(clampOffset({ x: 400, y: 400 }, big, bounds)).toEqual({ x: -20, y: -30 });
    expect(clampOffset({ x: -400, y: -400 }, big, bounds)).toEqual({ x: -20, y: -30 });
  });

  it('화면이 줄어 기억한 위치가 밖이면 다시 안으로 (창 크기 변경 재자르기)', () => {
    const small = { width: 800, height: 500 };
    expect(clampOffset({ x: 300, y: 300 }, box, small)).toEqual({ x: 100, y: 100 });
  });

  it('소수 픽셀은 반올림', () => {
    expect(clampOffset({ x: 10.6, y: -0.4 }, box, bounds)).toEqual({ x: 11, y: -0 });
  });
});

describe('부대 공격력·방어력 (지형 보정 제외)', () => {
  // 노드 찾기: 군사 공통 공격(COMBAT_ATK) 노드 하나, 창병 방어 증분(COMBAT_DEF_SPEAR) 노드 하나
  const nodeFor = (stat: number) => TECH_NODES.find((n) => n.stat === stat);
  const maskOf = (...ids: number[]) => ids.reduce((m, i) => (m | (1 << i)) >>> 0, 0);
  /** 노드 i 와 그 조상 전부 (선행 조건 충족 mask) */
  const withAncestors = (id: number): number[] => {
    const out: number[] = [];
    for (let n: number | null = id; n !== null; n = TECH_NODES[n].parent) out.push(n);
    return out;
  };

  it('무테크 = 병종 기본값 (창 0.87/1.30, 검 1.00/1.00, 기 1.18/0.70)', () => {
    for (const u of [0, 1, 2]) {
      const s = unitCombatStats(u, 0);
      expect(s.atk).toBe(UNIT_ATK_PERMILLE[u]);
      expect(s.def).toBe(UNIT_DEF_PERMILLE[u]);
      expect(s.atkTechPm).toBe(1000);
      expect(s.defTechPm).toBe(1000);
    }
    expect(fmtPm(unitCombatStats(0, 0).def)).toBe('×1.30');
    expect(fmtPm(unitCombatStats(2, 0).def)).toBe('×0.70');
  });

  it('서버 flagValue 와 같은 식: floor(병종 기본 × techCombatPm(태세) / 1000) — 군사 공통 + 병종 갈래', () => {
    const atkNode = nodeFor(TECH_STAT.COMBAT_ATK);
    const defSpear = nodeFor(TECH_STAT.COMBAT_DEF_SPEAR);
    expect(atkNode).toBeDefined();
    expect(defSpear).toBeDefined();
    const mask = maskOf(...withAncestors(atkNode!.id), ...withAncestors(defSpear!.id));
    const stat = techStatValues(mask);
    for (const u of [0, 1, 2]) {
      const s = unitCombatStats(u, mask);
      expect(s.atk).toBe(Math.floor((UNIT_ATK_PERMILLE[u] * techCombatPm(stat, u, false)) / 1000));
      expect(s.def).toBe(Math.floor((UNIT_DEF_PERMILLE[u] * techCombatPm(stat, u, true)) / 1000));
    }
    // 공격 노드는 공격만, 창병 방어 노드는 창병 방어만 올린다
    expect(unitCombatStats(1, mask).atk).toBeGreaterThan(UNIT_ATK_PERMILLE[1]);
    expect(unitCombatStats(0, mask).def).toBeGreaterThan(unitCombatStats(0, maskOf(...withAncestors(atkNode!.id))).def);
    expect(unitCombatStats(1, mask).def).toBe(unitCombatStats(1, maskOf(...withAncestors(atkNode!.id))).def);
  });

  it('match_config.constants 값이 있으면 그걸 쓴다 (서버 값 우선)', () => {
    const s = unitCombatStats(1, 0, { UNIT_ATK_PERMILLE: [900, 1100, 1200], UNIT_DEF_PERMILLE: [1200, 950, 800] });
    expect(s.atk).toBe(1100);
    expect(s.def).toBe(950);
  });
});

// ── 작은 모델 ──
const W = 8;
const H = 6;
function model(owners: number[], flags: FlagSnapshot[] = []): GameModel {
  const cfg = {
    type: 'match_config', seed: 1, topology: 'square', width: W, height: H, totalLandTiles: W * H, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  } as unknown as S2C_MatchConfig;
  const g = new GameModel(cfg);
  g.terrain = new Uint8Array(W * H).fill(1);
  g.owners = Uint8Array.from(owners);
  for (const f of flags) g.flags.set(f.id, f);
  g.ready = true;
  return g;
}
const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 1, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: 0, anchorTileId: 0,
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, postureCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null, ...over,
});

describe('병력 바 위 내 부대 칩', () => {
  it('내 깃발만, 슬롯 순 — 병종·병력·태세·선택·패주·귀환', () => {
    const g = model(new Array(W * H).fill(0), [
      flag({ id: 5, slotIndex: 2, unit: 2, troops: 40, posture: POSTURE.DEFEND, state: 'RETURNING' }),
      flag({ id: 3, slotIndex: 0, unit: 0, troops: 120 }),
      flag({ id: 9, ownerId: 2, slotIndex: 1 }), // 남의 깃발 — 제외
      flag({ id: 4, slotIndex: 1, unit: 1, troops: 0, routed: true, inCombat: true }),
    ]);
    const chips = myUnitChips(g, 1, 4);
    expect(chips.map((c) => c.id)).toEqual([3, 4, 5]);
    expect(chips[0]).toMatchObject({ unit: 0, troops: 120, posture: POSTURE.ATTACK, selected: false, routed: false, returning: false });
    expect(chips[1]).toMatchObject({ selected: true, routed: true, inCombat: true });
    expect(chips[2]).toMatchObject({ unit: 2, troops: 40, posture: POSTURE.DEFEND, returning: true });
  });

  it('관전(me = null)·출전 없음 = 칩 없음', () => {
    const g = model(new Array(W * H).fill(0), [flag({ id: 3 })]);
    expect(myUnitChips(g, null, null)).toEqual([]);
    expect(myUnitChips(g, 2, null)).toEqual([]);
  });
});

describe('선택 부대 떠 있는 버튼 [귀환]/[태세 변경] 상태', () => {
  it('평상시: 둘 다 가능, 바꿀 태세 = 반대', () => {
    const st = flagActionState(flag({ posture: POSTURE.ATTACK }), 100, 200);
    expect(st).toEqual({ recallBlocked: null, postureBlocked: null, cooldownSec: 0, nextPosture: POSTURE.DEFEND, combatWarning: null });
  });

  it('쿨타임: 남은 초(올림) 표시 + 태세 변경만 막힘', () => {
    const st = flagActionState(flag({ posture: POSTURE.DEFEND, postureCooldownUntilTick: 107 }), 100, 200); // 7 tick = 1.4초 → 2초
    expect(st.cooldownSec).toBe(2);
    expect(st.postureBlocked).toBe('전환 대기 2초');
    expect(st.recallBlocked).toBeNull();
    expect(st.nextPosture).toBe(POSTURE.ATTACK);
  });

  it('서버 거절 순서대로 막는다 (§27.1-3): 패주 > 귀환 > 쿨타임 — 전투 중·이탈 대기 중은 막지 않는다', () => {
    expect(flagActionState(flag({ routed: true, state: 'RETURNING' }), 0, 200)).toMatchObject({ recallBlocked: '패주 중', postureBlocked: '패주 중' });
    expect(flagActionState(flag({ state: 'RETURNING' }), 0, 200)).toMatchObject({ recallBlocked: '귀환 중 — 취소 불가', postureBlocked: '귀환 중' });
    expect(flagActionState(flag({ disengaging: true, inCombat: true }), 0, 200)).toMatchObject({ recallBlocked: null, postureBlocked: null });
    expect(flagActionState(flag({ inCombat: true }), 0, 200)).toMatchObject({ recallBlocked: null, postureBlocked: null });
    expect(flagActionState(flag({ inCombat: true, postureCooldownUntilTick: 10 }), 0, 200)).toMatchObject({ postureBlocked: '전환 대기 2초' });
  });
});

describe('영토 이름 위치', () => {
  const topo = createTopologyView('square', W, H);
  const center = (t: number) => topo.tileCenter(t);

  it('무게중심에 가장 가까운 자기 칸 — 볼록 영토는 한가운데', () => {
    // 플레이어 1 = (1..3행, 1..3열) 3×3 → 가운데 칸 (2,2) 중심 = (2.5, 2.5)
    const o = new Array(W * H).fill(0);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) o[r * W + c] = 1;
    const a = territoryAnchors(o, W * H, center);
    expect(a).toEqual([{ owner: 1, x: 2.5, y: 2.5, tiles: 9, pieceTiles: 9 }]);
  });

  it('ㄷ자(오목) 영토: 무게중심이 빈 칸이어도 자기 칸 위에 놓인다', () => {
    // 0열 전체 + 0행·5행 (가운데가 빈 ㄷ자)
    const o = new Array(W * H).fill(0);
    for (let r = 0; r < H; r++) o[r * W] = 2;
    for (let c = 0; c < W; c++) (o[c] = 2), (o[5 * W + c] = 2);
    const [a] = territoryAnchors(o, W * H, center);
    const tile = Math.floor(a.y) * W + Math.floor(a.x);
    expect(o[tile]).toBe(2);
    expect(a.tiles).toBe(H + 2 * (W - 1));
  });

  it('물·중립 제외, 큰 영토 먼저', () => {
    const o = new Array(W * H).fill(0);
    o[0] = 3;
    o[1] = 3; // 물이라 제외
    for (let c = 4; c < 8; c++) o[W + c] = 4;
    const a = territoryAnchors(o, W * H, center, (t) => t !== 1);
    expect(a.map((x) => [x.owner, x.tiles])).toEqual([
      [4, 4],
      [3, 1],
    ]);
    expect(a[1]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('글자 크기: 영토 크기 √ × 줌에 비례, 화면 [min, max] 안', () => {
    expect(labelSizePx(1, 4)).toBe(LABEL_MIN_PX);
    expect(labelSizePx(100000, 64)).toBe(LABEL_MAX_PX);
    expect(labelSizePx(400, 4)).toBeLessThan(labelSizePx(400, 6));
    expect(labelSizePx(100, 6)).toBeLessThan(labelSizePx(400, 6));
  });

  it('배치: 겹치면 작은 영토 이름을 줄이거나 생략, 화면 밖은 버린다', () => {
    const id = (x: number, y: number) => ({ x, y });
    const measure = (t: string, size: number) => t.length * size * 0.6;
    const anchors = [
      { owner: 1, x: 100, y: 100, tiles: 900 },
      { owner: 2, x: 104, y: 102, tiles: 400 }, // 1 바로 옆 — 겹친다
      { owner: 3, x: 400, y: 300, tiles: 400 }, // 멀리 — 그대로
      { owner: 4, x: -500, y: 100, tiles: 400 }, // 화면 밖
    ];
    const placed = layoutTerritoryLabels(anchors, (o) => `P${o}name`, id, 6, measure, { w: 800, h: 600 });
    expect(placed.map((p) => p.owner)).toEqual([1, 3]);
    expect(placed[0].size).toBe(labelSizePx(900, 6));
    // 서로 겹치지 않는다
    const r = placed.map((p) => ({ x0: p.x - measure(p.text, p.size) / 2, x1: p.x + measure(p.text, p.size) / 2, y0: p.y - p.size / 2, y1: p.y + p.size / 2 }));
    expect(r[0].x1 < r[1].x0 || r[1].x1 < r[0].x0 || r[0].y1 < r[1].y0 || r[1].y1 < r[0].y0).toBe(true);
  });

  it('배치: 큰 크기로는 겹치지만 최소 크기로 줄이면 들어가는 경우 줄여서 둔다', () => {
    const measure = (t: string, size: number) => t.length * size * 0.6;
    const anchors = [
      { owner: 1, x: 100, y: 100, tiles: 2500 },
      { owner: 2, x: 100, y: 122, tiles: 2500 },
    ];
    const placed = layoutTerritoryLabels(anchors, () => 'AB', (x, y) => ({ x, y }), 20, measure, { w: 800, h: 600 });
    expect(placed).toHaveLength(2);
    expect(placed[0].size).toBe(LABEL_MAX_PX);
    expect(placed[1].size).toBe(LABEL_MIN_PX);
  });
});

describe('기지 아이콘 = 칸을 꽉 채운다', () => {
  it('한 변 = 줌(칸 1개 픽셀), 최소 10px', () => {
    expect(baseIconSize(12)).toBe(12);
    expect(baseIconSize(30)).toBe(30);
    expect(baseIconSize(4)).toBe(10);
    expect(baseIconSize(200)).toBe(64);
  });
});
