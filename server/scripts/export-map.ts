/**
 * 생성기 출력 → 공식 프리셋 맵 JSON (GDD v4.1 2.8 f, [A-48]) 내보내기.
 *
 * 사용 (레포 루트에서):
 *   npx tsx server/scripts/export-map.ts --size M --seed 123 --id official-m-01 --name-ko "쌍둥이 만" --name-en "Twin Bays"
 *   npx tsx server/scripts/export-map.ts --size S --seed 1000 --count 50            # 후보 50개 (seed 1000..1049)
 *
 * 옵션
 *   --size S|M|L          크기 프리셋 (필수). 생성 인원 = 프리셋 최대 인원(S 7 / M 12 / L 12) → spawns 길이 = players.max
 *   --seed N              시작 시드 (기본 1)
 *   --count K             연속 시드 K개 (기본 1)
 *   --id ID               맵 id = 파일명 ([a-z0-9-]). count > 1 이면 `${id}-${seed}`. 기본 `cand-<size>-<seed>`
 *   --name-ko / --name-en 표시 이름 (기본 id)
 *   --water BORDER_ONLY | SHALLOW_QUOTA:<permille>   물 구성 (기본 BORDER_ONLY)
 *   --out DIR             출력 디렉터리 (기본 server/maps/candidates). 공식 채택 = 파일을 server/maps/official/ 로 옮기고
 *                         id 를 파일명과 같게 고친다(checksum 은 terrain+spawns+bases 만 덮으므로 id·name 수정은 무방)
 *
 * v4.9 (§30): 스폰 순서(최원점 순)와 권장 인원별 최적 부분집합(spawnSets)은 노출도 비용으로 자동 계산해 파일에 싣는다.
 *   후보 선별은 `node server/scripts/eval-maps.cjs <후보 디렉터리> [상위 N]` (노출도 균등 점수, 낮을수록 좋음).
 *
 * 출력: 파일마다 한 줄 요약(시드, 실제 사용 시드, 육지, 기지, 스폰 최소 간격, 앞 2개 스폰 간격) — 후보 선별용.
 * 생성 불변식(2.4 I1~I4, 기지 2N)은 generateMap 이 보장한다(실패 시 seed+1). 로더는 형식·checksum 만 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_GEN_DEFAULT, MAP_SIZE_PRESETS, WATER_MODE, type MapGenConfig, type MapSizeClass } from '@civwar/shared';
import { isClaimable } from '@civwar/shared';
import { generateMapForSize } from '../src/map/generate.js';
import { arrangePresetSpawns, computeExposure } from '../src/map/spawnSelect.js';
import { presetFromMap } from '../src/map/presets.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseWater(v: string | undefined): MapGenConfig {
  if (!v || v === 'BORDER_ONLY') return { ...MAP_GEN_DEFAULT };
  const m = /^SHALLOW_QUOTA:(\d{1,4})$/.exec(v);
  if (!m || Number(m[1]) > 1000) throw new Error(`--water must be BORDER_ONLY or SHALLOW_QUOTA:<0..1000>`);
  return { waterMode: WATER_MODE.SHALLOW_QUOTA, shallowPermille: Number(m[1]) };
}

const size = arg('size') as MapSizeClass | undefined;
if (size !== 'S' && size !== 'M' && size !== 'L') {
  console.error('usage: export-map.ts --size S|M|L [--seed N] [--count K] [--id ID] [--name-ko ..] [--name-en ..] [--water ..] [--out DIR]');
  process.exit(2);
}
const seed0 = Number(arg('seed') ?? 1);
const count = Number(arg('count') ?? 1);
const water = parseWater(arg('water'));
const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const outDir = resolve(repoRoot, arg('out') ?? 'server/maps/candidates');
mkdirSync(outDir, { recursive: true });
const preset = MAP_SIZE_PRESETS[size];

for (let k = 0; k < count; k++) {
  const seed = (seed0 + k) >>> 0;
  const baseId = arg('id');
  const id = baseId ? (count > 1 ? `${baseId}-${seed}` : baseId) : `cand-${size.toLowerCase()}-${seed}`;
  const map = generateMapForSize(seed, size, preset.max, water);
  // v4.9 (§30): 스폰 순서(최원점 순)와 권장 인원별 최적 부분집합(spawnSets)을 노출도 비용으로 정한다
  const landMask = new Uint8Array(map.terrain.length);
  const landTiles: number[] = [];
  for (let t = 0; t < map.terrain.length; t++) if (isClaimable(map.terrain[t])) (landMask[t] = 1), landTiles.push(t);
  const ex = computeExposure(map.topology, landMask, landTiles);
  const arrangement = arrangePresetSpawns(map.topology, ex, map.spawns.map((s) => s.homeTileId), preset.recommended[0], preset.recommended[1]);
  const file = presetFromMap(map, { id, name: { ko: arg('name-ko') ?? id, en: arg('name-en') ?? id }, sizeClass: size, arrangement });
  const path = join(outDir, `${id}.json`);
  writeFileSync(path, JSON.stringify(file) + '\n', 'utf8');
  let minSep = Infinity;
  for (let i = 0; i < file.spawns.length; i++)
    for (let j = i + 1; j < file.spawns.length; j++) minSep = Math.min(minSep, map.topology.distance(file.spawns[i], file.spawns[j]));
  const sep01 = map.topology.distance(file.spawns[0], file.spawns[1]);
  console.log(
    `${id}  seed=${seed} used=${map.seed}  ${map.width}x${map.height}  land=${map.totalLandTiles}  bases=${file.bases.length}  spawns=${file.spawns.length}  minSpawnSep=${minSep}  sep[0,1]=${sep01}  -> ${path}`,
  );
}
