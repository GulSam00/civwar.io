/**
 * 자원·성장 (GDD 3.2 / 3.3 / 3.4). 정수 산술만 — Math.sqrt 는 isqrt 보정 후 정수로만 사용.
 */
import {
  FLAG_CAP_BASE,
  FLAG_CAP_HARD_MAX,
  FLAG_TILES_PER_SLOT,
  GARRISON_ESCALATE_MAX,
  GARRISON_UPKEEP_FREE_PERMILLE,
  GARRISON_UPKEEP_MAX_PERMILLE,
  GOLD_RATE_PERMILLE,
  POSTURE,
  REGEN_BASE_MILLI,
  REGEN_SQRT_COEF_PERMILLE,
  TECH_STAT,
  TROOP_CAP_BASE,
  TROOP_CAP_PER_TILE,
  techNodeCost,
  techUpkeepWeight,
} from '@civwar/shared';
import type { Flag, GameState, PlayerState } from './state.js';

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
  const capPm = p.statPm[TECH_STAT.TROOP_CAP];
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
  const regenPm = p.statPm[TECH_STAT.REGEN];
  // 최대 ≈ 35000 × 1060 × 7.6e7 ≈ 2.8e15 < 2^53 (12인 맵 전 육지 + 상한 ×1.14 기준)
  const num = baseMilli * regenPm * (capMilli - p.troopsMilli);
  const den = 1000 * capMilli;
  return divRound(num, den);
}

/** 그로스 골드 (milli/tick) = floor(goldWeight × GOLD_RATE × goldMult / 1e9) */
export function grossGoldMilliPerTick(p: Readonly<PlayerState>): number {
  const goldPm = p.statPm[TECH_STAT.GOLD];
  return Math.floor((p.goldWeight * GOLD_RATE_PERMILLE * goldPm) / 1_000_000_000);
}

/** 주둔(방어 태세 ENGAGED, 내 땅 앵커) — v4.2 이후 유지비와 무관. 9단계 calmTicks(누진, 비활성)만 쓴다 */
export function isGarrison(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  return f.state === 'ENGAGED' && f.posture === POSTURE.DEFEND && state.owners[f.anchorTileId] === f.ownerId;
}

/** v4.2 [A-60 변경, 사용자 2026-10-10]: 유지비 대상 = 출전한 깃발 전부(태세·상태 무관), 패주(병력 0) 제외 */
export function paysUpkeep(f: Readonly<Flag>): boolean {
  return !f.routed;
}

/**
 * 유지비 permille (GDD 4.4 a, v4.2 A-60 변경). 2단계에서 호출 → 1단계 명령 적용 후·4단계 이전 깃발 목록을 읽는다.
 * weight = Σ UNIT_GARRISON_PERMILLE[unit] (패주 제외 전 깃발) · escalate ≡ 1, billable = max(0, weight − 1000),
 * drainPm = min(700, floor(billable × 90 / 1000)).
 * v4.3: 가중치·계수는 플레이어 스탯 — UPKEEP_WEIGHT_<unit>(SPE-2A 450, CAV-3 1300), UPKEEP_COEF(ECO-2B 72). 상한 700 < 1000 → 순증 ≥ 그로스의 30% (순증 ≥ 0 보장 유지).
 */
export function garrisonUpkeepPermille(state: Readonly<GameState>, p: Readonly<PlayerState>): number {
  let w = 0;
  for (const f of state.flags) {
    if (f.ownerId !== p.id || !paysUpkeep(f)) continue;
    w += techUpkeepWeight(p.statPm, f.unit) * GARRISON_ESCALATE_MAX;
  }
  const billable = Math.max(0, w - GARRISON_UPKEEP_FREE_PERMILLE);
  return Math.min(GARRISON_UPKEEP_MAX_PERMILLE, Math.floor((billable * p.statPm[TECH_STAT.UPKEEP_COEF]) / 1000));
}

export function flagCap(p: Readonly<PlayerState>): number {
  const bonus = p.statPm[TECH_STAT.SLOT_BONUS]; // v4.3: 최대 +1 (MOB-3A)
  return Math.min(FLAG_CAP_HARD_MAX, FLAG_CAP_BASE + Math.floor(p.tiles / FLAG_TILES_PER_SLOT) + bonus);
}

/** v4.3 [A-69]: cost(tier, purchasedCount) = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + 60 × count) / 1000) — 골드 정수 단위 */
export function techCost(tier: number, purchasedCount: number): number {
  return techNodeCost(tier, purchasedCount);
}
