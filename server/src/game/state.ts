/**
 * 게임 상태 (GDD 2.5 / 2.7 / 3.x / 4.2).
 * 타일의 가변 상태는 owner 하나뿐. 진척도는 깃발에, 기지 체력은 bases[] 에 산다.
 */
import {
  BASE_HP_INIT_MILLI,
  POSTURE,
  START_GOLD,
  START_TROOPS,
  TECH_AXIS_COUNT,
  TERRAIN_GOLD_MILLI,
  type FlagState,
  type Posture,
  type Unit,
} from '@civwar/shared';
import type { GeneratedMap } from '../map/generate.js';
import type { MapGraph } from '../topology/topology.js';

export const NEUTRAL = 0;

export interface PlayerState {
  id: number; // 1..N
  isBot: boolean; // 처음부터 봇 슬롯
  botControlled: boolean; // 봇 슬롯 또는 DISCONNECT_GRACE 초과로 인계됨
  connected: boolean;
  disconnectedSinceTick: number | null;
  alive: boolean;
  eliminatedTick: number | null;
  lastLostTo: number | null; // 탈락 판정용: 마지막으로 내 타일을 가져간 플레이어
  homeTileId: number;

  // 파생 (O(1) 증분 — onTileOwnerChange 만 갱신)
  tiles: number;
  goldWeight: number;
  baseTiles: number[]; // 오름차순

  // 자원 (milli 고정소수점)
  troopsMilli: number;
  goldMilli: number;
  goldEarnedMilli: number;
  upkeepPm: number; // 직전 골드 정산의 주둔 유지비 permille (0..700)

  // 테크
  tech: number[]; // 축별 구매 단계 0..3, 길이 4
  techPurchased: number; // 누진비용용 총 구매 노드 수
}

/** GDD 4.2 깃발 상태 — 1차는 구조만. 이동·게이지·전투는 2차 */
export interface Flag {
  id: number;
  ownerId: number;
  slotIndex: number;
  unit: Unit;
  posture: Posture;
  troopsMilli: number;
  initialTroops: number;
  state: FlagState;
  stalled: boolean;
  stallSinceTick: number | null;
  posTileId: number;
  moveProgMilli: number; // 이동 진행도 0..999
  progressMilli: number; // 점령 진척도 0..999
  targetTileId: number | null;
  nextTileId: number;
  anchorTileId: number;
  targetOwnerId: number; // 0 = NEUTRAL, ANY_HOSTILE = 254
  lockUntilTick: number;
  idleSinceTick: number | null;
  originTileId: number;
  returnTileId: number | null;
  spendBudgetMilli: number;
  inCombat: boolean;
  combatSinceTick: number | null;
  routed: boolean;
  postureManual: boolean;
  postureCooldownUntilTick: number;
  disengageUntilTick: number | null;
  breakaway: boolean;
  blocked: boolean;
  calmTicks: number; // 주둔 유지비 무위협 누진 (4.4d)
}

export interface BaseState {
  tileId: number;
  hpMilli: number;
  lastDamageTick: number;
  lockUntilTick: number;
  damagedThisTick: boolean; // 7단계가 쓰고 8단계가 읽는 tick 로컬 플래그
}

export type AllianceState = 'ACTIVE' | 'BREAKING';
export interface Alliance {
  a: number; // a < b
  b: number;
  state: AllianceState;
  sinceTick: number;
  breakAtTick: number | null;
}

export interface GameResult {
  finalTick: number;
  winnerId: number | null;
  reason: 'last_standing' | 'threshold' | 'timeout';
}

/** tick 동안 쌓이는 송신 변경분 (브로드캐스트 단계가 소비) */
export interface TickChanges {
  tileChanges: [number, number][];
  flagsGone: number[];
}

export interface GameState {
  readonly map: GeneratedMap;
  readonly graph: MapGraph;
  tick: number;
  readonly owners: Uint8Array;
  /** index = playerId (0 은 비어 있음) */
  readonly players: PlayerState[];
  /** flagId 오름차순 유지 (id 단조증가 + append) */
  flags: Flag[];
  nextFlagId: number;
  /** tileId 오름차순 고정 */
  readonly bases: BaseState[];
  readonly baseIndexOf: Map<number, number>;
  alliances: Alliance[];
  endgameRushActive: boolean;
  result: GameResult | null;
  changes: TickChanges;
}

export function playerIdsAsc(state: Readonly<GameState>): number[] {
  const ids: number[] = [];
  for (let i = 1; i < state.players.length; i++) ids.push(i);
  return ids;
}

