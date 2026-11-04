/**
 * 깃발 규칙의 순수 함수 모음 (GDD 4.1 / 4.4 / 4.4a / 4.6 / 4.7 — v4.2). 상태를 쓰지 않는다 — Phase A 에서 안전.
 *
 * 정수 규칙: 비용 산출은 micro(1e-6) 고정소수점으로 곱셈마다 floor, 마지막에 ceil.
 * (GDD 의 실수 곱 후 ceil 과 같은 값을 내며, 차이는 중간 floor 의 1e-6 미만 절사뿐 — 프로토콜 §10)
 */
import {
  DEBT_CAPTURE_COST_PERMILLE,
  DEBT_CAPTURE_SPEED_PERMILLE,
  ADJACENCY_COEF_PERMILLE,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENEMY_BASE,
  FLAG_SPEED_BASE_MILLI,
  FLAG_TILE_RATE_BASE,
  FRONT_RADIUS,
  MIN_TILE_COST,
  NEUTRAL_BASE,
  POSTURE,
  SUPPLY_FREE_RADIUS,
  SUPPLY_MAX_MULT_PERMILLE,
  SUPPLY_NO_BASE_DIST,
  TECH_STAT,
  TERRAIN_COST_PERMILLE,
  TERRAIN_MOVE_PERMILLE,
  UNIT_ASSAULT_PERMILLE,
  UNIT_SPEED_PERMILLE,
  isClaimable,
  techCaptureMultPm,
  techReturnSpeedPm,
  TECH_POINT_PERMILLE,
  techSpeedPts,
} from '@civwar/shared';
import { NEUTRAL, isAlly, type Flag, type GameState, type PlayerState } from './state.js';

const MICRO = 1_000_000;

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
    // v4.5 (사용자 2026-10-15): 고정 비용 NEUTRAL_BASE — 나라 크기 비례 √칸 항 폐기
    v = NEUTRAL_BASE * MICRO;
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
  if (p.goldMilli < 0) v = Math.floor((v * DEBT_CAPTURE_COST_PERMILLE) / 1000); // 패치 6차: 빚이면 점령 소모 ×1.5 (기지 공격 포함)
  return Math.max(MIN_TILE_COST, ceilMicro(v));
}

export function availAP(f: Readonly<Flag>): number {
  return Math.floor(Math.min(f.spendBudgetMilli, f.troopsMilli) / 1000);
}

export function maxProgress(f: Readonly<Flag>, state?: Readonly<GameState>): number {
  const base = FLAG_TILE_RATE_BASE * UNIT_ASSAULT_PERMILLE[f.unit];
  // 패치 6차: 빚이면 점령 속도 ×0.5
  return state && state.players[f.ownerId].goldMilli < 0 ? Math.floor((base * DEBT_CAPTURE_SPEED_PERMILLE) / 1000) : base;
}

// ───────────────────────── 이동 (4.4) ─────────────────────────

/** v4.5: 물은 통행 불가라 육지 지형 배율만 조회된다 (구 얕은 물 테크 배율 폐지). p 는 호출 호환용 */
export function moveCostPermille(state: Readonly<GameState>, _p: Readonly<PlayerState>, t: number): number {
  return TERRAIN_MOVE_PERMILLE[state.map.terrain[t]];
}

/**
 * speedMilli (4.4) — v4.2 [A-63]: RETURNING(패주 포함)이면 × RETURN_SPEED_PERMILLE / 1000 (같은 floor 안에서 곱한다 — 프로토콜 §10).
 * 2026-10-24: 테크는 점수(techSpeedPts) — 병종 기본 ‰ 에 10‰/점을 더한다. 최대 분자 140 × 2000 × 1500 ≈ 4.2e8 < 2^53.
 */
export function speedMilliAt(state: Readonly<GameState>, f: Readonly<Flag>, t: number): number {
  const p = state.players[f.ownerId];
  const ret = f.state === 'RETURNING' ? techReturnSpeedPm(p.statPm) : 1000; // v4.5: 플레이어 스탯 (무테크 1500, MOB-1 1700, MOB-2B 급속 귀환 2000)
  return Math.max(
    1,
    Math.floor(
      (FLAG_SPEED_BASE_MILLI * (UNIT_SPEED_PERMILLE[f.unit] + TECH_POINT_PERMILLE * techSpeedPts(p.statPm, f.unit)) * 1000 * ret) / (moveCostPermille(state, p, t) * 1_000_000),
    ),
  );
}

/** 이진 힙 Dijkstra — 키 (dist ASC, tileId ASC). 정수 가중치 = 이동배율 permille */
const UNREACHABLE = 0x7fffffff;

function buildField(state: Readonly<GameState>, dest: number, allowed?: (t: number) => boolean): Int32Array {
  const n = state.graph.tileCount();
  const INF = UNREACHABLE;
  const dist = new Int32Array(n).fill(INF);
  const terrain = state.map.terrain;
  if (allowed && !allowed(dest)) return dist; // v4.5: 목적지가 금지 칸이면 전부 도달 불가
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
      if (allowed && !allowed(v)) continue;
      const nd = d + TERRAIN_MOVE_PERMILLE[terrain[v]]; // v4.5: 그래프에 물 칸이 없다
      if (nd < dist[v]) {
        dist[v] = nd;
        push(nd, v);
      }
    }
  }
  return dist;
}

/** v4.5: 거리장은 목적지만으로 정해진다 (구 (목적지, 얕은 물 배율) 키 — 플레이어별 물 경로 캐시 폐지) */
export function fieldKey(dest: number): number {
  return dest;
}

