/**
 * v5.6 깃발 조작 측정 (측정 2026-11-02 과 같은 조건 + 봇 명령 거절·기지 방어·IDLE 집계). 판마다 JSON 한 줄.
 * npx tsx measure.mts <root> <arm> <seed0> <games>
 */
import { pathToFileURL } from 'node:url';
const [root, arm, s0, g] = process.argv.slice(2);
const imp = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const sh = await imp('shared/src/index.ts');
const { CivBot } = await imp('server/src/game/bot.ts');
const { createGameState } = await imp('server/src/game/state.ts');
const { Simulation } = await imp('server/src/game/tick.ts');
const { generateMap } = await imp('server/src/map/generate.ts');
const { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN } = sh;
const N = 10;
const P = MAP_SIZE_PRESETS.M;
for (let k = 0; k < Number(g); k++) {
  const seed = Number(s0) + k;
  const state = createGameState(generateMap(seed, P.w, P.h, N), Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'NORMAL' as const })));
  const sent = new Map<string, { t: string; posture?: number }>();
  const brain = { decide(s: any, id: number, t: number, params: any) { const r = CivBot.decide(s, id, t, params); for (const c of r) sent.set(`${id}:${c.clientSeq}`, { t: c.type, posture: c.posture }); return r; } };
  const sim = new Simulation(state, brain);
  const grpStart = new Map<number, number>();
  const grpLen: number[] = [];
  const ends: Record<string, number> = {};
  const acc: Record<string, number> = {}; // 명령 종류별 수락
  const rej: Record<string, Record<string, number>> = {}; // 명령 종류별 거절 사유
  const issuedBy: Record<string, number> = { atk: 0, def: 0, defBase: 0 };
  let routs = 0, elim = 0, combats = 0, retargets = 0, retargetsToBase = 0, retargetsOwn = 0, postureToDef = 0, postureToAtk = 0;
  const flagPostureNow = new Map<number, number>();
  let idleSamples = 0, idleAtkSum = 0, idleAllSum = 0, flagSamples = 0, pendingSamples = 0, pendingMax = 0;
  const idleSince = new Map<number, number>(); let idleMaxDur = 0; const idleLong = new Set<number>();
  const pendSince = new Map<number, number>(); let pendMaxDur = 0; const pendLong = new Set<number>();
  let over: any = null;
  while (!over && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const pm of out.personal) {
      if (pm.msg.type !== 'cmd_ack') continue;
      const c = sent.get(`${pm.playerId}:${pm.msg.clientSeq}`); const ty = c?.t ?? '?';
      if (pm.msg.accepted) acc[ty] = (acc[ty] ?? 0) + 1;
      else { const r = (rej[ty] ??= {}); const key = pm.msg.reason ?? '?'; r[key] = (r[key] ?? 0) + 1; }
    }
    for (const m of out.broadcast) {
      if (m.type === 'combat_started') { grpStart.set(m.groupKey, m.tick); combats++; }
      else if (m.type === 'combat_ended') { const t0 = grpStart.get(m.groupKey); if (t0 !== undefined) grpLen.push((m.tick - t0) / 5); grpStart.delete(m.groupKey); }
      else if (m.type === 'flag_routed') routs++;
      else if (m.type === 'flag_issued') {
        const p = state.players[m.playerId]; const bases = new Set([...p.baseTiles, p.homeTileId]);
        if (m.posture === 1) { issuedBy.def++; if (bases.has(m.anchorTileId)) issuedBy.defBase++; } else issuedBy.atk++;
      }
      else if (m.type === 'flag_retargeted') {
        retargets++;
        const f = state.flags.find((x: any) => x.id === m.flagId);
        if (f) { const p = state.players[f.ownerId]; if (p.baseTiles.includes(m.anchorTileId) || p.homeTileId === m.anchorTileId) retargetsToBase++; if (state.owners[m.anchorTileId] === f.ownerId) retargetsOwn++; }
      }
      else if (m.type === 'flag_posture_changed') { if (m.posture === 1) postureToDef++; else postureToAtk++; }
      else if (m.type === 'flag_ended') ends[m.reason] = (ends[m.reason] ?? 0) + 1;
      else if (m.type === 'player_eliminated') elim++;
      else if (m.type === 'game_over') over = m;
    }
    if (state.tick % 15 === 0) {
      idleSamples++;
      const seen = new Set<number>(); const seenP = new Set<number>();
      let pend = 0;
      for (const f of state.flags) {
        flagSamples++;
        if (f.state === 'IDLE') {
          idleAllSum++; if (f.posture === 0) idleAtkSum++;
          seen.add(f.id); if (!idleSince.has(f.id)) idleSince.set(f.id, state.tick);
          const d = state.tick - idleSince.get(f.id)!; if (d > idleMaxDur) idleMaxDur = d; if (d > 150) idleLong.add(f.id);
        }
        if (f.botPlannedPosture !== null && f.botPlannedPosture !== f.posture) {
          pend++; seenP.add(f.id); if (!pendSince.has(f.id)) pendSince.set(f.id, state.tick);
          const d = state.tick - pendSince.get(f.id)!; if (d > pendMaxDur) pendMaxDur = d; if (d > 75) pendLong.add(f.id);
        }
      }
      for (const id of [...idleSince.keys()]) if (!seen.has(id)) idleSince.delete(id);
      for (const id of [...pendSince.keys()]) if (!seenP.has(id)) pendSince.delete(id);
      pendingSamples += pend; if (pend > pendingMax) pendingMax = pend;
    }
  }
  const sorted = [...grpLen].sort((a, b) => a - b);
  const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
  const endTick = over?.finalTick ?? state.tick;
  const land = state.map?.totalLandTiles ?? 1;
  const top = Math.max(...state.players.filter(Boolean).map((p: any) => p.tiles));
  console.log(JSON.stringify({ arm, seed, endMin: +(endTick / TICKS_PER_MIN).toFixed(2), reason: over?.reason ?? 'none', winnerId: over?.winnerId ?? null, topSharePct: +(top * 100 / land).toFixed(1), elim, routs, combats, grpMed: q(0.5), grpP90: q(0.9), ends, acc, rej, issuedBy, retargets, retargetsToBase, retargetsOwn, postureToDef, postureToAtk,
    idleAtkAvg: +(idleAtkSum / idleSamples).toFixed(3), idleAllAvg: +(idleAllSum / idleSamples).toFixed(3), idleMaxDurTicks: idleMaxDur, idleLongFlags: idleLong.size, flagAvg: +(flagSamples / idleSamples).toFixed(2), pendingAvg: +(pendingSamples / idleSamples).toFixed(3), pendingMax, pendMaxDurTicks: pendMaxDur, pendLongFlags: pendLong.size }));
}
