/**
 * 테크 4축 × 3단계 표시 정보 (GDD 3.4). 수치는 상수(match_config.constants 우선, 없으면 shared)에서 만든다 — 하드코딩 금지.
 */
import {
  COMBAT_WATER_VS_LAND_PERMILLE,
  COMBAT_WATER_VS_WATER_PERMILLE,
  ECO_GOLD_PERMILLE_BY_TIER,
  ECO_REGEN_PERMILLE_BY_TIER,
  GOLD_RATE_PERMILLE,
  MIL_ATK_COST_PERMILLE_BY_TIER,
  MIL_COMBAT_PERMILLE_BY_TIER,
  MIL_DEF_COST_PERMILLE_BY_TIER,
  MOB_CONVERT_PERMILLE_BY_TIER,
  MOB_SLOT_BONUS_BY_TIER,
  MOB_SPEED_PERMILLE_BY_TIER,
  SHALLOW_MOVE_PERMILLE_BY_TIER,
  SHALLOW_MOVE_PERMILLE_MIN,
  TECH_BASE_COST,
  TECH_PROGRESSIVE_COEF_PERMILLE,
  TER_CAP_PERMILLE_BY_TIER,
  TER_NEUTRAL_COST_PERMILLE_BY_TIER,
  TICK_MS,
  WATER_EXPOSURE_PERMILLE_BY_TIER,
} from '@civwar/shared';

export const TECH_NAME = ['군사', '경제', '영토', '기동'] as const;
export const TECH_BLURB = [
  '적 땅 공격·내 땅 방어, 깃발 전투력',
  '골드·병력 재생',
  '중립 땅 확장, 병력 상한',
  '깃발 속도·슬롯, 물 위 이동·전투',
] as const;

type Consts = Record<string, unknown> | undefined;
function c<T>(consts: Consts, name: string, fallback: T): T {
  const v = consts?.[name];
  return (v === undefined ? fallback : v) as T;
}
const x = (pm: number) => `×${+(pm / 1000).toFixed(3)}`;

/** 해당 축·단계의 효과 문구 (누적값) */
export function techEffects(axis: number, tier: number, consts?: Consts): string[] {
  switch (axis) {
    case 0:
      return [
        `적 땅 점령비용 ${x(c(consts, 'MIL_ATK_COST_PERMILLE_BY_TIER', MIL_ATK_COST_PERMILLE_BY_TIER)[tier])}`,
        `내 땅 피점령비용 ${x(c(consts, 'MIL_DEF_COST_PERMILLE_BY_TIER', MIL_DEF_COST_PERMILLE_BY_TIER)[tier])}`,
        `깃발 전투 실효값 ${x(c(consts, 'MIL_COMBAT_PERMILLE_BY_TIER', MIL_COMBAT_PERMILLE_BY_TIER)[tier])} (공격·방어)`,
      ];
    case 1:
      return [
        `골드 생산 ${x(c(consts, 'ECO_GOLD_PERMILLE_BY_TIER', ECO_GOLD_PERMILLE_BY_TIER)[tier])}`,
        `병력 재생 ${x(c(consts, 'ECO_REGEN_PERMILLE_BY_TIER', ECO_REGEN_PERMILLE_BY_TIER)[tier])}`,
      ];
    case 2:
      return [
        `중립 땅 점령비용 ${x(c(consts, 'TER_NEUTRAL_COST_PERMILLE_BY_TIER', TER_NEUTRAL_COST_PERMILLE_BY_TIER)[tier])}`,
        `병력 상한 ${x(c(consts, 'TER_CAP_PERMILLE_BY_TIER', TER_CAP_PERMILLE_BY_TIER)[tier])}`,
      ];
    case 3: {
      const shallow = Math.max(c(consts, 'SHALLOW_MOVE_PERMILLE_MIN', SHALLOW_MOVE_PERMILLE_MIN), c(consts, 'SHALLOW_MOVE_PERMILLE_BY_TIER', SHALLOW_MOVE_PERMILLE_BY_TIER)[tier]);
      return [
        `깃발 이동속도 ${x(c(consts, 'MOB_SPEED_PERMILLE_BY_TIER', MOB_SPEED_PERMILLE_BY_TIER)[tier])}`,
        `깃발 슬롯 +${c(consts, 'MOB_SLOT_BONUS_BY_TIER', MOB_SLOT_BONUS_BY_TIER)[tier]}`,
        `병종 전환 효율 ${x(c(consts, 'MOB_CONVERT_PERMILLE_BY_TIER', MOB_CONVERT_PERMILLE_BY_TIER)[tier])}`,
        `물 위 이동: 평지의 ${Math.round(100000 / shallow) / 100}배 속도`,
        `물 위 노출 소모 ${x(c(consts, 'WATER_EXPOSURE_PERMILLE_BY_TIER', WATER_EXPOSURE_PERMILLE_BY_TIER)[tier])}`,
        `상륙(물→땅) 공격력 ${x(c(consts, 'COMBAT_WATER_VS_LAND_PERMILLE', COMBAT_WATER_VS_LAND_PERMILLE)[tier])}, 물 대 물 ${x(c(consts, 'COMBAT_WATER_VS_WATER_PERMILLE', COMBAT_WATER_VS_WATER_PERMILLE)[tier])}`,
      ];
    }
  }
  return [];
}

/** 프로토콜 §4 cmd_buy_tech: cost = floor(TECH_BASE_COST[tier-1] × (1000 + 250 × 총구매수) / 1000) */
export function techCost(tier: number, tech: readonly number[], consts?: Consts): number {
  const bought = tech.reduce((a, b) => a + b, 0);
  const base = c(consts, 'TECH_BASE_COST', TECH_BASE_COST)[tier - 1];
  const coef = c(consts, 'TECH_PROGRESSIVE_COEF_PERMILLE', TECH_PROGRESSIVE_COEF_PERMILLE);
  return Math.floor((base * (1000 + coef * bought)) / 1000);
}

/**
 * §8 골드: goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹), net = gross − floor(gross × upkeepPm / 1000).
 * 표시용 초당 값 (실수).
 */
export function goldPerSecond(goldWeight: number, ecoTier: number, upkeepPm: number, consts?: Consts): { gross: number; net: number } {
  const rate = c(consts, 'GOLD_RATE_PERMILLE', GOLD_RATE_PERMILLE);
  const gpm = c(consts, 'ECO_GOLD_PERMILLE_BY_TIER', ECO_GOLD_PERMILLE_BY_TIER)[ecoTier];
  const grossMilli = Math.floor((goldWeight * rate * gpm) / 1e9);
  const netMilli = grossMilli - Math.floor((grossMilli * upkeepPm) / 1000);
  const perSec = 1000 / c(consts, 'TICK_MS', TICK_MS);
  return { gross: (grossMilli * perSec) / 1000, net: (netMilli * perSec) / 1000 };
}
