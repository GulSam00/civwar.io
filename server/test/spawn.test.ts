/**
 * v4.9 (§30) — 노출도 균등 스폰 선택 · 공식 맵 재선정 검증.
 * 행동 균형(스폰별 점유율 CV)은 자가대전 하네스로만 잴 수 있어 여기서는 "구조적 성질"만 본다:
 * 스폰 노출도(l20) 균등, 중앙 제외, 최소 간격·물 거리, 기지 배치 제약, 결정론, 프리셋 spawnSets.
 */
import { describe, expect, it } from 'vitest';
import { MAP_SIZE_PRESETS, isClaimable, type MapSizeClass } from '@civwar/shared';
import { generateMap, type GeneratedMap } from '../src/map/generate.js';
import { MapCatalog, mapFromPreset, presetSpawnIndices } from '../src/map/presets.js';
import { arrangePresetSpawns, computeExposure, SPAWN_MIN_SEP, SPAWN_MIN_WATER_DIST, spawnCost } from '../src/map/spawnSelect.js';

function exposureOf(m: GeneratedMap) {
  const land = new Uint8Array(m.terrain.length);
  const tiles: number[] = [];
  for (let t = 0; t < land.length; t++) if (isClaimable(m.terrain[t])) (land[t] = 1), tiles.push(t);
  return { ex: computeExposure(m.topology, land, tiles), tiles };
}

function cv(a: number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m;
}

const CASES: [MapSizeClass, number][] = [
  ['S', 2],
  ['S', 6],
  ['M', 3],
  ['M', 10],
  ['L', 12],
];

