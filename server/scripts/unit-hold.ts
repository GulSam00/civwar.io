/**
 * 병종 상성의 시간 의존(단기 0~10초 / 장기 40~60초) 측정용 시제품 — 게임 코드는 바꾸지 않는다.
 *   npx tsx server/scripts/unit-hold.ts            → 지속 교전(hold): 매 틱 병력을 초기값으로 복원해 60초 동안 교환 속도를 구간별로 측정
 *   npx tsx server/scripts/unit-hold.ts terrain    → 지형 버프 방식 비교(현행 두 채널 / 채널 한정)
 * 병종별 사기 곱(MU_FLOOR/MU_FULL)과 방어 가중(OM_DEF)은 게임 코드에 없는 훅이라 server/scripts/proto-morale-patch.diff 를 임시로 적용해야 동작한다(`git apply`, 시험 뒤 `git checkout shared/src/combatMath.ts`).
 * 환경변수: STATS="600:1200,1000:1000,1600:800"  MFLOORS="a,b,c"  MFULLS="a,b,c" (병종별 사기 곱 0 / 1000, combatMath.moraleMultiplier 임시 패치 필요)
 *           DROP_ATK="3,4,6" DROP_DEF="2,3,5" K=10 (사기 고정 하락 + 손실 1%당 K)
 */
import { POSTURE, TERRAIN, UNIT, UNIT_ATK_PERMILLE, UNIT_DEF_PERMILLE, TERRAIN_BUFF, BASE_BUFF } from '@civwar/shared';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { createGameState, makeFlag, type Flag, type GameState } from '../src/game/state.js';
import { generateMapForPlayers } from '../src/map/generate.js';

const NAME = ['창', '검', '기'];
// 시험 전용: MU_FLOOR="창,검,기" MU_FULL="창,검,기" 이면 병종별 사기 곱(사기 0 / 1000)을 쓴다 (combatMath.moraleMultiplier TEMP 패치가 있을 때만 의미)
if (process.env.MU_FLOOR && process.env.MU_FULL) {
  (globalThis as unknown as { __MU?: unknown }).__MU = { floor: process.env.MU_FLOOR.split(',').map(Number), full: process.env.MU_FULL.split(',').map(Number) };
  console.log(`## 병종별 사기 곱 (사기 0 / 1000): 창 ${process.env.MU_FLOOR.split(',')[0]}/${process.env.MU_FULL.split(',')[0]}, 검 ${process.env.MU_FLOOR.split(',')[1]}/${process.env.MU_FULL.split(',')[1]}, 기 ${process.env.MU_FLOOR.split(',')[2]}/${process.env.MU_FULL.split(',')[2]}`);
}

const STATS = (process.env.STATS ?? '600:1200,1000:1000,1600:800').split(',');
STATS.forEach((p, u) => {
  const [a, d] = p.split(':').map(Number);
  (UNIT_ATK_PERMILLE as unknown as number[])[u] = a;
  (UNIT_DEF_PERMILLE as unknown as number[])[u] = d;
});
const D_ATK = (process.env.DROP_ATK ?? '3,4,6').split(',').map(Number);
const D_DEF = (process.env.DROP_DEF ?? '2,3,5').split(',').map(Number);
const K = Number(process.env.K ?? 10);

