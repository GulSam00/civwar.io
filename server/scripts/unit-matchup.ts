/**
 * 병종 능력치와 동일 병력 평지 교환비 (모델 2): npx tsx server/scripts/unit-matchup.ts [troops=1000]
 * 채널값(ATK/DEF)은 사기 만땅·평지 기준. 결투는 공격 태세(평지) vs 방어 태세(평지)와 조우전(둘 다 공격 태세).
 * 인자 2 (선택) = 테스트용 기본 능력치 덮어쓰기 "창ATK:창DEF,검ATK:검DEF,기ATK:기DEF" 예) 600:1200,1000:1000,1400:800 — 게임 상수는 건드리지 않고 이 프로세스에서만 바꾼다. 테크는 점수 가산이라 바뀐 기본값에서 증감한다.
 * 업그레이드 = 전투 관련 노드 4개(1티어~4티어) 경로, 테크 효과는 channelValues 의 점수(×10‰) 가산.
 */
import { CHANNEL, POSTURE, UNIT_ATK_PERMILLE, UNIT_DEF_PERMILLE, TERRAIN, UNIT, channelValues, techMaskWith, techStatValues, TECH_NODES } from '@civwar/shared';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { createGameState, makeFlag, type Flag, type GameState } from '../src/game/state.js';
import { generateMapForPlayers } from '../src/map/generate.js';

const NAME = ['창병', '검병', '기병'];
if (process.argv[3]) {
  process.argv[3].split(',').forEach((pair, u) => {
    const [a, d] = pair.split(':').map(Number);
    (UNIT_ATK_PERMILLE as unknown as number[])[u] = a;
    (UNIT_DEF_PERMILLE as unknown as number[])[u] = d;
  });
  console.log(`## 테스트용 기본 능력치 덮어쓰기: ${NAME.map((n, u) => `${n} ${UNIT_ATK_PERMILLE[u]}/${UNIT_DEF_PERMILLE[u]}`).join(', ')} (게임 상수는 변경 안 함)`);
}
const idOf = (code: string) => TECH_NODES.find((n) => n.code === code)!.id;
const maskOf = (codes: string[]) => codes.reduce((m, c) => techMaskWith(m, idOf(c)), 0);
// 병종별 최종 경로(전투 능력치 최대): 창 SPE 방어, 검 A(방어형) / B(공격형), 기병 B(기병창·돌격 기세·철기)
const PATHS: Record<string, { unit: number; codes: string[] }> = {
  '창병(방어 경로 1-2B-3A-4)': { unit: UNIT.SPEAR, codes: ['SPE-1', 'SPE-2B', 'SPE-3A', 'SPE-4'] },
  '검병 A(방어형 1-2A-3A-4)': { unit: UNIT.SWORD, codes: ['SWO-1', 'SWO-2A', 'SWO-3A', 'SWO-4'] },
  '검병 B(공격형 1-2B-3B-4)': { unit: UNIT.SWORD, codes: ['SWO-1', 'SWO-2B', 'SWO-3B', 'SWO-4'] },
  '기병 B(1-2B-3B-4)': { unit: UNIT.CAVALRY, codes: ['CAV-1', 'CAV-2B', 'CAV-3B', 'CAV-4'] },
};
const FINAL_BY_UNIT: Record<number, string[]> = {
  [UNIT.SPEAR]: PATHS['창병(방어 경로 1-2B-3A-4)'].codes,
  [UNIT.SWORD]: PATHS['검병 B(공격형 1-2B-3B-4)'].codes,
  [UNIT.CAVALRY]: PATHS['기병 B(1-2B-3B-4)'].codes,
};

function chan(unit: number, posture: number, codes: string[] | null): [number, number] {
  const statPm = techStatValues(codes ? maskOf(codes) : 0);
  const v = channelValues({ unit, posture, terrain: TERRAIN.PLAIN, onOwnBase: false, troopsMilli: 1_000_000, morale: 1000, disengage: false, statPm });
  return [v[CHANNEL.ATK], v[CHANNEL.DEF]];
}
console.log('== 채널값 (평지, 사기 만땅 — ATK/DEF) ==');
console.log('병종 | 초기 공격태세 | 초기 방어태세 | 최종 공격태세 | 최종 방어태세');
for (const u of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
  const f = (p: number, c: string[] | null) => chan(u, p, c).join('/');
  console.log(`${NAME[u]} | ${f(0, null)} | ${f(1, null)} | ${f(0, FINAL_BY_UNIT[u])} | ${f(1, FINAL_BY_UNIT[u])}`);
}
for (const [k, v] of Object.entries(PATHS)) if (k.startsWith('검병 A')) console.log(`${k}: 공격태세 ${chan(v.unit, 0, v.codes).join('/')}, 방어태세 ${chan(v.unit, 1, v.codes).join('/')}`);

