/**
 * v5.2 (§38, 사용자 2026-10-30): 출전 중인 깃발 병력도 병력 상한에 포함한다.
 * 생산 로지스틱 (1 − 총병력/상한), 총병력 = 대기 + 깃발. 총병력이 상한에 닿으면 생산 0 (부드러운 상한 — 결정 A, 잘라내지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { UNIT } from '@civwar/shared';
import { heldTroopsMilli, troopCap } from '../src/game/economy.js';
import { computeProduction } from '../src/game/production.js';
import { createGameState, ledgerImbalance, makeFlag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMapForPlayers } from '../src/map/generate.js';

function makeState(combatModel?: 1 | 2): GameState {
  const map = generateMapForPlayers(4242, 8);
  const setup = Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true }));
  return combatModel === undefined ? createGameState(map, setup) : createGameState(map, setup, undefined, undefined, combatModel);
}

/** P1 수도 칸에 쉬는 깃발 (회계 시작량도 같이 늘려 불변식 유지) */
function addFlag(s: GameState, troops: number): void {
  const home = s.players[1].homeTileId;
  s.flags.push(makeFlag({ id: s.nextFlagId++, ownerId: 1, slotIndex: 0, unit: UNIT.SPEAR, troopsMilli: troops * 1000, initialTroops: troops, posTileId: home, anchorTileId: home, originTileId: home }));
  s.ledger.initial += troops * 1000;
}

function setPool(s: GameState, troops: number): void {
  s.ledger.initial += troops * 1000 - s.players[1].troopsMilli;
  s.players[1].troopsMilli = troops * 1000;
}

describe('v5.2 깃발 병력 상한 포함 (§38)', () => {
  it('총병력 = 대기 + 자기 깃발 병력', () => {
    const s = makeState();
    setPool(s, 40);
    addFlag(s, 70);
    expect(heldTroopsMilli(s, s.players[1])).toBe(110_000);
    expect(heldTroopsMilli(s, s.players[2])).toBe(s.players[2].troopsMilli);
  });

  it('깃발이 나가 있으면 같은 대기 병력이어도 생산이 느리다', () => {
    const a = makeState();
    setPool(a, 40);
    const b = makeState();
    setPool(b, 40);
    addFlag(b, Math.floor(troopCap(b.players[1]) / 2));
    expect(computeProduction(b, b.players[1]).regenMilli).toBeLessThan(computeProduction(a, a.players[1]).regenMilli);
  });

  it('대기 + 깃발이 상한 이상이면 생산 0, 대기 병력은 잘리지 않는다 (결정 A)', () => {
    const s = makeState();
    const cap = troopCap(s.players[1]);
    setPool(s, 50);
    addFlag(s, cap); // 총병력 = 상한 + 50
    expect(computeProduction(s, s.players[1]).regenMilli).toBe(0);
    const sim = new Simulation(s);
    for (let i = 0; i < 5; i++) {
      sim.step();
      expect(ledgerImbalance(s)).toBe(0);
    }
    expect(s.players[1].troopsMilli).toBe(50_000);
  });

  it('모델 1 은 종전대로 대기 병력만 본다', () => {
    const s = makeState(1);
    setPool(s, 40);
    const before = computeProduction(s, s.players[1]).regenMilli;
    addFlag(s, troopCap(s.players[1]));
    expect(computeProduction(s, s.players[1]).regenMilli).toBe(before);
  });
});
