/** 사용자 요청 2026-10-11: 옵션 창 설정 저장/복원, 지형 툴팁 항목 필터, 병종 아이콘 */
import { describe, expect, it } from 'vitest';
import { rleEncode } from '@civwar/shared';
import { GameModel } from '../src/state/gameModel.js';
import { terrainInfo, visibleTipRows } from '../src/ui/terrainInfo.js';
import { OPTIONS_KEY, TOOLTIP_FIELDS, defaultOptions, loadOptions, nextDirectionMode, sanitizeOptions, saveOptions } from '../src/ui/options.js';
import { UNIT_GLYPHS } from '../src/render/unitGlyphs.js';
import { Interaction } from '../src/input/controller.js';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}
const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
};

describe('옵션 설정', () => {
  it('기본값: 색각 보조 끔, 방향 화살표 모두, 툴팁 켬 + 모든 항목', () => {
    const o = defaultOptions();
    expect(o.colorblind).toBe(false);
    expect(o.directions).toBe('all');
    expect(o.tooltip).toBe(true);
    expect(TOOLTIP_FIELDS.every((f) => o.tooltipFields[f])).toBe(true);
    expect(new Interaction().options).toEqual(o);
  });

  it('저장 → 복원', () => {
    const st = memStorage();
    const o = defaultOptions();
    o.colorblind = true;
    o.directions = 'mine';
    o.tooltip = false;
    o.tooltipFields.gold = false;
    expect(saveOptions(o, st)).toBe(true);
    expect(loadOptions(st)).toEqual(o);
  });

  it('저장소 없음·예외·깨진 JSON = 기본값, 저장 실패는 false', () => {
    expect(loadOptions(null)).toEqual(defaultOptions());
    expect(loadOptions(throwing)).toEqual(defaultOptions());
    expect(saveOptions(defaultOptions(), throwing)).toBe(false);
    expect(loadOptions(memStorage({ [OPTIONS_KEY]: '{not json' }))).toEqual(defaultOptions());
  });

  it('일부 필드만 있거나 값이 이상하면 그 필드만 기본값', () => {
    const o = sanitizeOptions({ colorblind: 'yes', directions: 'sideways', tooltip: false, tooltipFields: { owner: false, bogus: true, cost: 3 } });
    expect(o.colorblind).toBe(false);
    expect(o.directions).toBe('all');
    expect(o.tooltip).toBe(false);
    expect(o.tooltipFields.owner).toBe(false);
    expect(o.tooltipFields.cost).toBe(true);
    expect('bogus' in o.tooltipFields).toBe(false);
  });

  it('이전 낱개 키(civwar.colorblind / civwar.directions) 이전', () => {
    const o = loadOptions(memStorage({ 'civwar.colorblind': '1', 'civwar.directions': '0' }));
    expect(o.colorblind).toBe(true);
    expect(o.directions).toBe('off');
  });

  it('V 키 순환: 모두 → 내 깃발만 → 숨김 → 모두', () => {
    expect(nextDirectionMode('all')).toBe('mine');
    expect(nextDirectionMode('mine')).toBe('off');
    expect(nextDirectionMode('off')).toBe('all');
  });
});

function model(): GameModel {
  const m = new GameModel({
    type: 'match_config', seed: 1, topology: 'square', width: 4, height: 2, totalLandTiles: 7, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  });
  // 0 DEEP, 1 PLAIN(수도), 2 FERTILE, 3 HILLS / 4 DESERT, 5 MOUNTAIN, 6 SHALLOW, 7 PLAIN
  m.apply({ type: 'map_init', terrain: rleEncode([0, 1, 2, 3, 4, 5, 6, 1]), spawns: [{ playerId: 1, tileId: 1, homeTileId: 1 }], bases: [1, 7] });
  m.apply({
    type: 'snapshot_full', tick: 25, owners: rleEncode([0, 1, 1, 2, 0, 0, 0, 2]),
    players: [
      { id: 1, tiles: 2, troops: 500, gold: 0, goldWeight: 2000, upkeepPm: 0, tech: [0, 0, 0, 0], flagCap: 5, alive: true, connected: true },
      { id: 2, tiles: 2, troops: 500, gold: 0, goldWeight: 2000, upkeepPm: 0, tech: [0, 0, 0, 0], flagCap: 5, alive: true, connected: true },
    ],
    flags: [], bases: [{ tileId: 1, ownerId: 1, hpPct: 80 }, { tileId: 7, ownerId: 2, hpPct: 100 }],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9575, endgameRushActive: false,
  });
  return m;
}

describe('지형 툴팁 항목 필터', () => {
  const nick = (id: number) => `P${id}`;
  it('행 순서: 지형 → 방어 → 이동 → 점령 비용 → 골드 → 소유자 → 기지 체력', () => {
    const i = terrainInfo(model(), 1, 1, 0, nick)!;
    expect(i.rows.map((r) => r.field)).toEqual(['terrain', 'defense', 'speed', 'cost', 'gold', 'owner', 'baseHp']);
    expect(i.rows.find((r) => r.field === 'baseHp')).toEqual({ field: 'baseHp', label: '수도 체력', value: '80%' });
  });
  it('끈 항목은 빠지고, 툴팁을 끄면 아무것도 없다', () => {
    const i = terrainInfo(model(), 1, 1, 0, nick)!;
    const f = { ...defaultOptions().tooltipFields, gold: false, cost: false, baseHp: false };
    expect(visibleTipRows(i, true, f).map((r) => r.field)).toEqual(['terrain', 'defense', 'speed', 'owner']);
    expect(visibleTipRows(i, false, defaultOptions().tooltipFields)).toEqual([]);
    const none = Object.fromEntries(TOOLTIP_FIELDS.map((k) => [k, false])) as typeof f;
    expect(visibleTipRows(i, true, none)).toEqual([]);
  });
  it('기지가 아닌 칸·깊은 물: 기지 체력 행 없음, 깊은 물은 지형 행에 통행 불가', () => {
    expect(terrainInfo(model(), 3, 1, 0, nick)!.rows.some((r) => r.field === 'baseHp')).toBe(false);
    const deep = terrainInfo(model(), 0, 1, 0, nick)!;
    expect(deep.rows[0].value).toContain('통행 불가');
    expect(deep.rows.map((r) => r.field)).toEqual(['terrain', 'owner']);
  });
});

describe('병종 아이콘', () => {
  it('세 병종 모두 그림이 있고 서로 다르다', () => {
    const ds = ([0, 1, 2] as const).map((u) => UNIT_GLYPHS[u].map((p) => p.d).join('|'));
    expect(ds.every((d) => d.length > 0)).toBe(true);
    expect(new Set(ds).size).toBe(3);
  });
});
