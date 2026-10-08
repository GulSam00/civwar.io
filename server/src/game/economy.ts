/**
 * 자원·성장 (GDD 3.2 / 3.3 / 3.4). 정수 산술만 — Math.sqrt 는 isqrt 보정 후 정수로만 사용.
 */
import {
  ECO_GOLD_PERMILLE_BY_TIER,
  ECO_REGEN_PERMILLE_BY_TIER,
  FLAG_CAP_BASE,
  FLAG_CAP_HARD_MAX,
  FLAG_TILES_PER_SLOT,
  GARRISON_ESCALATE_MAX,
  GARRISON_UPKEEP_FREE_PERMILLE,
  GARRISON_UPKEEP_MAX_PERMILLE,
  GARRISON_UPKEEP_PERMILLE,
  UNIT_GARRISON_PERMILLE,
  GOLD_RATE_PERMILLE,
  MOB_SLOT_BONUS_BY_TIER,
  REGEN_BASE_MILLI,
  REGEN_SQRT_COEF_PERMILLE,
  TECH_AXIS,
  TECH_BASE_COST,
  TECH_PROGRESSIVE_COEF_PERMILLE,
  TER_CAP_PERMILLE_BY_TIER,
  TROOP_CAP_BASE,
  TROOP_CAP_PER_TILE,
} from '@civwar/shared';
import type { GameState, PlayerState } from './state.js';

/** floor(sqrt(x)) — 정수 x ≥ 0. Math.sqrt 는 IEEE 정확 반올림이지만 경계 보정으로 플랫폼 무관 보장 */
export function isqrt(x: number): number {
  if (x <= 0) return 0;
  let s = Math.floor(Math.sqrt(x));
  while (s * s > x) s--;
  while ((s + 1) * (s + 1) <= x) s++;
  return s;
}

/** floor(a/b) 반올림판 (half-up), a,b > 0 정수 */
function divRound(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

export function troopCap(p: Readonly<PlayerState>): number {
  const capPm = TER_CAP_PERMILLE_BY_TIER[p.tech[TECH_AXIS.TERRITORY]];
  return Math.floor(((TROOP_CAP_BASE + TROOP_CAP_PER_TILE * p.tiles) * capPm) / 1000);
}

/**
 * regenPerTick × 1000 (milli 병력/tick)
 *   = round( (0.8 + 0.5·√tiles) · regenMult · (1 − troops/cap) · 1000 )
 * 정수화: √tiles 는 milli 정밀도(isqrt(tiles·10⁶)), 로지스틱 항은 milli 병력 비율.
 */
export function regenMilliPerTick(p: Readonly<PlayerState>): number {
  const capMilli = troopCap(p) * 1000;
  if (capMilli <= 0 || p.troopsMilli >= capMilli) return 0;
  const sqrtMilli = isqrt(p.tiles * 1_000_000);
  const baseMilli = REGEN_BASE_MILLI + Math.floor((REGEN_SQRT_COEF_PERMILLE * sqrtMilli) / 1000);
  const regenPm = ECO_REGEN_PERMILLE_BY_TIER[p.tech[TECH_AXIS.ECONOMY]];
  // 최대 ≈ 35000 × 1200 × 7.6e7 ≈ 3.2e15 < 2^53 (12인 맵 전 육지 + 영토 T3 기준)
  const num = baseMilli * regenPm * (capMilli - p.troopsMilli);
  const den = 1000 * capMilli;
  return divRound(num, den);
}

/** 그로스 골드 (milli/tick) = floor(goldWeight × GOLD_RATE × goldMult / 1e9) */
export function grossGoldMilliPerTick(p: Readonly<PlayerState>): number {
  const goldPm = ECO_GOLD_PERMILLE_BY_TIER[p.tech[TECH_AXIS.ECONOMY]];
  return Math.floor((p.goldWeight * GOLD_RATE_PERMILLE * goldPm) / 1_000_000_000);
}

/**
 * 주둔 유지비 permille (GDD 4.4 a). 2단계에서 호출 → 직전 tick 종료 시점 상태를 읽는다(1 tick 지연, 의도된 고정 규칙).
 * isGarrison(f) = ENGAGED ∧ tile[anchor].owner == f.ownerId. escalate(f) ≡ 1 (GARRISON_ESCALATE_MAX = 1, 사용자 기각).
 */
export function garrisonUpkeepPermille(state: Readonly<GameState>, p: Readonly<PlayerState>): number {
  let w = 0;
  for (const f of state.flags) {
    if (f.ownerId !== p.id || f.state !== 'ENGAGED' || state.owners[f.anchorTileId] !== p.id) continue;
    w += UNIT_GARRISON_PERMILLE[f.unit] * GARRISON_ESCALATE_MAX;
  }
  const billable = Math.max(0, w - GARRISON_UPKEEP_FREE_PERMILLE);
  return Math.min(GARRISON_UPKEEP_MAX_PERMILLE, Math.floor((billable * GARRISON_UPKEEP_PERMILLE) / 1000));
}

export function flagCap(p: Readonly<PlayerState>): number {
  const bonus = MOB_SLOT_BONUS_BY_TIER[p.tech[TECH_AXIS.MOBILITY]];
  return Math.min(FLAG_CAP_HARD_MAX, FLAG_CAP_BASE + Math.floor(p.tiles / FLAG_TILES_PER_SLOT) + bonus);
}

/** cost(tier, purchasedCount) = floor(BASE[tier] × (1000 + 250 × count) / 1000) — 골드 정수 단위 */
export function techCost(tier: number, purchasedCount: number): number {
  return Math.floor((TECH_BASE_COST[tier - 1] * (1000 + TECH_PROGRESSIVE_COEF_PERMILLE * purchasedCount)) / 1000);
}
