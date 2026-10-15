/** v4.3 테크 창: 노드 상태 5종, 가격 표시, 상세 패널 지금/구매 후 수치, 대기 시간, 격자 배치 */
import { describe, expect, it } from 'vitest';
import { TECH_NODES, TECH_STAT, techMaskWith } from '@civwar/shared';
import { fmtWait, purchasableByBranch, purchasableCount, secondsToAfford, techAncestors, techDetailRows, techLayout, techNodeState, techNodeViews, techPriceInfo } from '../src/ui/techTree.js';
import { TECH_ICON_PATHS } from '../src/ui/techIcons.js';

const mask = (...ids: number[]) => ids.reduce((m, i) => techMaskWith(m, i), 0);

describe('노드 상태 (01b 5.1 [A-79])', () => {
  it('T1 = 부모 없음 → 골드에 따라 구매 가능 / 골드 부족', () => {
    expect(techNodeState({ techMask: 0, techCount: 0, gold: 160 }, TECH_NODES[0], TECH_NODES, 160)).toBe('buyable');
    expect(techNodeState({ techMask: 0, techCount: 0, gold: 159 }, TECH_NODES[0], TECH_NODES, 160)).toBe('short');
  });
  it('부모 미보유 = 잠김 (골드가 충분해도)', () => {
    expect(techNodeState({ techMask: 0, techCount: 0, gold: 99999 }, TECH_NODES[1], TECH_NODES, 360)).toBe('locked');
  });
  it('보유가 최우선, 그다음 요청 중', () => {
    const p = { techMask: mask(0), techCount: 1, gold: 0 };
    expect(techNodeState(p, TECH_NODES[0], TECH_NODES, 169, new Set([0]))).toBe('owned');
    expect(techNodeState(p, TECH_NODES[1], TECH_NODES, 381, new Set([1]))).toBe('pending');
    expect(techNodeState(p, TECH_NODES[3], TECH_NODES, 742)).toBe('locked'); // MIL-3A 부모 MIL-2A 미보유
  });
  it('views: 진행 링 = gold / cost (상한 1), 배지 수 = 구매 가능 수', () => {
    const p = { techMask: mask(5), techCount: 1, gold: 200 };
    const v = techNodeViews(p);
    // n=1 → T1 169, T2 381
    expect(v[0].cost).toBe(169);
    expect(v[0].state).toBe('buyable');
    expect(v[6].cost).toBe(381);
    expect(v[6].state).toBe('short');
    expect(v[6].progress).toBeCloseTo(200 / 381, 6);
    expect(v[0].progress).toBe(1);
    // T1 6개(ECO-1 보유 제외) 모두 169 ≤ 200, T2 는 381 > 200
    expect(purchasableCount(p)).toBe(6);
    const dots = purchasableByBranch(v);
    expect(dots[1]).toBe(false); // 경제: ECO-1 보유, ECO-2A/2B 골드 부족
    expect(dots[0]).toBe(true);
  });
});

describe('가격 표시 (+6% 누진, §19.3)', () => {
  it('기본·반영 횟수·가산%·다음 가격', () => {
    expect(techPriceInfo(3, 0)).toEqual({ cost: 700, base: 700, purchased: 0, surchargePct: 0, nextCost: 742 });
    const p = techPriceInfo(3, 12);
    expect(p.cost).toBe(Math.floor((700 * (1000 + 60 * 12)) / 1000)); // 1204 (01b 예시)
    expect(p.cost).toBe(1204);
    expect(p.surchargePct).toBe(72);
    expect(techPriceInfo(2, 8).cost).toBe(532);
  });
  it('match_config.constants 값 우선', () => {
    expect(techPriceInfo(1, 2, { TECH_NODE_BASE_COST: [100, 200, 300], TECH_PROGRESSIVE_COEF_PERMILLE: 100 }).cost).toBe(120);
  });
  it('대기 시간 = ceil((가격 − 골드) / 순수입)', () => {
    expect(secondsToAfford(1050, 1204, 4.1)).toBe(38); // 01b 상세 패널 예시
    expect(secondsToAfford(2000, 1204, 4.1)).toBe(0);
    expect(secondsToAfford(10, 1204, 0)).toBeNull();
    expect(fmtWait(38)).toBe('약 38초 후');
    expect(fmtWait(125)).toBe('약 2분 5초 후');
    expect(fmtWait(13600)).toBe('15분 넘게 걸림');
  });
});

