/**
 * 봇 AI (GDD 8장 v3.0 + 8.6 / 8.6.0 v4.0 + v4.1 [A-43] 요격 전용 방어, 2.8 g 난이도 레버).
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
  BOT_BASE_THREAT_W,
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
  BOT_RETREAT_RATIO_PERMILLE,
  BOT_STALL_SWITCH_PERMILLE,
  BOT_THREAT_LOOKAHEAD,
  BOT_THREAT_TRIGGER,
  COMBAT_LOSS_BP,
  DISENGAGE_TICKS,
  DISENGAGE_VALUE_PERMILLE,
  FLAG_MIN_TROOPS,
  FLAG_RECALL_REFUND_PERMILLE,
  FLAG_SPEND_RATE_PERMILLE,
  FRONT_MAX_RANGE,
  FRONT_RADIUS,
  MAX_ALLIES_PER_PLAYER,
  MOB_CONVERT_PERMILLE_BY_TIER,
  POSTURE,
  TECH_AXIS,
  TECH_AXIS_COUNT,
  TECH_MAX_TIER,
  TERRAIN,
  UNIT,
  UNIT_CONVERT_PERMILLE,
  isClaimable,
  type BotDifficultyParams,
  type C2S_GameCommand,
  type Posture,
  type TechAxis,
  type Unit,
} from '@civwar/shared';
import { flagValue } from './combat.js';
import { flagCap, techCost, troopCap } from './economy.js';
import { forEachFront, guardContains, maxProgress, mobilityTier, threatened, tileCost } from './rules.js';
import { NEUTRAL, isAlly, type Flag, type GameState, type PlayerState } from './state.js';
import type { BotBrain } from './tick.js';

/** 봇 파기 판단 시각 (8.5 외교 "t > 7500 tick") — GDD 본문 값, 부록 A 에 상수명 없음 */
export const BOT_BREAK_AFTER_TICK = 7500;
/** 8.5 외교 수락 "제안자 타일 ≥ 내 타일 × 1.2" / 파기 "내 타일 ≥ 동맹 타일 × 2.0" */
export const BOT_ALLY_ACCEPT_PERMILLE = 1200;
export const BOT_ALLY_BREAK_PERMILLE = 2000;
/** 8.4 "먼 전선" 기준 거리 */
export const BOT_FAR_FRONT_DIST = 12;
/** 8.6 상륙 후보 점수 ×0.8, 상륙 탐색 반경(얕은 물 칸 수) — 반경은 GDD 에 없어 정함 */
export const BOT_LANDING_SCORE_PERMILLE = 800;
export const BOT_LANDING_MAX_WATER = 12;
/** 8.6.0 1. 태세 — 제자리 반격 / 굳히기 임계 */
export const BOT_COUNTERATTACK_TROOPS_PERMILLE = 700;
export const BOT_CONSOLIDATE_TROOPS_PERMILLE = 400;
/**
 * GDD 에 없어 정함 (§10): 공격 깃발 최소 병력. 40 근처 깃발은 몇 AP 쓰고 소진(잔여 전액 소멸)되어 순손실만 낸다.
 * 3 × FLAG_MIN_TROOPS (8.6.0 후퇴의 "잔여 ≥ FLAG_MIN_TROOPS × 3" 과 같은 눈금). cap−reserve 가 작은 소국은 2 × 까지 낮춘다.
 */
export const BOT_MIN_ATTACK_MULT = 3;
/** GDD 에 없어 정함 (§10): 소진 직전 회수 여유 tick (경계 = 40 + 쌓인 예산 + 누적률 × 이 값). 결정 주기 전체를 여유로 잡으면 큰 깃발을 너무 일찍 물려 손해(자가대전 측정) */
export const BOT_EXHAUST_MARGIN_TICKS = 2;

/** 8.5 테크 우선순위 [botIndex % 4] — (축, 단계) */
const M = TECH_AXIS.MILITARY;
const E = TECH_AXIS.ECONOMY;
const T = TECH_AXIS.TERRITORY;
const B = TECH_AXIS.MOBILITY;
export const TECH_PRIORITY: readonly (readonly (readonly [TechAxis, number])[])[] = [
  [[T, 1], [E, 1], [B, 1], [T, 2], [M, 1], [M, 2]], // 0 확장형
  [[E, 1], [E, 2], [T, 1], [B, 1], [E, 3], [M, 1]], // 1 경제형
  [[M, 1], [B, 2], [T, 1], [M, 2], [E, 1], [M, 3]], // 2 수비형
  [[B, 1], [B, 2], [M, 1], [E, 1], [B, 3], [M, 2]], // 3 기동형
];

