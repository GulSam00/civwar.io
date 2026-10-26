/**
 * 2026-10-18 UI 개선 (OpenFront.io 참고 — 1·2·3·4·6·7·9):
 *  병력 짧은 표기·영토 라벨 병력 줄 · 하단 병력 바 · 순위표 정렬/내 줄 고정 · 상단 대상 바(주인·관계) ·
 *  플레이어 정보 카드(allyBreaks 있음/없음·외교 버튼 규칙) · 로비 방 카드 · §23 세력 이름(isBot 판정)
 */
import { describe, expect, it } from 'vitest';
import { rleEncode, type PlayerSnapshot, type RoomListing, type S2C_RoomState, type S2C_SnapshotDelta } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { fmtCompact, fmtRate, ratioBudget, troopBarParts } from '../src/ui/fmt.js';
import { LABEL_SUB_MIN_PX, layoutTerritoryLabels, subSizePx } from '../src/render/territoryLabels.js';
import { allyBreaksOf, diplomacyAction, hoverTarget, leaderboardRows, playerCardData, relationTo, visibleLeaderRows } from '../src/ui/playerInfo.js';
import { roomCard, seedOf } from '../src/ui/roomCards.js';
import { randomPreviewTerrain } from '../src/render/mapPreview.js';

const W = 12;
const H = 6;
const id = (r: number, c: number) => r * W + c;
const CAP1 = id(1, 1);
const CAP2 = id(1, 6);
const CAP3 = id(4, 10);
const NEUTRAL_BASE = id(4, 5);
const BASES = [CAP1, CAP2, CAP3, NEUTRAL_BASE].sort((a, b) => a - b);

const delta = (tick: number, over: Partial<S2C_SnapshotDelta> = {}): S2C_SnapshotDelta => ({
  type: 'snapshot_delta', tick, tileChanges: [], playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [], ...over,
});

const player = (over: Partial<PlayerSnapshot> & { id: number }): PlayerSnapshot => ({
  tiles: 10, troops: 500, gold: 100, goldWeight: 10000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true, ...over,
});

