/**
 * 2026-11-05 지형 스탯 절대값 표기 (이슈 20261104-0111) — 이동력(평원 칸당 100 · 병종 초당), 칸당 골드/분, 골드 흐름 /분.
 * 칸 이동력 ÷ 초당 이동력 = 서버 speedMilliAt 로 걸리는 칸당 초 (floor 차이 이내)
 */
import { describe, expect, it } from 'vitest';
import { FLAG_SPEED_BASE_MILLI, TERRAIN, TERRAIN_MOVE_PERMILLE, TICK_MS, UNIT, UNIT_SPEED_PERMILLE } from '@civwar/shared';
import { fmtGoldPerMin } from '../src/ui/fmt.js';
import { techStatsOf } from '../src/ui/techInfo.js';
import { terrainGoldPerMin, terrainMoveCost, unitMovePerSec } from '../src/ui/unitStats.js';

const NO_TECH = techStatsOf(0);
const LAND = [TERRAIN.PLAIN, TERRAIN.FERTILE, TERRAIN.HILLS, TERRAIN.DESERT, TERRAIN.MOUNTAIN];

describe('이동력 (평원 100 기준)', () => {
  it('지형 칸당 이동력: 평원·비옥지 100 · 언덕 125 · 사막 111 · 산 200', () => {
    expect(LAND.map((t) => terrainMoveCost(t))).toEqual([100, 100, 125, 111, 200]);
  });
  it('병종 초당 이동력 (무테크): 창 63 · 검 70 · 기병 84', () => {
    expect([UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY].map((u) => unitMovePerSec(u, NO_TECH))).toEqual([63, 70, 84]);
  });
  it('칸 이동력 ÷ 초당 이동력 ≈ 서버 속도로 한 칸 걷는 초', () => {
    for (const u of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY]) {
      for (const t of LAND) {
        // server rules.speedMilliAt (무테크, 행군) — milli칸/tick
        const milli = Math.max(1, Math.floor((FLAG_SPEED_BASE_MILLI * UNIT_SPEED_PERMILLE[u] * 1000 * 1000) / (TERRAIN_MOVE_PERMILLE[t] * 1_000_000)));
        const serverSec = (1000 / milli) * (TICK_MS / 1000);
        const shown = terrainMoveCost(t) / unitMovePerSec(u, NO_TECH);
        expect(Math.abs(shown - serverSec) / serverSec).toBeLessThan(0.02);
      }
    }
  });
});

describe('골드 표기', () => {
  it('지형 칸당 골드/분 (무테크, v5.11): 평원 0.6 · 비옥지 1.2 · 언덕 0.5 · 사막·산 0.2, 물 0', () => {
    expect(LAND.map((t) => terrainGoldPerMin(t, NO_TECH))).toEqual([0.6, 1.2, 0.5, 0.2, 0.2]);
    expect(terrainGoldPerMin(TERRAIN.DEEP, NO_TECH)).toBe(0);
  });
  it('골드 흐름은 /분 — 서버 골드/초 × 60 반올림', () => {
    expect(fmtGoldPerMin(1)).toBe('+60/분');
    expect(fmtGoldPerMin(-0.2)).toBe('−12/분');
    expect(fmtGoldPerMin(25)).toBe('+1,500/분');
    expect(fmtGoldPerMin(0.5, false)).toBe('30/분');
  });
});
