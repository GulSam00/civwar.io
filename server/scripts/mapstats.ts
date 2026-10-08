/** 맵 생성 통계 — 재생성(seed+1) 빈도, 생성 시간, 지형 분포 확인용 */
import { generateMap } from '../src/map/generate.js';

let retries = 0;
const t0 = Date.now();
let maps = 0;
for (const N of [8, 10, 12]) {
  for (let seed = 0; seed < 40; seed++) {
    const m = generateMap(seed, N);
    maps++;
    if (m.seed !== seed) retries++;
  }
}
const m = generateMap(12345, 10);
const c = new Array(7).fill(0);
for (const t of m.terrain) c[t]++;
console.log({ maps, retries, avgMs: Math.round((Date.now() - t0) / maps), L: m.totalLandTiles, countsByTerrain: c, bases: m.baseTiles.length });
