/**
 * 테크 표시 정보 — v4.3 (32노드, techMask). 수치는 상수(match_config.constants 우선, 없으면 shared)에서 만든다 — 하드코딩 금지.
 * 백엔드 v4.3 전환 때 빌드를 유지하려고 최소한으로 맞춘 파일이다. 새 테크 화면(갈래 열 × 티어 격자, 상세 패널)은 프론트 작업에서 교체한다.
 */
import {
  GOLD_RATE_PERMILLE,
  TECH_NODE_BASE_COST,
  TECH_NODES,
  TECH_PROGRESSIVE_COEF_PERMILLE,
  TECH_STAT,
  TECH_STAT_BASE,
  TICK_MS,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  TECH_POINT_PERMILLE,
  techCombatPts,
  techNodeCost,
  techStatValues,
  type TechNodeDef,
} from '@civwar/shared';

type Consts = Record<string, unknown> | undefined;
function c<T>(consts: Consts, name: string, fallback: T): T {
  const v = consts?.[name];
  return (v === undefined ? fallback : v) as T;
}

export function techNodes(consts?: Consts): readonly TechNodeDef[] {
  return c(consts, 'TECH_NODES', TECH_NODES);
}

/** 플레이어 스탯 (인덱스 = TECH_STAT) — 서버 statPm 과 같은 식 */
export function techStatsOf(techMask: number, consts?: Consts): number[] {
  return techStatValues(techMask, techNodes(consts), c(consts, 'TECH_STAT_BASE', TECH_STAT_BASE));
}

/** 프로토콜 §19: cost = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + 60 × 보유 노드 수) / 1000) */
export function techCost(tier: number, techCount: number, consts?: Consts): number {
  return techNodeCost(tier, techCount, c(consts, 'TECH_NODE_BASE_COST', TECH_NODE_BASE_COST), c(consts, 'TECH_PROGRESSIVE_COEF_PERMILLE', TECH_PROGRESSIVE_COEF_PERMILLE));
}

/**
 * §8 골드: goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹), net = gross − floor(gross × upkeepPm / 1000).
 * goldPm = 스탯 GOLD (techMask 에서). 표시용 초당 값 (실수).
 */
export function goldPerSecond(goldWeight: number, techMask: number, upkeepPm: number, consts?: Consts): { gross: number; net: number } {
  const rate = c(consts, 'GOLD_RATE_PERMILLE', GOLD_RATE_PERMILLE);
  const gpm = techStatsOf(techMask, consts)[TECH_STAT.GOLD];
  const grossMilli = Math.floor((goldWeight * rate * gpm) / 1e9);
  const netMilli = grossMilli - Math.floor((grossMilli * upkeepPm) / 1000);
  const perSec = 1000 / c(consts, 'TICK_MS', TICK_MS);
  return { gross: (grossMilli * perSec) / 1000, net: (netMilli * perSec) / 1000 };
}

/**
 * 부대 전투값 (2026-10-14 사용자 요청: 부대 클릭 → 공격력·방어력, 지형 보정 제외).
 * 서버 flagValue(server/src/game/combat.ts)와 같은 단계별 floor:
 * 2026-10-24 절대 점수: 전투값(‰) = 병종 기본(‰) + 10 × 테크 점수 (techCombatPts = 군사 공통 + 병종 갈래).
 * 지형(방어 태세 언덕·산 등)·기지·이탈 대기 배율은 넣지 않는다. 화면에는 점수(= ‰ / 10)로 보인다.
 */
export interface UnitCombatStats {
  /** 공격 태세 전투값 ‰ */
  atk: number;
  /** 방어 태세 전투값 ‰ (지형 제외) */
  def: number;
  /** 병종 기본값 ‰ */
  atkBase: number;
  defBase: number;
  /** 테크 점수 (군사 + 병종 갈래) */
  atkTechPts: number;
  defTechPts: number;
}

export function unitCombatStats(unit: number, techMask: number, consts?: Consts): UnitCombatStats {
  const stat = techStatsOf(techMask, consts);
  const atkBase = c<readonly number[]>(consts, 'UNIT_ATK_PERMILLE', UNIT_ATK_PERMILLE)[unit] ?? 1000;
  const defBase = c<readonly number[]>(consts, 'UNIT_DEF_PERMILLE', UNIT_DEF_PERMILLE)[unit] ?? 1000;
  const atkTechPts = techCombatPts(stat, unit, false);
  const defTechPts = techCombatPts(stat, unit, true);
  return {
    atk: atkBase + TECH_POINT_PERMILLE * atkTechPts,
    def: defBase + TECH_POINT_PERMILLE * defTechPts,
    atkBase,
    defBase,
    atkTechPts,
    defTechPts,
  };
}

/** ‰ → 점수 (1000‰ = 100점) — 전투값 표시 */
export function fmtPts(pm: number): string {
  return String(Math.round(pm / TECH_POINT_PERMILLE));
}

/** ‰ → "×1.30" (소수 둘째 자리) */
export function fmtPm(pm: number): string {
  return `×${(pm / 1000).toFixed(2)}`;
}
