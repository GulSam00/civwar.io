/**
 * 병종 아이콘 (DOM, inline SVG, currentColor). 모양 데이터는 render/unitGlyphs.ts 와 공유 — 캔버스 깃발 마커와 같은 그림.
 * 접근성: role="img" + aria-label/title = 한국어 병종 이름. 공간이 넉넉한 곳(도움말·깃발 패널)은 withName 으로 이름도 옆에.
 */
import type { Unit } from '@civwar/shared';
import { UNIT_GLYPHS } from '../render/unitGlyphs.js';
import { UNIT_NAME } from './text.js';

export function UnitIcon({ unit, size = 16, withName = false, title, className }: { unit: Unit; size?: number; withName?: boolean; title?: string; className?: string }) {
  const name = UNIT_NAME[unit];
  const label = title ?? name;
  const svg = (
    <svg
      className="unit-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={withName ? undefined : label}
      aria-hidden={withName ? true : undefined}
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {!withName && <title>{label}</title>}
      {UNIT_GLYPHS[unit].map((p, i) =>
        p.mode === 'fill' ? <path key={i} d={p.d} fill="currentColor" /> : <path key={i} d={p.d} fill="none" stroke="currentColor" strokeWidth={p.width ?? 2} />,
      )}
    </svg>
  );
  if (!withName) return className ? <span className={className}>{svg}</span> : svg;
  return (
    <span className={`unit-tag ${className ?? ''}`} title={label}>
      {svg}
      <span>{name}</span>
    </span>
  );
}
