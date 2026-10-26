/** 4.15 대표 전투 표 재현 출력 (npx tsx server/scripts/duels.ts) */
import { POSTURE, TERRAIN, UNIT, isClaimable } from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { NEUTRAL, createGameState, makeFlag, type GameState } from '../src/game/state.js';

function open(s: GameState): number {
  for (let t = 0; t < s.owners.length; t++) {
    const d = s.graph.disk(t, 3);
    if (d.length === 25 && d.every((x) => isClaimable(s.map.terrain[x]) && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('none');
}
function duel(name: string, au: number, du: number, dTer: number, aTer: number = TERRAIN.PLAIN, dPost: number = POSTURE.DEFEND) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
  const c = open(s);
  s.map.terrain[c] = aTer;
  s.map.terrain[c + 1] = dTer;
  const mk = (id: number, owner: number, unit: number, pos: number, posture: number) => {
    const f = makeFlag({ id, ownerId: owner, slotIndex: 0, unit: unit as 0, troopsMilli: 1_000_000, initialTroops: 1000, posTileId: pos, anchorTileId: pos, originTileId: pos });
    f.posture = posture as 0;
    f.state = 'ENGAGED';
    s.flags.push(f);
    return f;
  };
  const a = mk(1, 1, au, c, POSTURE.ATTACK);
  const d = mk(2, 2, du, c + 1, dPost);
  let t = 0;
  while (!a.routed && !d.routed) {
    t++;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, newOutbox());
  }
  console.log(`${name.padEnd(28)} ${t} tick (${(t / 5).toFixed(1)}s)  공격 ${Math.floor(a.troopsMilli / 1000)} / 방어 ${Math.floor(d.troopsMilli / 1000)}`);
}
duel('#1 검→검 평원', UNIT.SWORD, UNIT.SWORD, TERRAIN.PLAIN);
duel('#2 검→창 평원', UNIT.SWORD, UNIT.SPEAR, TERRAIN.PLAIN);
duel('#3 검→창 언덕', UNIT.SWORD, UNIT.SPEAR, TERRAIN.HILLS);
duel('#3 검→창 산', UNIT.SWORD, UNIT.SPEAR, TERRAIN.MOUNTAIN);
duel('#4 기병→검 평원', UNIT.CAVALRY, UNIT.SWORD, TERRAIN.PLAIN);
duel("#4' 기병→창 평원", UNIT.CAVALRY, UNIT.SPEAR, TERRAIN.PLAIN);
duel('#5 조우전 기병↔검', UNIT.CAVALRY, UNIT.SWORD, TERRAIN.PLAIN, TERRAIN.PLAIN, POSTURE.ATTACK);
