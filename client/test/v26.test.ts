/**
 * §26 (2026-10-18): 방 카드 봇 난이도 태그 · 무작위 맵 실제 축소 지형 썸네일 · 대상 이모트 송수신 표시
 */
import { describe, expect, it } from 'vitest';
import { rleEncode, type MapThumbnail, type RoomListing, type S2C_RoomState } from '@civwar/shared';
import { ClientStore, EMOTE_COOLDOWN_MS } from '../src/state/store.js';
import { roomCard } from '../src/ui/roomCards.js';
import { decodeThumbnail } from '../src/render/mapPreview.js';
import { clampToView, emoteBubble } from '../src/render/emoteBubble.js';
import { describeEvent } from '../src/state/feed.js';
import { EMOTE_TEXT } from '../src/ui/text.js';

// ───────────── 26.1 봇 난이도 태그 ─────────────

const base: RoomListing = {
  roomId: 'room-a', phase: 'LOBBY', map: { kind: 'random', size: 'M' }, mapName: null, width: 100, height: 60, humans: 1, bots: 8, maxPlayers: 10,
  spectatorCount: 0, elapsedMs: 0, autoStartMs: null, joinable: true, spectatable: false, botDifficulty: 'NORMAL', thumbnail: null,
};

describe('§26.1 방 카드 봇 난이도', () => {
  it('room_list.rooms[].botDifficulty 를 그대로 읽어 태그 이름·코드로', () => {
    expect(roomCard(base, 0)).toMatchObject({ difficulty: '보통', difficultyCode: 'NORMAL' });
    expect(roomCard({ ...base, botDifficulty: 'EASY' }, 0)).toMatchObject({ difficulty: '쉬움', difficultyCode: 'EASY' });
    expect(roomCard({ ...base, botDifficulty: 'HARD' }, 0)).toMatchObject({ difficulty: '어려움', difficultyCode: 'HARD' });
  });
  it('필드 없는 옛 목록은 태그 숨김(null)', () => {
    const { botDifficulty: _omit, ...old } = base;
    expect(roomCard(old, 0)).toMatchObject({ difficulty: null, difficultyCode: null });
  });
});

// ───────────── 26.2 축소 지형 썸네일 ─────────────

/** 5×3 축소 격자: 가장자리 바다(0), 안쪽 평지(1)·숲(2) */
const TW = 5;
const TH = 3;
const cells = [0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0];
const thumb: MapThumbnail = { width: TW, height: TH, scale: 2, terrain: rleEncode(cells), bases: [6, 8] };

describe('§26.2 방 카드 썸네일', () => {
  it('진행 중 무작위 방: thumbnail 이 카드에 실린다 / 대기·카운트다운(null) 은 null (분위기 그림 + "무작위")', () => {
    expect(roomCard({ ...base, phase: 'IN_GAME', joinable: false, spectatable: true, elapsedMs: 98000, thumbnail: thumb }, 0).thumbnail).toBe(thumb);
    expect(roomCard(base, 0).thumbnail).toBeNull();
    expect(roomCard({ ...base, phase: 'COUNTDOWN' }, 0).thumbnail).toBeNull();
    const { thumbnail: _t, ...noField } = base;
    expect(roomCard(noField, 0).thumbnail).toBeNull();
  });
  it('공식 맵 방은 thumbnail 이 있어도 무시 — 번들 공식 미리보기를 쓴다', () => {
    const c = roomCard({ ...base, map: { kind: 'preset', mapId: 'isles' }, thumbnail: thumb }, 0);
    expect(c).toMatchObject({ presetId: 'isles', thumbnail: null });
  });
  it('RLE 풀기: 행 우선 지형 + 기지 index (그리기 경로 입력)', () => {
    const d = decodeThumbnail(thumb)!;
    expect(d).not.toBeNull();
    expect(d.width).toBe(TW);
    expect(d.height).toBe(TH);
    expect(Array.from(d.terrain)).toEqual(cells);
    expect(d.terrain[1 * TW + 2]).toBe(2); // (x2, y1) = 숲
    expect(d.bases).toEqual([6, 8]);
  });
  it('형식 오류: RLE 길이 합 ≠ width×height → null (분위기 그림으로 물러남), 범위 밖 기지는 버린다', () => {
    expect(decodeThumbnail({ ...thumb, terrain: [0, 14] })).toBeNull();
    expect(decodeThumbnail({ ...thumb, terrain: [0, 16] })).toBeNull();
    expect(decodeThumbnail({ ...thumb, terrain: [0] })).toBeNull();
    expect(decodeThumbnail({ ...thumb, width: 0 })).toBeNull();
    expect(decodeThumbnail({ ...thumb, bases: [-1, 3, 15, 2.5] })!.bases).toEqual([3]);
  });
});

