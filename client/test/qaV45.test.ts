/**
 * QA v4.5 회귀 (2026-10-18) — 실제 Simulation 명령 경로 + 실제 ClientStore.
 *  - 태세 쿨타임 중 우클릭(retarget): 서버는 태세를 즉시 바꾸지 않고 pendingPosture, 쿨타임이 끝난 첫 tick 에 자동 전환
 *  - 방어 깃발 unreachable IDLE: 실제 소유 지도에서 서버 이벤트 → 클라이언트 모델, 클라이언트 경로 미리보기 = 서버 defendDest
 *  - 클라이언트 route.ts 방어 경로 ↔ 서버 nextStep/defendDest 걸음 열 (봇 판 중간 상태, 동맹 주입)
 *  - 멸망·합병: annexedTiles ↔ delta.tileChanges, 직후 새 부트스트랩 = 이어 받은 모델
 */
import { describe, expect, it } from 'vitest';
import { MAP_GEN_DEFAULT, POSTURE, UNIT, type C2S_GameCommand, type RoomMember, type S2C_RoomState, type ServerMessage } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';
import { RouteCache, computeRoute } from '../src/input/route.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState, makeFlag, rebuildAllyMatrix, type GameState } from '../../server/src/game/state.js';
import { IdleBot, Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';
import { defendDest, nextStep } from '../../server/src/game/rules.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
function roomState(state: GameState): S2C_RoomState {
  const players: RoomMember[] = state.players
    .filter(Boolean)
    .map((p) => ({ playerId: p.id, sessionId: p.id === 1 ? 's_me' : null, nickname: `n${p.id}`, isBot: p.id !== 1, isHost: p.id === 1, ready: true, status: p.alive ? 'PLAYING' : 'ELIMINATED_SPECTATING' }));
  return {
    type: 'room_state',
    roomId: 'r1',
    roomCode: 'QAQAQA',
    isPublic: false,
    phase: 'IN_GAME',
    hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: players.length, botCount: players.length - 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'x', expectedPlayers: players.length },
    players,
    spectatorCount: 0,
    countdownMs: null,
    autoStartMs: null,
  };
}
function bootstrap(state: GameState): ClientStore {
  const s = new ClientStore('ws://unused');
  s.sessionId = 's_me';
  s.onMessage(wire(roomState(state)));
  s.onMessage(wire(buildMatchConfig(state)));
  s.onMessage(wire(buildMapInit(state)));
  s.onMessage(wire(buildSnapshotFull(state)));
  return s;
}
let seq = 0;
function step(sim: Simulation, cmds: [number, Record<string, unknown>][] = [], stores: ClientStore[] = []) {
  const seqs: number[] = [];
  for (const [pid, c] of cmds) {
    const clientSeq = ++seq;
    seqs.push(clientSeq);
    sim.enqueue(pid, pid, { ...c, clientSeq } as unknown as C2S_GameCommand);
  }
  const out = sim.step();
  const msgs = [...out.broadcast, ...out.personal.map((p) => p.msg)].map((m) => wire(m) as ServerMessage);
  for (const s of stores) for (const m of msgs) s.onMessage(m);
  return { msgs, acks: seqs.map((q) => msgs.find((m) => m.type === 'cmd_ack' && (m as { clientSeq?: number }).clientSeq === q) as any) };
}
const mkState = (seed: number, n: number, size: 'S' | 'M' | 'L', bots: boolean) =>
  createGameState(generateMapForSize(seed, size, n, MAP_GEN_DEFAULT), Array.from({ length: n }, (_, i) => ({ playerId: i + 1, isBot: bots, connected: true, botDifficulty: 'HARD' as const })), 'NORMAL', seed);

// v4.6 (§27): '쿨타임 중 retarget → pendingPosture' 검증은 폐기됨 (pendingPosture 제거). 프론트 재작업 때 postureHeld 기준으로 다시 쓸 것.

