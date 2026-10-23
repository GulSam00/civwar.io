/**
 * 봇 AI (GDD 8장 v3.0 + 8.6 / 8.6.0 v4.0 + v4.1 [A-43] 요격 전용 방어, 2.8 g 난이도 레버, v4.2 8.7 깊은 앵커 [A-65]).
 *
 * - 11단계에서 decide() 가 일반 C2S_GameCommand 만 돌려준다(다음 tick 1단계, 사람과 같은 검증·거절 경로).
 *   게임 상태는 읽기만 한다. 거리장(getField/stepToward/etaTicks)은 쓰지 않는다(캐시 오염·비용 회피).
 * - 결정론: Math.random·부동소수 누적 없음. 모든 순회는 tileId/flagId/playerId ASC, 동률은 작은 id.
 * - 무상태: 봇 메모리를 두지 않는다(같은 state → 같은 명령). clientSeq 도 (tick, 순번)에서 파생.
 *
 * 난이도(params): decisionInterval(11단계 필터) · reserveRatioPermille · minDefenseRatioPermille · fixedUnit(공격 병종 고정).
 * GDD 에 없어 정한 것은 프로토콜 문서 §10 "3차-2" 항목에 기록.
 */
import {
  ALLIANCE_MIN_DURATION,
  BASE_HP_MAX_MILLI,
  ANY_HOSTILE,
  BOT_AGGRESSION_NEUTRAL_PERMILLE,
  BOT_AGGRESSION_SPAN,
  BOT_AVOID_RATIO_PERMILLE,
  BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE,
  BOT_MAX_DEFENSE_RATIO_PERMILLE,
  BOT_BASE_ATTACK_RANGE,
  BOT_BASE_ATTACK_WEIGHT_PERMILLE,
  BOT_BASE_CAPITAL_PERMILLE,
  BOT_BASE_THREAT_W,
  BOT_BASE_UNGUARDED_PERMILLE,
  BOT_COMMIT_BASE_PERMILLE,
  BOT_BLOCK_ATTACK_RATIO_PERMILLE,
  BOT_COMMIT_ENEMY_PERMILLE,
  BOT_COMMIT_NEUTRAL_PERMILLE,
  BOT_COUNTER_MARGIN_PERMILLE,
  BOT_DEFEND_COMMIT_PERMILLE,
  BOT_GARRISON_PATIENCE,
  BOT_GUARD_PENALTY,
  BOT_INTERCEPT_RATIO_PERMILLE,
  BOT_NEUTRAL_BIAS_TICK,
  BOT_PREEMPT_FACTOR_PERMILLE,
  BOT_MIN_ENGAGE_TICKS,
  BOT_ENGAGE_BREAK_RATIO_PERMILLE,
  BOT_RETREAT_RATIO_PERMILLE,
  BOT_STALL_SWITCH_PERMILLE,
  BOT_THREAT_LOOKAHEAD,
  BOT_THREAT_TRIGGER,
  COMBAT_LOSS_BP,
  DISENGAGE_VALUE_PERMILLE,
  FLAG_MIN_TROOPS,
  FLAG_RECALL_REFUND_PERMILLE,
  FLAG_SPEND_RATE_PERMILLE,
  FRONT_RADIUS,
  MAX_ALLIES_PER_PLAYER,
  MORALE_MAX,
  POSTURE,
  TECH_NODES,
  TERRAIN,
  UNIT,
  isClaimable,
  techConvertPm,
  techDisengageTicks,
  techOwned,
  techPrereqMet,
  type BotDifficultyParams,
  type C2S_GameCommand,
  type Posture,
  type Unit,
} from '@civwar/shared';
import { tileTieHash } from '../map/rng.js';
import { ANNEX } from './annex.js';
import { engageLossPerTick, flagValue } from './combat.js';
import { flagCap, techCost, troopCap } from './economy.js';
import { guardContains, marchFrontCountAt, marchMatch, maxProgress, pushing, threatened, tileCost } from './rules.js';
import { NEUTRAL, isAlly, type Flag, type GameState, type PlayerState } from './state.js';
import type { BotBrain } from './tick.js';

/** 봇 파기 판단 시각 (8.5 외교 "t > 7500 tick") — GDD 본문 값, 부록 A 에 상수명 없음 */
export const BOT_BREAK_AFTER_TICK = 7500;
/** 8.5 외교 수락 "제안자 타일 ≥ 내 타일 × 1.2" / 파기 "내 타일 ≥ 동맹 타일 × 2.0" */
export const BOT_ALLY_ACCEPT_PERMILLE = 1200;
export const BOT_ALLY_BREAK_PERMILLE = 2000;
/** 8.4 "먼 전선" 기준 거리 */
export const BOT_FAR_FRONT_DIST = 12;
/**
 * v4.5 [A-109] (에이전트 선택): 중립 기지 공격 후보 점수 배율. 기지가 영토 60칸분(수도 100칸분)을 생산하게 되어
 * 중립 기지도 별도 후보로 본다(내 땅에서 BOT_BASE_ATTACK_RANGE 안). 적 기지(×2.5, 사용자 확정)보다 낮게 — 지키는 깃발이 없다.
 */
export const BOT_NEUTRAL_BASE_WEIGHT_PERMILLE = 2000;
/** 8.6.0 1. 태세 — 제자리 반격 / 굳히기 임계 */
export const BOT_COUNTERATTACK_TROOPS_PERMILLE = 700;
export const BOT_CONSOLIDATE_TROOPS_PERMILLE = 400;
/**
 * GDD 에 없어 정함 (§10): 공격 깃발 최소 병력. 40 근처 깃발은 몇 AP 쓰고 소진(잔여 전액 소멸)되어 순손실만 낸다.
 * 3 × FLAG_MIN_TROOPS (8.6.0 후퇴의 "잔여 ≥ FLAG_MIN_TROOPS × 3" 과 같은 눈금). cap−reserve 가 작은 소국은 2 × 까지 낮춘다.
 */
export const BOT_MIN_ATTACK_MULT = 3;
/** v4.2 8.7 3b [A-65]: IDLE 공격 깃발 — 남은 병력이 이 이상이면 깊은 앵커로 재지정, 아니면 가까운 기지 지정 회수 */
export const BOT_IDLE_REDEPLOY_MIN_TROOPS = 200;
/** v4.2 8.3 [A-65]: 깊은 앵커 노선 깊이 clamp(병력 / (3 × cost), MIN, MAX). §25 B2 (사용자 2026-10-18): MAX 20 → 6 — 긴 노선이 띠 모양 영토를 만든다 */
export const BOT_DEEP_MIN = 4;
export const BOT_DEEP_MAX = 6;
/** GDD 에 없어 정함 (§10 v4.2): 새 공격 앵커 후보(국경 칸)가 내 공격 깃발 현재 위치에서 이 거리 이내면 건너뛴다 (같은 회랑 중복 방지) */
export const BOT_PLOW_SPACING = 2;
/**
 * v4.4 기지 방어 (사용자 2026-10-14, §10-104·105 에이전트 선택): 적대 공격 깃발이 내 기지에서 이 거리 안이면 그 기지에 방어 깃발을 세운다.
 * 마지막 기지(멸망·합병 직결)는 더 넓게 본다.
 */
export const BOT_BASE_GUARD_RADIUS = 4;
export const BOT_LAST_BASE_GUARD_RADIUS = 8;
/** v4.4: 마지막 기지가 아닌 기지는 최근 이 tick 안에 체력 피해를 받았을 때만 수비대를 세운다 (8.1 기지 위협의 25 tick 과 같은 눈금) */
export const BOT_BASE_GUARD_DAMAGE_WINDOW = 25;
/** GDD 에 없어 정함 (§10): 소진 직전 회수 여유 tick (경계 = 40 + 쌓인 예산 + 누적률 × 이 값). 결정 주기 전체를 여유로 잡으면 큰 깃발을 너무 일찍 물려 손해(자가대전 측정) */
export const BOT_EXHAUST_MARGIN_TICKS = 2;

/** 노드 코드 → id (TECH_NODES) */
function nodeIdOf(code: string): number {
  const n = TECH_NODES.find((x) => x.code === code);
  if (!n) throw new Error(`TECH_PRIORITY: 없는 노드 ${code}`);
  return n.id;
}
/**
 * v4.3 8.5 테크 우선순위 [botIndex % 4] (01b 6.2, A-82) — 노드 코드 16개. 부모가 항상 자식보다 앞 (로드 시 검사).
 * 규칙(6.1): 결정마다 목록에서 아직 안 산 첫 노드를 살 수 있으면 산다, 못 사면 기다린다(건너뛰지 않음).
 */
export const TECH_PRIORITY_CODES: readonly (readonly string[])[] = [
  // 0 확장형
  ['TER-1', 'CAV-1', 'MOB-1', 'TER-2A', 'ECO-1', 'TER-2B', 'MOB-2A', 'CAV-2A', 'ECO-2B', 'TER-3B', 'CAV-3', 'MIL-1', 'ECO-2A', 'MOB-3A', 'TER-3A', 'MIL-2A'],
  // 1 경제형
  ['ECO-1', 'TER-1', 'ECO-2A', 'ECO-2B', 'CAV-1', 'ECO-3A', 'MOB-1', 'CAV-2A', 'ECO-3B', 'SPE-1', 'MIL-1', 'MOB-2A', 'CAV-3', 'TER-2B', 'SPE-2A', 'MOB-3A'],
  // 2 수비형
  // v4.5 (01c A-96 ①): MOB-1 바로 뒤에 MOB-2B 철수 훈련, 맨 끝 TER-3B 제거
  ['SPE-1', 'MIL-1', 'ECO-1', 'SPE-2A', 'MIL-2B', 'CAV-1', 'ECO-2B', 'SPE-3', 'MIL-3B', 'MOB-1', 'MOB-2B', 'TER-1', 'TER-2B', 'MOB-2A', 'MOB-3A', 'SPE-2B'],
  // 3 기동형 — v4.5 (01c A-96 ①, MOB-3B 는 ② 급속 귀환 채택에 맞춰 조정): MOB-2B 10 → 8번째.
  //   MOB-3B 는 제안(11번째, ① 질서 있는 회수 기준)보다 뒤 13번째 — ② 귀환 속도는 골드당 효과가 약하다(01c 1.2: 슬롯 ≈ 60초)
  ['MOB-1', 'CAV-1', 'MOB-2A', 'CAV-2B', 'ECO-1', 'CAV-2A', 'MOB-3A', 'MOB-2B', 'MIL-1', 'MIL-2A', 'CAV-3', 'MIL-3A', 'MOB-3B', 'ECO-2B', 'TER-1', 'SWO-1'],
];
/** 6.1 병종 치환 — 검병 고정 봇(EASY, fixedUnit = SWORD): 기병 노드를 부모 관계가 같은 자리의 검병 노드로 */
export const TECH_SWORD_SWAP: Readonly<Record<string, string>> = { 'CAV-1': 'SWO-1', 'CAV-2A': 'SWO-2B', 'CAV-2B': 'SWO-2A', 'CAV-3': 'SWO-3' };
export const TECH_PRIORITY: readonly (readonly number[])[] = TECH_PRIORITY_CODES.map((l) => l.map(nodeIdOf));
export const TECH_PRIORITY_SWORD: readonly (readonly number[])[] = TECH_PRIORITY_CODES.map((l) => l.map((c) => nodeIdOf(TECH_SWORD_SWAP[c] ?? c)));
/** 6.1 "부모가 항상 자식보다 앞" — 서버 시작 시 assert */
for (const list of [...TECH_PRIORITY, ...TECH_PRIORITY_SWORD]) {
  let mask = 0;
  for (const id of list) {
    if (!techPrereqMet(mask, id)) throw new Error(`TECH_PRIORITY: ${TECH_NODES[id].code} 의 부모가 앞에 없음`);
    mask = (mask | (1 << id)) >>> 0;
  }
}

