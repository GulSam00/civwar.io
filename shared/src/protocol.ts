/**
 * civwar.io WebSocket 프로토콜 타입 (GDD v4.0 7장).
 * 신뢰 소스 문서: _workspace/02_backend_protocol.md — 이 파일과 문서는 항상 함께 갱신한다.
 *
 * 전송: 텍스트 프레임 1개 = JSON 객체 1개. 모든 메시지는 `type` 판별 필드를 갖는다.
 * 정수 규칙: tileId/playerId/flagId/tick 은 정수. troops/gold 는 표시용 정수(내부 milli 의 floor).
 */

import type { Posture, Terrain, TechAxis, Unit } from './constants.js';

// ─────────────────────────────── 공통 ───────────────────────────────

export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'IN_GAME' | 'GAME_OVER';
export type MemberStatus = 'LOBBY_WAITING' | 'PLAYING' | 'ELIMINATED_SPECTATING' | 'DISCONNECTED';
export type FlagState = 'MARCHING' | 'ENGAGED' | 'RETURNING' | 'IDLE';
export type GameOverReason = 'last_standing' | 'threshold' | 'timeout';

/** [value, runLength, value, runLength, ...] */
export type Rle = number[];

/** 명령 거절 코드 (cmd_ack.reason) */
export type CmdRejectReason =
  // GDD 7.2 / 7.3
  | 'ELIMINATED'
  | 'NO_SLOT'
  | 'BAD_UNIT'
  | 'WATER'
  | 'ALLIED'
  | 'OUT_OF_RANGE'
  | 'TOO_SMALL'
  | 'INSUFFICIENT'
  | 'NO_FLAG'
  | 'RETURNING'
  | 'LOCKED'
  | 'NOT_BASE'
  | 'NOT_OWNED_BASE'
  | 'ROUTED'
  | 'IN_COMBAT'
  | 'DISENGAGING'
  | 'POSTURE_COOLDOWN'
  | 'SAME_POSTURE'
  // 백엔드 추가 (02_backend_protocol.md 「GDD와 다른 결정」)
  | 'BAD_REQUEST'
  | 'NOT_IN_GAME'
  | 'TECH_ORDER'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED';

/** error.code (연결·로비 수준 오류) */
export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'BAD_VERSION'
  | 'NOT_HELLO'
  | 'ALREADY_HELLO'
  | 'BAD_NICKNAME'
  | 'BAD_TARGET_PLAYERS'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_PROGRESS'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_LOBBY'
  | 'RATE_LIMITED';

// ─────────────────────────── Client → Server ───────────────────────────

export interface C2S_Hello {
  type: 'hello';
  nickname: string;
  clientVersion: number;
  /** 재접속 시 이전 welcome 의 playerToken (백엔드 추가) */
  playerToken?: string;
}
export interface C2S_LobbyJoinPublic {
  type: 'lobby_join_public';
}
export interface C2S_LobbyCreatePrivate {
  type: 'lobby_create_private';
  targetPlayers: number; // 8..12
  /** 1차: 수신하되 무시 (HARD_TIMEOUT_TICK 단일 소스) */
  timeLimitMin?: number;
}
export interface C2S_LobbyJoinPrivate {
  type: 'lobby_join_private';
  roomCode: string;
}
/** 백엔드 추가: 진행 중 룸 관전 입장 */
export interface C2S_LobbySpectate {
  type: 'lobby_spectate';
  roomCode: string;
}
export interface C2S_LobbyLeave {
  type: 'lobby_leave';
}
export interface C2S_LobbySetReady {
  type: 'lobby_set_ready';
  ready: boolean;
}
export interface C2S_LobbyStartNow {
  type: 'lobby_start_now';
}

export interface C2S_CmdFlagIssue {
  type: 'cmd_flag_issue';
  clientSeq: number;
  unit: Unit;
  troops: number;
  anchorTileId: number;
  originBaseTileId?: number | null;
}
export interface C2S_CmdFlagRetarget {
  type: 'cmd_flag_retarget';
  clientSeq: number;
  flagId: number;
  anchorTileId: number;
}
export interface C2S_CmdFlagRecall {
  type: 'cmd_flag_recall';
  clientSeq: number;
  flagId: number;
}
export interface C2S_CmdSetPosture {
  type: 'cmd_set_posture';
  clientSeq: number;
  flagId: number;
  posture: Posture;
}
export interface C2S_CmdBuyTech {
  type: 'cmd_buy_tech';
  clientSeq: number;
  axis: TechAxis;
  tier: 1 | 2 | 3;
}
export interface C2S_CmdAllyPropose {
  type: 'cmd_ally_propose';
  clientSeq: number;
  targetPlayerId: number;
}
export interface C2S_CmdAllyRespond {
  type: 'cmd_ally_respond';
  clientSeq: number;
  proposalId: number;
  accept: boolean;
}
export interface C2S_CmdAllyBreak {
  type: 'cmd_ally_break';
  clientSeq: number;
  allyPlayerId: number;
}
export interface C2S_Emote {
  type: 'emote';
  code: number;
}
export interface C2S_Ping {
  type: 'ping';
  clientTime: number;
}

