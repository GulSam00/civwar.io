/**
 * 병종 고리 / 좌클릭 카드 (2026-10-22 조작 변경). input/unitRing.ts 규칙 + controller.ts 상태 전이.
 *  - 우클릭(내 부대 선택 없음) = 칸 둘레 병종 고리 (창/검/기병, 현재 비율 병력, 1/2/3), 내 땅 = 방어, 적/중립 = 공격
 *  - 내 부대 선택 + 우클릭 = 이동 (issueFlow.test)
 *  - 좌클릭 우선순위: 내 깃발 > 내 기지(깃발 미선택 = 조준) > 남의 깃발 > 소유자 카드, 중립/물은 무반응
 * 맵/소켓 가로채기는 issueFlow.test 와 같다 (화면 좌표 = 타일 ID).
 */
import { describe, expect, it } from 'vitest';
import { POSTURE, rleEncode, type FlagSnapshot, type S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { GameRenderer } from '../src/render/renderer.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameInputController, Interaction } from '../src/input/controller.js';
import { allianceKey } from '../src/state/gameModel.js';
import { RING_EXTENT, RING_R, RING_UNIT_ANGLES, clampRingCenter, polar, ringScale } from '../src/input/unitRing.js';

const W = 10;
const H = 6;
const id = (r: number, c: number) => r * W + c;

/**
 * 10×6. 내 땅(1) = 0..3열, 적(2) = 8..9열, 그 사이 중립.
 * 내 기지 A = (1,0), B = (4,3). 적 기지 = (2,9). 산(5) 벽 = 6열의 1..4행 (0·5행만 열림)
 */
function terrain(): number[] {
  const t: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) t.push(c === 6 && r >= 1 && r <= 4 ? 5 : 1);
  return t;
}
function owners(): number[] {
  const o: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) o.push(c <= 3 ? 1 : c >= 8 ? 2 : 0);
  return o;
}
const BASE_A = id(1, 0);
const BASE_B = id(4, 3);
const ENEMY_BASE = id(2, 9);

const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 7, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: id(2, 5), anchorTileId: id(2, 7),
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, orderCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, ...over,
});

