/**
 * 승리 판정 (GDD 6.1) — 정수 비교만.
 */
import {
  HARD_TIMEOUT_TICK,
  THRESHOLD_DECAY_PER_MIN_PERMILLE,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_SCALE,
  THRESHOLD_START_PCT,
  TICKS_PER_MIN,
} from '@civwar/shared';
import type { GameResult, GameState, PlayerState } from './state.js';

/** threshold(t) × THRESHOLD_SCALE  (60% = 12000, 45% = 9000) */
export function thresholdScaled(t: number): number {
  const hi = THRESHOLD_START_PCT * THRESHOLD_SCALE;
  const lo = THRESHOLD_FLOOR_PCT * THRESHOLD_SCALE;
  const elapsed = Math.max(0, t - THRESHOLD_DECAY_START);
  const decay = Math.floor((elapsed * THRESHOLD_DECAY_PER_MIN_PERMILLE * THRESHOLD_SCALE) / (1000 * TICKS_PER_MIN));
  return Math.min(hi, Math.max(lo, hi - decay));
}

/** 표시용 (예: 58.5) */
export function thresholdPct(t: number): number {
  return thresholdScaled(t) / THRESHOLD_SCALE;
}

/** p.tiles / totalLand × 100 >= threshold  ⇔  tiles × 100 × SCALE >= scaled × totalLand */
export function meetsThreshold(tiles: number, totalLandTiles: number, t: number): boolean {
  return tiles * 100 * THRESHOLD_SCALE >= thresholdScaled(t) * totalLandTiles;
}

/** 타이브레이커: 타일 → 병력 → 누적 획득 골드 → playerId 오름차순 */
export function compareRank(a: Readonly<PlayerState>, b: Readonly<PlayerState>): number {
  return (
    b.tiles - a.tiles ||
    b.troopsMilli - a.troopsMilli ||
    b.goldEarnedMilli - a.goldEarnedMilli ||
    a.id - b.id
  );
}

/** 6.1 판정 순서 고정. 끝나지 않으면 null */
export function judgeVictory(state: Readonly<GameState>, t: number): GameResult | null {
  const survivors = state.players.filter((p) => p && p.alive);
  if (survivors.length === 1) return { finalTick: t, winnerId: survivors[0].id, reason: 'last_standing' };
  const hit = survivors.filter((p) => meetsThreshold(p.tiles, state.map.totalLandTiles, t));
  if (hit.length > 0) return { finalTick: t, winnerId: hit.sort(compareRank)[0].id, reason: 'threshold' };
  if (t >= HARD_TIMEOUT_TICK && survivors.length > 0) {
    return { finalTick: t, winnerId: survivors.slice().sort(compareRank)[0].id, reason: 'timeout' };
  }
  if (survivors.length === 0) return { finalTick: t, winnerId: null, reason: 'timeout' };
  return null;
}
