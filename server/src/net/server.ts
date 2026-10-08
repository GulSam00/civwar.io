/**
 * WebSocket 진입점 — 메시지 파싱·검증 후 로비/룸으로 라우팅.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, TICK_MS, type ClientMessage, type ErrorCode, type ServerMessage } from '@civwar/shared';
import { LobbyManager, type LobbyOptions } from '../room/lobby.js';
import type { Session } from '../room/session.js';
import { parseClientMessage, sanitizeNickname } from './validate.js';

export interface GameServer {
  wss: WebSocketServer;
  lobby: LobbyManager;
  port: number;
  close(): Promise<void>;
}

const MAX_PAYLOAD = 4096;

export function startServer(port: number, opts: LobbyOptions = {}): Promise<GameServer> {
  const lobby = new LobbyManager(opts);
  const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD });
  let connSeq = 0;

  wss.on('connection', (ws: WebSocket) => {
    const connId = ++connSeq;
    let session: Session | null = null;
    const sendDirect = (msg: ServerMessage) => ws.send(JSON.stringify(msg));
    const error = (code: ErrorCode, message: string) => sendDirect({ type: 'error', code, message });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return error('BAD_MESSAGE', 'binary frames not supported');
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        if (parsed.clientSeq !== undefined) {
          return sendDirect({ type: 'cmd_ack', clientSeq: parsed.clientSeq, accepted: false, reason: 'BAD_REQUEST' });
        }
        return error('BAD_MESSAGE', parsed.error);
      }
      const msg = parsed.msg;
      if (msg.type === 'hello') {
        if (session) return error('ALREADY_HELLO', 'hello already processed');
        if (msg.clientVersion !== PROTOCOL_VERSION) return error('BAD_VERSION', `server protocol ${PROTOCOL_VERSION}`);
        let resumed = false;
        const prev = msg.playerToken ? lobby.sessionsByToken.get(msg.playerToken) : undefined;
        if (prev) {
          if (prev.socket && prev.socket !== ws) prev.socket.close(4000, 'resumed elsewhere');
          session = prev;
          resumed = true;
        } else {
          const nick = sanitizeNickname(msg.nickname);
          if (!nick) return error('BAD_NICKNAME', 'nickname must be 1..16 chars');
          session = lobby.createSession(nick);
        }
        session.socket = ws;
        session.connId = connId;
        session.send({
          type: 'welcome',
          sessionId: session.id,
          playerToken: session.token,
          serverTick: lobby.roomOf(session)?.currentTick ?? 0,
          protocolVersion: PROTOCOL_VERSION,
          tickMs: TICK_MS,
          resumed,
          officialMaps: lobby.catalog.list(),
        });
        if (resumed) lobby.roomOf(session)?.onResume(session);
        return;
      }
      if (!session) return error('NOT_HELLO', 'send hello first');
      route(lobby, session, msg, error);
    });

    ws.on('close', () => {
      if (!session || session.socket !== ws) return;
      session.socket = null;
      const room = lobby.roomOf(session);
      if (room) room.onSocketClosed(session);
      if (!session.roomId) lobby.dropSession(session);
    });
    ws.on('error', () => ws.terminate());
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        wss,
        lobby,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            lobby.shutdown();
            for (const c of wss.clients) c.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}

function route(lobby: LobbyManager, s: Session, msg: ClientMessage, error: (c: ErrorCode, m: string) => void): void {
  const fail = (code: ErrorCode | null) => {
    if (code) error(code, code);
  };
  const room = lobby.roomOf(s);
  switch (msg.type) {
    case 'lobby_join_public':
      return fail(lobby.joinPublic(s));
    case 'lobby_create_private': {
      const e = lobby.createPrivate(s, msg as unknown as Record<string, unknown>);
      return e ? error(e.code, e.message) : undefined;
    }
    case 'lobby_update_settings': {
      if (!room) return error('NOT_IN_ROOM', 'not in a room');
      const e = room.updateSettings(s, msg as unknown as Record<string, unknown>);
      return e ? error(e.code, e.message) : undefined;
    }
    case 'lobby_join_private':
      return fail(lobby.joinPrivate(s, msg.roomCode));
    case 'lobby_spectate':
      return fail(lobby.spectate(s, msg.roomCode));
    case 'lobby_leave':
      if (!room) return error('NOT_IN_ROOM', 'not in a room');
      return room.leave(s);
    case 'lobby_set_ready':
      if (!room) return error('NOT_IN_ROOM', 'not in a room');
      return fail(room.setReady(s, msg.ready));
    case 'lobby_start_now':
      if (!room) return error('NOT_IN_ROOM', 'not in a room');
      return fail(room.startNow(s));
    case 'emote':
      return room?.emote(s, msg.code);
    case 'ping':
      return s.send({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now(), tick: room?.currentTick ?? 0 });
    case 'hello':
      return;
    default:
      // cmd_*
      if (!room) return s.send({ type: 'cmd_ack', clientSeq: msg.clientSeq, accepted: false, reason: 'NOT_IN_GAME' });
      return room.submitCommand(s, msg);
  }
}
