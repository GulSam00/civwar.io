/** 전투 실험실 선 그래프 — inline SVG, x = tick. hover 하면 그 tick 값을 보여 준다 */
import { useState } from 'react';
import { tickSec } from './combatSim.js';

export interface Series {
  label: string;
  color: string; // CSS 색 (토큰 var(...))
  dashed?: boolean;
  values: readonly number[]; // 인덱스 = tick
  fmt?: (v: number) => string;
}

const W = 360;
const H = 150;
const PAD_L = 36;
const PAD_R = 6;
const PAD_T = 8;
const PAD_B = 18;

export function LabChart({ title, series, yMax, xMax }: { title: string; series: readonly Series[]; yMax: number; xMax: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const xs = Math.max(1, xMax);
  const ys = Math.max(1, yMax);
  const px = (i: number) => PAD_L + (i / xs) * (W - PAD_L - PAD_R);
  const py = (v: number) => PAD_T + (1 - v / ys) * (H - PAD_T - PAD_B);
  const len = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const at = hover === null ? len - 1 : Math.min(hover, len - 1);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - PAD_L) / (W - PAD_L - PAD_R)) * xs);
    setHover(i < 0 || i >= len ? null : i);
  };

  return (
    <div className="lab-chart">
      <div className="lab-chart-head">
        <b>{title}</b>
        <span className="muted small">{at >= 0 ? tickSec(at) : ''}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lab-chart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${title} 그래프`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={py(ys * f)} y2={py(ys * f)} className="lab-grid" />
            <text x={PAD_L - 4} y={py(ys * f) + 3} className="lab-axis" textAnchor="end">
              {Math.round(ys * f)}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={H - 4} className="lab-axis">
          0
        </text>
        <text x={W - PAD_R} y={H - 4} className="lab-axis" textAnchor="end">
          {tickSec(xs)}
        </text>
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            strokeDasharray={s.dashed ? '5 3' : undefined}
            points={s.values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')}
          />
        ))}
        {hover !== null && <line x1={px(at)} x2={px(at)} y1={PAD_T} y2={H - PAD_B} className="lab-cursor" />}
      </svg>
      <div className="lab-legend">
        {series.map((s) => (
          <span key={s.label}>
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" x2="18" y1="3" y2="3" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 2' : undefined} />
            </svg>
            {s.label} <b>{at >= 0 && s.values[at] !== undefined ? (s.fmt ?? String)(s.values[at]) : '-'}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
