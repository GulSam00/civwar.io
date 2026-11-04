/**
 * 테크 트리 v4.3 화면 계산 (순수 함수 — React·DOM 없음, 테스트 대상).
 *  - 노드 상태 5종 (01b 5.1 [A-79]): 잠김 / 골드 부족 / 구매 가능 / 구매 요청 중 / 보유
 *  - 가격 표시 (프로토콜 §19.3 — techNodeCost, n = techCount)
 *  - 상세 패널 "지금 → 구매 후" 수치 (techStatValues(mask) 대 techStatValues(mask | 1<<i), 보유 노드는 "없을 때 → 있을 때")
 *  - 대기 시간 추정 (순수입 = goldPerSecond.net)
 *  - 격자 배치 (안 A: 열 = 갈래, 줄 = 티어, T2 는 좌/우 반 칸, T3 는 부모 아래)
 * 상수는 match_config.constants 우선 (techInfo.ts 의 techNodes/techStatsOf/techCost 를 거친다).
 */
import {
  TECH_BRANCH_COUNT,
  TECH_STAT,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  TECH_POINT_PERMILLE,
  techCombatPts,
  techExclusiveBlocker,
  techMaskWith,
  techMaskWithout,
  UNIT_SPEED_PERMILLE,
  techOwned,
  techPrereqMet,
  techSpeedPts,
  type TechNodeDef,
} from '@civwar/shared';
import { techCost, techNodes, techStatsOf } from './techInfo.js';
import { UNIT_NAME } from './text.js';

type Consts = Record<string, unknown> | undefined;
function c<T>(consts: Consts, name: string, fallback: T): T {
  const v = consts?.[name];
  return (v === undefined ? fallback : v) as T;
}

// ───────────── 노드 상태 ─────────────

/** blocked = 양자택일 상대 노드를 이미 보유해 이 노드는 고를 수 없다 (재정·행정 2티어, 2026-10-24) */
export type TechNodeState = 'owned' | 'pending' | 'buyable' | 'short' | 'locked' | 'blocked';

export interface TechNodeView {
  node: TechNodeDef;
  state: TechNodeState;
  /** 지금 사면 낼 가격 (보유 노드도 계산은 한다 — 표시는 상태에 따라) */
  cost: number;
  /** 골드 부족 진행 링 = min(1, gold / cost) */
  progress: number;
}

export interface TechPlayerLike {
  techMask: number;
  techCount: number;
  gold: number;
}

/**
 * 한 노드의 상태. 우선순위: 보유 → 요청 중(서버 확인 전) → 잠김(부모 미보유) → 구매 가능(gold ≥ cost) → 골드 부족.
 * pending 은 클릭 후 cmd_ack 를 기다리는 노드 id 집합 (store.pendingTechNodes).
 */
export function techNodeState(p: TechPlayerLike, node: TechNodeDef, nodes: readonly TechNodeDef[], cost: number, pending?: ReadonlySet<number>): TechNodeState {
  if (techOwned(p.techMask, node.id)) return 'owned';
  if (pending?.has(node.id)) return 'pending';
  if (techExclusiveBlocker(p.techMask, node.id, nodes) !== null) return 'blocked';
  if (!techPrereqMet(p.techMask, node.id, nodes)) return 'locked';
  return p.gold >= cost ? 'buyable' : 'short';
}

export function techNodeViews(p: TechPlayerLike, consts?: Consts, pending?: ReadonlySet<number>): TechNodeView[] {
  const nodes = techNodes(consts);
  return nodes.map((node) => {
    const cost = techCost(node.tier, p.techCount, consts);
    return { node, cost, state: techNodeState(p, node, nodes, cost, pending), progress: cost > 0 ? Math.min(1, Math.max(0, p.gold / cost)) : 1 };
  });
}

/** 지금 살 수 있는 노드 수 (HUD 버튼 배지) */
export function purchasableCount(p: TechPlayerLike, consts?: Consts): number {
  return techNodeViews(p, consts).filter((v) => v.state === 'buyable').length;
}

/** 갈래별 "살 수 있음" 여부 (모바일 탭 점) */
export function purchasableByBranch(views: readonly TechNodeView[]): boolean[] {
  const out = new Array<boolean>(TECH_BRANCH_COUNT).fill(false);
  for (const v of views) if (v.state === 'buyable') out[v.node.branch] = true;
  return out;
}

