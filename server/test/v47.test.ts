/**
 * §26 방 카드 · 이모트 데이터 — room_list 의 botDifficulty · 무작위 맵 썸네일, 대상 이모트(targetPlayerId).
 */
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_SIZE_PRESETS, rleDecode, type ServerMessage } from '@civwar/shared';
import { generateMapForSize } from '../src/map/generate.js';
import { MapCatalog } from '../src/map/presets.js';
import { buildThumbnail } from '../src/map/thumbnail.js';
import { parseClientMessage } from '../src/net/validate.js';
import { LobbyManager } from '../src/room/lobby.js';
import type { Session } from '../src/room/session.js';

const catalog = MapCatalog.loadDir(fileURLToPath(new URL('./fixtures/maps/', import.meta.url)));

function fakeSession(lobby: LobbyManager, nick: string): { s: Session; inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  const s = lobby.createSession(nick);
  s.socket = { send: (d: string) => inbox.push(JSON.parse(d) as ServerMessage), close: () => {} };
  return { s, inbox };
}

describe('§26 buildThumbnail', () => {
  it('크기 등급별 축소 격자: S 36×21(×2), M 50×30(×2), L 36×22(×3) — RLE 길이 합 = 격자', () => {
    const want = { S: [36, 21, 2], M: [50, 30, 2], L: [36, 22, 3] } as const;
    for (const size of ['S', 'M', 'L'] as const) {
      const m = generateMapForSize(4242, size, MAP_SIZE_PRESETS[size].max);
      const th = buildThumbnail(m);
      expect([th.width, th.height, th.scale]).toEqual(want[size]);
      expect(rleDecode(th.terrain, th.width * th.height)).toHaveLength(th.width * th.height);
      expect(th.width).toBeLessThanOrEqual(50);
      expect(th.height).toBeLessThanOrEqual(30);
    }
  });
  it('축소 칸 = 블록 최빈값(동률은 작은 코드), 기지 칸 index 오름차순·중복 없음, 결정론', () => {
    // 4×2 원본, scale 2 → 2×1: 왼쪽 블록 [1,3,3,1] 동률 → 1, 오른쪽 블록 [2,2,2,5] → 2. 원본 그대로(scale 1) 가 아니도록 max 2×1
    const src = { width: 4, height: 2, terrain: [1, 3, 2, 2, 3, 1, 2, 5], baseTiles: [5, 0, 3, 7] };
    const th = buildThumbnail(src, 2, 1);
    expect(th).toEqual({ width: 2, height: 1, scale: 2, terrain: [1, 1, 2, 1], bases: [0, 1] });
    const m = generateMapForSize(99, 'M', 10);
    expect(buildThumbnail(m)).toEqual(buildThumbnail(m));
    const th2 = buildThumbnail(m);
    expect(th2.bases.length).toBeGreaterThan(0);
    for (let i = 1; i < th2.bases.length; i++) expect(th2.bases[i]).toBeGreaterThan(th2.bases[i - 1]);
    // 기지 칸 하나를 직접 확인
    const b = m.baseTiles[0];
    expect(th2.bases).toContain(Math.floor(Math.floor(b / m.width) / 2) * th2.width + Math.floor((b % m.width) / 2));
  });
});