/** 나(1) · 세력 이름 봇(2, 3) · 관전 여부 선택. players = snapshot_full.players */
function setup(players: PlayerSnapshot[], opts: { spectator?: boolean; alliances?: { a: number; b: number; state: 'ACTIVE' | 'BREAKING'; sinceTick: number; breakAtTick: number | null }[]; tick?: number } = {}) {
  const store = new ClientStore('ws://unused');
  (store as unknown as { socket: { send(m: unknown): boolean } }).socket.send = () => true;
  store.onMessage({ type: 'welcome', sessionId: opts.spectator ? 's_watch' : 's_me', playerToken: 'tok', serverTick: 0, protocolVersion: 1, tickMs: 200, resumed: false, officialMaps: [] });
  const room: S2C_RoomState = {
    type: 'room_state', roomId: 'r1', roomCode: 'ABCDEF', isPublic: false, phase: 'IN_GAME', hostId: 1,
    settings: { map: { kind: 'random', size: 'S' }, maxPlayers: 3, botCount: 2, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [2, 4], pacingNote: 'guaranteed', expectedPlayers: 3 },
    players: [
      { playerId: 1, sessionId: 's_me', nickname: 'alice', isBot: false, isHost: true, ready: true, status: 'PLAYING' },
      // §23: 봇 이름은 세력 이름 (공백 포함, 최대 16자) — 봇 판정은 isBot 으로만
      { playerId: 2, sessionId: null, nickname: '레이븐홀트 공국', isBot: true, isHost: false, ready: true, status: 'PLAYING' },
      { playerId: 3, sessionId: null, nickname: '북부 변경백령', isBot: true, isHost: false, ready: true, status: 'PLAYING' },
    ],
    spectatorCount: opts.spectator ? 1 : 0, countdownMs: null, autoStartMs: null,
  };
  store.onMessage(room);
  store.onMessage({
    type: 'match_config', seed: 1, topology: 'square', width: W, height: H, totalLandTiles: W * H, tickMs: 200, hardTimeoutTick: 9600,
    endgameRush: { tick: 8400, costMultPermille: 750 },
    thresholdCurve: { startPct: 60, decayStartTick: 4800, decayPerMinPermille: 1500, floorPct: 45, scale: 200 },
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {},
  });
  const terrain = new Array(W * H).fill(1);
  terrain[id(0, 11)] = 0; // 바다 한 칸
  store.onMessage({
    type: 'map_init', terrain: rleEncode(terrain),
    spawns: [{ playerId: 1, tileId: CAP1, homeTileId: CAP1 }, { playerId: 2, tileId: CAP2, homeTileId: CAP2 }, { playerId: 3, tileId: CAP3, homeTileId: CAP3 }],
    bases: BASES, baseNames: BASES.map((t) => `지명${t}`),
  });
  const owners: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) owners.push(r <= 2 && c <= 3 ? 1 : r <= 2 && c >= 5 && c <= 8 ? 2 : r >= 3 && c >= 8 ? 3 : 0);
  owners[id(0, 11)] = 0;
  store.onMessage({
    type: 'snapshot_full', tick: opts.tick ?? 100, owners: rleEncode(owners), players, flags: [],
    bases: [
      { tileId: CAP1, ownerId: 1, hpPct: 100, prodPm: 1000 },
      { tileId: CAP2, ownerId: 2, hpPct: 80, prodPm: 600 },
      { tileId: CAP3, ownerId: 3, hpPct: 100, prodPm: 1000 },
      { tileId: NEUTRAL_BASE, ownerId: 0, hpPct: 100, prodPm: 1000 },
    ],
    alliances: opts.alliances ?? [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9500, endgameRushActive: false,
  });
  return { store, g: store.game! };
}

const P3 = () => [
  player({ id: 1, tiles: 12, troops: 2550, gold: 40, allyBreaks: 0 }),
  player({ id: 2, tiles: 30, troops: 900, gold: 900, allyBreaks: 2 }),
  player({ id: 3, tiles: 20, troops: 17500, gold: 10, allyBreaks: 0 }),
];

// ───────────── 1·2. 병력 표기 ─────────────

describe('1·2 병력 짧은 표기 · 병력 바', () => {
  it('fmtCompact: 1000 미만은 정수, 이상은 유효숫자 3자리 버림 (K/M/B)', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(742.9)).toBe('742');
    expect(fmtCompact(2550)).toBe('2.55K');
    expect(fmtCompact(8180)).toBe('8.18K');
    expect(fmtCompact(17500)).toBe('17.5K');
    expect(fmtCompact(10000)).toBe('10K');
    expect(fmtCompact(100000)).toBe('100K');
    expect(fmtCompact(175400)).toBe('175K');
    expect(fmtCompact(999999)).toBe('999K'); // 반올림이면 1000K — 버림이라 자리 넘침 없음
    expect(fmtCompact(1234567)).toBe('1.23M');
    expect(fmtCompact(-2550)).toBe('−2.55K');
  });
  it('fmtRate: 10 미만 소수 한 자리, 이상은 짧은 표기', () => {
    expect(fmtRate(4.25)).toBe('+4.3/초');
    expect(fmtRate(520)).toBe('+520/초');
    expect(fmtRate(1234)).toBe('+1.23K/초');
  });
  it('병력 바: 채움 = 현재/상한 (0..100), 가득 참 표시, 회복 없으면 null', () => {
    expect(troopBarParts(8180, 17500, 520)).toEqual({ fillPct: (8180 * 100) / 17500, cur: '8.18K', cap: '17.5K', rate: '+520/초', full: false });
    expect(troopBarParts(20000, 17500, 5).fillPct).toBe(100);
    expect(troopBarParts(17500, 17500, 5).full).toBe(true);
    expect(troopBarParts(10, 0, null)).toMatchObject({ fillPct: 0, rate: null, full: false });
  });
  it('비율 옆 병력 = floor(풀 × 비율)', () => {
    expect(ratioBudget(1400, 0.3)).toBe(420);
    expect(ratioBudget(999, 0.5)).toBe(499);
    expect(ratioBudget(0, 1)).toBe(0);
  });
});

