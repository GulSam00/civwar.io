/**
 * 우클릭 원형 메뉴 (2026-10-18 — OpenFront.io 참고). 내용·판정은 input/contextMenu.ts, 상태 전이는 controller.ts(ctx*).
 * 위치는 GameScreen 렌더 루프가 .ctx-anchor 를 칸 중심으로 옮긴다(화면 가장자리에서는 안쪽으로 당기고, 원래 칸은 작은 핀으로 표시).
 *
 *   가운데   = 공격/방어 출전 → 바깥 고리 창·검·기 (1/2/3)
 *   안쪽 고리 = 정보 · 동맹 · 이모트 · 따라가기 (+ 내 기지 칸 = 수비 배치)
 *   바깥 고리 = 병종 / 이모트 / (중립·물 정보) 지형 상자
 * 쓸 수 없는 항목: 점선 테두리 + 흐림 + 툴팁에 이유 (색만으로 구분하지 않는다 — 아이콘 + 글자).
 * 닫기: Esc · 바깥 클릭 · 다시 우클릭 (메뉴 위 우클릭 포함).
 */
import { useEffect, useRef, useState } from 'react';
import { POSTURE, type Unit } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameInputController } from '../input/controller.js';
import { CTX_EMOTE_CODES, CTX_R1, CTX_R2, polar, ringAngles, type CtxSegId } from '../input/contextMenu.js';
import { usePolled } from './hooks.js';
import { PostureIcon, UnitIcon } from './unitIcons.js';
import { AllyIcon, BaseIcon, BlockedIcon, EmoteIcon, FollowIcon, InfoIcon } from './hudIcons.js';
import { EMOTE_TEXT, UNIT_NAME } from './text.js';
import { terrainInfo } from './terrainInfo.js';
import { playerColor } from '../render/palette.js';

const SEG_ICON: Record<CtxSegId, (p: { size?: number }) => JSX.Element> = {
  info: InfoIcon,
  ally: AllyIcon,
  emote: EmoteIcon,
  follow: FollowIcon,
  station: BaseIcon,
};

/** 병종 고리 각도 — 기존 삼각 메뉴와 같은 배치 (위 = 창, 왼쪽 아래 = 검, 오른쪽 아래 = 기) */
const UNIT_ANGLES = [-90, 150, 30];

interface Tip {
  key: string;
  x: number;
  y: number;
  title: string;
  hint: string;
  detail: string | null;
  reason: string | null;
}