function setup(flags: FlagSnapshot[] = []) {
  const store = new ClientStore('ws://unused');
  const sent: Record<string, unknown>[] = [];
  (store as unknown as { socket: { send(m: unknown): boolean } }).socket.send = (m: unknown) => (sent.push(m as Record<string, unknown>), true);
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
  store.onMessage({ type: 'map_init', terrain: rleEncode(terrain()), spawns: [{ playerId: 1, tileId: BASE_A, homeTileId: BASE_A }], bases: [BASE_A, BASE_B, ENEMY_BASE] });
  store.onMessage({
    type: 'snapshot_full', tick: 25, owners: rleEncode(owners()),
    players: [
      { id: 1, tiles: 24, troops: 1000, gold: 0, goldWeight: 1000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
      { id: 2, tiles: 12, troops: 1000, gold: 0, goldWeight: 1000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
    ],
    flags,
    bases: [
      { tileId: BASE_A, ownerId: 1, hpPct: 100 },
      { tileId: BASE_B, ownerId: 1, hpPct: 100 },
      { tileId: ENEMY_BASE, ownerId: 2, hpPct: 100 },
    ],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9575, endgameRushActive: false,
  });
  expect(store.myPlayerId).toBe(1);
  expect(store.game?.ready).toBe(true);
  const renderer = new GameRenderer({} as HTMLCanvasElement);
  renderer.topo = createTopologyView('square', W, H);
  const ix = new Interaction();
  const ctl = new GameInputController({} as HTMLCanvasElement, renderer, store, ix);
  // 화면 좌표 = 타일 ID (카메라 변환은 render.test 가 따로 검증)
  ctl.pixelToTileId = (sx: number) => sx;
  let flagHit: number | null = null;
  renderer.flagAt = () => flagHit;
  const cmds = () => sent.filter((m) => String(m.type).startsWith('cmd_'));
  return { store, ctl, ix, cmds, setFlagHit: (v: number | null) => (flagHit = v) };
}

const key = (ctl: GameInputController, k: string) =>
  (ctl as unknown as { onKeyDown(e: Partial<KeyboardEvent>): void }).onKeyDown({ key: k, target: null, preventDefault() {} });

const ENEMY = id(2, 8);
const NEUTRAL = id(4, 6);
const MY_LAND = id(3, 2);

describe('병종 고리 - 규칙', () => {
  it('적 땅 = 공격, 중립 = 공격, 내 땅 = 방어 - 병종 3개, 병력은 현재 비율 기준', () => {
    const { ctl } = setup();
    ctl.rightClickTile(ENEMY);
    let m = ctl.ringModel()!;
    expect(m).toMatchObject({ kind: 'attack', label: '공격', ownerId: 2, reason: null });
    expect(m.units.map((u) => u.unit)).toEqual([0, 1, 2]);
    expect(m.units.every((u) => !u.disabled && u.troops === ctl.troopsToSend(u.unit))).toBe(true);
    expect(m.base).toBe(ctl.nearestBaseFor(ENEMY));
    ctl.cancelIssue();
    ctl.rightClickTile(NEUTRAL);
    expect(ctl.ringModel()).toMatchObject({ kind: 'attack', ownerId: 0 });
    ctl.cancelIssue();
    ctl.rightClickTile(MY_LAND);
    m = ctl.ringModel()!;
    expect(m).toMatchObject({ kind: 'defend', label: '방어', ownerId: 1 });
    ctl.cancelIssue();
    // 비율을 바꾸면 고리의 병력도 바뀐다
    const before = ctl.troopsToSend(1);
    ctl.setRatio(0.2);
    expect(ctl.troopsToSend(1)).toBeLessThan(before);
    ctl.rightClickTile(ENEMY);
    expect(ctl.ringModel()!.units[1].troops).toBe(ctl.troopsToSend(1));
  });

  it('물 / 동맹 영토 = 지정 불가 (세 병종 모두 비활성 + 이유)', () => {
    const { ctl, store } = setup();
    const g = store.game!;
    g.terrain![id(0, 5)] = 0; // 깊은 물
    ctl.rightClickTile(id(0, 5));
    expect(ctl.ringModel()).toMatchObject({ kind: 'blocked', label: '지정 불가', land: false });
    expect(ctl.ringModel()!.units.every((u) => u.disabled && u.reason)).toBe(true);
    ctl.cancelIssue();
    g.alliances.set(allianceKey(1, 2), { a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    ctl.rightClickTile(ENEMY);
    expect(ctl.ringModel()).toMatchObject({ kind: 'blocked', reason: '동맹 영토입니다' });
  });

  it('병력이 최소 미만이면 그 병종만 비활성(눌러도 고리 유지), 깃발 슬롯이 꽉 차면 전부 비활성', () => {
    const { ctl, store, cmds } = setup();
    store.game!.players.get(1)!.troops = 90;
    ctl.setRatio(0.4);
    ctl.rightClickTile(ENEMY);
    const m = ctl.ringModel()!;
    for (const u of m.units) expect(u.disabled).toBe(u.troops < 40);
    const bad = m.units.find((u) => u.disabled);
    if (bad) {
      ctl.chooseUnit(bad.unit);
      expect(cmds()).toHaveLength(0);
      expect(ctl.ix.issue?.phase).toBe('pick');
    }
    ctl.cancelIssue();
    store.game!.players.get(1)!.troops = 1000;
    ctl.setRatio(0.5);
    store.game!.players.get(1)!.flagCap = 0;
    ctl.rightClickTile(ENEMY);
    expect(ctl.ringModel()!.units.every((u) => u.disabled && /슬롯/.test(u.reason ?? ''))).toBe(true);
  });

  it('내 기지가 하나도 없으면 고리는 뜨되 전부 비활성', () => {
    const { ctl, store, cmds } = setup();
    for (const b of store.game!.bases.values()) if (b.ownerId === 1) b.ownerId = 2;
    ctl.rightClickTile(ENEMY);
    expect(ctl.ringModel()!.units.every((u) => u.disabled && u.reason === '출전할 내 기지가 없습니다')).toBe(true);
    ctl.chooseUnit(0);
    expect(cmds()).toHaveLength(0);
  });

  it('고리가 떠 있는 동안 출발 기지를 잃으면 가장 가까운 다른 내 기지로 바꿔 발령한다', () => {
    const { ctl, store, cmds } = setup();
    ctl.rightClickTile(id(4, 6));
    expect(ctl.ix.issue).toMatchObject({ base: BASE_B });
    store.game!.bases.get(BASE_B)!.ownerId = 2;
    ctl.chooseUnit(0);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', originBaseTileId: BASE_A });
  });
});

describe('병종 고리 - 열고 닫기', () => {
  it('선택 없음 = 고리, 내 부대 선택 = 이동(고리 없음), 남의 부대 선택 = 고리', () => {
    const { ctl, ix, cmds } = setup([flag({ id: 7 }), flag({ id: 8, ownerId: 2, slotIndex: 0, posTileId: id(2, 7) })]);
    expect(ctl.rightClickTile(ENEMY)).toBe('ring');
    expect(ix.issue).toMatchObject({ phase: 'pick', anchor: ENEMY, posture: 'attack' });
    expect(cmds()).toHaveLength(0);
    ctl.cancelIssue();
    ix.selectedFlagId = 7;
    expect(ctl.rightClickTile(ENEMY)).toBe('move');
    expect(ix.issue).toBeNull();
    ix.selectedFlagId = 8;
    expect(ctl.rightClickTile(NEUTRAL)).toBe('ring');
    expect(ix.selectedFlagId).toBeNull();
  });

  it('맵 밖 / 관전에서는 열지 않는다', () => {
    const { ctl, ix, store } = setup();
    expect(ctl.rightClickTile(-1)).toBeNull();
    expect(ix.issue).toBeNull();
    store.spectating = true;
    expect(ctl.rightClickTile(ENEMY)).toBeNull();
    expect(ix.issue).toBeNull();
  });

  it('닫기: 다시 우클릭 / Esc / 바깥(맵) 좌클릭 - 좌클릭은 다른 동작을 하지 않는다', () => {
    const { ctl, ix } = setup();
    ctl.rightClickTile(ENEMY);
    expect(ctl.rightClickTile(NEUTRAL)).toBeNull();
    expect(ix.issue).toBeNull();
    ctl.rightClickTile(ENEMY);
    key(ctl, 'Escape');
    expect(ix.issue).toBeNull();
    ctl.rightClickTile(NEUTRAL);
    ctl.click(ENEMY, 0);
    expect(ix.issue).toBeNull();
    expect(ix.cardPlayerId).toBeNull();
  });

  it('Esc 는 고리만 먼저 닫고 도움말은 남긴다', () => {
    const { ctl, ix } = setup();
    ix.helpOpen = true;
    ctl.rightClickTile(ENEMY);
    key(ctl, 'Escape');
    expect(ix.issue).toBeNull();
    expect(ix.helpOpen).toBe(true);
  });
});

describe('병종 고리 - 발령', () => {
  it('v5.6: 가운데·F 로 출전 태세를 바꾸면 그 태세로 발령한다 (처음 값은 땅 기준)', () => {
    const { ctl, cmds } = setup();
    ctl.rightClickTile(MY_LAND);
    expect(ctl.ringModel()).toMatchObject({ kind: 'defend', label: '방어' });
    ctl.toggleIssuePosture();
    expect(ctl.ringModel()).toMatchObject({ kind: 'attack', label: '공격' });
    key(ctl, 'f');
    expect(ctl.ringModel()).toMatchObject({ kind: 'defend' });
    key(ctl, 'f');
    key(ctl, '1');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', anchorTileId: MY_LAND, posture: POSTURE.ATTACK });
  });

  it('v5.6: 적 땅 기본값은 공격, 방어로 바꿔 발령할 수 있다', () => {
    const { ctl, cmds } = setup();
    ctl.rightClickTile(ENEMY);
    expect(ctl.ringModel()).toMatchObject({ kind: 'attack' });
    ctl.toggleIssuePosture();
    ctl.chooseUnit(0);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', anchorTileId: ENEMY, posture: POSTURE.DEFEND });
  });

  it('적 땅: 3 키 = 기병 cmd_flag_issue (originBaseTileId = 최근접 내 기지)', () => {
    const { ctl, ix, cmds } = setup();
    ctl.rightClickTile(ENEMY);
    const origin = ctl.nearestBaseFor(ENEMY); // 보낸 뒤에는 그 기지가 잠깐 출전 준비 중으로 보인다 (v5.1) → 보내기 전에 읽는다
    key(ctl, '3');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 2, anchorTileId: ENEMY, originBaseTileId: origin });
    expect(cmds()[0].troops).toBeGreaterThanOrEqual(40);
    expect(ix.issue).toBeNull();
  });

  it('내 땅: 방어 고리, 앵커 = 내 땅', () => {
    const { ctl, cmds } = setup();
    ctl.rightClickTile(MY_LAND);
    ctl.chooseUnit(0);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 0, anchorTileId: MY_LAND });
  });

  it('숫자 키는 고리가 떠 있을 때만', () => {
    const { ctl, cmds } = setup();
    key(ctl, '1');
    expect(cmds()).toHaveLength(0);
  });
});

