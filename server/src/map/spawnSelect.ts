/**
 * 스폰 선택 (v4.9, 프로토콜 §30 [A-130]~) — "노출도 균등" 규칙.
 *
 * §28 결론: 스폰 불균형을 설명하는 것은 면적·비옥지가 아니라 노출도(반경 20 육지 칸수 l20, 8방향 물 차단 수 blocked,
 * 가까운 라이벌 3명 평균 거리 nR3, 모서리도)다. 그래서 옛 규칙("물에서 가장 먼 칸을 첫 스폰으로, 이후 최원점")을 폐기하고
 *
 *   ① 후보 = 물 거리 2 이상인 육지 칸 중 l20 이 "적격 칸 l20 의 30 백분위 값 ± (범위의 4%)" 인 칸 (맵 둘레를 도는 등노출 고리;
 *      l20 이 최대인 중앙은 고리 밖이라 후보에서 빠진다. 후보가 인원×6 보다 적으면 허용 폭을 ×1.5 씩 넓힌다)
 *   ② 첫 스폰 = 후보 중 tileId 최소, 이후 최원점 순차 배치 (고리 위의 대략적 등간격 배치)
 *   ③ 균형 스왑 — 스폰 하나씩 후보 중 비용이 가장 낮은 칸으로 바꾼다 (최대 6패스, 개선이 없으면 중단):
 *      비용 = CV²(nR3) + CV²(nnR) + CV²(l20) + 0.5·CV²(blocked+1) − 0.002·최소간격
 *
 * 결정론: tileId 로 완전 순서화된 순회, rng 를 쓰지 않는다. 부동소수는 + − × ÷ 만 쓴다(IEEE 754 로 플랫폼 불문 동일).
 * 스폰 순서는 "배치 순서"가 아니다 — 균형 스왑 뒤에는 앞 N개가 좋은 부분집합이라는 성질이 없다. 프리셋 맵을 만들 때는
 * arrangePresetSpawns 가 순서와 spawnSets 를 따로 정한다.
 */
import type { SquareTopology } from '../topology/square.js';

const INF = 1 << 29;

export const SPAWN_EXPOSURE_RADIUS = 20;
export const SPAWN_MIN_WATER_DIST = 2;
export const SPAWN_BAND_PERCENTILE = 30;
/** 허용 폭 = (적격 칸 l20 최대 − 최소) × 이 값 / 1000 */
export const SPAWN_BAND_TOL_PERMILLE = 40;
export const SPAWN_BAND_MIN_CAND_PER_PLAYER = 6;
export const SPAWN_BALANCE_PASSES = 6;
/** 스폰끼리 최소 맨해튼 거리 (3×3 시작 블록이 겹치지 않도록) */
export const SPAWN_MIN_SEP = 6;

export interface Exposure {
  /** 반경 R 맨해튼 안 육지 칸 수 */
  l20: Int32Array;
  /** 8방향 중 R 칸 안에 물·맵 밖이 나오는 방향 수 (0~8) */
  blocked: Int8Array;
  /** min(x, W-1-x) + min(y, H-1-y) — 작을수록 모서리 */
  edge: Int32Array;
}

const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

export function computeExposure(topo: SquareTopology, land: Uint8Array, landTiles: readonly number[], R: number = SPAWN_EXPOSURE_RADIUS): Exposure {
  const n = topo.tileCount();
  const W = topo.width;
  const H = topo.height;
  const l20 = new Int32Array(n);
  const blocked = new Int8Array(n);
  const edge = new Int32Array(n);
  for (const t of landTiles) {
    const y = Math.floor(t / W);
    const x = t - y * W;
    let c = 0;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) {
      const rem = R - Math.abs(yy - y);
      for (let xx = Math.max(0, x - rem); xx <= Math.min(W - 1, x + rem); xx++) if (land[yy * W + xx]) c++;
    }
    l20[t] = c;
    let b = 0;
    for (const [dy, dx] of DIRS) {
      for (let s = 1; s <= R; s++) {
        const yy = y + dy * s;
        const xx = x + dx * s;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W || !land[yy * W + xx]) {
          b++;
          break;
        }
      }
    }
    blocked[t] = b;
    edge[t] = Math.min(x, W - 1 - x) + Math.min(y, H - 1 - y);
  }
  return { l20, blocked, edge };
}

/** 분산/평균² (평균 0 이면 0) */
function cv2(a: readonly number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  if (m === 0) return 0;
  const v = a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length;
  return v / (m * m);
}

/** 스폰 집합의 불균형 비용 (낮을수록 좋음). nR3 는 라이벌이 3명 미만이면 있는 만큼만 평균 */
export function spawnCost(topo: SquareTopology, ex: Exposure, tiles: readonly number[]): number {
  const n = tiles.length;
  if (n < 2) return 0;
  const nR3: number[] = [];
  const nn: number[] = [];
  let minSep = INF;
  for (let i = 0; i < n; i++) {
    const ds: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) ds.push(topo.distance(tiles[i], tiles[j]));
    ds.sort((a, b) => a - b);
    nn.push(ds[0]);
    if (ds[0] < minSep) minSep = ds[0];
    const k = Math.min(3, ds.length);
    let sum = 0;
    for (let q = 0; q < k; q++) sum += ds[q];
    nR3.push(sum / k);
  }
  return cv2(nR3) + cv2(nn) + cv2(tiles.map((t) => ex.l20[t])) + 0.5 * cv2(tiles.map((t) => ex.blocked[t] + 1)) - 0.002 * minSep;
}

