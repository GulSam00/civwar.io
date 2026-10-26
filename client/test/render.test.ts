/** 좌표 변환 · RLE · 깃발 보간 · 병력 비율 · 커서 예고 */
import { describe, expect, it } from 'vitest';
import { rleDecode, rleEncode, type S2C_MatchConfig } from '@civwar/shared';
import { SquareTopologyView, createTopologyView } from '../src/render/topology.js';
import { panBy, screenToWorld, worldToScreen, zoomAt, type Camera } from '../src/render/camera.js';
import { FlagInterpolator, easeOutQuad } from '../src/render/flagInterp.js';
import { computePreview, troopsForRatio } from '../src/input/preview.js';
import { GameModel } from '../src/state/gameModel.js';

describe('RLE', () => {
  it('왕복', () => {
    const data = [0, 0, 0, 3, 3, 1, 12, 12, 12, 12, 0];
    const rle = rleEncode(data);
    expect(rle).toEqual([0, 3, 3, 2, 1, 1, 12, 4, 0, 1]);
    expect(Array.from(rleDecode(rle, data.length))).toEqual(data);
  });
  it('길이 불일치는 예외', () => {
    expect(() => rleDecode([1, 3], 4)).toThrow();
  });
});

describe('토폴로지 (사각)', () => {
  const t = new SquareTopologyView(100, 60);
  it('tileCenter ↔ worldToTileId 왕복, 맵 밖 -1', () => {
    for (const id of [0, 99, 100, 2412, 5999]) {
      const c = t.tileCenter(id);
      expect(t.worldToTileId(c.x, c.y)).toBe(id);
      expect(t.worldToTileId(c.x + 0.49, c.y - 0.49)).toBe(id);
    }
    expect(t.worldToTileId(-0.01, 5)).toBe(-1);
    expect(t.worldToTileId(100, 5)).toBe(-1);
    expect(t.worldToTileId(5, 60)).toBe(-1);
  });
  it('거리(맨해튼) · disk · 거리장', () => {
    expect(t.distance(0, 101)).toBe(2);
    expect(t.disk(2412, 6).length).toBe(85); // 2r²+2r+1
    expect(t.disk(0, 1).sort((a, b) => a - b)).toEqual([0, 1, 100]);
    const f = t.distanceField((x) => x === 0);
    expect(f[101]).toBe(2);
    expect(f[5999]).toBe(99 + 59);
    expect(t.neighbors(0)).toEqual([1, 100]);
  });
  it('createTopologyView 는 square 만', () => {
    expect(createTopologyView('square', 3, 3).tileCount).toBe(9);
    expect(() => createTopologyView('hex', 3, 3)).toThrow();
  });
});

describe('카메라 + pixelToTileId', () => {
  const topo = new SquareTopologyView(100, 60);
  const pixelToTileId = (cam: Camera, sx: number, sy: number) => {
    const w = screenToWorld(cam, sx, sy);
    return topo.worldToTileId(w.x, w.y);
  };
  it('화면 중앙 = 카메라 중심 타일, 팬·줌 반영', () => {
    const cam: Camera = { cx: 50.5, cy: 30.5, zoom: 10, viewW: 800, viewH: 600 };
    expect(pixelToTileId(cam, 400, 300)).toBe(30 * 100 + 50);
    expect(pixelToTileId(cam, 400 + 10, 300)).toBe(30 * 100 + 51);
    panBy(cam, -20, 0); // 화면을 왼쪽으로 20px 끌면 세계는 오른쪽 2칸
    expect(pixelToTileId(cam, 400, 300)).toBe(30 * 100 + 52);
    const before = screenToWorld(cam, 123, 456);
    zoomAt(cam, 123, 456, 2);
    const after = screenToWorld(cam, 123, 456);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    const s = worldToScreen(cam, after.x, after.y);
    expect(s.x).toBeCloseTo(123, 9);
    expect(s.y).toBeCloseTo(456, 9);
  });
});

