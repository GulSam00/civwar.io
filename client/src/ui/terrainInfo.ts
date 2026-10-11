/**
 * 지형 정보 툴팁 내용 (사용자 요청 2026-10-10) — 마우스가 맵 위 칸에 있을 때 커서 옆에 보여 준다.
 * 수치는 shared 상수(match_config.constants 가 있으면 그 값)에서 만든다. 표시 전용.
 *   방어 ×  = COMBAT_TERRAIN_DEF_POSTURE_PERMILLE (방어 태세 깃발 전투력, 소유자 무관)
 *   이동 ×  = 1000 / TERRAIN_MOVE_PERMILLE (얕은 물은 기동 테크 단계 반영)
 *   점령 비용 × = TERRAIN_COST_PERMILLE,  골드 × = TERRAIN_GOLD_MILLI (평원 = 1)
 */
import {
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  SHALLOW_MOVE_PERMILLE_MIN,
  TERRAIN,
  TERRAIN_COST_PERMILLE,
  TERRAIN_GOLD_MILLI,
  TERRAIN_MOVE_PERMILLE,
  isClaimable,
} from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { TERRAIN_NAME } from './text.js';
import type { TooltipField } from './options.js';

/** 툴팁 한 줄 (옵션 창에서 항목별로 켜고 끈다) */
export interface TipRow {
  field: TooltipField;
  label: string;
  value: string;
}

export interface TerrainInfo {
  terrain: string;
  /** 보정 문구 (한 줄 요약용, 테스트 호환) */
  mods: string[];
  /** 지형·보정·소유자·기지 체력을 한 줄씩 (표시 순서) */
  rows: TipRow[];
  ownerId: number;
  ownerName: string;
  /** 기지 칸이면 "수도 · 체력 n%" 등 */
  base: string | null;
}

const arr = (m: GameModel, k: string, d: readonly number[]): readonly number[] => (m.config.constants?.[k] as readonly number[] | undefined) ?? d;
const x = (pm: number) => `×${(pm / 1000).toFixed(2)}`;

export function terrainInfo(m: GameModel, tile: number, me: number | null, shallowPm: number, nicknameOf: (id: number) => string): TerrainInfo | null {
  if (!m.terrain || tile < 0 || tile >= m.tileCount) return null;
  const ter = m.terrain[tile];
  const terrain = TERRAIN_NAME[ter] ?? `지형 ${ter}`;
  const rows: TipRow[] = [];
  const add = (field: TooltipField, label: string, value: string) => rows.push({ field, label, value });
  if (ter === TERRAIN.DEEP) {
    add('terrain', '지형', `${terrain} · 통행 불가 · 점령 불가`);
  } else {
    add('terrain', '지형', terrain);
    let move = arr(m, 'TERRAIN_MOVE_PERMILLE', TERRAIN_MOVE_PERMILLE)[ter];
    if (ter === TERRAIN.SHALLOW) {
      // v4.3: shallowPm = 보는 플레이어의 얕은 물 이동배율 ‰ (techShallowPm)
      const min = (m.config.constants?.SHALLOW_MOVE_PERMILLE_MIN as number | undefined) ?? SHALLOW_MOVE_PERMILLE_MIN;
      move = Math.max(min, shallowPm);
    }
    const def = arr(m, 'COMBAT_TERRAIN_DEF_POSTURE_PERMILLE', COMBAT_TERRAIN_DEF_POSTURE_PERMILLE)[ter];
    add('defense', '방어', x(def));
    add('speed', '이동 속도', x(Math.round(1000000 / move)));
    if (isClaimable(ter)) {
      add('cost', '점령 비용', x(arr(m, 'TERRAIN_COST_PERMILLE', TERRAIN_COST_PERMILLE)[ter]));
      add('gold', '골드', x(arr(m, 'TERRAIN_GOLD_MILLI', TERRAIN_GOLD_MILLI)[ter]));
    } else add('cost', '점령', '불가');
  }
  const ownerId = isClaimable(ter) ? m.owners[tile] : 0;
  const ownerName = ownerId === 0 ? (isClaimable(ter) ? '중립' : '—') : `${nicknameOf(ownerId)}${ownerId === me ? ' (나)' : m.isAlly(me ?? 0, ownerId) ? ' (동맹)' : ''}`;
  add('owner', '소유자', ownerName);
  const b = m.bases.get(tile);
  const base = b ? `${m.capitalTiles.has(tile) ? '수도' : '기지'} · 체력 ${Math.round(b.hpPct)}%` : null;
  if (b) add('baseHp', m.capitalTiles.has(tile) ? '수도 체력' : '기지 체력', `${Math.round(b.hpPct)}%`);
  // 한 줄 요약(이전 형식) — 지형·소유자·기지 행을 뺀 보정 문구
  const mods = ter === TERRAIN.DEEP ? ['통행 불가 · 점령 불가'] : rows.filter((r) => r.field !== 'terrain' && r.field !== 'owner' && r.field !== 'baseHp').map((r) => (r.label === '점령' ? '점령 불가' : `${r.label} ${r.value}`));
  return { terrain, mods, rows, ownerId, ownerName, base };
}

/** 옵션에서 켠 항목만 (툴팁 자체가 꺼져 있으면 빈 배열 = 표시 안 함) */
export function visibleTipRows(info: TerrainInfo, tooltipOn: boolean, fields: Record<TooltipField, boolean>): TipRow[] {
  if (!tooltipOn) return [];
  return info.rows.filter((r) => fields[r.field]);
}
