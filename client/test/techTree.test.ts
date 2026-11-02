/** 테크 창(2026-10-24 개편: 4티어 42노드·절대 점수·양자택일): 노드 상태 6종, 가격 표시, 상세 패널 지금/구매 후 수치, 대기 시간, 격자 배치 */
import { describe, expect, it } from 'vitest';
import { TECH_NODES, TECH_STAT, techMaskWith, techOwned } from '@civwar/shared';
import { fmtWait, purchasableByBranch, purchasableCount, secondsToAfford, techAncestors, techDetailRows, techLayout, techNodeState, techNodeViews, techPriceInfo } from '../src/ui/techTree.js';
import { TECH_ICON_PATHS } from '../src/ui/techIcons.js';

const mask = (...ids: number[]) => ids.reduce((m, i) => techMaskWith(m, i), 0);
const id = (code: string): number => TECH_NODES.find((n) => n.code === code)!.id;
const nd = (code: string) => TECH_NODES[id(code)];

describe('노드 상태 (01b 5.1 [A-79] + 양자택일)', () => {
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
  it('양자택일 상대 보유 = 선택 불가(blocked), 잠김보다 먼저 판정', () => {
    const p = { techMask: mask(id('ECO-1'), id('ECO-2A')), techCount: 2, gold: 99999 };
    expect(techNodeState(p, nd('ECO-2B'), TECH_NODES, 400)).toBe('blocked');
    expect(techNodeState(p, nd('ECO-3B'), TECH_NODES, 700)).toBe('locked'); // 부모 ECO-2B 미보유
    expect(techNodeState({ techMask: mask(id('MIL-1'), id('MIL-2A')), techCount: 2, gold: 99999 }, nd('MIL-2B'), TECH_NODES, 400)).toBe('buyable'); // 군사는 택일 아님
  });
  it('T4 는 T3A 또는 T3B 중 하나만 있어도 열린다', () => {
    const own = (...codes: string[]) => ({ techMask: mask(...codes.map(id)), techCount: codes.length, gold: 99999 });
    expect(techNodeState(own('MOB-1', 'MOB-2A', 'MOB-3A'), nd('MOB-4'), TECH_NODES, 1300)).toBe('buyable');
    expect(techNodeState(own('MOB-1', 'MOB-2B', 'MOB-3B'), nd('MOB-4'), TECH_NODES, 1300)).toBe('buyable');
    expect(techNodeState(own('MOB-1', 'MOB-2A'), nd('MOB-4'), TECH_NODES, 1300)).toBe('locked');
  });
  it('views: 진행 링 = gold / cost (상한 1), 배지 수 = 구매 가능 수', () => {
    const p = { techMask: mask(id('ECO-1')), techCount: 1, gold: 200 };
    const v = techNodeViews(p);
    // n=1 → T1 169, T2 381
    expect(v[0].cost).toBe(169);
    expect(v[0].state).toBe('buyable');
    const t2 = v[id('ECO-2A')];
    expect(t2.cost).toBe(381);
    expect(t2.state).toBe('short');
    expect(t2.progress).toBeCloseTo(200 / 381, 6);
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
    expect(techPriceInfo(4, 0)).toEqual({ cost: 1200, base: 1200, purchased: 0, surchargePct: 0, nextCost: 1272 }); // 2026-10-24 T4
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

describe('상세 패널 지금 → 구매 후 (절대 점수)', () => {
  it('SPE-3A 고슴도치 진: 행군 대열·방진 보유 시 창병 방어 120 → 130', () => {
    const d = techDetailRows(nd('SPE-3A'), { techMask: mask(id('SPE-1'), id('SPE-2B')) });
    expect(d.owned).toBe(false);
    expect(d.rows[0]).toMatchObject({ label: '창병 방어', before: '120', after: '130', changed: true }); // 기본 110 + 방진 10 → +10
  });
  it('보유 노드는 "없을 때 → 보유" (다른 보유 노드 합산 유지)', () => {
    const d = techDetailRows(nd('MIL-3A'), { techMask: mask(id('MIL-1'), id('MIL-2A'), id('MIL-3A')) }); // 공성 전술 +10% + 공성 장비 +15% 보유
    expect(d.owned).toBe(true);
    expect(d.beforeLabel).toBe('없을 때');
    expect(d.rows[0]).toMatchObject({ label: '적 기지 공격 피해 배율', before: '×1.10', after: '×1.25' });
  });
  it('set 노드: 마구간 기병 유지비 가중치 2.00 → 1.60, 철수 훈련 3.0초 → 2.0초 (v4.5)', () => {
    expect(techDetailRows(nd('CAV-2A'), { techMask: mask(id('CAV-1')) }).rows[0]).toMatchObject({ before: '2.00', after: '1.60' });
    expect(techDetailRows(nd('MOB-2B'), { techMask: mask(id('MOB-1')) }).rows[0]).toMatchObject({ before: '3.0초', after: '2.0초' });
  });
  it('병종 이동은 공통 MOB 를 합친 값', () => {
    const d = techDetailRows(nd('CAV-1'), { techMask: mask(id('MOB-1')) }); // 행군로 +10 보유, 군마 +10
    expect(d.rows[0]).toMatchObject({ label: '기병 이동', before: '120', after: '130' }); // 기본 120 (기동 갈래는 이동 보너스 없음)
  });
  it('사기·기지 스탯 행 (재정·행정·병종 T3·T4)', () => {
    expect(techDetailRows(nd('MIL-4'), { techMask: mask(id('MIL-1'), id('MIL-2A'), id('MIL-3A')) }).rows[0]).toMatchObject({ label: '깃발 슬롯 보너스', before: '+0', after: '+1' });
    expect(techDetailRows(nd('MIL-2B'), { techMask: mask(id('MIL-1')) }).rows[0]).toMatchObject({ label: '병력 상한 배율', before: '×1.00', after: '×1.06' });
    expect(techDetailRows(nd('MIL-1'), { techMask: 0 }).rows[0]).toMatchObject({ label: '병력 재생 배율', before: '×1.00', after: '×1.05' });
    expect(techDetailRows(nd('SWO-4'), { techMask: mask(id('SWO-1'), id('SWO-2B'), id('SWO-3B')) }).rows[0]).toMatchObject({ label: '검병 기세 보너스', before: '+0%p', after: '+10%p' });
    expect(techDetailRows(nd('SWO-2B'), { techMask: mask(id('SWO-1')) }).rows[0]).toMatchObject({ label: '검병 점령 소모 배율', before: '×1.00', after: '×0.80' });
    expect(techDetailRows(nd('CAV-3B'), { techMask: mask(id('CAV-1'), id('CAV-2B')) }).rows[0]).toMatchObject({ before: '+0%p', after: '+10%p' });
    expect(techDetailRows(nd('TER-2B'), { techMask: mask(id('TER-1')) }).rows[0]).toMatchObject({ label: '기지 체력 피해 배율', before: '×1.00', after: '×0.90' });
    expect(techDetailRows(nd('TER-4'), { techMask: mask(id('TER-1'), id('TER-2B')) }).rows[0]).toMatchObject({ label: '기지 체력 피해 배율', before: '×0.90', after: '×0.70' });
    expect(techDetailRows(nd('TER-3A'), { techMask: mask(id('TER-1'), id('TER-2A')) }).rows[0]).toMatchObject({ label: '기지 생산 배율 (모든 기지)', before: '×1.00', after: '×1.10' });
    expect(techDetailRows(nd('ECO-2B'), { techMask: mask(id('ECO-1')) }).rows[0]).toMatchObject({ label: '사막·산 영토 골드 보너스', before: '+0%', after: '+80%' });
    expect(techDetailRows(nd('ECO-1'), { techMask: 0 }).rows[0]).toMatchObject({ label: '편성비 배율 (전 병종)', before: '×1.00', after: '×0.95' });
  });
  it('실제 값 행: 골드 수입, 슬롯 (콜백)', () => {
    const g = techDetailRows(nd('ECO-4'), { techMask: 0 });
    expect(g.rows[0]).toMatchObject({
      label: '골드 생산 배율',
      before: '×1.00',
      after: '×1.20',
      changed: true,
    });
    const slot = techDetailRows(nd('MOB-4'), { techMask: mask(id('MOB-1'), id('MOB-2A'), id('MOB-3A')), flagCap: (m) => 3 + (techOwned(m, id('MOB-4')) ? 1 : 0) });
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
  it('T1 가운데, T2 좌/우, T3 부모 아래, T4 가운데', () => {
    const l = techLayout(TECH_NODES);
    expect(l[id('MIL-1')].fx).toBe(0.5);
    expect(l[id('MIL-2A')].fx).toBe(0.25);
    expect(l[id('MIL-2B')].fx).toBe(0.75);
    expect(l[id('MIL-3A')].fx).toBe(0.25);
    expect(l[id('MIL-3B')].fx).toBe(0.75);
    expect(l[id('SPE-3B')].fx).toBe(0.25); // SPE-3B ← SPE-2A
    expect(l[id('SPE-3A')].fx).toBe(0.75); // SPE-3A ← SPE-2B
    for (const n of TECH_NODES.filter((x) => x.tier === 4)) expect(l[n.id].fx).toBe(0.5);
  });
  it('선행 경로 = 루트까지 (T4 는 대체 부모도 포함)', () => {
    expect([...techAncestors(TECH_NODES, id('MOB-3B'))].sort((a, b) => a - b)).toEqual([id('MOB-1'), id('MOB-2B'), id('MOB-3B')].sort((a, b) => a - b));
    expect([...techAncestors(TECH_NODES, id('MIL-4'))].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5]);
  });
  it('노드 42개 모두 아이콘이 있다', () => {
    expect(TECH_ICON_PATHS).toHaveLength(42);
    for (const p of TECH_ICON_PATHS) expect(p.length).toBeGreaterThan(0);
  });
});
