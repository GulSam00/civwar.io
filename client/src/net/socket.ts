/**
 * WebSocket 연결 — 연결·재접속(지수 백오프)·JSON 송수신.
 * 프로토콜 의미(hello/토큰)는 store 가 맡고, 여기서는 전송만 다룬다.
 * 브라우저와 Node 22(전역 WebSocket) 양쪽에서 동작 — 헤드리스 검증 스크립트가 같은 코드를 쓴다.
 */
import type { ClientMessage, ServerMessage } from '@civwar/shared';

export type ConnState = 'idle' | 'connecting' | 'open' | 'closed';

export interface SocketHandlers {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onClose(code: number, willRetry: boolean): void;
}

/** close 4000 = 같은 토큰으로 다른 소켓이 이어받음 (§4 hello) → 재접속하지 않는다 */
const CLOSE_RESUMED_ELSEWHERE = 4000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  state: ConnState = 'idle';

  constructor(
    private readonly url: string,
    private readonly h: SocketHandlers,
  ) {}

  connect(): void {
    this.stopped = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.state = 'connecting';
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.state = 'open';
      this.h.onOpen();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      this.h.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.state = 'closed';
      const willRetry = !this.stopped && ev.code !== CLOSE_RESUMED_ELSEWHERE;
      this.h.onClose(ev.code, willRetry);
      if (willRetry) this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    const delay = Math.min(8000, 500 * 2 ** this.retry);
    this.retry++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.state = 'closed';
  }
}

/** 기본 WS URL: ?ws= 쿼리 → VITE_WS_URL → 같은 호스트의 /ws (Vite dev 프록시가 8080 으로 넘김) */
export function defaultWsUrl(): string {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_WS_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
