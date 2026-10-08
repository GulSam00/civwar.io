/**
 * v4.1 방 설정 (GDD 2.8 / 7.2a) · 공식 프리셋 맵 로더 (2.8 f).
 * 픽스처 server/test/fixtures/maps/sample-m-01.json = `export-map.ts --size M --seed 20261009 --id sample-m-01` 출력.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_SIZE_PRESETS, type ServerMessage } from '@civwar/shared';
import { generateMapForSize } from '../src/map/generate.js';
import { MapCatalog, PresetFormatError, mapFromPreset, presetChecksum, validatePreset, type PresetMapFile } from '../src/map/presets.js';
import { createGameState, ledgerImbalance } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { LobbyManager } from '../src/room/lobby.js';
import type { Session } from '../src/room/session.js';
import { applyRoomOptions, defaultPrivateSettings, pacingNote, publicSettings, type RoomSettings } from '../src/room/settings.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/maps/', import.meta.url));
const loadFixture = (): PresetMapFile => JSON.parse(readFileSync(FIXTURE_DIR + 'sample-m-01.json', 'utf8')) as PresetMapFile;
const catalog = MapCatalog.loadDir(FIXTURE_DIR);

describe('공식 프리셋 맵 로더 (2.8 f)', () => {
  it('픽스처 로드 · welcome.officialMaps 메타', () => {
    expect(catalog.list()).toEqual([
      { id: 'sample-m-01', name: { ko: '예시 보통 맵', en: 'Sample M' }, sizeClass: 'M', players: { min: 2, recommendedMin: 9, recommendedMax: 11, max: 12 } },
    ]);
  });
  it('checksum 불일치 · id≠파일명 · 스키마 위반 → PresetFormatError (기동 실패)', () => {
    const f = loadFixture();
    f.bases = [...f.bases.slice(1), f.bases[0]];
    expect(() => validatePreset(f, 'sample-m-01')).toThrow(/checksum/);
    expect(() => validatePreset(loadFixture(), 'other-id')).toThrow(PresetFormatError);
    const g = loadFixture();
    g.spawns = g.spawns.slice(0, 5);
    g.checksum = presetChecksum(g);
    expect(() => validatePreset(g, 'sample-m-01')).toThrow(/spawns/);
    expect(() => validatePreset({ ...loadFixture(), schemaVersion: 2 }, 'sample-m-01')).toThrow(/schemaVersion/);
  });
  it('없는 디렉터리 → 빈 카탈로그', () => {
    expect(MapCatalog.loadDir(FIXTURE_DIR + 'nope/').list()).toEqual([]);
  });
  it('N = max 로 읽으면 생성기 출력과 비트 단위로 같다', () => {
    const p = mapFromPreset(loadFixture(), 12);
    const g = generateMapForSize(20261009, 'M', 12);
    expect([...p.terrain]).toEqual([...g.terrain]);
    expect(p.baseTiles).toEqual(g.baseTiles);
    expect(p.spawns).toEqual(g.spawns);
    expect([...p.initialOwners]).toEqual([...g.initialOwners]);
    expect(p.totalLandTiles).toBe(g.totalLandTiles);
    expect(p.source).toEqual({ kind: 'preset', mapId: 'sample-m-01' });
  });
  it('N < max: spawns 앞 N개, 기지는 파일 전부(안 쓰는 수도 = 중립 기지), 게임 진행·회계 불변식', () => {
    const f = loadFixture();
    const m = mapFromPreset(f, 4);
    expect(m.spawns.map((s) => s.homeTileId)).toEqual(f.spawns.slice(0, 4));
    expect(m.baseTiles.length).toBe(f.bases.length);
    const owners = new Set(m.initialOwners);
    expect([...owners].sort()).toEqual([0, 1, 2, 3, 4]);
    const sim = new Simulation(createGameState(m, [1, 2, 3, 4].map((id) => ({ playerId: id, isBot: id > 1, connected: true }))));
    for (let i = 0; i < 50; i++) {
      sim.step();
      expect(ledgerImbalance(sim.state)).toBe(0);
    }
  });
  it('spawnSets[N] 가 있으면 그 인덱스를 쓴다', () => {
    const f = { ...loadFixture(), spawnSets: { '2': [0, 5] } };
    const v = validatePreset(f, 'sample-m-01'); // checksum 은 terrain+spawns+bases 만 덮는다
    expect(mapFromPreset(v, 2).spawns.map((s) => s.homeTileId)).toEqual([f.spawns[0], f.spawns[5]]);
    expect(() => mapFromPreset(v, 1)).toThrow();
    expect(() => mapFromPreset(v, 13)).toThrow();
  });
});

describe('방 설정 검증 (7.2a)', () => {
  const apply = (raw: Record<string, unknown>, humans = 1, base: RoomSettings = defaultPrivateSettings(), legacy = true) => applyRoomOptions(raw, base, catalog, humans, legacy);

  it('생략 = 기본 (무작위·M·기본 물·10인·봇 0·NORMAL)', () => {
    expect(apply({})).toEqual({ ok: true, settings: defaultPrivateSettings() });
    expect(defaultPrivateSettings()).toMatchObject({ map: { kind: 'random', size: 'M', water: { waterMode: 0, shallowPermille: 1000 } }, maxPlayers: 10, botCount: 0, botDifficulty: 'NORMAL' });
  });
  it('정상 조합', () => {
    const r = apply({ map: { kind: 'random', size: 'L', water: { waterMode: 'SHALLOW_QUOTA', shallowPermille: 400 } }, maxPlayers: 12, botCount: 11, botDifficulty: 'HARD' });
    expect(r).toEqual({ ok: true, settings: { map: { kind: 'random', size: 'L', water: { waterMode: 1, shallowPermille: 400 } }, maxPlayers: 12, botCount: 11, botDifficulty: 'HARD' } });
    expect(apply({ map: { kind: 'preset', mapId: 'sample-m-01' }, maxPlayers: 2 })).toMatchObject({ ok: true, settings: { map: { kind: 'preset', mapId: 'sample-m-01' }, maxPlayers: 2 } });
  });
  it('거절: BAD_ROOM_OPTIONS / MAP_NOT_FOUND', () => {
    const code = (raw: Record<string, unknown>, humans = 1) => {
      const r = apply(raw, humans);
      return r.ok ? 'OK' : r.code;
    };
    expect(code({ map: { kind: 'random', size: 'S' }, maxPlayers: 8 })).toBe('BAD_ROOM_OPTIONS'); // 작음 최대 7
    expect(code({ map: { kind: 'random', size: 'X' } })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ map: { kind: 'random', size: 'M', water: { waterMode: 'LAVA' } } })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ map: { kind: 'preset', mapId: 'nope' } })).toBe('MAP_NOT_FOUND');
    expect(code({ map: 'random' })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ maxPlayers: 1 })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ maxPlayers: 13 })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ maxPlayers: 4.5 })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ maxPlayers: 4, botCount: 4 })).toBe('BAD_ROOM_OPTIONS'); // 0..maxPlayers-1
    expect(code({ botCount: -1 })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ botDifficulty: 'INSANE' })).toBe('BAD_ROOM_OPTIONS');
    expect(code({ maxPlayers: 3 }, 4)).toBe('BAD_ROOM_OPTIONS'); // 현재 사람 수 아래
  });
  it('구 targetPlayers 호환(생성만) · maxPlayers 생략 시 새 맵 최대로 낮춤', () => {
    expect(apply({ targetPlayers: 8 })).toMatchObject({ ok: true, settings: { maxPlayers: 8 } });
    expect(apply({ targetPlayers: 8 }, 1, defaultPrivateSettings(), false)).toMatchObject({ ok: true, settings: { maxPlayers: 10 } });
    expect(apply({ map: { kind: 'random', size: 'S' } })).toMatchObject({ ok: true, settings: { maxPlayers: 7 } });
  });
  it('pacingNote (2.8 e 추정표)', () => {
    const s = (over: Partial<RoomSettings>): RoomSettings => ({ ...defaultPrivateSettings(), ...over });
    expect(pacingNote(publicSettings(), 10, catalog)).toBe('guaranteed');
    expect(pacingNote(s({ botDifficulty: 'HARD' }), 10, catalog)).toBe('estimate:29');
    expect(pacingNote(s({}), 9, catalog)).toBe('estimate:32');
    expect(pacingNote(s({}), 8, catalog)).toBe('timeout_likely');
    expect(pacingNote(s({}), 12, catalog)).toBe('estimate:26');
    const S = s({ map: { kind: 'random', size: 'S', water: { waterMode: 0, shallowPermille: 1000 } } });
    expect(pacingNote(S, 6, catalog)).toBe('estimate:26');
    expect(pacingNote(S, 2, catalog)).toBe('timeout_likely');
    expect(pacingNote(s({ map: { kind: 'random', size: 'L', water: { waterMode: 0, shallowPermille: 1000 } } }), 12, catalog)).toBe('estimate:29');
  });
});

// ───────────────────────── 룸 흐름 (가짜 소켓) ─────────────────────────

function fakeSession(lobby: LobbyManager, nick: string): { s: Session; inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  const s = lobby.createSession(nick);
  s.socket = { send: (d: string) => inbox.push(JSON.parse(d) as ServerMessage), close: () => {} };
  return { s, inbox };
}
const lastOf = <T extends ServerMessage['type']>(inbox: ServerMessage[], type: T) =>
  [...inbox].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;

describe('룸 흐름 — 비공개 방 설정·시작', () => {
  let lobby: LobbyManager;
  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new LobbyManager({ seed: 7, catalog });
  });
  afterEach(() => {
    lobby.shutdown();
    vi.useRealTimers();
  });

  it('생성 옵션 에코 → 방장만 변경 → 시작 시 사람 재번호 + 봇 클램프 → match_config · 봇 난이도', () => {
    const A = fakeSession(lobby, 'alice');
    const B = fakeSession(lobby, 'bob');
    expect(lobby.createPrivate(A.s, { map: { kind: 'random', size: 'S' }, maxPlayers: 4, botCount: 3, botDifficulty: 'HARD' })).toBeNull();
    const room = lobby.roomOf(A.s)!;
    expect(lastOf(A.inbox, 'room_state')!.settings).toEqual({
      map: { kind: 'random', size: 'S', water: { waterMode: 'BORDER_ONLY', shallowPermille: 1000 } },
      maxPlayers: 4, botCount: 3, botDifficulty: 'HARD', mapMaxPlayers: 7, recommended: [5, 6], pacingNote: 'timeout_likely', expectedPlayers: 4,
    });
    expect(lobby.joinPrivate(B.s, room.code)).toBeNull();
    expect(room.updateSettings(B.s, { botCount: 0 })).toMatchObject({ code: 'NOT_HOST' });
    expect(room.updateSettings(A.s, { maxPlayers: 1 })).toMatchObject({ code: 'BAD_ROOM_OPTIONS' });
    expect(room.updateSettings(A.s, { map: { kind: 'preset', mapId: 'zzz' } })).toMatchObject({ code: 'MAP_NOT_FOUND' });
    expect(room.updateSettings(A.s, { maxPlayers: 5 })).toBeNull();
    expect(lastOf(B.inbox, 'room_state')!.settings).toMatchObject({ maxPlayers: 5, botCount: 3, expectedPlayers: 5 });
    // A 퇴장 후 재입장 → 번호 빈자리(1) 생김: B=2, A=1? → 재입장 A 는 가장 작은 빈 번호 1
    room.leave(A.s);
    expect(room.hostId).toBe(2);
    expect(lobby.joinPrivate(A.s, room.code)).toBeNull();
    expect(room.startNow(A.s)).toBe('NOT_HOST');
    expect(room.startNow(B.s)).toBeNull();
    expect(room.phase).toBe('COUNTDOWN');
    const rs = lastOf(A.inbox, 'room_state')!;
    expect(rs.players.map((p) => [p.playerId, p.isBot])).toEqual([[1, false], [2, false], [3, true], [4, true], [5, true]]);
    vi.advanceTimersByTime(3000);
    expect(room.phase).toBe('IN_GAME');
    const mc = lastOf(A.inbox, 'match_config')!;
    expect(mc).toMatchObject({ width: 72, height: 42, mapSource: 'random', botDifficulty: 'HARD' });
    expect(mc.mapId).toBeUndefined();
    expect(lastOf(A.inbox, 'map_init')!.spawns).toHaveLength(5);
    const st = room.sim!.state;
    expect(st.players[3].botDifficulty).toBe('HARD');
    expect(st.players[3].bot.decisionInterval).toBe(10);
    expect(st.players[1].bot.decisionInterval).toBe(10); // 사람 자리도 인계 대비 같은 난이도
  });

  it('NOT_ENOUGH_PLAYERS: 사람 1 + 봇 0 → 시작 불가, LOBBY 유지', () => {
    const A = fakeSession(lobby, 'alice');
    lobby.createPrivate(A.s, {});
    const room = lobby.roomOf(A.s)!;
    expect(room.startNow(A.s)).toBe('NOT_ENOUGH_PLAYERS');
    expect(room.phase).toBe('LOBBY');
    room.updateSettings(A.s, { botCount: 1 });
    expect(room.startNow(A.s)).toBeNull();
  });

  it('시작 시 사람 번호 빈자리 제거(1..H) · 방장 번호 따라감', () => {
    const [A, B, C] = ['a', 'b', 'c'].map((n) => fakeSession(lobby, n));
    lobby.createPrivate(A.s, { botCount: 1 });
    const room = lobby.roomOf(A.s)!;
    lobby.joinPrivate(B.s, room.code);
    lobby.joinPrivate(C.s, room.code);
    room.leave(A.s); // 사람 = {2: B(방장), 3: C}
    expect(room.hostId).toBe(2);
    expect(room.startNow(B.s)).toBeNull();
    expect([...room.members.values()].map((m) => [m.playerId, m.nickname])).toEqual([[1, 'b'], [2, 'c'], [3, 'BOT 3']]);
    expect(room.hostId).toBe(1);
    expect(B.s.playerId).toBe(1);
    expect(C.s.playerId).toBe(2);
  });

  it('비공개 방은 준비 완료·정원 도달로 자동 시작하지 않는다', () => {
    const A = fakeSession(lobby, 'alice');
    const B = fakeSession(lobby, 'bob');
    lobby.createPrivate(A.s, { maxPlayers: 2 });
    const room = lobby.roomOf(A.s)!;
    lobby.joinPrivate(B.s, room.code);
    room.setReady(A.s, true);
    room.setReady(B.s, true);
    expect(room.phase).toBe('LOBBY');
    expect(lobby.joinPrivate(fakeSession(lobby, 'carol').s, room.code)).toBe('ROOM_FULL');
  });

  it('프리셋 맵 방: N = 사람 + 봇, spawns 앞 N개, match_config mapSource/mapId', () => {
    const A = fakeSession(lobby, 'alice');
    expect(lobby.createPrivate(A.s, { map: { kind: 'preset', mapId: 'sample-m-01' }, maxPlayers: 12, botCount: 2 })).toBeNull();
    const room = lobby.roomOf(A.s)!;
    expect(lastOf(A.inbox, 'room_state')!.settings).toMatchObject({ map: { kind: 'preset', mapId: 'sample-m-01' }, mapMaxPlayers: 12, recommended: [9, 11] });
    room.startNow(A.s);
    vi.advanceTimersByTime(3000);
    expect(lastOf(A.inbox, 'match_config')).toMatchObject({ mapSource: 'preset', mapId: 'sample-m-01', width: 100, height: 60, botDifficulty: 'NORMAL' });
    expect(lastOf(A.inbox, 'map_init')!.spawns.map((s) => s.tileId)).toEqual(loadFixture().spawns.slice(0, 3));
  });

  it('공개 방: 고정 설정(10인·M·NORMAL·guaranteed), 설정 변경 거절, 30초 자동 시작 → 봇 충원', () => {
    const A = fakeSession(lobby, 'alice');
    expect(lobby.joinPublic(A.s)).toBeNull();
    const room = lobby.roomOf(A.s)!;
    expect(lastOf(A.inbox, 'room_state')!.settings).toMatchObject({ maxPlayers: 10, botCount: 9, botDifficulty: 'NORMAL', pacingNote: 'guaranteed', expectedPlayers: 10 });
    expect(room.updateSettings(A.s, { maxPlayers: 4 })).toMatchObject({ code: 'BAD_ROOM_OPTIONS' });
    vi.advanceTimersByTime(30000 + 3000);
    expect(room.phase).toBe('IN_GAME');
    expect(lastOf(A.inbox, 'match_config')).toMatchObject({ width: MAP_SIZE_PRESETS.M.w, height: MAP_SIZE_PRESETS.M.h, mapSource: 'random' });
    expect(room.sim!.state.players.filter(Boolean)).toHaveLength(10);
  });
});
