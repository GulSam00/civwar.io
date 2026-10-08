/**
 * 방 설정 (GDD v4.1 2.8 / 7.2a, [A-45]~[A-50]).
 * 형식·범위 검증은 여기서 한다(net/validate.ts 는 모양만 넘긴다) — 위반은 전부 error BAD_ROOM_OPTIONS / MAP_NOT_FOUND.
 */
import {
  BOT_DIFFICULTY,
  BOT_DIFFICULTY_DEFAULT,
  MAP_GEN_DEFAULT,
  MAP_SIZE_PRESETS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PUBLIC_ROOM_PLAYERS,
  PUBLIC_ROOM_SIZE,
  TARGET_LAND_RATIO_PERMILLE,
  WATER_MODE,
  type BotDifficultyName,
  type ErrorCode,
  type MapChoice,
  type MapGenConfig,
  type MapSizeClass,
  type RoomSettingsEcho,
  isClaimable,
  rleDecode,
} from '@civwar/shared';
import type { MapCatalog, PresetMapFile } from '../map/presets.js';
import { presetMinPlayers } from '../map/presets.js';

export type RoomMapSetting = { kind: 'random'; size: MapSizeClass; water: MapGenConfig } | { kind: 'preset'; mapId: string };

export interface RoomSettings {
  map: RoomMapSetting;
  maxPlayers: number;
  botCount: number;
  botDifficulty: BotDifficultyName;
}

/** 페이싱 보증 설정 = 보통 크기 · 기본 물 · 10인 · NORMAL (2.8 a) */
export const PACING_GUARANTEE_PLAYERS = PUBLIC_ROOM_PLAYERS;
/** 추정식 T ≈ 29.4 × (P / 390)^0.75 (2.8 e, 표시용 — 시뮬레이션에 쓰지 않으므로 부동소수 허용) */
const PACING_T_BASE_MIN = 29.4;
const PACING_P_REF = 390;
const PACING_EXP = 0.75;
const PACING_HARD_MIN = 32;

export function defaultPrivateSettings(): RoomSettings {
  return { map: { kind: 'random', size: 'M', water: { ...MAP_GEN_DEFAULT } }, maxPlayers: PACING_GUARANTEE_PLAYERS, botCount: 0, botDifficulty: BOT_DIFFICULTY_DEFAULT };
}

/** 공개 방: 무작위·보통·기본 물·10인·NORMAL 봇 충원 (2.8 h) — 옵션을 받지 않는다 */
export function publicSettings(): RoomSettings {
  return { map: { kind: 'random', size: PUBLIC_ROOM_SIZE, water: { ...MAP_GEN_DEFAULT } }, maxPlayers: PUBLIC_ROOM_PLAYERS, botCount: 0, botDifficulty: BOT_DIFFICULTY_DEFAULT };
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type SettingsResult = { ok: true; settings: RoomSettings } | { ok: false; code: ErrorCode; message: string };

function parseWater(v: unknown): MapGenConfig | null {
  if (v === undefined) return { ...MAP_GEN_DEFAULT };
  if (!isObj(v)) return null;
  let mode: MapGenConfig['waterMode'];
  if (v.waterMode === 'BORDER_ONLY') mode = WATER_MODE.BORDER_ONLY;
  else if (v.waterMode === 'SHALLOW_QUOTA') mode = WATER_MODE.SHALLOW_QUOTA;
  else return null;
  const sp = v.shallowPermille === undefined ? MAP_GEN_DEFAULT.shallowPermille : v.shallowPermille;
  if (!isInt(sp) || sp < 0 || sp > 1000) return null;
  return { waterMode: mode, shallowPermille: sp };
}

/** 맵 최대 인원 / 추천 범위 */
export function mapLimits(map: RoomMapSetting, catalog: MapCatalog): { max: number; recommended: [number, number]; min: number } {
  if (map.kind === 'random') {
    const p = MAP_SIZE_PRESETS[map.size];
    return { max: Math.min(MAX_PLAYERS, p.max), recommended: [p.recommended[0], p.recommended[1]], min: MIN_PLAYERS };
  }
  const f = catalog.get(map.mapId)!;
  return { max: Math.min(MAX_PLAYERS, f.players.max), recommended: [f.players.recommendedMin, f.players.recommendedMax], min: presetMinPlayers(f) };
}

/**
 * 옵션 적용. base = 현재 설정(생성 시 기본값). 생략 필드는 base 유지.
 * - maxPlayers 를 생략했는데 base 값이 새 맵 최대를 넘으면 맵 최대로 낮춘다(명시 값이 넘으면 거절).
 * - botCount 를 생략했는데 base 값이 maxPlayers − 1 을 넘으면 maxPlayers − 1 로 낮춘다.
 * - legacyTargetPlayers(구 targetPlayers) 는 maxPlayers 가 없을 때만 maxPlayers 로 읽는다.
 */
export function applyRoomOptions(raw: Record<string, unknown>, base: RoomSettings, catalog: MapCatalog, humanCount: number, allowLegacy: boolean): SettingsResult {
  const bad = (message: string): SettingsResult => ({ ok: false, code: 'BAD_ROOM_OPTIONS', message });
  let map = base.map;
  if (raw.map !== undefined) {
    const m = raw.map;
    if (!isObj(m)) return bad('map must be an object');
    if (m.kind === 'random') {
      const size = m.size === undefined ? 'M' : m.size;
      if (size !== 'S' && size !== 'M' && size !== 'L') return bad('map.size must be S|M|L');
      const water = parseWater(m.water);
      if (!water) return bad('map.water invalid');
      map = { kind: 'random', size, water };
    } else if (m.kind === 'preset') {
      if (typeof m.mapId !== 'string') return bad('map.mapId must be string');
      if (!catalog.get(m.mapId)) return { ok: false, code: 'MAP_NOT_FOUND', message: `map ${m.mapId} not found` };
      map = { kind: 'preset', mapId: m.mapId };
    } else return bad('map.kind must be random|preset');
  }
  const lim = mapLimits(map, catalog);

  let maxPlayers: number;
  if (raw.maxPlayers !== undefined) {
    if (!isInt(raw.maxPlayers)) return bad('maxPlayers must be int');
    maxPlayers = raw.maxPlayers;
  } else if (allowLegacy && raw.targetPlayers !== undefined) {
    if (!isInt(raw.targetPlayers)) return bad('targetPlayers must be int');
    maxPlayers = raw.targetPlayers;
  } else {
    maxPlayers = Math.min(base.maxPlayers, lim.max);
  }
  if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) return bad(`maxPlayers must be ${MIN_PLAYERS}..${MAX_PLAYERS}`);
  if (maxPlayers > lim.max) return bad(`maxPlayers ${maxPlayers} > map max ${lim.max}`);
  if (maxPlayers < humanCount) return bad(`maxPlayers ${maxPlayers} < current humans ${humanCount}`);

  let botCount: number;
  if (raw.botCount !== undefined) {
    if (!isInt(raw.botCount) || raw.botCount < 0 || raw.botCount > maxPlayers - 1) return bad(`botCount must be 0..${maxPlayers - 1}`);
    botCount = raw.botCount;
  } else botCount = Math.min(base.botCount, maxPlayers - 1);

  let botDifficulty = base.botDifficulty;
  if (raw.botDifficulty !== undefined) {
    if (typeof raw.botDifficulty !== 'string' || !(raw.botDifficulty in BOT_DIFFICULTY)) return bad('botDifficulty must be EASY|NORMAL|HARD');
    botDifficulty = raw.botDifficulty as BotDifficultyName;
  }
  return { ok: true, settings: { map, maxPlayers, botCount, botDifficulty } };
}

