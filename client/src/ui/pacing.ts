/**
 * 방 설정 미리보기용 판 길이 추정 — 서버 room_state.settings.pacingNote 와 같은 식(프로토콜 §5, GDD 2.8 e).
 * 방을 만들기 전(아직 room_state 가 없을 때)에만 쓴다. 방이 생기면 서버의 pacingNote 를 그대로 보여준다.
 * 참고값 — 보증 아님.
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, PUBLIC_ROOM_PLAYERS, TARGET_LAND_RATIO_PERMILLE, TICKS_PER_MIN, isClaimable, rleDecode, type MapSizeClass } from '@civwar/shared';

export function landOfRandom(size: MapSizeClass): number {
  const p = MAP_SIZE_PRESETS[size];
  return Math.floor((p.w * p.h * TARGET_LAND_RATIO_PERMILLE) / 1000);
}

export function landOfTerrain(rle: number[], width: number, height: number): number {
  const t = rleDecode(rle, width * height);
  let n = 0;
  for (const v of t) if (isClaimable(v)) n++;
  return n;
}

/** "guaranteed" | "estimate:<분>" | "timeout_likely" */
export function estimatePacing(opts: { land: number; players: number; defaultSetup: boolean }): string {
  if (opts.defaultSetup && opts.players === PUBLIC_ROOM_PLAYERS) return 'guaranteed';
  if (opts.players <= 0) return 'timeout_likely';
  const T = 29.4 * Math.pow(opts.land / opts.players / 390, 0.75);
  if (T > HARD_TIMEOUT_TICK / TICKS_PER_MIN) return 'timeout_likely';
  return `estimate:${Math.round(T)}`;
}

export function pacingText(note: string): string | null {
  if (note === 'guaranteed') return '표준 설정 — 약 30분';
  if (note === 'timeout_likely') return `예상 판 길이가 ${HARD_TIMEOUT_TICK / TICKS_PER_MIN}분을 넘어 시간 종료로 끝날 가능성이 큽니다`;
  const m = /^estimate:(\d+)/.exec(note);
  return m ? `예상 판 길이 약 ${m[1]}분 (참고값)` : null;
}