// ───────────── 26.3 대상 이모트 ─────────────

function setup() {
  let t = 10_000;
  const store = new ClientStore('ws://unused', null, () => t);
  const sent: Record<string, unknown>[] = [];
  (store as unknown as { socket: { send(m: unknown): boolean } }).socket.send = (m: unknown) => (sent.push(m as Record<string, unknown>), true);
  store.onMessage({ type: 'welcome', sessionId: 's_me', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
  const room: S2C_RoomState = {
    type: 'room_state', roomId: 'r1', roomCode: 'ABCDEF', isPublic: false, phase: 'IN_GAME', hostId: 1,
    settings: { map: { kind: 'random', size: 'S' }, maxPlayers: 3, botCount: 2, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [2, 4], pacingNote: 'guaranteed', expectedPlayers: 3 },
    players: [
      { playerId: 1, sessionId: 's_me', nickname: 'alice', isBot: false, isHost: true, ready: true, status: 'PLAYING' },
      { playerId: 2, sessionId: null, nickname: '레이븐홀트 공국', isBot: true, isHost: false, ready: true, status: 'PLAYING' },
      { playerId: 3, sessionId: null, nickname: '북부 변경백령', isBot: true, isHost: false, ready: true, status: 'PLAYING' },
    ],
    spectatorCount: 0, countdownMs: null, autoStartMs: null,
  };
  store.onMessage(room);
  return { store, sent, advance: (ms: number) => (t += ms) };
}

describe('§26.3 대상 이모트 — 송신', () => {
  it('대상 있음 = targetPlayerId 실음 / 대상 없음·자기 자신 = 필드 없음', () => {
    const { store, sent, advance } = setup();
    expect(store.sendEmote(7, 3)).toBe(true);
    advance(EMOTE_COOLDOWN_MS);
    expect(store.sendEmote(4)).toBe(true);
    advance(EMOTE_COOLDOWN_MS);
    expect(store.sendEmote(5, 1)).toBe(true); // 나 자신 → 대상 없음 (서버는 자기 대상을 통째로 무시하므로)
    advance(EMOTE_COOLDOWN_MS);
    expect(store.sendEmote(6, null)).toBe(true);
    expect(sent).toEqual([
      { type: 'emote', code: 7, targetPlayerId: 3 },
      { type: 'emote', code: 4 },
      { type: 'emote', code: 5 },
      { type: 'emote', code: 6 },
    ]);
  });
  it('1초 1회 — 대상·비대상 하나의 제한을 공유, 막히면 토스트', () => {
    const { store, sent, advance } = setup();
    expect(store.sendEmote(1, 2)).toBe(true);
    advance(400);
    expect(store.sendEmote(2)).toBe(false); // 비대상도 막힌다
    expect(store.toasts.at(-1)?.text).toBe('이모트는 1초에 한 번만 보낼 수 있습니다');
    advance(599);
    expect(store.sendEmote(3, 3)).toBe(false);
    advance(1);
    expect(store.sendEmote(3, 3)).toBe(true);
    expect(sent.map((m) => m.code)).toEqual([1, 3]);
  });
  it('연결이 없어 못 보냈으면 제한을 소모하지 않는다', () => {
    const { store, sent } = setup();
    const sock = (store as unknown as { socket: { send(m: unknown): boolean } }).socket;
    sock.send = () => false;
    expect(store.sendEmote(1, 2)).toBe(false);
    sock.send = (m: unknown) => (sent.push(m as Record<string, unknown>), true);
    expect(store.sendEmote(1, 2)).toBe(true);
  });
});

describe('§26.3 대상 이모트 — 수신 표시', () => {
  it('store.emotes 에 targetPlayerId 를 싣고, 대상 없는 이모트는 필드 없음', () => {
    const { store } = setup();
    store.onMessage({ type: 'emote_broadcast', tick: 812, playerId: 2, code: 7, targetPlayerId: 1 });
    store.onMessage({ type: 'emote_broadcast', tick: 830, playerId: 3, code: 4 });
    expect(store.emotes).toEqual([
      { playerId: 2, code: 7, at: 10_000, targetPlayerId: 1 },
      { playerId: 3, code: 4, at: 10_000 },
    ]);
  });

  const nick = (id: number) => ({ 1: 'alice', 2: '레이븐홀트 공국', 3: '북부 변경백령' })[id] ?? `P${id}`;
  const ctx = (me: number | null) => ({ me, nick, flagOwner: () => null, tickMs: 200 });

  it('피드: "A → B: 😀", 나를 향하면 "→ 나" + 강조(toMe), 내가 보낸 것은 mine', () => {
    const face = EMOTE_TEXT[7];
    expect(describeEvent({ type: 'emote_broadcast', tick: 1, playerId: 2, code: 7, targetPlayerId: 3 }, ctx(1))).toEqual({ kind: 'system', mine: false, text: `레이븐홀트 공국 → 북부 변경백령: ${face}` });
    expect(describeEvent({ type: 'emote_broadcast', tick: 1, playerId: 2, code: 7, targetPlayerId: 1 }, ctx(1))).toEqual({ kind: 'system', mine: true, toMe: true, text: `레이븐홀트 공국 → 나: ${face}` });
    expect(describeEvent({ type: 'emote_broadcast', tick: 1, playerId: 1, code: 7, targetPlayerId: 2 }, ctx(1))).toEqual({ kind: 'system', mine: true, text: `나 → 레이븐홀트 공국: ${face}` });
    expect(describeEvent({ type: 'emote_broadcast', tick: 1, playerId: 2, code: 7 }, ctx(1))).toEqual({ kind: 'system', mine: false, text: `레이븐홀트 공국: ${face}` });
    // 관전자(me = null)
    expect(describeEvent({ type: 'emote_broadcast', tick: 1, playerId: 2, code: 7, targetPlayerId: 1 }, ctx(null))!.text).toBe(`레이븐홀트 공국 → alice: ${face}`);
  });

  it('말풍선: 대상 있음 = "A → B: 😀" + 대상 id, 나를 향하면 "→ 나" 강조', () => {
    const face = (c: number) => EMOTE_TEXT[c];
    expect(emoteBubble({ playerId: 2, code: 7 }, 1, nick, face)).toEqual({ text: `레이븐홀트 공국: ${EMOTE_TEXT[7]}`, target: null, toMe: false });
    expect(emoteBubble({ playerId: 2, code: 7, targetPlayerId: 3 }, 1, nick, face)).toEqual({ text: `레이븐홀트 공국 → 북부 변경백령: ${EMOTE_TEXT[7]}`, target: 3, toMe: false });
    expect(emoteBubble({ playerId: 2, code: 7, targetPlayerId: 1 }, 1, nick, face)).toEqual({ text: `레이븐홀트 공국 → 나: ${EMOTE_TEXT[7]}`, target: 1, toMe: true });
    expect(emoteBubble({ playerId: 1, code: 7, targetPlayerId: 2 }, 1, nick, face)).toMatchObject({ target: 2, toMe: false });
  });

  it('화살표 끝: 대상 이름표가 화면 밖이면 가장자리에서 멈춘다', () => {
    expect(clampToView({ x: 100, y: 100 }, { x: 300, y: 200 }, 800, 600)).toEqual({ x: 300, y: 200, clamped: false });
    const e = clampToView({ x: 100, y: 100 }, { x: 1700, y: 100 }, 800, 600, 20);
    expect(e).toEqual({ x: 780, y: 100, clamped: true });
    const f = clampToView({ x: 400, y: 300 }, { x: 400, y: -900 }, 800, 600, 20);
    expect(f).toMatchObject({ x: 400, y: 20, clamped: true });
  });
});
