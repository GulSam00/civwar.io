/**
 * 게임 상태 (GDD 2.5 / 2.7 / 3.x / 4.2).
 * 타일의 가변 상태는 owner 하나뿐. 진척도는 깃발에, 기지 체력은 bases[] 에 산다.
 */
import {
  BASE_HP_MILLI,
  CAPITAL_HP_MILLI,
  COMBAT_MODEL,
  MORALE_MAX,
  BASE_PROD_MAX_PERMILLE,
  TICKS_PER_MIN,
  BOT_DIFFICULTY,
  BOT_DIFFICULTY_DEFAULT,
  type BotDifficultyName,
  type BotDifficultyParams,
  POSTURE,
  START_GOLD,
  START_TROOPS,
  tileGoldWeight,
  techStatValues,
  type FlagState,
  type Posture,
  type Unit,
} from '@civwar/shared';
import type { GeneratedMap } from '../map/generate.js';
import { assignPlaceNames } from '../map/placeNames.js';
import { relabelSpawns, shuffledSlots } from '../map/slots.js';
import type { MapGraph } from '../topology/topology.js';

export const NEUTRAL = 0;

export interface PlayerState {
  id: number; // 1..N
  isBot: boolean; // 처음부터 봇 슬롯
  botControlled: boolean; // 봇 슬롯 또는 DISCONNECT_GRACE 초과로 인계됨
  /** v4.1 [A-46]: 이 자리를 봇이 조종할 때 쓰는 난이도 (방 단위 하나 — 사람 자리도 인계 대비로 같은 값) */
  botDifficulty: BotDifficultyName;
  /** BOT_DIFFICULTY[botDifficulty] + aggressionPermille(봇 성향, 서버 전용) — 봇 인스턴스 레버 */
  bot: Readonly<BotDifficultyParams>;
  connected: boolean;
  disconnectedSinceTick: number | null;
  alive: boolean;
  eliminatedTick: number | null;
  lastLostTo: number | null; // 탈락 판정용: 마지막으로 내 타일을 가져간 플레이어
  /** v4.4 (§21): 마지막으로 내 기지를 가져간 플레이어 — 기지를 모두 잃으면 이 플레이어가 합병한다 */
  lastBaseLostTo: number | null;
  /** v4.4 (§21): 나를 멸망시켜 합병한 플레이어 (같은 tick 연쇄 멸망 시 합병 대상 추적용) */
  conqueredBy: number | null;
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
  /** v4.3: 보유 노드 비트마스크 (uint32, 비트 i = TECH_NODES[i]) */
  techMask: number;
  techPurchased: number; // 누진비용용 총 구매 노드 수 (= popcount(techMask))
  /** §23: 이 플레이어가 시작한 동맹 파기 수 (ally_break_started.byPlayerId = 이 플레이어) */
  allyBreaks: number;
  /** v4.3 [A-71]: 스탯 캐시 (인덱스 = TECH_STAT) = techStatValues(techMask). 구매 시에만 갱신 — 계산식은 이것만 읽는다 */
  statPm: number[];
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
  /** v4.2 (4.4a, A-54): MARCHING·ATTACK 깃발의 행군 중 정지 점령. 4단계가 매 tick 다시 쓴다 (4b 가 inCombat 이면 false) */
  halted: boolean;
  /** v4.2 [A-61]: cmd_flag_recall{baseTileId} 로 지정한 귀환 기지. null = 기존 recallTarget 순서 */
  returnBaseTileId: number | null;
  /**
   * v4.6 (§27) [A]: 전투 중 태세 전환(또는 태세가 바뀌는 재지정)이 연 이탈 대기. true 인 동안 상대 태세와 무관하게 전투 간선을 유지해
   * 방어↔방어로 바뀌어도 이탈 비용(3초 ×0.5) 없이 끊기지 않게 한다. 직렬화하지 않는다 (disengageUntilTick 이 null 이 되면 함께 false)
   */
  disengageHold: boolean;
  /** §33 (전투 모델 2): 사기 ‰ 0..1000 (시작 1000). 모델 1 에서는 1000 고정이고 아무도 읽지 않는다 */
  morale: number;
}

