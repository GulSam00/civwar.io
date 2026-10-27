/**
 * 지형 정보 툴팁 내용 (사용자 요청 2026-10-10, 2026-10-28 개편) — 마우스가 맵 위 칸에 있을 때 커서 옆에 보여 준다.
 * 수치는 shared 상수(match_config.constants 가 있으면 그 값)에서 만든다. 표시 전용.
 *   전투·이동 보정 = 지형 이름 오른쪽 작은 배지 (공격+5% · 방어+50% · 이동−44%)
 *     모델 2: TERRAIN_BUFF[지형][태세][채널] — 태세 한쪽에만 붙는 보정은 배지 앞에 태세 아이콘(검 = 공격 태세 · 방패 = 방어 태세)
 *     모델 1: COMBAT_TERRAIN_DEF_POSTURE_PERMILLE (방어 태세 방어력)
 *     이동 = 1000 / TERRAIN_MOVE_PERMILLE (v4.5 §22.1: 물은 전부 통행 불가)
 *   점령 = 그 칸 한 칸에 드는 병력 (ui/unitStats.captureCost — 서버 tileCost 와 같은 식)
 *   골드 = 그 지형 100칸이 1분에 버는 골드 (테크 반영)
 */
import { COMBAT_TERRAIN_DEF_POSTURE_PERMILLE, TERRAIN_BUFF, TERRAIN_MOVE_PERMILLE, isClaimable } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { TERRAIN_NAME, UNIT_SHORT } from './text.js';
import type { TooltipField } from './options.js';
import { captureCost, goldPer100TilesPerMin, type TopoLike } from './unitStats.js';

/** 지형 보정 배지. posture = 그 태세일 때만 붙는 보정 (없으면 태세 무관) */
export interface TipBadge {
  text: string;
  tone: 'up' | 'down';
  posture: 0 | 1 | null;
  /** 접근성·도움말용 풀어 쓴 설명 */
  long: string;
}

