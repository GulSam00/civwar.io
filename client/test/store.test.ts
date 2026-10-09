/** ClientStore 메시지 디스패치 (소켓 없이 onMessage 직접 주입) */
import { describe, expect, it } from 'vitest';
import type { S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';

function room(phase: S2C_RoomState['phase'], players: S2C_RoomState['players']): S2C_RoomState {
  return {
    type: 'room_state', roomId: 'r1', roomCode: 'ABCDEF', isPublic: false, phase, hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: 4, botCount: 2, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'timeout_likely', expectedPlayers: 4 },
    players, spectatorCount: 0, countdownMs: null,
  };
}

describe('ClientStore', () => {
  it('welcome → sessionId, room_state 로 내 playerId 를 찾고 재번호를 따라간다', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({ type: 'welcome', sessionId: 's_me', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
    expect(s.playerToken).toBe('tok');
    s.onMessage(room('LOBBY', [
      { playerId: 2, sessionId: 's_other', nickname: 'a', isBot: false, isHost: true, ready: false, status: 'LOBBY_WAITING' },
      { playerId: 3, sessionId: 's_me', nickname: 'me', isBot: false, isHost: false, ready: false, status: 'LOBBY_WAITING' },
    ]));
    expect(s.myPlayerId).toBe(3);
    expect(s.spectating).toBe(false);
    s.onMessage(room('COUNTDOWN', [
      { playerId: 1, sessionId: 's_other', nickname: 'a', isBot: false, isHost: true, ready: false, status: 'LOBBY_WAITING' },
      { playerId: 2, sessionId: 's_me', nickname: 'me', isBot: false, isHost: false, ready: false, status: 'LOBBY_WAITING' },
      { playerId: 3, sessionId: null, nickname: 'BOT 3', isBot: true, isHost: false, ready: true, status: 'LOBBY_WAITING' },
    ]));
    expect(s.myPlayerId).toBe(2);
    expect(s.isHost).toBe(false);
  });

  it('players 에 내 세션이 없으면 관전', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({ type: 'welcome', sessionId: 's_me', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
    s.onMessage(room('IN_GAME', [{ playerId: 1, sessionId: 's_x', nickname: 'x', isBot: false, isHost: true, ready: false, status: 'PLAYING' }]));
    expect(s.spectating).toBe(true);
    expect(s.myPlayerId).toBeNull();
  });

  it('cmd_ack 거절은 한국어 토스트, error 코드도 토스트', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({ type: 'cmd_ack', clientSeq: 1, accepted: false, reason: 'NO_SLOT' });
    expect(s.toasts.at(-1)!.text).toContain('슬롯');
    s.onMessage({ type: 'cmd_ack', clientSeq: 2, accepted: true, flagId: 3, posture: 0 });
    expect(s.toasts.length).toBe(1);
    s.onMessage({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'ROOM_NOT_FOUND' });
    expect(s.toasts.at(-1)!.text).toContain('방을 찾을 수 없습니다');
  });

  it('match_config 로 게임 모델 생성, 모르는 type 은 무시', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({
      type: 'match_config', seed: 1, topology: 'square', width: 2, height: 2, totalLandTiles: 4, tickMs: 200, hardTimeoutTick: 9600,
      endgameRush: { tick: 8400, costMultPermille: 750 },
      thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
      mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
    });
    expect(s.game?.width).toBe(2);
    expect(() => s.onMessage({ type: 'future_thing' } as never)).not.toThrow();
  });
});
