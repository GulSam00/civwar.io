/** 플레이테스트 후속: 공개 방 방장 시작, 방 찾기(room_list), 귀환 목적지(방향 화살표용) */
import { describe, expect, it } from 'vitest';
import type { S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { GameModel } from '../src/state/gameModel.js';

const pubRoom = (hostId: number): S2C_RoomState => ({
  type: 'room_state', roomId: 'r1', roomCode: 'ABCDEF', isPublic: true, phase: 'LOBBY', hostId,
  settings: { map: { kind: 'random', size: 'M' }, maxPlayers: 10, botCount: 8, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'guaranteed', expectedPlayers: 10 },
  players: [
    { playerId: 1, sessionId: 's1', nickname: 'a', isBot: false, isHost: true, ready: false, status: 'LOBBY_WAITING' },
    { playerId: 2, sessionId: 's2', nickname: 'b', isBot: false, isHost: false, ready: false, status: 'LOBBY_WAITING' },
  ],
  spectatorCount: 0, countdownMs: null, autoStartMs: 20000,
});

describe('공개 방 방장', () => {
  it('공개 방에서도 방장이면 isHost (시작 버튼), 아니면 false', () => {
    const a = new ClientStore('ws://unused');
    a.onMessage({ type: 'welcome', sessionId: 's1', playerToken: 't', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
    a.onMessage(pubRoom(1));
    expect(a.isHost).toBe(true);
    const b = new ClientStore('ws://unused');
    b.onMessage({ type: 'welcome', sessionId: 's2', playerToken: 't2', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
    b.onMessage(pubRoom(1));
    expect(b.isHost).toBe(false);
  });
});

describe('방 찾기', () => {
  it('room_list 보관, RATE_LIMITED 는 토스트 없음', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({
      type: 'room_list', serverTime: 1, rooms: [
        { roomId: 'r3', phase: 'IN_GAME', map: { kind: 'random', size: 'M' }, mapName: null, width: 100, height: 60, humans: 1, bots: 9, maxPlayers: 10, spectatorCount: 0, elapsedMs: 60000, autoStartMs: null, joinable: false, spectatable: true },
      ],
    });
    expect(s.roomList?.rooms[0].roomId).toBe('r3');
    s.onMessage({ type: 'error', code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
    expect(s.toasts.length).toBe(0);
  });
});

describe('귀환 목적지 (이동 방향 화살표)', () => {
  it('flag_recalled / flag_routed 의 returnTileId 를 보관, flag_ended 에 삭제', () => {
    const m = new GameModel({
      type: 'match_config', seed: 1, topology: 'square', width: 2, height: 2, totalLandTiles: 4, tickMs: 200, hardTimeoutTick: 9600,
      endgameRush: { tick: 8400, costMultPermille: 750 },
      thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
      mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
    });
    m.apply({ type: 'map_init', terrain: [1, 4], spawns: [], bases: [] });
    m.apply({ type: 'snapshot_full', tick: 0, owners: [1, 1, 0, 3], players: [], flags: [], bases: [], alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9600, endgameRushActive: false });
    m.apply({ type: 'flag_issued', tick: 1, flagId: 1, playerId: 1, slotIndex: 0, unit: 1, posture: 0, troops: 50, originTileId: 0, anchorTileId: 3, targetOwnerId: 0, etaTick: 30, engageEtaTick: 28 });
    m.apply({ type: 'flag_recalled', tick: 2, flagId: 1, returnTileId: 0 });
    expect(m.flagReturn.get(1)).toBe(0);
    m.apply({ type: 'flag_ended', tick: 9, flagId: 1, reason: 'recalled', refunded: 40 });
    expect(m.flagReturn.has(1)).toBe(false);
  });
});