export interface BaseState {
  tileId: number;
  hpMilli: number;
  /** 패치 5차: 기지별 최대 체력 — 처음 수도였던 칸은 CAPITAL_HP_MILLI, 나머지 BASE_HP_MILLI (점령당해도 불변) */
  readonly maxHpMilli: number;
  lastDamageTick: number;
  lockUntilTick: number;
  damagedThisTick: boolean; // 7단계가 쓰고 8단계가 읽는 tick 로컬 플래그
  /** v4.4 (§21): 생산력 × TICKS_PER_MIN (정수 선형 회복용). 표시·계산 ‰ = floor(prodScaled / TICKS_PER_MIN) — baseProdPm() */
  prodScaled: number;
}

/** v4.4 (§21): 기지 생산력 ‰ (0..1000) */
export function baseProdPm(b: Readonly<BaseState>): number {
  return Math.floor(b.prodScaled / TICKS_PER_MIN);
}

/** v4.5 (§22): 2단계가 실제로 적용한 생산 내역 한 행 (milli / tick). 스냅숏 production 의 원천 */
export interface ProductionYield {
  kind: 'base' | 'territory';
  baseTileId: number; // 영토 행 = -1
  /** 기지 행 = 환산 칸 수(60/100), 영토 행 = 실제 칸 수 */
  tiles: number;
  prodPm: number;
  troopsMilli: number;
  goldGrossMilli: number;
  goldNetMilli: number;
}

export type AllianceState = 'ACTIVE' | 'BREAKING';
export interface Alliance {
  a: number; // a < b
  b: number;
  state: AllianceState;
  sinceTick: number;
  breakAtTick: number | null;
}

export interface AllyProposal {
  id: number;
  from: number;
  to: number;
  expireTick: number;
}

/**
 * 병력 회계 장부 (GDD 4.8). 단위 milli.
 * 불변식: Σ풀 + Σ깃발 + Σ소멸 == 시작 총량 + regen
 */
export interface TroopLedger {
  initial: number;
  regen: number;
  capClamp: number; // 3.2 min(troops+regen, cap) 로 잘린 양 (환급·영토 상실로 cap 초과 시)
  conversion: number; // 발령 시 풀 비용 − 깃발 병력 (기동 테크로 음수 가능)
  spentAP: number; // ① 게이지·기지 지출 (v4.1: DEFEND 지출 삭제)
  exposure: number; // ②
  combat: number; // ③
  exhausted: number; // ④ 소진 destroy 잔여
  recallLoss: number; // ⑤ 회수 15%
  eliminated: number; // 탈락 시 풀 + 깃발
}

/** 4a/4b 가 이어 붙이는 전투 표시 기록 (규칙에는 미사용 — 이벤트 송신용) */
export interface CombatRecord {
  key: number; // 마지막으로 송신한 groupKey
  flagIds: Set<number>;
  routed: number[];
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
  /** v4.5 (§22): 이번 tick 4b 전투 손실 [flagId, lossMilli] (> 0 만, flagId ASC) */
  combatLoss: [number, number][];
}

