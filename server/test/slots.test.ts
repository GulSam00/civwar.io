/**
 * §32 — 플레이어 ↔ 스폰 슬롯 무작위 배정 · 봇 테크 목록의 playerId 분리.
 * 행동 균형(슬롯별·id별 점유율 CV)은 자가대전(scripts/slot-bias.ts)으로만 잴 수 있어 여기서는 구조적 성질만 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { createGameState, ledgerImbalance, type PlayerSetup } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap, generateMapForSize } from '../src/map/generate.js';
import { tileTieHash } from '../src/map/rng.js';
import { botDiag } from '../src/game/bot.js';
import { isPermutation, relabelSpawns, shuffledSlots } from '../src/map/slots.js';
import { LobbyManager } from '../src/room/lobby.js';
import { MapCatalog } from '../src/map/presets.js';

describe('shuffledSlots / relabelSpawns', () => {
  it('순열 · 결정론 · 시드마다 다름', () => {
    for (const n of [2, 6, 10, 12]) {
      const a = shuffledSlots(123, n);
      expect(isPermutation(a, n)).toBe(true);
      expect(shuffledSlots(123, n)).toEqual(a);
    }
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) seen.add(shuffledSlots(s, 10).join(','));
    expect(seen.size).toBeGreaterThan(45);
  });

  it('방장(playerId 1)이 받는 슬롯이 시드마다 고르게 퍼진다 (항상 0 이 아님)', () => {
    const N = 10;
    const count = new Array(N).fill(0);
    const T = 2000;
    for (let s = 0; s < T; s++) count[shuffledSlots(s * 7919 + 1, N)[0]]++;
    // 기대 200, 균등이면 ±5σ(≈ 67) 안
    for (const c of count) expect(Math.abs(c - T / N)).toBeLessThan(67);
    expect(count[0]).toBeLessThan(T / 2);
  });

  it('relabelSpawns: spawns[p-1].playerId === p · 위치 집합 보존 · initialOwners 일치 · 항등은 같은 객체', () => {
    const m = generateMap(4242, 100, 60, 10);
    expect(relabelSpawns(m, Array.from({ length: 10 }, (_, i) => i))).toBe(m);
    const slotOf = shuffledSlots(99, 10);
    const r = relabelSpawns(m, slotOf);
    expect(r.spawns.map((s) => s.playerId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.spawns.map((s) => s.homeTileId).sort((a, b) => a - b)).toEqual(m.spawns.map((s) => s.homeTileId).sort((a, b) => a - b));
    for (let p = 1; p <= 10; p++) {
      expect(r.spawns[p - 1].homeTileId).toBe(m.spawns[slotOf[p - 1]].homeTileId);
      expect(r.initialOwners[r.spawns[p - 1].homeTileId]).toBe(p);
    }
    // 소유 칸 수·위치 보존 (번호만 바뀐다)
    for (let t = 0; t < m.initialOwners.length; t++) expect(r.initialOwners[t] === 0).toBe(m.initialOwners[t] === 0);
    expect(m.spawns.map((s) => s.playerId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // 원본 불변
    expect(() => relabelSpawns(m, [0, 0, 1, 2, 3, 4, 5, 6, 7, 8])).toThrow();
  });
});

describe('createGameState — spawnSlot · techStyle', () => {
  const setupOf = (N: number, f: (i: number) => Partial<PlayerSetup> = () => ({})): PlayerSetup[] =>
    Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, ...f(i) }));

  it('spawnSlot 대로 홈 타일이 정해지고 게임이 정상 진행된다 (회계 불변식)', () => {
    const m = generateMap(777, 72, 42, 6);
    const slotOf = shuffledSlots(5, 6);
    const st = createGameState(m, setupOf(6, (i) => ({ spawnSlot: slotOf[i] })));
    for (let p = 1; p <= 6; p++) {
      expect(st.players[p].homeTileId).toBe(m.spawns[slotOf[p - 1]].homeTileId);
      expect(st.owners[st.players[p].homeTileId]).toBe(p);
      expect(st.map.spawns[p - 1].playerId).toBe(p);
    }
    const sim = new Simulation(st);
    for (let i = 0; i < 60; i++) {
      sim.step();
      expect(ledgerImbalance(st)).toBe(0);
    }
  });

  it('spawnSlot 생략 = 옛 동작 (playerId p → 슬롯 p-1, 같은 map 객체)', () => {
    const m = generateMap(777, 72, 42, 6);
    const st = createGameState(m, setupOf(6));
    expect(st.map).toBe(m);
    expect(st.players[1].homeTileId).toBe(m.spawns[0].homeTileId);
  });

  it('같은 시드·같은 배정이면 같은 결과 (결정론)', () => {
    const run = () => {
      const m = generateMap(31, 72, 42, 6);
      const slotOf = shuffledSlots(8, 6);
      const st = createGameState(m, setupOf(6, (i) => ({ spawnSlot: slotOf[i] })));
      const sim = new Simulation(st, CivBot);
      for (let i = 0; i < 600; i++) sim.step();
      return st.players.slice(1).map((p) => [p.tiles, p.troopsMilli]);
    };
    expect(run()).toEqual(run());
  });

  it('봇 테크 목록은 playerId%4 가 아니라 시드 기반 균형 배정', () => {
    let sameAsLegacy = 0;
    const firstOwner = new Array(4).fill(0);
    for (let seed = 1; seed <= 40; seed++) {
      const m = generateMap(seed, 72, 42, 6);
      const st = createGameState(m, setupOf(6), undefined, seed);
      const styles = st.players.slice(1).map((p) => p.bot.techStyle!);
      const cnt = [0, 0, 0, 0];
      for (const s of styles) cnt[s]++;
      expect(Math.max(...cnt) - Math.min(...cnt)).toBeLessThanOrEqual(1); // 6명: 2,2,1,1
      if (styles.every((s, i) => s === i % 4)) sameAsLegacy++;
      firstOwner[styles[0]]++;
      // 결정론
      expect(createGameState(m, setupOf(6), undefined, seed).players.slice(1).map((p) => p.bot.techStyle)).toEqual(styles);
    }
    expect(sameAsLegacy).toBeLessThan(5);
    expect(Math.min(...firstOwner.slice(0, 4))).toBeGreaterThan(3); // playerId 1 이 4개 목록을 모두 받는다
  });

  it('techStyle 강제값을 존중한다', () => {
    const m = generateMap(5, 72, 42, 4);
    const st = createGameState(m, setupOf(4, () => ({ techStyle: 2 })));
    expect(st.players.slice(1).map((p) => p.bot.techStyle)).toEqual([2, 2, 2, 2]);
  });
});

describe('룸 — 시작 시 슬롯 섞기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('방장이 항상 슬롯 0 을 받지 않고, map_init.spawns 는 playerId 로 조회된다', () => {
    const hostSlots = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const lobby = new LobbyManager({ seed, catalog: MapCatalog.loadDir('/nonexistent/') });
      const inbox: ServerMessage[] = [];
      const s = lobby.createSession('host');
      s.socket = { send: (d: string) => inbox.push(JSON.parse(d) as ServerMessage), close: () => {} };
      expect(lobby.createPrivate(s, { map: { kind: 'random', size: 'S' }, maxPlayers: 5, botCount: 4 })).toBeNull();
      const room = lobby.roomOf(s)!;
      room.startNow(s);
      vi.advanceTimersByTime(3000);
      expect(room.phase).toBe('IN_GAME');
      const st = room.sim!.state;
      const orig = generateMapForSize(st.map.seed, 'S', 5); // 섞기 전 슬롯 순서
      const mi = [...inbox].reverse().find((m) => m.type === 'map_init') as Extract<ServerMessage, { type: 'map_init' }>;
      expect(mi.spawns.map((x) => x.playerId)).toEqual([1, 2, 3, 4, 5]);
      expect(mi.spawns.map((x) => x.homeTileId).sort((a, b) => a - b)).toEqual(orig.spawns.map((x) => x.homeTileId).sort((a, b) => a - b));
      for (let p = 1; p <= 5; p++) expect(st.players[p].homeTileId).toBe(mi.spawns[p - 1].homeTileId);
      hostSlots.add(orig.spawns.findIndex((x) => x.homeTileId === st.players[1].homeTileId));
      lobby.shutdown();
    }
    expect(hostSlots.size).toBeGreaterThanOrEqual(3);
  });
});

describe('봇 앵커 동률 해시 (§32)', () => {
  it('결정론이고 기본은 해시 모드(botDiag.legacyTie = false)', () => {
    expect(botDiag.legacyTie).toBe(false);
    expect(tileTieHash(1, 77)).toBe(tileTieHash(1, 77));
    expect(tileTieHash(1, 77)).not.toBe(tileTieHash(2, 77));
  });

  it('창 안에서 해시 최소 칸이 위쪽 행에 몰리지 않는다 (옛 규칙 "tileId 최소" 는 항상 맨 위 행)', () => {
    const W = 100;
    const rowSum: number[] = [];
    let firstRow = 0;
    const T = 300;
    for (let k = 0; k < T; k++) {
      const x0 = (k * 7) % 80;
      const y0 = (k * 13) % 40;
      let best = -1;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
        const t = (y0 + dy) * W + x0 + dx;
        if (best < 0 || tileTieHash(0x2f6b9a1d, t) < tileTieHash(0x2f6b9a1d, best)) best = t;
      }
      const row = Math.floor(best / W) - y0;
      rowSum.push(row);
      if (row === 0) firstRow++;
    }
    const mean = rowSum.reduce((a, b) => a + b, 0) / T;
    expect(Math.abs(mean - 3.5)).toBeLessThan(0.5); // 균등이면 3.5
    expect(firstRow).toBeLessThan(T * 0.25); // 균등이면 12.5%
  });
});