/** §32: 앵커 후보 동률 해시 소금 (전 봇 공통 — playerId 에 의존하지 않는다) */
const BOT_TIE_SALT = 0x2f6b9a1d;
/** 진단 전용(slot-bias.ts LEGACY_TIE=1): true 면 §32 이전처럼 동률을 tileId 최소로 푼다. 게임 로직에서는 건드리지 않는다 */
export const botDiag = { legacyTie: false };
const tieLess = (a: number, b: number): boolean => (botDiag.legacyTie ? a < b : tileTieHash(BOT_TIE_SALT, a) < tileTieHash(BOT_TIE_SALT, b));

interface Anchor {
  /** 발령 앵커 = 깊은 앵커 (v4.2 [A-65]) */
  tileId: number;
  /** 점수를 매긴 국경 칸 */
  border: number;
  /** 점수·깊이에 쓴 병력 */
  troops: number;
  /** 깊은 앵커 칸의 소유자 */
  owner: number;
  /** v4.2 기지 공격 후보 (앵커 = 적 기지 칸 자체, 깊은 앵커 없음) */
  base: boolean;
  kind: 0 | 1; // 0 NEUTRAL, 1 ENEMY
  score: number;
}

/** 봇 한 번의 결정에 쓰는 지역 상태 (decide 호출마다 새로 만든다) */
/**
 * 봇 성향(aggression) 보간 결과 — 난이도 기준값 + (a − 500) × SPAN / 500 (shared BOT_AGGRESSION_SPAN).
 * 알고리즘은 같고 값만 다르다 (사용자 결정 2026-10-09).
 */
export interface BotKnobs {
  aggressionPermille: number;
  reserveRatioPermille: number;
  minDefenseRatioPermille: number;
  maxDefenseRatioPermille: number;
  counterMarginPermille: number;
  retreatRatioPermille: number;
  blockAttackRatioPermille: number;
  enemyAnchorWeightPermille: number;
}

export function botKnobs(params: Readonly<BotDifficultyParams>): BotKnobs {
  const a = Math.min(1000, Math.max(0, params.aggressionPermille ?? BOT_AGGRESSION_NEUTRAL_PERMILLE));
  const d = a - BOT_AGGRESSION_NEUTRAL_PERMILLE; // −500..500
  const lerp = (base: number, span: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, base + Math.trunc((d * span) / BOT_AGGRESSION_NEUTRAL_PERMILLE)));
  const S = BOT_AGGRESSION_SPAN;
  const minDef = lerp(params.minDefenseRatioPermille, S.minDefenseRatioPermille, 0, 1000);
  return {
    aggressionPermille: a,
    reserveRatioPermille: lerp(params.reserveRatioPermille, S.reserveRatioPermille, 0, 900),
    minDefenseRatioPermille: minDef,
    maxDefenseRatioPermille: lerp(BOT_MAX_DEFENSE_RATIO_PERMILLE, S.maxDefenseRatioPermille, minDef, 1000),
    counterMarginPermille: lerp(BOT_COUNTER_MARGIN_PERMILLE, S.counterMarginPermille, 500, 3000),
    retreatRatioPermille: lerp(BOT_RETREAT_RATIO_PERMILLE, S.retreatRatioPermille, 0, 2000),
    blockAttackRatioPermille: lerp(BOT_BLOCK_ATTACK_RATIO_PERMILLE, S.blockAttackRatioPermille, 0, 2000),
    enemyAnchorWeightPermille: lerp(BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE, S.enemyAnchorWeightPermille, 100, 5000),
  };
}

interface Ctx {
  readonly state: Readonly<GameState>;
  readonly me: number;
  readonly p: Readonly<PlayerState>;
  readonly t: number;
  readonly params: Readonly<BotDifficultyParams>;
  readonly k: BotKnobs;
  readonly cmds: C2S_GameCommand[];
  readonly touched: Set<number>;
  /** 남은 풀 병력 (정수, 이번 결정에서 낸 발령 비용 차감) */
  pool: number;
  /** 사용 중 슬롯 (RETURNING 포함 — issueFlag 의 NO_SLOT 판정과 같다) */
  slots: number;
  readonly cap: number;
  /** 내 살아 있는 깃발 (id ASC, RETURNING 포함) */
  readonly mine: Flag[];
  /** 이번 결정에서 정한 공격 앵커 (중복 front 방지) — [owner, tile] */
  readonly plannedAttack: [number, number][];
  /** 이번 결정에서 정한 방어 앵커 */
  readonly plannedDefend: number[];
  /** 소유자별 국경 칸 (그 소유자 땅 중 내 땅과 이동 그래프로 인접, tileId ASC) */
  border: Map<number, number[]> | null;
  hostileBorder: boolean;
  /** v4.2 깊은 앵커용: 내 땅까지 격자 거리 (minDistFromTerritory 의 다중 출발 BFS 판, 결정당 1회 lazy) */
  terrDist: Int32Array | null;
  /** 재지정 앵커를 고르는 중인 깃발 (자기 위치는 회랑 중복 검사에서 뺀다) */
  selfFlagId: number;
}

function withSelf<T>(ctx: Ctx, f: Readonly<Flag>, fn: () => T): T {
  const prev = ctx.selfFlagId;
  ctx.selfFlagId = f.id;
  try {
    return fn();
  } finally {
    ctx.selfFlagId = prev;
  }
}

// ───────────────────────── 공용 헬퍼 ─────────────────────────

/** §33 [A-163]: 모델 2 에서 사기가 이 값(‰) 미만이고 교전에서 지고 있으면 봇이 교대(회수)한다 */
const BOT_MORALE_SHAKEN = 400;

const isLive = (f: Readonly<Flag>): boolean => !f.routed && f.state !== 'RETURNING' && f.troopsMilli > 0;

function hostilePlayer(state: Readonly<GameState>, me: number, o: number): boolean {
  return o !== NEUTRAL && o !== me && !isAlly(state, me, o);
}

/** 가상 깃발의 실효 전투값 (4.15 d·e) — flagValue 를 그대로 쓴다 */
function valueAs(state: Readonly<GameState>, ownerId: number, unit: Unit, posture: Posture, tile: number): number {
  const fake = { ownerId, unit, posture, posTileId: tile, disengageUntilTick: null, morale: MORALE_MAX } as unknown as Flag; // morale: §33 모델 2 가상 깃발은 사기 만땅 가정
  return flagValue(state, fake, []);
}

/** 실효 전투력 = 병력 × v (4.15 d: 편 손실은 1/v 비례 → 버티는 시간 ∝ 병력 × v) */
function effOf(state: Readonly<GameState>, f: Readonly<Flag>): number {
  return Math.floor(f.troopsMilli / 1000) * flagValue(state, f, [f]);
}

/** 발령 가능 최대 병력 (v4.3 풀 비용 = ceil(q × 편성비 CONVERT_<unit> / 1000) — flagops.issueFlag 와 같은 식) */
function maxIssuable(p: Readonly<PlayerState>, pool: number, unit: Unit): number {
  const cv = techConvertPm(p.statPm, unit);
  let q = Math.floor((pool * 1000) / cv);
  while (q > 0 && Math.ceil((q * cv) / 1000) > pool) q--;
  return q;
}

function poolCostOf(p: Readonly<PlayerState>, q: number, unit: Unit): number {
  return Math.ceil((q * techConvertPm(p.statPm, unit)) / 1000);
}

/** issueFlag 기본 출발지 — 앵커에 가장 가까운 내 기지(없으면 수도) */
function originFor(state: Readonly<GameState>, p: Readonly<PlayerState>, anchor: number): number {
  let best = p.homeTileId;
  let bd = Infinity;
  for (const b of p.baseTiles) {
    const d = state.graph.distance(b, anchor);
    if (d < bd || (d === bd && b < best)) {
      best = b;
      bd = d;
    }
  }
  return best;
}

function pseudoAttack(me: number, unit: Unit, anchor: number, targetOwnerId: number): Flag {
  return { ownerId: me, unit, posture: POSTURE.ATTACK, anchorTileId: anchor, posTileId: anchor, targetOwnerId } as unknown as Flag;
}

/** v4.2: 공격 깃발이 지금 밀 수 있는 옆 칸 수 = |marchFront(f)| */
function frontSize(state: Readonly<GameState>, f: Readonly<Flag>): number {
  return marchFrontCountAt(state, f.ownerId, f.posTileId);
}

/** 내 기지 중 pos 에 가장 가까운 것 (거리, tileId) — 없으면 null (v4.2 [A-61] 지정 회수) */
function nearestBase(ctx: Ctx, pos: number): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (const b of ctx.p.baseTiles) {
    const d = ctx.state.graph.distance(b, pos);
    if (d < bd) {
      best = b;
      bd = d;
    }
  }
  return best;
}

// ───────────────────────── 명령 발행 ─────────────────────────

