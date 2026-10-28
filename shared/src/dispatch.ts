/**
 * v5.1 (GDD 2.5·4.2, 사용자 확정 2026-10-28) — 기지별 출전 쿨타임과 출발 기지 결정.
 * 서버 issueFlag · 봇 · 클라이언트 출전 미리보기가 같은 함수를 쓴다 [A-5.1-4].
 */
import { BASE_DISPATCH_COOLDOWN_TICKS } from './constants.js';

/** 출전 가능 = 현재 tick ≥ dispatchReadyTick (0 = 즉시 가능) */
export function isBaseDispatchReady(dispatchReadyTick: number, tick: number): boolean {
  return tick >= dispatchReadyTick;
}

/** 출전 직후의 준비 tick (`flag_issued.tick` 에서 출발 칸이 기지면 이 값) */
export function nextDispatchReadyTick(issueTick: number): number {
  return issueTick + BASE_DISPATCH_COOLDOWN_TICKS;
}

/**
 * 출발 기지 생략 시의 선택: 쿨타임이 아닌 내 기지 중 앵커까지 거리 최소, 동률은 tileId 오름차순.
 * - baseTiles 가 비었거나 모두 쿨타임이면 null. (호출자가 baseTiles.length 로 "기지 없음 = 영토 출발"과 구분한다)
 * - readyTickOf(tileId) = 그 기지의 dispatchReadyTick. distance = 서버 state.graph.distance 와 같은 거리 함수.
 */
export function pickOriginBase(
  baseTiles: readonly number[],
  anchorTileId: number,
  tick: number,
  readyTickOf: (tileId: number) => number,
  distance: (a: number, b: number) => number,
): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (const x of baseTiles) {
    if (!isBaseDispatchReady(readyTickOf(x), tick)) continue;
    const d = distance(x, anchorTileId);
    if (best === null || d < bd || (d === bd && x < best)) {
      best = x;
      bd = d;
    }
  }
  return best;
}
