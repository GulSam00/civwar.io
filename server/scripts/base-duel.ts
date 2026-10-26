/**
 * 기지 위 방어 vs 공격 1:1 결투 (모델 2): npx tsx server/scripts/base-duel.ts
 * 방어 깃발(소유자 2)이 자기 기지/평원/언덕 칸에서 방어 태세로 서 있고, 공격 깃발(소유자 1)이 옆 칸에서 공격 태세로 붙는다. 기지 체력 피해·테크·사기 변화(교전 중 사기 하락)는 모델 안에서 그대로 돈다.
 */
import { POSTURE, TERRAIN, UNIT, type Posture, type Unit } from '@civwar/shared';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { createGameState, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { generateMapForPlayers } from '../src/map/generate.js';

const NAME = ['창병', '검병', '기병'];
function setup() {
  const map = generateMapForPlayers(4242, 8);
  return createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
}
function addFlag(s: GameState, ownerId: number, unit: number, troops: number, pos: number, posture: number): Flag {
  const f = makeFlag({ id: s.nextFlagId++, ownerId, slotIndex: s.flags.filter((x) => x.ownerId === ownerId).length, unit: unit as Unit, troopsMilli: troops * 1000, initialTroops: troops, posTileId: pos, anchorTileId: pos, originTileId: pos });
  f.posture = posture as Posture;
  f.state = 'ENGAGED';
  s.flags.push(f);
  s.ledger.initial += troops * 1000;
  return f;
}
function duel(where: 'base' | 'plain' | 'hills' | 'mountain', aUnit: number, dUnit: number, aTroops: number, dTroops: number) {
  const s = setup();
  const home = s.players[2].homeTileId; // 소유자 2의 수도 (기지)
  const nb = s.graph.neighbors(home).find((t) => s.map.terrain[t] !== TERRAIN.DEEP && s.map.terrain[t] !== TERRAIN.SHALLOW && !s.map.isBase[t])!;
  let dTile = home;
  if (where !== 'base') {
    // 기지가 아닌 일반 칸 두 개를 같은 위치 근처에 만든다
    dTile = nb;
    setTileOwner(s, dTile, 2, false);
    s.map.terrain[dTile] = where === 'plain' ? TERRAIN.PLAIN : where === 'hills' ? TERRAIN.HILLS : TERRAIN.MOUNTAIN;
  }
  const aTile = s.graph.neighbors(dTile).find((t) => t !== home && s.map.terrain[t] !== TERRAIN.DEEP && s.map.terrain[t] !== TERRAIN.SHALLOW && !s.map.isBase[t] && !s.flags.some((f) => f.posTileId === t))!;
  s.map.terrain[aTile] = TERRAIN.PLAIN;
  const fa = addFlag(s, 1, aUnit, aTroops, aTile, POSTURE.ATTACK);
  const fd = addFlag(s, 2, dUnit, dTroops, dTile, POSTURE.DEFEND);
  const out = newOutbox();
  let t = 0;
  while (!fa.routed && !fd.routed && t < 3000) {
    t++;
    s.tick = t;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
  }
  return { sec: (t * 0.2).toFixed(0), a: Math.floor(fa.troopsMilli / 1000), d: Math.floor(fd.troopsMilli / 1000), win: fa.routed && fd.routed ? '양쪽 패주' : fa.routed ? '방어 승' : fd.routed ? '공격 승' : '미결' };
}

const D = Number(process.argv[2] ?? 1000);
for (const where of ['base', 'plain', 'hills', 'mountain'] as const) {
  console.log(`\n== 방어 창병 ${D}명 (${where === 'base' ? '자기 기지 위' : where === 'plain' ? '평원' : where === 'hills' ? '언덕' : '산'}, 방어 태세) vs 공격 태세 ==`);
  for (const au of [UNIT.SWORD, UNIT.CAVALRY]) {
    const rows: string[] = [];
    for (const mult of [1, 1.5, 2, 3, 4, 6]) {
      const r = duel(where, au, UNIT.SPEAR, Math.round(D * mult), D);
      rows.push(`${mult}배(${Math.round(D * mult)}): ${r.win}${r.win === '공격 승' ? ` 잔존 ${r.a}` : r.win === '방어 승' ? ` 잔존 ${r.d}` : ''} ${r.sec}초`);
    }
    console.log(`${NAME[au]}: ${rows.join(' | ')}`);
  }
}
