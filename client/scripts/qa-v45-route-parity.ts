/**
 * [QA v4.5 — 커밋 금지] 클라이언트 input/route.ts 방어 경로 ↔ 서버 rules.ts nextStep/defendDest 대조.
 * 봇 판을 N tick 돌려 현실적인 소유권·동맹을 만든 뒤, 무작위 (출발, 앵커, 플레이어) 에 대해 두 구현의 걸음 열을 비교한다.
 * 실행: npx tsx client/scripts/qa-v45-route-parity.ts
 */
import { MAP_GEN_DEFAULT, POSTURE, UNIT, type RoomMember, type S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';
import { RouteCache, computeRoute } from '../src/input/route.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState, makeFlag, rebuildAllyMatrix, type GameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { MapCatalog, mapFromPreset } from '../../server/src/map/presets.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';
import { nextStep, defendDest } from '../../server/src/game/rules.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
function roomState(state: GameState): S2C_RoomState {
  const players: RoomMember[] = state.players.filter(Boolean).map((p) => ({ playerId: p.id, sessionId: p.id === 1 ? 's_me' : null, nickname: `n${p.id}`, isBot: p.id !== 1, isHost: p.id === 1, ready: true, status: 'PLAYING' }));
  return { type: 'room_state', roomId: 'r1', roomCode: 'QAQAQA', isPublic: false, phase: 'IN_GAME', hostId: 1, settings: { map: { kind: 'random', size: 'M' }, maxPlayers: players.length, botCount: players.length - 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'x', expectedPlayers: players.length }, players, spectatorCount: 0, countdownMs: null, autoStartMs: null };
}
let rng = 987654321;
const rand = (n: number) => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) % n);

const cfgs = [
  { name: 'S random 1', size: 'S' as const, seed: 51, n: 8, ticks: 1500 },
  { name: 'M random', size: 'M' as const, seed: 52, n: 10, ticks: 2500 },
  { name: 'L random', size: 'L' as const, seed: 53, n: 12, ticks: 3500 },
  { name: 'M official-m-01', preset: 'official-m-01', n: 10, ticks: 2200 },
  { name: 'L official-l-02', preset: 'official-l-02', n: 12, ticks: 3000 },
];
let total = 0, mism = 0, blockedCases = 0, allyCases = 0;
const samples: string[] = [];
for (const cfg of cfgs) {
  const map = cfg.preset ? mapFromPreset(MapCatalog.loadDir().get(cfg.preset)!, cfg.n) : generateMapForSize(cfg.seed!, cfg.size!, cfg.n, MAP_GEN_DEFAULT);
  const setup = Array.from({ length: cfg.n }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'HARD' as const }));
  const state = createGameState(map, setup, 'NORMAL', 777);
  const sim = new Simulation(state, CivBot);
  const topo = createTopologyView('square', map.width, map.height);
  for (let stage = 0; stage < 4; stage++) {
    for (let i = 0; i < cfg.ticks / 4 && !sim.finished; i++) sim.step();
    if (stage >= 1) { // 동맹 주입 (봇이 동맹을 안 맺어 경로의 isAlly 분기가 비어 있다)
      for (let k = 0; k < 2 + stage; k++) {
        const x = 1 + rand(cfg.n), y = 1 + rand(cfg.n);
        if (x === y || state.alliances.some((a) => (a.a === Math.min(x, y) && a.b === Math.max(x, y)))) continue;
        state.alliances.push({ a: Math.min(x, y), b: Math.max(x, y), state: rand(2) ? 'ACTIVE' : 'BREAKING', sinceTick: state.tick, breakAtTick: null } as never);
      }
      rebuildAllyMatrix(state);
    }
    const store = new ClientStore('ws://unused');
    store.sessionId = 's_me';
    store.onMessage(wire(roomState(state)));
    store.onMessage(wire(buildMatchConfig(state)));
    store.onMessage(wire(buildMapInit(state)));
    store.onMessage(wire(buildSnapshotFull(state)));
    const model = store.game!;
    const cache = new RouteCache();
    const land: number[] = [];
    for (let t = 0; t < state.owners.length; t++) if (map.terrain[t] !== 0 && map.terrain[t] !== 6) land.push(t);
    const nAlly = state.alliances.length;
    if (nAlly) allyCases++;
    for (let k = 0; k < 400; k++) {
      const me = 1 + rand(cfg.n);
      const mine = land.filter((t) => state.owners[t] === me);
      if (!mine.length) continue;
      const from = mine[rand(mine.length)];
      const anchor = land[rand(land.length)];
      const flag = makeFlag({ id: 9999, ownerId: me, slotIndex: 0, unit: UNIT.SWORD, troopsMilli: 40000, initialTroops: 40, posTileId: from, anchorTileId: anchor, originTileId: from });
      flag.posture = POSTURE.DEFEND;
      // 서버 걸음 열
      const sdest = defendDest(state, me, from, anchor);
      const spath = [from];
      let pos = from;
      for (let g = 0; g < 8192; g++) {
        const nx = nextStep(state, flag, pos, anchor);
        if (nx === pos) break;
        pos = nx;
        spath.push(pos);
      }
      const field = cache.fieldFor(model, topo, anchor);
      const r = computeRoute(model, topo, field, me, from, anchor, false);
      total++;
      const sBlocked = sdest !== anchor;
      if (sBlocked) blockedCases++;
      const same = spath.length === r.path.length && spath.every((v, i) => v === r.path[i]);
      const sameBlock = sBlocked === r.blocked && (!sBlocked || sdest === r.stopTile);
      if (!same || !sameBlock) {
        mism++;
        if (samples.length < 12) samples.push(`${cfg.name} stage${stage} me${me} from${from} anchor${anchor} server dest ${sdest} len ${spath.length} | client blocked=${r.blocked} stop=${r.stopTile} len ${r.path.length}`);
      }
    }
  }
}
console.log(JSON.stringify({ total, mismatches: mism, blockedCases, stagesWithAlliance: allyCases, samples }, null, 1));
process.exit(mism ? 1 : 0);
