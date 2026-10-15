/**
 * 맵 생성 (GDD v4.0 2.4 + v2.1 2.6 placeBases, v4.1 2.8 c: 격자 W×H 를 인자로 받는다).
 *
 * v4.1 확인: 인원 의존 파라미터는 스폰 수(placeSpawns 의 count — 최원점 순차 배치, 고정 간격 상수 없음)와
 * 기지 수(수도 N + 셀당 1개 = 2N)뿐이며 둘 다 N 만 받는다. 격자 크기는 1단계 육지 비율(permille)·지형 쿼터(육지 비례)로만 들어가므로
 * "인원 → 격자" lookup 을 인자로 바꿔도 다른 단계는 수정이 필요 없다.
 *
 * 이 파일은 "사각 구현체 내부"로 취급한다 — 격자 전용 헬퍼(count8, block)를 직접 쓴다(GDD 2.2 규칙 3).
 * 결정론: mulberry32 만 사용, 모든 정렬은 tileId/playerId 로 완전 순서화, 부동소수 없음.
 * rng 소비 순서: 1단계(육지/물) → (a)산 blob → (c)비옥지 blob → (d)사막 blob → [4단계 SHALLOW_QUOTA blob]
 */
import {
  BASE_CONTEST_W,
  BASE_MAX_CAPITAL_DIST,
  BASE_MIN_CAPITAL_DIST,
  BASE_MIN_SEP,
  BASE_MIN_WATER_DIST,
  BASE_RELAX_MIN_CAPITAL_DIST,
  BASE_RELAX_MIN_SEP,
  BASE_RELAX_MIN_WATER_DIST,
  CA_INIT_LAND_P_PERMILLE,
  CA_LAND_NEIGHBOR_MIN,
  CA_LAND_P_STEP_PERMILLE,
  CA_MAX_ATTEMPTS,
  CA_SMOOTH_STEPS,
  LAND_RATIO_MAX_PERMILLE,
  LAND_RATIO_MIN_PERMILLE,
  MAPGEN_MAX_SEED_RETRIES,
  MAP_GEN_DEFAULT,
  MAP_SIZE,
  MAP_SIZE_PRESETS,
  type MapSizeClass,
  SPAWN_BLOCK,
  TERRAIN,
  TERRAIN_GEN,
  TERRAIN_SHARE_PERMILLE,
  WATER_MODE,
  isClaimable,
  type MapGenConfig,
} from '@civwar/shared';
import { SquareTopology, TerrainGraph } from '../topology/square.js';
import { Mulberry32 } from './rng.js';

export const INF = 1 << 29;

export interface SpawnPlacement {
  playerId: number;
  tileId: number;
  homeTileId: number;
}

export interface GeneratedMap {
  requestedSeed: number;
  /** 불변식 실패로 seed+k 재생성했으면 실제 사용된 시드 */
  seed: number;
  width: number;
  height: number;
  playerCount: number;
  config: MapGenConfig;
  topology: SquareTopology;
  graph: TerrainGraph;
  terrain: Uint8Array;
  isBase: Uint8Array;
  /** tileId 오름차순 */
  baseTiles: number[];
  totalLandTiles: number;
  spawns: SpawnPlacement[];
  /** 매치 시작 owner (스폰 3×3 블록) */
  initialOwners: Uint8Array;
  /** 분할 전 물(DEEP ∪ SHALLOW) 거리 — 테스트·디버그용 */
  waterDist: Int32Array;
  /** 지형 쿼터 (스폰/기지 산 강등 전) — 테스트용. 프리셋 맵은 전부 0/null */
  quotas: { mountain: number; hills: number; fertile: number; desert: number; shallow: number | null };
  /** v4.1: 맵 출처 (match_config.mapSource / mapId) */
  source: { kind: 'random' } | { kind: 'preset'; mapId: string };
}

export class InvariantError extends Error {}