function push(ctx: Ctx, cmd: C2S_GameCommand): void {
  ctx.cmds.push(cmd);
}
const seq = (ctx: Ctx): number => ctx.t * 64 + ctx.cmds.length + 1;

/**
 * v4.5 (§22.12): 방어 태세 깃발은 적 땅을 지나지 못한다. from → to 를 적대 플레이어 땅 없이 갈 수 있는가 (봇 전용 BFS — 서버 거리장 캐시를 건드리지 않는다).
 * from 이 적 땅이어도 출발은 허용(서버 defendDest 와 같다).
 */
export function defendReachable(state: Readonly<GameState>, me: number, from: number, to: number): boolean {
  if (from === to) return true;
  if (hostilePlayer(state, me, state.owners[to])) return false;
  const seen = new Uint8Array(state.owners.length);
  const q = [from];
  seen[from] = 1;
  for (let i = 0; i < q.length; i++) {
    for (const v of state.graph.neighbors(q[i])) {
      if (seen[v] || hostilePlayer(state, me, state.owners[v])) continue;
      if (v === to) return true;
      seen[v] = 1;
      q.push(v);
    }
  }
  return false;
}

/** 발령 — 앵커가 내 땅(= 방어 태세)인데 출발 기지에서 적 땅 없이 못 가면 내지 않는다 (v4.5). 냈으면 true */
function issue(ctx: Ctx, unit: Unit, troops: number, anchor: number): boolean {
  if (ctx.state.owners[anchor] === ctx.me && !defendReachable(ctx.state, ctx.me, originFor(ctx.state, ctx.p, anchor), anchor)) return false;
  push(ctx, { type: 'cmd_flag_issue', clientSeq: seq(ctx), unit, troops, anchorTileId: anchor, originBaseTileId: null });
  ctx.pool -= poolCostOf(ctx.p, troops, unit);
  ctx.slots += 1;
  return true;
}
/**
 * v4.7 (§29) A5 [A-127]: 전투 시작 후 BOT_MIN_ENGAGE_TICKS 가 지나기 전엔 후퇴·회수·재지정 명령을 내지 않는다.
 * v4.8 (§29.5) [A-135]: 단, 내 실효력이 교전 상대 합의 BOT_ENGAGE_BREAK_RATIO_PERMILLE(‰) 미만이면 억제하지 않는다.
 */
function engageLocked(ctx: Ctx, f: Readonly<Flag>): boolean {
  if (!(f.inCombat && f.combatSinceTick !== null && ctx.t - f.combatSinceTick < BOT_MIN_ENGAGE_TICKS)) return false;
  return !extremelyOutmatched(ctx, f);
}
/** 교전 상대 대비 내 실효력(병력 × flagValue)이 BOT_ENGAGE_BREAK_RATIO_PERMILLE 미만인가 (maintain 후퇴 판정과 같은 눈금) */
function extremelyOutmatched(ctx: Ctx, f: Readonly<Flag>): boolean {
  const foes = combatFoes(ctx, f);
  if (!foes.length) return false;
  if (ctx.state.combatModel === 2) {
    // §33: 스칼라(병력 x v) 대신 정확 손실 비율 -> 버티는 시간 비 (hold = 병력 / tick 손실)
    const e = engageLossPerTick(ctx.state, f, foes);
    let enT = 0;
    for (const g of foes) enT += g.troopsMilli;
    return f.troopsMilli * e.foes * 1000 < enT * e.mine * BOT_ENGAGE_BREAK_RATIO_PERMILLE;
  }
  const group = [f, ...foes];
  const myEff = Math.floor(f.troopsMilli / 1000) * flagValue(ctx.state, f, group);
  let enEff = 0;
  for (const g of foes) enEff += Math.floor(g.troopsMilli / 1000) * flagValue(ctx.state, g, group);
  return myEff * 1000 < enEff * BOT_ENGAGE_BREAK_RATIO_PERMILLE;
}
/** 재지정 — 도착지가 내 땅(= 방어 태세)인데 지금 위치에서 적 땅 없이 못 가면 내지 않는다 (v4.5). 냈으면 true */
function retarget(ctx: Ctx, f: Readonly<Flag>, anchor: number): boolean {
  if (engageLocked(ctx, f)) return false;
  if (ctx.state.owners[anchor] === ctx.me && !defendReachable(ctx.state, ctx.me, f.posTileId, anchor)) return false;
  // v4.6 (§27): 도착지 기본 태세가 지금 태세와 다른데 태세 쿨타임 중이면 서버는 태세를 못 바꾼 채 이동만 한다 — 봇은 쿨타임이 끝날 때까지 미룬다
  const def = ctx.state.owners[anchor] === ctx.me ? POSTURE.DEFEND : POSTURE.ATTACK;
  if (def !== f.posture && ctx.t + 1 < f.postureCooldownUntilTick) return false;
  push(ctx, { type: 'cmd_flag_retarget', clientSeq: seq(ctx), flagId: f.id, anchorTileId: anchor });
  ctx.touched.add(f.id);
  return true;
}
/** v4.2 8.7 3b: 봇 회수는 항상 가장 가까운 내 기지를 지정한다 (없으면 자동) */
function recall(ctx: Ctx, f: Readonly<Flag>): void {
  if (engageLocked(ctx, f)) return;
  push(ctx, { type: 'cmd_flag_recall', clientSeq: seq(ctx), flagId: f.id, baseTileId: nearestBase(ctx, f.posTileId) });
  ctx.touched.add(f.id);
}
function posture(ctx: Ctx, f: Readonly<Flag>, to: Posture): void {
  push(ctx, { type: 'cmd_set_posture', clientSeq: seq(ctx), flagId: f.id, posture: to });
  ctx.touched.add(f.id);
}

/**
 * 다음 tick 1단계에서 적용되므로 t+1 기준으로 경직·쿨타임을 본다.
 * v4.6 (§27): 서버는 전투 중 전환도 받지만(이탈 비용 부과), 봇은 전투 중 전환하지 않는다 (후퇴 규칙이 전투 중 판단을 맡고, 전환 반복을 막는다).
 */
const canRetarget = (ctx: Ctx, f: Readonly<Flag>): boolean => isLive(f) && (ctx.t + 1 >= f.lockUntilTick || f.disengageUntilTick !== null);
const canPosture = (ctx: Ctx, f: Readonly<Flag>): boolean =>
  isLive(f) && !f.inCombat && f.disengageUntilTick === null && ctx.t + 1 >= f.postureCooldownUntilTick;

// ───────────────────────── 지형 스캔 (결정당 1회) ─────────────────────────

function scanBorder(ctx: Ctx): Map<number, number[]> {
  if (ctx.border) return ctx.border;
  const { state, me } = ctx;
  const owners = state.owners;
  const terrain = state.map.terrain;
  const border = new Map<number, number[]>();
  for (let t = 0; t < owners.length; t++) {
    const o = owners[t];
    if (o === me || !isClaimable(terrain[t]) || isAlly(state, me, o)) continue;
    let adj = false;
    for (const n of state.graph.neighbors(t)) if (owners[n] === me) adj = true;
    if (!adj) continue;
    let arr = border.get(o);
    if (!arr) border.set(o, (arr = []));
    arr.push(t);
    if (o !== NEUTRAL) ctx.hostileBorder = true;
  }
  ctx.border = border;
  return border;
}

// ───────────────────────── 8.1 위협 ─────────────────────────

interface ThreatItem {
  e: Flag;
  tile: number; // e.targetTileId (내 땅)
  threat: number;
}

function threatItems(ctx: Ctx): { items: ThreatItem[]; baseTh: [number, number][] } {
  const { state, me, t } = ctx;
  const items: ThreatItem[] = [];
  for (const g of state.flags) {
    // v4.2 8.7 1: 위협 = pushing(g) (앵커 점령 ENGAGED + 행군 중 정지 점령 halted)
    if (g.ownerId === me || g.routed || !pushing(g) || g.targetTileId === null) continue;
    if (!hostilePlayer(state, me, g.ownerId) || state.owners[g.targetTileId] !== me) continue;
    const cost = tileCost(state, g, g.targetTileId);
    const rate = Math.min(Math.floor((g.initialTroops * FLAG_SPEND_RATE_PERMILLE) / cost), maxProgress(g));
    items.push({ e: g, tile: g.targetTileId, threat: g.progressMilli + rate * BOT_THREAT_LOOKAHEAD });
  }
  const baseTh: [number, number][] = [];
  for (const b of ctx.p.baseTiles) {
    const bs = state.bases[state.baseIndexOf.get(b)!];
    // GDD 식의 "/1000" 은 hpMilli 단위와 맞지 않아(최대 45) 뺐다 — §10 기록
    if (t - bs.lastDamageTick < 25 && bs.hpMilli < BASE_HP_MAX_MILLI) baseTh.push([b, (BASE_HP_MAX_MILLI - bs.hpMilli) * BOT_BASE_THREAT_W]);
  }
  return { items, baseTh };
}

function threatAt(state: Readonly<GameState>, items: ThreatItem[], baseTh: [number, number][], h: number): number {
  let s = 0;
  for (const it of items) if (state.graph.distance(it.tile, h) <= FRONT_RADIUS) s += it.threat;
  for (const [b, v] of baseTh) if (state.graph.distance(b, h) <= FRONT_RADIUS) s += v;
  return s;
}

/**
 * 요격 앵커: 위협 깃발 e 와 접촉하는(8방향, 2026-10-11) 내 땅 칸 중 tileId 최소, 없으면 접촉 밖 거리 2 칸 중 tileId 최소.
 * 없으면 e 의 타깃 칸.
 */
function interceptTile(ctx: Ctx, e: Readonly<Flag>): number {
  const { state, me } = ctx;
  const ok = (x: number) => state.owners[x] === me && isClaimable(state.map.terrain[x]);
  for (const x of state.graph.contactNeighbors(e.posTileId)) if (ok(x)) return x;
  for (const x of state.graph.disk(e.posTileId, 2)) {
    if (ok(x) && state.graph.distance(x, e.posTileId) === 2 && !state.graph.touching(x, e.posTileId)) return x;
  }
  return e.targetTileId!;
}

// ───────────────────────── 8.3 앵커 선택 ─────────────────────────

/** v4.2 8.3 [A-65]: 노선 깊이 = clamp(floor(병력 / (3 × cost)), 4, 6) (§25 B2: 상한 20 → 6) — 걸음당 3칸 */
function plowDepth(troops: number, cost: number): number {
  return Math.min(BOT_DEEP_MAX, Math.max(BOT_DEEP_MIN, Math.floor(troops / (3 * cost))));
}

