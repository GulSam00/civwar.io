/**
 * 팝업 창 드래그 (2026-10-14 사용자 요청) — 테크·외교·옵션·도움말 창을 제목 줄로 끌어 옮긴다.
 *
 * 방식: 창의 CSS 배치(가운데 정렬·fit-content 등)는 그대로 두고 translate(dx, dy) 오프셋만 더한다.
 * 화면(부모 요소) 밖으로 나가지 않게 오프셋을 자른다(clampOffset). 위치는 창마다 localStorage 에 기억한다(실패하면 이번 세션만).
 * 좁은 화면(모바일)은 지금 배치를 유지한다 — enabled=false 면 오프셋을 적용하지 않는다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';

export interface Offset {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 한 축: 창 시작 위치(start, 오프셋 0 기준)·길이(size)가 경계 [0, limit] 안에 들어가도록 오프셋을 자른다 */
function clampAxis(off: number, start: number, size: number, limit: number): number {
  const lo = -start; // 창 왼쪽(위쪽) 끝 = 0
  const hi = limit - size - start; // 창 오른쪽(아래쪽) 끝 = limit
  // 창이 경계보다 크면 왼쪽(위쪽)을 맞춘다 — 제목 줄이 항상 보이게
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, off));
}

/**
 * 오프셋 자르기. natural = 오프셋 0 일 때 창 상자(경계 기준 좌표), bounds = 경계 크기.
 * 결과 창 상자는 경계 안에 완전히 들어간다(창이 더 크면 왼쪽·위쪽 정렬).
 */
export function clampOffset(off: Offset, natural: Box, bounds: { width: number; height: number }): Offset {
  return {
    x: Math.round(clampAxis(off.x, natural.left, natural.width, bounds.width)),
    y: Math.round(clampAxis(off.y, natural.top, natural.height, bounds.height)),
  };
}

const LS_KEY = 'civwar.windowPos.v1';

function loadAll(): Record<string, Offset> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, Offset>) : {};
  } catch {
    return {};
  }
}

export function loadWindowOffset(id: string): Offset {
  const v = loadAll()[id];
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : { x: 0, y: 0 };
}

export function saveWindowOffset(id: string, off: Offset): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = loadAll();
    all[id] = off;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* 저장 실패 = 이번 세션만 */
  }
}

/** 드래그를 시작하지 않을 대상 (제목 줄 안 버튼·입력) */
function isInteractive(t: EventTarget | null): boolean {
  const el = t as Element | null;
  return !!el?.closest?.('button, input, select, textarea, a, label');
}

/** 부모 요소 기준 창 상자 (오프셋 제거) */
function naturalBox(el: HTMLElement, off: Offset): { natural: Box; bounds: { width: number; height: number } } | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const r = el.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  return {
    natural: { left: r.left - p.left - off.x, top: r.top - p.top - off.y, width: r.width, height: r.height },
    bounds: { width: p.width, height: p.height },
  };
}

export interface DraggableWindow<T extends HTMLElement> {
  ref: React.RefObject<T>;
  /** 창 요소의 style (transform) */
  style: React.CSSProperties | undefined;
  /** 제목 줄(손잡이)에 펼친다 */
  handleProps: { onPointerDown: (e: React.PointerEvent) => void; 'data-drag-handle': string } | Record<string, never>;
}

/**
 * 드래그 가능한 창. id = 위치 기억 키, enabled = false 면(좁은 화면) 원래 배치.
 * 창 크기·화면 크기가 바뀌면(내용 변경·창 크기 조절) 다시 잘라 화면 안에 둔다.
 */
export function useDraggableWindow<T extends HTMLElement = HTMLDivElement>(id: string, enabled = true): DraggableWindow<T> {
  const ref = useRef<T>(null);
  const [off, setOff] = useState<Offset>(() => loadWindowOffset(id));
  const offRef = useRef(off);
  offRef.current = off;

  const reclamp = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const b = naturalBox(el, offRef.current);
    if (!b) return;
    const next = clampOffset(offRef.current, b.natural, b.bounds);
    if (next.x !== offRef.current.x || next.y !== offRef.current.y) setOff(next);
  }, [enabled]);

  // 렌더마다(내용이 바뀌어 창 크기가 달라질 수 있다) + 화면 크기 변경 시 다시 자른다
  useLayoutEffect(reclamp);
  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el || !enabled || e.button !== 0 || isInteractive(e.target)) return;
      const b = naturalBox(el, offRef.current);
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY };
      const from = offRef.current;
      let moved = false;
      let last = from;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        last = clampOffset({ x: from.x + dx, y: from.y + dy }, b.natural, b.bounds);
        setOff(last);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!moved) return;
        saveWindowOffset(id, last);
        // 드래그를 바깥(오버레이)에서 놓으면 이어지는 click 이 "바깥 클릭 = 닫기"로 처리되지 않게 한 번 삼킨다
        const swallow = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [enabled, id],
  );

  if (!enabled) return { ref, style: undefined, handleProps: {} };
  return {
    ref,
    style: off.x || off.y ? { transform: `translate(${off.x}px, ${off.y}px)` } : undefined,
    handleProps: { onPointerDown, 'data-drag-handle': '' },
  };
}

/** 좁은 화면(모바일) — GameScreen.useNarrow 와 같은 조건. 로비 도움말처럼 narrow 를 모르는 곳에서 쓴다 */
export function isNarrowScreen(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px), (pointer: coarse)').matches;
}
