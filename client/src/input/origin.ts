/**
 * v5.1 (GDD 2.5·4.2, §37.2 ④) 출전 출발 기지 미리보기 — 서버 issueFlag 와 같은 shared `pickOriginBase` 를 같은 입력으로 부른다.
 *  - 후보 = 내 기지(수도 포함), 쿨타임 = bases[].dispatchReadyTick (gameModel 이 유지), 거리 = 토폴로지 거리(서버 state.graph.distance 와 같은 함수)
 *  - 기준 tick = 지금 tick + 1 — 명령은 빨라야 다음 tick 1단계에서 처리된다 (봇 issueOrigin 과 같은 기준)
 *  - 방금 보낸 발령의 기지는 그 발령의 응답(flag_issued · 거절 cmd_ack)이 올 때까지 쿨타임으로 본다(localBusy) — 연타로 같은 기지를 다시 고르지 않게.
 *    서버 값(flag_issued → dispatchReadyTick)이 오면 그 값이 우선이다(둘 중 큰 값).
 * 표시 전용 — 실제 수락/거절은 cmd_ack (BASE_COOLDOWN 이면 토스트).
 */
import { pickOriginBase } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';

export interface DistanceLike {
  distance(a: number, b: number): number;
}

export interface OriginPick {
  /** 실제로 출발할 기지 (쿨타임 아닌 최근접). 내 기지가 없거나 모두 쿨타임이면 null */
  base: number | null;
  /** 경로를 그릴 기지 — base, 없으면 쿨타임 무시 최근접 (모두 쿨타임일 때 화살표용) */
  drawBase: number | null;
  /** 쿨타임을 무시한 최근접 내 기지 (base 와 다르면 더 가까운 기지가 출전 준비 중) */
  nearest: number | null;
  /** 내 기지가 하나라도 있는가 */
  hasBase: boolean;
  /** 모두 쿨타임일 때 가장 먼저 준비되는 기지까지 남은 tick (아니면 0) */
  waitTicks: number;
}

/** 내 기지 (map_init.bases 순서 = tileId ASC) */
export function myBases(g: GameModel, me: number): number[] {
  return g.baseTiles.filter((t) => g.bases.get(t)?.ownerId === me);
}

/** 기지 준비 tick (서버 값과 방금 보낸 발령 표시 중 큰 값) */
export function readyTickWith(g: GameModel, localBusy: ReadonlyMap<number, number> | null) {
  return (t: number) => Math.max(g.dispatchReadyOf(t), localBusy?.get(t) ?? 0);
}

export function pickIssueOrigin(g: GameModel, topo: DistanceLike, me: number, anchor: number, localBusy: ReadonlyMap<number, number> | null = null): OriginPick {
  const bases = myBases(g, me);
  if (!bases.length || anchor < 0) return { base: null, drawBase: null, nearest: null, hasBase: bases.length > 0, waitTicks: 0 };
  const at = g.tick + 1;
  const ready = readyTickWith(g, localBusy);
  const dist = (a: number, b: number) => topo.distance(a, b);
  const base = pickOriginBase(bases, anchor, at, ready, dist);
  const nearest = pickOriginBase(bases, anchor, at, () => 0, dist);
  if (base !== null) return { base, drawBase: base, nearest, hasBase: true, waitTicks: 0 };
  // QA m-3: 서버 판정 기준(명령 처리 tick = 지금 + 1)으로 센다
  const waitTicks = Math.max(1, Math.min(...bases.map((t) => ready(t) - at)));
  return { base: null, drawBase: nearest, nearest, hasBase: true, waitTicks };
}

/** 지정한 기지의 남은 쿨타임 tick (0 = 지금 보내면 출전 가능 — 다음 tick 처리 기준) */
export function baseWaitTicks(g: GameModel, base: number, localBusy: ReadonlyMap<number, number> | null = null): number {
  const r = readyTickWith(g, localBusy)(base);
  const at = g.tick + 1; // QA m-3: 서버 판정 기준(명령 처리 tick)
  return at >= r ? 0 : r - at;
}

/** tick → 초 (올림, 최소 1) */
export function ticksToSec(g: GameModel, ticks: number): number {
  return Math.max(1, Math.ceil((ticks * g.config.tickMs) / 1000));
}
