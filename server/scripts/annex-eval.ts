/**
 * 약소국 정리 보상 평가 (§31) — 자가대전 한 판마다 JSON 한 줄을 stdout 에 낸다.
 * 실행: CIVWAR_ANNEX="asset=500,gold=1000,troops=0,bgold=0,prod=0" npx tsx server/scripts/annex-eval.ts [games=5] [seed0=1000] [size=M] [N=10]
 * 집계: node server/scripts/annex-agg.cjs <jsonl...>
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, POSTURE, TICKS_PER_MIN, type MapSizeClass } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { ANNEX } from '../src/game/annex.js';
import { createGameState, ledgerImbalance } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';

const games = Number(process.argv[2] ?? 5);
const seed0 = Number(process.argv[3] ?? 1000);
const size = (process.argv[4] ?? 'M') as MapSizeClass;
const N = Number(process.argv[5] ?? 10);
const checkLedger = process.env.CIVWAR_SELFPLAY_LEDGER === '1';

for (let k = 0; k < games; k++) {
  const seed = seed0 + k;
  const P = MAP_SIZE_PRESETS[size];
  const map = generateMap(seed, P.w, P.h, N);
  const state = createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
  const sim = new Simulation(state, CivBot);
  const land = map.totalLandTiles;
  let lastBaseTicks = 0; // 마지막 기지 하나만 남은 생존자 수 × tick (5 tick 표본)
  let lastBaseHitTicks = 0; // 그 기지가 이번 tick 피해를 받은 표본 수
  let lastBaseHitDistinct = 0;
  const lbFlag: Record<string, number> = { any: 0, march: 0, engaged: 0, combat: 0, atBase: 0 };
  let elims = 0;
  let bountyT = 0;
  let bountyG = 0;
  const elimTicks: number[] = [];
  const heirRank: number[] = []; // 멸망 순간 합병자의 영토 순위 (합병분 제외, 1 = 1위)
  const elimBy: number[] = [];
  let gameOver: { finalTick: number; reason: string; winnerId: number | null } | null = null;
  let weakest20 = -1;
  while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const m of out.broadcast) {
      if (m.type === 'game_over') gameOver = { finalTick: m.finalTick, reason: m.reason, winnerId: m.winnerId };
      else if (m.type === 'player_eliminated') {
        elims++;
        elimTicks.push(m.tick);
        if (m.byPlayerId) {
          elimBy.push(m.byPlayerId);
          const pre = (id: number) => state.players[id].tiles - (id === m.byPlayerId ? (m.annexedTiles ?? 0) : 0);
          const h = pre(m.byPlayerId);
          heirRank.push(1 + state.players.filter((q) => q && q.alive && q.id !== m.byPlayerId && pre(q.id) > h).length);
        }
        bountyT += m.bountyTroops ?? 0;
        bountyG += m.bountyGold ?? 0;
      }
    }
    if (state.tick % 5 === 0) {
      for (const p of state.players) {
        if (state.tick < 12 * TICKS_PER_MIN || !p || !p.alive || p.baseTiles.length !== 1) continue;
        lastBaseTicks++;
        const b = state.bases[state.baseIndexOf.get(p.baseTiles[0])!];
        if (b.lastDamageTick > state.tick - 5 && b.lastDamageTick <= state.tick) lastBaseHitTicks++;
      }
    }
    if (state.tick % 5 === 0 && state.tick >= 12 * TICKS_PER_MIN) {
      for (const f of state.flags) {
        if (f.posture !== POSTURE.ATTACK) continue;
        const o = state.owners[f.anchorTileId];
        if (o === 0 || o === f.ownerId || !state.players[o].alive || state.players[o].baseTiles.length !== 1 || state.players[o].baseTiles[0] !== f.anchorTileId) continue;
        lbFlag.any++;
        if (f.state === 'MARCHING') lbFlag.march++;
        if (f.state === 'ENGAGED') lbFlag.engaged++;
        if (f.inCombat) lbFlag.combat++;
        if (f.posTileId === f.anchorTileId) lbFlag.atBase++;
      }
    }
    if (state.tick === 20 * TICKS_PER_MIN) weakest20 = Math.min(...state.players.filter((p) => p && p.alive).map((p) => p.tiles));
    if (checkLedger && ledgerImbalance(state) !== 0) throw new Error(`ledger imbalance seed ${seed} tick ${state.tick}`);
  }
  const alive = state.players.filter((p) => p && p.alive);
  const sorted = state.players.filter(Boolean).slice().sort((a, b) => b.tiles - a.tiles);
  const pct = (n: number) => Math.round((n * 1000) / land) / 10;
  const top1 = pct(sorted[0].tiles);
  const top2 = pct(sorted[0].tiles + sorted[1].tiles);
  const bottom4 = pct(sorted.slice(-4).reduce((a, p) => a + p.tiles, 0));
  const minAlive = alive.length ? pct(Math.min(...alive.map((p) => p.tiles))) : 0;
  if (process.env.DBG) console.error('DBG', JSON.stringify((globalThis as any).__dbg));
  console.log(
    JSON.stringify({
      seed,
      annex: ANNEX,
      endMin: Math.round(((gameOver?.finalTick ?? state.tick) / TICKS_PER_MIN) * 100) / 100,
      reason: gameOver?.reason ?? 'none',
      elims,
      elimMin: elimTicks.map((t) => Math.round((t / TICKS_PER_MIN) * 10) / 10),
      aliveEnd: alive.length,
      oneBaseEnd: alive.filter((p) => p.baseTiles.length === 1).length,
      minAlivePct: minAlive,
      weakest20Pct: weakest20 < 0 ? null : pct(weakest20),
      top1,
      top2,
      bottom4,
      lastBaseSec: lastBaseTicks, // 마지막 기지만 남은 생존자 x 초 (5 tick 표본 = 1초)
      lastBaseHitShare: lastBaseTicks ? Math.round((lastBaseHitTicks * 1000) / lastBaseTicks) / 10 : null,
      bountyT,
      heirRank,
      lbFlag,
      bountyG,
    }),
  );
}