interface Anchor {
  tileId: number;
  owner: number;
  kind: 0 | 1; // 0 NEUTRAL, 1 ENEMY
  score: number;
  landing: boolean;
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
  /** 상륙 후보 (기동 T2+) 소유자별 */
  landing: Map<number, number[]> | null;
  hostileBorder: boolean;
}

// ───────────────────────── 공용 헬퍼 ─────────────────────────

const isLive = (f: Readonly<Flag>): boolean => !f.routed && f.state !== 'RETURNING' && f.troopsMilli > 0;

function hostilePlayer(state: Readonly<GameState>, me: number, o: number): boolean {
  return o !== NEUTRAL && o !== me && !isAlly(state, me, o);
}

/** 가상 깃발의 실효 전투값 (4.15 d·e) — flagValue 를 그대로 쓴다 */
function valueAs(state: Readonly<GameState>, ownerId: number, unit: Unit, posture: Posture, tile: number): number {
  const fake = { ownerId, unit, posture, posTileId: tile, disengageUntilTick: null } as unknown as Flag;
  return flagValue(state, fake, []);
}

/** 실효 전투력 = 병력 × v (4.15 d: 편 손실은 1/v 비례 → 버티는 시간 ∝ 병력 × v) */
function effOf(state: Readonly<GameState>, f: Readonly<Flag>): number {
  return Math.floor(f.troopsMilli / 1000) * flagValue(state, f, [f]);
}

/** 발령 가능 최대 병력 (풀 비용 = ceil(q × UNIT_CONVERT / 기동 환산효율)) */
function maxIssuable(p: Readonly<PlayerState>, pool: number, unit: Unit): number {
  const eff = MOB_CONVERT_PERMILLE_BY_TIER[mobilityTier(p)];
  let q = Math.floor((pool * eff) / UNIT_CONVERT_PERMILLE[unit]);
  while (q > 0 && Math.ceil((q * UNIT_CONVERT_PERMILLE[unit]) / eff) > pool) q--;
  return q;
}

