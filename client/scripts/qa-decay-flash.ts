/** [QA 커밋 금지] 렌더러의 감소 표시 규칙(진척 감소 ∧ >0)이 실제 7c 감소와 일치하는지: 대상 칸이 바뀐 tick 의 오탐 수 */
import { MAP_GEN_DEFAULT, type ServerMessage } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';
const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
const map = generateMapForSize(2202, 'M', 10, MAP_GEN_DEFAULT);
const state = createGameState(map, Array.from({ length: 10 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), 'NORMAL');
const sim = new Simulation(state, CivBot);
const g = new GameModel(wire(buildMatchConfig(state)));
g.apply(wire(buildMapInit(state)));
g.apply(wire(buildSnapshotFull(state)));
const prev = new Map<number, { pct: number; tgt: number | null }>();
let trueDecay = 0, flagged = 0, falsePos = 0, missedDecay = 0;
const lostDecayed = new Set<number>();
const samples: string[] = [];
while (!sim.finished && state.tick < 4000) {
  const out = sim.step();
  for (const m of out.broadcast) {
    const w = wire(m) as ServerMessage;
    if (w.type === 'flag_progress_lost' && w.cause === 'decayed') lostDecayed.add(w.flagId);
    g.apply(w);
  }
  for (const f of g.flags.values()) {
    const p = prev.get(f.id);
    if (p) {
      const rendererFlag = f.progressPct < p.pct && f.progressPct > 0;
      const sf = state.flags.find((x) => x.id === f.id)!;
      const realDecay = f.targetTileId === p.tgt && f.progressPct < p.pct; // 같은 칸에서 감소
      if (realDecay) trueDecay++;
      if (rendererFlag) flagged++;
      if (rendererFlag && !realDecay) { falsePos++; if (samples.length < 8) samples.push(`t${state.tick} f${f.id} ${p.pct}→${f.progressPct} tgt ${p.tgt}→${f.targetTileId} state ${sf.state}`); }
      if (realDecay && !rendererFlag) missedDecay++;
    }
    prev.set(f.id, { pct: f.progressPct, tgt: f.targetTileId });
  }
}
console.log({ ticks: state.tick, trueDecayTicks: trueDecay, rendererFlaggedTicks: flagged, falsePositive: falsePos, missedDecay_to0: missedDecay, decayedEvents: lostDecayed.size, samples });