describe('스폰 선택 — 노출도 균등 (§30)', () => {
  for (const [size, N] of CASES) {
    it(`${size} × ${N}인, 시드 6개: 스폰 l20 변동계수 ≤ 0.06 · 최소 간격 · 물 거리 · 중앙 제외`, () => {
      const P = MAP_SIZE_PRESETS[size];
      for (const seed of [1, 7, 42, 2024, 5000, 99999]) {
        const m = generateMap(seed, P.w, P.h, N);
        const { ex, tiles } = exposureOf(m);
        const sp = m.spawns.map((s) => s.tileId);
        expect(sp.length).toBe(N);
        expect(new Set(sp).size).toBe(N);
        // 노출도 균등: 스폰 l20 의 변동계수 (옛 규칙은 중앙+모서리라 0.3 이상)
        expect(cv(sp.map((t) => ex.l20[t]))).toBeLessThanOrEqual(0.06);
        // 중앙 제외: 옛 규칙의 첫 스폰(물에서 가장 먼 칸)이 스폰이 아니고, 스폰 l20 이 육지 l20 최댓값보다 한참 작다
        let far = tiles[0];
        for (const t of tiles) if (m.waterDist[t] > m.waterDist[far]) far = t;
        expect(sp).not.toContain(far);
        const maxL20 = Math.max(...tiles.map((t) => ex.l20[t]));
        for (const t of sp) expect(ex.l20[t]).toBeLessThan(maxL20 * 0.9);
        // 간격·물 거리
        for (let i = 0; i < N; i++) {
          expect(m.waterDist[sp[i]]).toBeGreaterThanOrEqual(SPAWN_MIN_WATER_DIST);
          for (let j = i + 1; j < N; j++) expect(m.topology.distance(sp[i], sp[j])).toBeGreaterThanOrEqual(SPAWN_MIN_SEP);
        }
        // 3×3 시작 블록이 서로 겹치지 않는다
        const owned = new Array(N + 1).fill(0);
        for (const o of m.initialOwners) owned[o]++;
        for (let p = 1; p <= N; p++) expect(owned[p]).toBeGreaterThan(0);
      }
    });
  }

  it('기지 배치 재검증: 중립 기지는 수도와 12~24, 기지 간 12 이상, 물에서 2 이상 (완화 사다리 없이)', () => {
    for (const [size, N] of [['S', 6], ['M', 10], ['L', 12]] as [MapSizeClass, number][]) {
      const P = MAP_SIZE_PRESETS[size];
      for (const seed of [3, 11, 500, 8080]) {
        const m = generateMap(seed, P.w, P.h, N);
        const caps = m.spawns.map((s) => s.tileId);
        expect(m.baseTiles.length).toBe(2 * N);
        for (const b of m.baseTiles) {
          if (caps.includes(b)) continue;
          const dc = Math.min(...caps.map((c) => m.topology.distance(b, c)));
          const ds = Math.min(...m.baseTiles.filter((x) => x !== b).map((x) => m.topology.distance(b, x)));
          expect(dc).toBeGreaterThanOrEqual(12);
          expect(dc).toBeLessThanOrEqual(24);
          expect(ds).toBeGreaterThanOrEqual(12);
          expect(m.waterDist[b]).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('결정론: 같은 시드 → 같은 스폰·같은 슬롯 순서', () => {
    const a = generateMap(31337, 100, 60, 10);
    const b = generateMap(31337, 100, 60, 10);
    expect(a.spawns).toEqual(b.spawns);
    const c = generateMap(31338, 100, 60, 10);
    expect(c.spawns).not.toEqual(a.spawns);
  });
});

describe('arrangePresetSpawns', () => {
  it('순서는 입력의 순열, spawnSets[N] 은 길이 N 의 서로 다른 인덱스이고 앞 N개보다 비용이 낮거나 같다', () => {
    const m = generateMap(2007, 100, 60, 12);
    const { ex } = exposureOf(m);
    const tiles = m.spawns.map((s) => s.tileId);
    const arr = arrangePresetSpawns(m.topology, ex, tiles, 9, 11);
    expect([...arr.spawns].sort((a, b) => a - b)).toEqual([...tiles].sort((a, b) => a - b));
    expect(Object.keys(arr.spawnSets).sort()).toEqual(['10', '11', '9']);
    for (const [k, idx] of Object.entries(arr.spawnSets)) {
      const N = Number(k);
      expect(idx.length).toBe(N);
      expect(new Set(idx).size).toBe(N);
      expect(idx.every((i) => i >= 0 && i < 12)).toBe(true);
      const sub = spawnCost(m.topology, ex, idx.map((i) => arr.spawns[i]));
      const prefix = spawnCost(m.topology, ex, arr.spawns.slice(0, N));
      expect(sub).toBeLessThanOrEqual(prefix + 1e-9);
    }
  });
});

describe('공식 맵 9장 — 노출도 균등 재선정 (§30)', () => {
  const catalog = MapCatalog.loadDir();
  const REC: Record<string, [number, number]> = { S: [5, 6], M: [9, 11], L: [11, 12] };
  for (const info of catalog.list()) {
    it(`${info.id}: 권장 인원 구간에서 스폰 l20 변동계수 ≤ 0.06, spawnSets 가 있으면 형식 일치`, () => {
      const p = catalog.get(info.id)!;
      const [lo, hi] = REC[p.sizeClass];
      for (let N = lo; N <= hi; N++) {
        const m = mapFromPreset(p, N);
        const { ex } = exposureOf(m);
        const sp = m.spawns.map((s) => s.tileId);
        expect(sp.length).toBe(N);
        expect(cv(sp.map((t) => ex.l20[t]))).toBeLessThanOrEqual(0.06);
        for (const t of sp) expect(m.waterDist[t]).toBeGreaterThanOrEqual(SPAWN_MIN_WATER_DIST);
        const idx = presetSpawnIndices(p, N);
        expect(idx.length).toBe(N);
      }
      // 권장 인원 구간에서 max 미만인 N 은 spawnSets 를 가진다 (앞 N개 규칙이 아님)
      for (let N = lo; N < p.players.max && N <= hi; N++) expect(p.spawnSets?.[String(N)]).toBeDefined();
      // 최소 인원(2)은 앞 2개 — 서로 매우 멀다
      const m2 = mapFromPreset(p, 2);
      expect(m2.topology.distance(m2.spawns[0].tileId, m2.spawns[1].tileId)).toBeGreaterThanOrEqual(40);
    });
  }
});
