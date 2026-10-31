/**
 * §33.4 사기 표시 (전투 모델 2) — GameModel 반영(flag_issued 만땅, moraleChanged 델타), 순수 표시 함수, 부대 칩.
 */
import { describe, expect, it } from 'vitest';
import { POSTURE, SORTIE_INITIAL_MORALE, UNIT, type ServerMessage } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { flagChannels, moraleOn, moraleTone, moraleView } from '../src/ui/morale.js';
import { myUnitChips } from '../src/ui/unitChips.js';
import { createGameState, makeFlag } from '../../server/src/game/state.js';
import { generateMapForPlayers } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));

function modelWithFlags(combatModel: 1 | 2, morales: number[]) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, combatModel);
  const home = s.players[1].homeTileId;
  morales.forEach((m, i) => {
    const f = makeFlag({ id: s.nextFlagId++, ownerId: 1, slotIndex: i, unit: UNIT.SWORD, troopsMilli: 100_000, initialTroops: 100, posTileId: home, anchorTileId: home, originTileId: home });
    f.posture = POSTURE.DEFEND;
    f.morale = m;
    s.moraleShown.set(f.id, m); // 델타로 이미 보낸 값처럼 (전체 스냅숏은 보낸 값을 싣는다)
    s.flags.push(f);
  });
  const g = new GameModel(wire(buildMatchConfig(s)));
  g.apply(wire(buildMapInit(s)) as ServerMessage);
  g.apply(wire(buildSnapshotFull(s)) as ServerMessage);
  return { g, s, home };
}

describe('사기 표시 (모델 2)', () => {
  it('사기 곱 (검병, 패치 12차): 만땅 +20% / 800 +13% / 0 −15%, 색 구간 800·400', () => {
    const { g } = modelWithFlags(2, [1000, 800, 300, 0]);
    expect(moraleOn(g)).toBe(true);
    const v = [...g.flags.values()].sort((a, b) => a.slotIndex - b.slotIndex).map((f) => moraleView(g, f)!);
    expect(v.map((x) => x.deltaPct)).toEqual([20, 13, -4, -15]);
    expect(v.map((x) => x.pct)).toEqual([100, 80, 30, 0]);
    expect(v.map((x) => x.tone)).toEqual(['high', 'high', 'low', 'low']);
    expect(v[0].text).toBe('사기 100% · 전투력 +20%');
    expect(v[2].text).toBe('사기 30% · 전투력 −4%');
    expect(v[1].text).toBe('사기 80% · 전투력 +13%');
    expect(moraleTone(500)).toBe('mid');
  });

  it('지금 전투값: 기지 위 방어 검병 = 병종 방어 1000 x 기지 BASE_BUFF(방어 채널만 1.2) x 사기 곱, 사기가 줄면 값도 준다', () => {
    const { g } = modelWithFlags(2, [800, 0]);
    const [a, b] = [...g.flags.values()].sort((x, y) => x.slotIndex - y.slotIndex);
    expect(flagChannels(g, a)).toEqual([1130, 1356]); // 사기 800 = 검병 ×1.13, 기지 ×1.2 는 방어 채널만
    expect(flagChannels(g, b)).toEqual([850, 1020]); // 사기 0 = 검병 ×0.85
  });

  it('moraleChanged 델타가 깃발 사기를 갱신하고, 새 깃발(flag_issued)은 출전 사기(900)로 시작한다', () => {
    const { g, s, home } = modelWithFlags(2, [1000, 1000]);
    const ids = [...g.flags.keys()];
    const base = wire({
      type: 'snapshot_delta', tick: 5, tileChanges: [], playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [],
      moraleChanged: [[ids[0], 640]],
    }) as ServerMessage;
    g.apply(base);
    expect(g.flags.get(ids[0])!.morale).toBe(640);
    expect(g.flags.get(ids[1])!.morale).toBe(1000);
    g.applyEvent({ type: 'flag_issued', tick: 6, flagId: 99, playerId: 1, slotIndex: 2, unit: UNIT.CAVALRY, posture: POSTURE.ATTACK, troops: 50, originTileId: home, anchorTileId: home, targetOwnerId: 0, etaTick: 20 } as ServerMessage);
    expect(g.flags.get(99)!.morale).toBe(SORTIE_INITIAL_MORALE);
    expect(s.combatModel).toBe(2);
  });

  it('모델 1: 사기 필드·표시 모두 없다 (칩 morale = null)', () => {
    const { g } = modelWithFlags(1, [1000]);
    expect(moraleOn(g)).toBe(false);
    const f = [...g.flags.values()][0];
    expect(f.morale).toBeUndefined();
    expect(moraleView(g, f)).toBeNull();
    expect(flagChannels(g, f)).toBeNull();
    expect(myUnitChips(g, 1, null)[0].morale).toBeNull();
  });

  it('부대 칩에 사기가 실린다 (모델 2)', () => {
    const { g } = modelWithFlags(2, [420, 910]);
    expect(myUnitChips(g, 1, null).map((c) => c.morale)).toEqual([420, 910]);
  });
});
