/**
 * 우클릭 원형 메뉴 (2026-10-18 — OpenFront.io 참고). input/contextMenu.ts 판정 + controller.ts 상태 전이.
 *  - 내 부대가 선택돼 있지 않을 때만 열린다 (선택 + 우클릭 = 이동 그대로, 2026-10-14)
 *  - 내 땅·내 기지·적·중립 칸별 항목, 비활성 이유, 가운데 → 병종 고리 → cmd_flag_issue, 수비 배치, Esc·바깥 클릭·다시 우클릭 닫기
 * 맵·소켓 가로채기는 issueFlow.test 와 같다 (화면 좌표 = 타일 ID).
 */
import { describe, expect, it } from 'vitest';
import { POSTURE, rleEncode, type FlagSnapshot, type S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { GameRenderer } from '../src/render/renderer.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameInputController, Interaction } from '../src/input/controller.js';
import { bestDefender, clampRingCenter, contextMenuModel, ctxExtent } from '../src/input/contextMenu.js';

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
  disengaging: false, postureCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, ...over,
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

const seg = (ctl: GameInputController, sid: string) => ctl.contextMenu()!.segments.find((s) => s.id === sid);
const segIds = (ctl: GameInputController) => ctl.contextMenu()!.segments.map((s) => s.id);
const ENEMY = id(2, 8);
const NEUTRAL = id(4, 6);
const MY_LAND = id(3, 2);

describe('우클릭 원형 메뉴 — 여는 조건', () => {
  it('선택 없음 = 원형 메뉴, 내 부대 선택 = 이동(메뉴 안 열림), 남의 부대 선택 = 원형 메뉴', () => {
    const { ctl, ix, cmds } = setup([flag({ id: 7 }), flag({ id: 8, ownerId: 2, slotIndex: 0, posTileId: id(2, 7) })]);
    expect(ctl.rightClickTile(ENEMY)).toBe('menu');
    expect(ix.ctx).toEqual({ tile: ENEMY, sub: null });
    expect(cmds()).toHaveLength(0);
    ctl.closeContextMenu();
    ix.selectedFlagId = 7; // 내 부대
    expect(ctl.rightClickTile(ENEMY)).toBe('move');
    expect(ix.ctx).toBeNull();
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_retarget', flagId: 7, anchorTileId: ENEMY });
    ix.selectedFlagId = 8; // 적 부대
    expect(ctl.rightClickTile(NEUTRAL)).toBe('menu');
    expect(ix.ctx?.tile).toBe(NEUTRAL);
  });

  it('맵 밖에서는 열지 않는다', () => {
    const { ctl, ix } = setup();
    expect(ctl.rightClickTile(-1)).toBeNull();
    expect(ix.ctx).toBeNull();
  });

  it('출전 진행 중 우클릭 = 출전 취소만 (메뉴를 열지 않는다)', () => {
    const { ctl, ix } = setup();
    ctl.click(NEUTRAL, 0); // 삼각 메뉴
    expect(ix.issue?.phase).toBe('pick');
    expect(ctl.rightClickTile(NEUTRAL)).toBeNull();
    expect(ix.issue).toBeNull();
    expect(ix.ctx).toBeNull();
  });
});

describe('우클릭 원형 메뉴 — 칸별 항목', () => {
  it('적 땅: 가운데 = 공격(최근접 기지), 정보·동맹 제안·이모트·따라가기 (수비 배치 없음)', () => {
    const { ctl } = setup();
    ctl.rightClickTile(ENEMY);
    const m = ctl.contextMenu()!;
    expect(m.center).toMatchObject({ kind: 'attack', label: '공격', disabled: false, base: ctl.nearestBaseFor(ENEMY) });
    expect(m.center.base).not.toBeNull();
    expect(segIds(ctl)).toEqual(['info', 'ally', 'emote', 'follow']);
    expect(seg(ctl, 'ally')).toMatchObject({ label: '동맹 제안', disabled: false });
    expect(seg(ctl, 'follow')!.disabled).toBe(false);
  });

  it('중립 땅: 가운데 = 공격, 동맹·따라가기는 비활성 + 이유', () => {
    const { ctl } = setup();
    ctl.rightClickTile(NEUTRAL);
    const m = ctl.contextMenu()!;
    expect(m.center).toMatchObject({ kind: 'attack', disabled: false, base: BASE_B });
    expect(seg(ctl, 'ally')).toMatchObject({ disabled: true, reason: '중립 땅 — 동맹할 상대가 없습니다' });
    expect(seg(ctl, 'follow')).toMatchObject({ disabled: true, reason: '중립 땅 — 따라갈 주인이 없습니다' });
    expect(seg(ctl, 'station')).toBeUndefined();
  });

  it('내 땅: 가운데 = 방어, 동맹은 "내 영토" 로 비활성', () => {
    const { ctl } = setup();
    ctl.rightClickTile(MY_LAND);
    expect(ctl.contextMenu()!.center).toMatchObject({ kind: 'defend', label: '방어', disabled: false });
    expect(seg(ctl, 'ally')).toMatchObject({ disabled: true, reason: '내 영토입니다' });
    expect(segIds(ctl)).not.toContain('station');
  });

  it('내 기지 칸: 수비 배치 추가 (방어력이 가장 높은 창병, 보낼 병력 비율 반영)', () => {
    const { ctl } = setup();
    ctl.rightClickTile(BASE_B);
    expect(segIds(ctl)).toEqual(['info', 'ally', 'emote', 'follow', 'station']);
    const m = ctl.contextMenu()!;
    expect(m.center.kind).toBe('defend');
    expect(m.station).toEqual({ unit: 0, troops: ctl.troopsToSend(0) });
    expect(seg(ctl, 'station')!.disabled).toBe(false);
  });

  it('적 기지 칸에는 수비 배치가 없다', () => {
    const { ctl } = setup();
    ctl.rightClickTile(ENEMY_BASE);
    expect(segIds(ctl)).not.toContain('station');
  });
});

describe('우클릭 원형 메뉴 — 비활성 이유', () => {
  it('깃발 슬롯이 꽉 차면 가운데·수비 배치 비활성 (n/n)', () => {
    const mine = [0, 1, 2].map((i) => flag({ id: 20 + i, slotIndex: i }));
    const { ctl } = setup(mine);
    ctl.rightClickTile(BASE_A);
    const m = ctl.contextMenu()!;
    expect(m.center).toMatchObject({ disabled: true, reason: '깃발 슬롯이 꽉 찼습니다 (3/3)' });
    expect(seg(ctl, 'station')).toMatchObject({ disabled: true, reason: '깃발 슬롯이 꽉 찼습니다 (3/3)' });
    ctl.ctxCenter(); // 비활성 = 아무 일도 안 함
    expect(ctl.ix.ctx?.sub).toBeNull();
    expect(ctl.ix.issue).toBeNull();
  });

  it('관전자: 가운데·동맹·이모트 비활성(관전), 정보·따라가기는 쓸 수 있다', () => {
    const { ctl, store } = setup();
    store.spectating = true;
    ctl.rightClickTile(ENEMY);
    const m = ctl.contextMenu()!;
    expect(m.center).toMatchObject({ disabled: true, reason: '관전 중에는 명령할 수 없습니다' });
    expect(seg(ctl, 'ally')!.disabled).toBe(true);
    expect(seg(ctl, 'emote')).toMatchObject({ disabled: true, reason: '관전 중에는 이모트를 보낼 수 없습니다' });
    expect(seg(ctl, 'info')!.disabled).toBe(false);
    expect(seg(ctl, 'follow')!.disabled).toBe(false);
  });

  it('병력이 최소(40) 미만이면 병종 버튼 비활성', () => {
    const { ctl, store } = setup();
    ctl.setRatio(0.1); // 1000 × 10% = 100
    expect(ctl.contextUnits().every((u) => !u.disabled)).toBe(true);
    store.game!.players.get(1)!.troops = 300; // 30
    const us = ctl.contextUnits();
    expect(us.every((u) => u.disabled)).toBe(true);
    expect(us[0].reason).toBe('병력이 너무 적습니다 (최소 40)');
  });
});

describe('우클릭 원형 메뉴 — 동작', () => {
  it('가운데 → 바깥 병종 고리(pick via ctx, 삼각 메뉴 대신) → 병종 = cmd_flag_issue(최근접 기지)', () => {
    const { ctl, ix, cmds } = setup();
    ctl.rightClickTile(NEUTRAL);
    ctl.ctxCenter();
    expect(ix.ctx).toEqual({ tile: NEUTRAL, sub: 'units' });
    expect(ix.issue).toEqual({ phase: 'pick', base: BASE_B, anchor: NEUTRAL, posture: 'attack', via: 'ctx' });
    expect(ctl.currentRoute()!.path[0]).toBe(BASE_B); // 경로 예고는 기존 출전 흐름 그대로
    ctl.chooseUnit(2);
    expect(cmds()).toHaveLength(1);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 2, anchorTileId: NEUTRAL, originBaseTileId: BASE_B, troops: ctl.troopsToSend(2) });
    expect(ix.ctx).toBeNull();
    expect(ix.issue).toBeNull();
  });

  it('병종 고리에서 숫자키 1/2/3, 가운데 다시 누르면 고리 접기', () => {
    const { ctl, ix, cmds } = setup();
    ctl.rightClickTile(MY_LAND);
    ctl.ctxCenter();
    ctl.ctxCenter();
    expect(ix.ctx?.sub).toBeNull();
    expect(ix.issue).toBeNull();
    ctl.ctxCenter();
    key(ctl, '1');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 0, anchorTileId: MY_LAND });
    expect(ix.ctx).toBeNull();
  });

  it('수비 배치 = 그 기지에 앵커·출발 (방어 태세는 서버가 내 땅 앵커로 정한다)', () => {
    const { ctl, ix, cmds } = setup();
    ctl.rightClickTile(BASE_A);
    ctl.ctxSegment('station');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 0, anchorTileId: BASE_A, originBaseTileId: BASE_A, troops: ctl.troopsToSend(0) });
    expect(ix.ctx).toBeNull();
  });

  it('정보: 적 = 정보 카드, 중립 = 지형 상자. 동맹 제안 = cmd_ally_propose. 따라가기 = 카메라 따라가기', () => {
    const { ctl, ix, cmds, store } = setup();
    ctl.rightClickTile(ENEMY);
    ctl.ctxSegment('info');
    expect(ix.cardPlayerId).toBe(2);
    expect(ix.ctx).toBeNull();
    ctl.rightClickTile(NEUTRAL);
    ctl.ctxSegment('info');
    expect(ix.ctx).toEqual({ tile: NEUTRAL, sub: 'terrain' });
    ctl.ctxSegment('ally'); // 비활성 — 무시
    expect(cmds()).toHaveLength(0);
    ctl.closeContextMenu();
    ctl.rightClickTile(ENEMY);
    ctl.ctxSegment('ally');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_ally_propose', targetPlayerId: 2 });
    ctl.rightClickTile(ENEMY);
    ctl.ctxSegment('follow');
    expect(store.followPlayerId).toBe(2);
  });

  it('이모트 고리 → 고르면 emote 송신 후 닫힘', () => {
    const { ctl, ix, store } = setup();
    const sent: unknown[] = [];
    (store as unknown as { socket: { send(m: unknown): boolean } }).socket.send = (m: unknown) => (sent.push(m), true);
    ctl.rightClickTile(ENEMY);
    ctl.ctxSegment('emote');
    expect(ix.ctx?.sub).toBe('emote');
    ctl.ctxEmote(15);
    expect(sent).toEqual([{ type: 'emote', code: 15, targetPlayerId: 2 }]); // §26.3 칸 주인 대상
    expect(ix.ctx).toBeNull();
  });
});

