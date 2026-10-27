/**
 * 2026-10-28 UI 개선 — 배율 대신 보이는 절대값 (ui/unitStats.ts). 점령 비용은 실제 서버 tileCost 와 칸마다 같아야 한다.
 */
import { describe, expect, it } from 'vitest';
import { MORALE_MAX, UNIT, moraleMultiplier, type ServerMessage } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { createTopologyView } from '../src/render/topology.js';
import { captureCost, moraleNeutralPoint, unitSpec } from '../src/ui/unitStats.js';
import { createGameState, makeFlag } from '../../server/src/game/state.js';
import { tileCost } from '../../server/src/game/rules.js';
import { generateMapForPlayers } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));

function setup() {
  const map = generateMapForPlayers(777, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 2);
  // 이웃 나라 땅이 생기게 1번 주변을 2번 것으로 몇 칸 바꾼다
  const home = s.players[1].homeTileId;
  for (const t of s.graph.disk(home, 9)) if (s.owners[t] === 0 && s.map.terrain[t] !== 0 && s.map.terrain[t] !== 6 && t % 3 === 0) s.owners[t] = 2;
  const g = new GameModel(wire(buildMatchConfig(s)));
  g.apply(wire(buildMapInit(s)) as ServerMessage);
  g.apply(wire(buildSnapshotFull(s)) as ServerMessage);
  return { s, g, home, topo: createTopologyView('square', s.map.width, s.map.height) };
}

describe('표시용 절대값', () => {
  it('점령 비용(명/칸) = 서버 tileCost — 중립·적 땅, 세 병종, 인접·보급 거리 포함', () => {
    const { s, g, home, topo } = setup();
    let checked = 0;
    for (const t of s.graph.disk(home, 14)) {
      const o = s.owners[t];
      if (o === 1 || !g.isLand(t)) continue;
      for (const unit of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
        const f = makeFlag({ id: 999, ownerId: 1, slotIndex: 0, unit, troopsMilli: 100_000, initialTroops: 100, posTileId: home, anchorTileId: t, originTileId: home });
        expect(captureCost(g, topo, 1, unit, t)).toBe(tileCost(s, f, t));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(captureCost(g, topo, 1, UNIT.SWORD, home)).toBeNull(); // 내 땅
  });

  it('전투력 ±0 경계 사기: 검 429 · 기병 455 · 창병 없음 (늘 보너스)', () => {
    expect(moraleNeutralPoint(UNIT.SWORD, [])).toBe(429);
    expect(moraleMultiplier(UNIT.SWORD, 429)).toBeGreaterThanOrEqual(1000);
    expect(moraleMultiplier(UNIT.SWORD, 428)).toBeLessThan(1000);
    expect(moraleNeutralPoint(UNIT.CAVALRY, [])).toBe(455);
    expect(moraleMultiplier(UNIT.CAVALRY, 454)).toBeLessThan(1000);
    expect(moraleNeutralPoint(UNIT.SPEAR, [])).toBeNull();
    expect(moraleMultiplier(UNIT.SPEAR, 0)).toBeGreaterThan(1000);
    expect(moraleMultiplier(UNIT.SPEAR, MORALE_MAX)).toBe(1100);
  });

  it('출전 버튼 능력치 (무테크): 공격·방어, 평원 10칸, 점령 소모, 편성비, 유지비/분', () => {
    const { g } = setup();
    const v = [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY].map((u) => unitSpec(g, 1, u));
    expect(v.map((x) => [x.atk, x.def])).toEqual([[90, 110], [100, 100], [120, 90]]);
    expect(v.map((x) => x.sec10)).toEqual([16, 14, 12]);
    expect(v.map((x) => x.capture)).toEqual([7, 6, 10]);
    expect(v.map((x) => x.convertPer100)).toEqual([90, 100, 160]);
    expect(v.map((x) => x.upkeepPerMin)).toEqual([18, 30, 60]);
    expect(v.map((x) => [x.moraleFloor, x.moraleFull])).toEqual([[1050, 1100], [850, 1200], [750, 1300]]);
  });
});
