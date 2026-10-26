/**
 * 교전 시각화 (사용자 결정 2026-10-11): 교전 중인 두 깃발 사이 짧은 연결선 + 공격 태세 쪽 검, 방어 태세 쪽 방패(둘 다 공격 = 검 둘).
 *
 * 교전 쌍은 프로토콜이 주는 값만으로 클라이언트에서 계산한다 (§20). 서버 전투 간선(combat.ts engagedPair)과 같은 규칙:
 *   두 깃발 모두 combatEligible(!routed ∧ 병력>0 ∧ !breakaway) 이고 inCombat 비트가 켜져 있고,
 *   주인이 다르고 동맹이 아니며(hostile), 위치 칸이 접촉(topology.touching — 사각 = 체비셰프 1, 대각선 포함 8방향)이고,
 *   **한쪽이 attackSide(공격 태세 ∧ 귀환 중 아님)** 일 때만 한 쌍. (귀환 중 공격 깃발 ↔ 방어 깃발은 서버에 간선이 없다 — v4.2 [A-62])
 * 판정은 TopologyView.touching 만 부른다 (사각 전제 식은 topology.ts 에만).
 */
import { POSTURE } from '@civwar/shared';
import type { GlyphPart } from './unitGlyphs.js';

export interface CombatFlagLike {
  id: number;
  ownerId: number;
  posTileId: number;
  posture: number;
  inCombat: boolean;
  /** 아래 셋은 서버 combatEligible / attackSide 판정용 — 모델 FlagSnapshot 에 모두 있다 */
  state: string;
  routed: boolean;
  troops: number;
  breakaway: boolean;
}

/** 서버 combatEligible 과 같다 */
export function combatEligible(f: Pick<CombatFlagLike, 'routed' | 'troops' | 'breakaway'>): boolean {
  return !f.routed && f.troops > 0 && !f.breakaway;
}
/** 서버 attackSide 와 같다: 공격 태세이고 귀환 중이 아님 */
export function attackSide(f: Pick<CombatFlagLike, 'posture' | 'state'>): boolean {
  return f.posture === POSTURE.ATTACK && f.state !== 'RETURNING';
}

export interface CombatPair {
  /** 작은 id 쪽 */
  a: number;
  b: number;
  aAttack: boolean;
  bAttack: boolean;
}

/** 교전 쌍 목록 (a < b, (a, b) 오름차순). 같은 깃발이 여러 쌍에 들 수 있다(여럿이 한 편으로 싸울 때) */
export function combatPairs<F extends CombatFlagLike>(flags: Iterable<F>, touching: (a: number, b: number) => boolean, isAlly: (a: number, b: number) => boolean): CombatPair[] {
  const fighting = [...flags].filter((f) => f.inCombat && combatEligible(f)).sort((x, y) => x.id - y.id);
  const out: CombatPair[] = [];
  for (let i = 0; i < fighting.length; i++) {
    const f = fighting[i];
    for (let j = i + 1; j < fighting.length; j++) {
      const g = fighting[j];
      if (f.ownerId === g.ownerId || isAlly(f.ownerId, g.ownerId)) continue;
      if (!attackSide(f) && !attackSide(g)) continue;
      if (!touching(f.posTileId, g.posTileId)) continue;
      out.push({ a: f.id, b: g.id, aAttack: f.posture === POSTURE.ATTACK, bAttack: g.posture === POSTURE.ATTACK });
    }
  }
  return out;
}

/** 교전 아이콘 종류 — 한 쌍에 아이콘 하나만 쓸 때(축소 보기) */
export type PairGlyphKind = 'swords' | 'mixed' | 'shields';
export function pairGlyphKind(p: Pick<CombatPair, 'aAttack' | 'bAttack'>): PairGlyphKind {
  return p.aAttack && p.bAttack ? 'swords' : !p.aAttack && !p.bAttack ? 'shields' : 'mixed';
}

// ───────────── 그림 (24×24, 깃발의 병종 아이콘과 겹치지 않게 다른 모양) ─────────────

/** 대각선 검 (공격 태세) — 병종 "검병" 아이콘(세로 칼날)과 구분되게 기울인 칼 */
export const SWORD_GLYPH: readonly GlyphPart[] = [
  { d: 'M6.5 17.5L20 4', mode: 'stroke', width: 2.8 },
  { d: 'M4.5 13.5l6 6', mode: 'stroke', width: 2.6 },
  { d: 'M7 17L3 21', mode: 'stroke', width: 2.8 },
];
/** 방패 (방어 태세) — 면 */
export const SHIELD_GLYPH: readonly GlyphPart[] = [{ d: 'M12 2.5l7.5 3v5.5c0 5.2-3.2 8.8-7.5 10.5-4.3-1.7-7.5-5.3-7.5-10.5V5.5z', mode: 'fill' }];
/** 엇갈린 검 둘 (둘 다 공격) */
export const CROSSED_SWORDS_GLYPH: readonly GlyphPart[] = [
  ...SWORD_GLYPH,
  { d: 'M17.5 17.5L4 4', mode: 'stroke', width: 2.8 },
  { d: 'M19.5 13.5l-6 6', mode: 'stroke', width: 2.6 },
  { d: 'M17 17l4 4', mode: 'stroke', width: 2.8 },
];
/** 방패 위 검 (공격 대 방어, 축소 보기) */
export const SWORD_SHIELD_GLYPH: readonly GlyphPart[] = [
  { d: 'M12 4l6.5 2.6v4.8c0 4.5-2.8 7.6-6.5 9.1-3.7-1.5-6.5-4.6-6.5-9.1V6.6z', mode: 'stroke', width: 2.2 },
  { d: 'M3 21L21 3', mode: 'stroke', width: 2.6 },
  { d: 'M15.5 4.5l4 4', mode: 'stroke', width: 2.4 },
];

export function glyphOf(kind: PairGlyphKind): readonly GlyphPart[] {
  return kind === 'swords' ? CROSSED_SWORDS_GLYPH : kind === 'shields' ? SHIELD_GLYPH : SWORD_SHIELD_GLYPH;
}

/**
 * 화면 위 아이콘 자리 겹침 제거 — 이미 놓인 자리와 minDist 보다 가까우면 버린다(큰 난전에서 아이콘이 쌓이지 않게).
 * 반환 = 남길 인덱스.
 */
export function declutter(points: readonly { x: number; y: number }[], minDist: number): number[] {
  const kept: number[] = [];
  const d2 = minDist * minDist;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (kept.some((k) => (points[k].x - p.x) ** 2 + (points[k].y - p.y) ** 2 < d2)) continue;
    kept.push(i);
  }
  return kept;
}
