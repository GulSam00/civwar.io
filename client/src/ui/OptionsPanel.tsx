/**
 * 옵션 창 (사용자 요청 2026-10-11) — HUD 톱니 버튼 또는 O 키.
 * 색각 보조 · 깃발 이동 방향 화살표(모두/내 것만/숨김) · 지형 툴팁(켜기 + 항목별).
 * 변경 즉시 적용·저장(ui/options.ts). Esc 또는 바깥 클릭으로 닫는다.
 */
import { useEffect } from 'react';
import type { GameInputController } from '../input/controller.js';
import { DIRECTION_MODE_NAME, TOOLTIP_FIELDS, TOOLTIP_FIELD_NAME, type DirectionMode } from './options.js';
import { usePolled } from './hooks.js';
import { isNarrowScreen, useDraggableWindow } from './draggable.js';

export function OptionsLayer({ ctl }: { ctl: GameInputController }) {
  usePolled(() => ctl.ix.version, 120);
  if (!ctl.ix.optionsOpen) return null;
  return <OptionsPanel ctl={ctl} onClose={() => ctl.toggleOptions(false)} />;
}

function OptionsPanel({ ctl, onClose }: { ctl: GameInputController; onClose: () => void }) {
  // 체크박스에 포커스가 있으면 컨트롤러 키 처리가 건너뛰므로 Esc 는 여기서도 받는다
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const drag = useDraggableWindow<HTMLDivElement>('options', !isNarrowScreen());
  const o = ctl.ix.options;
  return (
    <div className="overlay options-overlay" onMouseDown={onClose}>
      <div ref={drag.ref} style={drag.style} className="options" role="dialog" aria-modal="true" aria-labelledby="options-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="options-head drag-handle" {...drag.handleProps}>
          <h2 id="options-title">옵션</h2>
          <button className="btn btn-sm" onClick={onClose}>
            닫기 <kbd>Esc</kbd>
          </button>
        </header>

        <section className="opt-group">
          <h3>화면</h3>
          <label className="opt-row">
            <input type="checkbox" checked={o.colorblind} onChange={(e) => ctl.setColorblind(e.target.checked)} />
            <span>색각 보조</span>
            <small className="muted">영토 무늬 · 플레이어 번호</small>
            <kbd>C</kbd>
          </label>
        </section>

        <section className="opt-group">
          <h3>
            깃발 이동 방향 화살표 <kbd>V</kbd>
          </h3>
          <div className="opt-seg" role="radiogroup" aria-label="깃발 이동 방향 화살표">
            {(['all', 'mine', 'off'] as DirectionMode[]).map((m) => (
              <label key={m} className={`opt-seg-item ${o.directions === m ? 'on' : ''}`}>
                <input type="radio" name="opt-directions" checked={o.directions === m} onChange={() => ctl.setOptions({ directions: m })} />
                {DIRECTION_MODE_NAME[m]}
              </label>
            ))}
          </div>
        </section>

        <section className="opt-group">
          <h3>지형 툴팁</h3>
          <label className="opt-row">
            <input type="checkbox" checked={o.tooltip} onChange={(e) => ctl.setOptions({ tooltip: e.target.checked })} />
            <span>맵 위에 마우스를 올리면 칸 정보 보기</span>
          </label>
          <fieldset className="opt-fields" disabled={!o.tooltip}>
            <legend className="muted small">표시할 항목</legend>
            {TOOLTIP_FIELDS.map((f) => (
              <label key={f} className="opt-row">
                <input type="checkbox" checked={o.tooltipFields[f]} onChange={(e) => ctl.setOptions({ tooltipFields: { ...o.tooltipFields, [f]: e.target.checked } })} />
                <span>{TOOLTIP_FIELD_NAME[f]}</span>
              </label>
            ))}
          </fieldset>
        </section>
        <p className="muted small opt-foot">설정은 이 브라우저에 저장됩니다.</p>
      </div>
    </div>
  );
}

/** 톱니 아이콘 (inline SVG, currentColor) */
export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </svg>
  );
}
