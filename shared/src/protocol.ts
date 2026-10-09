/**
 * civwar.io WebSocket 프로토콜 타입 (GDD v4.1 7장).
 * 신뢰 소스 문서: _workspace/02_backend_protocol.md — 이 파일과 문서는 항상 함께 갱신한다.
 *
 * 전송: 텍스트 프레임 1개 = JSON 객체 1개. 모든 메시지는 `type` 판별 필드를 갖는다.
 * 정수 규칙: tileId/playerId/flagId/tick 은 정수. troops/gold 는 표시용 정수(내부 milli 의 floor).
 */

import type { BotDifficultyName, MapSizeClass, Posture, Terrain, TechAxis, Unit } from './constants.js';

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
  /** 2차부터 송신하지 않음 (호환용으로 타입만 유지) */
  | 'NOT_IMPLEMENTED'
  // 백엔드 추가 (2차, 동맹 — GDD 6.2 는 거절 코드를 정하지 않음)
  | 'BAD_TARGET' // 자기 자신·없는·탈락한 플레이어
  | 'ALLY_LIMIT' // MAX_ALLIES_PER_PLAYER 초과 (나 또는 상대)
  | 'ALLY_CUTOFF' // t >= ALLIANCE_CUTOFF_TICK
  | 'ALLY_FROZEN' // lockout 강제 해제 후 재체결 금지 기간
  | 'ALREADY_ALLIED' // 이미 ACTIVE/BREAKING
  | 'ALLY_PENDING' // 같은 상대에게 보낸 유효 제안이 이미 있음
  | 'NO_PROPOSAL' // 없는·만료된·내게 온 것이 아닌 제안
  | 'NOT_ALLIED' // 파기 대상이 ACTIVE 동맹이 아님
  | 'MIN_DURATION'; // ALLIANCE_MIN_DURATION 미경과

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
  | 'RATE_LIMITED'
  // v4.1 방 설정 (GDD 7.2a)
  | 'BAD_ROOM_OPTIONS' // 필드 타입·범위 위반, size ∉ {S,M,L}, maxPlayers > 맵 최대 인원, maxPlayers < 현재 사람 수
  | 'MAP_NOT_FOUND' // mapId 가 공식 맵 목록에 없음
  | 'NOT_ENOUGH_PLAYERS'; // 시작 시 사람 + 봇 < 2 (프리셋은 max(2, players.min))

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
/** v4.1 방 설정 — 맵 선택 (GDD 2.8 / 7.2a) */
export interface WaterConfigWire {
  /** 'BORDER_ONLY' | 'SHALLOW_QUOTA' */
  waterMode: 'BORDER_ONLY' | 'SHALLOW_QUOTA';
  /** SHALLOW_QUOTA 에서만 의미. 0..1000 */
  shallowPermille: number;
}
export type MapChoice =
  | { kind: 'random'; size: MapSizeClass; water?: WaterConfigWire }
  | { kind: 'preset'; mapId: string };
/** 방 설정 옵션 — 모든 필드 생략 가능 (생략 = 기본값 / update 에서는 현재값 유지) */
export interface RoomOptions {
  map?: MapChoice;
  maxPlayers?: number; // 2 .. min(12, 맵 최대 인원)
  botCount?: number; // 0 .. maxPlayers − 1. 시작 시 maxPlayers − 사람 수로 클램프
  botDifficulty?: BotDifficultyName;
}
export interface C2S_LobbyCreatePrivate extends RoomOptions {
  type: 'lobby_create_private';
  /** v4.0 호환: maxPlayers 가 없을 때만 maxPlayers 로 읽는다(범위 2..12). 다음 버전에서 제거 */
  targetPlayers?: number;
  /** 수신하되 무시 (HARD_TIMEOUT_TICK 단일 소스) */
  timeLimitMin?: number;
}
/** v4.1: 방장이 LOBBY 중 설정 변경 (부분 갱신) */
export interface C2S_LobbyUpdateSettings extends RoomOptions {
  type: 'lobby_update_settings';
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
  | C2S_LobbyUpdateSettings
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
  /** v4.1: 공식 프리셋 맵 목록(파일의 메타만, id ASC). 없으면 [] */
  officialMaps: OfficialMapInfo[];
}

export interface OfficialMapInfo {
  id: string;
  name: { ko: string; en: string };
  sizeClass: MapSizeClass;
  players: { min: number; recommendedMin: number; recommendedMax: number; max: number };
}