// ───────────────────────────── 유틸 ─────────────────────────────

export function bfs(
  topo: SquareTopology,
  sources: readonly number[],
  allowed: (t: number) => boolean,
): Int32Array {
  const n = topo.tileCount();
  const dist = new Int32Array(n).fill(INF);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (dist[s] !== 0) {
      dist[s] = 0;
      queue[tail++] = s;
    }
  }
  while (head < tail) {
    const t = queue[head++];
    const d = dist[t] + 1;
    for (const x of topo.adjacent(t)) {
      if (dist[x] > d && allowed(x)) {
        dist[x] = d;
        queue[tail++] = x;
      }
    }
  }
  return dist;
}

function caBlob(rng: Mulberry32, topo: SquareTopology, p0Permille: number, steps: number): Uint8Array {
  const n = topo.tileCount();
  let b = new Uint8Array(n);
  for (let t = 0; t < n; t++) b[t] = rng.chance(p0Permille) ? 1 : 0; // tileId 오름차순 = 결정론
  for (let s = 0; s < steps; s++) {
    const cur = b;
    const next = new Uint8Array(n);
    for (let t = 0; t < n; t++) next[t] = topo.count8(t, (x) => cur[x] === 1) >= CA_LAND_NEIGHBOR_MIN ? 1 : 0;
    b = next;
  }
  return b;
}

function density8(topo: SquareTopology, blob: Uint8Array): Uint8Array {
  const n = topo.tileCount();
  const d = new Uint8Array(n);
  for (let t = 0; t < n; t++) d[t] = topo.count8(t, (x) => blob[x] === 1);
  return d;
}

// ───────────────────────────── 1단계: 육지/물 ─────────────────────────────

/**
 * v4.5 (사용자 2026-10-15, 프로토콜 §22): 물 ≈ 10% (테두리 포함), 물은 통행 불가 → 육지는 반드시 한 덩어리.
 * [A-102] 호수 생성: 반해상도 격자(⌈W/2⌉×⌈H/2⌉)에 물 노이즈(1 − p) → CA_SMOOTH_STEPS 번 "물 이웃 ≥ 5 → 물"(반해상도 테두리 = 육지)
 *   → 2배 확대 → 전해상도 다듬기 2번(물 이웃 ≥ 5 → 물, ≤ 3 → 육지, 그 밖 유지 — 맵 테두리는 이웃 계산에서 육지 취급)
 *   → 맵 테두리 = 물 → 최대 4-연결 육지 덩어리만 남김(나머지 섬은 물 — 육지 연결 보장, 불변식 I1).
 *   육지 비율이 [LAND_RATIO_MIN, LAND_RATIO_MAX] 밖이면 p ± CA_LAND_P_STEP 로 다시(최대 CA_MAX_ATTEMPTS, 마지막 결과 사용).
 * 결과: 큰 호수 몇 개(M 평균 7~8개, 최대 ~100칸) — 작은 웅덩이 대신 지형 장애물 역할.
 */
