/**
 * 진격 경로 미리보기 (GDD v4.2 4.4a 프론트 체크리스트 1 — 공격 원 폐기 → 쟁기 노선 미리보기).
 *
 * 서버 이동 규칙을 그대로 따라 한다 (server rules.ts buildField / stepToward):
 *   - 목적지(앵커)에서 거꾸로 Dijkstra. 간선 가중치 = 들어가는 칸의 이동 배율 permille
 *     (TERRAIN_MOVE_PERMILLE, 얕은 물은 max(SHALLOW_MOVE_PERMILLE_MIN, SHALLOW_MOVE_PERMILLE_BY_TIER[기동 단계]))
 *   - 깊은 물(DEEP)은 통행 불가 — 이웃에서 제외
 *   - 한 걸음 = 이웃 중 (거리, tileId) 최소. 같은 입력이면 서버와 같은 칸 열
 * 소유권은 경로에 영향이 없으므로(서버도 지형만 봄) 현재 지형 + 내 기동 단계만으로 정확하다.
 * 실제 행군과의 차이: 기동 테크가 행군 중 오르면 서버가 새 거리장으로 다시 걷는다, 대치(ZOC)·전투·정지 점령은 경로가 아니라 시간만 바꾼다.
 *
 * 표시 전용 — 서버 검증·명령을 대신하지 않는다. 토폴로지 이웃만 쓴다(좌표 식 없음).
 */
import { SHALLOW_MOVE_PERMILLE_BY_TIER, SHALLOW_MOVE_PERMILLE_MIN, TERRAIN, TERRAIN_MOVE_PERMILLE, isClaimable } from '@civwar/shared';
import type { TopologyView } from '../render/topology.js';
import type { GameModel } from '../state/gameModel.js';

const INF = 0x7fffffff;

function weightOf(terrain: number, shallow: number, table: readonly number[]): number {
  return terrain === TERRAIN.SHALLOW ? shallow : table[terrain];
}

/** 서버 buildField 와 같은 정의의 거리장 (dest 에서 거꾸로) */
export function moveField(topo: TopologyView, terrain: ArrayLike<number>, dest: number, mobilityTier: number, constants?: Record<string, unknown>): Int32Array {
  const n = topo.tileCount;
  const dist = new Int32Array(n).fill(INF);
  if (dest < 0 || dest >= n || terrain[dest] === TERRAIN.DEEP) return dist;
  const table = (constants?.TERRAIN_MOVE_PERMILLE as readonly number[] | undefined) ?? TERRAIN_MOVE_PERMILLE;
  const byTier = (constants?.SHALLOW_MOVE_PERMILLE_BY_TIER as readonly number[] | undefined) ?? SHALLOW_MOVE_PERMILLE_BY_TIER;
  const minS = (constants?.SHALLOW_MOVE_PERMILLE_MIN as number | undefined) ?? SHALLOW_MOVE_PERMILLE_MIN;
  const shallow = Math.max(minS, byTier[Math.max(0, Math.min(byTier.length - 1, mobilityTier))]);
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
      if (ter === TERRAIN.DEEP) continue;
      const nd = d + weightOf(ter, shallow, table);
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
      if (terrain[n] === TERRAIN.DEEP) continue;
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

export interface RoutePreview {
  base: number;
  anchor: number;
  /** base → anchor 칸 열 (base 포함). 도달 불가면 [base] */
  path: number[];
  reachable: boolean;
  /** 공격 태세: 경로 칸들의 옆 칸 중 점령 가능·적/중립(비동맹) 칸 — 쟁기 회랑 (marchFront 의 합집합, 현재 소유 기준) */
  corridor: number[];
}

/** 소유자 무관 거리장 캐시 (앵커·기동 단계·지형이 같으면 재사용) */
export class RouteCache {
  private key = '';
  private field: Int32Array | null = null;
  fieldFor(model: GameModel, topo: TopologyView, dest: number, tier: number): Int32Array {
    const key = `${dest}:${tier}:${model.config.seed}`;
    if (!this.field || key !== this.key) {
      this.field = moveField(topo, model.terrain!, dest, tier, model.config.constants);
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

export function computeRoute(model: GameModel, topo: TopologyView, field: Int32Array, me: number, base: number, anchor: number, attack: boolean): RoutePreview {
  const terrain = model.terrain!;
  const path = walkPath(topo, terrain, field, base, anchor);
  const reachable = path[path.length - 1] === anchor;
  const corridor: number[] = [];
  if (attack) {
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
  }
  return { base, anchor, path, reachable, corridor };
}
