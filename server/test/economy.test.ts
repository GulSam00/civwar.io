import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTY, HARD_TIMEOUT_TICK, TECH_NODES, THRESHOLD_DECAY_START, techMaskWith, techStatValues } from '@civwar/shared';
import { flagCap, grossGoldMilliPerTick, isqrt, regenMilliPerTick, techCost, troopCap } from '../src/game/economy.js';
import type { PlayerState } from '../src/game/state.js';
import { meetsThreshold, thresholdScaled } from '../src/game/victory.js';

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 1, isBot: false, botControlled: false, botDifficulty: 'NORMAL', bot: BOT_DIFFICULTY.NORMAL, connected: true, disconnectedSinceTick: null, alive: true,
    eliminatedTick: null, lastLostTo: null, homeTileId: 0, tiles: 9, goldWeight: 0, baseTiles: [],
    troopsMilli: 150_000, goldMilli: 200_000, goldEarnedMilli: 0, upkeepPm: 0, techMask: 0, techPurchased: 0, statPm: techStatValues(0),
    ...over,
  };
}

/** v4.3: 노드 코드들을 보유한 테크 상태 */
function techOf(...codes: string[]): Pick<PlayerState, 'techMask' | 'techPurchased' | 'statPm'> {
  let m = 0;
  for (const c of codes) m = techMaskWith(m, TECH_NODES.find((n) => n.code === c)!.id);
  return { techMask: m, techPurchased: codes.length, statPm: techStatValues(m) };
}

describe('병력 (3.2)', () => {
  it('시작 troopCap = 208', () => expect(troopCap(player())).toBe(208));
  // v4.3: 4780 × 1.06 = 5066.8 → 5066 / 4780 × 1.14 = 5449.2 → 5449
  it('TER-2B 징병소 capMult 1.06, + TER-3B 1.14', () => {
    expect(troopCap(player({ tiles: 390, ...techOf('TER-1', 'TER-2B') }))).toBe(5066);
    expect(troopCap(player({ tiles: 390, ...techOf('TER-1', 'TER-2B', 'TER-3B') }))).toBe(5449);
  });
  it('regen = round((0.8 + 0.5√9) × (1 − 150/208) × 1000)', () => {
    // 2.3 × 58/208 × 1000 = 641.35 → 641
    expect(regenMilliPerTick(player())).toBe(641);
  });
  it('상한이면 재생 0', () => expect(regenMilliPerTick(player({ troopsMilli: 208_000 }))).toBe(0));
  it('isqrt 경계', () => {
    for (const x of [0, 1, 2, 3, 4, 15, 16, 17, 999_999, 1_000_000, 4_633_000_000]) {
      const s = isqrt(x);
      expect(s * s).toBeLessThanOrEqual(x);
      expect((s + 1) * (s + 1)).toBeGreaterThan(x);
    }
  });
});

describe('골드 (3.3)', () => {
  it('평균 지형 390타일 → floor(376350 × 2080 × 1000 / 1e9) = 782', () => {
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350 }))).toBe(782);
  });
  it('v4.3 ECO-1 ×1.08, ECO-1+2A+3A ×1.30', () => {
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350, ...techOf('ECO-1') }))).toBe(845);
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350, ...techOf('ECO-1', 'ECO-2A', 'ECO-3A') }))).toBe(1017);
  });
});

describe('테크·슬롯 (3.4)', () => {
  it('누진 비용 (v4.3: 160/360/700, +6%)', () => {
    expect(techCost(1, 0)).toBe(160);
    expect(techCost(1, 1)).toBe(169);
    expect(techCost(2, 2)).toBe(403);
    expect(techCost(3, 4)).toBe(868);
  });
  it('flagCap 표 (GDD 3.2) + MOB-3A 참모부 +1', () => {
    expect([100, 390, 600, 900, 1200].map((tiles) => flagCap(player({ tiles })))).toEqual([3, 4, 5, 6, 7]);
    expect(flagCap(player({ tiles: 1200, ...techOf('MOB-1', 'MOB-2A', 'MOB-3A') }))).toBe(7); // HARD_MAX
    expect(flagCap(player({ tiles: 390, ...techOf('MOB-1', 'MOB-2A', 'MOB-3A') }))).toBe(5);
  });
});

describe('threshold (6.1, v4.0 3단계 2차)', () => {
  it('곡선', () => {
    expect(thresholdScaled(0)).toBe(12000);
    expect(thresholdScaled(THRESHOLD_DECAY_START)).toBe(12000);
    expect(thresholdScaled(THRESHOLD_DECAY_START + 300)).toBe(11700); // 58.5%
    expect(thresholdScaled(6300)).toBe(10500); // 52.5%
    expect(thresholdScaled(7800)).toBe(9000); // 26분 바닥
    expect(thresholdScaled(HARD_TIMEOUT_TICK)).toBe(9000);
  });
  it('정수 판정', () => {
    expect(meetsThreshold(2340, 3900, 0)).toBe(true); // 60%
    expect(meetsThreshold(2339, 3900, 0)).toBe(false);
    expect(meetsThreshold(1755, 3900, 7800)).toBe(true); // 45%
    expect(meetsThreshold(1754, 3900, 7800)).toBe(false);
  });
});