/**
 * §31 [A-141]: 상대의 마지막 기지(= 점령하면 멸망·합병)면 정리 보상(인계 병력 + 정액 병력 + 골드, 골드 1 = 병력 1로 환산)을
 * 칸 수(보상 / 칸당 비용)로 바꿔 mass 에 더한 비율만큼 점수를 올린다. 보상이 0 이면 점수 불변.
 */
function lastBaseBountyScore(ctx: Ctx, o: number, b: number, tq: number, score: number): number {
  const { state, me } = ctx;
  const victim = state.players[o];
  if (!victim || victim.baseTiles.length !== 1) return score;
  let assets = victim.troopsMilli;
  for (const f of state.flags) if (f.ownerId === o) assets += f.troopsMilli;
  const reward = Math.floor((assets * ANNEX.assetPermille) / 1_000_000) + ANNEX.bountyTroops + Math.floor((victim.goldMilli * ANNEX.goldPermille) / 1_000_000) + ANNEX.bountyGold;
  if (reward <= 0) return score;
  const cost = tileCost(state, pseudoAttack(me, UNIT.SWORD, b, o), b);
  const mass = Math.max(1, Math.min(Math.floor(tq / cost), 3 * plowDepth(tq, cost)));
  const gainTiles = Math.floor(reward / cost);
  return Math.floor((score * (mass + gainTiles)) / mass);
}

function scoreAnchor(ctx: Ctx, o: number, anchor: number, adjMinTiles: number, from: number, troops: number): number {
  const { state, me, p, t } = ctx;
  const cost = tileCost(state, pseudoAttack(me, UNIT.SWORD, anchor, o), anchor);
  // v4.2 8.3 [A-65]: mass(원 안 칸 수) → yield = min(병력 / cost, 3 × depth). 최소 1
  const mass = Math.max(1, Math.min(Math.floor(troops / cost), 3 * plowDepth(troops, cost)));
  const march = state.graph.distance(from >= 0 ? from : originFor(state, p, anchor), anchor);
  let guardN = 0;
  let enemyDefend = 0;
  if (o !== NEUTRAL) {
    for (const d of state.flags) {
      if (d.ownerId !== o || d.posture !== POSTURE.DEFEND || !isLive(d)) continue;
      enemyDefend++;
      if (guardContains(state, d, anchor)) guardN++;
    }
  }
  let score = Math.floor((mass * 1_000_000) / (cost * (10 + march) * (1 + BOT_GUARD_PENALTY * guardN)));
  if (o === NEUTRAL) {
    score = Math.floor((score * (t < BOT_NEUTRAL_BIAS_TICK ? 160 : 100)) / 100);
  } else {
    if (state.players[o].tiles === adjMinTiles) score = Math.floor((score * 130) / 100);
    if (state.players[o].tiles * 2 > p.tiles * 3) score = Math.floor((score * 60) / 100);
    if (enemyDefend === 0) score = Math.floor((score * 170) / 100);
    if (state.map.isBase[anchor]) {
      const b = state.bases[state.baseIndexOf.get(anchor)!];
      if (b.hpMilli < BASE_HP_MAX_MILLI / 2) score = Math.floor((score * 140) / 100);
    }
    score = Math.floor((score * ctx.k.enemyAnchorWeightPermille) / 1000); // 성향: 적 앵커 선호
  }
  return score;
}

/** 8.6 경로 위험(근사): 앵커 거리 ≤ 2 의 적 깃발 실효력 합. 내 예상 실효력 × 1000 < 이 값 × 0.9 이면 회피 */
function anchorDanger(ctx: Ctx, anchor: number): number {
  const { state, me } = ctx;
  let s = 0;
  for (const g of state.flags) {
    if (g.routed || !hostilePlayer(state, me, g.ownerId)) continue;
    if (state.graph.distance(g.posTileId, anchor) <= 2) s += effOf(state, g);
  }
  return s;
}

/** 내 땅까지 격자 거리 — 토폴로지 인접(지형 무시) 다중 출발 BFS = min over 내 타일 distance (minDistFromTerritory 와 같은 값) */
function terrDist(ctx: Ctx): Int32Array {
  if (ctx.terrDist) return ctx.terrDist;
  const { state, me } = ctx;
  const n = state.owners.length;
  const d = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (let t = 0; t < n; t++)
    if (state.owners[t] === me) {
      d[t] = 0;
      q.push(t);
    }
  const topo = state.graph.topology;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const v of topo.adjacent(u)) {
      if (d[v] >= 0) continue;
      d[v] = d[u] + 1;
      q.push(v);
    }
  }
  ctx.terrDist = d;
  return d;
}

/**
 * v4.2 8.3 [A-65] 깊은 앵커: 국경 앵커 a 에서 노선 끝점을 민다.
 * deep = argmax over { t : 점령 가능, marchMatch, a 에서 depth 걸음 안 } of ( min(내 땅까지 거리, depth), −tileCost, −tileId ).
 * GDD 에 없어 정함(§10): 후보는 a 에서 "점령 가능 · 비내 · 비동맹 칸만 밟는" 그래프 BFS 로 depth 걸음 안 — 물 건너 칸(기하 거리만 가까운)을 고르지 않게.
 */
function deepAnchor(ctx: Ctx, a: number, troops: number): number {
  const { state, me } = ctx;
  const cost = tileCost(state, pseudoAttack(me, UNIT.SWORD, a, state.owners[a]), a);
  const depth = plowDepth(troops, cost);
  const td = terrDist(ctx);
  const costAt = (x: number) => tileCost(state, pseudoAttack(me, UNIT.SWORD, x, state.owners[x]), x);
  const seen = new Map<number, number>([[a, 0]]);
  const q = [a];
  let best = a;
  let bk = Math.min(td[a], depth);
  let bc = -1;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    const du = seen.get(u)!;
    if (u !== a) {
      const k = Math.min(td[u], depth);
      if (k > bk) {
        best = u;
        bk = k;
        bc = -1;
      } else if (k === bk) {
        if (bc < 0) bc = costAt(best);
        const c = costAt(u);
        if (c < bc || (c === bc && tieLess(u, best))) { // §32
          best = u;
          bc = c;
        }
      }
    }
    if (du >= depth) continue;
    for (const v of state.graph.neighbors(u)) {
      if (seen.has(v) || !isClaimable(state.map.terrain[v]) || !marchMatch(state, me, state.owners[v])) continue;
      seen.set(v, du + 1);
      q.push(v);
    }
  }
  return best;
}

/** 공격 발령 예상 병력 (점수·깊이용) — fill 의 commit 식 근사 */
function plannedTroops(ctx: Ctx, o: number): number {
  const commit = o === NEUTRAL ? BOT_COMMIT_NEUTRAL_PERMILLE : BOT_COMMIT_ENEMY_PERMILLE;
  return Math.max(FLAG_MIN_TROOPS, Math.floor((ctx.pool * commit) / 1000));
}

/**
 * from = 재지정할 깃발의 현재 위치 (발령이면 -1 → 기지 출발 originFor), troops = 그 깃발 병력 (발령이면 -1 → plannedTroops).
 * v4.2: 반환 tileId 는 깊은 앵커(노선 끝점), border 는 점수를 매긴 국경 칸.
 */
