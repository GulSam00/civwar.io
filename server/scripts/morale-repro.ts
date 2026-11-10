/** 사기 급락 재현·개선안 비교 (npx tsx server/scripts/morale-repro.ts [--verify] [--detail]) — 커밋 보류 */
import {
  MORALE_DROP_DEFEND_PER_TICK,
  MORALE_DROP_LOSS_K,
  MORALE_DROP_PER_TICK,
  POSTURE,
  TERRAIN,
  UNIT,
  isClaimable,
  techMoraleDropPm,
} from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { NEUTRAL, createGameState, makeFlag, type Flag, type GameState } from '../src/game/state.js';

type Variant = 'cur' | 'A' | 'B' | 'C';
interface Row { t: number; cas: number; pct: number; fixed: number; byLoss: number; drop: number; morale: number; troops: number }

function open(s: GameState): number {
  for (let t = 0; t < s.owners.length; t++) {
    const d = s.graph.disk(t, 3);
    if (d.length === 25 && d.every((x) => isClaimable(s.map.terrain[x]) && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('none');
}

/** 4c 복사본 (평원·비기지 전제) + 개선안 */
function dropOf(v: Variant, s: GameState, f: Flag, foe: Flag, lossMilli: number, lossBp: number, troopsBefore: number, foeBefore: number) {
  const stat = s.players[f.ownerId].statPm;
  let fixed: number = (f.posture === POSTURE.DEFEND ? MORALE_DROP_DEFEND_PER_TICK : MORALE_DROP_PER_TICK)[f.unit];
  let K: number = MORALE_DROP_LOSS_K;
  if (v === 'C') {
    if (foeBefore <= troopsBefore) fixed = Math.floor(fixed / 2);
    K = 3;
  }
  let byLoss = Math.floor((lossBp * K + 50) / 100);
  if (v === 'A') byLoss = Math.min(byLoss, Math.floor(lossMilli / 1000) * 2);
  if (v === 'B') byLoss = Math.min(byLoss, 10);
  const drop = Math.max(1, Math.floor(((fixed + byLoss) * techMoraleDropPm(stat, f.unit)) / 1000));
  return { fixed, byLoss, drop };
}

interface Result { endT: number; why: string; rows: [Row[], Row[]]; flags: [Flag, Flag]; start: [number, number]; cum: [number, number]; fixedSum: [number, number]; lossSum: [number, number]; m0: [number | null, number | null] }

function run(aTroops: number, dTroops: number, dPost: number, v: Variant, real = false): Result {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 2);
  (s as { combatModel: 1 | 2 }).combatModel = 2;
  const c = open(s);
  s.map.terrain[c] = TERRAIN.PLAIN;
  s.map.terrain[c + 1] = TERRAIN.PLAIN;
  const mk = (id: number, owner: number, troops: number, pos: number, posture: number) => {
    const f = makeFlag({ id, ownerId: owner, slotIndex: 0, unit: UNIT.SPEAR, troopsMilli: troops * 1000, initialTroops: troops, posTileId: pos, anchorTileId: pos, originTileId: pos });
    f.posture = posture as 0;
    f.state = 'ENGAGED';
    s.flags.push(f);
    return f;
  };
  const fl: [Flag, Flag] = [mk(1, 1, aTroops, c, POSTURE.ATTACK), mk(2, 2, dTroops, c + 1, dPost)];
  const res: Result = { endT: 0, why: '1000tick', rows: [[], []], flags: fl, start: [aTroops, dTroops], cum: [0, 0], fixedSum: [0, 0], lossSum: [0, 0], m0: [null, null] };
  for (let t = 1; t <= 1000; t++) {
    const plan = stage4a_flagCombatPhaseA(s, t);
    const before = fl.map((f) => f.troopsMilli);
    const mBefore = fl.map((f) => f.morale);
    if (!real) (s as { combatModel: 1 | 2 }).combatModel = 1; // 4b 의 4c/4d 를 끄고 사기는 아래에서 직접 계산
    stage4b_flagCombatPhaseB(s, plan, t, newOutbox());
    (s as { combatModel: 1 | 2 }).combatModel = 2;
    fl.forEach((f, i) => {
      const l = plan.lossMilliByFlag.get(f.id) ?? 0;
      const bp = l > 0 && before[i] > 0 ? Math.floor((l * 10000) / before[i]) : 0;
      const d = dropOf(v, s, f, fl[1 - i], l, bp, before[i], before[1 - i]);
      if (f.routed) f.morale = 0;
      else if (!real) f.morale = Math.max(0, mBefore[i] - d.drop);
      res.cum[i] += l;
      res.fixedSum[i] += d.fixed;
      res.lossSum[i] += d.byLoss;
      res.rows[i].push({ t, cas: l / 1000, pct: bp / 100, fixed: d.fixed, byLoss: d.byLoss, drop: d.drop, morale: f.morale, troops: f.troopsMilli / 1000 });
      if (f.morale === 0 && res.m0[i] === null && !f.routed) res.m0[i] = t;
    });
    res.endT = t;
    if (fl.some((f) => f.routed)) { res.why = '패주 ' + fl.filter((f) => f.routed).map((f) => (f.id === 1 ? 'A' : 'B')).join(','); break; }
    if (fl.some((f) => f.morale === 0)) { res.why = '사기0 ' + fl.filter((f) => f.morale === 0).map((f) => (f.id === 1 ? 'A' : 'B')).join(','); break; }
  }
  return res;
}

const P = POSTURE;
const scen: [string, number, number, number][] = [
  ['1 창100공 vs 창5000방', 100, 5000, P.DEFEND],
  ['2a 창100공 vs 창100공', 100, 100, P.ATTACK],
  ['2b 창100공 vs 창100방', 100, 100, P.DEFEND],
  ['3a 창300공 vs 창300방', 300, 300, P.DEFEND],
  ['3b 창1000공 vs 창1000방', 1000, 1000, P.DEFEND],
  ['4 창5000공 vs 창100방', 5000, 100, P.DEFEND],
  ['5 창200공 vs 창2000방', 200, 2000, P.DEFEND],
];
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();

if (process.argv.includes('--verify')) {
  // 복사한 현행 식이 실제 4c 와 같은 사기 궤적인지
  for (const [name, a, d, p] of scen) {
    const r1 = run(a, d, p, 'cur', true);
    const r2 = run(a, d, p, 'cur', false);
    let same = true;
    const n = Math.min(r1.rows[0].length, r2.rows[0].length);
    for (let i = 0; i < n; i++) for (const k of [0, 1]) if (r1.rows[k][i].morale !== r2.rows[k][i].morale || r1.rows[k][i].troops !== r2.rows[k][i].troops) same = false;
    console.log(`${name}: real end ${r1.endT}(${r1.why}) copy end ${r2.endT}(${r2.why}) same=${same}`);
  }
}

if (process.argv.includes('--verifyA')) {
  // v5.13 반영 후: 실제 4c 결과가 A안 복사본과 tick마다 같은지 + 실제 결과 요약
  console.log('| 시나리오 | 실제 종료 tick(s) | 사유 | A 남은% | B 남은% | A안 일치(tick별 사기·병력) |');
  console.log('|---|---|---|---|---|---|');
  for (const [name, a, d, p] of scen) {
    const r1 = run(a, d, p, 'A', true);
    const r2 = run(a, d, p, 'A', false);
    let same = r1.endT === r2.endT && r1.why === r2.why;
    const n = Math.min(r1.rows[0].length, r2.rows[0].length);
    for (let i = 0; i < n; i++) for (const k of [0, 1]) if (r1.rows[k][i].morale !== r2.rows[k][i].morale || r1.rows[k][i].troops !== r2.rows[k][i].troops) same = false;
    const pc = (k: number) => ((r1.flags[k].troopsMilli / 1000 / r1.start[k]) * 100).toFixed(1);
    console.log(`| ${name} | ${r1.endT} (${(r1.endT / 5).toFixed(1)}) | ${r1.why} | ${pc(0)} | ${pc(1)} | ${same} |`);
  }
}

if (process.argv.includes('--detail')) {
  for (const [name, a, d, p] of scen) {
    const r = run(a, d, p, 'cur');
    console.log(`\n### ${name}`);
    console.log('| t | A사상 | A손실% | A고정 | A손실감 | A합 | A사기 | A병력 | B사상 | B손실% | B고정 | B손실감 | B합 | B사기 | B병력 |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const last = r.rows[0].length;
    for (let i = 0; i < last; i++) {
      const t = i + 1;
      if (!(t <= 5 || t % 10 === 0 || t === last)) continue;
      const x = r.rows[0][i], y = r.rows[1][i];
      console.log(`| ${t} | ${f1(x.cas)} | ${x.pct.toFixed(2)} | ${x.fixed} | ${x.byLoss} | ${x.drop} | ${x.morale} | ${f1(x.troops)} | ${f1(y.cas)} | ${y.pct.toFixed(2)} | ${y.fixed} | ${y.byLoss} | ${y.drop} | ${y.morale} | ${f1(y.troops)} |`);
    }
    const tot = [0, 1].map((k) => r.fixedSum[k] + r.lossSum[k]);
    console.log(`종료: ${r.endT} tick (${(r.endT / 5).toFixed(1)}s) ${r.why}`);
    for (const k of [0, 1]) {
      const f = r.flags[k];
      console.log(`  ${k ? 'B' : 'A'}: 남은 ${f1(f.troopsMilli / 1000)} (${((f.troopsMilli / 1000 / r.start[k]) * 100).toFixed(1)}%) 누적사상 ${f1(r.cum[k] / 1000)} 사기 ${f.morale} | 감소 몫 고정 ${r.fixedSum[k]} (${((r.fixedSum[k] / Math.max(1, tot[k])) * 100).toFixed(0)}%) / 손실 ${r.lossSum[k]} (${((r.lossSum[k] / Math.max(1, tot[k])) * 100).toFixed(0)}%)`);
    }
  }
}

if (process.argv.includes('--compare')) {
  console.log('\n| 시나리오 | 안 | 종료 tick(s) | 사유 | A 남은% | B 남은% | A사기 | B사기 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [name, a, d, p] of scen) {
    if (name.startsWith('4')) continue;
    for (const v of ['cur', 'A', 'B', 'C'] as Variant[]) {
      const r = run(a, d, p, v);
      const pc = (k: number) => ((r.flags[k].troopsMilli / 1000 / r.start[k]) * 100).toFixed(1);
      console.log(`| ${name} | ${v} | ${r.endT} (${(r.endT / 5).toFixed(1)}) | ${r.why} | ${pc(0)} | ${pc(1)} | ${r.flags[0].morale} | ${r.flags[1].morale} |`);
    }
  }
}
