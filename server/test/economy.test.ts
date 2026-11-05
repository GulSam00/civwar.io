import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTY, HARD_TIMEOUT_TICK, TECH_NODES, THRESHOLD_DECAY_START, techMaskWith, techStatValues } from '@civwar/shared';
import { flagCap, grossGoldMilliPerTick, isqrt, regenMilliPerTick, techCost, troopCap } from '../src/game/economy.js';
import type { PlayerState } from '../src/game/state.js';
import { meetsThreshold, thresholdScaled } from '../src/game/victory.js';

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 1, isBot: false, botControlled: false, botDifficulty: 'NORMAL', bot: BOT_DIFFICULTY.NORMAL, connected: true, disconnectedSinceTick: null, alive: true,
    eliminatedTick: null, lastLostTo: null, lastBaseLostTo: null, conqueredBy: null, homeTileId: 0, tiles: 9, goldWeight: 0, baseTiles: [],
    troopsMilli: 150_000, goldMilli: 200_000, goldEarnedMilli: 0, upkeepPm: 0, techMask: 0, techPurchased: 0, allyBreaks: 0, statPm: techStatValues(0),
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
  it('시작 troopCap = 280', () => expect(troopCap(player())).toBe(280));
  // 2026-10-24 테크 개편: 병력 상한 노드(징병소·상비군)를 뺐다 — 행정 갈래 전부 사도 상한은 그대로
  it('병력 상한은 테크로 변하지 않는다 (TROOP_CAP 노드 없음)', () => {
    const base = troopCap(player({ tiles: 390 }));
    expect(base).toBe(7900);
    expect(troopCap(player({ tiles: 390, ...techOf('TER-1', 'TER-2A', 'TER-3A', 'TER-4') }))).toBe(base);
  });
  it('regen = round((0.8 + 0.5√9) × (1 − 150/280) × 1000)', () => {
    // 2.3 × 130/280 × 1000 = 1067.9 → 1068
    expect(regenMilliPerTick(player())).toBe(1068);
  });
  it('상한이면 재생 0', () => expect(regenMilliPerTick(player({ troopsMilli: 280_000 }))).toBe(0));
  it('isqrt 경계', () => {
    for (const x of [0, 1, 2, 3, 4, 15, 16, 17, 999_999, 1_000_000, 4_633_000_000]) {
      const s = isqrt(x);
      expect(s * s).toBeLessThanOrEqual(x);
      expect((s + 1) * (s + 1)).toBeGreaterThan(x);
    }
  });
});

describe('골드 (3.3)', () => {
  it('평균 지형 390타일 → floor(376350 × 2000 × 1000 / 1e9) = 752 (v5.11)', () => {
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350 }))).toBe(752);
  });
  it('v5.8: 전체 골드 배율은 국고 ECO-4 만 올린다 (+20%)', () => {
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350, ...techOf('ECO-1', 'ECO-2A', 'ECO-3A') }))).toBe(752);
    expect(grossGoldMilliPerTick(player({ goldWeight: 376_350, ...techOf('ECO-1', 'ECO-2A', 'ECO-3A', 'ECO-4') }))).toBe(903);
  });
});

describe('테크·슬롯 (3.4)', () => {
  it('누진 비용 (v4.3: 160/360/700, +6%, v5.11: 10 단위 반올림)', () => {
    expect(techCost(1, 0)).toBe(160);
    expect(techCost(1, 1)).toBe(170);
    expect(techCost(2, 2)).toBe(400);
    expect(techCost(3, 4)).toBe(870);
  });
  it('flagCap 표 (GDD 3.2) + MOB-4 참모부 +1', () => {
    expect([100, 390, 600, 900, 1200].map((tiles) => flagCap(player({ tiles })))).toEqual([3, 4, 5, 6, 7]);
    expect(flagCap(player({ tiles: 1200, ...techOf('MOB-1', 'MOB-2A', 'MOB-3A', 'MOB-4') }))).toBe(7); // HARD_MAX
    expect(flagCap(player({ tiles: 390, ...techOf('MOB-1', 'MOB-2A', 'MOB-3A', 'MOB-4') }))).toBe(5);
  });
});

describe('threshold (6.1, 프로토콜 §24 — 60% → 20분부터 3.5 %p/분 → 30분 25%)', () => {
  it('곡선', () => {
    expect(THRESHOLD_DECAY_START).toBe(6000);
    expect(thresholdScaled(0)).toBe(12000);
    expect(thresholdScaled(THRESHOLD_DECAY_START)).toBe(12000);
    expect(thresholdScaled(THRESHOLD_DECAY_START + 1)).toBe(11998); // tick 사이 floor (2.33 단위/tick)
    expect(thresholdScaled(THRESHOLD_DECAY_START + 300)).toBe(11300); // 21분 56.5%
    expect(thresholdScaled(7200)).toBe(9200); // 24분 46%
    expect(thresholdScaled(7800)).toBe(7800); // 26분(종반 러시) 39%
    expect(thresholdScaled(8700)).toBe(5700); // 29분 28.5%
    expect(thresholdScaled(8999)).toBe(5003);
    expect(thresholdScaled(9000)).toBe(5000); // 30분 바닥 25%
    expect(thresholdScaled(HARD_TIMEOUT_TICK)).toBe(5000);
  });
  it('정수 판정', () => {
    expect(meetsThreshold(2340, 3900, 0)).toBe(true); // 60%
    expect(meetsThreshold(2339, 3900, 0)).toBe(false);
    expect(meetsThreshold(1521, 3900, 7800)).toBe(true); // 39%
    expect(meetsThreshold(1520, 3900, 7800)).toBe(false);
    expect(meetsThreshold(975, 3900, 9000)).toBe(true); // 25%
    expect(meetsThreshold(974, 3900, 9000)).toBe(false);
  });
});
