import type { ServerMessage } from '@civwar/shared';

/** tick 한 번이 만들어 내는 송신 메시지. 룸이 소켓으로 배달한다 */
export interface Outbox {
  /** 룸 전원(관전자 포함) */
  broadcast: ServerMessage[];
  /** 특정 플레이어(세션이 없으면 버림 — 봇) */
  personal: { playerId: number; msg: ServerMessage }[];
}

export function newOutbox(): Outbox {
  return { broadcast: [], personal: [] };
}
