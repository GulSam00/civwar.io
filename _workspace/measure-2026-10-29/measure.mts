/**
 * 패주 A/B + 깃발 병력/상한 측정. 판마다 JSON 한 줄.
 * npx tsx measure.ts <root> <arm> <seed0> <games>
 *  arm: A 현행 / B 패치 12차 이전 사기(범위 600~1100 공통, 공격 감소 3/6/10, K=0 — root 는 k0 사본) /
 *       C 손실 연동만 끔(K=0, root=k0) / D 병종별 범위만 되돌림(600~1100, K 유지)
 */
import { pathToFileURL } from 'node:url';
const [root, arm, s0, g] = process.argv.slice(2);
const imp = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const sh = await imp('shared/src/index.ts');
const { CivBot } = await imp('server/src/game/bot.ts');
const { createGameState } = await imp('server/src/game/state.ts');
const { Simulation } = await imp('server/src/game/tick.ts');
const { generateMap } = await imp('server/src/map/generate.ts');
const { troopCap } = await imp('server/src/game/economy.ts');
const { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN, MORALE_FLOOR, MORALE_FULL, MORALE_DROP_PER_TICK, MORALE_DROP_LOSS_K } = sh;
if (arm === 'B' || arm === 'D') {
  (MORALE_FLOOR as number[]).splice(0, 3, 600, 600, 600);
  (MORALE_FULL as number[]).splice(0, 3, 1100, 1100, 1100);
}
if (arm === 'B') (MORALE_DROP_PER_TICK as number[]).splice(0, 3, 3, 6, 10);
if ((arm === 'B' || arm === 'C') !== (MORALE_DROP_LOSS_K === 0)) throw new Error(`arm ${arm} 와 K=${MORALE_DROP_LOSS_K} 불일치 — root 확인`);

const N = 10;
const P = MAP_SIZE_PRESETS.M;
for (let k = 0; k < Number(g); k++) {
  const seed = Number(s0) + k;
  const state = createGameState(generateMap(seed, P.w, P.h, N), Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'NORMAL' as const })));
  const sim = new Simulation(state, CivBot);
  const grpStart = new Map<number, number>();
  const grpLen: number[] = [];
  const ends: Record<string, number> = {};
  const issuedTroops = new Map<number, number>();
  let issuedSum = 0, refundSum = 0, routs = 0, elim = 0, combats = 0;
  // 깃발 병력/상한 표본: 1분마다 살아 있는 나라별 [분, 깃발/상한, (대기+깃발)/상한, 영토 순위]
  const samples: [number, number, number, number][] = [];
  let over: any = null;
  while (!over && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const m of out.broadcast) {
      if (m.type === 'combat_started') { grpStart.set(m.groupKey, m.tick); combats++; }
      else if (m.type === 'combat_ended') { const t0 = grpStart.get(m.groupKey); if (t0 !== undefined) grpLen.push((m.tick - t0) / 5); grpStart.delete(m.groupKey); }
      else if (m.type === 'flag_routed') routs++;
      else if (m.type === 'flag_issued') { issuedTroops.set(m.flagId, m.troops); issuedSum += m.troops; }
      else if (m.type === 'flag_ended') { ends[m.reason] = (ends[m.reason] ?? 0) + 1; refundSum += m.refunded; }
      else if (m.type === 'player_eliminated') elim++;
      else if (m.type === 'game_over') over = m;
    }
    if (state.tick % TICKS_PER_MIN === 0) {
      const minute = state.tick / TICKS_PER_MIN;
      const alive = state.players.filter((p: any) => p && p.alive);
      const ranked = [...alive].sort((a: any, b: any) => b.tiles - a.tiles);
      for (const p of alive) {
        const cap = troopCap(p);
        if (cap <= 0) continue;
        let fl = 0;
        for (const f of state.flags) if (f.ownerId === p.id) fl += f.troopsMilli / 1000;
        samples.push([minute, +(fl / cap).toFixed(3), +((p.troopsMilli / 1000 + fl) / cap).toFixed(3), ranked.indexOf(p) + 1]);
      }
    }
  }
  const sorted = [...grpLen].sort((a, b) => a - b);
  const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
  const endTick = over?.finalTick ?? state.tick;
  console.log(JSON.stringify({
    arm, seed, endMin: +(endTick / TICKS_PER_MIN).toFixed(2), reason: over?.reason ?? 'none', elim, routs, combats,
    grpMed: q(0.5), grpP90: q(0.9), ends, issuedSum, refundSum, refundPct: +((refundSum * 100) / Math.max(1, issuedSum)).toFixed(1),
    samples,
  }));
}
