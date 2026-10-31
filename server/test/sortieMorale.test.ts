import { describe, expect, it } from 'vitest';
import { SORTIE_INITIAL_MORALE } from '@civwar/shared';
import { makeFlag } from '../src/game/state.js';

describe('출전 초기 사기 (v5.4)', () => {
  it('새 깃발은 SORTIE_INITIAL_MORALE(900)에서 시작한다', () => {
    const f = makeFlag({ id: 1, ownerId: 1, slotIndex: 0, unit: 0, troopsMilli: 100_000, initialTroops: 100, posTileId: 0, anchorTileId: 0, originTileId: 0 });
    expect(SORTIE_INITIAL_MORALE).toBe(900);
    expect(f.morale).toBe(SORTIE_INITIAL_MORALE);
  });
});
