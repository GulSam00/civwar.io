/**
 * civwar.io WebSocket 프로토콜 타입 (GDD v4.2 7장).
 * 신뢰 소스 문서: _workspace/02_backend_protocol.md — 이 파일과 문서는 항상 함께 갱신한다.
 *
 * 전송: 텍스트 프레임 1개 = JSON 객체 1개. 모든 메시지는 `type` 판별 필드를 갖는다.
 * 정수 규칙: tileId/playerId/flagId/tick 은 정수. troops/gold 는 표시용 정수(내부 milli 의 floor).
 */

import type { BotDifficultyName, MapSizeClass, Posture, Terrain, Unit } from './constants.js';

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
  /** v4.3 부터 송신하지 않음 (PREREQ_MISSING / ALREADY_OWNED 로 분리 — 호환용으로 타입만 유지) */
  | 'TECH_ORDER'
  /** v4.3: cmd_buy_tech — 부모 노드 미보유 */
  | 'PREREQ_MISSING'
  /** v4.3: cmd_buy_tech — 이미 보유한 노드 */
  | 'ALREADY_OWNED'
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
/** 플레이테스트 후속 (필드·메시지 추가): 방 찾기 — 공개 방 목록 요청 → room_list. 세션당 1초 1회 (초과 = error RATE_LIMITED) */
export interface C2S_LobbyListRooms {
  type: 'lobby_list_rooms';
}
/** 플레이테스트 후속: 목록의 roomId 로 입장(spectate=false, 대기 중 공개 방) 또는 관전(spectate=true, 진행·종료 공개 방). 비공개 방은 ROOM_NOT_FOUND */
export interface C2S_LobbyJoinListed {
  type: 'lobby_join_listed';
  roomId: string;
  spectate: boolean;
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
  /** v4.2 [A-61] (추가만): 귀환할 내 기지 tileId. 생략·null = 자동(출발 기지 → 최근접 내 기지 → 수도). 거절 NOT_BASE / NOT_OWNED_BASE */
  baseTileId?: number | null;
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
  /** v4.3 [A-83]: TECH_NODES 의 id (0..31). 구 { axis, tier } 는 폐기 */
  nodeId: number;
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
  | C2S_LobbyListRooms
  | C2S_LobbyJoinListed
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
  /** 프론트 QA m-8 (필드 추가): 맵 파일 checksum ("sha256:…", terrain+spawns+bases). 클라이언트 번들 미리보기 데이터와 대조용 */
  checksum: string;
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

/** 방 찾기 목록 항목 — 공개 방만 (비공개 방은 코드로만). 방 코드는 싣지 않는다 */
export interface RoomListing {
  /** 서버 룸 핸들 (lobby_join_listed 에 그대로) */
  roomId: string;
  phase: RoomPhase;
  map: MapChoice;
  /** preset 이면 공식 맵 이름, random 이면 null */
  mapName: { ko: string; en: string } | null;
  width: number;
  height: number;
  /** 사람 수 (인게임: 사람 자리 — 끊긴 자리 포함) */
  humans: number;
  /** 봇 수 (LOBBY: 지금 시작하면 채울 봇 수) */
  bots: number;
  maxPlayers: number;
  spectatorCount: number;
  /** LOBBY/COUNTDOWN: 룸 생성 후 경과 ms, IN_GAME/GAME_OVER: 게임 경과 ms (tick × TICK_MS) */
  elapsedMs: number;
  /** 공개 LOBBY 의 자동 시작까지 남은 ms (room_state.autoStartMs 와 같은 값), 그 외 null */
  autoStartMs: number | null;
  /** 지금 lobby_join_listed(spectate=false) 로 들어갈 수 있는가 (LOBBY ∧ 빈자리) */
  joinable: boolean;
  /** 지금 관전 가능한가 (IN_GAME ∨ GAME_OVER) */
  spectatable: boolean;
}
export interface S2C_RoomList {
  type: 'room_list';
  /** 목록 생성 시각 (서버 Date.now) */
  serverTime: number;
  /** 정렬: 입장 가능 → 대기 중(가득) → 진행 중(경과 짧은 순) → 종료. 최대 50 */
  rooms: RoomListing[];
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
  /**
   * v4.4 (§21, 추가만): 기지 지명 — bases 와 같은 순서·같은 길이(baseNames[i] = bases[i] 의 이름). 수도 포함, 매치 안에서 고유.
   * 서버는 항상 싣는다 (TS 타입만 optional — 구 클라이언트 리터럴 호환)
   */
  baseNames?: string[];
}

export interface PlayerSnapshot {
  id: number;
  tiles: number;
  troops: number;
  gold: number;
  goldWeight: number;
  upkeepPm: number;
  /** v4.3 [A-83]: 보유 테크 노드 비트마스크 (uint32, 비트 i = TECH_NODES[i] 보유). 구 tech[4] 는 폐기 */
  techMask: number;
  /** v4.3: 보유 노드 수 (= popcount(techMask) = 누진 가격의 n) */
  techCount: number;
  flagCap: number;
  alive: boolean;
  connected: boolean;
  /** §23 (2026-10-18, 추가만): 이 플레이어가 시작한 동맹 파기 수 (ally_break_started.byPlayerId 기준 누적). 서버는 항상 싣는다 (옵셔널 = 구 픽스처 호환) */
  allyBreaks?: number;
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
  /**
   * v4.2 (4.4a, 추가만): MARCHING·ATTACK 깃발이 옆 칸을 점령하려고 멈춘 상태(정지 점령). 서버는 항상 싣는다.
   * (TS 타입만 optional — 구 클라이언트 코드가 FlagSnapshot 리터럴을 만드는 곳의 호환용)
   */
  halted?: boolean;
  /** v4.2 [A-61] (추가만): cmd_flag_recall{baseTileId} 로 지정한 귀환 기지. null = 자동. 서버는 항상 싣는다 */
  returnBaseTileId?: number | null;
  /**
   * v4.4 (§21, 추가만): 재지정이 정한 도착지 태세가 아직 적용되지 않았으면 그 태세(전투·이탈 대기·태세 쿨타임 중), 아니면 null.
   * 조건이 풀리는 첫 tick 에 서버가 자동 적용(flag_posture_changed auto:true). 델타는 flagFlags 비트 POSTURE_PENDING(128). 서버는 항상 싣는다
   */
  pendingPosture?: Posture | null;
}

export interface BaseSnapshot {
  tileId: number;
  ownerId: number;
  hpPct: number;
  /** v4.4 (§21, 추가만): 기지 생산력 ‰ (0..1000). 점령 시 ×0.5, 이후 선형 회복. 서버는 항상 싣는다 */
  prodPm?: number;
}

/**
 * v4.5 (§22, 사용자 2026-10-15): 생산 내역 한 행. 생산 지역 개념은 폐기됐다(§21.4 대체).
 * kind = 'base'      : 내 기지 한 칸의 생산 = 영토 BASE_PROD_TILES(60)칸분 (수도 CAPITAL_PROD_TILES 100칸분) × 그 기지 생산력.
 * kind = 'territory' : 내 땅 전체(기지 칸 포함)의 생산 합 — 생산력 페널티 없음. 플레이어당 1행, 항상 맨 끝.
 */
export interface ProductionRow {
  kind: 'base' | 'territory';
  /** 기지 행 = 기지 tileId, 영토 행 = null */
  baseTileId: number | null;
  /** 기지 행 = 환산 칸 수(60 / 수도 100 — 생산력 반영 전), 영토 행 = 실제 소유 칸 수 */
  tiles: number;
  /** 기지 행 = 적용된 생산력 ‰ (0..1000), 영토 행 = 1000 고정 */
  prodPm: number;
  /** 병력 재생 (milli 병력 / 초) — 병력/초 = 값 / 1000 */
  troopsPerSecMilli: number;
  /** 그로스 골드 (milli 골드 / 초, 유지비 차감 전) */
  goldGrossPerSecMilli: number;
  /** 순골드 (milli 골드 / 초, 유지비 차감 후) */
  goldNetPerSecMilli: number;
}
/** v4.5 (§22): 플레이어별 생산 내역. rows = 기지 행(tileId 오름차순) + 영토 행 1개(맨 끝). 행 합 = 플레이어 총 생산 (정확히) */
export interface PlayerProduction {
  playerId: number;
  rows: ProductionRow[];
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
  /** v4.4 (§21) → v4.5 (§22 형식 변경): 플레이어별 생산 내역 (id ASC 전원, 탈락자는 rows []). 직전 2단계 정산값. 서버는 항상 싣는다 */
  production?: PlayerProduction[];
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
  /** v4.2 (4.4a): 행군 중 정지 점령 */
  HALTED: 64,
  /** v4.4 (§21): 재지정의 도착지 태세가 대기 중 (pendingPosture != null — 값은 현재 태세의 반대) */
  POSTURE_PENDING: 128,
} as const;

export interface PlayerDelta {
  id: number;
  tiles: number;
  troops: number;
  gold: number;
  goldWeight: number;
  upkeepPm: number;
  /** v4.3: 보유 테크 마스크 (uint32) */
  techMask: number;
  /** §23 (2026-10-18, 추가만): 값이 바뀐 델타에만 실린다 (없으면 그대로). PLAYER_DELTA_INTERVAL 주기 */
  allyBreaks?: number;
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
  /** v4.2 [A-61] (추가만): [flagId, returnBaseTileId|null] — 값이 바뀐 깃발만. 서버는 항상 싣는다(빈 배열 가능) */
  flagReturnBase?: [number, number | null][];
  /** v4.4 (§21, 추가만): [tileId, prodPm] — BASE_HP_DELTA_INTERVAL(5) 마다 바뀐 기지만. 서버는 항상 싣는다(빈 배열 가능) */
  baseProd?: [number, number][];
  /** v4.4 (§21, 추가만): PRODUCTION_DELTA_INTERVAL(5) 마다 내역이 바뀐 플레이어만 (전체 교체). 서버는 항상 싣는다(빈 배열 가능) */
  production?: PlayerProduction[];
  /**
   * v4.5 (§22, 추가만): [flagId, lossMilli] — 이번 tick 깃발 대 깃발 전투(4b)로 잃은 병력 (milli, > 0 인 깃발만, flagId ASC). 매 tick.
   * 노출 소모·AP 지출은 포함하지 않는다. 표시용 "−n/틱" = lossMilli / 1000. 서버는 항상 싣는다(빈 배열 가능)
   */
  combatLoss?: [number, number][];
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
  /** v4.3: 산 노드 (TECH_NODES id). 구 axis/tier 는 폐기 */
  nodeId: number;
  cost: number;
  newFlagCap: number;
  /** v4.3: 구매 후 보유 마스크 (uint32) */
  techMask: number;
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
  /** v4.4 (§21): 멸망시킨 플레이어 = 마지막 기지를 점령한 플레이어(합병 받는 쪽). 없으면 null (남은 땅은 중립) */
  byPlayerId: number | null;
  /** v4.4 (§21, 추가만): byPlayerId 에게 넘어간 칸 수 (중립으로 돌아갔으면 0). 칸 변경 자체는 같은 tick snapshot_delta.tileChanges. 서버는 항상 싣는다 */
  annexedTiles?: number;
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
  /** 프론트 QA m-4 (필드 추가): 교전 개시(MARCHING → ENGAGED/IDLE 판정) 추정 tick. 현재 owners 기준, ZOC·전투 무시 */
  engageEtaTick: number;
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
  /** 프론트 QA m-4 (필드 추가): 교전 개시 추정 tick (auto:true 면 tick) */
  engageEtaTick: number;
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
  /** v4.2 [A-62] (추가만): true = 귀환(RETURNING) 깃발이 전투에 붙잡혀 서버가 자동으로 개시. false = 재지정·회수 명령 */
  auto: boolean;
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
  /** v4.4 (§21, 추가만): 점령 직후 생산력 ‰ (= 직전 값 × 0.5). 서버는 항상 싣는다 */
  newProdPm?: number;
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
  | S2C_AllianceLockout
  // 플레이테스트 후속
  | S2C_RoomList;

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