/** 최원점 순차 배치 (cand 순서대로 순회, 동률 = 먼저 만난 칸) */
function farthestPoint(topo: SquareTopology, cand: readonly number[], count: number, first: number): number[] {
  const spawns = [first];
  const minD = new Int32Array(cand.length).fill(INF);
  for (let k = 1; k < count; k++) {
    const last = spawns[spawns.length - 1];
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < cand.length; i++) {
      const d = topo.distance(cand[i], last);
      if (d < minD[i]) minD[i] = d;
      if (minD[i] > bestD) {
        bestD = minD[i];
        best = i;
      }
    }
    spawns.push(cand[best]);
  }
  return spawns;
}

/** 균형 스왑: 스폰 하나씩, 집합 비용이 가장 낮아지는 후보로 교체 */
function balanceSwap(topo: SquareTopology, ex: Exposure, cand: readonly number[], spawns: number[]): number[] {
  const s = spawns.slice();
  const n = s.length;
  let cur = spawnCost(topo, ex, s);
  for (let pass = 0; pass < SPAWN_BALANCE_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      const old = s[i];
      let bestT = old;
      let bestC = cur;
      for (const t of cand) {
        if (t === old) continue;
        let ok = true;
        for (let j = 0; j < n; j++) {
          if (j !== i && topo.distance(t, s[j]) < SPAWN_MIN_SEP) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        s[i] = t;
        const c = spawnCost(topo, ex, s);
        if (c < bestC - 1e-12) {
          bestC = c;
          bestT = t;
        }
      }
      s[i] = bestT;
      if (bestT !== old) {
        cur = bestC;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return s;
}

/**
 * 스폰 count 개를 고른다. 반환 순서 = playerId 1.. 순서(슬롯 번호).
 * land: 육지 마스크(1/0), landTiles: 육지 tileId 오름차순, waterDist: 물까지 거리.
 */
export function selectSpawns(topo: SquareTopology, land: Uint8Array, landTiles: readonly number[], waterDist: Int32Array, count: number): number[] {
  const ex = computeExposure(topo, land, landTiles);
  let elig = landTiles.filter((t) => waterDist[t] >= SPAWN_MIN_WATER_DIST);
  if (elig.length < count * SPAWN_BAND_MIN_CAND_PER_PLAYER) elig = landTiles.slice();
  const sorted = elig.map((t) => ex.l20[t]).sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const target = sorted[Math.min(sorted.length - 1, Math.floor((SPAWN_BAND_PERCENTILE * sorted.length) / 100))];
  let tol = Math.max(1, Math.floor(((hi - lo) * SPAWN_BAND_TOL_PERMILLE) / 1000));
  let cand: number[] = [];
  for (let g = 0; g < 16; g++) {
    cand = elig.filter((t) => Math.abs(ex.l20[t] - target) <= tol);
    if (cand.length >= count * SPAWN_BAND_MIN_CAND_PER_PLAYER) break;
    tol = Math.ceil(tol * 1.5);
  }
  if (cand.length < count) cand = elig;
  const greedy = farthestPoint(topo, cand, count, cand[0]);
  return count >= 3 ? balanceSwap(topo, ex, cand, greedy) : greedy;
}

// ───────────────────────────── 프리셋 제작용 ─────────────────────────────

export interface PresetSpawnArrangement {
  /** 프리셋 spawns[] 순서 (최원점 순 — 앞 N개가 서로 멀다) */
  spawns: number[];
  /** N → spawns[] 인덱스 (비용이 가장 낮은 N-부분집합). 권장 인원 구간 중 max 미만만 */
  spawnSets: Record<string, number[]>;
}

function combinations(n: number, k: number, visit: (idx: number[]) => void): void {
  const idx: number[] = [];
  const rec = (start: number): void => {
    if (idx.length === k) {
      visit(idx);
      return;
    }
    for (let i = start; i <= n - (k - idx.length); i++) {
      idx.push(i);
      rec(i + 1);
      idx.pop();
    }
  };
  rec(0);
}

/**
 * 프리셋 제작: max 인원용으로 고른 스폰 집합을 (1) 최원점 순서로 재배열(기본 규칙 "앞 N개" 가 쓸 만하도록) 하고
 * (2) 권장 인원 N(< max) 마다 비용이 가장 낮은 부분집합을 spawnSets[N] 으로 둔다. 전수 탐색(C(12,N) ≤ 924).
 */
export function arrangePresetSpawns(topo: SquareTopology, ex: Exposure, tiles: readonly number[], recommendedMin: number, recommendedMax: number): PresetSpawnArrangement {
  const max = tiles.length;
  const ordered = farthestPoint(topo, tiles, max, tiles[0]);
  const spawnSets: Record<string, number[]> = {};
  for (let N = Math.max(2, recommendedMin); N <= Math.min(recommendedMax, max - 1); N++) {
    let best: number[] | null = null;
    let bestC = INF;
    combinations(max, N, (idx) => {
      const c = spawnCost(topo, ex, idx.map((i) => ordered[i]));
      if (c < bestC - 1e-12) {
        bestC = c;
        best = idx.slice();
      }
    });
    if (best) spawnSets[String(N)] = best;
  }
  return { spawns: ordered, spawnSets };
}
