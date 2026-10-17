/**
 * 진격 경로 미리보기 (GDD v4.2 4.4a 프론트 체크리스트 1 — 공격 원 폐기 → 쟁기 노선 미리보기).
 *
 * 서버 이동 규칙을 그대로 따라 한다 (server rules.ts buildField / stepToward / defendDest / stepTowardDefend):
 *   - 목적지(앵커)에서 거꾸로 Dijkstra. 간선 가중치 = 들어가는 칸의 이동 배율 permille (TERRAIN_MOVE_PERMILLE)
 *   - v4.5 (§22.1): 물(깊은 물·얕은 물 모두)은 통행 불가 — 이웃에서 제외. 플레이어별 물 이동배율 폐지
 *   - 한 걸음 = 이웃 중 (거리, tileId) 최소. 같은 입력이면 서버와 같은 칸 열
 *   - v4.5 (§22.12): 방어 태세는 적(비동맹 플레이어) 땅을 밟지 않는다. 못 가면 적 땅 없이 닿는 칸 중
 *     지형 거리(적 땅 무시)로 앵커에 가장 가까운 칸에서 멈춘다(서버 IDLE "unreachable") — defendDest
 * 공격 태세 경로는 소유권과 무관(지형만). 방어 태세 경로는 현재 소유·동맹 기준 — 행군 중 땅이 바뀌면 서버가 다시 계산한다.
 * 실제 행군과의 차이: 대치(ZOC)·전투·정지 점령은 경로가 아니라 시간만 바꾼다.
 *
 * 표시 전용 — 서버 검증·명령을 대신하지 않는다. 토폴로지 이웃만 쓴다(좌표 식 없음).
 */
import { TERRAIN_MOVE_PERMILLE, isClaimable } from '@civwar/shared';
import type { TopologyView } from '../render/topology.js';
import type { GameModel } from '../state/gameModel.js';

const INF = 0x7fffffff;

/** v4.5: 통행 가능 = 육지 (서버 isPassable = isClaimable) */
export function passable(terrain: number): boolean {
  return isClaimable(terrain);
}

/**
 * 서버 buildField 와 같은 정의의 거리장 (dest 에서 거꾸로). allowed 가 있으면 그 칸만 지난다(방어 태세 = 적 땅 제외).
 * 목적지가 물이거나 금지 칸이면 전부 도달 불가.
 */
export function moveField(topo: TopologyView, terrain: ArrayLike<number>, dest: number, constants?: Record<string, unknown>, allowed?: (t: number) => boolean): Int32Array {
  const n = topo.tileCount;
  const dist = new Int32Array(n).fill(INF);
  if (dest < 0 || dest >= n || !passable(terrain[dest]) || (allowed && !allowed(dest))) return dist;
  const table = (constants?.TERRAIN_MOVE_PERMILLE as readonly number[] | undefined) ?? TERRAIN_MOVE_PERMILLE;
  // 이진 힙 — 키 (dist, tile)
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
    for (const v of topo.neighbors(u)) {
      const ter = terrain[v];
      if (!passable(ter) || (allowed && !allowed(v))) continue;
      const nd = d + table[ter];
      if (nd < dist[v]) {
        dist[v] = nd;
        push(nd, v);
      }
    }
  }
  return dist;
}

/** 서버 stepToward 와 같은 걸음: 이웃 중 (field, tileId) 최소, 나아질 게 없으면 제자리 */
export function walkPath(topo: TopologyView, terrain: ArrayLike<number>, field: Int32Array, from: number, dest: number): number[] {
  const path = [from];
  if (from < 0 || field[from] === INF) return path;
  let pos = from;
  for (let guard = 0; pos !== dest && guard < 8192; guard++) {
    let best = pos;
    let bd = field[pos];
    for (const n of topo.neighbors(pos)) {
      if (!passable(terrain[n])) continue;
      if (field[n] < bd || (field[n] === bd && n < best)) {
        best = n;
        bd = field[n];
      }
    }
    if (best === pos) break;
    pos = best;
    path.push(pos);
  }
  return path;
}

/** §22.12 적 땅 = 적대(동맹 아님) 플레이어 소유 칸. 중립·내 땅·동맹 땅은 지나간다 */
export function hostileLand(model: GameModel, me: number, t: number): boolean {
  const o = model.owners[t];
  return o !== 0 && o !== me && !model.isAlly(me, o);
}

/**
 * 서버 defendDest [A-112]: from → dest 를 적 땅 없이 갈 수 있으면 dest, 못 가면 from 에서 적 땅 없이 닿는 칸(from 포함) 중
 * 지형 거리장(terrField — 적 땅 무시) 기준 dest 에 가장 가까운 칸(동률 tileId 작은 쪽).
 */
export function defendDest(
  topo: TopologyView,
  terrain: ArrayLike<number>,
  terrField: Int32Array,
  defField: Int32Array,
  hostile: (t: number) => boolean,
  from: number,
  dest: number,
): number {
  if (from === dest) return dest;
  if (defField[from] < INF) return dest;
  for (const n of topo.neighbors(from)) if (passable(terrain[n]) && defField[n] < INF) return dest; // 적 땅 위에서 출발
  const seen = new Uint8Array(topo.tileCount);
  const q = [from];
  seen[from] = 1;
  let best = from;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    if (terrField[u] < terrField[best] || (terrField[u] === terrField[best] && u < best)) best = u;
    for (const v of topo.neighbors(u)) {
      if (seen[v] || !passable(terrain[v]) || hostile(v)) continue;
      seen[v] = 1;
      q.push(v);
    }
  }
  return best;
}

