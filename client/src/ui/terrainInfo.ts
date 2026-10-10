/**
 * 지형 정보 툴팁 내용 (사용자 요청 2026-10-10) — 마우스가 맵 위 칸에 있을 때 커서 옆에 보여 준다.
 * 수치는 shared 상수(match_config.constants 가 있으면 그 값)에서 만든다. 표시 전용.
 *   방어 ×  = COMBAT_TERRAIN_DEF_POSTURE_PERMILLE (방어 태세 깃발 전투력, 소유자 무관)
 *   이동 ×  = 1000 / TERRAIN_MOVE_PERMILLE (얕은 물은 기동 테크 단계 반영)
 *   점령 비용 × = TERRAIN_COST_PERMILLE,  골드 × = TERRAIN_GOLD_MILLI (평원 = 1)
 */
import {
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  SHALLOW_MOVE_PERMILLE_BY_TIER,
  SHALLOW_MOVE_PERMILLE_MIN,
  TERRAIN,
  TERRAIN_COST_PERMILLE,
  TERRAIN_GOLD_MILLI,
  TERRAIN_MOVE_PERMILLE,
  isClaimable,
} from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { TERRAIN_NAME } from './text.js';

export interface TerrainInfo {
  terrain: string;
  mods: string[];
  ownerId: number;
  ownerName: string;
  /** 기지 칸이면 "수도 · 체력 n%" 등 */
  base: string | null;
}

const arr = (m: GameModel, k: string, d: readonly number[]): readonly number[] => (m.config.constants?.[k] as readonly number[] | undefined) ?? d;
const x = (pm: number) => `×${(pm / 1000).toFixed(2)}`;

export function terrainInfo(m: GameModel, tile: number, me: number | null, mobilityTier: number, nicknameOf: (id: number) => string): TerrainInfo | null {
  if (!m.terrain || tile < 0 || tile >= m.tileCount) return null;
  const ter = m.terrain[tile];
  const mods: string[] = [];
  if (ter === TERRAIN.DEEP) mods.push('통행 불가 · 점령 불가');
  else {
    let move = arr(m, 'TERRAIN_MOVE_PERMILLE', TERRAIN_MOVE_PERMILLE)[ter];
    if (ter === TERRAIN.SHALLOW) {
      const byTier = arr(m, 'SHALLOW_MOVE_PERMILLE_BY_TIER', SHALLOW_MOVE_PERMILLE_BY_TIER);
      const min = (m.config.constants?.SHALLOW_MOVE_PERMILLE_MIN as number | undefined) ?? SHALLOW_MOVE_PERMILLE_MIN;
      move = Math.max(min, byTier[Math.max(0, Math.min(byTier.length - 1, mobilityTier))]);
    }
    const def = arr(m, 'COMBAT_TERRAIN_DEF_POSTURE_PERMILLE', COMBAT_TERRAIN_DEF_POSTURE_PERMILLE)[ter];
    mods.push(`방어 ${x(def)}`);
    mods.push(`이동 속도 ${x(Math.round(1000000 / move))}`);
    if (isClaimable(ter)) {
      mods.push(`점령 비용 ${x(arr(m, 'TERRAIN_COST_PERMILLE', TERRAIN_COST_PERMILLE)[ter])}`);
      mods.push(`골드 ${x(arr(m, 'TERRAIN_GOLD_MILLI', TERRAIN_GOLD_MILLI)[ter])}`);
    } else mods.push('점령 불가');
  }
  const ownerId = isClaimable(ter) ? m.owners[tile] : 0;
  const ownerName = ownerId === 0 ? (isClaimable(ter) ? '중립' : '—') : `${nicknameOf(ownerId)}${ownerId === me ? ' (나)' : m.isAlly(me ?? 0, ownerId) ? ' (동맹)' : ''}`;
  const b = m.bases.get(tile);
  const base = b ? `${m.capitalTiles.has(tile) ? '수도' : '기지'} · 체력 ${Math.round(b.hpPct)}%` : null;
  return { terrain: TERRAIN_NAME[ter] ?? `지형 ${ter}`, mods, ownerId, ownerName, base };
}