describe('1 영토 라벨 — 이름 아래 병력 줄', () => {
  const measure = (t: string, size: number) => t.length * size * 0.6;
  it('sub 를 주면 placed 에 병력 줄·크기가 실리고, 없으면 예전과 같다', () => {
    const anchors = [{ owner: 1, x: 100, y: 100, tiles: 900 }];
    const withSub = layoutTerritoryLabels(anchors, () => 'alice', (x, y) => ({ x, y }), 6, measure, { w: 800, h: 600 }, () => '2.55K');
    expect(withSub[0]).toMatchObject({ text: 'alice', sub: '2.55K', subSize: subSizePx(withSub[0].size) });
    const plain = layoutTerritoryLabels(anchors, () => 'alice', (x, y) => ({ x, y }), 6, measure, { w: 800, h: 600 });
    expect(plain[0].sub).toBeUndefined();
    expect(subSizePx(11)).toBe(LABEL_SUB_MIN_PX);
  });
  it('겹침 상자가 병력 줄까지 포함 — 바로 아래 이름은 줄여 보고 그래도 겹치면 생략', () => {
    const anchors = [
      { owner: 1, x: 100, y: 100, tiles: 2500 },
      { owner: 2, x: 100, y: 130, tiles: 1 }, // 이름 줄과는 안 겹치지만 1 의 병력 줄과 겹친다
    ];
    const noSub = layoutTerritoryLabels(anchors, () => 'AB', (x, y) => ({ x, y }), 20, measure, { w: 800, h: 600 });
    expect(noSub).toHaveLength(2);
    const sub = layoutTerritoryLabels(anchors, () => 'AB', (x, y) => ({ x, y }), 20, measure, { w: 800, h: 600 }, () => '17.5K');
    expect(sub.map((p) => p.owner)).toEqual([1]);
  });
  it('긴 세력 이름(§23, 공백 포함 16자)도 폭 계산에 그대로 들어간다', () => {
    const name = '세이블크레스트 상업동맹 연방'; // 16자 이하 공백 포함
    const placed = layoutTerritoryLabels([{ owner: 2, x: 400, y: 300, tiles: 400 }], () => name, (x, y) => ({ x, y }), 6, measure, { w: 800, h: 600 }, () => '900');
    expect(placed[0].text).toBe(name);
  });
});

// ───────────── 3. 순위표 ─────────────

describe('3 순위표 — 정렬 · 내 줄 고정', () => {
  it('기본 = 점유율 내림차순, 순위는 정렬 기준의 자리, 기지 수 집계, 봇은 isBot', () => {
    const { store, g } = setup(P3());
    const rows = leaderboardRows(g, store.names);
    expect(rows.map((r) => [r.rank, r.id])).toEqual([
      [1, 2],
      [2, 3],
      [3, 1],
    ]);
    expect(rows[0]).toMatchObject({ name: '레이븐홀트 공국', isBot: true, bases: 1, gold: 900, troops: 900 });
    expect(rows.find((r) => r.id === 1)!.isBot).toBe(false);
  });
  it('열 정렬: 병력·골드 내림/오름, 탈락자는 항상 맨 아래', () => {
    const ps = P3();
    ps.push(player({ id: 4, tiles: 0, troops: 99999, gold: 99999, alive: false }));
    const { store, g } = setup(ps);
    expect(leaderboardRows(g, store.names, 'troops').map((r) => r.id)).toEqual([3, 1, 2, 4]);
    expect(leaderboardRows(g, store.names, 'troops', false).map((r) => r.id)).toEqual([2, 1, 3, 4]);
    expect(leaderboardRows(g, store.names, 'gold').map((r) => r.id)).toEqual([2, 1, 3, 4]);
    expect(leaderboardRows(g, store.names, 'gold')[0].rank).toBe(1);
  });
  it('위 N 줄 밖이면 내 줄을 맨 아래 고정, 안이면 고정 없음, 관전(null)도 없음', () => {
    const { store, g } = setup(P3());
    const rows = leaderboardRows(g, store.names);
    expect(visibleLeaderRows(rows, 2, 1)).toEqual({ top: rows.slice(0, 2), pinned: rows[2] });
    expect(visibleLeaderRows(rows, 2, 1).pinned!.rank).toBe(3);
    expect(visibleLeaderRows(rows, 3, 1).pinned).toBeNull();
    expect(visibleLeaderRows(rows, 2, 2).pinned).toBeNull();
    expect(visibleLeaderRows(rows, 2, null).pinned).toBeNull();
  });
});

