/**
 * 봇 자가대전 (3차-2) — 실시간 대기 없이 tick 을 연속 실행한다.
 *
 * 실행: npx tsx server/scripts/selfplay.ts [games=10] [seed0=1000] [size=M] [N=10] [mix=NORMAL]
 *   mix 예: NORMAL (전원) / HARD1:NORMAL9 / NORMAL1:EASY9 (앞 그룹부터 playerId 1.. 배정, 시드마다 순환 회전)
 *   CIVWAR_SELFPLAY_JSON=1 이면 판별 결과를 JSON 한 줄씩 추가 출력, CIVWAR_SELFPLAY_LEDGER=1 이면 매 tick 회계 불변식 검사
 *   진단 전용(게임 상수 아님): CIVWAR_BOT_RESERVE=<permille>, CIVWAR_BOT_MINDEF=<permille> 로 난이도 레버를 덮어쓴다
 *
 * 출력: 판별 종료 tick·분·사유·승자, 5분 간격 1위 점유율(%), 봇 APM(수락 명령/분/봇), 거절 비율, tick ms (평균/최대).
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN, type BotDifficultyName, type MapSizeClass } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { createGameState, ledgerImbalance } from '../src/game/state.js';
import { Simulation, type BotBrain } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';

const games = Number(process.argv[2] ?? 10);
const seed0 = Number(process.argv[3] ?? 1000);
const size = (process.argv[4] ?? 'M') as MapSizeClass;
const N = Number(process.argv[5] ?? 10);
const mixArg = process.argv[6] ?? 'NORMAL';
const json = process.env.CIVWAR_SELFPLAY_JSON === '1';
const checkLedger = process.env.CIVWAR_SELFPLAY_LEDGER === '1';
const ovReserve = process.env.CIVWAR_BOT_RESERVE !== undefined ? Number(process.env.CIVWAR_BOT_RESERVE) : null;
const ovMinDef = process.env.CIVWAR_BOT_MINDEF !== undefined ? Number(process.env.CIVWAR_BOT_MINDEF) : null;

function parseMix(s: string): BotDifficultyName[] {
  if (!s.includes(':')) return Array.from({ length: N }, () => s as BotDifficultyName);
  const res: BotDifficultyName[] = [];
  for (const part of s.split(':')) {
    const m = /^(EASY|NORMAL|HARD)(\d+)$/.exec(part);
    if (!m) throw new Error(`bad mix ${part}`);
    for (let i = 0; i < Number(m[2]); i++) res.push(m[1] as BotDifficultyName);
  }
  if (res.length !== N) throw new Error(`mix size ${res.length} != N ${N}`);
  return res;
}
const mix = parseMix(mixArg);

export interface GameReport {
  seed: number;
  endTick: number;
  reason: string;
  winnerId: number | null;
  winnerDiff: BotDifficultyName | null;
  topShare5m: number[]; // %, 5분 간격 (마지막은 종료 시점)
  finalShares: { id: number; diff: BotDifficultyName; aggr: number; sharePct: number; alive: boolean }[];
  defSharePct: number;
  apm: number;
  rejectPct: number;
  rejects: Record<string, number>;
  msAvg: number;
  msMax: number;
  botMsAvg: number;
  botMsMax: number;
  /** v4.2: 공격 태세 깃발 시간 배분 (5 tick 표본, 비율 %) */
  atkTime: Record<string, number>;
  /** v4.2: 점령 칸 귀속 — 정지 점령(halted) / 앵커 점령(ENGAGED) / 기타 (tileChanges 직후 인접 깃발로 근사) */
  capBy: Record<string, number>;
  /** v4.2: 공격 발령 병종 수 [창, 검, 기] */
  atkUnits: number[];
  /** 평균 유지비 permille (생존자, 5 tick 표본) */
  upkeepPmMean: number;
  /** 플레이어당 테크 구매 수 @15분 / 종료 */
  tech15: number;
  techEnd: number;
  /** 종료 시 고립지 칸 비율 % (내 기지·수도와 연결 안 된 칸 / 전체 소유 칸) */
  enclavePct: number;
  /** v4.2 기지 함락 수 (전체 / 그중 수도) */
  baseCaps: number;
  capitalCaps: number;
  /** 병력 소멸 경로 비율 % (노출 / 전투 / 공격 지출) */
  sinks: Record<string, number>;
}

