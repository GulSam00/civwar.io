/**
 * [QA v4.5 — 커밋 금지] 공식 맵 9장: checksum 재계산, 물 통행 불가, 육지 한 덩어리, 물 비율, 스폰·기지 육지, 문서 표(§30.5)와 대조.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rleDecode, isClaimable, TERRAIN } from '@civwar/shared';
import { OFFICIAL_MAPS_DIR, presetChecksum, MapCatalog, mapFromPreset } from '../src/map/presets.js';
import { SquareTopology, TerrainGraph } from '../src/topology/square.js';
import { createGameState } from '../src/game/state.js';

const DOC: Record<string, [number, number, number]> = {
  // v4.9 (§30): 노출도 균등 스폰으로 재선정 (후보 시드 2000~2059)
  'official-s-01': [2028, 2765, 8.6], 'official-s-02': [2001, 2695, 10.9], 'official-s-03': [2059, 2692, 11.0],
  'official-m-01': [2040, 5429, 9.5], 'official-m-02': [2029, 5485, 8.6], 'official-m-03': [2022, 5366, 10.6],
  'official-l-01': [2036, 6478, 9.1], 'official-l-02': [2021, 6432, 9.8], 'official-l-03': [2012, 6368, 10.7],
};
let bad = 0;
const ok = (n: string, c: boolean, d = '') => { if (!c) bad++; console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : ' — ' + d}`); };
const files = readdirSync(OFFICIAL_MAPS_DIR).filter((f) => f.endsWith('.json')).sort();
ok(`공식 맵 파일 9장 (${files.length})`, files.length === 9);
const cat = MapCatalog.loadDir(); // checksum 불일치면 예외
for (const f of files) {
  const raw = JSON.parse(readFileSync(join(OFFICIAL_MAPS_DIR, f), 'utf8'));
  const id = raw.id as string;
  ok(`${id} checksum 재계산 일치`, presetChecksum(raw) === raw.checksum);
  const terrain = rleDecode(raw.terrain, raw.width * raw.height);
  const n = terrain.length;
  let land = 0, water = 0;
  for (let i = 0; i < n; i++) (isClaimable(terrain[i]) ? land++ : water++);
  const [seed, dl, dw] = DOC[id];
  const wp = Math.round((water / n) * 1000) / 10;
  ok(`${id} 문서 표(§30.5)와 일치: 시드 ${seed}, 육지 ${dl}, 물 ${dw}%`, raw.origin?.seed === seed && land === dl && Math.abs(wp - dw) < 0.06, `seed ${raw.origin?.seed} land ${land} water ${wp}%`);
  ok(`${id} origin.generator = v4.9`, raw.origin?.generator === 'v4.9', String(raw.origin?.generator));
  ok(`${id} 물 비율 8.5~11.5%`, wp >= 8.5 && wp <= 11.5, `${wp}`);
  const topo = new SquareTopology(raw.width, raw.height);
  const graph = new TerrainGraph(topo, terrain);
  let waterNb = 0;
  for (let t = 0; t < n; t++) {
    if (!isClaimable(terrain[t])) { if (graph.neighbors(t).length) waterNb++; continue; }
    for (const x of graph.neighbors(t)) if (!isClaimable(terrain[x])) waterNb++;
  }
  ok(`${id} 이동 그래프에 물 칸 없음 (물 칸 이웃/물로 가는 간선 0)`, waterNb === 0, `${waterNb}`);
  // 육지 연결(4방향 = 이동)
  const seen = new Uint8Array(n);
  let comps = 0;
  const sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!isClaimable(terrain[s]) || seen[s]) continue;
    comps++;
    let c = 0;
    const q = [s]; seen[s] = 1;
    for (let i = 0; i < q.length; i++) { c++; for (const x of graph.neighbors(q[i])) if (!seen[x]) { seen[x] = 1; q.push(x); } }
    sizes.push(c);
  }
  ok(`${id} 육지 한 덩어리 (comps ${comps} sizes ${sizes.join(',')})`, comps === 1);
  const spawnLand = raw.spawns.every((t: number) => isClaimable(terrain[t])) && raw.bases.every((t: number) => isClaimable(terrain[t]));
  ok(`${id} 스폰·기지 모두 육지`, spawnLand);
  // 모든 스폰이 이동 그래프 연결 (한 덩어리이므로 자명하지만 거리 확인)
  for (const N of [raw.players.min, raw.players.recommendedMax, raw.players.max]) {
    const map = mapFromPreset(cat.get(id)!, N);
    const st = createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), 'NORMAL', 1);
    ok(`${id} N=${N} 게임 상태 생성 + 스폰 간 도달 가능`, st.players.filter(Boolean).every((p) => st.graph.distance(st.players[1].homeTileId, p.homeTileId) < 100000), '');
  }
}
console.log(bad ? `\n${bad} 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