// ───────────── 4. 상단 대상 바 ─────────────

describe('4 상단 대상 바 — 주인 · 관계', () => {
  it('내 땅 = 나, 봇 땅 = 봇·적, 동맹 = 동맹, 중립 = 중립 기지 수, 물 = null', () => {
    const { store, g } = setup(P3(), { alliances: [{ a: 1, b: 3, state: 'ACTIVE', sinceTick: 10, breakAtTick: null }] });
    const me = store.myPlayerId;
    expect(me).toBe(1);
    expect(hoverTarget(g, id(0, 0), me, store.names)).toMatchObject({ kind: 'player', ownerId: 1, name: 'alice', relation: 'me', troops: 2550, gold: 40, bases: 1 });
    expect(hoverTarget(g, id(0, 6), me, store.names)).toMatchObject({ kind: 'bot', ownerId: 2, name: '레이븐홀트 공국', relation: 'enemy', troops: 900, gold: 900, bases: 1 });
    expect(hoverTarget(g, id(5, 11), me, store.names)).toMatchObject({ kind: 'bot', ownerId: 3, relation: 'ally' });
    expect(hoverTarget(g, id(5, 0), me, store.names)).toMatchObject({ kind: 'neutral', ownerId: 0, relation: 'neutral', troops: null, gold: null, bases: 1 });
    expect(hoverTarget(g, id(0, 11), me, store.names)).toBeNull(); // 바다
    expect(hoverTarget(g, -1, me, store.names)).toBeNull();
  });
  it('관전자에게 플레이어 관계는 없다(null), 중립은 중립', () => {
    const { store, g } = setup(P3(), { spectator: true });
    expect(store.myPlayerId).toBeNull();
    expect(hoverTarget(g, id(0, 0), null, store.names)!.relation).toBeNull();
    expect(relationTo(g, null, 0)).toBe('neutral');
  });
  it('서버 값이 바뀌면 다음 계산이 그대로 따른다 (델타 playerDeltas)', () => {
    const { store, g } = setup(P3());
    store.onMessage(delta(105, { playerDeltas: [{ id: 2, tiles: 30, troops: 1234, gold: 5, goldWeight: 1, upkeepPm: 0, techMask: 0 }] }));
    expect(hoverTarget(g, id(0, 6), 1, store.names)).toMatchObject({ troops: 1234, gold: 5 });
  });
});

// ───────────── 6. 플레이어 정보 카드 ─────────────