function playGame(seed: number, k: number): GameReport {
  const P = MAP_SIZE_PRESETS[size];
  const map = generateMap(seed, P.w, P.h, N);
  // 난이도 배정은 판마다 회전 (스폰 위치 편향 제거)
  const diffs = Array.from({ length: N }, (_, i) => mix[(i + k) % N]);
  const state = createGameState(
    map,
    diffs.map((d, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: d })),
  );
  let botMs = 0;
  let botMsMax = 0;
  let botNowTick = 0;
  let tickBotMs = 0;
  const timed: BotBrain = {
    decide(s, id, t, params) {
      const t0 = performance.now();
      const pp = ovReserve === null && ovMinDef === null ? params : { ...params, reserveRatioPermille: ovReserve ?? params.reserveRatioPermille, minDefenseRatioPermille: ovMinDef ?? params.minDefenseRatioPermille };
      const r = CivBot.decide(s, id, t, pp);
      const dt = performance.now() - t0;
      if (botNowTick !== t) {
        botNowTick = t;
        tickBotMs = 0;
      }
      tickBotMs += dt;
      botMs += dt;
      botMsMax = Math.max(botMsMax, tickBotMs);
      return r;
    },
  };
  const sim = new Simulation(state, timed);
  const land = map.totalLandTiles;
  const topShare: number[] = [];
  let accepted = 0;
  let rejected = 0;
  const rejects: Record<string, number> = {};
  let msSum = 0;
  let msMax = 0;
  let defFlags = 0;
  let allFlags = 0;
  let gameOver: { finalTick: number; reason: string; winnerId: number | null } | null = null;
  const atkTime: Record<string, number> = { walk: 0, halted: 0, anchor: 0, combat: 0, blocked: 0, returning: 0, idle: 0 };
  const capBy: Record<string, number> = { halted: 0, anchor: 0, other: 0 };
  const atkUnits = [0, 0, 0];
  let upSum = 0;
  let upN = 0;
  let tech15 = 0;
  let techBuys = 0;
  let baseCaps = 0;
  let capitalCaps = 0;
  const capitals = new Set(state.players.filter(Boolean).map((p) => p.homeTileId));
  while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 10) {
    const t0 = performance.now();
    const out = sim.step();
    const dt = performance.now() - t0;
    msSum += dt;
    msMax = Math.max(msMax, dt);
    for (const pm of out.personal) {
      if (pm.msg.type !== 'cmd_ack') continue;
      if (pm.msg.accepted) accepted++;
      else {
        rejected++;
        rejects[pm.msg.reason ?? '?'] = (rejects[pm.msg.reason ?? '?'] ?? 0) + 1;
      }
    }
    if (state.tick % 15 === 0) for (const f of state.flags) {
      allFlags++;
      if (f.posture === 1) defFlags++;
    }
    for (const m of out.broadcast) {
      if (m.type === 'game_over') gameOver = { finalTick: m.finalTick, reason: m.reason, winnerId: m.winnerId };
      else if (m.type === 'flag_issued' && m.posture === 0) atkUnits[m.unit]++;
      else if (m.type === 'tech_purchased') techBuys++;
      else if (m.type === 'base_captured' && m.fromPlayerId !== 0) {
        baseCaps++;
        if (capitals.has(m.tileId)) capitalCaps++;
      }
      else if (m.type === 'snapshot_delta') {
        for (const [t, o] of m.tileChanges) {
          let k = 'other';
          for (const f of state.flags) {
            if (f.ownerId !== o || f.posture !== 0 || state.graph.distance(f.posTileId, t) !== 1) continue;
            if (f.state === 'MARCHING' && f.halted) k = 'halted';
            else if (f.state === 'ENGAGED' && k === 'other') k = 'anchor';
          }
          capBy[k]++;
        }
      }
    }
    if (state.tick === 15 * TICKS_PER_MIN) tech15 = techBuys / N;
    if (state.tick % 5 === 0) {
      for (const f of state.flags) {
        if (f.posture !== 0 && f.state !== 'RETURNING') continue;
        const k = f.state === 'RETURNING' ? 'returning' : f.inCombat ? 'combat' : f.state === 'IDLE' ? 'idle' : f.state === 'ENGAGED' ? 'anchor' : f.halted ? 'halted' : f.blocked ? 'blocked' : 'walk';
        atkTime[k]++;
      }
      for (const p of state.players) if (p && p.alive) (upSum += p.upkeepPm), upN++;
    }
    if (state.tick % (5 * TICKS_PER_MIN) === 0 || sim.finished) {
      let top = 0;
      for (const p of state.players) if (p) top = Math.max(top, p.tiles);
      topShare.push(Math.round((top * 1000) / land) / 10);
    }
    if (checkLedger && ledgerImbalance(state) !== 0) throw new Error(`ledger imbalance seed ${seed} tick ${state.tick}`);
  }
  const ticks = state.tick;
  // 고립지: 각 플레이어 소유 칸 중 (기지 또는 수도)에서 내 땅만 밟아 닿지 않는 칸
  let encl = 0;
  let ownAll = 0;
  for (const p of state.players) {
    if (!p || !p.alive) continue;
    const seeds = [...p.baseTiles];
    if (state.owners[p.homeTileId] === p.id) seeds.push(p.homeTileId);
    const seen = new Set<number>(seeds);
    const q = [...seeds];
    for (let i = 0; i < q.length; i++) for (const n of state.graph.neighbors(q[i])) if (state.owners[n] === p.id && !seen.has(n)) (seen.add(n), q.push(n));
    ownAll += p.tiles;
    encl += p.tiles - seen.size;
  }
  const L = state.ledger;
  const sinkTot = Math.max(1, L.exposure + L.combat + L.spentAP);
  const atkTot = Math.max(1, Object.values(atkTime).reduce((a, b) => a + b, 0));
  const finalShares = state.players.filter(Boolean).map((p) => ({ id: p.id, diff: diffs[p.id - 1], aggr: p.bot.aggressionPermille ?? 500, sharePct: Math.round((p.tiles * 1000) / land) / 10, alive: p.alive }));
  const w = gameOver?.winnerId ?? null;
  return {
    seed,
    endTick: gameOver?.finalTick ?? ticks,
    reason: gameOver?.reason ?? 'none',
    winnerId: w,
    winnerDiff: w ? diffs[w - 1] : null,
    topShare5m: topShare,
    defSharePct: Math.round((defFlags * 1000) / Math.max(1, allFlags)) / 10,
    finalShares,
    apm: Math.round(((accepted / N) * TICKS_PER_MIN * 10) / ticks) / 10,
    rejectPct: Math.round((rejected * 1000) / Math.max(1, accepted + rejected)) / 10,
    rejects,
    msAvg: Math.round((msSum / ticks) * 100) / 100,
    msMax: Math.round(msMax * 10) / 10,
    botMsAvg: Math.round((botMs / ticks) * 100) / 100,
    botMsMax: Math.round(botMsMax * 10) / 10,
    atkTime: Object.fromEntries(Object.entries(atkTime).map(([k, v]) => [k, Math.round((v * 1000) / atkTot) / 10])),
    capBy,
    atkUnits,
    upkeepPmMean: Math.round(upSum / Math.max(1, upN)),
    tech15,
    techEnd: techBuys / N,
    baseCaps,
    capitalCaps,
    enclavePct: Math.round((encl * 1000) / Math.max(1, ownAll)) / 10,
    sinks: { exposure: Math.round((L.exposure * 1000) / sinkTot) / 10, combat: Math.round((L.combat * 1000) / sinkTot) / 10, spentAP: Math.round((L.spentAP * 1000) / sinkTot) / 10 },
  };
}

