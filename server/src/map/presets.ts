/**
 * 공식 프리셋 맵 (GDD v4.1 2.8 f, [A-48]).
 *
 * - 서버 배포물 `server/maps/official/<id>.json`, 1맵 1파일. 클라이언트에는 map_init 이 지금과 같은 형태로 간다 → 형식은 서버 전용.
 * - 로더는 **스키마 형식 + checksum 만** 확인한다(게임 규칙 검사 없음 — 공식 맵은 제작 시 2.4 불변식을 통과한 후보만 채택).
 *   형식 오류·checksum 불일치는 예외 → 서버 기동 실패.
 * - checksum = "sha256:" + hex( sha256( UTF-8( JSON.stringify({ terrain, spawns, bases }) ) ) )
 *   (terrain = 파일의 RLE 배열 그대로, spawns·bases = 파일 배열 그대로. 키 순서 고정)
 * - 스폰 부분집합: N < players.max 이면 spawnSets[N] → 없으면 spawns[0..N-1].
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_GEN_DEFAULT,
  MAP_SIZE_PRESETS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SPAWN_BLOCK,
  TERRAIN_COUNT,
  WATER_MODE,
  isClaimable,
  rleDecode,
  rleEncode,
  type MapGenConfig,
  type MapSizeClass,
  type OfficialMapInfo,
} from '@civwar/shared';
import { SquareTopology, TerrainGraph } from '../topology/square.js';
import { bfs, type GeneratedMap } from './generate.js';

export const PRESET_SCHEMA_VERSION = 1;
/** 기본 공식 맵 디렉터리 (server/maps/official) */
export const OFFICIAL_MAPS_DIR = fileURLToPath(new URL('../../maps/official/', import.meta.url));

export interface PresetMapFile {
  schemaVersion: 1;
  id: string;
  name: { ko: string; en: string };
  topology: 'square';
  width: number;
  height: number;
  sizeClass: MapSizeClass;
  players: { min: number; recommendedMin: number; recommendedMax: number; max: number };
  terrain: number[]; // RLE
  spawns: number[]; // 길이 = players.max, 순서 = spawnOrder
  spawnSets?: Record<string, number[]>;
  bases: number[];
  origin?: { generator: string; seed: number; genConfig: { waterMode: 'BORDER_ONLY' | 'SHALLOW_QUOTA'; shallowPermille: number } };
  checksum: string;
}

export class PresetFormatError extends Error {}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const ID_RE = /^[a-z0-9-]+$/;

export function presetChecksum(p: Pick<PresetMapFile, 'terrain' | 'spawns' | 'bases'>): string {
  const body = JSON.stringify({ terrain: p.terrain, spawns: p.spawns, bases: p.bases });
  return 'sha256:' + createHash('sha256').update(body, 'utf8').digest('hex');
}