describe('§26 room_list 항목: botDifficulty · thumbnail', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('대기·카운트다운 = thumbnail null, 진행 중 무작위 맵 = 실제 맵 썸네일(캐시 동일), botDifficulty = 방 설정', () => {
    const lobby = new LobbyManager({ seed: 11, catalog });
    const A = fakeSession(lobby, 'alice');
    expect(lobby.createPrivate(A.s, { map: { kind: 'random', size: 'S' }, maxPlayers: 4, botCount: 3, botDifficulty: 'HARD' })).toBeNull();
    const room = lobby.roomOf(A.s)!;
    expect(room.listing()).toMatchObject({ phase: 'LOBBY', botDifficulty: 'HARD', thumbnail: null });
    expect(room.startNow(A.s)).toBeNull();
    expect(room.listing()).toMatchObject({ phase: 'COUNTDOWN', thumbnail: null });
    vi.advanceTimersByTime(3000);
    const l = room.listing();
    expect(l.phase).toBe('IN_GAME');
    expect(l.thumbnail).toEqual(buildThumbnail(room.sim!.state.map));
    expect(l.thumbnail).toMatchObject({ width: 36, height: 21, scale: 2 });
    expect(room.listing().thumbnail).toBe(l.thumbnail); // 판당 1회 계산
    lobby.shutdown();
  });

  it('공식 맵 방은 진행 중에도 thumbnail null (map_catalog 미리보기를 쓴다), 공개 방 기본 난이도 NORMAL', () => {
    const lobby = new LobbyManager({ seed: 12, catalog });
    const A = fakeSession(lobby, 'alice');
    expect(lobby.createPrivate(A.s, { map: { kind: 'preset', mapId: 'sample-m-01' }, maxPlayers: 3, botCount: 2, botDifficulty: 'EASY' })).toBeNull();
    const room = lobby.roomOf(A.s)!;
    room.startNow(A.s);
    vi.advanceTimersByTime(3000);
    expect(room.listing()).toMatchObject({ phase: 'IN_GAME', botDifficulty: 'EASY', thumbnail: null });
    const Q = fakeSession(lobby, 'pub');
    expect(lobby.joinPublic(Q.s)).toBeNull();
    const list = lobby.listRooms(fakeSession(lobby, 'browser').s, 5_000_000);
    if (typeof list === 'string') throw new Error(list);
    expect(list.rooms[0]).toMatchObject({ botDifficulty: 'NORMAL', thumbnail: null });
    lobby.shutdown();
  });
});

describe('§26 대상 이모트', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('형식: targetPlayerId 선택, 1..12 정수만 (없음·null = 대상 없음)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'emote', code: 2 }))).toEqual({ ok: true, msg: { type: 'emote', code: 2 } });
    expect(parseClientMessage(JSON.stringify({ type: 'emote', code: 2, targetPlayerId: null }))).toEqual({ ok: true, msg: { type: 'emote', code: 2 } });
    expect(parseClientMessage(JSON.stringify({ type: 'emote', code: 2, targetPlayerId: 4 }))).toEqual({ ok: true, msg: { type: 'emote', code: 2, targetPlayerId: 4 } });
    for (const bad of [0, 13, 1.5, '3', -1]) expect(parseClientMessage(JSON.stringify({ type: 'emote', code: 2, targetPlayerId: bad })).ok).toBe(false);
  });

  it('유효 대상 → emote_broadcast 에 targetPlayerId, 자기·없는 자리는 무시(1초 제한 소모 없음), 대상 없으면 필드 없음', () => {
    const lobby = new LobbyManager({ seed: 13, catalog });
    const A = fakeSession(lobby, 'alice');
    const B = fakeSession(lobby, 'bob');
    lobby.createPrivate(A.s, { map: { kind: 'random', size: 'S' }, maxPlayers: 3, botCount: 1 });
    const room = lobby.roomOf(A.s)!;
    lobby.joinPrivate(B.s, room.code);
    room.startNow(A.s);
    vi.advanceTimersByTime(3000);
    expect(room.phase).toBe('IN_GAME');
    const emotes = () => B.inbox.filter((m) => m.type === 'emote_broadcast');
    room.emote(A.s, 4, 1); // 자기 자신
    room.emote(A.s, 4, 9); // 판에 없는 자리
    expect(emotes()).toHaveLength(0);
    room.emote(A.s, 5, 3); // 봇 자리
    expect(emotes()).toEqual([expect.objectContaining({ type: 'emote_broadcast', playerId: 1, code: 5, targetPlayerId: 3 })]);
    room.emote(A.s, 6, 2); // 1초 안 → 무시 (대상 유무와 같은 제한)
    expect(emotes()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    room.emote(A.s, 7);
    const last = emotes().at(-1)!;
    expect(last).toMatchObject({ code: 7, playerId: 1 });
    expect('targetPlayerId' in last).toBe(false);
    expect(A.inbox.filter((m) => m.type === 'emote_broadcast')).toHaveLength(2); // 보낸 사람 포함 전원
    lobby.shutdown();
  });
});