/** 서버 stepTowardDefend 를 이어 붙인 경로: 적 땅이 아닌 이웃 중 (defField, tileId) 최소 */
export function walkDefendPath(topo: TopologyView, terrain: ArrayLike<number>, defField: Int32Array, hostile: (t: number) => boolean, from: number, dest: number): number[] {
  const path = [from];
  let pos = from;
  for (let guard = 0; pos !== dest && guard < 8192; guard++) {
    let best = pos;
    let bd = hostile(pos) ? INF : defField[pos];
    for (const n of topo.neighbors(pos)) {
      if (!passable(terrain[n]) || hostile(n)) continue;
      if (defField[n] < bd || (defField[n] === bd && n < best && bd < INF)) {
        best = n;
        bd = defField[n];
      }
    }
    if (best === pos) break;
    pos = best;
    path.push(pos);
  }
  return path;
}

export interface RoutePreview {
  base: number;
  anchor: number;
  /** base → anchor 칸 열 (base 포함). 도달 불가면 [base]. 방어 태세가 막히면 base → stopTile */
  path: number[];
  reachable: boolean;
  /**
   * §22.12 방어 태세가 적 땅에 막혀 앵커 전에 멈추는가 (true 면 path 끝 = stopTile, 서버는 거기서 IDLE "unreachable").
   * 공격 태세는 항상 false.
   */
  blocked: boolean;
  /** 막힐 때 멈추는 칸 (아니면 null) */
  stopTile: number | null;
  /** 공격 태세: 경로 칸들의 옆 칸 중 점령 가능·적/중립(비동맹) 칸 — 쟁기 회랑 (marchFront 의 합집합, 현재 소유 기준) */
  corridor: number[];
}

/** 소유자 무관 거리장 캐시 (앵커·지형이 같으면 재사용 — v4.5: 플레이어별 물 배율 키 폐지) */
export class RouteCache {
  private key = '';
  private field: Int32Array | null = null;
  fieldFor(model: GameModel, topo: TopologyView, dest: number): Int32Array {
    const key = `${dest}:${model.config.seed}`;
    if (!this.field || key !== this.key) {
      this.field = moveField(topo, model.terrain!, dest, model.config.constants);
      this.key = key;
    }
    return this.field;
  }
}

/** 내 기지 중 dest 까지 이동 거리(가중)가 가장 짧은 것. 동률은 tileId 작은 쪽. 없으면 null */
export function nearestOwnBase(model: GameModel, field: Int32Array, me: number): number | null {
  let best: number | null = null;
  let bd = INF;
  for (const t of model.baseTiles) {
    const b = model.bases.get(t);
    if (!b || b.ownerId !== me) continue;
    const d = field[t];
    if (d < bd || (d === bd && best !== null && t < best)) {
      best = t;
      bd = d;
    }
  }
  return best;
}

/**
 * 출전 경로 미리보기. attack = 공격 태세(지형 경로 + 쟁기 회랑), 아니면 방어 태세(§22.12 적 땅 회피, 막히면 멈춤 칸).
 * field = 앵커까지의 지형 거리장(RouteCache).
 */
export function computeRoute(model: GameModel, topo: TopologyView, field: Int32Array, me: number, base: number, anchor: number, attack: boolean): RoutePreview {
  const terrain = model.terrain!;
  if (!attack) {
    const hostile = (t: number) => hostileLand(model, me, t);
    const defField = moveField(topo, terrain, anchor, model.config.constants, (t) => !hostile(t));
    const dest = defendDest(topo, terrain, field, defField, hostile, base, anchor);
    if (dest === anchor) {
      const path = walkDefendPath(topo, terrain, defField, hostile, base, anchor);
      return { base, anchor, path, reachable: path[path.length - 1] === anchor, blocked: false, stopTile: null, corridor: [] };
    }
    // 막힘: 멈춤 칸까지 (적 땅 회피 거리장을 그 칸 기준으로 다시 — 서버도 목적지를 defendDest 로 바꿔 걷는다)
    const stopField = moveField(topo, terrain, dest, model.config.constants, (t) => !hostile(t));
    const path = walkDefendPath(topo, terrain, stopField, hostile, base, dest);
    return { base, anchor, path, reachable: field[base] < INF, blocked: true, stopTile: dest, corridor: [] };
  }
  const path = walkPath(topo, terrain, field, base, anchor);
  const reachable = path[path.length - 1] === anchor;
  const corridor: number[] = [];
  const seen = new Set<number>();
  for (const p of path) {
    for (const n of topo.neighbors(p)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const o = model.owners[n];
      if (!isClaimable(terrain[n]) || o === me || model.isAlly(me, o)) continue;
      corridor.push(n);
    }
  }
  return { base, anchor, path, reachable, blocked: false, stopTile: null, corridor };
}
