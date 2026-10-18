import { MAP_GEN_DEFAULT, isClaimable } from '@civwar/shared';
import { generateMapForSize } from '../src/map/generate.js';
import { MapCatalog, mapFromPreset } from '../src/map/presets.js';
const cat = MapCatalog.loadDir();
let bad = 0;
for (const id of ['official-s-01','official-s-02','official-s-03','official-m-01','official-m-02','official-m-03','official-l-01','official-l-02','official-l-03']) {
  const m = mapFromPreset(cat.get(id)!, 6);
  let c = 0; for (const t of m.terrain) if (isClaimable(t)) c++;
  if (c !== m.totalLandTiles) { bad++; console.log('FAIL', id, c, m.totalLandTiles); }
}
for (let s = 1; s <= 30; s++) for (const sz of ['S','M','L'] as const) {
  const m = generateMapForSize(s * 104729, sz, 8, MAP_GEN_DEFAULT);
  let c = 0; for (const t of m.terrain) if (isClaimable(t)) c++;
  if (c !== m.totalLandTiles) { bad++; console.log('FAIL rnd', s, sz, c, m.totalLandTiles); }
}
console.log(bad ? 'FAIL' : 'totalLandTiles = 육지 칸 수 (공식 9 + 무작위 90) 전부 일치');
