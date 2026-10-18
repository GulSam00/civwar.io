import { MAP_GEN_DEFAULT } from '@civwar/shared';
import { createTopologyView } from '../src/render/topology.js';
import { combatPairs } from '../src/render/combatPairs.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState, isAlly } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { attackSide, hostile, combatEligible } from '../../server/src/game/combat.js';
let cp = 0, bad = 0, ticks = 0; const ex: string[] = [];
for (const seed of [11, 12, 13]) {
  const map = generateMapForSize(seed, 'M', 10, MAP_GEN_DEFAULT);
  const st = createGameState(map, Array.from({ length: 10 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'HARD' as const })), 'NORMAL', seed);
  const sim = new Simulation(st, CivBot);
  const topo = createTopologyView('square', map.width, map.height);
  for (let i = 0; i < 6000 && !sim.finished; i++) {
    sim.step();
    if (st.tick % 5) continue;
    ticks++;
    const pairs = combatPairs(st.flags.map((f) => ({ id: f.id, ownerId: f.ownerId, posTileId: f.posTileId, posture: f.posture, inCombat: f.inCombat, state: f.state, routed: f.routed, troops: f.troopsMilli, breakaway: f.breakaway })), (a, b) => topo.touching(a, b), (a, b) => isAlly(st, a, b));
    const byId = new Map(st.flags.map((f) => [f.id, f]));
    for (const p of pairs) {
      cp++;
      const f = byId.get(p.a)!, g = byId.get(p.b)!;
      const edge = combatEligible(f) && combatEligible(g) && hostile(st, f.ownerId, g.ownerId) && (attackSide(f) || attackSide(g));
      if (!edge) { bad++; if (ex.length < 3) ex.push(`t${st.tick} flags ${f.id}(${f.posture}/${f.state}) ${g.id}(${g.posture}/${g.state})`); }
    }
  }
}
console.log(JSON.stringify({ sampledTicks: ticks, clientPairs: cp, notServerEdge: bad, ratio: cp ? (bad / cp).toFixed(3) : 0, ex }));