export interface GameState {
  /** §33: 전투 모델 (1 = 현행, 2 = 채널 비교 + 사기). 환경변수 COMBAT_MODEL 또는 createGameState 인자 */
  readonly combatModel: 1 | 2;
  readonly map: GeneratedMap;
  /** v4.4 (§21): 기지 지명 — map.baseTiles 와 같은 순서 */
  readonly baseNames: readonly string[];
  /** v4.5 (§22): 시작 수도 칸 (기지 생산 100칸분 판정 — 소유자 무관) */
  readonly capitalTiles: ReadonlySet<number>;
  /** index = playerId — 직전 2단계 정산 내역 (기지 행 + 영토 행) */
  yields: ProductionYield[][];
  /** v4.1: 방 봇 난이도 (match_config.botDifficulty) */
  readonly botDifficulty: BotDifficultyName;
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
  /** (MAX_PLAYERS+1)² — 0 없음, 1 ACTIVE, 2 BREAKING. alliances 변경 시 rebuildAllyMatrix */
  allyMat: Uint8Array;
  proposals: AllyProposal[];
  nextProposalId: number;
  allianceFreezeUntilTick: number | null;
  lockoutDissolveTick: number | null;
  /** 거리장 캐시: key = 목적지 tileId (v4.5 — 물 경로 키 폐지. 매 tick 끝 미사용 키 정리) */
  fields: Map<number, Int32Array>;
  /** v4.5 (§22.12): 소유권·동맹이 바뀔 때마다 +1 — 방어 태세 경로(적 땅 회피) 거리장 캐시의 유효성 키 */
  pathVersion: number;
  /** v4.5 (§22.12): 방어 태세 거리장 캐시 key = `${dest}:${ownerId}` → pathVersion 이 같을 때만 유효 */
  defFields: Map<string, { ver: number; field: Int32Array }>;
  /** 4단계가 쓰고 4b 끝이 읽는 tick 로컬: 대치 깃발 → 차단 깃발들 */
  zocBlocked: Map<number, number[]>;
  combats: CombatRecord[];
  ledger: TroopLedger;
  endgameRushActive: boolean;
  result: GameResult | null;
  changes: TickChanges;
  /**
   * §33 (모델 2, 표시 전용): 마지막으로 델타(moraleChanged)로 보낸 깃발별 사기. DeltaTracker 가 갱신하고,
   * 전체 스냅숏(중간 입장·재접속)도 이 값을 싣는다 — 정확한 현재값을 싣으면 델타 사이에 흔들렸다 돌아온 사기가 입장자에게 어긋난 채 남는다.
   * 규칙에 쓰이지 않는다. 없는 깃발은 MORALE_MAX 로 본다.
   */
  moraleShown: Map<number, number>;
}

export const ALLY_STRIDE = 16; // > MAX_PLAYERS

export function rebuildAllyMatrix(state: GameState): void {
  state.pathVersion++; // v4.5: 적대 관계가 바뀌면 방어 경로도 바뀐다
  state.allyMat.fill(0);
  for (const a of state.alliances) {
    const v = a.state === 'ACTIVE' ? 1 : 2;
    state.allyMat[a.a * ALLY_STRIDE + a.b] = v;
    state.allyMat[a.b * ALLY_STRIDE + a.a] = v;
  }
}

/** ACTIVE 또는 BREAKING — 둘 다 "서로 공격 불가"(6.2 백스탭 쿨다운) → 적대 아님 */
export function isAlly(state: Readonly<GameState>, a: number, b: number): boolean {
  if (a === 0 || b === 0 || a === b) return false;
  return state.allyMat[a * ALLY_STRIDE + b] !== 0;
}

/** 회계 총량 검산값: (풀 + 깃발 + 소멸) − (시작 + regen). 항상 0 이어야 한다 */
export function ledgerImbalance(state: Readonly<GameState>): number {
  let held = 0;
  for (const p of state.players) if (p) held += p.troopsMilli;
  for (const f of state.flags) held += f.troopsMilli;
  const L = state.ledger;
  const sinks = L.capClamp + L.conversion + L.spentAP + L.exposure + L.combat + L.exhausted + L.recallLoss + L.eliminated;
  return held + sinks - (L.initial + L.regen);
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
  /** 생략 시 BOT_DIFFICULTY_DEFAULT (NORMAL) */
  botDifficulty?: BotDifficultyName;
  /** 봇 성향 강제 (테스트·진단용). 생략 시 botAggressionPermille(aggressionSeed, playerId) */
  aggressionPermille?: number;
  /** §32: 이 플레이어가 받을 맵 스폰 슬롯(map.spawns 인덱스, 0 기반). 생략 시 playerId-1. 전원이 0..N-1 의 순열을 이뤄야 한다 */
  spawnSlot?: number;
  /** §32: 봇 테크 우선순위 목록 번호 0..3 강제 (진단용). 생략 시 시드 기반 균형 배정 */
  techStyle?: number;
}