describe('QA v4.5 — 방어 깃발 "unreachable" (실제 명령·실제 소유 지도)', () => {
  it('막히는 방어 앵커 발령 → 서버 IDLE(unreachable) @ defendDest → 모델 flagIdleReason, 600 tick 뒤 자동 귀환; 클라이언트 미리보기 = 서버 정지 칸', () => {
    for (const seed of [41, 42, 43]) {
      const state = mkState(seed, 8, 'M', true);
      const bot = new Simulation(state, CivBot);
      for (let i = 0; i < 2600 && !bot.finished; i++) bot.step();
      state.flags.length = 0;
      for (const p of state.players) if (p) p.isBot = false;
      const sim = new Simulation(state, IdleBot);
      const store = bootstrap(state);
      const g = store.game!;
      const topo = createTopologyView('square', state.map.width, state.map.height);
      let pick: { p: number; B: number; A: number; stop: number } | null = null;
      outer: for (let p = 1; p <= 8; p++) {
        const pl = state.players[p];
        if (!pl.alive || pl.baseTiles.length < 1) continue;
        const mine: number[] = [];
        for (let t = 0; t < state.owners.length; t++) if (state.owners[t] === p) mine.push(t);
        for (const B of pl.baseTiles)
          for (let k = 0; k < mine.length; k += 7) {
            const A = mine[k];
            if (A === B) continue;
            const d = defendDest(state, p, B, A);
            if (d !== A && d !== B && state.graph.distance(B, A) < 40) {
              pick = { p, B, A, stop: d };
              break outer;
            }
          }
      }
      if (!pick) continue;
      const { p, B, A, stop } = pick;
      const rt = computeRoute(g, topo, new RouteCache().fieldFor(g, topo, A), p, B, A, false);
      expect(rt.blocked).toBe(true);
      expect(rt.stopTile).toBe(stop);
      const r = step(sim, [[p, { type: 'cmd_flag_issue', unit: UNIT.SWORD, troops: 40, anchorTileId: A, originBaseTileId: B }]], [store]);
      expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
      const fid = r.acks[0].flagId as number;
      let idle: any = null;
      for (let i = 0; i < 1500 && !idle; i++) {
        idle = step(sim, [], [store]).msgs.find((m) => m.type === 'flag_idle' && (m as { flagId: number }).flagId === fid) ?? null;
      }
      expect(idle).toMatchObject({ reason: 'unreachable' });
      expect(idle.autoRecallTick).toBe(idle.tick + 600);
      const f = state.flags.find((x) => x.id === fid)!;
      expect(f.state).toBe('IDLE');
      expect(f.posTileId).toBe(stop);
      while (state.tick % 5 !== 0) step(sim, [], [store]); // flagStats 는 1초 주기
      expect(g.flags.get(fid)).toMatchObject({ state: 'IDLE', posTileId: stop });
      expect(g.flagIdleReason.get(fid)).toBe('unreachable');
      let ret = false;
      for (let i = 0; i < 620 && !ret; i++) {
        step(sim, [], [store]);
        const ff = state.flags.find((x) => x.id === fid);
        ret = !ff || ff.state === 'RETURNING';
      }
      expect(ret).toBe(true);
      return;
    }
    throw new Error('막히는 방어 앵커를 못 찾음');
  }, 60000);
});