describe('깃발 보간 — 단조 이징, 스냅 금지', () => {
  it('easeOutQuad 단조', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeOutQuad(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
  });
  it('새 칸이 와도 현재 그려진 위치에서 이어서 움직인다', () => {
    const ip = new FlagInterpolator();
    expect(ip.update(1, 10, { x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
    // 1000ms 정지 후 다음 칸 (+1, 0)
    const a = ip.update(1, 11, { x: 1, y: 0 }, 1000);
    expect(a.x).toBe(0); // 시작 순간 = 이전 위치 (스냅 없음)
    const xs: number[] = [];
    for (let t = 1000; t <= 3000; t += 50) xs.push(ip.update(1, 11, { x: 1, y: 0 }, t).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(xs[xs.length - 1]).toBeCloseTo(1, 9);
    // 구간 중간에 다음 칸이 오면 중간 위치에서 출발
    ip.update(1, 12, { x: 2, y: 0 }, 3200);
    const mid = ip.update(1, 12, { x: 2, y: 0 }, 3300).x;
    const jumpNext = ip.update(1, 13, { x: 3, y: 0 }, 3300).x;
    expect(jumpNext).toBeCloseTo(mid, 9);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });
  it('retain 으로 사라진 깃발 정리', () => {
    const ip = new FlagInterpolator();
    ip.update(1, 0, { x: 0, y: 0 }, 0);
    ip.retain(() => false);
    // 다시 나타나면 그 자리에서 시작
    expect(ip.update(1, 5, { x: 5, y: 0 }, 10)).toEqual({ x: 5, y: 0 });
  });
});

describe('발령 병력 비율', () => {
  it('풀 차감 ceil(troops × UNIT_CONVERT / MOB_CONVERT) 이 비율 몫을 넘지 않는다', () => {
    for (const pool of [0, 39, 150, 1234, 5000]) {
      for (const ratio of [0.1, 0.5, 1]) {
        for (const [uc, mc] of [
          [1000, 1000],
          [1150, 1000],
          [1150, 1220],
        ]) {
          const tr = troopsForRatio(pool, ratio, uc, mc);
          expect(Math.ceil((tr * uc) / mc)).toBeLessThanOrEqual(Math.floor(pool * ratio));
          expect(Math.ceil(((tr + 1) * uc) / mc)).toBeGreaterThan(Math.floor(pool * ratio));
        }
      }
    }
    expect(troopsForRatio(150, 0.5, 1150, 1000)).toBe(65);
  });
});

describe('커서 예고 (GDD 4.3)', () => {
  const config: S2C_MatchConfig = {
    type: 'match_config', seed: 1, topology: 'square', width: 20, height: 10, totalLandTiles: 100, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  };
  const m = new GameModel(config);
  const terrain = new Array(200).fill(1);
  terrain[0] = 0;
  terrain[15] = 6;
  m.apply({ type: 'map_init', terrain: rleEncode(terrain), spawns: [], bases: [] });
  const owners = new Array(200).fill(0);
  // 플레이어 1: 열 2..4, 플레이어 2: 열 6..7, 플레이어 3(동맹): 열 10
  for (let r = 0; r < 10; r++) {
    for (const c of [2, 3, 4]) owners[r * 20 + c] = 1;
    for (const c of [5, 6]) owners[r * 20 + c] = 2;
    owners[r * 20 + 10] = 3;
  }
  m.apply({
    type: 'snapshot_full', tick: 0, owners: rleEncode(owners), players: [], flags: [], bases: [], alliances: [{ a: 1, b: 3, state: 'ACTIVE', sinceTick: 0, breakAtTick: null }],
    allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9600, endgameRushActive: false,
  });
  const topo = new SquareTopologyView(20, 10);
  const field = topo.distanceField((t) => m.owners[t] === 1);
  it('내 땅 = 방어(푸른), 적 = 공격(붉은), 동맹·물 = 불가', () => {
    expect(computePreview(m, topo, 1, 5 * 20 + 3, field)!.kind).toBe('defend');
    const atk = computePreview(m, topo, 1, 5 * 20 + 5, field)!;
    expect(atk.kind).toBe('attack');
    // v4.2: 공격 원 폐기 — 공격 예고는 진격 경로·쟁기 회랑(route.ts, issueFlow.test)이고 원은 방어 보호 원만
    expect(atk.disk).toHaveLength(0);
    expect(atk.label).toContain('경로 옆');
    expect(computePreview(m, topo, 1, 5 * 20 + 3, field)!.disk.length).toBe(topo.disk(5 * 20 + 3, 6).length);
    expect(computePreview(m, topo, 1, 5 * 20 + 10, field)!.label).toContain('동맹');
    expect(computePreview(m, topo, 1, 15, field)!.kind).toBe('blocked');
    expect(computePreview(m, topo, 1, 5 * 20 + 15, field)!.kind).toBe('attack'); // 중립, 사거리 안
  });
});