export function ContextRadial({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0) + store.getVersion() * 7, 100);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const c = ctl.ix.ctx;
  const open = c !== null;
  const ctxKey = c ? `${c.tile}:${c.sub}` : '';

  // 메뉴 바깥(캔버스 제외 — 캔버스 클릭은 controller.click 이 닫는다, 드래그 이동은 메뉴를 유지) mousedown = 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || rootRef.current?.contains(t)) return;
      if (t.classList?.contains('game-canvas')) return;
      ctl.closeContextMenu();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, ctl]);
  useEffect(() => setHover(null), [ctxKey]);

  const g = store.game;
  const m = ctl.contextMenu();
  if (!c || !m || !g) return null;

  const tips: Tip[] = [];
  const hoverProps = (key: string) => ({
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
    onFocus: () => setHover(key),
    onBlur: () => setHover((h) => (h === key ? null : h)),
  });
  const ariaOf = (label: string, reason: string | null) => (reason ? `${label} — 사용 불가: ${reason}` : label);

  // ── 가운데 ──
  const ce = m.center;
  tips.push({ key: 'center', x: 0, y: 0, title: ce.kind === 'blocked' ? ce.label : `${ce.label} 출전`, hint: ce.hint, detail: ce.detail, reason: ce.reason });
  const centerIcon = ce.kind === 'blocked' ? <BlockedIcon size={22} /> : <PostureIcon posture={ce.kind === 'attack' ? POSTURE.ATTACK : POSTURE.DEFEND} size={22} />;

  // ── 안쪽 고리 ──
  const angles = ringAngles(m.segments.length);
  const segs = m.segments.map((s, i) => {
    const p = polar(CTX_R1, angles[i]);
    const key = `seg:${s.id}`;
    tips.push({ key, ...p, title: s.label, hint: s.hint, detail: s.detail, reason: s.reason });
    const Icon = SEG_ICON[s.id];
    const on = (s.id === 'emote' && c.sub === 'emote') || (s.id === 'info' && c.sub === 'terrain');
    return (
      <button
        key={s.id}
        type="button"
        role="menuitem"
        className={`ctx-seg ctx-seg-${s.id} ${s.disabled ? 'is-disabled' : ''} ${on ? 'on' : ''}`}
        style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
        aria-disabled={s.disabled || undefined}
        aria-label={ariaOf(s.label, s.reason)}
        onClick={() => ctl.ctxSegment(s.id)}
        {...hoverProps(key)}
      >
        <Icon size={18} />
        <span className="ctx-label">{s.label}</span>
      </button>
    );
  });

  // ── 바깥 고리 ──
  let outer: JSX.Element[] | JSX.Element | null = null;
  if (c.sub === 'units') {
    const route = ctl.currentRoute();
    const routeNote = !route ? null : !route.reachable ? '갈 수 있는 경로 없음' : route.blocked ? `적 땅에 막혀 ${route.path.length - 1}칸 가서 멈춤` : `경로 ${route.path.length - 1}칸`;
    outer = ctl.contextUnits().map((it) => {
      const p = polar(CTX_R2, UNIT_ANGLES[it.unit]);
      const key = `unit:${it.unit}`;
      tips.push({ key, ...p, title: `${UNIT_NAME[it.unit]} ${it.troops.toLocaleString()}명`, hint: `${ce.label} 태세로 출전 · 단축키 ${it.unit + 1}`, detail: routeNote, reason: it.reason });
      return (
        <button
          key={key}
          type="button"
          role="menuitem"
          className={`ctx-out ctx-unit ${it.disabled ? 'is-disabled' : ''}`}
          style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
          aria-disabled={it.disabled || undefined}
          aria-label={ariaOf(`${UNIT_NAME[it.unit]} ${it.troops}명 · 단축키 ${it.unit + 1}`, it.reason)}
          onClick={() => !it.disabled && ctl.chooseUnit(it.unit as Unit)}
          {...hoverProps(key)}
        >
          <kbd>{it.unit + 1}</kbd>
          <UnitIcon unit={it.unit} size={22} />
          <small>{it.troops.toLocaleString()}</small>
        </button>
      );
    });
  } else if (c.sub === 'emote') {
    const ea = ringAngles(CTX_EMOTE_CODES.length);
    outer = CTX_EMOTE_CODES.map((code, i) => {
      const p = polar(CTX_R2, ea[i]);
      return (
        <button key={code} type="button" role="menuitem" className="ctx-out ctx-emote" style={{ transform: `translate(${p.x}px, ${p.y}px)` }} onClick={() => ctl.ctxEmote(code)} aria-label={`이모트 ${EMOTE_TEXT[code]}`}>
          {EMOTE_TEXT[code]}
        </button>
      );
    });
  } else if (c.sub === 'terrain') {
    const info = terrainInfo(g, c.tile, store.myPlayerId, (id) => store.nicknameOf(id));
    outer = info ? (
      <div className="ctx-terrain" role="note" aria-label="지형 정보" style={{ transform: `translate(-50%, ${CTX_R1 + 34}px)` }}>
        {info.rows.map((r, i) => (
          <div key={i} className={`tt-row tt-${r.field}`}>
            {r.field === 'terrain' ? (
              <b>{r.value}</b>
            ) : (
              <>
                <span className="tt-k">{r.label}</span>
                <span className="tt-v">
                  {r.field === 'owner' && info.ownerId > 0 && <span className="dot" style={{ background: playerColor(info.ownerId) }} />}
                  {r.value}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    ) : null;
  }

  const tip = hover ? tips.find((t) => t.key === hover) : undefined;
  const side = rootRef.current?.parentElement?.dataset.side === 'left' ? 'left' : 'right';
  const tipEdge = c.sub === 'units' || c.sub === 'emote' ? CTX_R2 + 50 : CTX_R1 + 40;
  const ownerName = m.ownerId > 0 ? store.nicknameOf(m.ownerId) : m.land ? '중립 땅' : '물';

  return (
    <div
      ref={rootRef}
      className={`ctx-radial ctx-${ce.kind} ${c.sub ? `has-sub sub-${c.sub}` : ''}`}
      role="menu"
      aria-label={`${ownerName} 칸 메뉴`}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        ctl.closeContextMenu();
      }}
    >
      <span className="ctx-pin" aria-hidden="true" />
      <span className="ctx-ring" aria-hidden="true" />
      {c.sub && c.sub !== 'terrain' && <span className="ctx-ring ctx-ring-out" aria-hidden="true" />}
      <span className="ctx-owner" aria-hidden="true">
        {m.ownerId > 0 && <span className="dot" style={{ background: playerColor(m.ownerId) }} />}
        {ownerName}
      </span>
      <button
        type="button"
        role="menuitem"
        className={`ctx-center ${ce.disabled ? 'is-disabled' : ''} ${c.sub === 'units' ? 'on' : ''}`}
        aria-disabled={ce.disabled || undefined}
        aria-label={ariaOf(`${ce.label} 출전 — 병종 선택`, ce.reason)}
        aria-expanded={c.sub === 'units'}
        onClick={() => ctl.ctxCenter()}
        {...hoverProps('center')}
      >
        {centerIcon}
        <span className="ctx-label">{ce.label}</span>
      </button>
      {segs}
      {outer}
      {tip && (
        // 고리 바깥에 띄운다 (다른 항목을 가리지 않게) — 화면 오른쪽이면 왼쪽으로
        <div className={`ctx-tip side-${side}`} role="tooltip" style={{ left: side === 'left' ? -tipEdge : tipEdge, top: Math.max(-tipEdge + 20, Math.min(tipEdge - 20, tip.y)) }}>
          <div className="tt-row tt-terrain">
            <b>{tip.title}</b>
          </div>
          <div className="ctx-tip-hint">{tip.hint}</div>
          {tip.detail && <div className="ctx-tip-detail">{tip.detail}</div>}
          {tip.reason && <div className="ctx-tip-reason">사용 불가 — {tip.reason}</div>}
        </div>
      )}
    </div>
  );
}