describe('QA v4.5 — 클라이언트 route.ts 방어 경로 = 서버 nextStep/defendDest', () => {
  it('봇 판 중간 상태(+동맹 주입)에서 무작위 (출발, 앵커) 걸음 열·막힘 정지 칸이 같다', () => {
    let rng = 987654321;
    const rand = (n: number) => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) % n);
    const N = 8;
    const state = mkState(51, N, 'S', true);
    const sim = new Simulation(state, CivBot);
    const topo = createTopologyView('square', state.map.width, state.map.height);
    let total = 0;
    let blocked = 0;
    for (let stage = 0; stage < 3; stage++) {
      for (let i = 0; i < 500; i++) sim.step();
      if (stage >= 1) {
        for (let k = 0; k < 3; k++) {
          const x = 1 + rand(N);
          const y = 1 + rand(N);
          if (x === y || state.alliances.some((a) => a.a === Math.min(x, y) && a.b === Math.max(x, y))) continue;
          state.alliances.push({ a: Math.min(x, y), b: Math.max(x, y), state: rand(2) ? 'ACTIVE' : 'BREAKING', sinceTick: state.tick, breakAtTick: null } as never);
        }
        rebuildAllyMatrix(state);
      }
      const store = bootstrap(state);
      const model = store.game!;
      const cache = new RouteCache();
      const land: number[] = [];
      for (let t = 0; t < state.owners.length; t++) if (state.map.terrain[t] !== 0 && state.map.terrain[t] !== 6) land.push(t);
      for (let k = 0; k < 150; k++) {
        const me = 1 + rand(N);
        const mine = land.filter((t) => state.owners[t] === me);
        if (!mine.length) continue;
        const from = mine[rand(mine.length)];
        const anchor = land[rand(land.length)];
        const flag = makeFlag({ id: 9999, ownerId: me, slotIndex: 0, unit: UNIT.SWORD, troopsMilli: 40000, initialTroops: 40, posTileId: from, anchorTileId: anchor, originTileId: from });
        flag.posture = POSTURE.DEFEND;
        const sdest = defendDest(state, me, from, anchor);
        const spath = [from];
        let pos = from;
        for (let gd = 0; gd < 8192; gd++) {
          const nx = nextStep(state, flag, pos, anchor);
          if (nx === pos) break;
          pos = nx;
          spath.push(pos);
        }
        const r = computeRoute(model, topo, cache.fieldFor(model, topo, anchor), me, from, anchor, false);
        total++;
        if (sdest !== anchor) blocked++;
        expect(r.path).toEqual(spath);
        expect(r.blocked).toBe(sdest !== anchor);
        if (sdest !== anchor) expect(r.stopTile).toBe(sdest);
      }
    }
    expect(total).toBeGreaterThan(300);
    expect(blocked).toBeGreaterThan(0);
  }, 60000);
});

describe('QA v4.5 — 멸망·합병 경계면', () => {
  it('player_eliminated.annexedTiles ↔ 같은 tick delta.tileChanges, 멸망자 잔여 칸 0, 직후 새 부트스트랩 = 이어 받은 모델(소유·기지 소유자)', () => {
    let elims = 0;
    for (const seed of [7002, 7004]) {
      const state = mkState(seed, 12, seed === 7002 ? 'S' : 'M', true);
      state.players[1].isBot = false;
      state.players[1].disconnectedSinceTick = 0;
      const sim = new Simulation(state, CivBot);
      const main = bootstrap(state);
      const g = main.game!;
      while (!sim.finished && state.tick < 9600) {
        const before = Uint8Array.from(state.owners);
        const out = sim.step();
        const msgs = out.broadcast.map((m) => wire(m) as ServerMessage);
        for (const m of msgs) main.onMessage(m);
        const delta = msgs.find((m) => m.type === 'snapshot_delta') as any;
        for (const m of msgs) {
          if (m.type !== 'player_eliminated') continue;
          elims++;
          const e = m as { playerId: number; byPlayerId: number | null; annexedTiles: number };
          const moved = (delta.tileChanges as [number, number][]).filter(([tile, o]) => before[tile] === e.playerId && o === (e.byPlayerId ?? 0)).length;
          // 같은 tick 앞 단계(마지막 기지 함락)에서 by 가 가져간 칸만큼 많다
          expect(moved - e.annexedTiles).toBeGreaterThanOrEqual(0);
          expect(moved - e.annexedTiles).toBeLessThanOrEqual(5);
          expect(Array.from(state.owners).filter((o) => o === e.playerId).length).toBe(0);
          const late = bootstrap(state).game!;
          expect(Array.from(late.owners)).toEqual(Array.from(g.owners));
          for (const [tile, b] of g.bases) expect(b.ownerId).toBe(state.owners[tile]);
          expect(late.baseNames).toEqual(g.baseNames);
        }
      }
    }
    expect(elims).toBeGreaterThan(0);
  }, 120000);
});
