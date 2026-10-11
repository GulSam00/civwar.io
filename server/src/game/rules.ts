/**
 * 깃발 규칙의 순수 함수 모음 (GDD 4.1 / 4.4 / 4.4a / 4.6 / 4.7 — v4.2). 상태를 쓰지 않는다 — Phase A 에서 안전.
 *
 * 정수 규칙: 비용 산출은 micro(1e-6) 고정소수점으로 곱셈마다 floor, 마지막에 ceil.
 * (GDD 의 실수 곱 후 ceil 과 같은 값을 내며, 차이는 중간 floor 의 1e-6 미만 절사뿐 — 프로토콜 §10)
 */
import {
  ADJACENCY_COEF_PERMILLE,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENEMY_BASE,
  FLAG_SPEED_BASE_MILLI,
  FLAG_TILE_RATE_BASE,
  FRONT_RADIUS,
  MIN_TILE_COST,
  NEUTRAL_BASE,
  NEUTRAL_SQRT_COEF_PERMILLE,
  POSTURE,
  RETURN_SPEED_PERMILLE,
  SUPPLY_FREE_RADIUS,
  SUPPLY_MAX_MULT_PERMILLE,
  SUPPLY_NO_BASE_DIST,
  TECH_STAT,
  TERRAIN,
  TERRAIN_COST_PERMILLE,
  TERRAIN_MOVE_PERMILLE,
  UNIT_ASSAULT_PERMILLE,
  UNIT_SPEED_PERMILLE,
  isClaimable,
  techCaptureMultPm,
  techShallowPm,
  techSpeedPm,
} from '@civwar/shared';
import { isqrt } from './economy.js';
import { NEUTRAL, isAlly, type Flag, type GameState, type PlayerState } from './state.js';

const MICRO = 1_000_000;

/** v4.3: 그 플레이어의 얕은 물 이동배율 ‰ (MOB-2B 조선술 3500, 무테크 5000). 거리장 캐시 키로도 쓴다 */
export const shallowPmOf = (p: Readonly<PlayerState>): number => techShallowPm(p.statPm);

export function claimable(state: Readonly<GameState>, t: number): boolean {
  return isClaimable(state.map.terrain[t]);
}

// ───────────────────────── 공격 = 깃발 옆 칸 (v4.2 4.4a) ─────────────────────────
// v4.2 [A-53 변경]: 앵커 원(반경 6) 공격 front·targetMatch·selectTarget·beach 폐기. 공격 태세 깃발의 유일한 대상은 marchFront.

/** marchMatch(owner, o) = o != owner and not isAlly(owner, o) — NEUTRAL 포함, 적대 플레이어 전원 [A-51] */
export function marchMatch(state: Readonly<GameState>, ownerId: number, o: number): boolean {
  return o !== ownerId && !isAlly(state, ownerId, o);
}

/** t ∈ marchFront 의 지형·소유 조건 (t 가 pos 의 이웃인지는 호출자가 보장) */
function marchTile(state: Readonly<GameState>, ownerId: number, t: number): boolean {
  return claimable(state, t) && marchMatch(state, ownerId, state.owners[t]);
}

/** marchFront(pos) = { t ∈ neighbors(pos) : isClaimable(t) and marchMatch(owner, owner(t)) } 를 neighbors 고정 순서로 방문 */
export function forEachMarchFrontAt(state: Readonly<GameState>, ownerId: number, pos: number, cb: (t: number) => boolean | void): void {
  for (const t of state.graph.neighbors(pos)) if (marchTile(state, ownerId, t) && cb(t) === true) return;
}

export function marchFrontCountAt(state: Readonly<GameState>, ownerId: number, pos: number): number {
  let k = 0;
  forEachMarchFrontAt(state, ownerId, pos, () => {
    k++;
  });
  return k;
}

/** |marchFront(f)| — flag_engaged.frontTileCount */
export function marchFrontCount(state: Readonly<GameState>, f: Readonly<Flag>): number {
  return marchFrontCountAt(state, f.ownerId, f.posTileId);
}

export function marchFrontNonEmpty(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  let any = false;
  forEachMarchFrontAt(state, f.ownerId, f.posTileId, () => (any = true));
  return any;
}

export function inMarchFront(state: Readonly<GameState>, f: Readonly<Flag>, X: number): boolean {
  if (!marchTile(state, f.ownerId, X)) return false;
  for (const n of state.graph.neighbors(f.posTileId)) if (n === X) return true;
  return false;
}

/** attackReady(f) — 정지 점령·재점화 자격 (이탈 대기 = inCombat, breakaway 는 한 칸 이동 후부터 [A-55], RETURNING 은 공격 안 함) */
export function attackReady(f: Readonly<Flag>): boolean {
  return f.posture === POSTURE.ATTACK && !f.routed && !f.inCombat && !f.breakaway && f.state !== 'RETURNING';
}