describe('우클릭 원형 메뉴 — 닫기', () => {
  it('Esc = 닫기 (다른 창보다 먼저), 병종 고리의 출전 상태도 지운다', () => {
    const { ctl, ix } = setup();
    ctl.rightClickTile(NEUTRAL);
    ctl.ctxCenter();
    ix.helpOpen = true;
    key(ctl, 'Escape');
    expect(ix.ctx).toBeNull();
    expect(ix.issue).toBeNull();
    expect(ix.helpOpen).toBe(true); // 메뉴만 닫았다
  });

  it('캔버스 클릭(바깥) = 닫기만 — 그 클릭으로 출전·선택이 시작되지 않는다', () => {
    const { ctl, ix, cmds } = setup();
    ctl.rightClickTile(ENEMY);
    ctl.click(NEUTRAL, 0);
    expect(ix.ctx).toBeNull();
    expect(ix.issue).toBeNull();
    ctl.rightClickTile(ENEMY);
    ctl.ctxCenter();
    ctl.click(NEUTRAL, 0); // 병종 고리 중 바깥 클릭
    expect(ix.ctx).toBeNull();
    expect(ix.issue).toBeNull();
    expect(cmds()).toHaveLength(0);
  });

  it('다시 우클릭 = 닫기 (onContextMenu — 좌표 없이)', () => {
    const { ctl, ix } = setup();
    ctl.rightClickTile(ENEMY);
    (ctl as unknown as { onContextMenu(e: Partial<MouseEvent>): void }).onContextMenu({ preventDefault() {} });
    expect(ix.ctx).toBeNull();
  });

  it('좌클릭 출전(삼각 메뉴)을 시작하면 원형 메뉴는 닫혀 있다 — 두 흐름이 겹치지 않는다', () => {
    const { ctl, ix } = setup();
    ctl.openContextMenu(ENEMY);
    ctl.beginPick(NEUTRAL, null);
    expect(ix.ctx).toBeNull();
    expect(ix.issue).toMatchObject({ phase: 'pick', anchor: NEUTRAL });
    expect((ix.issue as { via?: string }).via).toBeUndefined();
  });
});