/**
 * 봇 성향 배정 (사용자 결정 2026-10-09): (룸 시드, playerId) 정수 해시 → 0..1000. Math.random 없음, 플랫폼 무관(Math.imul).
 */
export function botAggressionPermille(seed: number, playerId: number): number {
  let h = (seed ^ Math.imul(playerId + 0x632be5ab, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % 1001;
}

/** botDifficulty = 방 봇 난이도 (2.8 g — 방 단위 하나, bot_takeover 도 따른다). PlayerSetup.botDifficulty 가 있으면 그 자리만 덮어쓴다 */
/** aggressionSeed = 룸 시드 (생략 시 map.seed — 프리셋 맵은 룸이 따로 넘긴다) */
/** §33: 기본 전투 모델 — 환경변수 COMBAT_MODEL(1|2) 이 있으면 그 값, 없으면 shared COMBAT_MODEL (1) */
export function defaultCombatModel(): 1 | 2 {
  const e = typeof process !== 'undefined' ? process.env?.COMBAT_MODEL : undefined;
  if (e === '2') return 2;
  if (e === '1') return 1;
  return COMBAT_MODEL === 2 ? 2 : 1;
}

export function createGameState(
  map: GeneratedMap,
  setup: readonly PlayerSetup[],
  botDifficulty: BotDifficultyName = BOT_DIFFICULTY_DEFAULT,
  aggressionSeed: number = map.seed,
  combatModel: 1 | 2 = defaultCombatModel(),
): GameState {
  const N = map.playerCount;
  if (setup.length !== N) throw new Error(`setup ${setup.length} != map players ${N}`);
  // §32: 플레이어 ↔ 스폰 슬롯 배정 (spawnSlot 이 있으면 map 을 다시 라벨링 — spawns[p-1].playerId === p 유지)
  if (setup.some((s) => s.spawnSlot !== undefined)) {
    const slotOf: number[] = new Array(N);
    for (const s of setup) slotOf[s.playerId - 1] = s.spawnSlot ?? s.playerId - 1;
    map = relabelSpawns(map, slotOf);
  }
  // §32: 봇 테크 우선순위 목록은 playerId 가 아니라 시드 기반 균형 배정 (목록 0..3 이 N 명에 고르게, 누가 받을지는 시드가 정한다)
  const styleRank = shuffledSlots(aggressionSeed ^ 0x7ec4, N);
  const players: PlayerState[] = new Array(N + 1);
  for (const s of setup) {
    const spawn = map.spawns[s.playerId - 1];
    players[s.playerId] = {
      id: s.playerId,
      isBot: s.isBot,
      botControlled: s.isBot,
      botDifficulty: s.botDifficulty ?? botDifficulty,
      bot: { ...BOT_DIFFICULTY[s.botDifficulty ?? botDifficulty], aggressionPermille: s.aggressionPermille ?? botAggressionPermille(aggressionSeed, s.playerId), techStyle: s.techStyle ?? styleRank[s.playerId - 1] % 4 },
      connected: s.connected,
      disconnectedSinceTick: null,
      alive: true,
      eliminatedTick: null,
      lastLostTo: null,
      lastBaseLostTo: null,
      conqueredBy: null,
      homeTileId: spawn.homeTileId,
      tiles: 0,
      goldWeight: 0,
      baseTiles: [],
      troopsMilli: START_TROOPS * 1000,
      goldMilli: START_GOLD * 1000,
      goldEarnedMilli: 0,
      upkeepPm: 0,
      techMask: 0,
      techPurchased: 0,
      allyBreaks: 0,
      statPm: techStatValues(0),
    };
  }
  const capitalSet = new Set(map.spawns.map((sp) => sp.homeTileId));
  const bases: BaseState[] = map.baseTiles.map((tileId) => ({
    tileId,
    hpMilli: capitalSet.has(tileId) ? CAPITAL_HP_MILLI : BASE_HP_MILLI,
    maxHpMilli: capitalSet.has(tileId) ? CAPITAL_HP_MILLI : BASE_HP_MILLI,
    lastDamageTick: 0,
    lockUntilTick: 0,
    damagedThisTick: false,
    prodScaled: BASE_PROD_MAX_PERMILLE * TICKS_PER_MIN,
  }));
  const baseIndexOf = new Map<number, number>();
  bases.forEach((b, i) => baseIndexOf.set(b.tileId, i));

  const state: GameState = {
    combatModel,
    map,
    baseNames: assignPlaceNames(aggressionSeed, map.baseTiles.length),
    capitalTiles: new Set(map.spawns.map((sp) => sp.homeTileId)),
    yields: [],
    botDifficulty,
    graph: map.graph,
    tick: 0,
    owners: new Uint8Array(map.topology.tileCount()),
    players,
    flags: [],
    nextFlagId: 1,
    bases,
    baseIndexOf,
    alliances: [],
    allyMat: new Uint8Array(ALLY_STRIDE * ALLY_STRIDE),
    proposals: [],
    nextProposalId: 1,
    allianceFreezeUntilTick: null,
    lockoutDissolveTick: null,
    fields: new Map(),
    pathVersion: 0,
    defFields: new Map(),
    zocBlocked: new Map(),
    combats: [],
    ledger: {
      initial: N * START_TROOPS * 1000,
      regen: 0,
      capClamp: 0,
      conversion: 0,
      spentAP: 0,
      exposure: 0,
      combat: 0,
      exhausted: 0,
      recallLoss: 0,
      eliminated: 0,
    },
    endgameRushActive: false,
    result: null,
    changes: { tileChanges: [], flagsGone: [], combatLoss: [] },
    moraleShown: new Map(),
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
/** 2026-10-24: 소유 칸 전체의 골드 가중치를 현재 스탯으로 다시 합산한다 (테크 구매 직후) */
export function recomputeGoldWeight(state: GameState, p: PlayerState): void {
  let sum = 0;
  for (let t = 0; t < state.owners.length; t++) if (state.owners[t] === p.id) sum += tileGoldWeight(state.map.terrain[t], p.statPm);
  p.goldWeight = sum;
}

export function setTileOwner(state: GameState, tileId: number, to: number, record = true): void {
  const from = state.owners[tileId];
  if (from === to) return;
  const terrain = state.map.terrain[tileId];
  state.pathVersion++; // v4.5 (§22.12): 방어 경로 캐시 무효화
  if (from !== NEUTRAL) {
    const p = state.players[from];
    p.tiles -= 1;
    p.goldWeight -= tileGoldWeight(terrain, p.statPm);
    if (to !== NEUTRAL) p.lastLostTo = to;
  }
  if (to !== NEUTRAL) {
    const p = state.players[to];
    p.tiles += 1;
    p.goldWeight += tileGoldWeight(terrain, p.statPm);
  }
  if (state.map.isBase[tileId]) {
    if (from !== NEUTRAL) {
      const arr = state.players[from].baseTiles;
      const i = arr.indexOf(tileId);
      if (i >= 0) arr.splice(i, 1);
      if (to !== NEUTRAL) state.players[from].lastBaseLostTo = to;
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
    halted: false,
    returnBaseTileId: null,
    disengageHold: false,
    morale: MORALE_MAX,
    ...partial,
  };
}