const reports: GameReport[] = [];
console.log(`selfplay: ${games} games, ${size} ${MAP_SIZE_PRESETS[size].w}x${MAP_SIZE_PRESETS[size].h}, N=${N}, mix=${mixArg}${ovReserve !== null || ovMinDef !== null ? ` [override reserve=${ovReserve} minDef=${ovMinDef}]` : ''}`);
console.log('seed  | end tick (min) | reason        | winner      | top share % @5,10,15,20,25,30m,end | APM  | rej% | tick ms avg/max | bot ms avg/max');
for (let k = 0; k < games; k++) {
  const r = playGame(seed0 + k, k);
  reports.push(r);
  console.log(
    `${r.seed} | ${r.endTick} (${(r.endTick / TICKS_PER_MIN).toFixed(1)}) | ${r.reason.padEnd(13)} | ${r.winnerId ? `P${r.winnerId} ${r.winnerDiff}` : '-'} | ${r.topShare5m.join(', ')} | ${r.apm} | ${r.rejectPct} | ${r.msAvg}/${r.msMax} | ${r.botMsAvg}/${r.botMsMax}`,
  );
  if (json) console.log(JSON.stringify(r));
}
const ends = reports.map((r) => r.endTick / TICKS_PER_MIN);
const mean = ends.reduce((a, b) => a + b, 0) / ends.length;
const reasons: Record<string, number> = {};
for (const r of reports) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
console.log(`\nend min: mean ${mean.toFixed(2)} / min ${Math.min(...ends).toFixed(2)} / max ${Math.max(...ends).toFixed(2)}; reasons ${JSON.stringify(reasons)}`);
const nSlots = Math.max(...reports.map((r) => r.topShare5m.length));
const avgTop: string[] = [];
for (let i = 0; i < nSlots; i++) {
  const v = reports.filter((r) => r.topShare5m.length > i).map((r) => r.topShare5m[i]);
  avgTop.push((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1));
}
console.log(`avg top share % by 5-min slot: ${avgTop.join(', ')}`);
console.log(`APM mean ${(reports.reduce((a, r) => a + r.apm, 0) / reports.length).toFixed(1)}, reject% mean ${(reports.reduce((a, r) => a + r.rejectPct, 0) / reports.length).toFixed(2)}`);
const rejAll: Record<string, number> = {};
for (const r of reports) for (const [k, v] of Object.entries(r.rejects)) rejAll[k] = (rejAll[k] ?? 0) + v;
console.log(`rejects: ${JSON.stringify(rejAll)}`);
console.log(`tick ms mean ${(reports.reduce((a, r) => a + r.msAvg, 0) / reports.length).toFixed(2)} max ${Math.max(...reports.map((r) => r.msMax))}; bot ms/tick mean ${(reports.reduce((a, r) => a + r.botMsAvg, 0) / reports.length).toFixed(2)} max ${Math.max(...reports.map((r) => r.botMsMax))}`);
console.log(`defense-slot share (DEFEND flags / all flags, sampled every 15 ticks) mean ${(reports.reduce((a, r) => a + r.defSharePct, 0) / reports.length).toFixed(1)}%`);
{
  const avg = (f: (r: GameReport) => number) => (reports.reduce((a, r) => a + f(r), 0) / reports.length).toFixed(1);
  const keys = Object.keys(reports[0].atkTime);
  console.log(`v4.2 attack-flag time % (ATTACK + all RETURNING, 5-tick samples): ${keys.map((k) => `${k} ${avg((r) => r.atkTime[k])}`).join(', ')}`);
  const cap = { halted: 0, anchor: 0, other: 0 } as Record<string, number>;
  for (const r of reports) for (const k of Object.keys(cap)) cap[k] += r.capBy[k];
  const capT = Math.max(1, cap.halted + cap.anchor + cap.other);
  console.log(`v4.2 captures by: halted ${((cap.halted * 100) / capT).toFixed(1)}%, anchor-ENGAGED ${((cap.anchor * 100) / capT).toFixed(1)}%, other ${((cap.other * 100) / capT).toFixed(1)}%`);
  const u = [0, 0, 0];
  for (const r of reports) r.atkUnits.forEach((v, i) => (u[i] += v));
  const uT = Math.max(1, u[0] + u[1] + u[2]);
  console.log(`v4.2 attack issues by unit: spear ${((u[0] * 100) / uT).toFixed(1)}%, sword ${((u[1] * 100) / uT).toFixed(1)}%, cavalry ${((u[2] * 100) / uT).toFixed(1)}%`);
  console.log(`v4.2 upkeepPm mean ${avg((r) => r.upkeepPmMean)}‰; tech buys/player @15m ${avg((r) => r.tech15)}, @end ${avg((r) => r.techEnd)}; enclave tiles at end ${avg((r) => r.enclavePct)}%`);
  console.log(`v4.2 player-base captures/game ${avg((r) => r.baseCaps)} (capitals ${avg((r) => r.capitalCaps)}), eliminations/game ${avg((r) => r.finalShares.filter((x) => !x.alive).length)}`);
  console.log(`v4.2 troop sinks %: exposure ${avg((r) => r.sinks.exposure)}, combat ${avg((r) => r.sinks.combat)}, spentAP ${avg((r) => r.sinks.spentAP)}`);
}
{
  const buckets = [
    { name: 'aggr 0-333', lo: 0, hi: 333 },
    { name: 'aggr 334-666', lo: 334, hi: 666 },
    { name: 'aggr 667-1000', lo: 667, hi: 1000 },
  ].map((b) => ({ ...b, n: 0, sum: 0, wins: 0 }));
  for (const r of reports)
    for (const s of r.finalShares) {
      const b = buckets.find((x) => s.aggr >= x.lo && s.aggr <= x.hi)!;
      b.n++;
      b.sum += s.sharePct;
      if (r.winnerId === s.id) b.wins++;
    }
  for (const b of buckets) console.log(`${b.name}: seats ${b.n}, mean final share ${(b.sum / Math.max(1, b.n)).toFixed(1)}%, wins ${b.wins}`);
}
if (mix.some((d) => d !== mix[0])) {
  const byDiff: Record<string, { wins: number; seats: number; shareSum: number }> = {};
  for (const r of reports) {
    for (const s of r.finalShares) {
      const b = (byDiff[s.diff] ??= { wins: 0, seats: 0, shareSum: 0 });
      b.seats++;
      b.shareSum += s.sharePct;
    }
    if (r.winnerDiff) byDiff[r.winnerDiff].wins++;
  }
  for (const [d, b] of Object.entries(byDiff)) {
    console.log(`${d}: seats ${b.seats}, wins ${b.wins} (${((b.wins * 100) / reports.length).toFixed(0)}% of games), mean final share ${(b.shareSum / b.seats).toFixed(1)}%`);
  }
}
