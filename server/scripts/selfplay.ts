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
    for (const m of out.broadcast) if (m.type === 'game_over') gameOver = { finalTick: m.finalTick, reason: m.reason, winnerId: m.winnerId };
    if (state.tick % (5 * TICKS_PER_MIN) === 0 || sim.finished) {
      let top = 0;
      for (const p of state.players) if (p) top = Math.max(top, p.tiles);
      topShare.push(Math.round((top * 1000) / land) / 10);
    }
    if (checkLedger && ledgerImbalance(state) !== 0) throw new Error(`ledger imbalance seed ${seed} tick ${state.tick}`);
  }
  const ticks = state.tick;
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