function bestAnchor(ctx: Ctx, excludeOwner = -1, from = -1, troops = -1): Anchor | null {
  const { state, me, p } = ctx;
  const border = scanBorder(ctx);
  // 소유자별 내 공격 깃발 수 + 공격 앵커 (계획 포함)
  const targeted = new Map<number, number>();
  const anchors: [number, number][] = [...ctx.plannedAttack];
  const plowPos: number[] = [];
  for (const f of ctx.mine) {
    if (!isLive(f) || f.posture !== POSTURE.ATTACK) continue;
    targeted.set(f.targetOwnerId, (targeted.get(f.targetOwnerId) ?? 0) + 1);
    anchors.push([f.targetOwnerId, f.anchorTileId]);
    if (f.id !== ctx.selfFlagId) plowPos.push(f.posTileId);
  }
  for (const [o] of ctx.plannedAttack) targeted.set(o, (targeted.get(o) ?? 0) + 1);
  let adjMinTiles = Infinity;
  for (const o of border.keys()) if (o !== NEUTRAL) adjMinTiles = Math.min(adjMinTiles, state.players[o].tiles);

  const owners = [...border.keys()].sort((a, b) => a - b); // v4.5: 상륙 후보 폐지 — 국경 칸만
  let best: Anchor | null = null;
  const commitPm = (o: number) => (o === NEUTRAL ? BOT_COMMIT_NEUTRAL_PERMILLE : BOT_COMMIT_ENEMY_PERMILLE);
  for (const o of owners) {
    if (o === excludeOwner || (targeted.get(o) ?? 0) >= 2) continue;
    if (o !== NEUTRAL && !state.players[o].alive) continue;
    const pick = (tiles: readonly number[] | undefined): number => {
      if (!tiles) return -1;
      let a = -1;
      let ac = Infinity;
      for (const x of tiles) {
        if (anchors.some(([ao, at]) => (ao === o || ao === ANY_HOSTILE) && state.graph.distance(at, x) <= FRONT_RADIUS)) continue;
        if (plowPos.some((pp) => state.graph.distance(pp, x) <= BOT_PLOW_SPACING)) continue;
        const c = tileCost(state, pseudoAttack(me, UNIT.SWORD, x, o), x);
        if (c < ac || (c === ac && tieLess(x, a))) { // §32: 동률은 tileId 가 아니라 해시 순 (위·왼쪽 편향 제거)
          a = x;
          ac = c;
        }
      }
      return a;
    };
    const a = pick(border.get(o));
    const tq = troops >= 0 ? troops : plannedTroops(ctx, o);
    if (a >= 0) {
      const score = scoreAnchor(ctx, o, a, adjMinTiles, from, tq);
      // 8.6 회피 (근사)
      const danger = anchorDanger(ctx, a);
      if (danger > 0) {
        const q = Math.floor((ctx.pool * commitPm(o)) / 1000);
        const mine = q * valueAs(state, me, UNIT.SWORD, POSTURE.ATTACK, a);
        if (mine * 1000 < danger * BOT_AVOID_RATIO_PERMILLE) continue;
      }
      if (!best || score > best.score || (score === best.score && o < best.owner)) {
        best = { tileId: a, border: a, owner: o, kind: o === NEUTRAL ? 0 : 1, score, troops: tq, base: false };
      }
    }
  }
  // v4.2 기지 공격 (사용자 확정 2026-10-10): 내 땅에서 BOT_BASE_ATTACK_RANGE 안의 적(비동맹 플레이어) 기지마다 별도 후보.
  // 앵커 = 기지 칸 자체(깊은 앵커 없음). 점수 = 8.3 식(체력 절반 미만 ×1.4 포함) × 2.5 × (관할 원 밖 1.5) × (수도 1.5)
  {
    const td = terrDist(ctx);
    const capitals = new Set<number>();
    for (const q of state.players) if (q) capitals.add(q.homeTileId);
    for (const b of state.map.baseTiles) {
      const o = state.owners[b];
      // v4.5 [A-109]: 중립 기지도 후보 (기지 생산 = 영토 60/100칸분)
      const neutralBase = o === NEUTRAL;
      if (!neutralBase && (!hostilePlayer(state, me, o) || !state.players[o].alive)) continue;
      if (o === excludeOwner) continue;
      if (td[b] > BOT_BASE_ATTACK_RANGE || (!neutralBase && (targeted.get(o) ?? 0) >= 2)) continue;
      if (anchors.some(([, at]) => at === b)) continue;
      const commit = neutralBase ? BOT_COMMIT_NEUTRAL_PERMILLE : BOT_COMMIT_BASE_PERMILLE;
      const tq = troops >= 0 ? troops : Math.max(FLAG_MIN_TROOPS, Math.floor((ctx.pool * commit) / 1000));
      let score = scoreAnchor(ctx, o, b, adjMinTiles, from, tq);
      score = Math.floor((score * (neutralBase ? BOT_NEUTRAL_BASE_WEIGHT_PERMILLE : BOT_BASE_ATTACK_WEIGHT_PERMILLE)) / 1000);
      let guarded = false;
      for (const d of state.flags) if (d.ownerId === o && d.posture === POSTURE.DEFEND && isLive(d) && guardContains(state, d, b)) guarded = true;
      if (!guarded) score = Math.floor((score * BOT_BASE_UNGUARDED_PERMILLE) / 1000);
      if (capitals.has(b)) score = Math.floor((score * BOT_BASE_CAPITAL_PERMILLE) / 1000);
      if (!neutralBase) score = lastBaseBountyScore(ctx, o, b, tq, score); // §31 [A-141]: 마지막 기지 = 멸망 보상만큼 가치 가산
      const danger = anchorDanger(ctx, b);
      if (danger > 0) {
        const q = Math.floor((ctx.pool * commit) / 1000);
        if (q * valueAs(state, me, UNIT.SWORD, POSTURE.ATTACK, b) * 1000 < danger * BOT_AVOID_RATIO_PERMILLE) continue;
      }
      if (!best || score > best.score || (score === best.score && o < best.owner)) {
        best = { tileId: b, border: b, owner: o, kind: neutralBase ? 0 : 1, score, troops: tq, base: true };
      }
    }
  }
  if (best && !best.base) {
    best.tileId = deepAnchor(ctx, best.border, best.troops); // v4.2 [A-65]: 점수 뒤 앵커를 노선 끝점으로
    best.owner = state.owners[best.tileId];
  }
  return best;
}

/** 8.2 currentScore(f) — 현재 앵커를 같은 식으로 평가 */
function currentScore(ctx: Ctx, f: Readonly<Flag>): number {
  const border = scanBorder(ctx);
  let adjMinTiles = Infinity;
  for (const o of border.keys()) if (o !== NEUTRAL) adjMinTiles = Math.min(adjMinTiles, ctx.state.players[o].tiles);
  const o = f.targetOwnerId === ANY_HOSTILE ? ctx.state.owners[f.anchorTileId] : f.targetOwnerId;
  return scoreAnchor(ctx, o, f.anchorTileId, adjMinTiles, f.posTileId, Math.floor(f.troopsMilli / 1000));
}

// ───────────────────────── 8.4 병종 ─────────────────────────

function chooseUnit(ctx: Ctx, a: Anchor): Unit {
  if (ctx.params.fixedUnit !== null) return ctx.params.fixedUnit as Unit;
  const { state, p } = ctx;
  if (a.kind === 0) return UNIT.CAVALRY;
  if (a.base) {
    // v4.2 기지 공격: 기지가 적 방어 관할 원 안이면 검병, 아니면 기병 (사용자 확정)
    for (const d of state.flags) if (d.ownerId === a.owner && d.posture === POSTURE.DEFEND && isLive(d) && guardContains(state, d, a.tileId)) return UNIT.SWORD;
    return UNIT.CAVALRY;
  }
  if (state.map.isBase[a.tileId]) return UNIT.CAVALRY;
  if (state.graph.distance(originFor(state, p, a.border), a.border) > BOT_FAR_FRONT_DIST) return UNIT.CAVALRY;
  // v4.2 8.7 3a: 점령 속도 = 걷는 속도 → 기병 비중 상향. 국경 칸이 적 방어 관할 원 안일 때만 검병(돌파 지구력)
  const o = state.owners[a.border];
  for (const d of state.flags) {
    if (d.ownerId !== o || d.posture !== POSTURE.DEFEND || !isLive(d)) continue;
    if (guardContains(state, d, a.border)) return UNIT.SWORD;
  }
  return UNIT.CAVALRY;
}

/** 테스트용: 앵커 하나에 대한 병종 선택 (chooseUnit 이 읽는 state·p·params 만 채운 Ctx) */
export function chooseUnitFor(
  state: Readonly<GameState>,
  me: number,
  params: Readonly<BotDifficultyParams>,
  a: Pick<Anchor, 'tileId' | 'border' | 'owner' | 'kind' | 'base'>,
): Unit {
  const ctx = { state, me, p: state.players[me], params } as unknown as Ctx;
  return chooseUnit(ctx, { ...a, troops: 0, score: 0 });
}

// ───────────────────────── 단계별 결정 ─────────────────────────

function diplomacy(ctx: Ctx): void {
  const { state, me, p, t } = ctx;
  let allies = 0;
  for (const a of state.alliances) if (a.a === me || a.b === me) allies++;
  for (const pr of state.proposals) {
    if (pr.to !== me) continue;
    const from = state.players[pr.from];
    const accept = !!from && from.alive && from.tiles * 1000 >= p.tiles * BOT_ALLY_ACCEPT_PERMILLE && allies < MAX_ALLIES_PER_PLAYER;
    push(ctx, { type: 'cmd_ally_respond', clientSeq: seq(ctx), proposalId: pr.id, accept });
    if (accept) allies++;
  }
  // 파기: 내 타일 ≥ 동맹 × 2.0, t > 7500, 최소 유지시간 경과
  for (const a of state.alliances) {
    if (a.state !== 'ACTIVE' || (a.a !== me && a.b !== me)) continue;
    const other = a.a === me ? a.b : a.a;
    if (t > BOT_BREAK_AFTER_TICK && t + 1 - a.sinceTick >= ALLIANCE_MIN_DURATION && p.tiles * 1000 >= state.players[other].tiles * BOT_ALLY_BREAK_PERMILLE) {
      push(ctx, { type: 'cmd_ally_break', clientSeq: seq(ctx), allyPlayerId: other });
    }
  }
}

/**
 * v4.3 테크 (01b 6.1): 목록에서 아직 안 산 첫 노드 — 살 수 있으면 산다, 아니면 기다린다(건너뛰지 않음).
 * 검병 고정 봇은 TECH_PRIORITY_SWORD. 목록 소진 후(16개 다 삼)엔 (티어, id) 오름차순으로 선행 충족 노드 (프로토콜 §10).
 */
function buyTech(ctx: Ctx): void {
  const p = ctx.p;
  const lists = ctx.params.fixedUnit === UNIT.SWORD ? TECH_PRIORITY_SWORD : TECH_PRIORITY;
  let next = -1;
  for (const id of lists[ctx.params.techStyle ?? (ctx.me - 1) % 4]) {
    if (!techOwned(p.techMask, id)) {
      next = id;
      break;
    }
  }
  if (next < 0) {
    for (let tier = 1; tier <= 3 && next < 0; tier++)
      for (const n of TECH_NODES) if (n.tier === tier && !techOwned(p.techMask, n.id) && techPrereqMet(p.techMask, n.id)) {
        next = n.id;
        break;
      }
  }
  if (next < 0) return;
  if (p.goldMilli >= techCost(TECH_NODES[next].tier, p.techPurchased) * 1000) {
    push(ctx, { type: 'cmd_buy_tech', clientSeq: seq(ctx), nodeId: next });
  }
}

/** v4.4: 내 기지 칸 위(또는 그 칸으로 가는) 방어 태세 깃발 — 기지 수비대 */
function isBaseGuard(ctx: Ctx, f: Readonly<Flag>): boolean {
  if (!isLive(f) || !ctx.state.map.isBase[f.anchorTileId] || ctx.state.owners[f.anchorTileId] !== ctx.me) return false;
  return f.posture === POSTURE.DEFEND && (f.posTileId === f.anchorTileId || f.state === 'MARCHING');
}

/**
 * v4.4 기지 방어 (사용자 2026-10-14) — 결정당 1회. 위협받는 내 기지에 방어 깃발을 세운다(기지 칸 위 방어 = 지형 대신 ×1.5).
 * 위협 = 적대·비귀환·비패주 공격 태세 깃발의 실효력 합 (기지에서 BOT_BASE_GUARD_RADIUS, 마지막 기지는 BOT_LAST_BASE_GUARD_RADIUS 안).
 * 마지막 기지는 위협만으로, 나머지 기지는 최근 BOT_BASE_GUARD_DAMAGE_WINDOW tick 안에 체력이 깎였을 때만 대상.
 * 우선순위: 마지막 기지 → 위협 큰 순(동률 tileId). 이미 수비대 실효력 ≥ 위협 × BOT_INTERCEPT_RATIO 면 건너뛴다.
 * 수단: ① 새 창병 발령(앵커 = 기지 → 출발도 그 기지라 즉시 자리 잡음) ② 슬롯·병력이 없고 마지막 기지면 가장 가까운 비전투 깃발을 기지로 재지정.
 */