// ───────────── 가격 ─────────────

export interface TechPriceInfo {
  cost: number;
  base: number;
  /** 지금까지 산 노드 수 (= 누진 n) */
  purchased: number;
  /** 누진 가산 % (= 6 × n) */
  surchargePct: number;
  /** 한 번 더 사면 이 노드 가격 */
  nextCost: number;
}

export function techPriceInfo(tier: number, techCount: number, consts?: Consts): TechPriceInfo {
  const base = techCost(tier, 0, consts);
  const coef = c(consts, 'TECH_PROGRESSIVE_COEF_PERMILLE', 60);
  return {
    cost: techCost(tier, techCount, consts),
    base,
    purchased: techCount,
    surchargePct: (coef * techCount) / 10,
    nextCost: techCost(tier, techCount + 1, consts),
  };
}

/** 골드가 모자랄 때 모일 때까지 걸리는 초 (참고치). 이미 충분하면 0, 순수입 ≤ 0 이면 null */
export function secondsToAfford(gold: number, cost: number, netPerSec: number): number | null {
  if (gold >= cost) return 0;
  if (!(netPerSec > 0)) return null;
  return Math.ceil((cost - gold) / netPerSec);
}

/** 대기 시간 표시 — 15분 넘으면 사실상 "모이지 않음" */
export function fmtWait(sec: number): string {
  if (sec >= 900) return '15분 넘게 걸림';
  if (sec < 60) return `약 ${sec}초 후`;
  return `약 ${Math.floor(sec / 60)}분 ${sec % 60}초 후`;
}

// ───────────── 상세 패널 수치 ─────────────

export interface StatRow {
  label: string;
  before: string;
  after: string;
  /** 값이 바뀌는 행인가 (강조) */
  changed: boolean;
}

export interface TechDetailCtx {
  consts?: Consts;
  techMask: number;
  /** 병력 상한 / 깃발 슬롯 실제 값 (GameModel.troopCapOf / flagCapOf) — 없으면 생략 */
  troopCap?: (mask: number) => number;
  flagCap?: (mask: number) => number;
}

const x2 = (pm: number) => `×${(pm / 1000).toFixed(2)}`;
const x3 = (pm: number) => `×${(pm / 1000).toFixed(3)}`;
const pmText = (pm: number) => `${pm}‰`;