function poolCostOf(p: Readonly<PlayerState>, q: number, unit: Unit): number {
  return Math.ceil((q * UNIT_CONVERT_PERMILLE[unit]) / MOB_CONVERT_PERMILLE_BY_TIER[mobilityTier(p)]);
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

function frontSize(state: Readonly<GameState>, f: Readonly<Flag>): number {
  let k = 0;
  forEachFront(state, f, () => {
    k++;
  });
  return k;
}

// ───────────────────────── 명령 발행 ─────────────────────────

function push(ctx: Ctx, cmd: C2S_GameCommand): void {
  ctx.cmds.push(cmd);
}
const seq = (ctx: Ctx): number => ctx.t * 64 + ctx.cmds.length + 1;

function issue(ctx: Ctx, unit: Unit, troops: number, anchor: number): void {
  push(ctx, { type: 'cmd_flag_issue', clientSeq: seq(ctx), unit, troops, anchorTileId: anchor, originBaseTileId: null });
  ctx.pool -= poolCostOf(ctx.p, troops, unit);
  ctx.slots += 1;
}
function retarget(ctx: Ctx, f: Readonly<Flag>, anchor: number): void {
  push(ctx, { type: 'cmd_flag_retarget', clientSeq: seq(ctx), flagId: f.id, anchorTileId: anchor });
  ctx.touched.add(f.id);
}
function recall(ctx: Ctx, f: Readonly<Flag>): void {
  push(ctx, { type: 'cmd_flag_recall', clientSeq: seq(ctx), flagId: f.id });
  ctx.touched.add(f.id);
}
function posture(ctx: Ctx, f: Readonly<Flag>, to: Posture): void {
  push(ctx, { type: 'cmd_set_posture', clientSeq: seq(ctx), flagId: f.id, posture: to });
  ctx.touched.add(f.id);
}

/** 다음 tick 1단계에서 적용되므로 t+1 기준으로 경직·쿨타임을 본다 */
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

/**
 * 8.6 상륙 후보 (기동 T2+): 내 해안에서 얕은 물만 밟아 BOT_LANDING_MAX_WATER 칸 안에 닿는 비내 육지 중
 * 내 땅과 인접하지 않은 칸. 주변(거리 ≤ 2)에 적 깃발이 있으면 제외(경로 위협 0인 해안).
 */
function scanLanding(ctx: Ctx): Map<number, number[]> {
  if (ctx.landing) return ctx.landing;
  const res = new Map<number, number[]>();
  ctx.landing = res;
  const { state, me } = ctx;
  if (mobilityTier(ctx.p) < 2) return res;
  const owners = state.owners;
  const terrain = state.map.terrain;
  const n = owners.length;
  const depth = new Int16Array(n).fill(-1);
  const q: number[] = [];
  for (let t = 0; t < n; t++) {
    if (terrain[t] !== TERRAIN.SHALLOW) continue;
    for (const x of state.graph.neighbors(t))
      if (owners[x] === me) {
        depth[t] = 1;
        q.push(t);
        break;
      }
  }
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    if (depth[u] >= BOT_LANDING_MAX_WATER) continue;
    for (const v of state.graph.neighbors(u)) {
      if (terrain[v] !== TERRAIN.SHALLOW || depth[v] >= 0) continue;
      depth[v] = depth[u] + 1;
      q.push(v);
    }
  }
  const enemyPos = new Set<number>();
  for (const g of state.flags) if (!g.routed && hostilePlayer(state, me, g.ownerId)) for (const x of state.graph.disk(g.posTileId, 2)) enemyPos.add(x);
  const seen = new Uint8Array(n);
  for (const u of q) {
    for (const t of state.graph.neighbors(u)) {
      if (seen[t] || !isClaimable(terrain[t])) continue;
      seen[t] = 1;
      const o = owners[t];
      if (o === me || isAlly(state, me, o) || enemyPos.has(t)) continue;
      let adjMine = false;
      for (const x of state.graph.neighbors(t)) if (owners[x] === me) adjMine = true;
      if (adjMine) continue;
      let arr = res.get(o);
      if (!arr) res.set(o, (arr = []));
      arr.push(t);
    }
  }
  for (const arr of res.values()) arr.sort((a, b) => a - b);
  return res;
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
    if (g.ownerId === me || g.routed || g.posture !== POSTURE.ATTACK || g.state !== 'ENGAGED' || g.targetTileId === null) continue;
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

/** 요격 앵커: 위협 깃발 e 에 거리 1(없으면 2) 인 내 땅 칸 중 (거리, tileId) 최소. 없으면 e 의 타깃 칸 */
function interceptTile(ctx: Ctx, e: Readonly<Flag>): number {
  const { state, me } = ctx;
  for (const r of [1, 2]) {
    for (const x of state.graph.disk(e.posTileId, r)) {
      if (state.owners[x] === me && isClaimable(state.map.terrain[x]) && state.graph.distance(x, e.posTileId) === r) return x;
    }
  }
  return e.targetTileId!;
}

// ───────────────────────── 8.3 앵커 선택 ─────────────────────────

function scoreAnchor(ctx: Ctx, o: number, anchor: number, adjMinTiles: number, from = -1): number {
  const { state, me, p, t } = ctx;
  let mass = 0;
  for (const x of state.graph.disk(anchor, FRONT_RADIUS)) if (state.owners[x] === o && isClaimable(state.map.terrain[x])) mass++;
  const cost = tileCost(state, pseudoAttack(me, UNIT.SWORD, anchor, o), anchor);
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

/** from = 재지정할 깃발의 현재 위치 (발령이면 -1 → 기지 출발 originFor) */
function bestAnchor(ctx: Ctx, excludeOwner = -1, from = -1): Anchor | null {
  const { state, me, p } = ctx;
  const border = scanBorder(ctx);
  const landing = scanLanding(ctx);
  // 소유자별 내 공격 깃발 수 + 공격 앵커 (계획 포함)
  const targeted = new Map<number, number>();
  const anchors: [number, number][] = [...ctx.plannedAttack];
  for (const f of ctx.mine) {
    if (!isLive(f) || f.posture !== POSTURE.ATTACK) continue;
    targeted.set(f.targetOwnerId, (targeted.get(f.targetOwnerId) ?? 0) + 1);
    anchors.push([f.targetOwnerId, f.anchorTileId]);
  }
  for (const [o] of ctx.plannedAttack) targeted.set(o, (targeted.get(o) ?? 0) + 1);
  let adjMinTiles = Infinity;
  for (const o of border.keys()) if (o !== NEUTRAL) adjMinTiles = Math.min(adjMinTiles, state.players[o].tiles);

  const owners = [...new Set([...border.keys(), ...landing.keys()])].sort((a, b) => a - b);
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
        const c = tileCost(state, pseudoAttack(me, UNIT.SWORD, x, o), x);
        if (c < ac) {
          a = x;
          ac = c;
        }
      }
      return a;
    };
    const cands: [number, boolean][] = [];
    const a1 = pick(border.get(o));
    if (a1 >= 0) cands.push([a1, false]);
    const a2 = pick(landing.get(o));
    if (a2 >= 0 && state.graph.distance(a2, originFor(state, p, a2)) <= FRONT_MAX_RANGE) cands.push([a2, true]);
    for (const [a, landingCand] of cands) {
      let score = scoreAnchor(ctx, o, a, adjMinTiles, from);
      if (landingCand) score = Math.floor((score * BOT_LANDING_SCORE_PERMILLE) / 1000);
      // 8.6 회피 (근사)
      const danger = anchorDanger(ctx, a);
      if (danger > 0) {
        const q = Math.floor((ctx.pool * commitPm(o)) / 1000);
        const mine = q * valueAs(state, me, UNIT.SWORD, POSTURE.ATTACK, a);
        if (mine * 1000 < danger * BOT_AVOID_RATIO_PERMILLE) continue;
      }
      if (!best || score > best.score || (score === best.score && o < best.owner)) {
        best = { tileId: a, owner: o, kind: o === NEUTRAL ? 0 : 1, score, landing: landingCand };
      }
    }
  }
  return best;
}