describe('6 플레이어 정보 카드', () => {
  it('기지(생산력·체력·지명)·테크 수·동맹 목록·allyBreaks', () => {
    const ps = P3();
    ps[1] = player({ id: 2, tiles: 30, troops: 900, gold: 900, techMask: 0b101, techCount: 2, allyBreaks: 2 });
    const { store, g } = setup(ps, { alliances: [{ a: 2, b: 3, state: 'BREAKING', sinceTick: 10, breakAtTick: 130 }] });
    const d = playerCardData(g, 2, 1, store.names)!;
    expect(d).toMatchObject({ id: 2, name: '레이븐홀트 공국', kind: 'bot', relation: 'enemy', techCount: 2, allyBreaks: 2, troopCap: g.troopCapOf(g.players.get(2)!) });
    expect(d.bases).toEqual([{ tileId: CAP2, name: `지명${CAP2}`, capital: true, hpPct: 80, prodPct: 60 }]);
    expect(d.allies).toEqual([{ id: 3, name: '북부 변경백령', breakingTicks: 30 }]);
  });
  it('allyBreaks 가 없으면 null (줄 숨김) · 숫자/배열 외 모양도 null', () => {
    const ps = P3().map(({ allyBreaks: _drop, ...p }) => p as PlayerSnapshot);
    const { store, g } = setup(ps);
    expect(playerCardData(g, 2, 1, store.names)!.allyBreaks).toBeNull();
    expect(allyBreaksOf(undefined)).toBeNull();
    expect(allyBreaksOf({ ...ps[0], allyBreaks: 'x' as unknown as number })).toBeNull();
    expect(allyBreaksOf({ ...ps[0], allyBreaks: [1, 2] as unknown as number })).toBe(2);
  });
  it('§23.2 allyBreaks 는 바뀐 델타에만 온다 — 없으면 이전 값 유지, 있으면 갱신', () => {
    const { store, g } = setup(P3());
    store.onMessage(delta(105, { playerDeltas: [{ id: 2, tiles: 30, troops: 900, gold: 900, goldWeight: 1, upkeepPm: 0, techMask: 0 }] }));
    expect(playerCardData(g, 2, 1, store.names)!.allyBreaks).toBe(2);
    store.onMessage(delta(110, { playerDeltas: [{ id: 2, tiles: 30, troops: 900, gold: 900, goldWeight: 1, upkeepPm: 0, techMask: 0, allyBreaks: 3 }] }));
    expect(playerCardData(g, 2, 1, store.names)!.allyBreaks).toBe(3);
  });
  it('없는 플레이어 = null', () => {
    const { store, g } = setup(P3());
    expect(playerCardData(g, 9, 1, store.names)).toBeNull();
  });
  it('외교 버튼: 제안 · 최소 유지 시간 전 파기 잠금 → 지나면 파기 · 해제 중 · 받은 제안 응답 · 관전/나/탈락은 없음', () => {
    const ps = P3();
    ps.push(player({ id: 4, tiles: 0, alive: false }));
    const { store, g } = setup(ps, { alliances: [{ a: 1, b: 3, state: 'ACTIVE', sinceTick: 90, breakAtTick: null }] });
    expect(diplomacyAction(g, 1, 2, true)).toEqual({ kind: 'propose', disabled: false, reason: null });
    const br = diplomacyAction(g, 1, 3, true);
    expect(br.kind).toBe('break');
    expect(br.kind === 'break' && br.disabled && br.waitTicks > 0).toBe(true);
    // 최소 유지 시간이 지나면 파기 가능
    store.onMessage(delta(100000));
    expect(diplomacyAction(g, 1, 3, true)).toMatchObject({ kind: 'break', disabled: false, waitTicks: 0 });
    // 이벤트는 tick 을 옮기지 않는다 (모델 tick = 100000) → 남은 tick = 151
    store.onMessage({ type: 'ally_break_started', tick: 100001, a: 1, b: 3, byPlayerId: 1, breakAtTick: 100151 });
    expect(diplomacyAction(g, 1, 3, true)).toEqual({ kind: 'breaking', breakTicks: 151 });
    store.onMessage({ type: 'ally_proposed', tick: 100001, proposalId: 7, fromPlayerId: 2, toPlayerId: 1, expireTick: 100151 });
    expect(diplomacyAction(g, 1, 2, true)).toEqual({ kind: 'respond', proposalId: 7, expireTicks: 151 });
    expect(diplomacyAction(g, null, 2, false).kind).toBe('none');
    expect(diplomacyAction(g, 1, 1, true).kind).toBe('none');
    expect(diplomacyAction(g, 1, 4, true)).toEqual({ kind: 'none', reason: '탈락한 플레이어입니다' });
  });
  it('신규 동맹 마감 뒤에는 제안 비활성 + 사유', () => {
    const { store, g } = setup(P3());
    store.onMessage(delta(9000));
    expect(diplomacyAction(g, 1, 2, true)).toEqual({ kind: 'propose', disabled: true, reason: '신규 동맹 마감됨' });
  });
});

