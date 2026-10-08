/**
 * 확장 체크 — 8인 × 5분(1500 tick), 단순 탐욕 확장 봇으로 1인당 타일 수를 본다 (페이싱 감 잡기용, 봇 AI 아님).
 *
 * 봇 규칙 (15 tick 마다, playerId ASC):
 *   빈 슬롯이 있고 풀 ≥ 120 이면, 내 땅에서 4~6칸 떨어진 중립 육지 중 수도에 가장 가까운 칸(동률 tileId ASC,
 *   내 다른 깃발 앵커와 거리 ≥ 7)을 앵커로 검병(SWORD) 공격 깃발 발령, 병력 = 풀의 80%.
 *
 * 실행: npx tsx server/scripts/expand8.ts [seed=4242] [size=default|S|M|L]
 *   size=default → 2.3 표 8인 기본 격자 90×54 (v4.0 측정과 같은 조건)
 */
import { FLAG_MIN_TROOPS, MAP_SIZE_PRESETS, UNIT, isClaimable, type C2S_GameCommand, type MapSizeClass } from '@civwar/shared';
import { flagCap } from '../src/game/economy.js';
import { minDistFromTerritory } from '../src/game/rules.js';
import { NEUTRAL, createGameState, ledgerImbalance, type GameState } from '../src/game/state.js';
import { Simulation, type BotBrain } from '../src/game/tick.js';
import { generateMap, generateMapForPlayers } from '../src/map/generate.js';

const seed = Number(process.argv[2] ?? 4242);
const sizeArg = process.argv[3] ?? 'default';
const N = 8;
const TICKS = 1500;

let clientSeq = 0;
const Greedy: BotBrain = {
  decide(state: Readonly<GameState>, id: number): C2S_GameCommand[] {
    const p = state.players[id];
    const mine = state.flags.filter((f) => f.ownerId === id);
    if (mine.length >= flagCap(p)) return [];
    const pool = Math.floor(p.troopsMilli / 1000);
    if (pool < 3 * FLAG_MIN_TROOPS) return [];
    const home = p.homeTileId;
    let best = -1;
    let bd = Infinity;
    for (const t of state.graph.disk(home, 30)) {
      if (state.owners[t] !== NEUTRAL || !isClaimable(state.map.terrain[t]) || state.map.isBase[t]) continue;
      const dh = state.graph.distance(t, home);
      if (dh > bd || (dh === bd && t > best)) continue;
      if (mine.some((f) => state.graph.distance(f.anchorTileId, t) < 7)) continue;
      const md = minDistFromTerritory(state, id, t);
      if (md < 4 || md > 6) continue;
      best = t;
      bd = dh;
    }
    if (best < 0) return [];
    return [{ type: 'cmd_flag_issue', clientSeq: ++clientSeq, unit: UNIT.SWORD, troops: Math.floor((pool * 4) / 5), anchorTileId: best, originBaseTileId: null }];
  },
};

const map =
  sizeArg === 'default' ? generateMapForPlayers(seed, N) : generateMap(seed, MAP_SIZE_PRESETS[sizeArg as MapSizeClass].w, MAP_SIZE_PRESETS[sizeArg as MapSizeClass].h, N);
const state = createGameState(
  map,
  Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })),
);
const sim = new Simulation(state, Greedy);
const counts: Record<string, number> = {};
const t0 = Date.now();
for (let i = 0; i < TICKS; i++) {
  const out = sim.step();
  for (const m of out.broadcast) {
    if (m.type === 'flag_progress_lost') counts[`lost:${m.cause}`] = (counts[`lost:${m.cause}`] ?? 0) + 1;
    else if (m.type === 'flag_ended') counts[`ended:${m.reason}`] = (counts[`ended:${m.reason}`] ?? 0) + 1;
    else if (m.type === 'flag_idle') counts[`idle:${m.reason}`] = (counts[`idle:${m.reason}`] ?? 0) + 1;
    else if (m.type === 'flag_stalled' || m.type === 'combat_started' || m.type === 'flag_issued' || m.type === 'flag_engaged' || m.type === 'flag_retargeted' || m.type === 'base_captured') counts[m.type] = (counts[m.type] ?? 0) + 1;
  }
  if (ledgerImbalance(state) !== 0) throw new Error(`ledger imbalance at tick ${state.tick}`);
}
const ms = Date.now() - t0;
const tiles = state.players.filter(Boolean).map((p) => p.tiles);
console.log(`map ${map.width}x${map.height} seed=${map.seed} land=${map.totalLandTiles}, ${N}인 ${TICKS} tick (${TICKS / 300}분), ${(ms / TICKS).toFixed(2)} ms/tick`);
console.log(`tiles per player: [${tiles.join(', ')}]  min ${Math.min(...tiles)} / max ${Math.max(...tiles)} / mean ${(tiles.reduce((a, b) => a + b, 0) / N).toFixed(1)}`);
console.log(`neutral left: ${state.owners.reduce((a, o, t) => a + (o === NEUTRAL && isClaimable(state.map.terrain[t]) ? 1 : 0), 0)}`);
console.log(`events: ${JSON.stringify(counts)}`);