/** 형식 검증. 통과하면 PresetMapFile 로 좁혀진 값, 아니면 PresetFormatError */
export function validatePreset(raw: unknown, expectedId?: string): PresetMapFile {
  const fail = (m: string): never => {
    throw new PresetFormatError(`preset ${expectedId ?? '?'}: ${m}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('not an object');
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== PRESET_SCHEMA_VERSION) fail(`schemaVersion must be ${PRESET_SCHEMA_VERSION}`);
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) fail('id must match [a-z0-9-]+');
  if (expectedId !== undefined && o.id !== expectedId) fail(`id ${String(o.id)} != file name`);
  const name = o.name as Record<string, unknown> | undefined;
  if (!name || typeof name.ko !== 'string' || typeof name.en !== 'string') fail('name.ko/en must be strings');
  if (o.topology !== 'square') fail('topology must be "square"');
  const W = o.width;
  const H = o.height;
  if (!isInt(W) || !isInt(H) || W < 8 || H < 8 || W > 1024 || H > 1024) fail('width/height');
  if (o.sizeClass !== 'S' && o.sizeClass !== 'M' && o.sizeClass !== 'L') fail('sizeClass must be S|M|L');
  const pl = o.players as Record<string, unknown> | undefined;
  if (!pl || ![pl.min, pl.recommendedMin, pl.recommendedMax, pl.max].every(isInt)) fail('players.{min,recommendedMin,recommendedMax,max} must be ints');
  const pmin = pl!.min as number;
  const prMin = pl!.recommendedMin as number;
  const prMax = pl!.recommendedMax as number;
  const pmax = pl!.max as number;
  if (!(MIN_PLAYERS <= pmin && pmin <= prMin && prMin <= prMax && prMax <= pmax && pmax <= MAX_PLAYERS)) fail('players range');
  const n = (W as number) * (H as number);
  if (!Array.isArray(o.terrain) || !o.terrain.every(isInt)) fail('terrain must be int array (RLE)');
  let terrain: Uint8Array;
  try {
    terrain = rleDecode(o.terrain as number[], n);
  } catch (e) {
    return fail(`terrain RLE: ${(e as Error).message}`);
  }
  for (let i = 0; i < (o.terrain as number[]).length; i += 2) {
    const v = (o.terrain as number[])[i];
    const run = (o.terrain as number[])[i + 1];
    if (v < 0 || v >= TERRAIN_COUNT) fail(`terrain value ${v} out of 0..${TERRAIN_COUNT - 1}`);
    if (!(run > 0)) fail('terrain run length must be > 0');
  }
  const tileOk = (t: unknown): t is number => isInt(t) && t >= 0 && t < n && isClaimable(terrain[t]);
  if (!Array.isArray(o.spawns) || o.spawns.length !== pmax || !o.spawns.every(tileOk)) fail('spawns: length == players.max, land tileIds');
  if (new Set(o.spawns as number[]).size !== pmax) fail('spawns must be distinct');
  if (!Array.isArray(o.bases) || !o.bases.every(tileOk)) fail('bases: land tileIds');
  if (new Set(o.bases as number[]).size !== (o.bases as number[]).length) fail('bases must be distinct');
  if (o.spawnSets !== undefined) {
    if (typeof o.spawnSets !== 'object' || o.spawnSets === null || Array.isArray(o.spawnSets)) fail('spawnSets must be an object');
    for (const [k, v] of Object.entries(o.spawnSets as Record<string, unknown>)) {
      const N = Number(k);
      if (!isInt(N) || String(N) !== k || N < pmin || N > pmax) fail(`spawnSets key ${k}`);
      if (!Array.isArray(v) || v.length !== N || !v.every((i) => isInt(i) && i >= 0 && i < pmax) || new Set(v).size !== N) fail(`spawnSets[${k}]`);
    }
  }
  if (o.origin !== undefined) {
    const og = o.origin as Record<string, unknown>;
    const gc = og.genConfig as Record<string, unknown> | undefined;
    if (typeof og.generator !== 'string' || !isInt(og.seed) || !gc || (gc.waterMode !== 'BORDER_ONLY' && gc.waterMode !== 'SHALLOW_QUOTA') || !isInt(gc.shallowPermille)) fail('origin');
  }
  if (typeof o.checksum !== 'string') fail('checksum must be string');
  const p = o as unknown as PresetMapFile;
  const want = presetChecksum(p);
  if (p.checksum !== want) fail(`checksum mismatch (file ${p.checksum}, computed ${want})`);
  return p;
}

export function presetInfo(p: PresetMapFile): OfficialMapInfo {
  return { id: p.id, name: { ko: p.name.ko, en: p.name.en }, sizeClass: p.sizeClass, players: { ...p.players }, checksum: p.checksum };
}

/** N 인 게임이 쓸 스폰 인덱스 (2.8 f 부분집합 규칙) */
export function presetSpawnIndices(p: PresetMapFile, N: number): number[] {
  const set = p.spawnSets?.[String(N)];
  if (set) return set.slice();
  return Array.from({ length: N }, (_, i) => i);
}

/** 최소 시작 인원 = max(2, players.min) */
export function presetMinPlayers(p: PresetMapFile): number {
  return Math.max(MIN_PLAYERS, p.players.min);
}

/**
 * 프리셋 → 게임용 GeneratedMap (N = 시작 인원). 지형은 파일 그대로(스폰 블록 산 강등 등은 제작 시 이미 반영).
 * - 기지 = 파일 bases ∪ 사용 스폰 칸(수도는 항상 기지 — 2.6 ①). 안 쓰는 스폰 칸이 bases 에 있으면 중립 기지로 남는다.
 * - 초기 영토 = 사용 스폰마다 SPAWN_BLOCK×SPAWN_BLOCK 블록의 육지 (2.4 3단계와 같은 규칙).
 */
export function mapFromPreset(p: PresetMapFile, N: number): GeneratedMap {
  if (!isInt(N) || N < presetMinPlayers(p) || N > p.players.max) throw new Error(`preset ${p.id}: N=${N} out of ${presetMinPlayers(p)}..${p.players.max}`);
  const topo = new SquareTopology(p.width, p.height);
  const n = topo.tileCount();
  const terrain = rleDecode(p.terrain, n);
  const idx = presetSpawnIndices(p, N);
  const spawnTiles = idx.map((i) => p.spawns[i]);
  const isBase = new Uint8Array(n);
  for (const b of p.bases) isBase[b] = 1;
  for (const s of spawnTiles) isBase[s] = 1;
  const baseTiles: number[] = [];
  for (let t = 0; t < n; t++) if (isBase[t]) baseTiles.push(t);
  const initialOwners = new Uint8Array(n);
  const spawns = spawnTiles.map((tileId, i) => ({ playerId: i + 1, tileId, homeTileId: tileId }));
  for (const s of spawns) {
    for (const t of topo.block(s.homeTileId, SPAWN_BLOCK)) if (isClaimable(terrain[t])) initialOwners[t] = s.playerId;
  }
  let L = 0;
  const water: number[] = [];
  for (let t = 0; t < n; t++) {
    if (isClaimable(terrain[t])) L++;
    else water.push(t);
  }
  const gc = p.origin?.genConfig;
  const config: MapGenConfig = gc
    ? { waterMode: gc.waterMode === 'SHALLOW_QUOTA' ? WATER_MODE.SHALLOW_QUOTA : WATER_MODE.BORDER_ONLY, shallowPermille: gc.shallowPermille }
    : { ...MAP_GEN_DEFAULT };
  const seed = p.origin?.seed ?? 0;
  return {
    requestedSeed: seed,
    seed,
    width: p.width,
    height: p.height,
    playerCount: N,
    config,
    topology: topo,
    graph: new TerrainGraph(topo, terrain),
    terrain,
    isBase,
    baseTiles,
    totalLandTiles: L,
    spawns,
    initialOwners,
    waterDist: bfs(topo, water, () => true),
    quotas: { mountain: 0, hills: 0, fertile: 0, desert: 0, shallow: null },
    source: { kind: 'preset', mapId: p.id },
  };
}

/**
 * 생성기 출력 → 프리셋 파일 (제작 도구용, 2.8 f "제작 = 1회성 작업").
 * map 은 players.max 인원으로 생성한 것이어야 한다(spawns 길이 = max). spawns 순서 = 생성기의 최원점 배치 순서
 * (첫 스폰 = 물에서 가장 먼 칸, 이후 기존 스폰들로부터 가장 먼 칸) → 앞쪽 N개가 서로 멀다.
 */
export function presetFromMap(
  map: GeneratedMap,
  meta: { id: string; name: { ko: string; en: string }; sizeClass: MapSizeClass; players?: PresetMapFile['players']; generator?: string },
): PresetMapFile {
  const sz = MAP_SIZE_PRESETS[meta.sizeClass];
  const players = meta.players ?? { min: MIN_PLAYERS, recommendedMin: sz.recommended[0], recommendedMax: sz.recommended[1], max: sz.max };
  if (map.spawns.length !== players.max) throw new Error(`map has ${map.spawns.length} spawns, players.max = ${players.max}`);
  const body = {
    terrain: rleEncode(map.terrain),
    spawns: map.spawns.map((s) => s.homeTileId),
    bases: map.baseTiles.slice(),
  };
  const file: PresetMapFile = {
    schemaVersion: 1,
    id: meta.id,
    name: meta.name,
    topology: 'square',
    width: map.width,
    height: map.height,
    sizeClass: meta.sizeClass,
    players,
    ...body,
    origin: {
      generator: meta.generator ?? 'v4.5', // v4.5: 물 ≈ 10%·통행 불가 생성기
      seed: map.seed,
      genConfig: { waterMode: map.config.waterMode === WATER_MODE.SHALLOW_QUOTA ? 'SHALLOW_QUOTA' : 'BORDER_ONLY', shallowPermille: map.config.shallowPermille },
    },
    checksum: presetChecksum(body),
  };
  return validatePreset(file, meta.id);
}

/** 공식 맵 카탈로그 — 서버 기동 시 1회 로드. 형식 오류·checksum 불일치면 예외(기동 실패) */
export class MapCatalog {
  private readonly byId = new Map<string, PresetMapFile>();

  constructor(files: readonly PresetMapFile[] = []) {
    for (const f of files) {
      if (this.byId.has(f.id)) throw new PresetFormatError(`duplicate preset id ${f.id}`);
      this.byId.set(f.id, f);
    }
  }

  static loadDir(dir: string = OFFICIAL_MAPS_DIR): MapCatalog {
    if (!existsSync(dir)) return new MapCatalog();
    const files: PresetMapFile[] = [];
    for (const name of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const id = basename(name, '.json');
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
      files.push(validatePreset(raw, id));
    }
    return new MapCatalog(files);
  }

  get(id: string): PresetMapFile | undefined {
    return this.byId.get(id);
  }

  /** welcome.officialMaps — id ASC */
  list(): OfficialMapInfo[] {
    return [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(presetInfo);
  }
}
