/**
 * 이모트 말풍선 표시값 (§4 emote_broadcast + §26.3 targetPlayerId) — 그리기(renderer.drawEmotes)와 분리한 순수 함수.
 * 대상 없는 이모트 = "A: 😀", 대상 이모트 = "A → B: 😀" (+ 대상 영토 이름표 쪽 화살표). 대상이 나면 강조.
 */
export interface EmoteLike {
  playerId: number;
  code: number;
  targetPlayerId?: number;
}

export interface EmoteBubble {
  text: string;
  /** 대상 플레이어 (없으면 null) */
  target: number | null;
  /** 대상이 나 (보낸 사람이 나인 경우 제외) */
  toMe: boolean;
}

export function emoteBubble(e: EmoteLike, me: number | null, nick: (id: number) => string, face: (code: number) => string): EmoteBubble {
  const target = typeof e.targetPlayerId === 'number' && e.targetPlayerId > 0 ? e.targetPlayerId : null;
  if (target === null) return { text: `${nick(e.playerId)}: ${face(e.code)}`, target: null, toMe: false };
  const toMe = me !== null && target === me && e.playerId !== me;
  return { text: `${nick(e.playerId)} → ${toMe ? '나' : nick(target)}: ${face(e.code)}`, target, toMe };
}

/**
 * 화살표 끝점: 대상 점이 화면 밖이면 말풍선(from)에서 그 점으로 가는 직선이 화면 가장자리(여백 margin)와 만나는 곳.
 * 화면 안이면 그대로.
 */
export function clampToView(from: { x: number; y: number }, to: { x: number; y: number }, w: number, h: number, margin = 18): { x: number; y: number; clamped: boolean } {
  const minX = margin;
  const minY = margin;
  const maxX = w - margin;
  const maxY = h - margin;
  if (to.x >= minX && to.x <= maxX && to.y >= minY && to.y <= maxY) return { x: to.x, y: to.y, clamped: false };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let k = 1;
  if (dx > 0) k = Math.min(k, (maxX - from.x) / dx);
  else if (dx < 0) k = Math.min(k, (minX - from.x) / dx);
  if (dy > 0) k = Math.min(k, (maxY - from.y) / dy);
  else if (dy < 0) k = Math.min(k, (minY - from.y) / dy);
  k = Math.max(0, k);
  return { x: from.x + dx * k, y: from.y + dy * k, clamped: true };
}