function guardBases(ctx: Ctx): void {
  const { state, me, p } = ctx;
  if (!p.baseTiles.length) return;
  const last = p.baseTiles.length === 1;
  const radius = last ? BOT_LAST_BASE_GUARD_RADIUS : BOT_BASE_GUARD_RADIUS;
  const cands: { b: number; threat: number; guard: number }[] = [];
  for (const b of p.baseTiles) {
    let threat = 0;
    for (const g of state.flags) {
      if (g.posture !== POSTURE.ATTACK || !isLive(g) || !hostilePlayer(state, me, g.ownerId)) continue;
      if (state.graph.distance(g.posTileId, b) > radius) continue;
      threat += effOf(state, g);
    }
    if (threat === 0) continue;
    // 마지막 기지가 아니면 실제로 체력이 깎이는 중일 때만 (자가대전 비교 — 모든 위협 기지를 지키면 기지 함락이 절반 이하로 준다, §9 v4.4)
    if (!last) {
      const bs = state.bases[state.baseIndexOf.get(b)!];
      if (ctx.t - bs.lastDamageTick >= BOT_BASE_GUARD_DAMAGE_WINDOW || bs.hpMilli >= BASE_HP_MAX_MILLI) continue;
    }
    let guard = 0;
    for (const f of ctx.mine) if (f.anchorTileId === b && isBaseGuard(ctx, f)) guard += Math.floor(f.troopsMilli / 1000) * valueAs(state, me, f.unit, POSTURE.DEFEND, b);
    if (guard * 1000 >= threat * BOT_INTERCEPT_RATIO_PERMILLE) continue;
    cands.push({ b, threat, guard });
  }
  if (!cands.length) return;
  cands.sort((x, y) => y.threat - x.threat || x.b - y.b);
  const { b, threat, guard } = cands[0];
  if (ctx.plannedDefend.includes(b)) return;
  // ① 새 창병 — 기지 칸 위 방어 실효값으로 필요 병력 산정
  if (ctx.slots < ctx.cap) {
    const vU = valueAs(state, me, UNIT.SPEAR, POSTURE.DEFEND, b);
    const need = Math.ceil((threat * BOT_INTERCEPT_RATIO_PERMILLE - guard * 1000) / (vU * 1000));
    const maxQ = maxIssuable(p, ctx.pool, UNIT.SPEAR);
    const q = Math.min(maxQ, Math.max(need, Math.floor((ctx.pool * BOT_DEFEND_COMMIT_PERMILLE) / 1000), FLAG_MIN_TROOPS));
    // 마지막 기지는 필요량에 못 미쳐도 가진 만큼 세운다 (지면 멸망)
    if (q >= FLAG_MIN_TROOPS && (q >= need || last) && issue(ctx, UNIT.SPEAR, q, b)) {
      ctx.plannedDefend.push(b);
      return;
    }
  }
  // ② 마지막 기지: 가장 가까운 비전투 깃발을 기지로 (재지정 = 도착지 내 기지 → 방어 태세)
  if (!last) return;
  let pick: Flag | null = null;
  let pd = Infinity;
  for (const f of ctx.mine) {
    if (!isLive(f) || f.inCombat || ctx.touched.has(f.id) || !canRetarget(ctx, f) || f.anchorTileId === b) continue;
    if (!defendReachable(state, me, f.posTileId, b)) continue; // v4.5: 적 땅 너머 깃발은 못 온다
    const d = state.graph.distance(f.posTileId, b);
    if (d < pd) {
      pick = f;
      pd = d;
    }
  }
  if (pick && retarget(ctx, pick, b)) ctx.plannedDefend.push(b);
}

/** 8.2 (1) + 8.6 요격 — 결정당 방어 행동 1회 */
function defend(ctx: Ctx): void {
  const { state, me } = ctx;
  const { items, baseTh } = threatItems(ctx);
  if (!items.length) return;
  const ranked = items
    .map((it) => ({ it, h: threatAt(state, items, baseTh, it.tile) }))
    .sort((a, b) => b.h - a.h || a.it.e.id - b.it.e.id);
  for (const { it, h } of ranked) {
    if (h < BOT_THREAT_TRIGGER) break;
    const e = it.e;
    const eEff = effOf(state, e);
    // 이미 충분히 강한 내 방어 깃발이 그 구간을 덮으면 건너뛴다 (8.6.0 반격 규칙이 처리)
    const covered =
      ctx.plannedDefend.some((a) => state.graph.distance(a, it.tile) <= FRONT_RADIUS) ||
      ctx.mine.some((f) => isLive(f) && f.posture === POSTURE.DEFEND && state.graph.distance(f.anchorTileId, it.tile) <= FRONT_RADIUS && effOf(state, f) >= eEff);
    if (covered) continue;
    const anchor = interceptTile(ctx, e);
    const eV = flagValue(state, e, [e]);
    const eTroops = Math.floor(e.troopsMilli / 1000);
    // 8.6 "기존 주둔 깃발 재지정": 충분히 강한 비전투 방어 깃발이 가까이(거리 ≤ 2 × FRONT_RADIUS) 있으면 그것을 옮긴다 (§10 — 슬롯 절약)
    {
      let pick: Flag | null = null;
      let pd = Infinity;
      for (const f of ctx.mine) {
        if (f.posture !== POSTURE.DEFEND || f.inCombat || ctx.touched.has(f.id) || !canRetarget(ctx, f) || isBaseGuard(ctx, f)) continue;
        const d = state.graph.distance(f.posTileId, anchor);
        if (d > 2 * FRONT_RADIUS || d >= pd) continue;
        if (!defendReachable(state, me, f.posTileId, anchor)) continue; // v4.5
        const vU = valueAs(state, me, f.unit, POSTURE.DEFEND, anchor);
        if (Math.floor(f.troopsMilli / 1000) * vU * 1000 < eTroops * BOT_INTERCEPT_RATIO_PERMILLE * eV) continue;
        pick = f;
        pd = d;
      }
      if (pick) {
        if (pd > 1) retarget(ctx, pick, anchor);
        ctx.plannedDefend.push(anchor);
        return;
      }
    }
    if (ctx.slots < ctx.cap && defendCount(ctx) < maxDefense(ctx)) {
      const far = state.graph.distance(originFor(state, ctx.p, anchor), anchor) > BOT_FAR_FRONT_DIST;
      const units: Unit[] = ctx.params.fixedUnit === null && far ? [UNIT.CAVALRY, UNIT.SPEAR] : [UNIT.SPEAR];
      for (const u of units) {
        const vU = valueAs(state, me, u, POSTURE.DEFEND, anchor);
        const need = Math.ceil((eTroops * BOT_INTERCEPT_RATIO_PERMILLE * eV) / (vU * 1000));
        const maxQ = maxIssuable(ctx.p, ctx.pool, u);
        let q = Math.max(need, Math.floor((ctx.pool * BOT_DEFEND_COMMIT_PERMILLE) / 1000), FLAG_MIN_TROOPS);
        if (q > maxQ) q = maxQ;
        if (q < need || q < FLAG_MIN_TROOPS) continue;
        if (!issue(ctx, u, q, anchor)) break; // v4.5: 기지에서 적 땅 없이 못 가는 요격 칸 — 아래 전환으로
        ctx.plannedDefend.push(anchor);
        return;
      }
    }
    // 슬롯이 없거나 병력 부족 → 가장 가치 낮은 공격 깃발을 방어로 돌린다
    if (h * 1000 >= BOT_THREAT_TRIGGER * BOT_PREEMPT_FACTOR_PERMILLE) {
      let victim: Flag | null = null;
      let vg = Infinity;
      for (const f of ctx.mine) {
        // expectedGain = 남은 옆 칸 수 — v4.2: 미는 중(ENGAGED·halted)인 공격 깃발만 후보 (§10)
        if (!pushing(f) || ctx.touched.has(f.id) || !canRetarget(ctx, f)) continue;
        if (!defendReachable(state, me, f.posTileId, anchor)) continue; // v4.5
        const g = frontSize(state, f);
        if (g < vg) {
          victim = f;
          vg = g;
        }
      }
      if (victim && retarget(ctx, victim, anchor)) ctx.plannedDefend.push(anchor);
    }
    return; // 결정 tick 당 방어 전환 1회
  }
}

/** 전투 상대 (접촉 = 8방향, 적대, 둘 중 하나 ATTACK) — combat.ts 4a 와 같은 판정 */
function combatFoes(ctx: Ctx, f: Readonly<Flag>): Flag[] {
  const { state, me } = ctx;
  const res: Flag[] = [];
  for (const g of state.flags) {
    if (g.routed || g.troopsMilli <= 0 || g.breakaway || !hostilePlayer(state, me, g.ownerId)) continue;
    if (f.posture !== POSTURE.ATTACK && g.posture !== POSTURE.ATTACK) continue;
    if (state.graph.touching(g.posTileId, f.posTileId)) res.push(g);
  }
  return res;
}

/** v4.4: 기지 b 근처(마지막 기지면 더 넓게)에 적대 공격 깃발이 있는가 — guardBases 와 같은 반경 */
function baseThreatNear(ctx: Ctx, b: number): boolean {
  const r = ctx.p.baseTiles.length === 1 ? BOT_LAST_BASE_GUARD_RADIUS : BOT_BASE_GUARD_RADIUS;
  for (const g of ctx.state.flags) {
    if (g.posture === POSTURE.ATTACK && isLive(g) && hostilePlayer(ctx.state, ctx.me, g.ownerId) && ctx.state.graph.distance(g.posTileId, b) <= r) return true;
  }
  return false;
}

function hostileTilesNear(ctx: Ctx, center: number, r: number): boolean {
  for (const x of ctx.state.graph.disk(center, r)) if (hostilePlayer(ctx.state, ctx.me, ctx.state.owners[x])) return true;
  return false;
}

function defendCount(ctx: Ctx): number {
  let k = ctx.plannedDefend.length;
  for (const f of ctx.mine) if (isLive(f) && f.posture === POSTURE.DEFEND && !ctx.touched.has(f.id)) k++;
  return k;
}
const minDefense = (ctx: Ctx): number => Math.ceil((ctx.cap * ctx.k.minDefenseRatioPermille) / 1000);
/** 방어 깃발 상한 = max(최소 방어선, floor(슬롯 × maxDefenseRatio)) — 기준 BOT_MAX_DEFENSE_RATIO_PERMILLE 500, 성향 보간. 넘으면 8.2 정체 규칙(갈아타기/회수) */
const maxDefense = (ctx: Ctx): number => Math.max(minDefense(ctx), Math.floor((ctx.cap * ctx.k.maxDefenseRatioPermille) / 1000));

