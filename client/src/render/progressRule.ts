/**
 * 진척도 "감소 중" 표시 판정 (GDD 7.6 — 전진은 부드럽게, 감소는 플래시).
 * QA m-3: 대상 칸이 바뀐 tick(점령 직후 다음 칸, 재지정 등)의 진척 하락은 감소가 아니다 → 같은 칸에서 줄 때만.
 * 서버 7c 자동 감소는 targetTileId 를 유지한 채 진척만 줄인다(§5 flag_progress_lost cause:"decayed").
 */
export interface ProgressSample {
  pct: number;
  tgt: number | null;
}

export function isDecayTick(prev: ProgressSample, cur: ProgressSample): boolean {
  return cur.tgt !== null && cur.tgt === prev.tgt && cur.pct < prev.pct;
}