/** 거리장 조회(없으면 생성해 캐시). 캐시는 결과에 영향이 없다 — 같은 입력이면 같은 배열 */
export function getField(state: GameState, dest: number): Int32Array {
  const k = fieldKey(dest);
  let d = state.fields.get(k);
  if (!d) {
    d = buildField(state, dest);
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
  void ownerId; // v4.5: 거리장이 플레이어와 무관해졌다 (호출 호환용 인자)
  const field = getField(state, dest);
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

// ───────────────────────── v4.5 방어 태세 경로 — 적 땅 통과 금지 (사용자 2026-10-15, §22.12) ─────────────────────────

/** 적 땅 = 적대(동맹 아님) 플레이어 소유 칸. 중립·내 땅·동맹 땅은 지나갈 수 있다 */
export function hostileLand(state: Readonly<GameState>, ownerId: number, t: number): boolean {
  const o = state.owners[t];
  return o !== NEUTRAL && o !== ownerId && !isAlly(state, ownerId, o);
}

/** 이 깃발의 경로가 적 땅을 피해야 하는가 — 현재 태세 DEFEND, 귀환(패주 포함) 아님 */
export function defendPathing(f: Readonly<Flag>): boolean {
  return f.posture === POSTURE.DEFEND && f.state !== 'RETURNING' && !f.routed;
}

/** 적 땅을 뺀 그래프의 거리장 (dest 가 적 땅이면 전부 도달 불가). 캐시 = (dest, owner) × pathVersion */
function defendField(state: GameState, ownerId: number, dest: number): Int32Array {
  const key = `${dest}:${ownerId}`;
  const hit = state.defFields.get(key);
  if (hit && hit.ver === state.pathVersion) return hit.field;
  const field = buildField(state, dest, (t) => !hostileLand(state, ownerId, t));
  state.defFields.set(key, { ver: state.pathVersion, field });
  return field;
}

/**
 * [A-112] 방어 태세 깃발의 실제 목적지. from → dest 를 적 땅 없이 갈 수 있으면 dest,
 * 못 가면 from 에서 적 땅 없이 닿는 칸(from 자신 포함 — from 이 적 땅이어도 출발은 허용) 중
 * **지형 거리장(적 땅 무시) 기준 dest 에 가장 가까운 칸**(동률 tileId 작은 쪽) = "적 땅 바로 앞".
 */
export function defendDest(state: GameState, ownerId: number, from: number, dest: number): number {
  if (from === dest) return dest;
  const df = defendField(state, ownerId, dest);
  if (df[from] < UNREACHABLE) return dest;
  for (const n of state.graph.neighbors(from)) if (df[n] < UNREACHABLE) return dest; // 적 땅 위에서 출발
  const terr = getField(state, dest);
  const n = state.owners.length;
  const seen = new Uint8Array(n);
  const q = [from];
  seen[from] = 1;
  let best = from;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    if (terr[u] < terr[best] || (terr[u] === terr[best] && u < best)) best = u;
    for (const v of state.graph.neighbors(u)) {
      if (seen[v] || hostileLand(state, ownerId, v)) continue;
      seen[v] = 1;
      q.push(v);
    }
  }
  return best;
}

/** 방어 태세 한 걸음: 적 땅이 아닌 이웃 중 (적 땅 회피 거리장, tileId) 최소. 더 가까운 칸이 없으면 제자리 */
function stepTowardDefend(state: GameState, ownerId: number, from: number, dest: number): number {
  if (from === dest) return from;
  const field = defendField(state, ownerId, dest);
  let best = from;
  let bd = hostileLand(state, ownerId, from) ? UNREACHABLE : field[from];
  for (const n of state.graph.neighbors(from)) {
    if (hostileLand(state, ownerId, n)) continue;
    if (field[n] < bd || (field[n] === bd && n < best && bd < UNREACHABLE)) {
      best = n;
      bd = field[n];
    }
  }
  return best;
}

/**
 * 깃발의 다음 칸 — v4.5: 방어 태세(귀환·패주 제외)는 적 땅을 밟지 않는다. 목적지까지 못 가면 defendDest(적 땅 바로 앞)로.
 * 그 밖(공격 태세·귀환·패주)은 기존 stepToward 그대로.
 */
export function nextStep(state: GameState, f: Readonly<Flag>, from: number, dest: number): number {
  if (!defendPathing(f)) return stepToward(state, f.ownerId, from, dest);
  return stepTowardDefend(state, f.ownerId, from, defendDest(state, f.ownerId, from, dest));
}

/** 표시용 ETA: from → dest 를 현재 속도로 걸을 때 도착 tick 수 (ZOC·전투 무시 추정) */
export function etaTicks(state: GameState, f: Readonly<Flag>, from: number, dest: number): number {
  let pos = from;
  let ticks = 0;
  for (let guard = 0; pos !== dest && guard < 4096; guard++) {
    ticks += Math.ceil(1000 / speedMilliAt(state, f, pos));
    const nx = nextStep(state, f, pos, dest);
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
    const nx = nextStep(state, f, probe.posTileId, dest);
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
 * recallTarget (4.4): v4.2 [A-61] 지정 기지(내 소유일 때) → ① 내 기지 최근접(그래프 거리) → ② 수도 → ③ 최근접 내 타일.
 * 출발 타일은 더 이상 우선하지 않는다(가까운 기지로 복귀). 귀환 중에도 매 tick 재평가하므로 더 가까운 기지가 생기면 바뀐다.
 * 지정 기지를 잃으면 폴백하고, movement.ts 가 returnBaseTileId = null 로 지운다(되찾아도 다시 돌아가지 않는다).
 */
export function recallTarget(state: Readonly<GameState>, f: Readonly<Flag>): number {
  const me = f.ownerId;
  if (returnBaseValid(state, f)) return f.returnBaseTileId!;
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
