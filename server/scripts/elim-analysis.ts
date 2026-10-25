/**
 * 탈락(멸망) 분석: npx tsx server/scripts/elim-analysis.ts [games=16] [seed0=1000] — M 10인 NORMAL 자가대전.
 * 마지막 기지 단계(기지 1개)를 에피소드로 잡아 공격 받았는지·방어했는지·살아남았는지를 센다.
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TICKS_PER_MIN } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { engageLossPerTick } from '../src/game/combat.js';
import { createGameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';

const games = Number(process.argv[2] ?? 16);
const seed0 = Number(process.argv[3] ?? 1000);
const N = 10;
const P = MAP_SIZE_PRESETS.M;
const R = 8;

interface Ep { game: number; pid: number; start: number; end: number; eliminated: boolean; samples: number; attacked: number; guardSamples: number; maxHostile: number; hostileSum: number; minHpPct: number; tilesStart: number; tilesEnd: number; foeNear: number; wasHostileAdjacent: number; myAtkFlags: number; troopRatioSum: number; }
const eps: Ep[] = [];
// 약소국 표본: 12분 이후, 기지 1개, 영토 ≤ 120칸
const D = { n: 0, dmg: 0, hpSum: 0, hostileOnBase: 0, hostileAdj: 0, defendedOnBase: 0, flagsNear: 0, tgt: 0, inCombat: 0, anchorNear: 0, anchorIsBase: 0, states: {} as Record<string, number>, hpBuckets: [0, 0, 0, 0, 0], regenFull: 0, lockSamples: 0 };
const tracked = new Map<number, { troops0: number; guard0: number; game: number }>();
const last = new Map<number, { inCombat: boolean; state: string; troops: number; ts: number; stalled: boolean; blocked: boolean }>();
const hold = { n: 0, below: 0, hr: [] as number[], tr: [] as number[], byUnit: [0, 0, 0], byUnitBelow: [0, 0, 0], defUnits: [0, 0, 0], below400: 0, lowMorale: 0 };
const lastHold = new Map<number, { hr: number; morale: number }>();
const cause2: Record<string, number> = {};
const push = { n: 0, dmg: 0, nAdjNoCombat: 0, dmgNo: 0, nNone: 0, dmgNone: 0 };
const recallCause: Record<string, number> = {};
const fateCls: Record<string, number> = {};
const fate = { ended: {} as Record<string, number>, routed: 0, alive: 0, n: 0, troops0: 0, guard0: 0, ratio: [] as number[] };
const W = { n: 0, attacked: 0, foeNear: 0, ratioLt50: 0, ratioLt30: 0, ratioMed: [] as number[], nbFreeSlot: 0, nbPoolOk: 0, guardBlocks: 0, guardTroopsSum: 0, nbPoolSum: 0, nbHoard: 0, nbAtkFlags: 0, nbCount: 0, byGame: new Map<string, number>() };
const endBases: { game: number; pid: number; tiles: number; bases: number; share: number; rank: number }[] = [];
const bases2plusLowTiles: number[] = [];
let totalElim = 0;
let gameEnd: number[] = [];

for (let k = 0; k < games; k++) {
  const map = generateMap(seed0 + k, P.w, P.h, N);
  const state = createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: 'NORMAL' as const })));
  const sim = new Simulation(state, { decide: (s, id, t, p) => CivBot.decide(s, id, t, p) });
  const cur = new Map<number, Ep>();
  const land = map.totalLandTiles;
  while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 10) {
    const out = sim.step();
    for (const m of out.broadcast) {
      if (m.type === 'flag_ended' && tracked.has(m.flagId)) { { const l = last.get(m.flagId); const key = `${m.reason}|${l ? (l.inCombat ? '교전중' : l.state) + (l.stalled ? '+정체' : '') + (l.blocked ? '+차단' : '') : '?'}`; fateCls[key] = (fateCls[key] ?? 0) + 1; } fate.ended[m.reason] = (fate.ended[m.reason] ?? 0) + 1; fate.n++; const tr = tracked.get(m.flagId)!; fate.ratio.push(Math.round((tr.troops0 * 100) / Math.max(1, tr.guard0))); tracked.delete(m.flagId); }
      else if (m.type === 'flag_routed' && tracked.has(m.flagId)) fate.routed++;
    }
    if (state.tick % 15 !== 0) continue;
    for (const f of state.flags) if (tracked.has(f.id) && f.inCombat && f.disengageUntilTick === null && state.combatModel === 2) {
      const foes = state.flags.filter((g) => g.ownerId !== f.ownerId && !g.routed && (g.posture === 0 || f.posture === 0) && state.graph.touching(g.posTileId, f.posTileId) && g.ownerId === f.targetOwnerId);
      if (!foes.length) continue;
      const e = engageLossPerTick(state, f, foes);
      let enT = 0; for (const g of foes) { enT += g.troopsMilli; hold.defUnits[g.unit]++; }
      const hr = (f.troopsMilli * e.foes) / Math.max(1, enT * e.mine);
      lastHold.set(f.id, { hr, morale: f.morale });
      hold.n++; hold.hr.push(hr); hold.tr.push(f.troopsMilli / enT); hold.byUnit[f.unit]++;
      if (hr < 0.8) { hold.below++; hold.byUnitBelow[f.unit]++; }
      if (f.morale < 400) hold.lowMorale++;
    }
    for (const f of state.flags) if (tracked.has(f.id)) {
      const l0 = last.get(f.id);
      if (l0 && f.state === 'RETURNING' && l0.state !== 'RETURNING') {
        const key = `${f.routed ? '패주' : '회수'}| 직전 ${l0.inCombat ? '교전중' : l0.state}${l0.stalled ? '+정체' : ''}${l0.blocked ? '+차단' : ''} 병력 ${l0.troops < 150 ? '<150' : l0.troops < 500 ? '<500' : '500+'}`;
        recallCause[key] = (recallCause[key] ?? 0) + 1;
        if (!f.routed && l0.inCombat) {
          const h = lastHold.get(f.id);
          const c = !h ? '교전표본없음' : h.hr < 0.8 ? 'A 버티는시간비<0.8' : h.morale < 400 && h.hr < 1 ? 'B 사기<400&비<1' : `C 기타(hr ${h.hr < 1.5 ? '<1.5' : '≥1.5'}, 사기 ${h.morale < 400 ? '<400' : '≥400'})`;
          cause2[c] = (cause2[c] ?? 0) + 1;
        }
      }
    }
    for (const f of state.flags) if (tracked.has(f.id)) last.set(f.id, { inCombat: f.inCombat, state: f.state, troops: f.troopsMilli / 1000, ts: state.tick, stalled: f.stalled, blocked: f.blocked });
    for (const p of state.players) {
      if (!p) continue;
      const e = cur.get(p.id);
      if (p.alive && p.baseTiles.length === 1 && state.tick >= 12 * TICKS_PER_MIN && p.tiles <= 120) {
        const b = p.baseTiles[0];
        W.n++;
        W.byGame.set(`${k}:${p.id}`, (W.byGame.get(`${k}:${p.id}`) ?? 0) + 1);
        {
          const bs0 = state.bases[state.baseIndexOf.get(b)!];
          D.n++;
          const hp = (bs0.hpMilli * 100) / bs0.maxHpMilli;
          D.hpSum += hp;
          D.hpBuckets[Math.min(4, Math.floor(hp / 20.0001))]++;
          if (state.tick - bs0.lastDamageTick < 25) D.dmg++;
          if (bs0.hpMilli >= bs0.maxHpMilli) D.regenFull++;
          let hostOn = false, hostAdj = false, defOn = false, g0 = 0;
          for (const f of state.flags) if (f.ownerId === p.id && state.graph.distance(f.posTileId, b) <= 2) g0 += f.troopsMilli / 1000;
          for (const f of state.flags) {
            if (f.ownerId === p.id) { if (f.posTileId === b && f.posture === 1) defOn = true; continue; }
            if (f.routed) continue;
            const d = state.graph.distance(f.posTileId, b);
            if (f.posture === 0 && d === 0) hostOn = true;
            if (f.posture === 0 && d === 1) hostAdj = true;
            if (f.posture === 0 && d <= 8) {
              D.flagsNear++;
              if (f.targetOwnerId === p.id && !tracked.has(f.id)) { tracked.set(f.id, { troops0: f.troopsMilli / 1000, guard0: g0, game: k }); fate.troops0 += f.troopsMilli / 1000; fate.guard0 += g0; }
              if (f.targetOwnerId === p.id) D.tgt++;
              if (f.inCombat) D.inCombat++;
              if (state.graph.distance(f.anchorTileId, b) <= 4) D.anchorNear++;
              if (f.anchorTileId === b) D.anchorIsBase++;
              D.states[f.state] = (D.states[f.state] ?? 0) + 1;
            }
          }
          {
            let adjCombat = false, adjAny = false;
            for (const f of state.flags) if (f.ownerId !== p.id && f.posture === 0 && !f.routed && f.anchorTileId === b && state.graph.distance(f.posTileId, b) === 1) { adjAny = true; if (f.inCombat) adjCombat = true; }
            const dm = state.tick - bs0.lastDamageTick < 25;
            if (adjCombat) { push.n++; if (dm) push.dmg++; } else if (adjAny) { push.nAdjNoCombat++; if (dm) push.dmgNo++; } else { push.nNone++; if (dm) push.dmgNone++; }
          }
          if (hostOn) D.hostileOnBase++;
          if (hostAdj) D.hostileAdj++;
          if (defOn) D.defendedOnBase++;
        }
        let hostile0 = 0;
        let guardTroops = 0;
        let myTotal = p.troopsMilli;
        for (const f of state.flags) {
          if (f.ownerId === p.id) {
            myTotal += f.troopsMilli;
            if (state.graph.distance(f.posTileId, b) <= 2) guardTroops += f.troopsMilli / 1000;
          } else if (f.posture === 0 && !f.routed && state.graph.distance(f.posTileId, b) <= 8) hostile0++;
        }
        if (hostile0 > 0) W.attacked++;
        // 반경 6 안 이웃 플레이어들
        const nbs = new Set<number>();
        for (const t of state.graph.disk(b, 6)) { const o = state.owners[t]; if (o !== 0 && o !== p.id && state.players[o]?.alive) nbs.add(o); }
        if (nbs.size) {
          W.foeNear++;
          let best = 0, bestTot = 0, bestPool = 0, bestFree = false, bestAtk = 0;
          for (const o of nbs) {
            const q = state.players[o];
            let tot = q.troopsMilli, atk = 0, slots = 0;
            for (const f of state.flags) if (f.ownerId === o) { tot += f.troopsMilli; slots++; if (f.posture === 0) atk++; }
            if (tot > bestTot) { bestTot = tot; best = o; bestPool = q.troopsMilli / 1000; bestAtk = atk; bestFree = slots < (q.tiles >= 0 ? 99 : 0); }
          }
          const q = state.players[best];
          let slots = 0; for (const f of state.flags) if (f.ownerId === best) slots++;
          const ratio = Math.floor((myTotal * 1000) / Math.max(1, bestTot));
          W.ratioMed.push(ratio);
          if (ratio < 500) W.ratioLt50++;
          if (ratio < 300) W.ratioLt30++;
          W.nbPoolSum += bestPool; W.guardTroopsSum += guardTroops; W.nbAtkFlags += bestAtk; W.nbCount++;
          if (guardTroops > bestPool * 0.5) W.guardBlocks++;
          void q; void slots; void bestFree;
        }
      }
      if (p.alive && p.baseTiles.length === 1) {
        const b = p.baseTiles[0];
        let ep = e;
        if (!ep) {
          ep = { game: k, pid: p.id, start: state.tick, end: state.tick, eliminated: false, samples: 0, attacked: 0, guardSamples: 0, maxHostile: 0, hostileSum: 0, minHpPct: 100, tilesStart: p.tiles, tilesEnd: p.tiles, foeNear: 0, wasHostileAdjacent: 0, myAtkFlags: 0, troopRatioSum: 0 };
          cur.set(p.id, ep);
        }
        ep.samples++;
        ep.end = state.tick;
        ep.tilesEnd = p.tiles;
        let hostile = 0;
        let guard = 0;
        let myAtk = 0;
        const foes = new Set<number>();
        for (const f of state.flags) {
          if (f.ownerId === p.id) {
            if (f.posture === 0) myAtk++;
            if (f.anchorTileId === b && f.posture === 1) guard++;
            continue;
          }
          if (f.posture === 0 && !f.routed && state.graph.distance(f.posTileId, b) <= R) {
            hostile++;
            foes.add(f.ownerId);
          }
        }
        if (hostile > 0) ep.attacked++;
        if (guard > 0) ep.guardSamples++;
        ep.maxHostile = Math.max(ep.maxHostile, hostile);
        ep.hostileSum += hostile;
        ep.myAtkFlags += myAtk;
        const bs = state.bases[state.baseIndexOf.get(b)!];
        ep.minHpPct = Math.min(ep.minHpPct, Math.round((bs.hpMilli * 100) / bs.maxHpMilli));
        // 반경 6 안에 다른 플레이어 칸이 있는가 (공격 가능한 이웃)
        let near = 0;
        for (const t of state.graph.disk(b, 6)) { const o = state.owners[t]; if (o !== 0 && o !== p.id) near++; }
        if (near > 0) ep.foeNear++;
      } else if (e) {
        e.eliminated = !p.alive;
        cur.delete(p.id);
        eps.push(e);
      }
    }
  }
  for (const [, e] of cur) eps.push(e); // 게임 종료까지 생존
  const alive = state.players.filter((p) => p);
  const ranked = [...alive].sort((a, b) => b.tiles - a.tiles);
  ranked.forEach((p, i) => {
    if (p.alive) endBases.push({ game: k, pid: p.id, tiles: p.tiles, bases: p.baseTiles.length, share: Math.round((p.tiles * 1000) / land) / 10, rank: i + 1 });
  });
  totalElim += alive.filter((p) => !p.alive).length;
  gameEnd.push(state.tick / TICKS_PER_MIN);
}

const elim = eps.filter((e) => e.eliminated);
const surv = eps.filter((e) => !e.eliminated);
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0);
const f1 = (x: number) => x.toFixed(1);
console.log(`games ${games}, eliminations ${totalElim} (${f1(totalElim / games)}/game), avg end ${f1(avg(gameEnd))}분`);
console.log(`마지막 기지 단계 진입 ${eps.length}건: 멸망 ${elim.length}, 판 끝까지 생존 ${surv.length}`);
const show = (name: string, a: Ep[]) => {
  if (!a.length) return console.log(`${name}: 없음`);
  const tot = a.reduce((s, e) => s + e.samples, 0);
  console.log(`${name} (${a.length}건): 지속 평균 ${f1(avg(a.map((e) => e.samples * 15 / TICKS_PER_MIN)))}분, 공격 받은 표본 ${f1((100 * a.reduce((s, e) => s + e.attacked, 0)) / tot)}%, 수비대 있는 표본 ${f1((100 * a.reduce((s, e) => s + e.guardSamples, 0)) / tot)}%, 반경 8 적 공격 깃발 평균 ${f1(a.reduce((s, e) => s + e.hostileSum, 0) / tot)}개(최대 평균 ${f1(avg(a.map((e) => e.maxHostile)))}), 최저 체력 평균 ${f1(avg(a.map((e) => e.minHpPct)))}%, 반경 6 안 적 땅 있음 ${f1((100 * a.reduce((s, e) => s + e.foeNear, 0)) / tot)}%, 내 공격 깃발 평균 ${f1(a.reduce((s, e) => s + e.myAtkFlags, 0) / tot)}개, 영토 ${f1(avg(a.map((e) => e.tilesStart)))}→${f1(avg(a.map((e) => e.tilesEnd)))}칸`);
};
show('멸망한 에피소드', elim);
show('생존한 에피소드', surv);
const never = surv.filter((e) => e.attacked === 0);
console.log(`생존 에피소드 중 한 번도 공격 받지 않은 것: ${never.length}/${surv.length}`);
const longSurv = surv.filter((e) => (e.samples * 15) / TICKS_PER_MIN >= 3);
console.log(`생존 에피소드 중 3분 이상 버틴 것: ${longSurv.length}, 그중 반경 8 안에 공격 깃발이 하나도 안 온 표본 비율 ${f1(100 - (100 * longSurv.reduce((s, e) => s + e.attacked, 0)) / Math.max(1, longSurv.reduce((s, e) => s + e.samples, 0)))}%`);
const ends = endBases.filter((e) => e.rank >= 8);
console.log(`종료 시 하위 3명(순위 8~10): 기지 1개 ${ends.filter((e) => e.bases === 1).length}/${ends.length}, 평균 점유 ${f1(avg(ends.map((e) => e.share)))}%, 평균 기지 ${f1(avg(ends.map((e) => e.bases)))}개, 평균 칸 ${f1(avg(ends.map((e) => e.tiles)))}`);
const bottom = endBases.filter((e) => e.rank === 10 || e.rank === 9);
console.log(`종료 시 최하위 2명 생존자: 점유 ${f1(avg(bottom.map((e) => e.share)))}%, 기지 ${f1(avg(bottom.map((e) => e.bases)))}개`);

console.log('--- 약소국 표본 (12분 이후, 기지 1개, 영토 ≤ 120칸) ---');
const wn = Math.max(1, W.n);
console.log(`표본 ${W.n}개 (플레이어-판 ${W.byGame.size}명), 반경 8 안에 적 공격 깃발 있음 ${f1((100 * W.attacked) / wn)}%, 반경 6 안 이웃 플레이어 땅 있음 ${f1((100 * W.foeNear) / wn)}%`);
const rm = [...W.ratioMed].sort((a, b) => a - b);
console.log(`가장 센 이웃 대비 내 총병력: 중앙값 ${rm.length ? rm[Math.floor(rm.length / 2)] / 10 : 0}%, <50% ${f1((100 * W.ratioLt50) / Math.max(1, W.foeNear))}%, <30% ${f1((100 * W.ratioLt30) / Math.max(1, W.foeNear))}%`);
console.log(`가장 센 이웃: 풀 평균 ${f1(W.nbPoolSum / Math.max(1, W.nbCount))}, 공격 깃발 평균 ${f1(W.nbAtkFlags / Math.max(1, W.nbCount))}개 / 약소국 기지 2칸 안 병력 평균 ${f1(W.guardTroopsSum / Math.max(1, W.nbCount))}, 수비 병력 > 이웃 풀의 50%인 표본 ${f1((100 * W.guardBlocks) / Math.max(1, W.nbCount))}%`);

console.log('--- 약소국 기지 상태 ---');
const dn = Math.max(1, D.n);
console.log(`기지 평균 체력 ${f1(D.hpSum / dn)}%, 체력 분포(0-20/20-40/40-60/60-80/80-100%) ${D.hpBuckets.map((x) => f1((100 * x) / dn)).join(' / ')}, 최근 25틱 피해 받은 표본 ${f1((100 * D.dmg) / dn)}%, 체력 만땅 ${f1((100 * D.regenFull) / dn)}%`);
console.log(`적 공격 깃발이 기지 칸 위 ${f1((100 * D.hostileOnBase) / dn)}% / 기지 바로 옆 ${f1((100 * D.hostileAdj) / dn)}%, 내 방어 깃발이 기지 위 ${f1((100 * D.defendedOnBase) / dn)}%`);
console.log(`반경 8 안 적 공격 깃발 ${D.flagsNear}개(표본합): 나를 목표(targetOwner) ${f1((100 * D.tgt) / Math.max(1, D.flagsNear))}%, 교전 중 ${f1((100 * D.inCombat) / Math.max(1, D.flagsNear))}%, 앵커가 기지 4칸 안 ${f1((100 * D.anchorNear) / Math.max(1, D.flagsNear))}%, 앵커=기지 ${f1((100 * D.anchorIsBase) / Math.max(1, D.flagsNear))}%`);
console.log('상태별', JSON.stringify(D.states));

console.log('--- 약소국을 노린 공격 깃발의 최후 ---');
console.log(`추적 ${fate.n + tracked.size}개: 종료 ${fate.n}, 종료 사유 ${JSON.stringify(fate.ended)}, 패주 이벤트 ${fate.routed}, 처음 포착 시 깃발 평균 병력 ${f1(fate.troops0 / Math.max(1, fate.n + tracked.size))} / 그때 기지 2칸 안 수비 병력 평균 ${f1(fate.guard0 / Math.max(1, fate.n + tracked.size))}`);
const fr = [...fate.ratio].sort((a, b) => a - b);
console.log(`공격 깃발 병력 / 수비 병력 (%) 중앙값 ${fr.length ? fr[Math.floor(fr.length / 2)] : 0}, 하위25% ${fr.length ? fr[Math.floor(fr.length / 4)] : 0}, 상위25% ${fr.length ? fr[Math.floor(fr.length * 3 / 4)] : 0}`);

console.log('종료 사유|마지막 표본 상태', JSON.stringify(Object.entries(fateCls).sort((a, b) => b[1] - a[1])));

console.log('RETURNING 전환 직전 상태', JSON.stringify(Object.entries(recallCause).sort((a, b) => b[1] - a[1]), null, 0));

const q = (a: number[], p: number) => { const x = [...a].sort((u, v) => u - v); return x.length ? x[Math.min(x.length - 1, Math.floor(x.length * p))] : 0; };
console.log(`교전 중인 추적 공격 깃발 표본 ${hold.n}: 버티는시간비(내/상대) 중앙값 ${q(hold.hr, 0.5).toFixed(2)}, 하위25% ${q(hold.hr, 0.25).toFixed(2)}, 상위25% ${q(hold.hr, 0.75).toFixed(2)}, <0.8(후퇴 조건) ${f1((100 * hold.below) / Math.max(1, hold.n))}%, 사기 <400 ${f1((100 * hold.lowMorale) / Math.max(1, hold.n))}%`);
console.log(`같은 표본 병력비(내/상대) 중앙값 ${q(hold.tr, 0.5).toFixed(2)}; 내 병종별 표본 [창,검,기] ${hold.byUnit}, 그중 <0.8 ${hold.byUnitBelow}; 상대 수비 병종 [창,검,기] ${hold.defUnits}`);

console.log('교전 중 회수의 원인 분류(마지막 교전 표본 기준)', JSON.stringify(Object.entries(cause2).sort((a, b) => b[1] - a[1])));

console.log(`기지 앵커 공격 깃발이 기지 바로 옆: 교전 중 ${push.n}표본 중 25틱 내 피해 ${f1((100 * push.dmg) / Math.max(1, push.n))}% / 교전 아님 ${push.nAdjNoCombat}표본 중 ${f1((100 * push.dmgNo) / Math.max(1, push.nAdjNoCombat))}% / 옆에 없음 ${push.nNone}표본 중 ${f1((100 * push.dmgNone) / Math.max(1, push.nNone))}%`);