function generateLand(rng: Mulberry32, topo: SquareTopology): Uint8Array {
  const n = topo.tileCount();
  const W = topo.width;
  const H = topo.height;
  const w2 = Math.ceil(W / 2);
  const h2 = Math.ceil(H / 2);
  const half = new SquareTopology(w2, h2);
  const n2 = w2 * h2;
  let p = CA_INIT_LAND_P_PERMILLE;
  let land = new Uint8Array(n);
  for (let attempt = 0; attempt < CA_MAX_ATTEMPTS; attempt++) {
    // (1) 반해상도 호수 노이즈 + CA
    let c = new Uint8Array(n2);
    for (let t = 0; t < n2; t++) c[t] = rng.chance(1000 - p) ? 1 : 0; // 1 = 물
    for (let s = 0; s < CA_SMOOTH_STEPS; s++) {
      const cur = c;
      const next = new Uint8Array(n2);
      for (let t = 0; t < n2; t++) next[t] = !half.isBorder(t) && half.count8(t, (x) => cur[x] === 1) >= CA_LAND_NEIGHBOR_MIN ? 1 : 0;
      c = next;
    }
    // (2) 확대 + 전해상도 다듬기
    let water = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      const r = Math.floor(t / W);
      const col = t - r * W;
      water[t] = c[(r >> 1) * w2 + (col >> 1)];
    }
    for (let s = 0; s < 2; s++) {
      const cur = water;
      const next = new Uint8Array(n);
      for (let t = 0; t < n; t++) {
        if (topo.isBorder(t)) continue;
        const k = topo.count8(t, (x) => !topo.isBorder(x) && cur[x] === 1);
        next[t] = k >= CA_LAND_NEIGHBOR_MIN ? 1 : k <= 3 ? 0 : cur[t];
      }
      water = next;
    }
    land = new Uint8Array(n);
    for (let t = 0; t < n; t++) land[t] = !topo.isBorder(t) && water[t] === 0 ? 1 : 0;
    // (3) 최대 4-연결 육지 컴포넌트만 남긴다 (불변식 I1 의 근거). 동률이면 먼저(작은 tileId) 발견된 것.
    const comp = new Int32Array(n).fill(-1);
    let bestId = -1;
    let bestSize = 0;
    let cid = 0;
    const stack: number[] = [];
    for (let t = 0; t < n; t++) {
      if (land[t] !== 1 || comp[t] !== -1) continue;
      let size = 0;
      comp[t] = cid;
      stack.push(t);
      while (stack.length) {
        const x = stack.pop()!;
        size++;
        for (const y of topo.adjacent(x)) {
          if (land[y] === 1 && comp[y] === -1) {
            comp[y] = cid;
            stack.push(y);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        bestId = cid;
      }
      cid++;
    }
    for (let t = 0; t < n; t++) land[t] = land[t] === 1 && comp[t] === bestId ? 1 : 0;
    const ratioPm = Math.floor((bestSize * 1000) / n);
    if (ratioPm >= LAND_RATIO_MIN_PERMILLE && ratioPm <= LAND_RATIO_MAX_PERMILLE) break;
    p += ratioPm < LAND_RATIO_MIN_PERMILLE ? CA_LAND_P_STEP_PERMILLE : -CA_LAND_P_STEP_PERMILLE;
  }
  return land;
}

// ───────────────────────────── 3단계: 스폰 ─────────────────────────────

function placeSpawns(topo: SquareTopology, landTiles: readonly number[], waterDist: Int32Array, count: number): number[] {
  let first = -1;
  for (const t of landTiles) if (first === -1 || waterDist[t] > waterDist[first]) first = t; // 오름차순 순회 → 동률 tileId 최소
  const spawns = [first];
  const minD = new Int32Array(topo.tileCount()).fill(INF);
  for (let k = 1; k < count; k++) {
    const last = spawns[spawns.length - 1];
    let best = -1;
    for (const t of landTiles) {
      const d = topo.distance(t, last);
      if (d < minD[t]) minD[t] = d;
      if (best === -1 || minD[t] > minD[best]) best = t;
    }
    spawns.push(best);
  }
  return spawns;
}

// ───────────────────────────── 3단계: 기지 (v2.1 2.6) ─────────────────────────────

function placeBases(
  topo: SquareTopology,
  terrain: Uint8Array,
  land: Uint8Array,
  landTiles: readonly number[],
  waterDist: Int32Array,
  capitals: readonly number[], // index = playerId-1
): Uint8Array {
  const n = topo.tileCount();
  const N = capitals.length;
  const isBase = new Uint8Array(n);
  const bases: number[] = [];
  for (const c of capitals) {
    isBase[c] = 1; // ① 수도 = 최초 기지
    bases.push(c);
  }

  // ② 수도별 육지 BFS → cell(최근접 수도, 동률 playerId 최소) / contest = 2nd - 1st
  const dists = capitals.map((c) => bfs(topo, [c], (x) => land[x] === 1));
  const cell = new Int32Array(n).fill(-1);
  const capDist = new Int32Array(n).fill(INF);
  const contest = new Int32Array(n).fill(INF);
  for (const t of landTiles) {
    let b1 = INF;
    let b2 = INF;
    let who = -1;
    for (let i = 0; i < N; i++) {
      const d = dists[i][t];
      if (d < b1) {
        b2 = b1;
        b1 = d;
        who = i;
      } else if (d < b2) {
        b2 = d;
      }
    }
    cell[t] = who;
    capDist[t] = b1;
    contest[t] = b2 >= INF ? INF : b2 - b1;
  }

  const cellSize = new Int32Array(N);
  for (const t of landTiles) cellSize[cell[t]]++;
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => cellSize[a] - cellSize[b] || a - b);

  const minDistToBases = (t: number): number => {
    let m = INF;
    for (const b of bases) {
      const d = topo.distance(t, b);
      if (d < m) m = d;
    }
    return m;
  };

  for (const i of order) {
    const cap = capitals[i];
    let chosen = -1;
    // 완화 사다리: 0 = 원래 조건, 1..4 = 한 단계씩 누적 완화, 5 = 항상 성공 폴백
    for (let level = 0; level <= 4 && chosen === -1; level++) {
      const sep = level >= 1 ? BASE_RELAX_MIN_SEP : BASE_MIN_SEP;
      const minCap = level >= 2 ? BASE_RELAX_MIN_CAPITAL_DIST : BASE_MIN_CAPITAL_DIST;
      const maxCap = level >= 3 ? INF : BASE_MAX_CAPITAL_DIST;
      const minWater = level >= 4 ? BASE_RELAX_MIN_WATER_DIST : BASE_MIN_WATER_DIST;
      let bestScore = -1;
      let bestContest = INF;
      for (const t of landTiles) {
        if (cell[t] !== i || isBase[t] === 1) continue;
        if (terrain[t] === TERRAIN.MOUNTAIN || waterDist[t] < minWater) continue;
        const dc = topo.distance(t, cap);
        if (dc < minCap || dc > maxCap) continue;
        const mdb = minDistToBases(t);
        if (mdb < sep) continue;
        const score = Math.floor((mdb * 1000) / (10 + BASE_CONTEST_W * contest[t]));
        // (score DESC, contest ASC, t ASC) — landTiles 오름차순 순회이므로 엄격 비교로 t ASC 보장
        if (score > bestScore || (score === bestScore && contest[t] < bestContest)) {
          bestScore = score;
          bestContest = contest[t];
          chosen = t;
        }
      }
    }
    if (chosen === -1) {
      let far = -1;
      for (const t of landTiles) {
        if (cell[t] !== i || isBase[t] === 1) continue;
        if (far === -1 || topo.distance(t, cap) > topo.distance(far, cap)) far = t;
      }
      if (far === -1) throw new InvariantError(`placeBases: cell ${i + 1} has no free land`);
      chosen = far;
    }
    isBase[chosen] = 1;
    bases.push(chosen);
  }

  // ⑤ 접근성 보정 — 기지와 인접 산 → 언덕
  const sorted = bases.slice().sort((a, b) => a - b);
  for (const b of sorted) {
    for (const t of [b, ...topo.adjacent(b)]) {
      if (terrain[t] === TERRAIN.MOUNTAIN) terrain[t] = TERRAIN.HILLS;
    }
  }
  return isBase;
}