/** 스탯 하나의 주 행 (라벨 + 서식) */
function primaryRow(stat: number, before: number[], after: number[], consts: Consts): StatRow {
  const S = TECH_STAT;
  const ATK = c<readonly number[]>(consts, 'UNIT_ATK_PERMILLE', UNIT_ATK_PERMILLE);
  const DEF = c<readonly number[]>(consts, 'UNIT_DEF_PERMILLE', UNIT_DEF_PERMILLE);
  const u = (base: number) => UNIT_NAME[stat - base];
  let label: string;
  let fmt: (v: number[]) => string;
  if (stat === S.ATK_COST) (label = '적 땅 점령비용 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.DEF_COST) (label = '내 땅 피점령비용 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.COMBAT_ATK) (label = '공격 점수 (전 병종)'), (fmt = (v) => `+${v[stat]}`);
  else if (stat === S.COMBAT_DEF) (label = '방어 점수 (전 병종)'), (fmt = (v) => `+${v[stat]}`);
  else if (stat === S.GOLD) (label = '골드 생산 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.UPKEEP_COEF) (label = '깃발 유지비 계수'), (fmt = (v) => pmText(v[stat]));
  else if (stat === S.REGEN) (label = '병력 재생 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.NEUTRAL_COST) (label = '중립 땅 점령비용 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.TROOP_CAP) (label = '병력 상한 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.SUPPLY_COEF) (label = '보급선 비용 계수 (칸당)'), (fmt = (v) => pmText(v[stat]));
  else if (stat === S.SPEED) (label = '이동 점수 (전 병종 공통)'), (fmt = (v) => `+${v[stat]}`);
  // v4.5 (§22.7): 스탯 11 = 이탈 대기 tick (MOB-3B 철수 훈련 15 → 10), 13 = 귀환 속도 ‰ (MOB-1 1700, MOB-2B 급속 귀환 2000)
  else if (stat === S.DISENGAGE_TICKS) (label = '이탈 대기 시간'), (fmt = (v) => `${((v[stat] * ((consts?.TICK_MS as number | undefined) ?? 200)) / 1000).toFixed(1)}초`);
  else if (stat === S.SLOT_BONUS) (label = '깃발 슬롯 보너스'), (fmt = (v) => `+${v[stat]}`);
  else if (stat === S.ORDER_COOLDOWN) (label = '재지정·태세 전환 쿨타임'), (fmt = (v) => `${((v[stat] * ((consts?.TICK_MS as number | undefined) ?? 200)) / 1000).toFixed(1)}초`);
  else if (stat === S.RETURN_SPEED) (label ='귀환 속도 배율 (회수·자동 귀환·패주)'), (fmt = (v) => x2(v[stat]));
  else if (stat >= S.COMBAT_ATK_SPEAR && stat <= S.COMBAT_ATK_CAVALRY) {
    const unit = stat - S.COMBAT_ATK_SPEAR;
    label = `${u(S.COMBAT_ATK_SPEAR)} 공격`;
    fmt = (v) => String(Math.round(ATK[unit] / TECH_POINT_PERMILLE) + techCombatPts(v, unit, false));
  } else if (stat >= S.COMBAT_DEF_SPEAR && stat <= S.COMBAT_DEF_CAVALRY) {
    const unit = stat - S.COMBAT_DEF_SPEAR;
    label = `${u(S.COMBAT_DEF_SPEAR)} 방어`;
    fmt = (v) => String(Math.round(DEF[unit] / TECH_POINT_PERMILLE) + techCombatPts(v, unit, true));
  } else if (stat >= S.SPEED_SPEAR && stat <= S.SPEED_CAVALRY) {
    const unit = stat - S.SPEED_SPEAR;
    label = `${u(S.SPEED_SPEAR)} 이동`;
    fmt = (v) => String(Math.round(c<readonly number[]>(consts, 'UNIT_SPEED_PERMILLE', UNIT_SPEED_PERMILLE)[unit] / TECH_POINT_PERMILLE) + techSpeedPts(v, unit));
  } else if (stat >= S.UPKEEP_WEIGHT_SPEAR && stat <= S.UPKEEP_WEIGHT_CAVALRY) (label = `${u(S.UPKEEP_WEIGHT_SPEAR)} 유지비 가중치`), (fmt = (v) => (v[stat] / 1000).toFixed(2));
  else if (stat >= S.CONVERT_SPEAR && stat <= S.CONVERT_CAVALRY) (label = `${u(S.CONVERT_SPEAR)} 편성비 (병력 1당 풀 차감)`), (fmt = (v) => x2(v[stat]));
  else if (stat >= S.CAPTURE_MULT_SPEAR && stat <= S.CAPTURE_MULT_CAVALRY) (label = `${u(S.CAPTURE_MULT_SPEAR)} 점령 소모 배율`), (fmt = (v) => x2(v[stat]));
  // 2026-10-24: 사기(전투 모델 2)·기지 효과
  else if (stat === S.MORALE_DROP) (label = '사기 감소율 (전 병종)'), (fmt = (v) => x2(v[stat]));
  else if (stat >= S.MORALE_DROP_SPEAR && stat <= S.MORALE_DROP_CAVALRY) (label = `${u(S.MORALE_DROP_SPEAR)} 사기 감소율`), (fmt = (v) => x2(v[S.MORALE_DROP] + v[stat]));
  else if (stat === S.MORALE_RECOVER) (label = '사기 회복 (전 병종)'), (fmt = (v) => x2(v[stat]));
  else if (stat >= S.MORALE_RECOVER_SPEAR && stat <= S.MORALE_RECOVER_CAVALRY) (label = `${u(S.MORALE_RECOVER_SPEAR)} 사기 회복`), (fmt = (v) => x2(v[S.MORALE_RECOVER] + v[stat]));
  else if (stat === S.MORALE_FULL_BONUS) (label = '기세 보너스 (전 병종)'), (fmt = (v) => `+${v[stat] / 10}%p`);
  else if (stat >= S.MORALE_FULL_BONUS_SPEAR && stat <= S.MORALE_FULL_BONUS_CAVALRY) (label = `${u(S.MORALE_FULL_BONUS_SPEAR)} 기세 보너스`), (fmt = (v) => `+${(v[S.MORALE_FULL_BONUS] + v[stat]) / 10}%p`);
  else if (stat === S.BASE_DMG) (label = '기지 체력 피해 배율'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.BASE_RECOVER) (label = '기지 생산력 회복 속도'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.BASE_PROD) (label = '기지 생산 배율 (모든 기지)'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.BASE_GOLD) (label = '기지 골드 배율 (모든 기지)'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.GOLD_PLAIN) (label = '평지·비옥·언덕 영토 골드 보너스'), (fmt = (v) => `+${v[stat] / 10}%`);
  else if (stat === S.GOLD_POOR) (label = '사막·산 영토 골드 보너스'), (fmt = (v) => `+${v[stat] / 10}%`);
  else if (stat === S.CONVERT) (label = '편성비 배율 (전 병종)'), (fmt = (v) => x2(v[stat]));
  else if (stat === S.SIEGE) (label = '적 기지 공격 피해 배율'), (fmt = (v) => x2(v[stat]));
  else (label = `스탯 ${stat}`), (fmt = (v) => String(v[stat]));
  const b = fmt(before);
  const a = fmt(after);
  return { label, before: b, after: a, changed: b !== a };
}

/** 공통 전투 배율 노드(MIL-2A/3B)의 병종별 실제 전투값 행 */
function combatUnitsRow(defend: boolean, before: number[], after: number[], consts: Consts): StatRow {
  const base = defend ? c<readonly number[]>(consts, 'UNIT_DEF_PERMILLE', UNIT_DEF_PERMILLE) : c<readonly number[]>(consts, 'UNIT_ATK_PERMILLE', UNIT_ATK_PERMILLE);
  const val = (v: number[]) => [0, 1, 2].map((u) => Math.round(base[u] / TECH_POINT_PERMILLE) + techCombatPts(v, u, defend)).join(' / ');
  const b = val(before);
  const a = val(after);
  return { label: `${defend ? '방어' : '공격'} 창 / 검 / 기`, before: b, after: a, changed: b !== a };
}

export interface TechDetail {
  /** 보유 노드 = "없을 때 → 있을 때", 미보유 = "지금 → 구매 후" */
  owned: boolean;
  rows: StatRow[];
  beforeLabel: string;
  afterLabel: string;
}

/** 상세 패널 수치 행. 다른 보유 노드까지 합친 실제 값(§19.3 techStatValues) */
export function techDetailRows(node: TechNodeDef, ctx: TechDetailCtx): TechDetail {
  const owned = techOwned(ctx.techMask, node.id);
  const maskBefore = owned ? techMaskWithout(ctx.techMask, node.id) : ctx.techMask;
  const maskAfter = techMaskWith(maskBefore, node.id);
  const before = techStatsOf(maskBefore, ctx.consts);
  const after = techStatsOf(maskAfter, ctx.consts);
  const S = TECH_STAT;
  const rows: StatRow[] = [primaryRow(node.stat, before, after, ctx.consts)];
  if (node.stat === S.COMBAT_ATK) rows.push(combatUnitsRow(false, before, after, ctx.consts));
  if (node.stat === S.COMBAT_DEF) rows.push(combatUnitsRow(true, before, after, ctx.consts));
  if (node.stat === S.TROOP_CAP && ctx.troopCap) {
    const b = ctx.troopCap(maskBefore);
    const a = ctx.troopCap(maskAfter);
    rows.push({ label: '병력 상한 (지금 영토 기준)', before: b.toLocaleString(), after: a.toLocaleString(), changed: a !== b });
  }
  if (node.stat === S.SLOT_BONUS && ctx.flagCap) {
    const b = ctx.flagCap(maskBefore);
    const a = ctx.flagCap(maskAfter);
    rows.push({ label: '깃발 슬롯 (상한 7)', before: String(b), after: String(a), changed: a !== b });
  }
  return { owned, rows, beforeLabel: owned ? '없을 때' : '지금', afterLabel: owned ? '보유' : '구매 후' };
}

/** 노드가 어디에 적용되는지 한 줄 (상세 패널 "어디에 적용") */
export function techScopeText(node: TechNodeDef): string {
  const S = TECH_STAT;
  const s = node.stat;
  if (s >= S.COMBAT_ATK_SPEAR && s <= S.CAPTURE_MULT_CAVALRY) {
    const unit = (s - S.COMBAT_ATK_SPEAR) % 3;
    return `${UNIT_NAME[unit]} 깃발에만 적용`;
  }
  if ((s >= S.MORALE_FULL_BONUS_SPEAR && s <= S.MORALE_FULL_BONUS_CAVALRY) || (s >= S.MORALE_DROP_SPEAR && s <= S.MORALE_DROP_CAVALRY) || (s >= S.MORALE_RECOVER_SPEAR && s <= S.MORALE_RECOVER_CAVALRY)) {
    return `${UNIT_NAME[(s - S.MORALE_FULL_BONUS_SPEAR) % 4]} 깃발에만 적용`;
  }
  if (s === S.BASE_DMG || s === S.BASE_RECOVER || s === S.BASE_PROD || s === S.BASE_GOLD) return '내 기지에 적용';
  if (s === S.GOLD_PLAIN || s === S.GOLD_POOR) return '해당 지형의 내 영토에 적용';
  if (s === S.GOLD) return '내 모든 영토에 적용';
  if (s === S.SIEGE) return '적 기지를 공격할 때';
  if (s === S.COMBAT_ATK) return '공격 태세 깃발이 적 깃발과 싸울 때 (모든 병종)';
  if (s === S.COMBAT_DEF) return '방어 태세 깃발이 적 깃발과 싸울 때 (모든 병종)';
  if (s === S.DISENGAGE_TICKS) return '교전 중 회수·재지정으로 빠져나갈 때';
  if (s === S.ORDER_COOLDOWN) return '깃발을 재지정하거나 태세를 바꾼 뒤 (모든 깃발)';
  if (s === S.RETURN_SPEED) return '회수·자동 귀환·패주로 기지에 돌아갈 때';
  return '모든 깃발·영토에 적용';
}

// ───────────── 격자 배치 (안 A / 모바일 안 B 공용) ─────────────

export interface TechNodePos {
  id: number;
  branch: number;
  tier: number;
  /** 갈래 열 안 가로 위치 0..1 (T1 = 0.5, T2 = 0.25 / 0.75, T3 = 부모 위치) */
  fx: number;
}

/** 열 안 위치. 같은 부모의 형제는 id 순서대로 왼쪽 → 오른쪽 */
export function techLayout(nodes: readonly TechNodeDef[]): TechNodePos[] {
  const fx = new Map<number, number>();
  const sorted = [...nodes].sort((a, b) => a.tier - b.tier || a.id - b.id);
  for (const n of sorted) {
    if (n.parent === null) {
      const roots = nodes.filter((m) => m.branch === n.branch && m.parent === null);
      fx.set(n.id, (roots.indexOf(n) + 1) / (roots.length + 1));
      continue;
    }
    const sibs = nodes.filter((m) => m.parent === n.parent).sort((a, b) => a.id - b.id);
    const parentX = fx.get(n.parent) ?? 0.5;
    if (n.tier === 4) fx.set(n.id, 0.5); // T4 는 두 T3 한가운데 (부모·대체 부모 둘 다에서 선이 내려온다)
    else if (n.tier === 2) fx.set(n.id, sibs.length === 1 ? parentX : 0.25 + (0.5 * sibs.indexOf(n)) / (sibs.length - 1));
    else fx.set(n.id, sibs.length === 1 ? parentX : parentX + (sibs.indexOf(n) - (sibs.length - 1) / 2) * 0.2);
  }
  return nodes.map((n) => ({ id: n.id, branch: n.branch, tier: n.tier, fx: fx.get(n.id) ?? 0.5 }));
}

/** 루트까지의 선행 경로 (hover 강조) — 자기 자신 포함 */
export function techAncestors(nodes: readonly TechNodeDef[], id: number): Set<number> {
  const out = new Set<number>();
  let cur: number | null = id;
  while (cur !== null && !out.has(cur)) {
    out.add(cur);
    cur = nodes[cur]?.parent ?? null;
  }
  const alt = nodes[id]?.parentAlt;
  if (alt !== undefined) out.add(alt);
  return out;
}
