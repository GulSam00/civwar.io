/** 2차: 테크 표시·가격, 골드 수입, 판 길이 추정(서버 식과 동일), 이벤트 피드, 깃발 ETA */
import { describe, expect, it } from 'vitest';
import { MAP_SIZE_PRESETS, TECH_NODES, type MapSizeClass } from '@civwar/shared';
import { goldPerSecond, techCost, techNodes } from '../src/ui/techInfo.js';
import { estimatePacing, landOfRandom } from '../src/ui/pacing.js';
import { describeEvent, type FeedCtx } from '../src/state/feed.js';
import { GameModel } from '../src/state/gameModel.js';
import { pacingNote, defaultPrivateSettings } from '../../server/src/room/settings.js';

describe('테크', () => {
  // v4.3 (프로토콜 §19): 가격 = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + 60 × 보유 노드 수) / 1000)
  it('가격 = floor(BASE × (1000 + 60 × 총구매수) / 1000) (§19)', () => {
    expect(techCost(1, 0)).toBe(160);
    expect(techCost(1, 1)).toBe(169);
    expect(techCost(2, 8)).toBe(532);
    expect(techCost(3, 14)).toBe(1288);
  });
  it('노드 표는 match_config.constants.TECH_NODES 우선', () => {
    expect(techNodes()).toBe(TECH_NODES);
    const custom = [{ ...TECH_NODES[0], name: 'X' }];
    expect(techNodes({ TECH_NODES: custom })[0].name).toBe('X');
  });
  it('골드 수입 §8 (유지비 차감, ECO 노드 반영)', () => {
    const r = goldPerSecond(2700, 0, 0);
    expect(r.gross).toBeCloseTo((Math.floor((2700 * 2080 * 1000) / 1e9) * 5) / 1000, 9);
    const e = goldPerSecond(100000, 1 << 5, 0); // ECO-1 +8%
    expect(e.gross).toBeCloseTo((Math.floor((100000 * 2080 * 1080) / 1e9) * 5) / 1000, 9);
    const u = goldPerSecond(100000, 1 << 5, 300);
    expect(u.net).toBeLessThan(u.gross);
  });
});

describe('판 길이 추정 = 서버 pacingNote (무작위 맵)', () => {
  it('크기 × 인원 × 기본/비기본', () => {
    for (const size of ['S', 'M', 'L'] as MapSizeClass[]) {
      for (let n = 2; n <= MAP_SIZE_PRESETS[size].max; n++) {
        for (const diff of ['NORMAL', 'HARD'] as const) {
          const s = { ...defaultPrivateSettings(), map: { kind: 'random' as const, size, water: { waterMode: 0 as const, shallowPermille: 1000 } }, botDifficulty: diff };
          const server = pacingNote(s, n, null as never);
          const client = estimatePacing({ land: landOfRandom(size), players: n, defaultSetup: size === 'M' && diff === 'NORMAL' });
          expect(client).toBe(server);
        }
      }
    }
  });
});

describe('이벤트 피드', () => {
  const ctx: FeedCtx = { me: 1, nick: (id) => `P${id}`, flagOwner: (id) => (id < 10 ? 1 : 2), tickMs: 200 };
  it('전원 공지 / 나 관련만', () => {
    expect(describeEvent({ type: 'base_captured', tick: 5, tileId: 3, fromPlayerId: 1, toPlayerId: 2, newHpPct: 50 }, ctx)).toMatchObject({ important: true, toast: true });
    expect(describeEvent({ type: 'endgame_rush', tick: 8400, costMultPermille: 750 }, ctx)!.text).toContain('종반 러시');
    expect(describeEvent({ type: 'combat_started', tick: 1, groupKey: 1, flagIds: [11, 12], sides: [{ sideKey: 1, ownerIds: [2], troops: 1, power: 1 }, { sideKey: 2, ownerIds: [3], troops: 1, power: 1 }] }, ctx)).toBeNull();
    expect(describeEvent({ type: 'combat_started', tick: 1, groupKey: 1, flagIds: [1, 12], sides: [{ sideKey: 1, ownerIds: [1], troops: 1, power: 1 }, { sideKey: 2, ownerIds: [2], troops: 1, power: 1 }] }, ctx)!.text).toContain('P2');
    expect(describeEvent({ type: 'combat_ended', tick: 9, groupKey: 1, winnerSideKey: 2, routedFlagIds: [1] }, ctx)!.text).toContain('패주');
    expect(describeEvent({ type: 'flag_progress_lost', tick: 3, flagId: 2, tileId: 4, cause: 'decayed' }, ctx)!.text).toContain('감소');
    expect(describeEvent({ type: 'flag_progress_lost', tick: 3, flagId: 20, tileId: 4, cause: 'decayed' }, ctx)).toBeNull();
    expect(describeEvent({ type: 'ally_proposed', tick: 1, proposalId: 1, fromPlayerId: 3, toPlayerId: 1, expireTick: 151 }, ctx)).toMatchObject({ toast: true });
    expect(describeEvent({ type: 'snapshot_delta' } as never, ctx)).toBeNull();
  });
});

describe('깃발 ETA (표시 전용, 이벤트로만 유지)', () => {
  it('flag_issued 로 설정, flag_engaged 로 삭제, 재지정(auto=false) 갱신', () => {
    const m = new GameModel({
      type: 'match_config', seed: 1, topology: 'square', width: 2, height: 2, totalLandTiles: 4, tickMs: 200, hardTimeoutTick: 9600,
      endgameRush: { tick: 8400, costMultPermille: 750 },
      thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
      mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
    });
    m.apply({ type: 'map_init', terrain: [1, 4], spawns: [], bases: [] });
    m.apply({ type: 'snapshot_full', tick: 0, owners: [1, 1, 0, 3], players: [], flags: [], bases: [], alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9600, endgameRushActive: false });
    m.apply({ type: 'flag_issued', tick: 1, flagId: 1, playerId: 1, slotIndex: 0, unit: 1, posture: 0, troops: 50, originTileId: 0, anchorTileId: 3, targetOwnerId: 0, etaTick: 30, engageEtaTick: 28 });
    expect(m.flagEta.get(1)).toBe(28); // 교전 개시 추정(engageEtaTick) 우선
    m.apply({ type: 'flag_retargeted', tick: 5, flagId: 1, anchorTileId: 2, targetOwnerId: 0, posture: 0, resumeTick: 20, etaTick: 44, engageEtaTick: 40, auto: false });
    expect(m.flagEta.get(1)).toBe(40);
    m.apply({ type: 'flag_engaged', tick: 40, flagId: 1, posture: 0, frontTileCount: 2 });
    expect(m.flagEta.has(1)).toBe(false);
  });
});
