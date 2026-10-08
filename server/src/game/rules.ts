/**
 * 깃발 규칙의 순수 함수 모음 (GDD 4.1 / 4.4 / 4.6 / 4.7). 상태를 쓰지 않는다 — Phase A 에서 안전.
 *
 * 정수 규칙: 비용 산출은 micro(1e-6) 고정소수점으로 곱셈마다 floor, 마지막에 ceil.
 * (GDD 의 실수 곱 후 ceil 과 같은 값을 내며, 차이는 중간 floor 의 1e-6 미만 절사뿐 — 프로토콜 §10)
 */
import {
  ADJACENCY_COEF_PERMILLE,
  ANY_HOSTILE,
  DEFENSE_LEVERAGE_PERMILLE,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENEMY_BASE,
  FLAG_SPEED_BASE_MILLI,
  FLAG_TILE_RATE_BASE,
  FRONT_RADIUS,
  MIL_ATK_COST_PERMILLE_BY_TIER,
  MIL_DEF_COST_PERMILLE_BY_TIER,
  MIN_TILE_COST,
  MOB_SPEED_PERMILLE_BY_TIER,
  NEUTRAL_BASE,
  NEUTRAL_SQRT_COEF_PERMILLE,
  SHALLOW_MOVE_PERMILLE_BY_TIER,
  SHALLOW_MOVE_PERMILLE_MIN,
  SUPPLY_COEF_PERMILLE,
  SUPPLY_FREE_RADIUS,
  SUPPLY_MAX_MULT_PERMILLE,
  SUPPLY_NO_BASE_DIST,
  TECH_AXIS,
  TER_NEUTRAL_COST_PERMILLE_BY_TIER,
  TERRAIN,
  TERRAIN_COST_PERMILLE,
  TERRAIN_MOVE_PERMILLE,
  UNIT_ASSAULT_PERMILLE,
  UNIT_ATK_MULT_PERMILLE,
  UNIT_DEF_PUSH_PERMILLE,
  UNIT_SPEED_PERMILLE,
  isClaimable,
} from '@civwar/shared';
import { isqrt } from './economy.js';
import { NEUTRAL, isAlly, type Flag, type GameState, type PlayerState } from './state.js';

const MICRO = 1_000_000;

export const mobilityTier = (p: Readonly<PlayerState>): number => p.tech[TECH_AXIS.MOBILITY];
export const militaryTier = (p: Readonly<PlayerState>): number => p.tech[TECH_AXIS.MILITARY];

export function claimable(state: Readonly<GameState>, t: number): boolean {
  return isClaimable(state.map.terrain[t]);
}

// ───────────────────────── front / guard (4.1, 4.15 i) ─────────────────────────

/** targetMatch — 내 땅·동맹(ACTIVE/BREAKING)은 언제나 제외 (4.10 표 "동맹") */
export function targetMatch(state: Readonly<GameState>, f: Readonly<Flag>, o: number): boolean {
  if (o === f.ownerId) return false;
  if (f.targetOwnerId === ANY_HOSTILE) return o !== NEUTRAL && !isAlly(state, f.ownerId, o);
  return o === f.targetOwnerId && !isAlly(state, f.ownerId, o);
}

function hasOwnNeighbor(state: Readonly<GameState>, t: number, ownerId: number): boolean {
  for (const n of state.graph.neighbors(t)) if (state.owners[n] === ownerId) return true;
  return false;
}

function inMainFront(state: Readonly<GameState>, f: Readonly<Flag>, t: number): boolean {
  return (
    claimable(state, t) &&
    targetMatch(state, f, state.owners[t]) &&
    state.graph.distance(t, f.anchorTileId) <= FRONT_RADIUS &&
    hasOwnNeighbor(state, t, f.ownerId)
  );
}

/** front(f) 의 원소를 tileId 오름차순(디스크) → 해안 교두보 순으로 방문. 중복 없음 */
export function forEachFront(state: Readonly<GameState>, f: Readonly<Flag>, cb: (t: number) => boolean | void): void {
  for (const t of state.graph.disk(f.anchorTileId, FRONT_RADIUS)) {
    if (inMainFront(state, f, t) && cb(t) === true) return;
  }
  if (!claimable(state, f.posTileId)) {
    for (const t of state.graph.neighbors(f.posTileId)) {
      if (!claimable(state, t) || !targetMatch(state, f, state.owners[t])) continue;
      if (inMainFront(state, f, t)) continue; // 이미 방문
      if (cb(t) === true) return;
    }
  }
}

