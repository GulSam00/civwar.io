import type { ServerMessage } from '@civwar/shared';

/** 소켓 추상화 — ws.WebSocket 의 최소 부분 */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * 익명 세션 (계정·DB 없음). playerToken 으로 재접속 시 같은 세션에 소켓을 다시 붙인다.
 */
export class Session {
  socket: SocketLike | null = null;
  connId = 0; // 소켓 연결마다 새 번호 (입력 큐 2차 정렬 키)
  roomId: string | null = null;
  playerId: number | null = null;
  spectator = false;
  cmdCount = 0; // 현재 tick 에 받은 cmd 수 (rate limit)
  lastEmoteAt = 0;

  constructor(
    readonly id: string,
    readonly token: string,
    public nickname: string,
  ) {}

  send(msg: ServerMessage): void {
    this.sendRaw(JSON.stringify(msg));
  }
  sendRaw(raw: string): void {
    try {
      this.socket?.send(raw);
    } catch {
      /* 닫힌 소켓 — close 핸들러가 정리 */
    }
  }
}
