/** 사용자 요청 2026-10-10: 지형 정보 툴팁, 반투명 영토, 하단 바 유지비 */
import { describe, expect, it } from 'vitest';
import { POSTURE, rleEncode, type FlagSnapshot } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { terrainInfo } from '../src/ui/terrainInfo.js';
import { OWNER_FILL_ALPHA, TERRAIN_RGB, tileRgba } from '../src/render/palette.js';
import { unitUpkeepPerKilo } from '../src/ui/upkeep.js';

const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 1, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: 1, anchorTileId: 2,
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, orderCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, ...over,
});

function model(flags: FlagSnapshot[] = [], upkeepPm = 0): GameModel {
  const m = new GameModel({
    type: 'match_config', seed: 1, topology: 'square', width: 4, height: 2, totalLandTiles: 7, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  });
  // 0 DEEP, 1 PLAIN, 2 FERTILE, 3 HILLS / 4 DESERT, 5 MOUNTAIN, 6 SHALLOW, 7 PLAIN
  m.apply({ type: 'map_init', terrain: rleEncode([0, 1, 2, 3, 4, 5, 6, 1]), spawns: [{ playerId: 1, tileId: 1, homeTileId: 1 }], bases: [1, 7] });
  m.apply({
    type: 'snapshot_full', tick: 25, owners: rleEncode([0, 1, 1, 2, 0, 0, 0, 2]),
    players: [
      { id: 1, tiles: 2, troops: 500, gold: 0, goldWeight: 2000, upkeepPm, techMask: 0, techCount: 0, flagCap: 5, alive: true, connected: true },
      { id: 2, tiles: 2, troops: 500, gold: 0, goldWeight: 2000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 5, alive: true, connected: true },
    ],
    flags, bases: [{ tileId: 1, ownerId: 1, hpPct: 80 }, { tileId: 7, ownerId: 2, hpPct: 100 }],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9575, endgameRushActive: false,
  });
  return m;
}

describe('지형 정보 툴팁', () => {
  const nick = (id: number) => `P${id}`;
  it('언덕: 방어 태세 방어력 +30%, 이동 −20%, 소유자 이름 (2026-10-28: 배율 대신 배지 %)', () => {
    const i = terrainInfo(model(), 3, 1, nick)!;
    expect(i.terrain).toBe('언덕');
    expect(i.mods).toContain('방어 태세일 때 방어력 +30%');
    expect(i.mods).toContain('이동 속도 −20%');
    expect(i.rows.find((r) => r.field === 'defense')!.badges).toEqual([{ text: '방어+30%', tone: 'up', posture: 1, long: '방어 태세일 때 방어력 +30%' }]);
    expect(i.ownerName).toBe('P2');
    expect(i.base).toBeNull();
  });
  it('내 수도 칸 = 기지 정보, 중립·물', () => {
    const cap = terrainInfo(model(), 1, 1, nick)!;
    expect(cap.ownerName).toBe('P1 (나)');
    expect(cap.base).toBe('수도 · 체력 80%');
    expect(terrainInfo(model(), 5, 1, nick)!.ownerName).toBe('중립');
    expect(terrainInfo(model(), 5, 1, nick)!.mods).toContain('방어 태세일 때 방어력 +60%');
    expect(terrainInfo(model(), 0, 1, nick)!.mods[0]).toContain('통행 불가');
    // v4.5 (§22.1): 얕은 물(호수)도 통행 불가 — 이동 속도 행 없음
    const lake = terrainInfo(model(), 6, 1, nick)!;
    expect(lake.mods).toEqual(['통행 불가 · 점령 불가']);
    expect(lake.terrain).toBe('호수');
    expect(lake.rows.some((r) => r.field === 'speed')).toBe(false);
  });
});

describe('반투명 영토', () => {
  it('플레이어 색 OWNER_FILL_ALPHA 만큼 지형 위에 겹친다 — 같은 플레이어라도 지형별로 색이 다르다', () => {
    expect(OWNER_FILL_ALPHA).toBeGreaterThanOrEqual(0.35);
    expect(OWNER_FILL_ALPHA).toBeLessThanOrEqual(0.45);
    expect(tileRgba(1, 0)).not.toBe(tileRgba(1, 1));
    expect(tileRgba(1, 1)).not.toBe(tileRgba(5, 1));
    const r = (tileRgba(5, 1) >>> 24) & 0xff;
    expect(r).toBe(Math.round(0xe5 * OWNER_FILL_ALPHA + TERRAIN_RGB[5][0] * (1 - OWNER_FILL_ALPHA)));
  });
});

describe('하단 바 유지비 (패치 7차 — 병력 비례)', () => {
  it('병종 단가: 병력 1000명당 창 0.3 / 검 0.5 / 기병 0.9 골드/초, 마구간(CAV-2A)은 기병 가중 −0.1', () => {
    const m = model([], 0);
    expect([0, 1, 2].map((u) => unitUpkeepPerKilo(m, 1, u as 0 | 1 | 2))).toEqual([0.3, 0.5, 0.9]);
    // 마구간 CAV-2A(id 37) 보유: 기병 가중 1800 → 1700 = 0.85
    const withTech = model([], 0);
    withTech.players.get(1)!.techMask = 2 ** 37;
    expect(unitUpkeepPerKilo(withTech, 1, 2)).toBe(0.85);
    expect(unitUpkeepPerKilo(withTech, 1, 1)).toBe(0.5);
  });
});