/** pushing(f) — 5·6·7·9·10단계의 "밀고 있는 공격 깃발" = 비전투 ATTACK 이고 (ENGAGED 또는 행군 중 halted) */
export function pushing(f: Readonly<Flag>): boolean {
  return !f.inCombat && f.posture === POSTURE.ATTACK && (f.state === 'ENGAGED' || f.halted);
}

/**
 * selectAttackTarget 읽기 전용판 (4.4a c, [A-52]). sticky: 현 타깃이 marchFront 안이면 유지.
 * 새 타깃 = argmin ( 행군 중 경로 앞 칸이면 0 아니면 1, distance(t, anchor), tileCost, tileId ). 진척 리셋은 Phase B 가 판단.
 */
export function selectAttackTargetRO(state: Readonly<GameState>, f: Readonly<Flag>): number | null {
  const X = f.targetTileId;
  if (X !== null && inMarchFront(state, f, X)) return X;
  let best = -1;
  let bk0 = 0;
  let bd = 0;
  let bc = 0;
  forEachMarchFrontAt(state, f.ownerId, f.posTileId, (t) => {
    const k0 = f.state === 'MARCHING' && t === f.nextTileId ? 0 : 1;
    const d = state.graph.distance(t, f.anchorTileId);
    const c = tileCost(state, f, t);
    if (best < 0 || k0 < bk0 || (k0 === bk0 && (d < bd || (d === bd && (c < bc || (c === bc && t < best)))))) {
      best = t;
      bk0 = k0;
      bd = d;
      bc = c;
    }
  });
  return best < 0 ? null : best;
}

// ───────────────────────── guard (4.1 — v4.2 방어 태세 전용) ─────────────────────────

export function guardContains(state: Readonly<GameState>, f: Readonly<Flag>, t: number): boolean {
  return state.owners[t] === f.ownerId && claimable(state, t) && state.graph.distance(t, f.anchorTileId) <= FRONT_RADIUS;
}

export function guardCount(state: Readonly<GameState>, f: Readonly<Flag>): number {
  let k = 0;
  for (const t of state.graph.disk(f.anchorTileId, FRONT_RADIUS)) if (state.owners[t] === f.ownerId && claimable(state, t)) k++;
  return k;
}

/**
 * 4.4 (d) threatened — v4.2: 적 조건 = pushing(g) (행군 중 정지 점령하는 적 깃발 포함).
 * threatened(f) = f.inCombat or 적대 g : pushing(g) and g.targetTileId in guard(f)
 */
export function threatened(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  if (f.inCombat) return true;
  for (const g of state.flags) {
    if (!pushing(g) || g.targetTileId === null) continue;
    if (g.ownerId === f.ownerId || isAlly(state, f.ownerId, g.ownerId)) continue;
    if (guardContains(state, f, g.targetTileId)) return true;
  }
  return false;
}

/** 4.4 [A-29] 방어 태세 도착 */
export function defendArrived(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  if (f.posTileId === f.anchorTileId) return true;
  return state.owners[f.anchorTileId] !== f.ownerId && guardContains(state, f, f.posTileId);
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
  // v4.3: 계수 = 플레이어 스탯 SUPPLY_COEF (무테크 SUPPLY_COEF_PERMILLE 20, TER-3A 도로망 15)
  return Math.min(SUPPLY_MAX_MULT_PERMILLE, 1000 + p.statPm[TECH_STAT.SUPPLY_COEF] * Math.max(0, d - SUPPLY_FREE_RADIUS));
}

/**
 * 공격자 f 기준 점령비용 (정수 AP). v4.3: 테크 배율 = 플레이어 스탯 — 중립 NEUTRAL_COST, 적 땅 = 방어자 DEF_COST × 공격자 ATK_COST,
 * 병종 배율 = 공격자 CAPTURE_MULT_<unit> (SWO-2B 검 950). 곱하는 순서·floor 위치는 v4.2 와 같다.
 */
export function tileCost(state: Readonly<GameState>, f: Readonly<Flag>, X: number): number {
  const p = state.players[f.ownerId];
  const o = state.owners[X];
  let v: number;
  if (o === NEUTRAL) {
    const sq = isqrt(p.tiles * 1_000_000); // milli
    v = (NEUTRAL_BASE * 1000 + Math.floor((NEUTRAL_SQRT_COEF_PERMILLE * sq) / 1000)) * 1000; // micro
    v = Math.floor((v * p.statPm[TECH_STAT.NEUTRAL_COST]) / 1000);
  } else {
    v = ENEMY_BASE * MICRO;
    v = Math.floor((v * state.players[o].statPm[TECH_STAT.DEF_COST]) / 1000);
    v = Math.floor((v * p.statPm[TECH_STAT.ATK_COST]) / 1000);
    v = Math.floor((v * (1000 + ADJACENCY_COEF_PERMILLE * sameOwnerNeighbors(state, X))) / 1000);
  }
  v = Math.floor((v * TERRAIN_COST_PERMILLE[state.map.terrain[X]]) / 1000);
  v = Math.floor((v * techCaptureMultPm(p.statPm, f.unit)) / 1000);
  v = Math.floor((v * supplyPermille(state, p, X)) / 1000);
  if (state.endgameRushActive) v = Math.floor((v * ENDGAME_RUSH_COST_MULT_PERMILLE) / 1000);
  return Math.max(MIN_TILE_COST, ceilMicro(v));
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
  if (ter === TERRAIN.SHALLOW) return shallowPmOf(p);
  return TERRAIN_MOVE_PERMILLE[ter];
}

