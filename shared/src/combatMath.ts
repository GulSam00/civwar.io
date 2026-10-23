/**
 * 전투 모델 2 순수 함수 (§33, 설계 05_combat_redesign_draft.md rev.4 의 2절·5절) — 서버·봇·클라이언트 공용.
 * 상태 비의존: 입력 구조체만 받는다. 정수 연산만(floor), 단계마다 floor, Math.random·부동소수 누적 없음.
 *
 *   a_c(f)   = 채널값 (ATK, DEF)             — channelValues
 *   V_c(s)   = 편 채널값 (병력 가중 평균)     — sideLossDetail
 *   λ_c(s)   = 채널별 대비 비율 (γ=2)         — 10^6 * (10^12 / V^2) / Σ(...)
 *   raw(s)   = ω_ATK λ_ATK + ω_DEF λ_DEF
 *   loss(s)  = floor(T * raw(s) / Σraw)       — T = 편 수 * L (총량 불변)
 */
import { BASE_BUFF, CHANNEL_COUNT, COMBAT_VMIN, DISENGAGE_VALUE_PERMILLE_V2, MORALE_FLOOR, MORALE_FULL, MORALE_MAX, MORALE_MULT_CAP, POSTURE_W, TERRAIN_BUFF, UNIT_STAT } from './constants.js';
import { techChannelPm, techMoraleFullBonus } from './tech.js';

/** 깃발 한 개의 전투 입력 (서버 Flag / 클라이언트 FlagSnapshot 에서 만든다) */
export interface CombatFlagInput {
  unit: number; // UNIT 0..2
  posture: number; // POSTURE 0 공격 / 1 방어
  terrain: number; // 깃발이 서 있는 칸의 TERRAIN
  onOwnBase: boolean; // 자기 소유 기지(수도 포함) 칸 위
  troopsMilli: number;
  morale: number; // 0..1000
  disengage: boolean; // 이탈 대기 중
  statPm: readonly number[]; // 소유자 테크 스탯 (TECH_STAT 인덱스)
}

const DEFAULT_STAT: readonly number[] = [];

/** 사기 곱 ‰ = min(CAP, FLOOR + floor((FULL(unit) - FLOOR) * m / 1000)), FULL(unit) = 1100 + 테크 기세 가산. m=1000 -> 1100, 800 -> 1000, 0 -> 600 */
export function moraleMultiplier(unit: number, morale: number, statPm: readonly number[] = DEFAULT_STAT): number {
  const full = MORALE_FULL + techMoraleFullBonus(statPm, unit);
  const m = Math.max(0, Math.min(MORALE_MAX, morale));
  const mult = MORALE_FLOOR + Math.floor(((full - MORALE_FLOOR) * m) / 1000);
  return Math.max(1, Math.min(MORALE_MULT_CAP, mult));
}

/** 채널값 a_c(f) (2.2) — [ATK, DEF]. 단계마다 floor, 최소 1 */
export function channelValues(f: CombatFlagInput): number[] {
  const out: number[] = new Array(CHANNEL_COUNT);
  const stat = f.statPm.length ? f.statPm : null;
  const mm = moraleMultiplier(f.unit, f.morale, f.statPm);
  for (let c = 0; c < CHANNEL_COUNT; c++) {
    const b = f.onOwnBase ? BASE_BUFF[f.posture][c] : TERRAIN_BUFF[f.terrain][f.posture][c];
    let x = Math.floor((UNIT_STAT[c][f.unit] * b) / 1000);
    if (stat) x = Math.floor((x * techChannelPm(stat, f.unit, c)) / 1000);
    x = Math.floor((x * mm) / 1000);
    if (f.disengage) x = Math.floor((x * DISENGAGE_VALUE_PERMILLE_V2) / 1000);
    out[c] = Math.max(1, x);
  }
  return out;
}

/** 호환 스칼라 (ω 가중 평균, 사기 포함) — combat_started.power 와 flagValue 의 모델 2 값. 최소 1 */
export function flagScalar(f: CombatFlagInput): number {
  const a = channelValues(f);
  const w = POSTURE_W[f.posture];
  return Math.max(1, Math.floor((w[0] * a[0] + w[1] * a[1]) / 1000));
}

export interface CombatSideDetail {
  troopsMilli: number;
  /** V_ATK, V_DEF (편 채널값, 하한 COMBAT_VMIN) */
  atk: number;
  def: number;
  /** ω_ATK (‰) — ω_DEF = 1000 - omegaA */
  omegaA: number;
  /** 병력 가중 평균 사기 ‰ */
  morale: number;
  /** 호환 스칼라 power (ω 평균, 병력 가중) */
  power: number;
  raw: number;
  /** 이번 tick 편 손실 (milli, 병력 상한 적용 후) */
  lossMilli: number;
  /** 편 손실 비율 ‰ = floor(raw * 1000 / Σraw) (표시용) */
  lossPermille: number;
}

