import { MAP_GEN_DEFAULT, WATER_MODE, isClaimable } from '@civwar/shared';
import { generateMapForSize } from '../src/map/generate.js';
import { SquareTopology, TerrainGraph } from '../src/topology/square.js';
let bad = 0, n = 0, minW = 100, maxW = 0, retried = 0;
const cfgs = [MAP_GEN_DEFAULT, { waterMode: WATER_MODE.SHALLOW_QUOTA, shallowPermille: 400 }] as const;
for (let s = 1; s <= 70; s++) for (const sz of ['S','M','L'] as const) for (const cfg of cfgs) {
  const N = sz === 'S' ? 2 + (s % 6) : 2 + (s % 11);
  const seed = s * 7907 + 13;
  const m = generateMapForSize(seed, sz, N, cfg as never);
  n++;
  if ((m as any).requestedSeed !== undefined && (m as any).requestedSeed !== m.seed) retried++;
  const T = m.terrain.length; let land = 0; for (const t of m.terrain) if (isClaimable(t)) land++;
  const w = ((T - land) / T) * 100; minW = Math.min(minW, w); maxW = Math.max(maxW, w);
  const g = new TerrainGraph(new SquareTopology(m.width, m.height), m.terrain);
  let wn = 0, start = -1;
  for (let t = 0; t < T; t++) { if (!isClaimable(m.terrain[t])) { if (g.neighbors(t).length) wn++; } else { if (start < 0) start = t; for (const x of g.neighbors(t)) if (!isClaimable(m.terrain[x])) wn++; } }
  const seen = new Uint8Array(T); const q = [start]; seen[start] = 1;
  for (let i = 0; i < q.length; i++) for (const x of g.neighbors(q[i])) if (!seen[x]) { seen[x] = 1; q.push(x); }
  const spawnsOk = m.spawns.every((p) => seen[p.tileId]) && m.baseTiles.every((b) => seen[b]);
  if (q.length !== land || wn || !spawnsOk || w < 8.5 || w > 11.5) { bad++; if (bad < 8) console.log('FAIL', sz, seed, N, JSON.stringify(cfg), 'comp', q.length, 'land', land, 'waterEdges', wn, 'spawns', spawnsOk, 'w%', w.toFixed(2)); }
}
console.log(`${n}개 무작위 맵: 실패 ${bad}, 물 ${minW.toFixed(2)}~${maxW.toFixed(2)}%, 불변식 재시도 ${retried}`);
