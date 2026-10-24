/**
 * 사기 표시 (전투 모델 2, §33.4) — 순수 함수. React·Canvas 와 분리해 테스트한다.
 * 사기는 깃발 단위 0~1000‰, 곱은 shared `moraleMultiplier` (만땅 +10% ~ 0 −40%, 800 이 ×1.00 경계).
 * 서버가 5 tick(1초)마다 보내는 값을 그대로 보인다 — 서버 값이 기준이므로 추정 보간은 하지 않는다.
 */
import { MORALE_MAX, channelValues, moraleMultiplier, type CombatFlagInput, type FlagSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { techStatsOf } from './techInfo.js';

/** 사기 곱이 ×1.00 이 되는 사기 값 (그 위는 보너스, 아래는 감쇠) */
export const MORALE_NEUTRAL = 800;

export type MoraleTone = 'high' | 'mid' | 'low';

export interface MoraleView {
  /** 0..1000 */
  value: number;
  /** 0..100 (막대 길이) */
  pct: number;
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

export function moraleTone(value: number): MoraleTone {
  return value >= MORALE_NEUTRAL ? 'high' : value >= 400 ? 'mid' : 'low';
}

/** 모델 1(사기 개념 없음)이거나 값이 없으면 null */
export function moraleView(g: GameModel, f: FlagSnapshot): MoraleView | null {
  if (!moraleOn(g) || f.morale === undefined) return null;
  const value = Math.max(0, Math.min(MORALE_MAX, f.morale));
  const stat = techStatsOf(g.players.get(f.ownerId)?.techMask ?? 0, g.config.constants);
  const multPm = moraleMultiplier(f.unit, value, stat);
  const deltaPct = Math.round((multPm - 1000) / 10);
  const sign = deltaPct > 0 ? '+' : deltaPct < 0 ? '−' : '±';
  return {
    value,
    pct: Math.round(value / 10),
    multPm,
    deltaPct,
    tone: moraleTone(value),
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
  };
}

/** 지금 이 깃발의 채널값 [공격, 방어] ‰ (지형·기지·사기·이탈 반영). 모델 1 이거나 지형을 모르면 null */
export function flagChannels(g: GameModel, f: FlagSnapshot): [number, number] | null {
  const input = moraleOn(g) ? flagCombatInput(g, f) : null;
  if (!input) return null;
  const [atk, def] = channelValues(input);
  return [atk, def];
}