/** 8.2 (2) + 8.6.0 태세·차단·후퇴 — flagId ASC */
function maintain(ctx: Ctx): void {
  const { state, me, t } = ctx;
  for (const f of ctx.mine) {
    if (!isLive(f) || ctx.touched.has(f.id)) continue;
    const myTroops = Math.floor(f.troopsMilli / 1000);

    // ── 8.6.0 3. 후퇴 ──
    if (f.inCombat) {
      const foes = combatFoes(ctx, f);
      if (!foes.length || f.disengageUntilTick !== null) continue;
      const group = [f, ...foes];
      if (state.combatModel === 2) {
        // §33: 정확 손실 비율로 판단. 사기가 BOT_MORALE_SHAKEN 미만이고 지고 있으면(버티는 시간 비 < 1) 교대(회수)
        const e = engageLossPerTick(state, f, foes);
        let enT = 0;
        for (const g of foes) enT += g.troopsMilli;
        const lhs = f.troopsMilli * e.foes * 1000;
        if (lhs < enT * e.mine * ctx.k.retreatRatioPermille || (f.morale < BOT_MORALE_SHAKEN && lhs < enT * e.mine * 1000)) {
          const myLoss = engageLossPerTick(state, f, foes, true).mine * techDisengageTicks(ctx.p.statPm);
          if (f.troopsMilli - myLoss >= FLAG_MIN_TROOPS * 3 * 1000) recall(ctx, f);
        }
        continue;
      }
      const myV = flagValue(state, f, group);
      const myEff = myTroops * myV;
      let enEff = 0;
      let S = f.troopsMilli;
      let invE = 0;
      for (const g of foes) {
        const v = flagValue(state, g, group);
        enEff += Math.floor(g.troopsMilli / 1000) * v;
        S += g.troopsMilli;
        invE += Math.floor(1_000_000_000 / v);
      }
      if (myEff * 1000 < enEff * ctx.k.retreatRatioPermille) {
        // 이탈 대기 3초 손실 추정: L = S × 1.5% / n, 내 몫 = inv(v × 0.5) / Σinv
        const n = foes.length + 1;
        const L = Math.floor((S * COMBAT_LOSS_BP) / (n * 10000));
        const invMe = Math.floor(1_000_000_000 / Math.max(1, Math.floor((myV * DISENGAGE_VALUE_PERMILLE) / 1000)));
        const myLoss = Math.floor((2 * L * invMe) / (invMe + invE)) * techDisengageTicks(ctx.p.statPm);
        if (f.troopsMilli - myLoss >= FLAG_MIN_TROOPS * 3 * 1000) recall(ctx, f);
      }
      continue;
    }

    // ── 8.6.0 3. 추격: 기병 공격 깃발은 이탈 대기 중 적 깃발을 최우선 요격 ──
    if (f.unit === UNIT.CAVALRY && f.posture === POSTURE.ATTACK && canRetarget(ctx, f)) {
      let prey: Flag | null = null;
      for (const g of state.flags) {
        if (g.disengageUntilTick === null || g.routed || !hostilePlayer(state, me, g.ownerId)) continue;
        if (state.graph.distance(g.posTileId, f.posTileId) > FRONT_RADIUS) continue;
        const o = state.owners[g.posTileId];
        if (!isClaimable(state.map.terrain[g.posTileId]) || o === me || isAlly(state, me, o)) continue;
        if (g.posTileId === f.anchorTileId) continue;
        prey = g;
        break;
      }
      if (prey) {
        retarget(ctx, f, prey.posTileId);
        continue;
      }
    }

    // ── 8.6.0 2. 차단 당하기 ──
    if (f.blocked) {
      let bEff = 0;
      for (const g of state.flags) if (!g.routed && hostilePlayer(state, me, g.ownerId) && state.graph.touching(g.posTileId, f.posTileId)) bEff += effOf(state, g);
      const myEff = myTroops * valueAs(state, me, f.unit, POSTURE.ATTACK, f.posTileId);
      if (bEff * 1000 <= myEff * ctx.k.blockAttackRatioPermille && f.posture !== POSTURE.ATTACK && canPosture(ctx, f)) {
        posture(ctx, f, POSTURE.ATTACK);
        continue;
      }
      if (canRetarget(ctx, f)) {
        const a = f.posture === POSTURE.ATTACK ? withSelf(ctx, f, () => bestAnchor(ctx, state.owners[f.anchorTileId], f.posTileId, myTroops)) : null;
        if (a && a.tileId !== f.anchorTileId) {
          if (retarget(ctx, f, a.tileId))
            ctx.plannedAttack.push([a.owner, a.tileId]);
        } else recall(ctx, f);
        continue;
      }
    }

    // ── 8.2 IDLE — v4.2 8.7 3b: 병력 ≥ 200 이면 깊은 앵커로 재지정, 아니면 가까운 기지 지정 회수 ──
    if (f.state === 'IDLE') {
      if (!canRetarget(ctx, f)) continue;
      const a = myTroops >= BOT_IDLE_REDEPLOY_MIN_TROOPS ? withSelf(ctx, f, () => bestAnchor(ctx, -1, f.posTileId, myTroops)) : null;
      if (a) {
        if (retarget(ctx, f, a.tileId))
          ctx.plannedAttack.push([a.owner, a.tileId]);
      } else recall(ctx, f);
      continue;
    }

    const anchorOwner = state.owners[f.anchorTileId];
    if (f.posture === POSTURE.ATTACK) {
      // 제자리 반격 중인 주둔 깃발(내 땅 앵커 + ANY_HOSTILE): 위협 재등장 → DEFEND
      if (anchorOwner === me && f.targetOwnerId === ANY_HOSTILE) {
        if (threatened(state, f) && canPosture(ctx, f)) posture(ctx, f, POSTURE.DEFEND);
        continue;
      }
      // 소진 직전 회수 (§10 — 소진은 잔여 전액 소멸, 회수는 85% 환급). v4.2: 미는 중 = pushing (halted 포함)
      if (pushing(f) && f.troopsMilli < exhaustLine(ctx, f) && preRecallPays(ctx, f)) {
        recall(ctx, f);
        continue;
      }
      // 8.6.0 굳히기 / 8.2 정체
      if (f.stalled || f.troopsMilli * 1000 < f.initialTroops * 1000 * BOT_CONSOLIDATE_TROOPS_PERMILLE) {
        if (defendCount(ctx) < maxDefense(ctx) && hostileTilesNear(ctx, f.anchorTileId, FRONT_RADIUS + 1) && canPosture(ctx, f)) {
          posture(ctx, f, POSTURE.DEFEND);
          continue;
        }
        if (f.stalled && canRetarget(ctx, f)) {
          const a = withSelf(ctx, f, () => bestAnchor(ctx, -1, f.posTileId, myTroops));
          if (a && a.tileId !== f.anchorTileId && a.score * 1000 > currentScore(ctx, f) * BOT_STALL_SWITCH_PERMILLE) {
            if (retarget(ctx, f, a.tileId))
              ctx.plannedAttack.push([a.owner, a.tileId]);
          } else recall(ctx, f);
          continue;
        }
      }
      // v4.2: "ENGAGED 인데 front < 2 → 재지정" 규칙 삭제 — 앵커 칸 ENGAGED 는 옆 칸(≤ 4)만 밀고 다 먹으면 IDLE → 위 IDLE 규칙이 처리
      continue;
    }

    // DEFEND
    if (f.state !== 'ENGAGED' || anchorOwner !== me) continue;
    // v4.4: 기지 수비대는 반격·제자리 공격 전환 없이 자리를 지킨다. 위협 없이 BOT_GARRISON_PATIENCE 가 지나면 회수(아래 규칙과 같다)
    if (isBaseGuard(ctx, f) && f.posTileId === f.anchorTileId) {
      if (!threatened(state, f) && f.calmTicks >= BOT_GARRISON_PATIENCE && !baseThreatNear(ctx, f.anchorTileId)) recall(ctx, f);
      continue;
    }
    // 8.6.0 1. 주둔 반격: 적 공격 깃발이 관할 원 국경 칸 옆에 붙음 + 내 실효력 ≥ 적 × 1.2 → 그 칸으로 재지정
    if (canRetarget(ctx, f)) {
      let moved = false;
      for (const g of state.flags) {
        if (g.posture !== POSTURE.ATTACK || g.routed || !hostilePlayer(state, me, g.ownerId)) continue;
        if (state.graph.touching(g.posTileId, f.posTileId)) continue;
        if (state.graph.distance(g.posTileId, f.anchorTileId) > FRONT_RADIUS + 1) continue;
        let x = -1;
        // 반격 칸 = 적 깃발과 접촉하는 칸 (8방향, 2026-10-11)
        for (const n of [g.posTileId, ...state.graph.contactNeighbors(g.posTileId)].sort((a, b) => a - b)) {
          if (state.owners[n] === me && isClaimable(state.map.terrain[n]) && state.graph.distance(n, f.anchorTileId) <= FRONT_RADIUS) {
            x = n;
            break;
          }
        }
        if (x < 0 || x === f.anchorTileId) continue;
        const myEff = myTroops * valueAs(state, me, f.unit, POSTURE.DEFEND, x);
        if (myEff * 1000 >= effOf(state, g) * ctx.k.counterMarginPermille) {
          if (!retarget(ctx, f, x)) continue; // v4.5: 적 땅 너머 반격 칸은 건너뛴다
          moved = true;
          break;
        }
      }
      if (moved) continue;
    }
    const calm = !threatened(state, f);
    // 8.2 주둔 해제: 3분 무위협 → 회수
    if (calm && f.calmTicks >= BOT_GARRISON_PATIENCE) {
      recall(ctx, f);
      continue;
    }
    // 8.6.0 1. 제자리 반격: 위협 0, 병력 ≥ 70%, 쿨타임 없음 → ATTACK (최소 방어선 유지될 때)
    // v4.2: 공격 = 깃발 옆 칸 → 지금 서 있는 칸 옆에 적 플레이어 칸이 있을 때만 (중립 확장은 공격 발령으로)
    if (calm && f.troopsMilli * 1000 >= f.initialTroops * 1000 * BOT_COUNTERATTACK_TROOPS_PERMILLE && canPosture(ctx, f) && defendCount(ctx) - 1 >= minDefense(ctx)) {
      let enemyAdj = false;
      for (const n of state.graph.neighbors(f.posTileId)) if (isClaimable(state.map.terrain[n]) && hostilePlayer(state, me, state.owners[n])) enemyAdj = true;
      if (enemyAdj) posture(ctx, f, POSTURE.ATTACK);
    }
  }
}