/** 8.2 currentScore(f) — 현재 앵커를 같은 식으로 평가 */
function currentScore(ctx: Ctx, f: Readonly<Flag>): number {
  const border = scanBorder(ctx);
  let adjMinTiles = Infinity;
  for (const o of border.keys()) if (o !== NEUTRAL) adjMinTiles = Math.min(adjMinTiles, ctx.state.players[o].tiles);
  const o = f.targetOwnerId === ANY_HOSTILE ? ctx.state.owners[f.anchorTileId] : f.targetOwnerId;
  return scoreAnchor(ctx, o, f.anchorTileId, adjMinTiles, f.posTileId);
}

// ───────────────────────── 8.4 병종 ─────────────────────────

function chooseUnit(ctx: Ctx, a: Anchor): Unit {
  if (ctx.params.fixedUnit !== null) return ctx.params.fixedUnit as Unit;
  const { state, p } = ctx;
  if (a.kind === 0) return UNIT.CAVALRY;
  if (state.map.isBase[a.tileId]) return UNIT.CAVALRY;
  if (state.graph.distance(originFor(state, p, a.tileId), a.tileId) > BOT_FAR_FRONT_DIST) return UNIT.CAVALRY;
  let guard = 0;
  let enemyDefend = 0;
  for (const d of state.flags) {
    if (d.ownerId !== a.owner || d.posture !== POSTURE.DEFEND || !isLive(d)) continue;
    enemyDefend++;
    if (guardContains(state, d, a.tileId)) guard++;
  }
  if (guard >= 1) return UNIT.SWORD;
  if (enemyDefend === 0) return UNIT.CAVALRY;
  return UNIT.SWORD;
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

function buyTech(ctx: Ctx): void {
  const p = ctx.p;
  const order = TECH_PRIORITY[(ctx.me - 1) % 4];
  let next: [number, number] | null = null;
  for (const [axis, tier] of order) {
    if (p.tech[axis] < tier) {
      next = [axis, p.tech[axis] + 1]; // 선행 단계가 비었으면 그것부터 (TECH_ORDER 방지)
      break;
    }
  }
  if (!next) {
    // 목록 소진 후: (단계, 축) 오름차순으로 남은 노드
    for (let tier = 1; tier <= TECH_MAX_TIER && !next; tier++)
      for (let axis = 0; axis < TECH_AXIS_COUNT && !next; axis++) if (p.tech[axis] === tier - 1) next = [axis, tier];
  }
  if (!next) return;
  if (p.goldMilli >= techCost(next[1], p.techPurchased) * 1000) {
    push(ctx, { type: 'cmd_buy_tech', clientSeq: seq(ctx), axis: next[0] as TechAxis, tier: next[1] as 1 | 2 | 3 });
  }
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
        if (f.posture !== POSTURE.DEFEND || f.inCombat || ctx.touched.has(f.id) || !canRetarget(ctx, f)) continue;
        const d = state.graph.distance(f.posTileId, anchor);
        if (d > 2 * FRONT_RADIUS || d >= pd) continue;
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
        issue(ctx, u, q, anchor);
        ctx.plannedDefend.push(anchor);
        return;
      }
    }
    // 슬롯이 없거나 병력 부족 → 가장 가치 낮은 공격 깃발을 방어로 돌린다
    if (h * 1000 >= BOT_THREAT_TRIGGER * BOT_PREEMPT_FACTOR_PERMILLE) {
      let victim: Flag | null = null;
      let vg = Infinity;
      for (const f of ctx.mine) {
        // expectedGain = 남은 front 크기 — 행군 중 깃발은 아직 front 가 없으므로 ENGAGED 만 후보 (§10)
        if (f.posture !== POSTURE.ATTACK || f.state !== 'ENGAGED' || f.inCombat || ctx.touched.has(f.id) || !canRetarget(ctx, f)) continue;
        const g = frontSize(state, f);
        if (g < vg) {
          victim = f;
          vg = g;
        }
      }
      if (victim) {
        retarget(ctx, victim, anchor);
        ctx.plannedDefend.push(anchor);
      }
    }
    return; // 결정 tick 당 방어 전환 1회
  }
}

