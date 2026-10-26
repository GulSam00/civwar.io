/**
 * 지형 정보 툴팁 내용 (사용자 요청 2026-10-10) — 마우스가 맵 위 칸에 있을 때 커서 옆에 보여 준다.
 * 수치는 shared 상수(match_config.constants 가 있으면 그 값)에서 만든다. 표시 전용.
 *   방어 ×  = COMBAT_TERRAIN_DEF_POSTURE_PERMILLE (방어 태세 깃발 전투력, 소유자 무관)
 *   이동 ×  = 1000 / TERRAIN_MOVE_PERMILLE (v4.5 §22.1: 물은 전부 통행 불가 — 이동 배율 없음)
 *   점령 비용 × = TERRAIN_COST_PERMILLE,  골드 × = TERRAIN_GOLD_MILLI (평원 = 1)
 */
import {
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  TERRAIN_BUFF,
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

export function terrainInfo(m: GameModel, tile: number, me: number | null, nicknameOf: (id: number) => string): TerrainInfo | null {
  if (!m.terrain || tile < 0 || tile >= m.tileCount) return null;
  const ter = m.terrain[tile];
  const terrain = TERRAIN_NAME[ter] ?? `지형 ${ter}`;
  const rows: TipRow[] = [];
  const add = (field: TooltipField, label: string, value: string) => rows.push({ field, label, value });
  if (!isClaimable(ter)) {
    // v4.5 (§22.1): 바다(깊은 물)·호수(얕은 물) 모두 통행 불가 · 점령 불가
    add('terrain', '지형', `${terrain} · 통행 불가 · 점령 불가`);
  } else {
    add('terrain', '지형', terrain);
    const move = arr(m, 'TERRAIN_MOVE_PERMILLE', TERRAIN_MOVE_PERMILLE)[ter];
    if (m.config.combatModel === 2) {
      // 패치 11차: 모델 2 지형 효과 = 한 채널에만 (공격 태세는 공격력, 방어 태세는 방어력)
      const tb = ((m.config.constants?.TERRAIN_BUFF as readonly (readonly (readonly number[])[])[] | undefined) ?? TERRAIN_BUFF)[ter];
      const pct = (pm: number) => (pm === 1000 ? '—' : `${pm > 1000 ? '+' : '−'}${Math.abs(pm - 1000) / 10}%`);
      add('defense', '전투 보정', `공격 태세 공격력 ${pct(tb[0][0])} · 방어 태세 방어력 ${pct(tb[1][1])}`);
    } else {
      const def = arr(m, 'COMBAT_TERRAIN_DEF_POSTURE_PERMILLE', COMBAT_TERRAIN_DEF_POSTURE_PERMILLE)[ter];
      add('defense', '방어', x(def));
    }
    add('speed', '이동 속도', x(Math.round(1000000 / move)));
    add('cost', '점령 비용', x(arr(m, 'TERRAIN_COST_PERMILLE', TERRAIN_COST_PERMILLE)[ter]));
    add('gold', '골드', x(arr(m, 'TERRAIN_GOLD_MILLI', TERRAIN_GOLD_MILLI)[ter]));
  }
  const ownerId = isClaimable(ter) ? m.owners[tile] : 0;
  const ownerName = ownerId === 0 ? (isClaimable(ter) ? '중립' : '—') : `${nicknameOf(ownerId)}${ownerId === me ? ' (나)' : m.isAlly(me ?? 0, ownerId) ? ' (동맹)' : ''}`;
  add('owner', '소유자', ownerName);
  const b = m.bases.get(tile);
  const base = b ? `${m.capitalTiles.has(tile) ? '수도' : '기지'}${m.baseNames.get(tile) ? ` ${m.baseNames.get(tile)}` : ''} · 체력 ${Math.round(b.hpPct)}%` : null;
  if (b) {
    // §21.5 지명 · §21.4 생산력 — 서버가 보냈을 때만 (기지 체력 항목과 함께 켜고 끈다)
    const name = m.baseNames.get(tile);
    if (name) add('baseHp', m.capitalTiles.has(tile) ? '수도' : '기지', name);
    add('baseHp', m.capitalTiles.has(tile) ? '수도 체력' : '기지 체력', `${Math.round(b.hpPct)}%`);
    const prod = m.baseProdPm(tile);
    if (prod !== null) add('baseHp', '생산력', `${Math.floor(prod / 10)}%${prod < 1000 ? ' (회복 중)' : ''}`);
  }
  // 한 줄 요약(이전 형식) — 지형·소유자·기지 행을 뺀 보정 문구
  const mods = !isClaimable(ter) ? ['통행 불가 · 점령 불가'] : rows.filter((r) => r.field !== 'terrain' && r.field !== 'owner' && r.field !== 'baseHp').map((r) => (r.label === '점령' ? '점령 불가' : `${r.label} ${r.value}`));
  return { terrain, mods, rows, ownerId, ownerName, base };
}

/** 옵션에서 켠 항목만 (툴팁 자체가 꺼져 있으면 빈 배열 = 표시 안 함) */
export function visibleTipRows(info: TerrainInfo, tooltipOn: boolean, fields: Record<TooltipField, boolean>): TipRow[] {
  if (!tooltipOn) return [];
  return info.rows.filter((r) => fields[r.field]);
}