export type C2S_GameCommand =
  | C2S_CmdFlagIssue
  | C2S_CmdFlagRetarget
  | C2S_CmdFlagRecall
  | C2S_CmdSetPosture
  | C2S_CmdBuyTech
  | C2S_CmdAllyPropose
  | C2S_CmdAllyRespond
  | C2S_CmdAllyBreak;

export type ClientMessage =
  | C2S_Hello
  | C2S_LobbyJoinPublic
  | C2S_LobbyCreatePrivate
  | C2S_LobbyJoinPrivate
  | C2S_LobbySpectate
  | C2S_LobbyLeave
  | C2S_LobbySetReady
  | C2S_LobbyStartNow
  | C2S_GameCommand
  | C2S_Emote
  | C2S_Ping;

// ─────────────────────────── Server → Client ───────────────────────────

export interface S2C_Welcome {
  type: 'welcome';
  /** 연결 세션 식별자(문자열). 게임 내 숫자 playerId 는 room_state.players[].playerId */
  sessionId: string;
  playerToken: string;
  serverTick: number;
  protocolVersion: number;
  tickMs: number;
  /** 재접속으로 복구된 세션이면 true */
  resumed: boolean;
}

export interface RoomMember {
  playerId: number; // 1..12, 룸 입장 시 배정 (봇 포함)
  sessionId: string | null; // 봇이면 null
  nickname: string;
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  status: MemberStatus;
}
export interface S2C_RoomState {
  type: 'room_state';
  roomId: string;
  roomCode: string;
  isPublic: boolean;
  phase: RoomPhase;
  hostId: number | null; // playerId
  targetPlayers: number;
  players: RoomMember[];
  spectatorCount: number;
  countdownMs: number | null; // COUNTDOWN 일 때 남은 ms
}

export interface S2C_MatchConfig {
  type: 'match_config';
  seed: number;
  topology: 'square';
  width: number;
  height: number;
  totalLandTiles: number;
  tickMs: number;
  hardTimeoutTick: number;
  endgameRush: { tick: number; costMultPermille: number };
  thresholdCurve: {
    startPct: number;
    decayStartTick: number;
    decayPerMinPermille: number;
    floorPct: number;
    scale: number;
  };
  /** shared/constants.ts 의 export 전체(함수·타입 제외) */
  constants: Record<string, unknown>;
}

export interface SpawnInfo {
  playerId: number;
  tileId: number;
  homeTileId: number;
}
export interface S2C_MapInit {
  type: 'map_init';
  terrain: Rle; // 값 도메인 0..6 (Terrain)
  spawns: SpawnInfo[];
  bases: number[]; // tileId 오름차순
}

export interface PlayerSnapshot {
  id: number;
  tiles: number;
  troops: number;
  gold: number;
  goldWeight: number;
  upkeepPm: number;
  tech: [number, number, number, number]; // 축별 구매 단계 0..3
  flagCap: number;
  alive: boolean;
  connected: boolean;
}

export interface FlagSnapshot {
  id: number;
  ownerId: number;
  slotIndex: number;
  unit: Unit;
  posture: Posture;
  troops: number;
  posTileId: number;
  anchorTileId: number;
  targetOwnerId: number;
  state: FlagState;
  targetTileId: number | null;
  progressPct: number;
  stalled: boolean;
  inCombat: boolean;
  routed: boolean;
  blocked: boolean;
  disengaging: boolean;
  postureCooldownUntilTick: number;
}

export interface BaseSnapshot {
  tileId: number;
  ownerId: number;
  hpPct: number;
}

export interface AllianceSnapshot {
  a: number;
  b: number;
  state: 'ACTIVE' | 'BREAKING';
  sinceTick: number;
  breakAtTick: number | null;
}

export interface S2C_SnapshotFull {
  type: 'snapshot_full';
  tick: number;
  owners: Rle;
  players: PlayerSnapshot[];
  flags: FlagSnapshot[];
  bases: BaseSnapshot[];
  alliances: AllianceSnapshot[];
  /** 표시용 실수(예: 58.5). 판정은 서버 정수식 */
  thresholdPct: number;
  ticksRemaining: number;
  endgameRushActive: boolean;
}