function mulDiv(a: number, b: number, c: number): number {
  const p = a * b;
  if (Number.isSafeInteger(p)) return Math.floor(p / c);
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/**
 * 편별 손실 (2.3~2.5). sides = 편마다 깃발 입력 배열 (편 key ASC 순서로 넘길 것 — 잔여 milli 는 앞 편부터 1씩).
 * T = 이번 tick 총 손실량(milli) = 편 수 * L (호출자가 현행 L 식으로 계산, 불변).
 */
export function sideLossDetail(sides: readonly (readonly CombatFlagInput[])[], T: number): CombatSideDetail[] {
  const n = sides.length;
  const prelim = sides.map((flags) => {
    let sum = 0;
    let wA = 0;
    let mor = 0;
    let pw = 0;
    const vs = new Array(CHANNEL_COUNT).fill(0);
    for (const f of flags) {
      const a = channelValues(f);
      sum += f.troopsMilli;
      wA += f.troopsMilli * POSTURE_W[f.posture][0];
      mor += f.troopsMilli * f.morale;
      const w = POSTURE_W[f.posture];
      pw += f.troopsMilli * Math.max(1, Math.floor((w[0] * a[0] + w[1] * a[1]) / 1000));
      for (let c = 0; c < CHANNEL_COUNT; c++) vs[c] += f.troopsMilli * a[c];
    }
    const d = Math.max(1, sum);
    return {
      troopsMilli: sum,
      v: vs.map((x: number) => Math.max(COMBAT_VMIN, Math.floor(x / d))),
      omegaA: Math.floor(wA / d),
      morale: Math.floor(mor / d),
      power: Math.max(1, Math.floor(pw / d)),
    };
  });
  // 채널별 대비 (γ = 2): inv = floor(10^12 / V^2), λ = floor(10^6 * inv / Σinv)
  const lam: number[][] = prelim.map(() => new Array(CHANNEL_COUNT).fill(0));
  for (let c = 0; c < CHANNEL_COUNT; c++) {
    const inv = prelim.map((p) => Math.floor(1e12 / (p.v[c] * p.v[c])));
    const sumInv = inv.reduce((a, b) => a + b, 0);
    prelim.forEach((_, i) => (lam[i][c] = Math.floor((1e6 * inv[i]) / sumInv)));
  }
  const raw = prelim.map((p, i) => p.omegaA * lam[i][0] + (1000 - p.omegaA) * lam[i][1]);
  const sumRaw = raw.reduce((a, b) => a + b, 0);
  const loss = raw.map((r) => (sumRaw > 0 ? mulDiv(T, r, sumRaw) : Math.floor(T / n)));
  let rem = T - loss.reduce((a, b) => a + b, 0);
  for (let i = 0; rem > 0; i = (i + 1) % n, rem--) loss[i] += 1;
  return prelim.map((p, i) => ({
    troopsMilli: p.troopsMilli,
    atk: p.v[0],
    def: p.v[1],
    omegaA: p.omegaA,
    morale: p.morale,
    power: p.power,
    raw: raw[i],
    lossMilli: Math.min(loss[i], p.troopsMilli),
    lossPermille: sumRaw > 0 ? Math.floor((raw[i] * 1000) / sumRaw) : Math.floor(1000 / n),
  }));
}

/** 편별 손실(milli)만 — 서버 4a, 봇, 클라이언트 예상 UI 가 같은 함수를 쓴다 */
export function sideLossShares(sides: readonly (readonly CombatFlagInput[])[], T: number): number[] {
  return sideLossDetail(sides, T).map((d) => d.lossMilli);
}

/**
 * 현행 L / T 식 (4.15 d, 모델 1·2 공통): L = max(floor(S*LOSS_BP/(n*10000)), floor(R*FLOOR_BP/(n*10000)), MIN), T = 편 수 * L.
 * S = 무리 깃발 병력 합(milli), R = 무리 깃발 initialTroops 합 * 1000, n = 무리 깃발 수.
 */
export function groupTotalLoss(sMilli: number, rMilli: number, flagCount: number, sideCount: number, lossBp: number, floorBp: number, minMilli: number): number {
  const L = Math.max(Math.floor((sMilli * lossBp) / (flagCount * 10000)), Math.floor((rMilli * floorBp) / (flagCount * 10000)), minMilli);
  return sideCount * L;
}
