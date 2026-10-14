/**
 * v4.4 기지 생산력·생산 지역 (사용자 2026-10-14, 프로토콜 §21).
 *
 * 생산 지역 [A-86]: 플레이어의 각 칸은 "내 땅만 밟는 4방향 그래프 거리"로 가장 가까운 내 기지(수도 포함)에 속한다.
 *   동률 = 기지 tileId 가 작은 쪽. 내 기지와 내 땅으로 이어지지 않은 칸(고립지) = "기타"(-1, 생산력 1000).
 *   구현 = 전 플레이어 기지를 tileId ASC 로 넣은 다중 출발 BFS 한 번 (O(타일 수)). 같은 층은 출발 순서대로 묶이므로
 *   먼저 닿은 = tileId 가 작은 기지가 가져간다. 소유권이 바뀐 tick 다음 2단계에서만 다시 계산(regionsDirty).
 *
 * 생산 적용 [A-87]: 지역 r 의 생산 = (생산력 없는 기존 공식의 그 지역 몫) × prodPm_r / 1000.
 *   병력: 기존 regen R(√tiles·로지스틱·테크 — economy.regenMilliPerTick) 을 칸 수 비례로 나눈 몫에 생산력을 곱한다.
 *         총 R' = floor(R × Σ(tiles_r × pm_r) / (tiles × 1000)), 지역 몫은 가중치 tiles_r × pm_r 로 나눈다.
 *   골드: 지역 골드 가중치에 생산력을 곱한 effGW_r = floor(gw_r × pm_r / 1000), 총 그로스 = 기존 식에 Σ effGW_r.
 *         유지비는 총 그로스에 한 번 적용(기존과 같다), 지역 순수입은 그로스 비례로 나눈다.
 *   나눌 때 floor 잔여는 가중치가 가장 큰 지역(동률 = 앞쪽)에 → 지역 합 = 총합 (정확히). 생산력이 전부 1000 이면 기존 값과 같다.
 */
import { GOLD_RATE_PERMILLE, TECH_STAT, TERRAIN_GOLD_MILLI } from '@civwar/shared';
import { garrisonUpkeepPermille, regenMilliPerTick } from './economy.js';
import { NEUTRAL, baseProdPm, type GameState, type PlayerState, type RegionStat, type RegionYield } from './state.js';

/** 생산 지역 다시 계산 (state.regions). 결정론: BFS 출발 = 기지 tileId ASC, 이웃 = graph.neighbors 고정 순서 */
export function recomputeRegions(state: GameState): void {
  const n = state.owners.length;
  const owners = state.owners;
  const regionOf = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (const b of state.map.baseTiles) {
    if (owners[b] === NEUTRAL) continue;
    regionOf[b] = b;
    q[qt++] = b;
  }
  while (qh < qt) {
    const u = q[qh++];
    const o = owners[u];
    const r = regionOf[u];
    for (const v of state.graph.neighbors(u)) {
      if (regionOf[v] !== -1 || owners[v] !== o) continue;
      regionOf[v] = r;
      q[qt++] = v;
    }
  }
  const regions: RegionStat[][] = [];
  const idx: Map<number, RegionStat>[] = [];
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    const list: RegionStat[] = p ? p.baseTiles.map((b) => ({ baseTileId: b, tiles: 0, goldWeight: 0 })) : [];
    list.push({ baseTileId: -1, tiles: 0, goldWeight: 0 });
    regions[id] = list;
    idx[id] = new Map(list.map((r) => [r.baseTileId, r]));
  }
  const terrain = state.map.terrain;
  for (let t = 0; t < n; t++) {
    const o = owners[t];
    if (o === NEUTRAL) continue;
    const r = idx[o].get(regionOf[t])!;
    r.tiles += 1;
    r.goldWeight += TERRAIN_GOLD_MILLI[terrain[t]];
  }
  state.regions = regions;
  state.regionsDirty = false;
}

export function regionsOf(state: GameState, playerId: number): RegionStat[] {
  if (state.regionsDirty || !state.regions[playerId]) recomputeRegions(state);
  return state.regions[playerId];
}

/** total 을 weights 비례로 floor 분배, 잔여는 가중치 최대(동률 = 앞) 항목에. 합 = total. 가중치 합 0 이면 전부 0 (total 은 첫 항목에) */
export function distribute(total: number, weights: readonly number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (W <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const parts = weights.map((w) => Math.floor((total * w) / W));
  let rem = total - parts.reduce((a, b) => a + b, 0);
  if (rem !== 0) {
    let k = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[k]) k = i;
    parts[k] += rem;
    rem = 0;
  }
  return parts;
}

export interface ProductionResult {
  regenMilli: number;
  grossMilli: number;
  netMilli: number;
  upkeepPm: number;
  yields: RegionYield[];
}

/**
 * 2단계 정산값 (상태를 쓰지 않는다 — 지역 캐시 갱신 제외). 기존 economy 식 + 지역 생산력.
 * 지역 목록 = 내 기지 tileId ASC + 기타(칸 > 0 일 때만).
 */
export function computeProduction(state: GameState, p: Readonly<PlayerState>): ProductionResult {
  const regs = regionsOf(state, p.id).filter((r) => r.baseTileId >= 0 || r.tiles > 0);
  const pms = regs.map((r) => (r.baseTileId >= 0 ? baseProdPm(state.bases[state.baseIndexOf.get(r.baseTileId)!]) : 1000));
  // 병력
  const R = regenMilliPerTick(p);
  const wT = regs.map((r, i) => r.tiles * pms[i]);
  const sumWT = wT.reduce((a, b) => a + b, 0);
  const regenMilli = p.tiles > 0 ? Math.floor((R * sumWT) / (p.tiles * 1000)) : 0;
  const troops = distribute(regenMilli, wT);
  // 골드
  const goldPm = p.statPm[TECH_STAT.GOLD];
  const effGW = regs.map((r, i) => Math.floor((r.goldWeight * pms[i]) / 1000));
  const sumGW = effGW.reduce((a, b) => a + b, 0);
  const grossMilli = Math.floor((sumGW * GOLD_RATE_PERMILLE * goldPm) / 1_000_000_000);
  const upkeepPm = garrisonUpkeepPermille(state, p);
  const netMilli = grossMilli - Math.floor((grossMilli * upkeepPm) / 1000);
  const gross = distribute(grossMilli, effGW);
  const net = distribute(netMilli, gross);
  const yields: RegionYield[] = regs.map((r, i) => ({
    baseTileId: r.baseTileId,
    tiles: r.tiles,
    prodPm: pms[i],
    troopsMilli: troops[i],
    goldGrossMilli: gross[i],
    goldNetMilli: net[i],
  }));
  return { regenMilli, grossMilli, netMilli, upkeepPm, yields };
}