describe('좌클릭 우선순위 / 카드', () => {
  it('누군가의 영토 = 그 플레이어 카드, 중립 = 무반응', () => {
    const { ctl, ix } = setup();
    ctl.click(ENEMY, 0);
    expect(ix.cardPlayerId).toBe(2);
    ctl.click(MY_LAND, 0);
    expect(ix.cardPlayerId).toBe(1);
    ix.cardPlayerId = null;
    ctl.click(NEUTRAL, 0);
    expect(ix.cardPlayerId).toBeNull();
    expect(ix.issue).toBeNull();
    ctl.click(ENEMY_BASE, 0);
    expect(ix.cardPlayerId).toBe(2);
  });

  it('내 깃발 선택 중 좌클릭: 깃발이면 그 깃발 선택, 아니면 선택 해제만 (카드/조준 없음)', () => {
    const { ctl, ix, setFlagHit } = setup([flag({ id: 7 }), flag({ id: 8, slotIndex: 1, posTileId: id(0, 5) })]);
    ix.selectedFlagId = 7;
    setFlagHit(8);
    ctl.click(id(0, 5), 0);
    expect(ix.selectedFlagId).toBe(8);
    setFlagHit(null);
    ctl.click(BASE_B, 0);
    expect(ix.selectedFlagId).toBeNull();
    expect(ix.issue).toBeNull();
    expect(ix.cardPlayerId).toBeNull();
    ctl.click(BASE_B, 0); // 선택이 없으면 내 기지 = 조준
    expect(ix.issue).toEqual({ phase: 'aim', base: BASE_B });
  });

  it('남의 깃발 클릭 = 그 깃발 선택(정보), 소유자 카드보다 우선', () => {
    const { ctl, ix, setFlagHit } = setup([flag({ id: 8, ownerId: 2, slotIndex: 0, posTileId: ENEMY })]);
    setFlagHit(8);
    ctl.click(ENEMY, 0);
    expect(ix.selectedFlagId).toBe(8);
    expect(ix.cardPlayerId).toBeNull();
  });

  it('내 기지 좌클릭 = 조준 (카드 아님)', () => {
    const { ctl, ix } = setup();
    ctl.click(BASE_A, 0);
    expect(ix.issue).toEqual({ phase: 'aim', base: BASE_A });
    expect(ix.cardPlayerId).toBeNull();
  });

  it('관전 중 내 기지 클릭 = 조준 대신 소유자 카드', () => {
    const { ctl, ix, store } = setup();
    store.spectating = true;
    ctl.click(BASE_A, 0);
    expect(ix.issue).toBeNull();
    expect(ix.cardPlayerId).toBe(1);
  });
});

