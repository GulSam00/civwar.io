/**
 * 자원·성장 (GDD 3.2 / 3.3 / 3.4). 정수 산술만 — Math.sqrt 는 isqrt 보정 후 정수로만 사용.
 */
import {
  FLAG_CAP_BASE,
  FLAG_CAP_HARD_MAX,
  FLAG_TILES_PER_SLOT,
  TICK_MS,
  UNIT_GARRISON_PERMILLE,
  UNIT_UPKEEP_RATE_MILLI,
  GOLD_RATE_PERMILLE,
  POSTURE,
  REGEN_BASE_MILLI,
  REGEN_SQRT_COEF_PERMILLE,
  PROD_REF_TILES,
  TECH_STAT,
  TERRAIN,
  TERRAIN_GOLD_MILLI,
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

/** v5.2 (§38): 총병력 milli = 기지 대기 병력 + 출전 중인 깃발 병력 합. 병력 상한·생산 로지스틱은 이 값을 본다 */
export function heldTroopsMilli(state: Readonly<GameState>, p: Readonly<PlayerState>): number {
  let held = p.troopsMilli;
  for (const f of state.flags) if (f.ownerId === p.id) held += f.troopsMilli;
  return held;
}

/** 영토 T 칸의 기본 재생 (milli/tick, 테크·로지스틱 전) = 0.8 + 0.5·√T — 정수 (isqrt milli 정밀도) */
export function terrRegenBaseMilli(tiles: number): number {
  return REGEN_BASE_MILLI + Math.floor((REGEN_SQRT_COEF_PERMILLE * isqrt(tiles * 1_000_000)) / 1000);
}

/** v4.5 [A-103]: 기지 병력 생산 칸당 기준 = 기준 영토 PROD_REF_TILES 칸의 평균 재생. 상수에서 결정 (milli/tick × PROD_REF_TILES 분모) */
export const PROD_REF_REGEN_MILLI = terrRegenBaseMilli(PROD_REF_TILES);

/**
 * v4.5 [A-103]: 기지 한 칸의 기본 병력 생산 (milli/tick, 테크·로지스틱 전) = floor(eqTiles × prodPm × PROD_REF_REGEN_MILLI / (PROD_REF_TILES × 1000)).
 * eqTiles = BASE_PROD_TILES 60 / CAPITAL_PROD_TILES 100. 무테크 생산력 1000 → 기지 1642, 수도 2736 milli/tick (= 8.2 / 13.7 병력/초)
 */
export function baseRegenBaseMilli(eqTiles: number, prodPm: number): number {
  return Math.floor((eqTiles * prodPm * PROD_REF_REGEN_MILLI) / (PROD_REF_TILES * 1000));
}

/** v4.5 [A-103]: 기지 한 칸의 골드 가중치 = 평원 eqTiles 칸 × 생산력 (milli) */
export function baseGoldWeight(eqTiles: number, prodPm: number): number {
  return Math.floor((eqTiles * TERRAIN_GOLD_MILLI[TERRAIN.PLAIN] * prodPm) / 1000);
}

/**
 * 기본 재생 합(milli/tick) 에 테크 배율·로지스틱 (1 − held/cap) 을 곱해 반올림 — regenMilliPerTick 과 같은 식.
 * v5.2 (§38): held = 총병력(대기 + 깃발, heldTroopsMilli). 총병력이 상한 이상이면 생산 0 (부드러운 상한 — 잘라내지 않는다).
 * 큰 나라 + 기지 다수에서 곱이 2^53 을 넘을 수 있어 BigInt 로 계산한다 (정수·결정론 그대로).
 */
export function applyRegenMult(p: Readonly<PlayerState>, baseMilli: number, heldMilli: number = p.troopsMilli): number {
  const capMilli = troopCap(p) * 1000;
  if (capMilli <= 0 || heldMilli >= capMilli || baseMilli <= 0) return 0;
  const num = BigInt(baseMilli) * BigInt(p.statPm[TECH_STAT.REGEN]) * BigInt(capMilli - heldMilli);
  const den = 1000n * BigInt(capMilli);
  return Number((2n * num + den) / (2n * den));
}

/**
 * regenPerTick × 1000 (milli 병력/tick) — 영토만 (v4.5: 기지 생산은 production.ts 가 더한다)
 *   = round( (0.8 + 0.5·√tiles) · regenMult · (1 − troops/cap) · 1000 )
 * 정수화: √tiles 는 milli 정밀도(isqrt(tiles·10⁶)), 로지스틱 항은 milli 병력 비율.
 */
export function regenMilliPerTick(p: Readonly<PlayerState>, heldMilli: number = p.troopsMilli): number {
  const capMilli = troopCap(p) * 1000;
  if (capMilli <= 0 || heldMilli >= capMilli) return 0;
  const sqrtMilli = isqrt(p.tiles * 1_000_000);
  const baseMilli = REGEN_BASE_MILLI + Math.floor((REGEN_SQRT_COEF_PERMILLE * sqrtMilli) / 1000);
  const regenPm = p.statPm[TECH_STAT.REGEN];
  // 최대 ≈ 35000 × 1060 × 7.6e7 ≈ 2.8e15 < 2^53 (12인 맵 전 육지 + 상한 ×1.14 기준)
  const num = baseMilli * regenPm * (capMilli - heldMilli);
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
/** 패치 7차: 그 플레이어의 병종 단가 (병력 1000명당 milli-골드/초) = 기본 단가 × 테크 가중치 / 기본 가중치 (마구간 1600/2000 = ×0.8) */
export function unitUpkeepRateMilli(stat: readonly number[], unit: number): number {
  return Math.floor((UNIT_UPKEEP_RATE_MILLI[unit] * techUpkeepWeight(stat, unit)) / UNIT_GARRISON_PERMILLE[unit]);
}

/**
 * 패치 7차: 유지비 milli-골드/tick = Σ (패주 제외 출전 깃발의 병력 × 병종 단가). 풀 병력은 무료, 무료 구간 없음.
 * 병력 1000명 × 단가 r(milli-골드/초) / 초당 tick → troopsMilli × r / (1000 × 1000 × TICKS_PER_SEC).
 */
export function garrisonUpkeepMilliPerTick(state: Readonly<GameState>, p: Readonly<PlayerState>): number {
  let num = 0;
  for (const f of state.flags) {
    if (f.ownerId !== p.id || !paysUpkeep(f)) continue;
    num += f.troopsMilli * unitUpkeepRateMilli(p.statPm, f.unit);
  }
  return Math.floor(num / (1000 * 1000 * (1000 / TICK_MS)));
}

export function flagCap(p: Readonly<PlayerState>): number {
  const bonus = p.statPm[TECH_STAT.SLOT_BONUS]; // v4.3: 최대 +1 (MOB-3A)
  return Math.min(FLAG_CAP_HARD_MAX, FLAG_CAP_BASE + Math.floor(p.tiles / FLAG_TILES_PER_SLOT) + bonus);
}

/** v4.3 [A-69]: cost(tier, purchasedCount) = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + 60 × count) / 1000) — 골드 정수 단위 */
export function techCost(tier: number, purchasedCount: number): number {
  return techNodeCost(tier, purchasedCount);
}