function setup(): GameState {
  const map = generateMapForPlayers(4242, 8);
  return createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
}
function addFlag(s: GameState, ownerId: number, unit: number, troops: number, pos: number, posture: number): Flag {
  const f = makeFlag({ id: s.nextFlagId++, ownerId, slotIndex: s.flags.filter((x) => x.ownerId === ownerId).length, unit, troopsMilli: troops * 1000, initialTroops: troops, posTileId: pos, anchorTileId: pos, originTileId: pos });
  f.posture = posture;
  f.state = 'ENGAGED';
  s.flags.push(f);
  s.ledger.initial += troops * 1000;
  return f;
}
function duel(aUnit: number, aPosture: number, dUnit: number, dPosture: number, troops: number, aCodes: string[] | null, dCodes: string[] | null) {
  const s = setup();
  // 중립 평지 두 칸 (인접)
  const W = s.map.width;
  let a = -1;
  for (let t = W * 5 + 5; t < s.owners.length - W * 5; t++) {
    const disk = s.graph.disk(t, 2);
    if (disk.every((x) => !s.map.isBase[x] && s.owners[x] === 0 && s.map.terrain[x] !== TERRAIN.DEEP && s.map.terrain[x] !== TERRAIN.SHALLOW)) { a = t; break; }
  }
  for (const t of s.graph.disk(a, 2)) s.map.terrain[t] = TERRAIN.PLAIN;
  const d = a + 1;
  const apply = (id: number, codes: string[] | null) => { if (codes) { const m = maskOf(codes); s.players[id].techMask = m; s.players[id].statPm = techStatValues(m); } };
  apply(1, aCodes);
  apply(2, dCodes);
  const fa = addFlag(s, 1, aUnit, troops, a, aPosture);
  const fd = addFlag(s, 2, dUnit, troops, d, dPosture);
  const out = newOutbox();
  let t = 0;
  while (!fa.routed && !fd.routed && t < 4000) {
    t++;
    s.tick = t;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
  }
  const aLeft = Math.floor(fa.troopsMilli / 1000);
  const dLeft = Math.floor(fd.troopsMilli / 1000);
  const aLost = troops - aLeft;
  const dLost = troops - dLeft;
  return { sec: Math.round(t * 0.2), aLeft, dLeft, ratio: aLost > 0 ? dLost / aLost : Infinity, winner: fa.routed && fd.routed ? '무승부' : fa.routed ? '방어' : '공격' };
}

const troops = Number(process.argv[2] ?? 1000);
for (const [title, codesFor] of [['초기 능력치(테크 없음)', () => null], ['최종 능력치(양쪽 최종 경로)', (u: number) => FINAL_BY_UNIT[u]]] as const) {
  console.log(`\n== 동일 병력 ${troops} vs ${troops}, 평지, ${title} — 공격 태세(행) vs 방어 태세(열) ==`);
  console.log('교환비 = 방어측 손실 ÷ 공격측 손실 (>1 이면 공격이 유리), 괄호 = 승자 잔존 병력 · 소요 초');
  console.log(['공격\방어', ...[0, 1, 2].map((u) => NAME[u])].join(' | '));
  for (const au of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
    const row = [NAME[au]];
    for (const du of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
      const r = duel(au, POSTURE.ATTACK, du, POSTURE.DEFEND, troops, codesFor(au), codesFor(du));
      row.push(`${r.ratio === Infinity ? '∞' : r.ratio.toFixed(2)} (${r.winner} ${r.winner === '공격' ? r.aLeft : r.dLeft}, ${r.sec}초)`);
    }
    console.log(row.join(' | '));
  }
  console.log(`\n-- 조우전(둘 다 공격 태세) 교환비 = 열 손실 ÷ 행 손실 --`);
  console.log(['행\열', ...[0, 1, 2].map((u) => NAME[u])].join(' | '));
  for (const au of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
    const row = [NAME[au]];
    for (const du of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
      const r = duel(au, POSTURE.ATTACK, du, POSTURE.ATTACK, troops, codesFor(au), codesFor(du));
      row.push(`${r.ratio === Infinity ? '∞' : r.ratio.toFixed(2)} (${r.winner === '공격' ? '행' : r.winner === '방어' ? '열' : '무'} ${r.winner === '공격' ? r.aLeft : r.dLeft}, ${r.sec}초)`);
    }
    console.log(row.join(' | '));
  }
}
