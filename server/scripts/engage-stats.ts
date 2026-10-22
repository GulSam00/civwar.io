/** 교전 길이·패주·회수 측정 (§29/§29.5): npx tsx server/scripts/engage-stats.ts [games=20] [seed0=1000] — M 10인 NORMAL 자가대전 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { createGameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';
const games = Number(process.argv[2] ?? 20), seed0 = Number(process.argv[3] ?? 1000), N = 10;
const P = MAP_SIZE_PRESETS.M;
const grp: number[] = [], fl: number[] = [];
let recallsInCombat = 0, routed = 0, broke = 0, elim = 0;
const ends: number[] = [];
const reasons: Record<string, number> = {};
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] / 5 : 0; };
for (let k = 0; k < games; k++) {
  const map = generateMap(seed0 + k, P.w, P.h, N);
  const state = createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'NORMAL' as const })));
  const sim = new Simulation(state, { decide: (s, id, t, p) => CivBot.decide(s, id, t, p) });
  const gs = new Map<number, number>(); const fs = new Map<number, number>();
  let over: any = null;
  while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const m of out.broadcast) {
      if (m.type === 'combat_started') gs.set(m.groupKey, m.tick);
      else if (m.type === 'combat_ended') { const t0 = gs.get(m.groupKey); if (t0 !== undefined) grp.push(m.tick - t0); gs.delete(m.groupKey); }
      else if (m.type === 'flag_routed') routed++;
      else if (m.type === 'flag_disengage_started' && !m.auto) recallsInCombat++;
      else if (m.type === 'flag_disengaged' && m.reason === 'broke_away') broke++;
      else if (m.type === 'game_over') over = m;
    }
    const live = new Set<number>();
    for (const f of state.flags) {
      live.add(f.id);
      const s0 = fs.get(f.id);
      if (f.inCombat && s0 === undefined) fs.set(f.id, state.tick);
      else if (!f.inCombat && s0 !== undefined) { fl.push(state.tick - s0); fs.delete(f.id); }
    }
    for (const [id, s0] of fs) if (!live.has(id)) { fl.push(state.tick - s0); fs.delete(id); }
  }
  elim += state.players.filter((p) => p && !p.alive).length;
  ends.push((over?.finalTick ?? state.tick) / TICKS_PER_MIN);
  const r = over?.reason ?? 'none'; reasons[r] = (reasons[r] ?? 0) + 1;
}
const f1 = (x: number) => x.toFixed(1);
console.log(`engage-stats: ${games} games M N=${N} seed0=${seed0}`);
console.log(`group len med/p90 ${f1(q(grp, .5))}/${f1(q(grp, .9))}s; flag len med/p90 ${f1(q(fl, .5))}/${f1(q(fl, .9))}s`);
console.log(`recall-in-combat/game ${f1(recallsInCombat / games)}, routed/game ${f1(routed / games)}, elim/game ${(elim / games).toFixed(2)}, broke_away/game ${f1(broke / games)}`);
console.log(`end min mean ${f1(ends.reduce((a, b) => a + b, 0) / games)} min ${f1(Math.min(...ends))} max ${f1(Math.max(...ends))}; ${JSON.stringify(reasons)}`);