// ───────────── 7. 로비 방 카드 ─────────────

describe('7 로비 방 카드', () => {
  const base: RoomListing = {
    roomId: 'room-a', phase: 'LOBBY', map: { kind: 'random', size: 'M' }, mapName: null, width: 100, height: 60, humans: 2, bots: 7, maxPlayers: 10,
    spectatorCount: 0, elapsedMs: 3000, autoStartMs: 20000, joinable: true, spectatable: false,
  };
  it('대기: 인원 n/최대, 크기, 자동 시작까지 남은 초(수신 후 경과 반영), 입장 가능', () => {
    const c = roomCard(base, 4500);
    expect(c).toMatchObject({ title: '무작위 맵', presetId: null, sizeText: '100×60 · 보통', players: 9, maxPlayers: 10, status: 'waiting', timeText: '16초 후 시작', joinable: true, spectatable: false, difficulty: null });
    expect(roomCard({ ...base, autoStartMs: null }, 0).timeText).toBeNull();
  });
  it('진행 중 → 관전, 경과 시간이 로컬로 흐른다 · 곧 시작 · 종료', () => {
    expect(roomCard({ ...base, phase: 'IN_GAME', elapsedMs: 271000, autoStartMs: null, joinable: false, spectatable: true }, 2000)).toMatchObject({ status: 'live', timeText: '진행 4:33', spectatable: true, joinable: false });
    expect(roomCard({ ...base, phase: 'COUNTDOWN', autoStartMs: null }, 0)).toMatchObject({ status: 'starting', timeText: null });
    expect(roomCard({ ...base, phase: 'GAME_OVER', elapsedMs: 1800000, autoStartMs: null }, 0)).toMatchObject({ status: 'over', timeText: '30:00 진행' });
  });
  it('공식 맵: 이름·썸네일 id·checksum·크기 등급, 봇 난이도(§26.1 — 필드 없는 옛 픽스처는 null)', () => {
    const r: RoomListing = { ...base, map: { kind: 'preset', mapId: 'isles' }, mapName: { ko: '군도', en: 'Isles' }, width: 108, height: 66 };
    const maps = [{ id: 'isles', name: { ko: '군도', en: 'Isles' }, sizeClass: 'L' as const, players: { min: 2, recommendedMin: 8, recommendedMax: 12, max: 12 }, checksum: 'sha256:x' }];
    expect(roomCard(r, 0, maps)).toMatchObject({ title: '군도', presetId: 'isles', checksum: 'sha256:x', sizeText: '108×66 · 큼', difficulty: null });
    expect(roomCard({ ...r, botDifficulty: 'HARD' }, 0, maps).difficulty).toBe('어려움');
  });
  it('무작위 썸네일: 같은 방 = 같은 그림, 가장자리는 바다, 지형 코드 범위', () => {
    const a = randomPreviewTerrain(seedOf('room-a'), 40, 24);
    const b = randomPreviewTerrain(seedOf('room-a'), 40, 24);
    const c = randomPreviewTerrain(seedOf('room-b'), 40, 24);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(a[0]).toBe(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(6);
    expect(Array.from(a).some((t) => t >= 1 && t <= 5)).toBe(true);
  });
});