/** 시작 시 실제 인원 — 공개 방: 정원(빈자리 봇), 비공개: 사람 + min(botCount, maxPlayers − 사람) */
export function plannedPlayers(s: RoomSettings, humans: number, isPublic: boolean): { total: number; bots: number } {
  if (isPublic) return { total: s.maxPlayers, bots: Math.max(0, s.maxPlayers - humans) };
  const bots = Math.max(0, Math.min(s.botCount, s.maxPlayers - humans));
  return { total: humans + bots, bots };
}

const landCache = new WeakMap<PresetMapFile, number>();
function presetLand(f: PresetMapFile): number {
  let v = landCache.get(f);
  if (v === undefined) {
    v = 0;
    for (const x of rleDecode(f.terrain, f.width * f.height)) if (isClaimable(x)) v++;
    landCache.set(f, v);
  }
  return v;
}

/** 2.8 (e) 추정 — "guaranteed" | "estimate:<분>" | "timeout_likely" */
export function pacingNote(s: RoomSettings, N: number, catalog: MapCatalog): string {
  const isDefaultWater = s.map.kind === 'random' && s.map.water.waterMode === MAP_GEN_DEFAULT.waterMode;
  if (s.map.kind === 'random' && s.map.size === 'M' && isDefaultWater && N === PACING_GUARANTEE_PLAYERS && s.botDifficulty === 'NORMAL') return 'guaranteed';
  if (N <= 0) return 'timeout_likely';
  let land: number;
  if (s.map.kind === 'random') {
    const p = MAP_SIZE_PRESETS[s.map.size];
    land = Math.floor((p.w * p.h * TARGET_LAND_RATIO_PERMILLE) / 1000);
  } else land = presetLand(catalog.get(s.map.mapId)!);
  const T = PACING_T_BASE_MIN * Math.pow(land / N / PACING_P_REF, PACING_EXP);
  if (T > PACING_HARD_MIN) return 'timeout_likely';
  return `estimate:${Math.round(T)}`;
}

export function settingsEcho(s: RoomSettings, catalog: MapCatalog, humans: number, isPublic: boolean): RoomSettingsEcho {
  const lim = mapLimits(s.map, catalog);
  const plan = plannedPlayers(s, humans, isPublic);
  const map: MapChoice =
    s.map.kind === 'random'
      ? { kind: 'random', size: s.map.size, water: { waterMode: s.map.water.waterMode === WATER_MODE.SHALLOW_QUOTA ? 'SHALLOW_QUOTA' : 'BORDER_ONLY', shallowPermille: s.map.water.shallowPermille } }
      : { kind: 'preset', mapId: s.map.mapId };
  return {
    map,
    maxPlayers: s.maxPlayers,
    botCount: isPublic ? plan.bots : s.botCount,
    botDifficulty: s.botDifficulty,
    mapMaxPlayers: lim.max,
    recommended: lim.recommended,
    pacingNote: pacingNote(s, plan.total, catalog),
    expectedPlayers: plan.total,
  };
}
