/**
 * v5.1 (§37) 확인용 봇 자가대전 — 판 길이 · 패주 수 · 사기 0 자동 후퇴 수 · flag_recalled reason 분포 · 거절 사유(BASE_COOLDOWN) · 회계 불변식.
 * 실행: npx tsx server/scripts/v51-selfplay.ts [games=2] [seed0=1000] [size=M] [N=10]
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN, type MapSizeClass } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { createGameState, ledgerImbalance } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';

const games = Number(process.argv[2] ?? 2);
const seed0 = Number(process.argv[3] ?? 1000);
const size = (process.argv[4] ?? 'M') as MapSizeClass;
const N = Number(process.argv[5] ?? 10);

for (let k = 0; k < games; k++) {
  const seed = seed0 + k;
  const P = MAP_SIZE_PRESETS[size];
  const state = createGameState(generateMap(seed, P.w, P.h, N), Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'NORMAL' as const })));
  const sim = new Simulation(state, CivBot);
  let routs = 0;
  let issued = 0;
  let accepted = 0;
  let rejected = 0;
  let ledgerBad = 0;
  let elim = 0;
  const recallBy: Record<string, number> = {};
  const rejects: Record<string, number> = {};
  let over: { finalTick: number; reason: string; winnerId: number | null } | null = null;
  const t0 = performance.now();
  while (!over && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const m of out.broadcast) {
      if (m.type === 'flag_routed') routs++;
      else if (m.type === 'flag_recalled') recallBy[m.reason ?? 'none'] = (recallBy[m.reason ?? 'none'] ?? 0) + 1;
      else if (m.type === 'flag_issued') issued++;
      else if (m.type === 'player_eliminated') elim++;
      else if (m.type === 'game_over') over = m;
    }
    for (const { msg } of out.personal) {
      if (msg.type !== 'cmd_ack') continue;
      if (msg.accepted) accepted++;
      else {
        rejected++;
        rejects[msg.reason ?? '?'] = (rejects[msg.reason ?? '?'] ?? 0) + 1;
      }
    }
    if (ledgerImbalance(state) !== 0) ledgerBad++;
  }
  const end = over?.finalTick ?? state.tick;
  console.log(
    JSON.stringify({
      seed,
      endTick: end,
      endMin: +(end / TICKS_PER_MIN).toFixed(2),
      reason: over?.reason ?? 'none',
      winner: over?.winnerId ?? null,
      eliminated: elim,
      routs,
      moraleRetreats: recallBy.morale ?? 0,
      recallBy,
      issued,
      accepted,
      rejected,
      rejectPct: +((rejected * 100) / Math.max(1, accepted + rejected)).toFixed(2),
      baseCooldownRejects: rejects.BASE_COOLDOWN ?? 0,
      rejects,
      ledgerBadTicks: ledgerBad,
      wallSec: +((performance.now() - t0) / 1000).toFixed(1),
    }),
  );
}
