/**
 * 병종 고리 (2026-10-22 — 우클릭 둘레 메뉴·삼각 병종 메뉴를 대신한다). 내용·판정은 input/unitRing.ts, 상태 전이는 controller.ts(beginPick/chooseUnit).
 * 위치는 GameScreen 렌더 루프가 .ctx-anchor 를 출전 지점 칸 중심으로 옮긴다(화면 가장자리에서는 안쪽으로 당기고, 원래 칸은 작은 핀으로 표시).
 *
 *   가운데 = 태세 예고 (내 땅 = 방어 푸름, 적·중립 = 공격 붉음, 물·동맹 = 지정 불가 회색)
 *   고리   = 창(위) · 검(왼쪽 아래) · 기병(오른쪽 아래) — 아이콘 + 보낼 병력 + 단축키 1/2/3
 * 쓸 수 없는 병종: 점선 테두리 + 흐림 + 툴팁에 이유 (색만으로 구분하지 않는다 — 아이콘 + 글자).
 * 닫기: Esc · 바깥(맵) 클릭 · 다시 우클릭 (고리 위 우클릭 포함).
 */
import { useEffect, useRef, useState } from 'react';
import { POSTURE, type Unit } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameInputController } from '../input/controller.js';
import { RING_R, RING_UNIT_ANGLES, polar } from '../input/unitRing.js';
import { usePolled } from './hooks.js';
import { PostureIcon, UnitIcon } from './unitIcons.js';
import { BlockedIcon } from './hudIcons.js';
import { UNIT_NAME } from './text.js';
import { playerColor } from '../render/palette.js';
import type { RoutePreview } from '../input/route.js';

interface Tip {
  key: string;
  x: number;
  y: number;
  title: string;
  hint: string;
  detail: string | null;
  reason: string | null;
}

function routeNote(route: RoutePreview | null): string | null {
  if (!route) return null;
  if (!route.reachable) return '갈 수 있는 경로 없음';
  const steps = route.path.length - 1;
  if (route.blocked) return `적 땅에 막혀 ${steps}칸 가서 멈춤`;
  return steps > 0 ? `경로 ${steps}칸` : '이 기지에 바로 배치';
}

export function UnitRing({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0) + store.getVersion() * 7, 100);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const is = ctl.ix.issue;
  const ringKey = is?.phase === 'pick' ? `${is.anchor}` : '';
  useEffect(() => setHover(null), [ringKey]);

  const g = store.game;
  const m = ctl.ringModel();
  if (!m || !g) return null;

  const tips: Tip[] = [];
  const hoverProps = (key: string) => ({
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
    onFocus: () => setHover(key),
    onBlur: () => setHover((h) => (h === key ? null : h)),
  });
  const ariaOf = (label: string, reason: string | null) => (reason ? `${label} — 사용 불가: ${reason}` : label);
  const note = routeNote(ctl.currentRoute());
  const hubTitle = m.kind === 'blocked' ? m.label : `${m.label} 출전`;
  const hubIcon = m.kind === 'blocked' ? <BlockedIcon size={22} /> : <PostureIcon posture={m.kind === 'attack' ? POSTURE.ATTACK : POSTURE.DEFEND} size={22} />;
  tips.push({ key: 'hub', x: 0, y: 0, title: hubTitle, hint: m.hint, detail: m.detail, reason: m.reason });

  const units = m.units.map((it) => {
    const p = polar(RING_R, RING_UNIT_ANGLES[it.unit]);
    const key = `unit:${it.unit}`;
    tips.push({
      key,
      ...p,
      title: `${UNIT_NAME[it.unit]} ${it.troops.toLocaleString()}명`,
      hint: `${m.label} 태세로 출전 · 단축키 ${it.unit + 1}`,
      detail: [m.detail, it.disabled ? null : note].filter(Boolean).join(' · ') || null,
      reason: it.reason,
    });
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        className={`ctx-out ctx-unit ${it.disabled ? 'is-disabled' : ''}`}
        style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
        aria-disabled={it.disabled || undefined}
        aria-label={ariaOf(`${UNIT_NAME[it.unit]} ${it.troops}명 · 단축키 ${it.unit + 1}`, it.reason)}
        onClick={() => (it.disabled ? setHover(key) : ctl.chooseUnit(it.unit as Unit))}
        {...hoverProps(key)}
      >
        <kbd>{it.unit + 1}</kbd>
        <UnitIcon unit={it.unit} size={22} />
        <small>{it.troops.toLocaleString()}</small>
      </button>
    );
  });

  const tip = hover ? tips.find((t) => t.key === hover) : undefined;
  const side = rootRef.current?.parentElement?.dataset.side === 'left' ? 'left' : 'right';
  const tipEdge = RING_R + 52;
  const ownerName = m.ownerId > 0 ? store.nicknameOf(m.ownerId) : m.land ? '중립 땅' : '물';

  return (
    <div
      ref={rootRef}
      className={`ctx-radial ctx-${m.kind}`}
      role="menu"
      aria-label={`${ownerName} 칸 병종 선택 · ${m.label}`}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        ctl.cancelIssue();
      }}
    >
      <span className="ctx-pin" aria-hidden="true" />
      <span className="ctx-ring" aria-hidden="true" />
      <span className="ctx-owner" aria-hidden="true">
        {m.ownerId > 0 && <span className="dot" style={{ background: playerColor(m.ownerId) }} />}
        {ownerName}
      </span>
      <div className="ctx-center ctx-hub" aria-hidden="true" {...hoverProps('hub')}>
        {hubIcon}
        <span className="ctx-label">{m.label}</span>
      </div>
      {units}
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