export function frontCount(state: Readonly<GameState>, f: Readonly<Flag>): number {
  let k = 0;
  forEachFront(state, f, () => {
    k++;
  });
  return k;
}

export function frontNonEmpty(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  let any = false;
  forEachFront(state, f, () => (any = true));
  return any;
}

/** 4.4 도착 판정: front 중 posTileId 에서 거리 ≤ r 인 칸이 있는가 */
export function frontWithin(state: Readonly<GameState>, f: Readonly<Flag>, r: number): boolean {
  let hit = false;
  forEachFront(state, f, (t) => (hit = state.graph.distance(t, f.posTileId) <= r));
  return hit;
}

/** front 정렬 (distance ASC, tileCost ASC, tileId ASC) 의 첫 원소 */
export function frontFirst(state: Readonly<GameState>, f: Readonly<Flag>): number | null {
  let best: number | null = null;
  let bd = 0;
  let bc = 0;
  forEachFront(state, f, (t) => {
    const d = state.graph.distance(t, f.anchorTileId);
    if (best !== null && d > bd) return;
    const c = tileCost(state, f, t);
    if (best === null || d < bd || c < bc || (c === bc && t < best)) {
      best = t;
      bd = d;
      bc = c;
    }
  });
  return best;
}

export function guardContains(state: Readonly<GameState>, f: Readonly<Flag>, t: number): boolean {
  return state.owners[t] === f.ownerId && claimable(state, t) && state.graph.distance(t, f.anchorTileId) <= FRONT_RADIUS;
}

export function guardCount(state: Readonly<GameState>, f: Readonly<Flag>): number {
  let k = 0;
  for (const t of state.graph.disk(f.anchorTileId, FRONT_RADIUS)) if (state.owners[t] === f.ownerId && claimable(state, t)) k++;
  return k;
}

/** 4.4 [A-29] 방어 태세 도착 */
export function defendArrived(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  if (f.posTileId === f.anchorTileId) return true;
  return state.owners[f.anchorTileId] !== f.ownerId && guardContains(state, f, f.posTileId);
}

/**
 * selectTarget 읽기 전용판 (4.6 d). sticky 조건이 맞으면 현 타깃 유지, 아니면 front 첫 원소.
 * 진척도 리셋 여부(new != old)는 Phase B 가 판단한다.
 */
export function selectTargetRO(state: Readonly<GameState>, f: Readonly<Flag>): number | null {
  const X = f.targetTileId;
  if (
    X !== null &&
    claimable(state, X) &&
    targetMatch(state, f, state.owners[X]) &&
    state.graph.distance(X, f.anchorTileId) <= FRONT_RADIUS &&
    hasOwnNeighbor(state, X, f.ownerId)
  ) {
    return X;
  }
  return frontFirst(state, f);
}

// ───────────────────────── 비용 (4.6 b / 4.7 a) ─────────────────────────

function ceilMicro(v: number): number {
  return Math.floor((v + MICRO - 1) / MICRO);
}

function sameOwnerNeighbors(state: Readonly<GameState>, X: number): number {
  const o = state.owners[X];
  let n = 0;
  for (const x of state.graph.neighbors(X)) if (state.owners[x] === o) n++;
  return n;
}

export function supplyPermille(state: Readonly<GameState>, p: Readonly<PlayerState>, X: number): number {
  let d = SUPPLY_NO_BASE_DIST;
  if (p.baseTiles.length) {
    d = Infinity;
    for (const b of p.baseTiles) d = Math.min(d, state.graph.distance(b, X));
  }
  return Math.min(SUPPLY_MAX_MULT_PERMILLE, 1000 + SUPPLY_COEF_PERMILLE * Math.max(0, d - SUPPLY_FREE_RADIUS));
}