function build(aUnit: number, aPosture: number, dUnit: number, dPosture: number, opt: { dTerrain?: number; onBase?: boolean; troops?: number } = {}) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
  const W = s.map.width;
  let a = -1;
  let d = -1;
  if (opt.onBase) {
    d = s.players[2].homeTileId;
    a = s.graph.neighbors(d).find((t) => s.map.terrain[t] !== TERRAIN.DEEP && s.map.terrain[t] !== TERRAIN.SHALLOW && !s.map.isBase[t])!;
    s.map.terrain[a] = TERRAIN.PLAIN;
  } else {
    for (let t = W * 5 + 5; t < s.owners.length - W * 5; t++) {
      const disk = s.graph.disk(t, 2);
      if (disk.every((x) => !s.map.isBase[x] && s.owners[x] === 0 && s.map.terrain[x] !== TERRAIN.DEEP && s.map.terrain[x] !== TERRAIN.SHALLOW)) {
        a = t;
        break;
      }
    }
    for (const t of s.graph.disk(a, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
    d = a + 1;
    s.map.terrain[d] = opt.dTerrain ?? TERRAIN.PLAIN;
  }
  const mk = (ownerId: number, unit: number, pos: number, posture: number): Flag => {
    const n = opt.troops ?? 1000;
    const f = makeFlag({ id: s.nextFlagId++, ownerId, slotIndex: 0, unit, troopsMilli: n * 1000, initialTroops: n, posTileId: pos, anchorTileId: pos, originTileId: pos });
    f.posture = posture;
    f.state = 'ENGAGED';
    s.flags.push(f);
    s.ledger.initial += n * 1000;
    return f;
  };
  return { s, fa: mk(1, aUnit, a, aPosture), fd: mk(2, dUnit, d, dPosture) };
}

/** 한 틱: 4a/4b 후 시제품 사기 규칙으로 교전 중 사기를 덮어쓴다 */
function step(s: GameState, t: number, out: ReturnType<typeof newOutbox>): void {
  s.tick = t;
  const before = new Map(s.flags.map((f) => [f.id, { troops: f.troopsMilli, morale: f.morale }]));
  stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
  for (const f of s.flags) {
    const b = before.get(f.id)!;
    if (f.routed || !f.inCombat) continue;
    const lossPct = ((b.troops - f.troopsMilli) / Math.max(1, b.troops)) * 100;
    f.morale = Math.max(0, b.morale - ((f.posture === POSTURE.DEFEND ? D_DEF : D_ATK)[f.unit] + K * lossPct));
  }
}

/** 지속 교전: 매 틱 병력을 복원해 구간별 손실 비(두 번째 ÷ 첫 번째)를 잰다. 반환 [0~10초, 10~40초, 40~60초] */
function hold(aUnit: number, aPosture: number, dUnit: number, dPosture: number): number[] {
  const { s, fa, fd } = build(aUnit, aPosture, dUnit, dPosture);
  const out = newOutbox();
  const lossA = [0, 0, 0];
  const lossD = [0, 0, 0];
  const n0 = fa.troopsMilli;
  for (let t = 1; t <= 300; t++) {
    const sec = t * 0.2;
    step(s, t, out);
    const w = sec <= 10 ? 0 : sec <= 40 ? 1 : 2;
    lossA[w] += n0 - fa.troopsMilli;
    lossD[w] += n0 - fd.troopsMilli;
    fa.troopsMilli = n0;
    fd.troopsMilli = n0;
    fa.routed = false;
    fd.routed = false;
  }
  return lossA.map((la, i) => (la > 0 ? lossD[i] / la : Infinity));
}

if (process.argv[2] === 'terrain') {
  // 지형 버프 방식 비교: 방어 깃발이 지형/기지 위에서 방어 태세, 공격 병종(평지, 공격 태세) — 끝까지 싸운 결과
  const dup = (a: readonly (readonly (readonly number[])[])[]) => a.map((x) => x.map((y) => [...y]));
  const CUR = dup(TERRAIN_BUFF);
  const CURB = BASE_BUFF.map((x) => [...x]);
  const apply = (mode: 'cur' | 'chan') => {
    const T = TERRAIN_BUFF as unknown as number[][][];
    const B = BASE_BUFF as unknown as number[][];
    for (let i = 0; i < T.length; i++) for (let p = 0; p < 2; p++) for (let c = 0; c < 2; c++) T[i][p][c] = CUR[i][p][c];
    for (let p = 0; p < 2; p++) for (let c = 0; c < 2; c++) B[p][c] = CURB[p][c];
    const OMG = globalThis as unknown as { __OM?: number[][] };
    OMG.__OM = undefined;
    if (mode === 'chan' && process.env.OM_DEF) {
      // 방어 태세의 공격 채널 가중 ω_ATK (병종별), 방어 가중 = 1000 − ω_ATK. 공격 태세는 600 그대로
      OMG.__OM = [[600, 600, 600], process.env.OM_DEF.split(',').map(Number)];
    }
    if (mode === 'chan') {
      T[TERRAIN.PLAIN][POSTURE.ATTACK] = [1050, 1000]; // 공격 태세: 공격력만 +5%
      T[TERRAIN.FERTILE][POSTURE.ATTACK] = [1050, 1000];
      T[TERRAIN.DESERT][POSTURE.ATTACK] = [900, 1000]; // 사막: 공격력만 −10% (태세 무관)
      T[TERRAIN.DESERT][POSTURE.DEFEND] = [900, 1000];
      T[TERRAIN.HILLS][POSTURE.DEFEND] = [1000, 1100]; // 방어 태세: 방어력만
      T[TERRAIN.MOUNTAIN][POSTURE.DEFEND] = [1000, 1300];
      B[POSTURE.DEFEND] = [1000, 1200]; // 기지: 방어 태세 방어력만 +20%
      B[POSTURE.ATTACK] = [1000, 1000];
    }
  };
  const run = (dUnit: number, aUnit: number, where: 'plain' | 'hills' | 'mountain' | 'desert' | 'base') => {
    const dTerrain = where === 'hills' ? TERRAIN.HILLS : where === 'mountain' ? TERRAIN.MOUNTAIN : where === 'desert' ? TERRAIN.DESERT : TERRAIN.PLAIN;
    const { s, fa, fd } = build(aUnit, POSTURE.ATTACK, dUnit, POSTURE.DEFEND, { dTerrain, onBase: where === 'base' });
    const out = newOutbox();
    let t = 0;
    while (!fa.routed && !fd.routed && t < 4000) step(s, ++t, out);
    const aL = 1000 - Math.floor(fa.troopsMilli / 1000);
    const dL = 1000 - Math.floor(fd.troopsMilli / 1000);
    return `${(dL / Math.max(1, aL)).toFixed(2)}${fa.routed && !fd.routed ? '(방)' : fd.routed && !fa.routed ? '(공)' : '(무)'}`;
  };
  for (const aUnit of [UNIT.SWORD, UNIT.CAVALRY]) {
    console.log(`\n## 공격 ${NAME[aUnit]}병(평지, 공격 태세) vs 방어 병종(칸 종류별) — 교환비 = 방어측 손실 ÷ 공격측 손실, (공)/(방) = 승자`);
    console.log('방어 병종 | 평지 현행 / 채널한정 | 언덕 현행 / 채널한정 | 산 현행 / 채널한정 | 사막 현행 / 채널한정 | 기지 현행 / 채널한정');
    for (const du of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
      const row = [`${NAME[du]}병`];
      for (const where of ['plain', 'hills', 'mountain', 'desert', 'base'] as const) {
        apply('cur');
        const c = run(du, aUnit, where);
        apply('chan');
        const h = run(du, aUnit, where);
        row.push(`${c} / ${h}`);
      }
      console.log(row.join(' | '));
    }
  }
  process.exit(0);
}

if (process.argv[2] === 'search') {
  // 병종별 사기 곱 범위 탐색: 조우전 창→검, 창→기, 검→기 의 단기(0~10초)/장기(40~60초) 목표에 맞추기 (combatMath.moraleMultiplier TEMP 패치 필요)
  const G = globalThis as unknown as { __MU?: { floor: number[]; full: number[] } };
  const target = { 'S-W': [0.65, 0.88], 'S-C': [0.45, 1.0], 'W-C': [0.7, 0.88] } as const;
  const pairs: [string, number, number][] = [['S-W', UNIT.SPEAR, UNIT.SWORD], ['S-C', UNIT.SPEAR, UNIT.CAVALRY], ['W-C', UNIT.SWORD, UNIT.CAVALRY]];
  const rows: { err: number; txt: string }[] = [];
  const fl = (process.env.FLS ?? '700,900,1100').split(',').map(Number);
  const fw = (process.env.FLW ?? '500,700,900').split(',').map(Number);
  const fc = (process.env.FLC ?? '300,500,700').split(',').map(Number);
  const us = (process.env.FUS ?? '1100').split(',').map(Number);
  const uw = (process.env.FUW ?? '1200').split(',').map(Number);
  const uc = (process.env.FUC ?? '1300').split(',').map(Number);
  for (const a of fl) for (const b of fw) for (const c of fc) for (const x of us) for (const y of uw) for (const z of uc) {
    G.__MU = { floor: [a, b, c], full: [x, y, z] };
    let err = 0;
    const out: string[] = [];
    for (const [k, u1, u2] of pairs) {
      const r = hold(u1, POSTURE.ATTACK, u2, POSTURE.ATTACK);
      const [ts, tl] = target[k as keyof typeof target];
      err += Math.abs(Math.log(r[0] / ts)) + Math.abs(Math.log(r[2] / tl));
      out.push(`${k} ${r[0].toFixed(2)}→${r[2].toFixed(2)}`);
    }
    rows.push({ err, txt: `floor(창,검,기)=${a},${b},${c} full=${x},${y},${z} | ${out.join(' | ')} | err ${err.toFixed(2)}` });
  }
  rows.sort((p, q) => p.err - q.err);
  console.log('목표(단기→장기): S-W 0.65→0.88, S-C 0.45→1.00, W-C 0.70→0.88  (값 = 열 손실 ÷ 행 손실, 조우전)');
  for (const r of rows.slice(0, Number(process.env.TOP ?? 8))) console.log(r.txt);
  process.exit(0);
}

const fmt = (r: number[]) => r.map((x) => (x === Infinity ? '∞' : x.toFixed(2))).join(' / ');
console.log(`## 지속 교전 교환 속도 (둘째÷첫째 손실, >1 이면 둘째 유리). 구간 0~10초 / 10~40초 / 40~60초. 기본 ${STATS.join(', ')}, 고정 하락 ${D_ATK}|${D_DEF}, K=${K}`);
for (const [title, pa, pd] of [
  ['조우전(둘 다 공격 태세)', POSTURE.ATTACK, POSTURE.ATTACK],
  ['공격 태세(행) → 방어 태세(열)', POSTURE.ATTACK, POSTURE.DEFEND],
] as const) {
  console.log(`\n-- ${title}: 행 대 열, 값 = 열 손실 ÷ 행 손실 --`);
  for (const a of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
    const row = [NAME[a]];
    for (const d of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) row.push(a === d ? '-' : fmt(hold(a, pa, d, pd)));
    console.log(row.join(' | '));
  }
}