/** v4.1 room_state.settings — 방 설정 에코 + 표시용 파생값 */
export interface RoomSettingsEcho {
  /** random 이면 water 는 항상 채워서 보낸다(생략 시 기본 물) */
  map: MapChoice;
  maxPlayers: number;
  botCount: number;
  botDifficulty: BotDifficultyName;
  /** 맵(크기 프리셋 또는 프리셋 파일)의 최대 인원 — 슬라이더 상한 */
  mapMaxPlayers: number;
  /** 추천 인원 [하한, 상한] */
  recommended: [number, number];
  /** 지금 시작하면 될 인원(사람 + 클램프된 봇, 공개 방은 정원) 기준. "guaranteed" | "estimate:<분>" | "timeout_likely" */
  pacingNote: string;
  /** pacingNote 계산에 쓴 예상 시작 인원 */
  expectedPlayers: number;
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
  /** v4.1: targetPlayers 제거 → settings.maxPlayers */
  settings: RoomSettingsEcho;
  players: RoomMember[];
  spectatorCount: number;
  countdownMs: number | null; // COUNTDOWN 일 때 남은 ms
  /** 프론트 2차 추가: 공개 룸 LOBBY 일 때 자동 시작까지 남은 ms (그 외 null). 수신 시각 기준 — 클라이언트가 로컬로 줄인다 */
  autoStartMs: number | null;
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
  /** v4.1: 맵 출처 */
  mapSource: 'random' | 'preset';
  /** preset 일 때만 */
  mapId?: string;
  /** v4.1: 방 봇 난이도 (봇 인계 포함 전 봇 공통) */
  botDifficulty: BotDifficultyName;
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
  /** 2차 추가: 이탈 대기 종료 tick (disengaging 이면 숫자) */
  disengageUntilTick: number | null;
  /** 2차 추가: 이탈 완료 후 첫 칸 이동 전 — 교전 대상 아님 */
  breakaway: boolean;
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
  /** 2차 추가: 유효한 동맹 제안 (proposalId ASC) */
  allyProposals: AllyProposalSnapshot[];
  /** 2차 추가: lockout 강제 해제 후 재체결 금지 종료 tick (없으면 null) */
  allianceFreezeUntilTick: number | null;
  /** 2차 추가: lockout 카운트다운 중이면 강제 해제 tick */
  lockoutDissolveTick: number | null;
}
export interface AllyProposalSnapshot {
  proposalId: number;
  fromPlayerId: number;
  toPlayerId: number;
  expireTick: number;
}
/** flagFlags 비트 (2차 추가) */
export const FLAG_BIT = {
  IN_COMBAT: 1,
  ROUTED: 2,
  BLOCKED: 4,
  DISENGAGING: 8,
  BREAKAWAY: 16,
  STALLED: 32,
} as const;

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
  /** 2차 추가: [flagId, posture, bits(FLAG_BIT), postureCooldownUntilTick] — 셋 중 하나라도 바뀐 깃발만, 매 tick */
  flagFlags: [number, Posture, number, number][];
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