/** 공격자 f 기준 점령비용 (정수 AP) */
export function tileCost(state: Readonly<GameState>, f: Readonly<Flag>, X: number): number {
  const p = state.players[f.ownerId];
  const o = state.owners[X];
  let v: number;
  if (o === NEUTRAL) {
    const sq = isqrt(p.tiles * 1_000_000); // milli
    v = (NEUTRAL_BASE * 1000 + Math.floor((NEUTRAL_SQRT_COEF_PERMILLE * sq) / 1000)) * 1000; // micro
    v = Math.floor((v * TER_NEUTRAL_COST_PERMILLE_BY_TIER[p.tech[TECH_AXIS.TERRITORY]]) / 1000);
  } else {
    v = ENEMY_BASE * MICRO;
    v = Math.floor((v * MIL_DEF_COST_PERMILLE_BY_TIER[militaryTier(state.players[o])]) / 1000);
    v = Math.floor((v * MIL_ATK_COST_PERMILLE_BY_TIER[militaryTier(p)]) / 1000);
    v = Math.floor((v * (1000 + ADJACENCY_COEF_PERMILLE * sameOwnerNeighbors(state, X))) / 1000);
  }
  v = Math.floor((v * TERRAIN_COST_PERMILLE[state.map.terrain[X]]) / 1000);
  v = Math.floor((v * UNIT_ATK_MULT_PERMILLE[f.unit]) / 1000);
  v = Math.floor((v * supplyPermille(state, p, X)) / 1000);
  if (state.endgameRushActive) v = Math.floor((v * ENDGAME_RUSH_COST_MULT_PERMILLE) / 1000);
  return Math.max(MIN_TILE_COST, ceilMicro(v));
}

/** 방어 기준 비용 — 공격자 병종·공격테크·보급선·종반러시 제외 (4.7 a) */
export function defRefCost(state: Readonly<GameState>, X: number): number {
  const o = state.owners[X];
  let v = ENEMY_BASE * MICRO;
  if (o !== NEUTRAL) v = Math.floor((v * MIL_DEF_COST_PERMILLE_BY_TIER[militaryTier(state.players[o])]) / 1000);
  v = Math.floor((v * (1000 + ADJACENCY_COEF_PERMILLE * sameOwnerNeighbors(state, X))) / 1000);
  v = Math.floor((v * TERRAIN_COST_PERMILLE[state.map.terrain[X]]) / 1000);
  return Math.max(MIN_TILE_COST, ceilMicro(v));
}

/**
 * 방어 AP 1점이 되돌리는 진척도 (milli).
 * GDD 4.7(a) 식 `floor(1000·LEV·PUSH / (1000·c))` 는 permille 나눗셈 하나가 빠져 1000배 크다(검 평원 c=11 → 81818).
 * 손익분기표(4.7 d, λ = 0.9 × 1.3)와 맞는 `floor(LEV·PUSH / (1000·c))` 를 쓴다 → c=11 검 81, 창 106. (프로토콜 §10)
 */
export function undoPerAP(state: Readonly<GameState>, d: Readonly<Flag>, X: number): number {
  return Math.floor((DEFENSE_LEVERAGE_PERMILLE * UNIT_DEF_PUSH_PERMILLE[d.unit]) / (1000 * defRefCost(state, X)));
}

export function availAP(f: Readonly<Flag>): number {
  return Math.floor(Math.min(f.spendBudgetMilli, f.troopsMilli) / 1000);
}

export function maxProgress(f: Readonly<Flag>): number {
  return FLAG_TILE_RATE_BASE * UNIT_ASSAULT_PERMILLE[f.unit];
}

// ───────────────────────── 이동 (4.4) ─────────────────────────

export function moveCostPermille(state: Readonly<GameState>, p: Readonly<PlayerState>, t: number): number {
  const ter = state.map.terrain[t];
  if (ter === TERRAIN.SHALLOW) return Math.max(SHALLOW_MOVE_PERMILLE_MIN, SHALLOW_MOVE_PERMILLE_BY_TIER[mobilityTier(p)]);
  return TERRAIN_MOVE_PERMILLE[ter];
}

export function speedMilliAt(state: Readonly<GameState>, f: Readonly<Flag>, t: number): number {
  const p = state.players[f.ownerId];
  return Math.max(
    1,
    Math.floor((FLAG_SPEED_BASE_MILLI * UNIT_SPEED_PERMILLE[f.unit] * MOB_SPEED_PERMILLE_BY_TIER[mobilityTier(p)]) / (moveCostPermille(state, p, t) * 1000)),
  );
}