describe('조준 흐름 + 같은 고리', () => {
  it('내 기지 -> 조준 -> 지점 -> 같은 병종 고리 (기지 고정)', () => {
    const { ctl, ix, cmds } = setup();
    ctl.click(BASE_A, 0);
    ctl.click(ENEMY, 0);
    expect(ix.issue).toMatchObject({ phase: 'pick', base: BASE_A, anchor: ENEMY, posture: 'attack' });
    expect(ctl.ringModel()).toMatchObject({ kind: 'attack', base: BASE_A });
    key(ctl, '2');
    expect(cmds()[0]).toMatchObject({ unit: 1, anchorTileId: ENEMY, originBaseTileId: BASE_A });
  });

  it('조준 중 우클릭 / Esc = 취소', () => {
    const { ctl, ix } = setup();
    ctl.click(BASE_A, 0);
    ctl.rightClickTile(ENEMY);
    expect(ix.issue).toBeNull();
    ctl.click(BASE_A, 0);
    key(ctl, 'Escape');
    expect(ix.issue).toBeNull();
  });
});

describe('고리 배치 (화면 좌표)', () => {
  it('세 병종 각도는 위(창) / 왼쪽 아래(검) / 오른쪽 아래(기병)이고 겹치지 않는다', () => {
    const pts = RING_UNIT_ANGLES.map((a) => polar(RING_R, a));
    expect(pts[0].y).toBeLessThan(0);
    expect(pts[1].x).toBeLessThan(0);
    expect(pts[2].x).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(64);
  });

  it('가장자리에서는 고리 전체가 보이게 안쪽으로 당기고, 작은 화면은 가운데 / 배율 축소', () => {
    expect(clampRingCenter(5, 5, 1000, 800, RING_EXTENT, 6, 48)).toEqual({ x: RING_EXTENT + 6, y: 48 + RING_EXTENT + 6 });
    expect(clampRingCenter(995, 795, 1000, 800, RING_EXTENT, 6, 48)).toEqual({ x: 1000 - RING_EXTENT - 6, y: 800 - RING_EXTENT - 6 });
    expect(clampRingCenter(500, 400, 1000, 800, RING_EXTENT)).toEqual({ x: 500, y: 400 });
    expect(clampRingCenter(10, 10, 200, 200, RING_EXTENT)).toEqual({ x: 100, y: 100 });
    expect(ringScale(1920, 1080)).toBe(1);
    expect(ringScale(400, 300)).toBe(0.7);
  });
});
