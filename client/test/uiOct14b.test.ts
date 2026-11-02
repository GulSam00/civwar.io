/**
 * 프로토콜 §21 연결 (2026-10-14 2차) — 기지 생산력 보간 · 지명 매핑 · 생산 내역 합 · 멸망·합병 피드/번쩍임.
 * 실제 와이어 shape(map_init.baseNames, snapshot_full.bases[].prodPm/production, 델타 baseProd/production,
 * base_captured.newProdPm, player_eliminated.annexedTiles)을 ClientStore 에 넣어 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { FLAG_BIT, POSTURE, rleEncode, type FlagSnapshot, type PlayerProduction, type S2C_RoomState, type S2C_SnapshotDelta } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { baseNameMap, interpBaseProd } from '../src/state/gameModel.js';
import { incomeOf, productionRows, sumRows } from '../src/ui/production.js';
import { terrainInfo } from '../src/ui/terrainInfo.js';
import { baseExtraOf } from '../src/ui/GameScreen.js';

const W = 10;
const H = 6;
const id = (r: number, c: number) => r * W + c;
const CAP1 = id(1, 1);
const BASE1B = id(4, 3);
const CAP2 = id(2, 8);
const BASES = [CAP1, CAP2, BASE1B].sort((a, b) => a - b); // tileId ASC (서버와 같은 순서)
const NAMES: Record<number, string> = { [CAP1]: '한울', [BASE1B]: '가람', [CAP2]: '누리' };

const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 7, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: id(2, 5), anchorTileId: id(2, 7),
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, orderCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null, ...over,
});

const delta = (tick: number, over: Partial<S2C_SnapshotDelta> = {}): S2C_SnapshotDelta => ({
  type: 'snapshot_delta', tick, tileChanges: [], playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [], ...over,
});

const PROD: PlayerProduction[] = [
  {
    playerId: 1,
    rows: [
      { kind: 'base', baseTileId: CAP1, tiles: 100, prodPm: 1000, troopsPerSecMilli: 4120, goldGrossPerSecMilli: 2950, goldNetPerSecMilli: 2270 },
      { kind: 'base', baseTileId: BASE1B, tiles: 60, prodPm: 500, troopsPerSecMilli: 845, goldGrossPerSecMilli: 610, goldNetPerSecMilli: 470 },
      { kind: 'territory', baseTileId: null, tiles: 30, prodPm: 1000, troopsPerSecMilli: 115, goldGrossPerSecMilli: 80, goldNetPerSecMilli: 61 },
    ],
  },
  { playerId: 2, rows: [{ kind: 'base', baseTileId: CAP2, tiles: 12, prodPm: 1000, troopsPerSecMilli: 3000, goldGrossPerSecMilli: 2000, goldNetPerSecMilli: 2000 }] },
];

function setup(flags: FlagSnapshot[] = []) {
  const store = new ClientStore('ws://unused');
  (store as unknown as { socket: { send(m: unknown): boolean } }).socket.send = () => true;
  store.onMessage({ type: 'welcome', sessionId: 's_me', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
  const room: S2C_RoomState = {
    type: 'room_state', roomId: 'r1', roomCode: 'ABCDEF', isPublic: false, phase: 'IN_GAME', hostId: 1,
    settings: { map: { kind: 'random', size: 'S' }, maxPlayers: 2, botCount: 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [2, 4], pacingNote: 'guaranteed', expectedPlayers: 2 },
    players: [
      { playerId: 1, sessionId: 's_me', nickname: 'me', isBot: false, isHost: true, ready: true, status: 'PLAYING' },
      { playerId: 2, sessionId: null, nickname: 'BOT 2', isBot: true, isHost: false, ready: true, status: 'PLAYING' },
    ],
    spectatorCount: 0, countdownMs: null, autoStartMs: null,
  };
  store.onMessage(room);
  store.onMessage({
    type: 'match_config', seed: 1, topology: 'square', width: W, height: H, totalLandTiles: W * H, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  });
  store.onMessage({
    type: 'map_init', terrain: rleEncode(new Array(W * H).fill(1)),
    spawns: [{ playerId: 1, tileId: CAP1, homeTileId: CAP1 }, { playerId: 2, tileId: CAP2, homeTileId: CAP2 }],
    bases: BASES, baseNames: BASES.map((t) => NAMES[t]),
  });
  const owners: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) owners.push(c <= 4 ? 1 : c >= 7 ? 2 : 0);
  store.onMessage({
    type: 'snapshot_full', tick: 100, owners: rleEncode(owners),
    players: [
      { id: 1, tiles: 30, troops: 1000, gold: 0, goldWeight: 100000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
      { id: 2, tiles: 18, troops: 1000, gold: 0, goldWeight: 100000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
    ],
    flags,
    bases: [
      { tileId: CAP1, ownerId: 1, hpPct: 100, prodPm: 1000 },
      { tileId: BASE1B, ownerId: 1, hpPct: 50, prodPm: 500 },
      { tileId: CAP2, ownerId: 2, hpPct: 100, prodPm: 1000 },
    ],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9500, endgameRushActive: false,
    production: PROD,
  });
  return { store, g: store.game! };
}

describe('§21.4 기지 생산력 바 — 보간', () => {
  it('interpBaseProd: 분당 167‰ × tickMs/60000 = tick 당 167/300‰, 상한 1000, 경과 음수 = 0', () => {
    expect(interpBaseProd(500, 0, 200, 167, 1000)).toBe(500);
    expect(interpBaseProd(500, 300, 200, 167, 1000)).toBeCloseTo(667, 6); // 300 tick = 1분 → +167
    expect(interpBaseProd(500, 1.5, 200, 167, 1000)).toBeCloseTo(500 + 1.5 * (167 / 300), 9); // tick 사이 소수 보간
    expect(interpBaseProd(990, 10000, 200, 167, 1000)).toBe(1000);
    expect(interpBaseProd(1000, 50, 200, 167, 1000)).toBe(1000);
    expect(interpBaseProd(250, -3, 200, 167, 1000)).toBe(250);
  });

  it('snapshot_full prodPm → 보간 → 델타 baseProd 가 서버 값으로 다시 맞춘다 (권위)', () => {
    const { store, g } = setup();
    expect(g.baseProdPm(BASE1B, 100)).toBe(500);
    expect(g.baseProdPm(BASE1B, 105.5)).toBeCloseTo(500 + 5.5 * (167 / 300), 9);
    expect(g.baseProdPm(CAP1, 200)).toBe(1000);
    store.onMessage(delta(105, { baseProd: [[BASE1B, 502]] }));
    expect(g.baseProdPm(BASE1B)).toBe(502);
    expect(g.bases.get(BASE1B)!.prodPm).toBe(502);
    expect(g.baseProdPm(BASE1B, 106)).toBeCloseTo(502 + 167 / 300, 9);
  });

  it('점령 직후 = base_captured.newProdPm (50% → 25%), 바는 그 값에서 다시 차오른다', () => {
    const { store, g } = setup();
    store.onMessage({ type: 'base_captured', tick: 110, tileId: CAP1, fromPlayerId: 1, toPlayerId: 2, newHpPct: 50, newProdPm: 500 });
    expect(g.baseProdPm(CAP1, 110)).toBe(500);
    store.onMessage({ type: 'base_captured', tick: 111, tileId: CAP1, fromPlayerId: 2, toPlayerId: 1, newHpPct: 50, newProdPm: 250 });
    expect(g.baseProdPm(CAP1, 111)).toBe(250);
    expect(g.baseProdPm(CAP1, 111 + 300)).toBeCloseTo(417, 6);
  });

  it('renderTick: 마지막 tick + 경과/tickMs (한 tick 이상 앞서지 않음)', () => {
    const { g } = setup();
    let now = 1000;
    g.clock = () => now;
    g.tickReceivedAt = 1000;
    now = 1100;
    expect(g.renderTick()).toBeCloseTo(100.5, 9);
    now = 5000;
    expect(g.renderTick()).toBe(101);
  });

  it('baseExtraOf: 회복 중(< 100%)만 생산력 바, 지명은 항상', () => {
    const { g } = setup();
    const ex = baseExtraOf(g, 100);
    expect(ex(BASE1B)).toEqual({ name: '가람', productivityPct: 50 });
    expect(ex(CAP1)).toEqual({ name: '한울', productivityPct: undefined });
    expect(ex(id(0, 0))).toEqual({ name: undefined, productivityPct: undefined });
  });
});

describe('§21.5 지명', () => {
  it('map_init.baseNames[i] = bases[i] (tileId 매핑), 길이가 모자라면 있는 만큼', () => {
    const { g } = setup();
    expect(g.baseNames.get(CAP1)).toBe('한울');
    expect(g.baseNames.get(BASE1B)).toBe('가람');
    expect(g.baseNames.get(CAP2)).toBe('누리');
    expect([...baseNameMap([5, 9, 12], ['a', 'b'])]).toEqual([
      [5, 'a'],
      [9, 'b'],
    ]);
    expect(baseNameMap([5], undefined).size).toBe(0);
  });

  it('지형 툴팁: 지명 · 체력 · 생산력 행', () => {
    const { g } = setup();
    const rows = terrainInfo(g, BASE1B, 1, (n) => `P${n}`)!.rows.filter((r) => r.field === 'baseHp');
    expect(rows).toEqual([
      { field: 'baseHp', label: '기지', value: '가람' },
      { field: 'baseHp', label: '기지 체력', value: '50%' },
      { field: 'baseHp', label: '생산력', value: '50% (회복 중)' },
    ]);
    expect(terrainInfo(g, CAP1, 1, (n) => `P${n}`)!.base).toBe('수도 한울 · 체력 100%');
  });

  it('피드: 기지 함락에 지명', () => {
    const { store } = setup();
    store.onMessage({ type: 'base_captured', tick: 110, tileId: BASE1B, fromPlayerId: 1, toPlayerId: 2, newHpPct: 50, newProdPm: 250 });
    expect(store.feed.at(-1)!.text).toBe('가람 함락 — BOT 2가 나의 기지를 점령');
    store.onMessage({ type: 'base_captured', tick: 111, tileId: CAP2, fromPlayerId: 2, toPlayerId: 1, newHpPct: 50, newProdPm: 500 });
    expect(store.feed.at(-1)!.text).toBe('누리 함락 — 내가 BOT 2의 수도를 점령');
  });
});

describe('§21.4 병력·골드 출처 (production)', () => {
  it('행 합 = 총합 (병력·순골드), 기지는 많은 순·영토 맨 끝, 생산력 %', () => {
    const { g } = setup();
    const regions = g.production.get(1)!;
    const total = sumRows(regions);
    const troops = productionRows(regions, 'troops', (t) => g.baseNames.get(t), (t) => g.capitalTiles.has(t));
    const gold = productionRows(regions, 'gold', (t) => g.baseNames.get(t), (t) => g.capitalTiles.has(t));
    expect(troops.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(total.troopsMilli / 1000, 9);
    expect(gold.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(total.netMilli / 1000, 9);
    expect(troops.map((r) => [r.label, r.prodPct, r.capital ?? false])).toEqual([
      ['한울', 100, true],
      ['가람', 50, false],
      ['영토', null, false],
    ]);
    expect(gold[1]).toMatchObject({ label: '가람', amount: 0.47, tiles: 60, kind: 'base' });
    expect(gold[2]).toMatchObject({ kind: 'territory', label: '영토', prodPct: null, tiles: 30 });
  });

  it('수입 표시 = production 합 (생산력 반영) — 예전 goldWeight 식은 과대 추정', () => {
    const { g } = setup();
    const inc = incomeOf(g, 1)!;
    expect(inc.fromServer).toBe(true);
    expect(inc.net).toBeCloseTo(2.801, 9);
    expect(inc.gross).toBeCloseTo(3.64, 9);
    expect(inc.troops).toBeCloseTo(5.08, 9);
  });

  it('델타 production = 바뀐 플레이어만 통째 교체, 표가 없으면 예전 식으로 대신', () => {
    const { store, g } = setup();
    store.onMessage(delta(105, { production: [{ playerId: 2, rows: [{ kind: 'base', baseTileId: CAP2, tiles: 12, prodPm: 1000, troopsPerSecMilli: 1, goldGrossPerSecMilli: 1000, goldNetPerSecMilli: 900 }] }] }));
    expect(incomeOf(g, 2)!.net).toBeCloseTo(0.9, 9);
    expect(incomeOf(g, 1)!.net).toBeCloseTo(2.801, 9); // 그대로
    g.production.delete(1);
    expect(incomeOf(g, 1)!.fromServer).toBe(false);
  });
});

// v4.6 (§27): §21.2 대기 태세(pendingPosture · 델타 비트 128)는 서버에서 제거됨 — 대체 검증은 postureV46.test.ts (즉시 전환 규칙).

describe('§21.3 멸망·합병', () => {
  it('피드 "멸망 — 합병", 같은 tick tileChanges 의 넘어간 칸을 번쩍임 목록에 모은다, 생산 내역 비움', () => {
    const { store, g } = setup();
    store.onMessage({ type: 'player_eliminated', tick: 200, playerId: 2, byPlayerId: 1, annexedTiles: 3 });
    expect(store.feed.at(-1)!.text).toBe('BOT 2 멸망 — 내가 남은 3칸을 합병');
    expect(g.production.get(2)).toEqual([]);
    expect(g.annexFlashes).toHaveLength(1);
    store.onMessage(delta(200, { tileChanges: [[id(0, 8), 1], [id(1, 8), 1], [id(2, 9), 1], [id(5, 5), 2]] }));
    expect(g.annexFlashes[0].tiles).toEqual([id(0, 8), id(1, 8), id(2, 9)]);
    expect(g.owners[id(0, 8)]).toBe(1);
  });

  it('합병 대상이 없으면 "남은 땅은 중립으로", 번쩍임 없음', () => {
    const { store, g } = setup();
    store.onMessage({ type: 'player_eliminated', tick: 200, playerId: 2, byPlayerId: null, annexedTiles: 0 });
    expect(store.feed.at(-1)!.text).toBe('BOT 2 멸망 — 남은 땅은 중립으로');
    expect(g.annexFlashes).toHaveLength(0);
  });
});
