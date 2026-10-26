/**
 * 골드 마이너스(빚) 패널티 (사용자 2026-10-25, 밸런스 패치 6차 [A]):
 * 골드 < 0 이면 전 병종 공격·방어 채널 ×0.7, 점령 속도 ×0.5, 점령(기지 공격 포함) 소모 ×1.5.
 */
import { describe, expect, it } from 'vitest';
import {
  DEBT_CAPTURE_COST_PERMILLE,
  DEBT_CAPTURE_SPEED_PERMILLE,
  DEBT_STAT_PERMILLE,
  MORALE_MAX,
  POSTURE,
  TERRAIN,
  UNIT,
  channelValues,
  techStatValues,
  type CombatFlagInput,
} from '@civwar/shared';
import { combatInput } from '../src/game/combat.js';
import { maxProgress, tileCost } from '../src/game/rules.js';
import { createGameState, makeFlag } from '../src/game/state.js';
import { generateMapForPlayers } from '../src/map/generate.js';

const NO_TECH = techStatValues(0);

describe('골드 마이너스(빚) 패널티', () => {
  it('shared channelValues: debt 이면 두 채널 모두 ×0.7 (지형·사기·이탈을 곱한 뒤 마지막에)', () => {
    const base: CombatFlagInput = { unit: UNIT.CAVALRY, posture: POSTURE.ATTACK, terrain: TERRAIN.PLAIN, onOwnBase: false, troopsMilli: 3_000_000, morale: MORALE_MAX, disengage: false, statPm: NO_TECH };
    const ok = channelValues(base);
    const debt = channelValues({ ...base, debt: true });
    expect(debt).toEqual(ok.map((x) => Math.max(1, Math.floor((x * DEBT_STAT_PERMILLE) / 1000))));
    expect(DEBT_STAT_PERMILLE).toBe(700);
  });

  it('서버 combatInput·tileCost·maxProgress 가 소유자 골드 부호를 따른다', () => {
    const map = generateMapForPlayers(4242, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
    const home = s.players[1].homeTileId;
    const nb = s.graph.disk(home, 6).find((t) => s.owners[t] === 0 && !s.map.isBase[t] && s.map.terrain[t] !== TERRAIN.DEEP && s.map.terrain[t] !== TERRAIN.SHALLOW)!;
    const f = makeFlag({ id: 1, ownerId: 1, slotIndex: 0, unit: UNIT.SWORD, troopsMilli: 100_000, initialTroops: 100, posTileId: home, anchorTileId: home, originTileId: home });
    s.flags.push(f);
    const p = s.players[1];
    // 빚이 없을 때
    p.goldMilli = 0;
    const costOk = tileCost(s, f, nb);
    const progOk = maxProgress(f, s);
    expect(combatInput(s, f).debt).toBe(false);
    expect(progOk).toBe(maxProgress(f));
    // 빚
    p.goldMilli = -1;
    expect(combatInput(s, f).debt).toBe(true);
    expect(tileCost(s, f, nb)).toBeGreaterThanOrEqual(Math.floor((costOk * DEBT_CAPTURE_COST_PERMILLE) / 1000) - 1);
    expect(tileCost(s, f, nb)).toBeLessThanOrEqual(Math.ceil((costOk * DEBT_CAPTURE_COST_PERMILLE) / 1000) + 1);
    expect(maxProgress(f, s)).toBe(Math.floor((progOk * DEBT_CAPTURE_SPEED_PERMILLE) / 1000));
    expect([DEBT_CAPTURE_COST_PERMILLE, DEBT_CAPTURE_SPEED_PERMILLE]).toEqual([1500, 500]);
  });
});