// ───────────────────────────── 메인 ─────────────────────────────

function generateOnce(seed: number, W: number, H: number, playerCount: number, cfg: MapGenConfig): GeneratedMap {
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 8 || H < 8) throw new Error(`bad grid ${W}x${H}`);
  if (!Number.isInteger(playerCount) || playerCount < 1) throw new Error(`bad playerCount ${playerCount}`);
  const topo = new SquareTopology(W, H);
  const n = topo.tileCount();
  const rng = new Mulberry32(seed);

  // 1단계
  const land = generateLand(rng, topo);
  const landTiles: number[] = [];
  const waterTiles: number[] = [];
  for (let t = 0; t < n; t++) (land[t] ? landTiles : waterTiles).push(t);
  const L = landTiles.length;

  // 2단계: 지형 배분. 물은 일단 DEEP(0) 으로 표기, 4단계에서 분할
  const terrain = new Uint8Array(n);
  for (const t of landTiles) terrain[t] = TERRAIN.PLAIN;
  const waterDist = bfs(topo, waterTiles, () => true);

  // (a) 산
  const densM = density8(topo, caBlob(rng, topo, TERRAIN_GEN.MOUNTAIN_BLOB_P_PERMILLE, TERRAIN_GEN.MOUNTAIN_BLOB_STEPS));
  const quotaM = Math.floor((L * TERRAIN_SHARE_PERMILLE.MOUNTAIN) / 1000);
  const scoreM = (t: number) => densM[t] * 100000 + waterDist[t];
  const mountains = landTiles.slice().sort((a, b) => scoreM(b) - scoreM(a) || a - b).slice(0, quotaM);
  for (const t of mountains) terrain[t] = TERRAIN.MOUNTAIN;

  // (b) 언덕 — 산 둘레 링부터 (육지 위 BFS)
  const ringDist = bfs(topo, mountains, (x) => land[x] === 1);
  const quotaH = Math.floor((L * TERRAIN_SHARE_PERMILLE.HILLS) / 1000);
  const hills = landTiles
    .filter((t) => terrain[t] === TERRAIN.PLAIN)
    .sort((a, b) => ringDist[a] - ringDist[b] || a - b)
    .slice(0, quotaH);
  for (const t of hills) terrain[t] = TERRAIN.HILLS;

  // (c) 비옥지 — 해안 평야
  const densF = density8(topo, caBlob(rng, topo, TERRAIN_GEN.FERTILE_BLOB_P_PERMILLE, TERRAIN_GEN.FERTILE_BLOB_STEPS));
  const quotaF = Math.floor((L * TERRAIN_SHARE_PERMILLE.FERTILE) / 1000);
  let maxWd: number = TERRAIN_GEN.FERTILE_WATER_DIST_MAX;
  let candF: number[] = [];
  for (;;) {
    candF = landTiles.filter(
      (t) => terrain[t] === TERRAIN.PLAIN && waterDist[t] >= TERRAIN_GEN.FERTILE_WATER_DIST_MIN && waterDist[t] <= maxWd,
    );
    if (candF.length >= quotaF || maxWd >= INF - 1) break;
    // GDD: 3 까지 확장. 그래도 부족하면(이론상) 계속 확장 — 백엔드 보강
    maxWd = maxWd < TERRAIN_GEN.FERTILE_WATER_DIST_FALLBACK_MAX ? TERRAIN_GEN.FERTILE_WATER_DIST_FALLBACK_MAX : maxWd + 1;
    if (maxWd > n) break;
  }
  const fertile = candF
    .sort((a, b) => densF[b] - densF[a] || waterDist[a] - waterDist[b] || a - b)
    .slice(0, quotaF);
  for (const t of fertile) terrain[t] = TERRAIN.FERTILE;

  // (d) 사막 — 내륙 완충
  const densD = density8(topo, caBlob(rng, topo, TERRAIN_GEN.DESERT_BLOB_P_PERMILLE, TERRAIN_GEN.DESERT_BLOB_STEPS));
  const quotaD = Math.floor((L * TERRAIN_SHARE_PERMILLE.DESERT) / 1000);
  const deserts = landTiles
    .filter((t) => terrain[t] === TERRAIN.PLAIN)
    .sort((a, b) => densD[b] - densD[a] || waterDist[b] - waterDist[a] || a - b)
    .slice(0, quotaD);
  for (const t of deserts) terrain[t] = TERRAIN.DESERT;
  // (e) 나머지 = 평원

  // 3단계: 스폰 · 기지
  const spawnTiles = placeSpawns(topo, landTiles, waterDist, playerCount);
  const initialOwners = new Uint8Array(n);
  const spawns: SpawnPlacement[] = spawnTiles.map((tileId, i) => ({ playerId: i + 1, tileId, homeTileId: tileId }));
  for (const s of spawns) {
    for (const t of topo.block(s.homeTileId, SPAWN_BLOCK)) {
      if (!land[t]) continue;
      initialOwners[t] = s.playerId;
      if (terrain[t] === TERRAIN.MOUNTAIN) terrain[t] = TERRAIN.PLAIN; // 시작부터 갇히는 것 방지
    }
  }
  const isBase = placeBases(topo, terrain, land, landTiles, waterDist, spawnTiles);

  // 4단계: 물 분할 — 반드시 맨 뒤. rng 를 마지막에 소비
  let quotaS: number | null = null;
  if (cfg.waterMode === WATER_MODE.BORDER_ONLY) {
    for (const t of waterTiles) terrain[t] = topo.isBorder(t) ? TERRAIN.DEEP : TERRAIN.SHALLOW;
  } else {
    const landDist = bfs(topo, landTiles, (x) => land[x] === 0);
    const densS = density8(topo, caBlob(rng, topo, TERRAIN_GEN.SHALLOW_BLOB_P_PERMILLE, TERRAIN_GEN.SHALLOW_BLOB_STEPS));
    const interior = waterTiles.filter((t) => !topo.isBorder(t));
    quotaS = Math.floor((interior.length * cfg.shallowPermille) / 1000);
    const shallow = interior
      .sort((a, b) => landDist[a] - landDist[b] || densS[b] - densS[a] || a - b)
      .slice(0, quotaS);
    for (const t of waterTiles) terrain[t] = TERRAIN.DEEP;
    for (const t of shallow) terrain[t] = TERRAIN.SHALLOW;
  }

  const graph = new TerrainGraph(topo, terrain);
  const baseTiles: number[] = [];
  for (let t = 0; t < n; t++) if (isBase[t]) baseTiles.push(t);

  const map: GeneratedMap = {
    requestedSeed: seed,
    seed,
    width: W,
    height: H,
    playerCount,
    config: { ...cfg },
    topology: topo,
    graph,
    terrain,
    isBase,
    baseTiles,
    totalLandTiles: L,
    spawns,
    initialOwners,
    waterDist,
    quotas: { mountain: quotaM, hills: quotaH, fertile: quotaF, desert: quotaD, shallow: quotaS },
    source: { kind: 'random' },
  };
  assertInvariants(map);
  return map;
}

