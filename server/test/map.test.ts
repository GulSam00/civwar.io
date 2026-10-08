import { describe, expect, it } from 'vitest';
import { MAP_SIZE, MAP_SIZE_PRESETS, TERRAIN, WATER_MODE, isClaimable } from '@civwar/shared';
import { assertInvariants, generateMap, generateMapForPlayers, generateMapForSize } from '../src/map/generate.js';
import { Mulberry32 } from '../src/map/rng.js';

function counts(terrain: Uint8Array): number[] {
  const c = new Array(7).fill(0);
  for (const t of terrain) c[t]++;
  return c;
}

describe('mulberry32', () => {
  it('같은 시드 → 같은 수열', () => {
    const a = new Mulberry32(42);
    const b = new Mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
});

describe('generateMap 결정론', () => {
  it('같은 시드 → 비트 단위로 같은 맵', () => {
    const a = generateMapForPlayers(12345, 10);
    const b = generateMapForPlayers(12345, 10);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
    expect(Buffer.from(a.initialOwners).equals(Buffer.from(b.initialOwners))).toBe(true);
    expect(a.baseTiles).toEqual(b.baseTiles);
    expect(a.spawns).toEqual(b.spawns);
    expect(a.seed).toBe(b.seed);
  });
  it('다른 시드 → 다른 맵', () => {
    const a = generateMapForPlayers(1, 10);
    const b = generateMapForPlayers(2, 10);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(false);
  });
  it('SHALLOW_QUOTA 는 물만 바꾸고 육지·기지·스폰은 BORDER_ONLY 와 동일 (rng 마지막 소비)', () => {
    const a = generateMapForPlayers(777, 10);
    const b = generateMapForPlayers(777, 10, { waterMode: WATER_MODE.SHALLOW_QUOTA, shallowPermille: 250 });
    expect(b.seed).toBe(a.seed);
    for (let t = 0; t < a.terrain.length; t++) {
      if (isClaimable(a.terrain[t])) expect(b.terrain[t]).toBe(a.terrain[t]);
      else expect(isClaimable(b.terrain[t])).toBe(false);
    }
    expect(b.baseTiles).toEqual(a.baseTiles);
    expect(b.spawns).toEqual(a.spawns);
  });
});

describe('불변식과 지형 쿼터 (인원 8~12 × 시드 3개)', () => {
  for (const N of [8, 9, 10, 11, 12]) {
    for (const seed of [1, 2024, 0xdeadbeef]) {
      it(`N=${N} seed=${seed}`, () => {
        const m = generateMapForPlayers(seed, N);
        expect(() => assertInvariants(m)).not.toThrow();
        const [W, H] = MAP_SIZE[N];
        expect([m.width, m.height]).toEqual([W, H]);
        const c = counts(m.terrain);
        const L = m.totalLandTiles;
        const n = W * H;

        // 육지 비율 0.60~0.70 (1단계 목표)
        expect(L * 1000).toBeGreaterThanOrEqual(600 * n);
        expect(L * 1000).toBeLessThanOrEqual(700 * n);

        // I3: 테두리 = DEEP, 나머지 물 = SHALLOW
        expect(c[TERRAIN.DEEP]).toBe(2 * W + 2 * H - 4);
        expect(c[TERRAIN.SHALLOW]).toBe(n - L - (2 * W + 2 * H - 4));

        // 쿼터 절단: 비옥지·사막은 정확히. 산은 스폰(≤9N)·기지(≤5×2N) 강등만큼만 감소
        expect(m.quotas.mountain).toBe(Math.floor((L * 80) / 1000));
        expect(c[TERRAIN.FERTILE]).toBe(m.quotas.fertile);
        expect(c[TERRAIN.DESERT]).toBe(m.quotas.desert);
        expect(c[TERRAIN.MOUNTAIN]).toBeLessThanOrEqual(m.quotas.mountain);
        expect(c[TERRAIN.MOUNTAIN]).toBeGreaterThanOrEqual(m.quotas.mountain - 9 * N - 10 * N);
        expect(c[TERRAIN.HILLS]).toBeGreaterThanOrEqual(m.quotas.hills);
        const plainPm = Math.floor((c[TERRAIN.PLAIN] * 1000) / L);
        expect(plainPm).toBeGreaterThanOrEqual(370);
        expect(plainPm).toBeLessThanOrEqual(410);

        // 기지 2N, 스폰 N, 스폰 블록 ≤ 9 타일
        expect(m.baseTiles.length).toBe(2 * N);
        expect(m.spawns.length).toBe(N);
        const owned = new Array(N + 1).fill(0);
        for (const o of m.initialOwners) owned[o]++;
        for (let p = 1; p <= N; p++) {
          expect(owned[p]).toBeGreaterThan(0);
          expect(owned[p]).toBeLessThanOrEqual(9);
        }
        // 기지 위·옆에 산 없음 (⑤ 접근성 보정)
        for (const b of m.baseTiles) {
          expect(m.terrain[b]).not.toBe(TERRAIN.MOUNTAIN);
          for (const x of m.topology.adjacent(b)) expect(m.terrain[x]).not.toBe(TERRAIN.MOUNTAIN);
        }
      });
    }
  }

  it('SHALLOW_QUOTA 커스텀: |SHALLOW| == quotaS, 불변식 성립', () => {
    const m = generateMapForPlayers(99, 10, { waterMode: WATER_MODE.SHALLOW_QUOTA, shallowPermille: 400 });
    const c = counts(m.terrain);
    expect(c[TERRAIN.SHALLOW]).toBe(m.quotas.shallow);
    expect(() => assertInvariants(m)).not.toThrow();
  });
});

describe('v4.1 크기 프리셋 S/L · 격자-인원 분리 (2.8 b·c)', () => {
  const cases: [Parameters<typeof generateMapForSize>[1], number][] = [
    ['S', 2], ['S', 5], ['S', 7],
    ['M', 2], ['M', 12],
    ['L', 2], ['L', 11], ['L', 12],
  ];
  for (const [size, N] of cases) {
    for (const seed of [3, 20261009]) {
      it(`${size} × ${N}인 seed=${seed}: 격자·불변식·기지 2N·스폰 N`, () => {
        const m = generateMapForSize(seed, size, N);
        const p = MAP_SIZE_PRESETS[size];
        expect([m.width, m.height]).toEqual([p.w, p.h]);
        expect(() => assertInvariants(m)).not.toThrow();
        expect(m.baseTiles.length).toBe(2 * N);
        expect(m.spawns.length).toBe(N);
        const n = p.w * p.h;
        expect(m.totalLandTiles * 1000).toBeGreaterThanOrEqual(600 * n);
        expect(m.totalLandTiles * 1000).toBeLessThanOrEqual(700 * n);
        expect(m.source).toEqual({ kind: 'random' });
      });
    }
  }
  it('같은 격자·인원이면 generateMap(W,H,N) == generateMapForPlayers(N) (v4.0 맵 비트 보존)', () => {
    const a = generateMap(4242, 90, 54, 8);
    const b = generateMapForPlayers(4242, 8);
    expect([...a.terrain]).toEqual([...b.terrain]);
    expect(a.spawns).toEqual(b.spawns);
  });
});