/** 툴팁 한 줄 (옵션 창에서 항목별로 켜고 끈다) */
export interface TipRow {
  field: TooltipField;
  label: string;
  value: string;
  /** defense·speed 행: 지형 이름 옆에 배지로 그린다 */
  badges?: TipBadge[];
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

export interface TerrainInfoOpts {
  /** 칸 이웃·거리 — 있으면 점령 비용에 인접 가산·보급 거리를 넣는다 */
  topo?: TopoLike | null;
  /** 내 부대를 선택한 상태면 그 병종 — 행동에 필요한 항목(보정·그 병종 점령 비용·기지 체력)만 남긴다 */
  selectedUnit?: number | null;
}

const arr = (m: GameModel, k: string, d: readonly number[]): readonly number[] => (m.config.constants?.[k] as readonly number[] | undefined) ?? d;

function pct(pm: number): string {
  const d = Math.round((pm - 1000) / 10);
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}%`;
}

function badge(what: '공격' | '방어', pm: number, posture: 0 | 1 | null): TipBadge {
  const cond = posture === 0 ? '공격 태세일 때 ' : posture === 1 ? '방어 태세일 때 ' : '';
  return { text: `${what}${pct(pm)}`, tone: pm > 1000 ? 'up' : 'down', posture, long: `${cond}${what}력 ${pct(pm)}` };
}

/** 지형 전투 보정 배지 (모델 2: 채널 × 태세, 모델 1: 방어 태세 방어력) */
export function combatBadges(m: GameModel, ter: number): TipBadge[] {
  if (m.config.combatModel !== 2) {
    const def = arr(m, 'COMBAT_TERRAIN_DEF_POSTURE_PERMILLE', COMBAT_TERRAIN_DEF_POSTURE_PERMILLE)[ter];
    return def === 1000 ? [] : [badge('방어', def, 1)];
  }
  // 패치 11차: 모델 2 지형 효과 = 채널 한쪽 (예: 평원 = 공격 태세일 때 공격력만, 사막 = 태세 무관 공격력)
  const tb = ((m.config.constants?.TERRAIN_BUFF as readonly (readonly (readonly number[])[])[] | undefined) ?? TERRAIN_BUFF)[ter];
  const out: TipBadge[] = [];
  for (const ch of [0, 1] as const) {
    const what = ch === 0 ? '공격' : '방어';
    const a = tb[0][ch];
    const d = tb[1][ch];
    if (a === d) {
      if (a !== 1000) out.push(badge(what, a, null));
    } else {
      if (a !== 1000) out.push(badge(what, a, 0));
      if (d !== 1000) out.push(badge(what, d, 1));
    }
  }
  return out;
}

export function terrainInfo(m: GameModel, tile: number, me: number | null, nicknameOf: (id: number) => string, opts: TerrainInfoOpts = {}): TerrainInfo | null {
  if (!m.terrain || tile < 0 || tile >= m.tileCount) return null;
  const ter = m.terrain[tile];
  const terrain = TERRAIN_NAME[ter] ?? `지형 ${ter}`;
  const sel = opts.selectedUnit ?? null;
  const rows: TipRow[] = [];
  const add = (field: TooltipField, label: string, value: string, badges?: TipBadge[]) => rows.push(badges ? { field, label, value, badges } : { field, label, value });
  if (!isClaimable(ter)) {
    // v4.5 (§22.1): 바다(깊은 물)·호수(얕은 물) 모두 통행 불가 · 점령 불가
    add('terrain', '지형', `${terrain} · 통행 불가 · 점령 불가`);
  } else {
    add('terrain', '지형', terrain);
    const cb = combatBadges(m, ter);
    if (cb.length) add('defense', '전투', cb.map((b) => b.long).join(' · '), cb);
    const movePm = Math.round(1000000 / arr(m, 'TERRAIN_MOVE_PERMILLE', TERRAIN_MOVE_PERMILLE)[ter]);
    if (movePm !== 1000) add('speed', '이동', `이동 속도 ${pct(movePm)}`, [{ text: `이동${pct(movePm)}`, tone: movePm > 1000 ? 'up' : 'down', posture: null, long: `이동 속도 ${pct(movePm)}` }]);
    if (me !== null) {
      // 한 칸 점령에 드는 병력 — 선택한 부대가 있으면 그 병종만, 없으면 세 병종 (내 땅·동맹 땅은 생략)
      const units = sel !== null ? [sel] : [0, 1, 2];
      const costs = units.map((u) => captureCost(m, opts.topo ?? null, me, u, tile));
      if (costs[0] !== null) add('cost', '점령', `${units.map((u, i) => `${UNIT_SHORT[u]} ${costs[i]}`).join(' · ')}명/칸`);
    }
    if (sel === null) add('gold', '골드', `+${goldPer100TilesPerMin(m, me, ter)}/분 · 100칸`);
  }
  const ownerId = isClaimable(ter) ? m.owners[tile] : 0;
  const ownerName = ownerId === 0 ? (isClaimable(ter) ? '중립' : '—') : `${nicknameOf(ownerId)}${ownerId === me ? ' (나)' : m.isAlly(me ?? 0, ownerId) ? ' (동맹)' : ''}`;
  if (sel === null) add('owner', '소유자', ownerName);
  const b = m.bases.get(tile);
  const base = b ? `${m.capitalTiles.has(tile) ? '수도' : '기지'}${m.baseNames.get(tile) ? ` ${m.baseNames.get(tile)}` : ''} · 체력 ${Math.round(b.hpPct)}%` : null;
  if (b) {
    // §21.5 지명 · §21.4 생산력 — 서버가 보냈을 때만 (기지 체력 항목과 함께 켜고 끈다). 부대 선택 중엔 체력만
    const name = m.baseNames.get(tile);
    if (name && sel === null) add('baseHp', m.capitalTiles.has(tile) ? '수도' : '기지', name);
    add('baseHp', m.capitalTiles.has(tile) ? '수도 체력' : '기지 체력', `${Math.round(b.hpPct)}%`);
    const prod = m.baseProdPm(tile);
    if (prod !== null && sel === null) add('baseHp', '생산력', `${Math.floor(prod / 10)}%${prod < 1000 ? ' (회복 중)' : ''}`);
  }
  // 한 줄 요약(이전 형식) — 지형·소유자·기지 행을 뺀 보정 문구
  const mods = !isClaimable(ter)
    ? ['통행 불가 · 점령 불가']
    : rows.filter((r) => r.field !== 'terrain' && r.field !== 'owner' && r.field !== 'baseHp').flatMap((r) => (r.badges ? r.badges.map((x) => x.long) : [`${r.label} ${r.value}`]));
  return { terrain, mods, rows, ownerId, ownerName, base };
}

/** 옵션에서 켠 항목만 (툴팁 자체가 꺼져 있으면 빈 배열 = 표시 안 함) */
export function visibleTipRows(info: TerrainInfo, tooltipOn: boolean, fields: Record<TooltipField, boolean>): TipRow[] {
  if (!tooltipOn) return [];
  return info.rows.filter((r) => fields[r.field]);
}