describe('상세 패널 지금 → 구매 후', () => {
  it('SPE-3 고슴도치 진: 장창 대열 보유 시 1365 → 1430 (01b 예시)', () => {
    const d = techDetailRows(TECH_NODES[23], { techMask: mask(20, 21) });
    expect(d.owned).toBe(false);
    expect(d.rows[0]).toMatchObject({ before: '1365', after: '1430', changed: true });
  });
  it('보유 노드는 "없을 때 → 보유" (다른 보유 노드 합산 유지)', () => {
    const d = techDetailRows(TECH_NODES[0], { techMask: mask(0, 1, 3) }); // MIL-1 + MIL-3A 보유 → 950 vs 910
    expect(d.owned).toBe(true);
    expect(d.beforeLabel).toBe('없을 때');
    expect(d.rows[0]).toMatchObject({ before: '×0.95', after: '×0.91' });
  });
  it('set 노드: 병참 유지비 계수 90‰ → 72‰, 철수 훈련 3.0초 → 2.0초 (v4.5)', () => {
    expect(techDetailRows(TECH_NODES[7], { techMask: mask(5) }).rows[0]).toMatchObject({ before: '90‰', after: '72‰' });
    expect(techDetailRows(TECH_NODES[17], { techMask: mask(15) }).rows[0]).toMatchObject({ before: '3.0초', after: '2.0초' });
  });
  it('공통 전투 노드는 병종별 실제 전투값 행을 붙인다', () => {
    const d = techDetailRows(TECH_NODES[1], { techMask: mask(0) }); // 공격 교리 +3%
    expect(d.rows[0]).toMatchObject({ before: '×1.000', after: '×1.030' });
    expect(d.rows[1]).toMatchObject({ before: '870 / 1000 / 1180', after: '896 / 1030 / 1215' });
  });
  it('병종 이동속도는 공통 MOB 를 합친 값', () => {
    const d = techDetailRows(TECH_NODES[28], { techMask: mask(15) }); // 행군로 +15% 보유, 군마 +10%
    expect(d.rows[0]).toMatchObject({ before: '×1.15', after: '×1.25' });
  });
  it('실제 값 행: 골드 수입, 병력 상한, 슬롯 (콜백)', () => {
    const g = techDetailRows(TECH_NODES[5], { techMask: 0, goldWeight: 100000, upkeepPm: 0 });
    expect(g.rows[1].label).toContain('골드 수입');
    expect(g.rows[1].changed).toBe(true);
    const cap = techDetailRows(TECH_NODES[12], { techMask: mask(10), troopCap: (m) => (m & (1 << 12) ? 1060 : 1000) });
    expect(cap.rows[1]).toMatchObject({ before: '1,000', after: '1,060' });
    const slot = techDetailRows(TECH_NODES[18], { techMask: mask(15, 16), flagCap: (m) => 3 + ((m >>> 18) & 1) });
    expect(slot.rows[0]).toMatchObject({ before: '+0', after: '+1' });
    expect(slot.rows[1]).toMatchObject({ before: '3', after: '4' });
  });
  it('모든 노드: 주 행은 값이 바뀐다', () => {
    for (const n of TECH_NODES) {
      const pm = n.parent === null ? 0 : mask(...techAncestors(TECH_NODES, n.parent));
      expect(techDetailRows(n, { techMask: pm }).rows[0].changed, n.code).toBe(true);
    }
    expect(TECH_STAT.SLOT_BONUS).toBe(12);
  });
});

describe('격자 배치 · 아이콘', () => {
  it('T1 가운데, T2 좌/우, T3 부모 아래', () => {
    const l = techLayout(TECH_NODES);
    expect(l[0].fx).toBe(0.5);
    expect(l[1].fx).toBe(0.25);
    expect(l[2].fx).toBe(0.75);
    expect(l[3].fx).toBe(0.25);
    expect(l[4].fx).toBe(0.75);
    expect(l[23].fx).toBe(0.25); // SPE-3 ← SPE-2A
    expect(l[27].fx).toBe(0.75); // SWO-3 ← SWO-2B
  });
  it('선행 경로 = 루트까지', () => {
    expect([...techAncestors(TECH_NODES, 19)].sort((a, b) => a - b)).toEqual([15, 17, 19]);
  });
  it('노드 32개 모두 아이콘이 있다', () => {
    expect(TECH_ICON_PATHS).toHaveLength(32);
    for (const p of TECH_ICON_PATHS) expect(p.length).toBeGreaterThan(0);
  });
});
