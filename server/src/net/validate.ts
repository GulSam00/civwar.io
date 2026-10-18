/**
 * 클라이언트 메시지 스키마 검증. 서버는 클라이언트를 신뢰하지 않는다.
 * 여기서는 "모양"만 본다(타입·정수·범위). 소유권·인접·자원 같은 게임 규칙 검증은 tick 1단계에서.
 */
import { MAX_PLAYERS, NICKNAME_MAX_LEN, ROOM_CODE_LENGTH, TECH_NODE_COUNT, type ClientMessage } from '@civwar/shared';

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; error: string; clientSeq?: number };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isU32 = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 0xffffffff;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const inRange = (v: unknown, lo: number, hi: number): v is number => isInt(v) && v >= lo && v <= hi;

export function parseClientMessage(raw: string): ParseResult {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { ok: false, error: 'not an object' };
  const m = o as Record<string, unknown>;
  const type = m.type;
  if (typeof type !== 'string') return { ok: false, error: 'missing type' };

  // cmd_* 공통: clientSeq
  if (type.startsWith('cmd_')) {
    if (!isU32(m.clientSeq)) return { ok: false, error: 'clientSeq must be uint32' };
  }
  const seq = isU32(m.clientSeq) ? m.clientSeq : undefined;
  const bad = (error: string): ParseResult => ({ ok: false, error, clientSeq: seq });

  switch (type) {
    case 'hello':
      // QA m-1: 길이 위반은 server.ts 의 BAD_NICKNAME 으로 (형식 검사는 문자열 여부만 — 프레임 4 KB 상한이 크기를 막는다)
      if (typeof m.nickname !== 'string') return bad('nickname must be string');
      if (!isInt(m.clientVersion)) return bad('clientVersion must be int');
      if (m.playerToken !== undefined && !isStr(m.playerToken, 128)) return bad('playerToken must be string');
      return { ok: true, msg: { type, nickname: m.nickname, clientVersion: m.clientVersion, playerToken: m.playerToken as string | undefined } };
    case 'lobby_join_public':
    case 'lobby_leave':
    case 'lobby_start_now':
      return { ok: true, msg: { type } as ClientMessage };
    case 'lobby_create_private':
    case 'lobby_update_settings': {
      // v4.1: 방 설정 필드의 타입·범위 검증은 room/settings.ts (위반 = error BAD_ROOM_OPTIONS / MAP_NOT_FOUND).
      // 여기서는 알려진 필드만 골라 넘긴다. timeLimitMin 은 수신·무시(형식만 확인).
      if (m.timeLimitMin !== undefined && !isInt(m.timeLimitMin)) return bad('timeLimitMin must be int');
      const pick: Record<string, unknown> = { type };
      for (const k of ['map', 'maxPlayers', 'botCount', 'botDifficulty'] as const) if (m[k] !== undefined) pick[k] = m[k];
      if (type === 'lobby_create_private' && m.targetPlayers !== undefined) pick.targetPlayers = m.targetPlayers;
      return { ok: true, msg: pick as unknown as ClientMessage };
    }
    case 'lobby_list_rooms':
      return { ok: true, msg: { type } as ClientMessage };
    case 'lobby_join_listed':
      if (typeof m.roomId !== 'string' || !/^r[0-9]{1,9}$/.test(m.roomId)) return bad('roomId invalid');
      if (m.spectate !== undefined && !isBool(m.spectate)) return bad('spectate must be bool');
      return { ok: true, msg: { type, roomId: m.roomId, spectate: m.spectate === true } };
    case 'lobby_join_private':
    case 'lobby_spectate':
      if (!isStr(m.roomCode, ROOM_CODE_LENGTH) || (m.roomCode as string).length !== ROOM_CODE_LENGTH) return bad('roomCode invalid');
      return { ok: true, msg: { type, roomCode: (m.roomCode as string).toUpperCase() } };
    case 'lobby_set_ready':
      if (!isBool(m.ready)) return bad('ready must be bool');
      return { ok: true, msg: { type, ready: m.ready } };
    case 'cmd_flag_issue':
      if (!inRange(m.unit, 0, 2)) return bad('unit must be 0..2');
      if (!isInt(m.troops) || m.troops < 0) return bad('troops must be int >= 0');
      if (!isU32(m.anchorTileId)) return bad('anchorTileId must be uint32');
      if (m.originBaseTileId !== undefined && m.originBaseTileId !== null && !isU32(m.originBaseTileId)) return bad('originBaseTileId');
      return {
        ok: true,
        msg: {
          type,
          clientSeq: seq!,
          unit: m.unit as 0 | 1 | 2,
          troops: m.troops,
          anchorTileId: m.anchorTileId,
          originBaseTileId: (m.originBaseTileId as number | null | undefined) ?? null,
        },
      };
    case 'cmd_flag_retarget':
      if (!isU32(m.flagId) || !isU32(m.anchorTileId)) return bad('flagId/anchorTileId must be uint32');
      return { ok: true, msg: { type, clientSeq: seq!, flagId: m.flagId, anchorTileId: m.anchorTileId } };
    case 'cmd_flag_recall':
      if (!isU32(m.flagId)) return bad('flagId must be uint32');
      // v4.2 [A-61]: baseTileId 는 추가만 (생략·null = 자동 귀환지)
      if (m.baseTileId !== undefined && m.baseTileId !== null && !isU32(m.baseTileId)) return bad('baseTileId must be uint32|null');
      return { ok: true, msg: { type, clientSeq: seq!, flagId: m.flagId, baseTileId: (m.baseTileId as number | null | undefined) ?? null } };
    case 'cmd_set_posture':
      if (!isU32(m.flagId)) return bad('flagId must be uint32');
      if (!inRange(m.posture, 0, 1)) return bad('posture must be 0|1');
      return { ok: true, msg: { type, clientSeq: seq!, flagId: m.flagId, posture: m.posture as 0 | 1 } };
    case 'cmd_buy_tech':
      // v4.3 [A-83]: { nodeId } (구 { axis, tier } 폐기)
      if (!inRange(m.nodeId, 0, TECH_NODE_COUNT - 1)) return bad('nodeId must be 0..31');
      return { ok: true, msg: { type, clientSeq: seq!, nodeId: m.nodeId } };
    case 'cmd_ally_propose':
      if (!inRange(m.targetPlayerId, 1, MAX_PLAYERS)) return bad('targetPlayerId');
      return { ok: true, msg: { type, clientSeq: seq!, targetPlayerId: m.targetPlayerId } };
    case 'cmd_ally_respond':
      if (!isU32(m.proposalId) || !isBool(m.accept)) return bad('proposalId/accept');
      return { ok: true, msg: { type, clientSeq: seq!, proposalId: m.proposalId, accept: m.accept } };
    case 'cmd_ally_break':
      if (!inRange(m.allyPlayerId, 1, MAX_PLAYERS)) return bad('allyPlayerId');
      return { ok: true, msg: { type, clientSeq: seq!, allyPlayerId: m.allyPlayerId } };
    case 'emote':
      if (!isInt(m.code)) return bad('code must be int');
      // §26 대상 이모트: 선택 필드. 있으면 1..MAX_PLAYERS 정수 (그 판에 있는 플레이어인지는 룸이 본다)
      if (m.targetPlayerId === undefined || m.targetPlayerId === null) return { ok: true, msg: { type, code: m.code } };
      if (!inRange(m.targetPlayerId, 1, MAX_PLAYERS)) return bad('targetPlayerId');
      return { ok: true, msg: { type, code: m.code, targetPlayerId: m.targetPlayerId } };
    case 'ping':
      if (typeof m.clientTime !== 'number' || !Number.isFinite(m.clientTime)) return bad('clientTime must be number');
      return { ok: true, msg: { type, clientTime: m.clientTime } };
    default:
      return bad(`unknown type ${type}`);
  }
}

export function sanitizeNickname(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length < 1 || s.length > NICKNAME_MAX_LEN) return null;
  return s;
}
