/**
 * 병종 아이콘 (사용자 요청 2026-10-11: 창병/검병/기병 글자 → 아이콘). 그림 데이터의 유일한 출처.
 *  - DOM: ui/unitIcons.tsx 가 같은 path 로 <svg> 를 만든다 (currentColor).
 *  - Canvas: drawUnitGlyph() 가 Path2D 로 같은 모양을 그린다 (깃발 마커).
 * 좌표계 = 24×24 viewBox. 모양만으로 구분되게(색 무관 — 색각 보조 모드에서도 같다):
 *   창 = 대각선 긴 자루 + 촉,  검 = 세로 칼날 + 가로 코등이,  기병 = 말굽(U).
 */
import type { Unit } from '@civwar/shared';

export interface GlyphPart {
  d: string;
  /** fill = 면, stroke = 선(굵기 width, 24 단위) */
  mode: 'fill' | 'stroke';
  width?: number;
}

export const UNIT_GLYPHS: Readonly<Record<Unit, readonly GlyphPart[]>> = {
  // 창: 왼쪽 아래 → 오른쪽 위 자루, 오른쪽 위 잎 모양 촉, 자루 끝 작은 물미
  0: [
    { d: 'M3.5 20.5 L14.2 9.8', mode: 'stroke', width: 2.6 },
    { d: 'M21.5 2.5 L12.6 7.4 L16.6 11.4 Z', mode: 'fill' },
    { d: 'M2 22 L5 19', mode: 'stroke', width: 4 },
  ],
  // 검: 세로 칼날(끝이 뾰족한 면) + 코등이 + 손잡이 + 폼멜
  1: [
    { d: 'M12 1.5 L14.3 4.8 L14.3 15 L9.7 15 L9.7 4.8 Z', mode: 'fill' },
    { d: 'M5.5 15.8 L18.5 15.8', mode: 'stroke', width: 2.6 },
    { d: 'M12 16.5 L12 20.2', mode: 'stroke', width: 2.6 },
    { d: 'M12 20 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0', mode: 'fill' },
  ],
  // 기병: 말굽 — 두꺼운 U + 양 끝 굽
  2: [
    { d: 'M6.5 3.5 L6.5 11.5 A5.5 5.5 0 0 0 17.5 11.5 L17.5 3.5', mode: 'stroke', width: 3.6 },
    { d: 'M3.8 3.2 L9.2 3.2 M14.8 3.2 L20.2 3.2', mode: 'stroke', width: 2.6 },
  ],
};

const pathCache = new Map<string, Path2D>();
function path2d(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

/**
 * 24×24 그림 조각(GlyphPart[])을 (cx, cy) 중심 size px 로 그린다 — 어두운 외곽선(outline) 위에 color.
 * 병종 아이콘과 교전 아이콘(render/combatPairs.ts)이 함께 쓴다. Path2D 가 없는 환경(테스트)이면 false.
 */
export function drawGlyphParts(ctx: CanvasRenderingContext2D, parts: readonly GlyphPart[], cx: number, cy: number, size: number, color = '#fff', outline = 'rgba(0,0,0,0.8)'): boolean {
  if (typeof Path2D === 'undefined' || !parts.length) return false;
  const ps = parts.map((p) => path2d(p.d)!);
  const k = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 외곽선: 화면 기준 약 2.2px 더 두껍게 (작은 줌에서도 바탕과 분리)
  const halo = 2.2 / k;
  ctx.strokeStyle = outline;
  parts.forEach((p, i) => {
    ctx.lineWidth = (p.mode === 'stroke' ? (p.width ?? 2) : 0) + halo;
    ctx.stroke(ps[i]);
  });
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  parts.forEach((p, i) => {
    if (p.mode === 'fill') ctx.fill(ps[i]);
    else {
      ctx.lineWidth = p.width ?? 2;
      ctx.stroke(ps[i]);
    }
  });
  ctx.restore();
  return true;
}

/**
 * (cx, cy) 중심에 size px 크기로 병종 아이콘을 그린다. 어두운 외곽선(outline) 위에 color 로 칠해 어떤 바탕(플레이어 색)에서도 읽히게 한다.
 * Path2D 가 없는 환경(테스트)에서는 아무것도 하지 않고 false.
 */
export function drawUnitGlyph(ctx: CanvasRenderingContext2D, unit: number, cx: number, cy: number, size: number, color = '#fff', outline = 'rgba(0,0,0,0.8)'): boolean {
  const parts = UNIT_GLYPHS[unit as Unit];
  if (!parts) return false;
  return drawGlyphParts(ctx, parts, cx, cy, size, color, outline);
}
