/** Phase 6 QA 후속 (J-1·J-2·m-1·m-3·m-4·m-5·m-6·m-7·m-10) */
import { describe, expect, it } from 'vitest';
import { MAP_GEN_DEFAULT, type S2C_RoomState, type ServerMessage } from '@civwar/shared';
import { isDecayTick } from '../src/render/progressRule.js';
import { describeEvent, hasBatchim, josa, type FeedCtx } from '../src/state/feed.js';
import { previewSpawns } from '../src/render/mapPreview.js';
import { ClientStore, type KeyValueStorage } from '../src/state/store.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';

class Mem implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('m-3 감소 표시 판정', () => {
  it('같은 칸에서 줄 때만 감소', () => {
    expect(isDecayTick({ pct: 57, tgt: 10 }, { pct: 55, tgt: 10 })).toBe(true);
    expect(isDecayTick({ pct: 57, tgt: 1792 }, { pct: 36, tgt: 1892 })).toBe(false); // 점령 후 다음 칸 (QA 오탐 예)
    expect(isDecayTick({ pct: 40, tgt: 10 }, { pct: 0, tgt: null })).toBe(false); // 리셋
    expect(isDecayTick({ pct: 40, tgt: 10 }, { pct: 41, tgt: 10 })).toBe(false);
  });
});

describe('m-5 조사 · m-6 제안 종료 알림', () => {
  it('받침 판정', () => {
    expect(hasBatchim('철수')).toBe(false);
    expect(hasBatchim('영희님')).toBe(true);
    expect(hasBatchim('BOT 3')).toBe(true); // 삼
    expect(hasBatchim('BOT 2')).toBe(false); // 이
    expect(hasBatchim('alice')).toBeNull();
    expect(josa('BOT 2', '이', '가')).toBe('BOT 2가');
    expect(josa('alice', '이', '가')).toBe('alice이(가)');
  });
  const ctx: FeedCtx = { me: 1, nick: (id) => `BOT ${id}`, flagOwner: () => null, tickMs: 200, proposal: (id) => (id === 7 ? { fromPlayerId: 1, toPlayerId: 3 } : id === 8 ? { fromPlayerId: 4, toPlayerId: 1 } : undefined) };
  it('주어가 나면 "내가", 아니면 받침에 맞는 조사', () => {
    expect(describeEvent({ type: 'ally_break_started', tick: 1, a: 1, b: 2, byPlayerId: 1, breakAtTick: 151 }, ctx)!.text).toMatch(/^내가 동맹 파기/);
    expect(describeEvent({ type: 'base_captured', tick: 1, tileId: 1, fromPlayerId: 0, toPlayerId: 2, newHpPct: 50 }, ctx)!.text).toMatch(/^BOT 2가 중립/);
    expect(describeEvent({ type: 'base_captured', tick: 1, tileId: 1, fromPlayerId: 0, toPlayerId: 3, newHpPct: 50 }, ctx)!.text).toMatch(/^BOT 3이 중립/);
  });
  it('내 제안 거절·만료 알림, 받은 제안 만료 알림, formed 는 없음', () => {
    expect(describeEvent({ type: 'ally_proposal_closed', tick: 1, proposalId: 7, reason: 'declined' }, ctx)).toMatchObject({ text: 'BOT 3이 동맹 제안을 거절했습니다', toast: true });
    expect(describeEvent({ type: 'ally_proposal_closed', tick: 1, proposalId: 7, reason: 'expired' }, ctx)!.text).toContain('만료');
    expect(describeEvent({ type: 'ally_proposal_closed', tick: 1, proposalId: 8, reason: 'expired' }, ctx)!.text).toBe('BOT 4의 동맹 제안이 만료됐습니다');
    expect(describeEvent({ type: 'ally_proposal_closed', tick: 1, proposalId: 7, reason: 'formed' }, ctx)).toBeNull();
  });
});

describe('m-7 썸네일 스폰 = 서버 presetSpawnIndices', () => {
  it('spawnSets[N] 우선, 없으면 앞 N 개', () => {
    const m = { topology: 'square', width: 1, height: 1, terrain: [1, 1], spawns: [10, 20, 30, 40], bases: [], spawnSets: { '2': [1, 3] } };
    expect(previewSpawns(m, 2)).toEqual([20, 40]);
    expect(previewSpawns(m, 3)).toEqual([10, 20, 30]);
  });
});