export interface PlayerSetup {
  playerId: number;
  isBot: boolean;
  connected: boolean;
}

export function createGameState(map: GeneratedMap, setup: readonly PlayerSetup[]): GameState {
  const N = map.playerCount;
  if (setup.length !== N) throw new Error(`setup ${setup.length} != map players ${N}`);
  const players: PlayerState[] = new Array(N + 1);
  for (const s of setup) {
    const spawn = map.spawns[s.playerId - 1];
    players[s.playerId] = {
      id: s.playerId,
      isBot: s.isBot,
      botControlled: s.isBot,
      connected: s.connected,
      disconnectedSinceTick: null,
      alive: true,
      eliminatedTick: null,
      lastLostTo: null,
      homeTileId: spawn.homeTileId,
      tiles: 0,
      goldWeight: 0,
      baseTiles: [],
      troopsMilli: START_TROOPS * 1000,
      goldMilli: START_GOLD * 1000,
      goldEarnedMilli: 0,
      upkeepPm: 0,
      tech: new Array(TECH_AXIS_COUNT).fill(0),
      techPurchased: 0,
    };
  }
  const bases: BaseState[] = map.baseTiles.map((tileId) => ({
    tileId,
    hpMilli: BASE_HP_INIT_MILLI,
    lastDamageTick: 0,
    lockUntilTick: 0,
    damagedThisTick: false,
  }));
  const baseIndexOf = new Map<number, number>();
  bases.forEach((b, i) => baseIndexOf.set(b.tileId, i));

  const state: GameState = {
    map,
    graph: map.graph,
    tick: 0,
    owners: new Uint8Array(map.topology.tileCount()),
    players,
    flags: [],
    nextFlagId: 1,
    bases,
    baseIndexOf,
    alliances: [],
    endgameRushActive: false,
    result: null,
    changes: { tileChanges: [], flagsGone: [] },
  };
  // 초기 소유 — onTileOwnerChange 경유로 파생 상태를 일관되게 만든다
  for (let t = 0; t < map.initialOwners.length; t++) {
    const o = map.initialOwners[t];
    if (o !== NEUTRAL) setTileOwner(state, t, o, false);
  }
  return state;
}

/**
 * 소유권 변경의 유일한 경로 (GDD 2.5 onTileOwnerChange).
 * 물 타일은 호출 금지 — 호출자가 isClaimable 을 보장한다.
 */
export function setTileOwner(state: GameState, tileId: number, to: number, record = true): void {
  const from = state.owners[tileId];
  if (from === to) return;
  const w = TERRAIN_GOLD_MILLI[state.map.terrain[tileId]];
  if (from !== NEUTRAL) {
    const p = state.players[from];
    p.tiles -= 1;
    p.goldWeight -= w;
    if (to !== NEUTRAL) p.lastLostTo = to;
  }
  if (to !== NEUTRAL) {
    const p = state.players[to];
    p.tiles += 1;
    p.goldWeight += w;
  }
  if (state.map.isBase[tileId]) {
    if (from !== NEUTRAL) {
      const arr = state.players[from].baseTiles;
      const i = arr.indexOf(tileId);
      if (i >= 0) arr.splice(i, 1);
    }
    if (to !== NEUTRAL) {
      const arr = state.players[to].baseTiles;
      let i = 0;
      while (i < arr.length && arr[i] < tileId) i++;
      arr.splice(i, 0, tileId);
    }
  }
  state.owners[tileId] = to;
  if (record) state.changes.tileChanges.push([tileId, to]);
}

/** 깃발 기본값 — 2차의 issueFlag 가 사용 */
export function makeFlag(partial: Pick<Flag, 'id' | 'ownerId' | 'slotIndex' | 'unit' | 'troopsMilli' | 'initialTroops' | 'posTileId' | 'anchorTileId' | 'originTileId'>): Flag {
  return {
    posture: POSTURE.ATTACK,
    state: 'MARCHING',
    stalled: false,
    stallSinceTick: null,
    moveProgMilli: 0,
    progressMilli: 0,
    targetTileId: null,
    nextTileId: partial.posTileId,
    targetOwnerId: NEUTRAL,
    lockUntilTick: 0,
    idleSinceTick: null,
    returnTileId: null,
    spendBudgetMilli: 0,
    inCombat: false,
    combatSinceTick: null,
    routed: false,
    postureManual: false,
    postureCooldownUntilTick: 0,
    disengageUntilTick: null,
    breakaway: false,
    blocked: false,
    calmTicks: 0,
    ...partial,
  };
}