/** 이진 힙 Dijkstra — 키 (dist ASC, tileId ASC). 정수 가중치 = 이동배율 permille */
function buildField(state: Readonly<GameState>, dest: number, tier: number): Int32Array {
  const n = state.graph.tileCount();
  const INF = 0x7fffffff;
  const dist = new Int32Array(n).fill(INF);
  const terrain = state.map.terrain;
  const shallow = Math.max(SHALLOW_MOVE_PERMILLE_MIN, SHALLOW_MOVE_PERMILLE_BY_TIER[tier]);
  // 힙: [dist, tile] 쌍을 평탄 배열로
  const hd: number[] = [];
  const ht: number[] = [];
  const less = (i: number, j: number) => hd[i] < hd[j] || (hd[i] === hd[j] && ht[i] < ht[j]);
  const swap = (i: number, j: number) => {
    const a = hd[i];
    hd[i] = hd[j];
    hd[j] = a;
    const b = ht[i];
    ht[i] = ht[j];
    ht[j] = b;
  };
  const push = (d: number, t: number) => {
    hd.push(d);
    ht.push(t);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const d = hd[0];
    const t = ht[0];
    const ld = hd.pop()!;
    const lt = ht.pop()!;
    if (hd.length) {
      hd[0] = ld;
      ht[0] = lt;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < hd.length && less(l, m)) m = l;
        if (r < hd.length && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return [d, t];
  };
  dist[dest] = 0;
  push(0, dest);
  while (hd.length) {
    const [d, u] = pop();
    if (d !== dist[u]) continue;
    for (const v of state.graph.neighbors(u)) {
      const ter = terrain[v];
      const w = ter === TERRAIN.SHALLOW ? shallow : TERRAIN_MOVE_PERMILLE[ter];
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        push(nd, v);
      }
    }
  }
  return dist;
}

export function fieldKey(dest: number, tier: number): string {
  return `${dest}:${tier}`;
}

/** 거리장 조회(없으면 생성해 캐시). 캐시는 결과에 영향이 없다 — 같은 입력이면 같은 배열 */
export function getField(state: GameState, dest: number, tier: number): Int32Array {
  const k = fieldKey(dest, tier);
  let d = state.fields.get(k);
  if (!d) {
    d = buildField(state, dest, tier);
    state.fields.set(k, d);
  }
  return d;
}

export function destOf(f: Readonly<Flag>): number {
  return f.state === 'RETURNING' && f.returnTileId !== null ? f.returnTileId : f.anchorTileId;
}

/** stepTarget(f) = argmin over neighbors of (dist[n], n). 목적지 위면 제자리 */
export function stepToward(state: GameState, ownerId: number, from: number, dest: number): number {
  if (from === dest) return from;
  const field = getField(state, dest, mobilityTier(state.players[ownerId]));
  let best = from;
  let bd = field[from];
  for (const n of state.graph.neighbors(from)) {
    if (field[n] < bd || (field[n] === bd && n < best)) {
      best = n;
      bd = field[n];
    }
  }
  return best;
}

/** 표시용 ETA: from → dest 를 현재 속도로 걸을 때 도착 tick 수 (ZOC·전투 무시 추정) */
export function etaTicks(state: GameState, f: Readonly<Flag>, from: number, dest: number): number {
  let pos = from;
  let ticks = 0;
  for (let guard = 0; pos !== dest && guard < 4096; guard++) {
    ticks += Math.ceil(1000 / speedMilliAt(state, f, pos));
    const nx = stepToward(state, f.ownerId, pos, dest);
    if (nx === pos) break;
    pos = nx;
  }
  return ticks;
}

/** recallTarget (4.4): ① 출발 타일(내 소유) → ② 내 기지 최근접 → ③ 수도 → ④ 최근접 내 타일 */
export function recallTarget(state: Readonly<GameState>, f: Readonly<Flag>): number {
  const me = f.ownerId;
  if (state.owners[f.originTileId] === me) return f.originTileId;
  const p = state.players[me];
  const pos = f.posTileId;
  let best = -1;
  let bd = Infinity;
  for (const b of p.baseTiles) {
    const d = state.graph.distance(b, pos);
    if (d < bd || (d === bd && b < best)) {
      best = b;
      bd = d;
    }
  }
  if (best >= 0) return best;
  if (state.owners[p.homeTileId] === me) return p.homeTileId;
  for (let t = 0; t < state.owners.length; t++) {
    if (state.owners[t] !== me) continue;
    const d = state.graph.distance(t, pos);
    if (d < bd) {
      best = t;
      bd = d;
    }
  }
  return best >= 0 ? best : pos;
}

/** 발령 사거리: min over 내 타일 distance(t, anchor) */
export function minDistFromTerritory(state: Readonly<GameState>, ownerId: number, anchor: number): number {
  let bd = Infinity;
  const o = state.owners;
  for (let t = 0; t < o.length; t++) if (o[t] === ownerId) bd = Math.min(bd, state.graph.distance(t, anchor));
  return bd;
}