/**
 * speedMilli (4.4) — v4.2 [A-63]: RETURNING(패주 포함)이면 × RETURN_SPEED_PERMILLE / 1000 (같은 floor 안에서 곱한다 — 프로토콜 §10).
 * v4.3: 테크 배율 = techSpeedPm(SPEED + SPEED_<unit>) — 최대 1400. 최대 분자 140 × 1450 × 1400 × 1500 ≈ 4.3e11 < 2^53.
 */
export function speedMilliAt(state: Readonly<GameState>, f: Readonly<Flag>, t: number): number {
  const p = state.players[f.ownerId];
  const ret = f.state === 'RETURNING' ? RETURN_SPEED_PERMILLE : 1000;
  return Math.max(
    1,
    Math.floor(
      (FLAG_SPEED_BASE_MILLI * UNIT_SPEED_PERMILLE[f.unit] * techSpeedPm(p.statPm, f.unit) * ret) / (moveCostPermille(state, p, t) * 1_000_000),
    ),
  );
}

/** 이진 힙 Dijkstra — 키 (dist ASC, tileId ASC). 정수 가중치 = 이동배율 permille */
function buildField(state: Readonly<GameState>, dest: number, shallowPm: number): Int32Array {
  const n = state.graph.tileCount();
  const INF = 0x7fffffff;
  const dist = new Int32Array(n).fill(INF);
  const terrain = state.map.terrain;
  const shallow = shallowPm;
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

/** v4.3: 키 = (목적지, 얕은 물 이동배율 ‰). 구 (목적지, 기동 단계) 대체 — 같은 배율이면 같은 거리장 */
export function fieldKey(dest: number, shallowPm: number): string {
  return `${dest}:${shallowPm}`;
}

/** 거리장 조회(없으면 생성해 캐시). 캐시는 결과에 영향이 없다 — 같은 입력이면 같은 배열 */
export function getField(state: GameState, dest: number, shallowPm: number): Int32Array {
  const k = fieldKey(dest, shallowPm);
  let d = state.fields.get(k);
  if (!d) {
    d = buildField(state, dest, shallowPm);
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
  const field = getField(state, dest, shallowPmOf(state.players[ownerId]));
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

/**
 * 표시용 교전 개시 ETA (프론트 QA m-4, 필드 추가): from → dest 경로를 따라 걸으며 movement.ts settle 판정이 처음 참이 되는 칸까지의 tick 수.
 * v4.2: ATTACK = 그 칸의 marchFront 가 비어 있지 않음(정지 점령 시작 — 4.4a), DEFEND = defendArrived, 그 외 앵커 도달.
 * 현재 owners 기준 추정 — 행군 중 영토 변화·정지 점령 시간·ZOC·전투는 무시. 판정이 끝까지 안 서면 etaTicks 와 같다.
 */
export function engageEtaTicks(state: GameState, f: Readonly<Flag>, from: number, dest: number): number {
  const probe = { ...f, posTileId: from } as Flag;
  const arrived = () =>
    probe.posTileId === dest || (probe.posture === POSTURE.ATTACK ? marchFrontNonEmpty(state, probe) : defendArrived(state, probe));
  let ticks = 0;
  for (let guard = 0; !arrived() && guard < 4096; guard++) {
    ticks += Math.ceil(1000 / speedMilliAt(state, f, probe.posTileId));
    const nx = stepToward(state, f.ownerId, probe.posTileId, dest);
    if (nx === probe.posTileId) break;
    probe.posTileId = nx;
  }
  return ticks;
}

/** v4.2 [A-61]: 지정 귀환 기지가 아직 내 것인가 */
export function returnBaseValid(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  return f.returnBaseTileId !== null && state.owners[f.returnBaseTileId] === f.ownerId;
}

/**
 * recallTarget (4.4): v4.2 [A-61] 지정 기지(내 소유일 때) → ① 출발 타일(내 소유) → ② 내 기지 최근접 → ③ 수도 → ④ 최근접 내 타일.
 * 지정 기지를 잃으면 폴백하고, movement.ts 가 returnBaseTileId = null 로 지운다(되찾아도 다시 돌아가지 않는다).
 */
export function recallTarget(state: Readonly<GameState>, f: Readonly<Flag>): number {
  const me = f.ownerId;
  if (returnBaseValid(state, f)) return f.returnBaseTileId!;
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
