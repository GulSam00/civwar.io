/**
 * §33 교전 예상 — 서버 4a(stage4a_flagCombatPhaseA)의 편 손실 비중과 같은 값을 내는지, 모델 1·교전 밖은 null 인지.
 */
import { describe, expect, it } from 'vitest';
import { POSTURE, UNIT, type Posture, type ServerMessage, type Unit } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { engagePreview, verdictOf } from '../src/ui/engagePreview.js';
import { createGameState, makeFlag } from '../../server/src/game/state.js';
import { stage4a_flagCombatPhaseA } from '../../server/src/game/combat.js';
import { generateMapForPlayers } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));

function duel(model: 1 | 2, a: { unit: Unit; posture: Posture; troops: number; morale: number }, b: { unit: Unit; posture: Posture; troops: number; morale: number }) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, model);
  const t0 = s.players[1].homeTileId;
  const t1 = s.graph.contactNeighbors(t0)[0];
  const mk = (owner: number, tile: number, x: typeof a) => {
    const f = makeFlag({ id: s.nextFlagId++, ownerId: owner, slotIndex: 0, unit: x.unit, troopsMilli: x.troops * 1000, initialTroops: x.troops, posTileId: tile, anchorTileId: tile, originTileId: tile });
    f.posture = x.posture;
    f.morale = x.morale;
    f.state = 'ENGAGED';
    f.inCombat = true;
    s.flags.push(f);
    return f;
  };
  const fa = mk(1, t0, a);
  const fb = mk(2, t1, b);
  const g = new GameModel(wire(buildMatchConfig(s)));
  g.apply(wire(buildMapInit(s)) as ServerMessage);
  g.apply(wire(buildSnapshotFull(s)) as ServerMessage);
  return { s, g, fa, fb };
}

const A = { unit: UNIT.CAVALRY, posture: POSTURE.ATTACK, troops: 120, morale: 1000 };
const B = { unit: UNIT.SPEAR, posture: POSTURE.DEFEND, troops: 100, morale: 600 };

describe('교전 예상 (모델 2)', () => {
  it('서버 4a 의 편 손실 비중과 같다 (양쪽 시점)', () => {
    const { s, g, fa, fb } = duel(2, A, B);
    const plan = stage4a_flagCombatPhaseA(s, 0);
    expect(plan.groups).toHaveLength(1);
    const sides = plan.groups[0].sides;
    const ofOwner = (o: number) => sides.find((x) => x.ownerIds.includes(o))!.lossPermille!;
    const pa = engagePreview(g, g.flags.get(fa.id)!)!;
    const pb = engagePreview(g, g.flags.get(fb.id)!)!;
    expect(pa.minePermille).toBe(ofOwner(1));
    expect(pb.minePermille).toBe(ofOwner(2));
    expect(pa.flagCount).toBe(2);
    expect(pa.sideCount).toBe(2);
    expect(pa.minePermille + pb.minePermille).toBeGreaterThanOrEqual(998);
  });

  it('사기 낮은 쪽이 더 불리하고, 판정·문구가 비중과 맞는다', () => {
    const { g, fa, fb } = duel(2, A, B);
    const pa = engagePreview(g, g.flags.get(fa.id)!)!;
    const pb = engagePreview(g, g.flags.get(fb.id)!)!;
    expect(pa.minePermille).toBeLessThan(pb.minePermille);
    expect(pa.text).toContain(`내 쪽 손실 ${Math.round(pa.minePermille / 10)}%`);
    expect(pa.verdict).toBe(verdictOf(pa.minePermille));
    expect(pb.ratio).not.toBeNull();
  });

  it('모델 1 이거나 교전 중이 아니면 null', () => {
    const m1 = duel(1, A, B);
    expect(engagePreview(m1.g, m1.g.flags.get(m1.fa.id)!)).toBeNull();
    const m2 = duel(2, A, B);
    const f = m2.g.flags.get(m2.fa.id)!;
    f.inCombat = false;
    expect(engagePreview(m2.g, f)).toBeNull();
  });

  it('판정 경계: 40% 이하 유리, 60% 이상 불리', () => {
    expect([verdictOf(300), verdictOf(400), verdictOf(500), verdictOf(600), verdictOf(700)]).toEqual(['favorable', 'favorable', 'even', 'unfavorable', 'unfavorable']);
  });
});
