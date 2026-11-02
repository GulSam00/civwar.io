/**
 * 사기 표시 (전투 모델 2, §33.4) — 순수 함수. React·Canvas 와 분리해 테스트한다.
 * 사기는 깃발 단위 0~1000‰, 곱은 shared `moraleMultiplier` (패치 12차: 병종별 범위 — 창 1.05~1.10 / 검 0.85~1.20 / 기 0.75~1.30).
 * 서버가 5 tick(1초)마다 보내는 값을 그대로 보인다 — 서버 값이 기준이므로 추정 보간은 하지 않는다.
 */
import { MORALE_BASE_FLOOR, MORALE_MAX, channelValues, moraleMultiplier, type CombatFlagInput, type FlagSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { techStatsOf } from './techInfo.js';
import { moraleNeutralPoint, moraleRange, moraleRates } from './unitStats.js';

/** 전투력 ±0 경계가 없는 병종(창병)의 막대 색 경계 ‰ — 다른 병종의 ±0 경계와 비슷한 자리 */
const MORALE_BAND_FALLBACK = 400;

export type MoraleTone = 'high' | 'mid' | 'low';

/** 사기 막대 구간 ‰ — mid 아래는 노랑, low 아래는 빨강. 눈금도 이 두 자리에 그린다 */
export interface MoraleBands {
  /** 전투력 ±0 경계 (창병은 MORALE_BAND_FALLBACK) */
  mid: number;
  /** mid 의 절반 */
  low: number;
}

export interface MoraleView {
  /** 0..1000 */
  value: number;
  /** 0..100 (막대 길이) */
  pct: number;
  bands: MoraleBands;
  /** 사기 곱 ‰ (예: 1100 = ×1.10) */
  multPm: number;
  /** 전투력 증감 % (예: +10, −40) */
  deltaPct: number;
  tone: MoraleTone;
  /** "사기 92% · 전투력 +7%" */
  text: string;
}

export function moraleOn(g: Pick<GameModel, 'config'>): boolean {
  return g.config.combatModel === 2;
}

/** 병종·테크별 사기 막대 구간 */
export function moraleBands(unit: number, stat: readonly number[]): MoraleBands {
  const mid = moraleNeutralPoint(unit, stat) ?? MORALE_BAND_FALLBACK;
  return { mid, low: Math.floor(mid / 2) };
}

export function moraleTone(value: number, bands: MoraleBands): MoraleTone {
  return value >= bands.mid ? 'high' : value >= bands.low ? 'mid' : 'low';
}

/** 이 깃발 소유자의 테크를 반영한 사기 막대 구간 */
export function flagMoraleBands(g: Pick<GameModel, 'players' | 'config'>, f: Pick<FlagSnapshot, 'ownerId' | 'unit'>): MoraleBands {
  return moraleBands(f.unit, techStatsOf(g.players.get(f.ownerId)?.techMask ?? 0, g.config.constants));
}

/** 모델 1(사기 개념 없음)이거나 값이 없으면 null */
export function moraleView(g: GameModel, f: FlagSnapshot): MoraleView | null {
  if (!moraleOn(g) || f.morale === undefined) return null;
  const value = Math.max(0, Math.min(MORALE_MAX, f.morale));
  const stat = techStatsOf(g.players.get(f.ownerId)?.techMask ?? 0, g.config.constants);
  const multPm = moraleMultiplier(f.unit, value, stat);
  const deltaPct = Math.round((multPm - 1000) / 10);
  const sign = deltaPct > 0 ? '+' : deltaPct < 0 ? '−' : '±';
  const bands = moraleBands(f.unit, stat);
  return {
    value,
    pct: Math.round(value / 10),
    bands,
    multPm,
    deltaPct,
    tone: moraleTone(value, bands),
    text: `사기 ${Math.round(value / 10)}% · 전투력 ${sign}${Math.abs(deltaPct)}%`,
  };
}

/** 서버 combatInput 과 같은 전투 입력 (지형을 모르면 null) — 채널값·교전 예상이 함께 쓴다 */
export function flagCombatInput(g: GameModel, f: FlagSnapshot): CombatFlagInput | null {
  if (!g.terrain) return null;
  return {
    unit: f.unit,
    posture: f.posture,
    terrain: g.terrain[f.posTileId],
    onOwnBase: g.bases.get(f.posTileId)?.ownerId === f.ownerId,
    troopsMilli: f.troops * 1000,
    morale: f.morale ?? MORALE_MAX,
    disengage: f.disengaging,
    statPm: techStatsOf(g.players.get(f.ownerId)?.techMask ?? 0, g.config.constants),
    debt: (g.players.get(f.ownerId)?.gold ?? 0) < 0, // 패치 6차: 서버 combatInput 과 같다
  };
}

/** 지금 이 깃발의 채널값 [공격, 방어] ‰ (지형·기지·사기·이탈 반영). 모델 1 이거나 지형을 모르면 null */
export function flagChannels(g: GameModel, f: FlagSnapshot): [number, number] | null {
  const input = moraleOn(g) ? flagCombatInput(g, f) : null;
  if (!input) return null;
  const [atk, def] = channelValues(input);
  return [atk, def];
}

/**
 * 사기가 바꾸는 것 전부 (2026-10-28 UI 개선 4) — 서버에서 사기가 쓰이는 곳은 채널값의 사기 곱 하나뿐이다(combatMath.channelValues):
 * 공격력·방어력이 같은 배율로 오르내리고, 교전 손실 분배(양쪽 공격·방어 비교)에 그대로 들어간다.
 * 그 밖에 보이는 값: 병종 사기 곱 범위, 전투력 ±0 이 되는 사기, 사기 증감 속도(교전·비전투·내 기지 위).
 */
export interface MoraleDetail {
  view: MoraleView;
  /** 지금 / 사기 100% 일 때 / 사기 0 일 때 채널값 [공격, 방어] ‰ (지형·기지·이탈·빚 반영). 지형을 모르면 null */
  now: [number, number] | null;
  full: [number, number] | null;
  empty: [number, number] | null;
  /** 사기 곱 범위 ‰ */
  floorPm: number;
  fullPm: number;
  /** 전투력 ±0 사기 (0..1000), 항상 보너스면 null */
  neutral: number | null;
  rates: ReturnType<typeof moraleRates>;
  /**
   * v5.1 (GDD 4.5 ③, §37.2): 자기 기지 칸(수도 포함) 위면 사기 하한 MORALE_BASE_FLOOR(300 = 30%), 아니면 null.
   * 300 미만이면 교전 중에도 300 까지 기지 회복 속도로 오르고, 이상이면 교전 감소·점령 소모가 300 에서 멈춘다 (패주는 예외).
   */
  baseFloor: number | null;
}

/** 이 깃발에 지금 걸린 기지 사기 하한 (모델 2 · 내 기지 칸 위) — 없으면 null */
export function moraleBaseFloor(g: GameModel, f: FlagSnapshot): number | null {
  if (!moraleOn(g) || g.bases.get(f.posTileId)?.ownerId !== f.ownerId) return null;
  return (g.config.constants?.MORALE_BASE_FLOOR as number | undefined) ?? MORALE_BASE_FLOOR;
}

export function moraleDetail(g: GameModel, f: FlagSnapshot): MoraleDetail | null {
  const view = moraleView(g, f);
  if (!view) return null;
  const stat = techStatsOf(g.players.get(f.ownerId)?.techMask ?? 0, g.config.constants);
  const input = flagCombatInput(g, f);
  const at = (morale: number): [number, number] | null => {
    if (!input) return null;
    const [a, d] = channelValues({ ...input, morale });
    return [a, d];
  };
  const r = moraleRange(f.unit, stat);
  return { view, now: at(view.value), full: at(MORALE_MAX), empty: at(0), floorPm: r.floor, fullPm: r.full, neutral: moraleNeutralPoint(f.unit, stat), rates: moraleRates(f.unit, stat), baseFloor: moraleBaseFloor(g, f) };
}