/** 생성 불변식 I1~I4 (+ 기지·스폰 정합성). 실패 시 InvariantError */
export function assertInvariants(map: GeneratedMap): void {
  const { topology: topo, terrain, totalLandTiles: L, graph } = map;
  const n = topo.tileCount();
  const landTiles: number[] = [];
  for (let t = 0; t < n; t++) if (isClaimable(terrain[t])) landTiles.push(t);
  if (landTiles.length !== L) throw new InvariantError(`land count ${landTiles.length} != L ${L}`);

  // I1 육지 연결성: 육지만 밟아 전부 도달
  const d1 = bfs(topo, [landTiles[0]], (x) => isClaimable(terrain[x]));
  for (const t of landTiles) if (d1[t] >= INF) throw new InvariantError(`I1: land ${t} unreachable`);

  // I2 얕은 물은 육지에서 얕은 물만 밟아 도달 가능
  const d2 = bfs(topo, landTiles, (x) => terrain[x] === TERRAIN.SHALLOW);
  let shallowCount = 0;
  let deepCount = 0;
  for (let t = 0; t < n; t++) {
    if (terrain[t] === TERRAIN.SHALLOW) {
      shallowCount++;
      if (d2[t] >= INF) throw new InvariantError(`I2: shallow ${t} isolated`);
    } else if (terrain[t] === TERRAIN.DEEP) deepCount++;
  }

  // I3 개수
  if (map.config.waterMode === WATER_MODE.BORDER_ONLY) {
    const border = 2 * map.width + 2 * map.height - 4;
    if (deepCount !== border) throw new InvariantError(`I3: deep ${deepCount} != border ${border}`);
    for (let t = 0; t < n; t++) {
      if (topo.isBorder(t) && terrain[t] !== TERRAIN.DEEP) throw new InvariantError(`I3: border ${t} not DEEP`);
    }
  } else if (shallowCount !== map.quotas.shallow) {
    throw new InvariantError(`I3: shallow ${shallowCount} != quota ${map.quotas.shallow}`);
  }

  // I4 깊은 물 제외 이동 그래프에서도 모든 육지 도달 (graph.neighbors 경유)
  const seen = new Uint8Array(n);
  const q = [landTiles[0]];
  seen[landTiles[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    for (const x of graph.neighbors(q[h])) {
      if (!seen[x]) {
        seen[x] = 1;
        q.push(x);
      }
    }
  }
  for (const t of landTiles) if (!seen[t]) throw new InvariantError(`I4: land ${t} unreachable on move graph`);

  // 기지·스폰 정합성
  if (map.baseTiles.length !== 2 * map.playerCount) {
    throw new InvariantError(`bases ${map.baseTiles.length} != 2N`);
  }
  for (const b of map.baseTiles) if (!isClaimable(terrain[b])) throw new InvariantError(`base ${b} on water`);
  for (const s of map.spawns) {
    if (!map.isBase[s.homeTileId] || map.initialOwners[s.homeTileId] !== s.playerId) {
      throw new InvariantError(`spawn ${s.playerId} home invalid`);
    }
  }
}

/**
 * generateMap(seed, W, H, N, cfg) — GDD 2.8 (c) 호출 규약. W×H = 크기 프리셋(또는 임의 격자), N = 시작 시점 실제 인원.
 * 불변식 실패 시 seed+1 로 재생성 (GDD 2.4).
 */
export function generateMap(seed: number, W: number, H: number, playerCount: number, cfg: MapGenConfig = MAP_GEN_DEFAULT): GeneratedMap {
  let lastErr: unknown;
  for (let k = 0; k < MAPGEN_MAX_SEED_RETRIES; k++) {
    const s = (seed + k) >>> 0;
    try {
      const map = generateOnce(s, W, H, playerCount, cfg);
      map.requestedSeed = seed >>> 0;
      return map;
    } catch (e) {
      if (!(e instanceof InvariantError)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/** 크기 프리셋 S/M/L 로 생성 (2.8 b) */
export function generateMapForSize(seed: number, size: MapSizeClass, playerCount: number, cfg: MapGenConfig = MAP_GEN_DEFAULT): GeneratedMap {
  const p = MAP_SIZE_PRESETS[size];
  return generateMap(seed, p.w, p.h, playerCount, cfg);
}

/** 테스트·스크립트 편의: 2.3 "인원별 기본 크기" 표(MAP_SIZE, 8~12인)로 격자를 고른다. 서버 룸은 쓰지 않는다 */
export function generateMapForPlayers(seed: number, playerCount: number, cfg: MapGenConfig = MAP_GEN_DEFAULT): GeneratedMap {
  const size = MAP_SIZE[playerCount];
  if (!size) throw new Error(`no default grid for ${playerCount} players`);
  return generateMap(seed, size[0], size[1], playerCount, cfg);
}
