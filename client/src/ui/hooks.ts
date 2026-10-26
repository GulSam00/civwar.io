import { useEffect, useReducer, useSyncExternalStore } from 'react';
import type { ClientStore } from '../state/store.js';

/** 로비 수준 변경 구독 (연결·room_state·토스트) */
export function useStore(store: ClientStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

/**
 * 인게임 HUD 용: 메시지마다 React 를 렌더하지 않고 일정 주기로 모델 version 을 확인해 바뀌었을 때만 다시 그린다.
 * (WS 수신 = 초당 5회 이상, HUD 는 그보다 느려도 충분)
 */
export function usePolled(read: () => number, intervalMs = 150): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let last = read();
    const id = setInterval(() => {
      const v = read();
      if (v !== last) {
        last = v;
        force();
      }
    }, intervalMs);
    return () => clearInterval(id);
    // read 는 매 렌더 새 함수일 수 있으므로 의존성에서 뺀다 (최신 store 참조는 클로저가 같은 store)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