export interface PlayerDelta {
  id: number;
  tiles: number;
  troops: number;
  gold: number;
  goldWeight: number;
  upkeepPm: number;
}

export interface S2C_SnapshotDelta {
  type: 'snapshot_delta';
  tick: number;
  tileChanges: [number, number][]; // [tileId, ownerId]
  playerDeltas: PlayerDelta[]; // PLAYER_DELTA_INTERVAL 마다, 바뀐 플레이어만
  flagMoves: [number, number][]; // [flagId, posTileId]
  flagStats: [number, number, FlagState][]; // [flagId, troops, state]
  flagProgress: [number, number][]; // [flagId, progressPct]
  flagTargets: [number, number | null][]; // [flagId, targetTileId]
  baseHp: [number, number][]; // [tileId, hpPct] — BASE_HP_DELTA_INTERVAL 마다, 바뀐 기지만
  flagsGone: number[];
  thresholdPct?: number; // 값이 바뀐 tick 에만
}

export interface S2C_CmdAck {
  type: 'cmd_ack';
  clientSeq: number;
  accepted: boolean;
  reason?: CmdRejectReason;
  flagId?: number;
  posture?: Posture;
}

export interface S2C_Error {
  type: 'error';
  code: ErrorCode;
  message: string;
}
export interface S2C_Pong {
  type: 'pong';
  clientTime: number;
  serverTime: number;
  tick: number;
}

export interface S2C_TechPurchased {
  type: 'tech_purchased';
  tick: number;
  playerId: number;
  axis: TechAxis;
  tier: number;
  cost: number;
  newFlagCap: number;
}
export interface S2C_ThresholdUpdate {
  type: 'threshold_update';
  tick: number;
  thresholdPct: number;
}
export interface S2C_EndgameRush {
  type: 'endgame_rush';
  tick: number;
  costMultPermille: number;
}
export interface S2C_PlayerEliminated {
  type: 'player_eliminated';
  tick: number;
  playerId: number;
  byPlayerId: number | null;
}
export interface S2C_BotTakeover {
  type: 'bot_takeover';
  tick: number;
  playerId: number;
}
export interface S2C_PlayerReconnected {
  type: 'player_reconnected';
  tick: number;
  playerId: number;
}
export interface S2C_EmoteBroadcast {
  type: 'emote_broadcast';
  tick: number;
  playerId: number;
  code: number;
}
export interface Standing {
  rank: number;
  playerId: number;
  tiles: number;
  troops: number;
  goldEarned: number;
  alive: boolean;
}
export interface S2C_GameOver {
  type: 'game_over';
  finalTick: number;
  winnerId: number | null;
  reason: GameOverReason;
  standings: Standing[];
}

/** 1차에서 실제로 송신되는 S→C 메시지 */
export type ServerMessage =
  | S2C_Welcome
  | S2C_RoomState
  | S2C_MatchConfig
  | S2C_MapInit
  | S2C_SnapshotFull
  | S2C_SnapshotDelta
  | S2C_CmdAck
  | S2C_Error
  | S2C_Pong
  | S2C_TechPurchased
  | S2C_ThresholdUpdate
  | S2C_EndgameRush
  | S2C_PlayerEliminated
  | S2C_BotTakeover
  | S2C_PlayerReconnected
  | S2C_EmoteBroadcast
  | S2C_GameOver;

/**
 * 2차·3차 예약 (GDD 7.3) — 타입 이름만 고정, 1차 서버는 송신하지 않는다.
 * flag_issued, flag_retargeted, flag_engaged, flag_stalled, flag_progress_lost, flag_idle,
 * flag_ended, combat_started, combat_ended, flag_routed, flag_posture_changed,
 * flag_blocked, flag_unblocked, flag_disengage_started, flag_disengaged, base_captured,
 * ally_proposed, ally_formed, ally_break_started, ally_broken, alliance_lockout
 */
export type ReservedServerMessageType =
  | 'flag_issued'
  | 'flag_retargeted'
  | 'flag_engaged'
  | 'flag_stalled'
  | 'flag_progress_lost'
  | 'flag_idle'
  | 'flag_ended'
  | 'combat_started'
  | 'combat_ended'
  | 'flag_routed'
  | 'flag_posture_changed'
  | 'flag_blocked'
  | 'flag_unblocked'
  | 'flag_disengage_started'
  | 'flag_disengaged'
  | 'base_captured'
  | 'ally_proposed'
  | 'ally_formed'
  | 'ally_break_started'
  | 'ally_broken'
  | 'alliance_lockout';

export type { Terrain };