/** 전투 상대 (거리 ≤ 1, 적대, 둘 중 하나 ATTACK) */
function combatFoes(ctx: Ctx, f: Readonly<Flag>): Flag[] {
  const { state, me } = ctx;
  const res: Flag[] = [];
  for (const g of state.flags) {
    if (g.routed || g.troopsMilli <= 0 || g.breakaway || !hostilePlayer(state, me, g.ownerId)) continue;
    if (f.posture !== POSTURE.ATTACK && g.posture !== POSTURE.ATTACK) continue;
    if (state.graph.distance(g.posTileId, f.posTileId) <= 1) res.push(g);
  }
  return res;
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
        const myLoss = Math.floor((2 * L * invMe) / (invMe + invE)) * DISENGAGE_TICKS;
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
      for (const g of state.flags) if (!g.routed && hostilePlayer(state, me, g.ownerId) && state.graph.distance(g.posTileId, f.posTileId) <= 1) bEff += effOf(state, g);
      const myEff = myTroops * valueAs(state, me, f.unit, POSTURE.ATTACK, f.posTileId);
      if (bEff * 1000 <= myEff * ctx.k.blockAttackRatioPermille && f.posture !== POSTURE.ATTACK && canPosture(ctx, f)) {
        posture(ctx, f, POSTURE.ATTACK);
        continue;
      }
      if (canRetarget(ctx, f)) {
        const a = f.posture === POSTURE.ATTACK ? bestAnchor(ctx, state.owners[f.anchorTileId], f.posTileId) : null;
        if (a && a.tileId !== f.anchorTileId) {
          retarget(ctx, f, a.tileId);
          ctx.plannedAttack.push([a.owner, a.tileId]);
        } else recall(ctx, f);
        continue;
      }
    }

    // ── 8.2 IDLE ──
    if (f.state === 'IDLE') {
      if (!canRetarget(ctx, f)) continue;
      const a = bestAnchor(ctx, -1, f.posTileId);
      if (a) {
        retarget(ctx, f, a.tileId);
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
      // 소진 직전 회수 (§10 — 소진은 잔여 전액 소멸, 회수는 85% 환급)
      if (f.state === 'ENGAGED' && f.troopsMilli < exhaustLine(ctx, f) && preRecallPays(ctx, f)) {
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
          const a = bestAnchor(ctx, -1, f.posTileId);
          if (a && a.tileId !== f.anchorTileId && a.score * 1000 > currentScore(ctx, f) * BOT_STALL_SWITCH_PERMILLE) {
            retarget(ctx, f, a.tileId);
            ctx.plannedAttack.push([a.owner, a.tileId]);
          } else recall(ctx, f);
          continue;
        }
      }
      if (f.state === 'ENGAGED' && canRetarget(ctx, f) && frontSize(state, f) < 2) {
        const a = bestAnchor(ctx, -1, f.posTileId);
        if (a && a.tileId !== f.anchorTileId) {
          retarget(ctx, f, a.tileId);
          ctx.plannedAttack.push([a.owner, a.tileId]);
        }
      }
      continue;
    }

    // DEFEND
    if (f.state !== 'ENGAGED' || anchorOwner !== me) continue;
    // 8.6.0 1. 주둔 반격: 적 공격 깃발이 관할 원 국경 칸 옆에 붙음 + 내 실효력 ≥ 적 × 1.2 → 그 칸으로 재지정
    if (canRetarget(ctx, f)) {
      let moved = false;
      for (const g of state.flags) {
        if (g.posture !== POSTURE.ATTACK || g.routed || !hostilePlayer(state, me, g.ownerId)) continue;
        if (state.graph.distance(g.posTileId, f.posTileId) <= 1) continue;
        if (state.graph.distance(g.posTileId, f.anchorTileId) > FRONT_RADIUS + 1) continue;
        let x = -1;
        for (const n of state.graph.disk(g.posTileId, 1)) {
          if (state.owners[n] === me && isClaimable(state.map.terrain[n]) && state.graph.distance(n, f.anchorTileId) <= FRONT_RADIUS) {
            x = n;
            break;
          }
        }
        if (x < 0 || x === f.anchorTileId) continue;
        const myEff = myTroops * valueAs(state, me, f.unit, POSTURE.DEFEND, x);
        if (myEff * 1000 >= effOf(state, g) * ctx.k.counterMarginPermille) {
          retarget(ctx, f, x);
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
    // 8.6.0 1. 제자리 반격: 위협 0, 병력 ≥ 70%, 쿨타임 없음 → ATTACK (공격할 적 땅이 있고 최소 방어선 유지될 때)
    if (calm && f.troopsMilli * 1000 >= f.initialTroops * 1000 * BOT_COUNTERATTACK_TROOPS_PERMILLE && canPosture(ctx, f) && defendCount(ctx) - 1 >= minDefense(ctx)) {
      if (frontSize(state, pseudoAttack(me, f.unit, f.anchorTileId, ANY_HOSTILE)) > 0) {
        posture(ctx, f, POSTURE.ATTACK);
      }
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
      if (dg < 2 || state.graph.distance(x, g.anchorTileId) + dg !== dTotal) continue;
      if (ctx.plannedDefend.includes(x)) continue;
      pick = x;
      break;
    }
    if (pick < 0) continue;
    const vU = valueAs(state, me, UNIT.SPEAR, POSTURE.DEFEND, pick);
    const need = Math.max(FLAG_MIN_TROOPS, Math.ceil((Math.floor(g.troopsMilli / 1000) * BOT_INTERCEPT_RATIO_PERMILLE * flagValue(state, g, [g])) / (vU * 1000)));
    if (need > maxIssuable(ctx.p, ctx.pool, UNIT.SPEAR)) continue;
    issue(ctx, UNIT.SPEAR, need, pick);
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
        if (q >= FLAG_MIN_TROOPS) {
          issue(ctx, UNIT.SPEAR, q, h);
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
    const commit = a.kind === 0 ? BOT_COMMIT_NEUTRAL_PERMILLE : BOT_COMMIT_ENEMY_PERMILLE;
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
    landing: null,
    hostileBorder: false,
  };
  diplomacy(ctx);
  buyTech(ctx);
  defend(ctx);
  maintain(ctx);
  block(ctx);
  recycle(ctx);
  fill(ctx);
  return ctx.cmds;
}

/** 3차 봇 (GDD 8장). 무상태 — 룸 여러 개가 공유해도 된다 */
export const CivBot: BotBrain = { decide: decideBot };