/** 8.6.0 2. 차단 쓰기 — 내 땅을 노리는 적 행군 깃발의 경로(직선 근사) 위 내 언덕·산 칸에 창병 */
function block(ctx: Ctx): void {
  const { state, me } = ctx;
  if (ctx.cap - ctx.slots < 2) return;
  for (const g of state.flags) {
    if (g.state !== 'MARCHING' || g.posture !== POSTURE.ATTACK || g.routed || !hostilePlayer(state, me, g.ownerId)) continue;
    if (state.owners[g.anchorTileId] !== me && g.targetOwnerId !== me) continue;
    const dTotal = state.graph.distance(g.posTileId, g.anchorTileId);
    // 경로 근사: 앵커까지 거리가 줄어드는 내 언덕·산 칸 (g 와 거리 2..6, 앵커 쪽)
    let pick = -1;
    for (const x of state.graph.disk(g.posTileId, 6)) {
      const ter = state.map.terrain[x];
      if (state.owners[x] !== me || (ter !== TERRAIN.HILLS && ter !== TERRAIN.MOUNTAIN)) continue;
      const dg = state.graph.distance(x, g.posTileId);
      if (dg < 2 || state.graph.touching(x, g.posTileId) || state.graph.distance(x, g.anchorTileId) + dg !== dTotal) continue; // 이미 접촉(대각선)인 칸 제외
      if (ctx.plannedDefend.includes(x)) continue;
      pick = x;
      break;
    }
    if (pick < 0) continue;
    const vU = valueAs(state, me, UNIT.SPEAR, POSTURE.DEFEND, pick);
    const need = Math.max(FLAG_MIN_TROOPS, Math.ceil((Math.floor(g.troopsMilli / 1000) * BOT_INTERCEPT_RATIO_PERMILLE * flagValue(state, g, [g])) / (vU * 1000)));
    if (need > maxIssuable(ctx.p, ctx.pool, UNIT.SPEAR)) continue;
    if (!issue(ctx, UNIT.SPEAR, need, pick)) continue; // v4.5: 적 땅 너머 차단 칸
    ctx.plannedDefend.push(pick);
    return; // 결정당 1회
  }
}

/** 소진 경계 (milli): FLAG_MIN_TROOPS + 쌓인 예산(한 번에 쓸 수 있음) + tick 당 예산 누적 × BOT_EXHAUST_MARGIN_TICKS */
function exhaustLine(ctx: Ctx, f: Readonly<Flag>): number {
  return FLAG_MIN_TROOPS * 1000 + f.spendBudgetMilli + f.initialTroops * FLAG_SPEND_RATE_PERMILLE * BOT_EXHAUST_MARGIN_TICKS;
}

/**
 * 소진 직전 회수가 이득인가: 회수 손실(경계 병력 × 15%)이 소진 손실 상한(FLAG_MIN_TROOPS)의 절반 미만일 때만.
 * 큰 깃발은 경계가 높아(예산 누적이 커서) 일찍 회수하면 손실·귀환 슬롯 점유가 소진(≤ 40)보다 크다.
 */
function preRecallPays(ctx: Ctx, f: Readonly<Flag>): boolean {
  return exhaustLine(ctx, f) * (1000 - FLAG_RECALL_REFUND_PERMILLE) < (FLAG_MIN_TROOPS / 2) * 1000 * 1000;
}

function minAttack(ctx: Ctx, reserve: number): number {
  return Math.max(2 * FLAG_MIN_TROOPS, Math.min(BOT_MIN_ATTACK_MULT * FLAG_MIN_TROOPS, troopCap(ctx.p) - reserve - FLAG_MIN_TROOPS / 2));
}

/**
 * GDD 에 없어 정함 (§10) — 슬롯 재활용: 슬롯이 꽉 찼는데 풀이 크게 남으면(새 깃발 예상 병력 ≥ 약한 깃발 × 4)
 * 가장 약한 비전투 깃발(공격, 또는 위협 없는 방어) 하나를 회수해 큰 깃발로 바꿀 자리를 만든다. 결정당 1회.
 */
export const BOT_RECYCLE_RATIO = 4;
function recycle(ctx: Ctx): void {
  const { state, p, params } = ctx;
  if (ctx.slots < ctx.cap) return;
  const reserve = Math.floor((troopCap(p) * ctx.k.reserveRatioPermille) / 1000);
  const newQ = Math.min(Math.floor((ctx.pool * BOT_COMMIT_ENEMY_PERMILLE) / 1000), ctx.pool - reserve);
  if (newQ < 2 * minAttack(ctx, reserve)) return;
  let weak: Flag | null = null;
  for (const f of ctx.mine) {
    if (!isLive(f) || f.inCombat || f.disengageUntilTick !== null || ctx.touched.has(f.id)) continue;
    if (f.posture === POSTURE.DEFEND && threatened(state, f)) continue;
    if (isBaseGuard(ctx, f) && baseThreatNear(ctx, f.anchorTileId)) continue; // v4.4: 위협받는 기지 수비대는 재활용 안 함
    // v4.2 (§10): 쟁기 중(정지 점령·앵커 점령)이거나 노선으로 가는 공격 깃발은 회수하지 않는다 — 병력이 땅으로 바뀌는 중이다
    if (f.posture === POSTURE.ATTACK && f.state !== 'IDLE') continue;
    if (Math.floor(f.troopsMilli / 1000) * BOT_RECYCLE_RATIO > newQ) continue;
    if (!weak || f.troopsMilli < weak.troopsMilli) weak = f;
  }
  if (weak) recall(ctx, weak);
}

/** 8.2 (3) 빈 슬롯 채우기 */
function fill(ctx: Ctx): void {
  const { state, me, p, params } = ctx;
  const reserve = Math.floor((troopCap(p) * ctx.k.reserveRatioPermille) / 1000);
  let minDefDone = false;
  while (ctx.slots < ctx.cap) {
    if (ctx.pool - reserve < FLAG_MIN_TROOPS) break;
    scanBorder(ctx);
    if (!minDefDone && defendCount(ctx) * 1000 < ctx.cap * ctx.k.minDefenseRatioPermille && ctx.hostileBorder) {
      minDefDone = true;
      // 최소 방어선: 내 국경 칸 중 (거리 ≤ 2 의 적 칸 수 최대, tileId 최소), 기존 방어 관할 원 밖
      let h = -1;
      let hn = 0;
      const border = ctx.border!;
      const mineEdge = new Set<number>();
      for (const [o, tiles] of border) {
        if (o === NEUTRAL) continue;
        for (const x of tiles) for (const n of state.graph.neighbors(x)) if (state.owners[n] === me) mineEdge.add(n);
      }
      for (const x of [...mineEdge].sort((a, b) => a - b)) {
        if (!isClaimable(state.map.terrain[x])) continue;
        if (ctx.plannedDefend.some((a) => state.graph.distance(a, x) <= FRONT_RADIUS)) continue;
        if (ctx.mine.some((f) => isLive(f) && f.posture === POSTURE.DEFEND && state.graph.distance(f.anchorTileId, x) <= FRONT_RADIUS)) continue;
        let k = 0;
        for (const y of state.graph.disk(x, 2)) if (hostilePlayer(state, me, state.owners[y])) k++;
        if (k > hn) {
          h = x;
          hn = k;
        }
      }
      if (h >= 0) {
        const q = Math.min(Math.max(Math.floor((ctx.pool * BOT_DEFEND_COMMIT_PERMILLE) / 1000), FLAG_MIN_TROOPS), ctx.pool - reserve, maxIssuable(p, ctx.pool, UNIT.SPEAR));
        if (q >= FLAG_MIN_TROOPS && issue(ctx, UNIT.SPEAR, q, h)) {
          ctx.plannedDefend.push(h);
          continue;
        }
      }
    }
    const minQ = minAttack(ctx, reserve);
    if (ctx.pool - reserve < minQ) break;
    const a = bestAnchor(ctx);
    if (!a) break;
    let unit = chooseUnit(ctx, a);
    const commit = a.kind === 0 ? BOT_COMMIT_NEUTRAL_PERMILLE : a.base ? BOT_COMMIT_BASE_PERMILLE : BOT_COMMIT_ENEMY_PERMILLE;
    let q = Math.min(Math.max(Math.floor((ctx.pool * commit) / 1000), minQ), ctx.pool - reserve);
    q = Math.min(q, maxIssuable(p, ctx.pool, unit));
    if (q < minQ && unit === UNIT.CAVALRY) {
      unit = UNIT.SWORD;
      q = Math.min(Math.max(Math.floor((ctx.pool * commit) / 1000), minQ), ctx.pool - reserve, maxIssuable(p, ctx.pool, unit));
    }
    if (q < minQ) break;
    issue(ctx, unit, q, a.tileId);
    ctx.plannedAttack.push([a.owner, a.tileId]);
  }
}

export function decideBot(state: Readonly<GameState>, me: number, t: number, params: Readonly<BotDifficultyParams>): C2S_GameCommand[] {
  const p = state.players[me];
  if (!p || !p.alive) return [];
  const mine = state.flags.filter((f) => f.ownerId === me);
  const ctx: Ctx = {
    state,
    me,
    p,
    t,
    params,
    k: botKnobs(params),
    cmds: [],
    touched: new Set(),
    pool: Math.floor(p.troopsMilli / 1000),
    slots: mine.length,
    cap: flagCap(p),
    mine,
    plannedAttack: [],
    plannedDefend: [],
    border: null,
    hostileBorder: false,
    terrDist: null,
    selfFlagId: -1,
  };
  diplomacy(ctx);
  buyTech(ctx);
  guardBases(ctx); // v4.4: 기지 수비 (마지막 기지 우선) — 요격보다 먼저
  defend(ctx);
  maintain(ctx);
  block(ctx);
  recycle(ctx);
  fill(ctx);
  return ctx.cmds;
}

/** 3차 봇 (GDD 8장). 무상태 — 룸 여러 개가 공유해도 된다 */
export const CivBot: BotBrain = { decide: decideBot };