function room(phase: S2C_RoomState['phase']): S2C_RoomState {
  return {
    type: 'room_state', roomId: 'r', roomCode: 'ABCDEF', isPublic: false, phase, hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: 4, botCount: 2, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'timeout_likely', expectedPlayers: 4 },
    players: [{ playerId: 1, sessionId: 's', nickname: 'a', isBot: false, isHost: true, ready: false, status: 'PLAYING' }],
    spectatorCount: 0, countdownMs: null, autoStartMs: null,
  };
}

describe('J-1 나가기 · m-1 · m-10 (store)', () => {
  it('나가기 = 저장 토큰 삭제 (새로고침해도 이 판으로 안 돌아감), 새 룸 입장 시 다시 저장, 직후 NOT_IN_ROOM 무시', () => {
    const mem = new Mem();
    const s = new ClientStore('ws://unused', mem);
    s.onMessage({ type: 'welcome', sessionId: 's', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
    s.onMessage(room('IN_GAME'));
    expect(mem.getItem('civwar.playerToken')).toBe('tok');
    s.leaveRoom();
    expect(s.room).toBeNull();
    expect(mem.getItem('civwar.playerToken')).toBeNull();
    s.onMessage({ type: 'error', code: 'NOT_IN_ROOM', message: 'not in a room' });
    expect(s.toasts.length).toBe(0);
    s.onMessage(room('LOBBY'));
    expect(mem.getItem('civwar.playerToken')).toBe('tok');
  });
  it('방 설정 오류는 서버 사유를 붙인다', () => {
    const s = new ClientStore('ws://unused');
    s.onMessage({ type: 'error', code: 'BAD_ROOM_OPTIONS', message: 'maxPlayers 8 > map max 7' });
    expect(s.toasts.at(-1)!.text).toBe('방 설정이 올바르지 않습니다 — maxPlayers 8 > map max 7');
    s.onMessage({ type: 'error', code: 'ROOM_FULL', message: 'ROOM_FULL' });
    expect(s.toasts.at(-1)!.text).toBe('방이 가득 찼습니다');
  });
});

describe('m-4 engageEtaTick (서버 추가 필드) — 실제 교전 개시와의 오차가 etaTick 보다 작다', () => {
  it('M 10인 NORMAL 2500 tick', () => {
    const map = generateMapForSize(2202, 'M', 10, MAP_GEN_DEFAULT);
    const state = createGameState(map, Array.from({ length: 10 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), 'NORMAL');
    const sim = new Simulation(state, CivBot);
    const est = new Map<number, { eta: number; engage: number }>();
    const errEta: number[] = [];
    const errEng: number[] = [];
    const hit = (id: number, tick: number) => {
      const e = est.get(id);
      if (!e) return;
      errEta.push(Math.abs(tick - e.eta));
      errEng.push(Math.abs(tick - e.engage));
      est.delete(id);
    };
    while (!sim.finished && state.tick < 2500) {
      for (const m0 of sim.step().broadcast) {
        const m = m0 as ServerMessage;
        if (m.type === 'flag_issued') est.set(m.flagId, { eta: m.etaTick, engage: m.engageEtaTick });
        if (m.type === 'flag_retargeted' && !m.auto) est.set(m.flagId, { eta: m.etaTick, engage: m.engageEtaTick });
        if (m.type === 'flag_engaged') hit(m.flagId, m.tick);
      }
      // v4.2: 가는 길의 정지 점령은 이벤트 없이 halted 로만 드러난다 — 첫 halted 또는 flag_engaged 중 먼저 (프로토콜 §18)
      for (const f of state.flags) if (f.halted) hit(f.id, state.tick);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(errEng.length).toBeGreaterThan(100);
    expect(mean(errEng)).toBeLessThan(mean(errEta));
    console.log(`engage ETA 오차 평균 ${mean(errEng).toFixed(1)} tick (etaTick ${mean(errEta).toFixed(1)}), n=${errEng.length}`);
  });
});