// ─────────────── 2차 이벤트 (GDD 7.3, 4장·6.2) ───────────────
export type FlagIdleReason = 'front_cleared' | 'guard_lost' | 'unreachable' | 'allied';
export type FlagEndReason = 'exhausted' | 'recalled' | 'attrited' | 'eliminated' | 'routed_returned';
export interface S2C_FlagIssued {
  type: 'flag_issued';
  tick: number;
  flagId: number;
  playerId: number;
  slotIndex: number;
  unit: Unit;
  posture: Posture;
  troops: number;
  originTileId: number;
  anchorTileId: number;
  targetOwnerId: number;
  etaTick: number;
}
export interface S2C_FlagRetargeted {
  type: 'flag_retargeted';
  tick: number;
  flagId: number;
  anchorTileId: number;
  targetOwnerId: number;
  posture: Posture;
  resumeTick: number;
  etaTick: number;
  auto: boolean;
}
export interface S2C_FlagRecalled {
  type: 'flag_recalled';
  tick: number;
  flagId: number;
  returnTileId: number;
}
export interface S2C_FlagEngaged {
  type: 'flag_engaged';
  tick: number;
  flagId: number;
  posture: Posture;
  frontTileCount?: number; // ATTACK
  guardTileCount?: number; // DEFEND
}
export interface S2C_FlagStalled {
  type: 'flag_stalled';
  tick: number;
  flagId: number;
  tileId: number | null;
}
export interface S2C_FlagProgressLost {
  type: 'flag_progress_lost';
  tick: number;
  flagId: number;
  tileId: number;
  /** v4.1: 'decayed' = 진척도 자동 감소로 0 도달 (4.7 e) */
  cause: 'captured_by_other' | 'target_lost' | 'decayed';
}
export interface S2C_FlagIdle {
  type: 'flag_idle';
  tick: number;
  flagId: number;
  reason: FlagIdleReason;
  autoRecallTick: number;
}
export interface S2C_FlagEnded {
  type: 'flag_ended';
  tick: number;
  flagId: number;
  reason: FlagEndReason;
  refunded: number;
}
export interface CombatSide {
  sideKey: number;
  ownerIds: number[];
  troops: number;
  power: number; // 편 실효값 W (permille)
}
export interface S2C_CombatStarted {
  type: 'combat_started';
  tick: number;
  groupKey: number;
  flagIds: number[];
  sides: CombatSide[];
}
export interface S2C_CombatEnded {
  type: 'combat_ended';
  tick: number;
  groupKey: number;
  winnerSideKey: number | null;
  routedFlagIds: number[];
}
export interface S2C_FlagRouted {
  type: 'flag_routed';
  tick: number;
  flagId: number;
  returnTileId: number;
}
export interface S2C_FlagPostureChanged {
  type: 'flag_posture_changed';
  tick: number;
  flagId: number;
  posture: Posture;
  cooldownUntilTick: number;
  auto: boolean;
  /** QA I-1 (추가 필드): 전환 후 targetOwnerId — owners[anchor] == 소유자 ? 254(ANY_HOSTILE) : owners[anchor] (1단계 처리 시점 owners) */
  targetOwnerId: number;
}
export interface S2C_FlagBlocked {
  type: 'flag_blocked';
  tick: number;
  flagId: number;
  byFlagIds: number[];
}
export interface S2C_FlagUnblocked {
  type: 'flag_unblocked';
  tick: number;
  flagId: number;
}
export interface S2C_FlagDisengageStarted {
  type: 'flag_disengage_started';
  tick: number;
  flagId: number;
  untilTick: number;
}
export interface S2C_FlagDisengaged {
  type: 'flag_disengaged';
  tick: number;
  flagId: number;
  reason: 'broke_away' | 'combat_over';
}
export interface S2C_BaseCaptured {
  type: 'base_captured';
  tick: number;
  tileId: number;
  fromPlayerId: number;
  toPlayerId: number;
  newHpPct: number;
}
export interface S2C_AllyProposed {
  type: 'ally_proposed';
  tick: number;
  proposalId: number;
  fromPlayerId: number;
  toPlayerId: number;
  expireTick: number;
}
export interface S2C_AllyProposalClosed {
  type: 'ally_proposal_closed';
  tick: number;
  proposalId: number;
  reason: 'declined' | 'expired' | 'formed' | 'invalidated';
}
export interface S2C_AllyFormed {
  type: 'ally_formed';
  tick: number;
  a: number;
  b: number;
}
export interface S2C_AllyBreakStarted {
  type: 'ally_break_started';
  tick: number;
  a: number;
  b: number;
  byPlayerId: number;
  breakAtTick: number;
}
export interface S2C_AllyBroken {
  type: 'ally_broken';
  tick: number;
  a: number;
  b: number;
  reason: 'cooldown_elapsed' | 'lockout' | 'eliminated';
}
export interface S2C_AllianceLockout {
  type: 'alliance_lockout';
  tick: number;
  phase: 'countdown' | 'cancelled' | 'dissolved';
  reason: 'all_allied';
  forceDissolveTick: number | null;
  freezeUntilTick: number | null;
}

/** 서버가 실제로 송신하는 S→C 메시지 (1차 + 2차) */
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
  | S2C_GameOver
  // 2차
  | S2C_FlagIssued
  | S2C_FlagRetargeted
  | S2C_FlagRecalled
  | S2C_FlagEngaged
  | S2C_FlagStalled
  | S2C_FlagProgressLost
  | S2C_FlagIdle
  | S2C_FlagEnded
  | S2C_CombatStarted
  | S2C_CombatEnded
  | S2C_FlagRouted
  | S2C_FlagPostureChanged
  | S2C_FlagBlocked
  | S2C_FlagUnblocked
  | S2C_FlagDisengageStarted
  | S2C_FlagDisengaged
  | S2C_BaseCaptured
  | S2C_AllyProposed
  | S2C_AllyProposalClosed
  | S2C_AllyFormed
  | S2C_AllyBreakStarted
  | S2C_AllyBroken
  | S2C_AllianceLockout;

/**
 * GDD 7.3 예약 이름 목록 — 2차부터 전부 실제 송신(위 S2C_* 타입 참조). 호환용으로 유지.
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