describe('원형 메뉴 배치·순수 함수', () => {
  it('가장자리 근처에서도 고리 전체가 화면 안에 있다', () => {
    const e = ctxExtent(null);
    expect(clampRingCenter(5, 5, 1200, 800, e)).toEqual({ x: e + 6, y: e + 6 });
    expect(clampRingCenter(1199, 799, 1200, 800, e)).toEqual({ x: 1200 - e - 6, y: 800 - e - 6 });
    expect(clampRingCenter(600, 400, 1200, 800, e)).toEqual({ x: 600, y: 400 });
    expect(clampRingCenter(10, 10, 100, 100, e)).toEqual({ x: 50, y: 50 }); // 화면이 더 작으면 가운데
    expect(ctxExtent('units')).toBeGreaterThan(ctxExtent(null));
    // 위쪽 HUD 줄(top)만큼 더 내린다
    expect(clampRingCenter(600, 5, 1200, 800, e, 6, 48).y).toBe(48 + e + 6);
  });

  it('bestDefender = 방어력이 가장 높은 병종 (같으면 번호 작은 쪽)', () => {
    expect(bestDefender((u) => [1300, 1000, 700][u])).toBe(0);
    expect(bestDefender((u) => [900, 1200, 1200][u])).toBe(1);
  });

  it('물 칸: 가운데 지정 불가, 따라가기 이유 = 물', () => {
    const { store } = setup();
    const g = store.game!;
    (g.terrain as unknown as number[])[id(0, 9)] = 0;
    const m = contextMenuModel({ g, tile: id(0, 9), me: 1, spectating: false, canCommand: true, base: BASE_A, preview: null, followingId: null, names: store.names, troopsFor: () => 100, defFor: () => 1000 })!;
    expect(m.land).toBe(false);
    expect(m.center).toMatchObject({ kind: 'blocked', disabled: true });
    expect(m.segments.find((s) => s.id === 'follow')!.reason).toBe('물 — 주인이 없습니다');
  });
});
