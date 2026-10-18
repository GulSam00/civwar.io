/**
 * v4.2 출전 UI 입력 상태기계 (design-decisions「GDD v4.2 2차 검토 결정」 깃발 출전 UI 변경).
 *  지점 클릭 → 최근접 기지 하이라이트 → 삼각 메뉴 → 발령 / 기지 클릭 → 화살표 → 지점 → 삼각 메뉴 → 발령
 *  취소(바깥 클릭·우클릭·Esc) / 선택 깃발 + 내 기지 클릭 → 그 기지로 귀환(cmd_flag_recall.baseTileId)
 * 소켓 없이 store 의 송신만 가로채 실제 와이어 shape 을 확인한다. 화면 좌표 → 타일은 테스트에서 항등으로 바꾼다.
 */
import { describe, expect, it } from 'vitest';
import { POSTURE, rleEncode, type FlagSnapshot, type S2C_RoomState } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { GameRenderer } from '../src/render/renderer.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameInputController, Interaction } from '../src/input/controller.js';
import { moveField, walkPath } from '../src/input/route.js';

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

describe('진격 경로 (서버 가중 경로 복제)', () => {
  it('서버와 같은 가중 Dijkstra — 산 1칸이 우회보다 싸면 지나가고, 깊은 물은 통과하지 않는다', () => {
    const topo = createTopologyView('square', W, H);
    const t = terrain();
    const field = moveField(topo, t, id(2, 8));
    const path = walkPath(topo, t, field, id(2, 3), id(2, 8));
    expect(path[0]).toBe(id(2, 3));
    expect(path.at(-1)).toBe(id(2, 8));
    // 6열 산(1800) 1칸 통과 = 직선 5걸음 비용 1000*4+1800 = 5800 < 우회(0·5행) → 직선이 더 싸다: 서버와 같은 Dijkstra 이면 산을 지난다
    expect(path).toContain(id(2, 6));
    // 깊은 물로 막으면 경로 없음
    const t2 = t.map((x, i) => (i % W === 5 ? 0 : x));
    const f2 = moveField(topo, t2, id(2, 8));
    const p2 = walkPath(topo, t2, f2, id(2, 3), id(2, 8));
    expect(p2.at(-1)).not.toBe(id(2, 8));
  });
});

describe('출전 UI 상태기계', () => {
  it('지점 클릭 → 최근접 기지 하이라이트 + 삼각 메뉴 → 병종 선택 = cmd_flag_issue(originBaseTileId = 그 기지)', () => {
    const { ctl, ix, cmds } = setup();
    ctl.click(id(4, 6), 0); // 아래쪽 중립 → B 가 더 가깝다
    expect(ix.issue).toEqual({ phase: 'pick', base: BASE_B, anchor: id(4, 6), posture: 'attack' });
    const route = ctl.currentRoute()!;
    expect(route.path[0]).toBe(BASE_B);
    expect(route.path.at(-1)).toBe(id(4, 6));
    expect(route.reachable).toBe(true);
    expect(route.corridor.length).toBeGreaterThan(0); // 공격: 경로 옆 중립 칸 음영
    expect(cmds()).toHaveLength(0); // 메뉴만 떴다
    ctl.chooseUnit(2);
    expect(cmds()).toHaveLength(1);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 2, anchorTileId: id(4, 6), originBaseTileId: BASE_B });
    expect(cmds()[0].troops).toBeGreaterThan(0);
    expect(ix.issue).toBeNull();
  });

  it('위쪽 지점은 기지 A, 내 땅 클릭은 방어 태세 예고 (경로 회랑 없음)', () => {
    const { ctl, ix } = setup();
    ctl.click(id(0, 5), 0);
    expect(ix.issue).toMatchObject({ phase: 'pick', base: BASE_A, posture: 'attack' });
    ctl.click(id(0, 0), 0); // 바깥 클릭 = 취소
    expect(ix.issue).toBeNull();
    ctl.click(id(3, 2), 0); // 내 땅
    expect(ix.issue).toMatchObject({ phase: 'pick', posture: 'defend' });
    expect(ctl.currentRoute()!.corridor).toHaveLength(0);
  });

  it('삼각 메뉴가 떠 있을 때 1/2/3 키로 병종 선택, 메뉴 없으면 숫자키는 아무 일도 안 함', () => {
    const { ctl, ix, cmds } = setup();
    key(ctl, '1');
    expect(cmds()).toHaveLength(0);
    expect(ix.issue).toBeNull();
    ctl.click(id(2, 5), 0);
    key(ctl, '2');
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 1 });
  });

  it('기지 클릭 → 화살표(aim, 커서 따라감) → 지점 클릭 → 삼각 메뉴 → 그 기지에서 발령', () => {
    const { ctl, ix, cmds } = setup();
    ctl.click(BASE_A, 0);
    expect(ix.issue).toEqual({ phase: 'aim', base: BASE_A });
    ix.hoverTile = id(5, 7);
    const r1 = ctl.currentRoute()!;
    expect(r1.path[0]).toBe(BASE_A);
    expect(r1.path.at(-1)).toBe(id(5, 7));
    ix.hoverTile = id(0, 7);
    expect(ctl.currentRoute()!.path.at(-1)).toBe(id(0, 7)); // 커서를 따라간다
    ctl.click(id(5, 7), 0); // B 가 더 가깝지만 고른 기지 A 에서 출전
    expect(ix.issue).toMatchObject({ phase: 'pick', base: BASE_A, anchor: id(5, 7) });
    ctl.chooseUnit(0);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', unit: 0, anchorTileId: id(5, 7), originBaseTileId: BASE_A });
  });

  it('취소: aim 중 같은 기지 재클릭 · 우클릭 · Esc, Alt+다른 내 기지 = 출발 기지 변경', () => {
    const { ctl, ix, cmds } = setup();
    ctl.click(BASE_A, 0);
    ctl.click(BASE_A, 0);
    expect(ix.issue).toBeNull();
    ctl.click(BASE_A, 0);
    ctl.click(BASE_B, 0, true);
    expect(ix.issue).toEqual({ phase: 'aim', base: BASE_B });
    (ctl as unknown as { onContextMenu(e: Partial<MouseEvent>): void }).onContextMenu({ preventDefault() {} });
    expect(ix.issue).toBeNull();
    ctl.click(id(2, 5), 0);
    key(ctl, 'Escape');
    expect(ix.issue).toBeNull();
    expect(cmds()).toHaveLength(0);
  });

  it('깃발 위에 겹친 기지: 일반 클릭 = 깃발 선택, Alt+클릭 = 그 기지에서 출전', () => {
    const { ctl, ix, setFlagHit } = setup([flag({ id: 9, posTileId: BASE_A, state: 'IDLE' })]);
    setFlagHit(9);
    ctl.click(BASE_A, 0);
    expect(ix.selectedFlagId).toBe(9);
    expect(ix.issue).toBeNull();
    ix.selectedFlagId = null;
    ctl.click(BASE_A, 0, true);
    expect(ix.issue).toEqual({ phase: 'aim', base: BASE_A });
  });

  it('2026-10-14: 깃발 선택 + 기지 좌클릭은 명령이 아니다 (예전 귀환/재지정 폐기) — 선택 해제만', () => {
    const { ctl, ix, cmds, setFlagHit } = setup([flag({ id: 7 })]);
    setFlagHit(7);
    ctl.click(id(2, 5), 0);
    expect(ix.selectedFlagId).toBe(7);
    setFlagHit(null);
    ctl.click(BASE_B, 0); // 내 기지 좌클릭
    expect(cmds()).toHaveLength(0);
    expect(ix.selectedFlagId).toBeNull();
    expect(ix.issue).toBeNull(); // 출전도 아님
    ix.selectedFlagId = 7;
    ctl.click(ENEMY_BASE, 0); // 적 기지 좌클릭
    expect(cmds()).toHaveLength(0);
    expect(ix.selectedFlagId).toBeNull();
    ix.selectedFlagId = 7;
    ctl.click(id(0, 6), 0); // 빈 땅 = 선택 해제만 (출전 메뉴 안 뜸)
    expect(ix.selectedFlagId).toBeNull();
    expect(ix.issue).toBeNull();
    // R = 자동 귀환지 회수 (baseTileId 없음)
    ix.selectedFlagId = 7;
    key(ctl, 'r');
    expect(cmds().at(-1)).toEqual({ type: 'cmd_flag_recall', flagId: 7, clientSeq: expect.any(Number) });
  });

  it('2026-10-14 우클릭 라우팅: 내 부대 선택 + 우클릭 = 항상 이동 (내 기지 = 귀환 아님, 기지 위로 이동해 방어)', () => {
    const { store, ctl, ix, cmds } = setup([flag({ id: 7 }), flag({ id: 8, ownerId: 2, slotIndex: 0, posTileId: id(2, 8) })]);
    const moves: [number, number][] = [];
    const orig = store.moveFlag.bind(store);
    store.moveFlag = (f: number, t: number) => (moves.push([f, t]), orig(f, t));
    ix.selectedFlagId = 7;
    // 내 기지 → 이동 (cmd_flag_retarget, 귀환 cmd_flag_recall 아님) — 태세는 서버가 도착지로 정한다
    expect(ctl.rightClickTile(BASE_B)).toBe('move');
    expect(cmds().at(-1)).toEqual({ type: 'cmd_flag_retarget', flagId: 7, anchorTileId: BASE_B, clientSeq: expect.any(Number) });
    // 적 기지 · 중립 땅 · 내 땅 모두 같은 이동 명령
    expect(ctl.rightClickTile(ENEMY_BASE)).toBe('move');
    expect(ctl.rightClickTile(id(0, 5))).toBe('move');
    expect(ctl.rightClickTile(id(3, 2))).toBe('move');
    expect(cmds().every((m) => m.type === 'cmd_flag_retarget')).toBe(true);
    expect(cmds().map((m) => m.anchorTileId)).toEqual([BASE_B, ENEMY_BASE, id(0, 5), id(3, 2)]);
    // 이동 명령은 store.moveFlag 한 곳을 거친다 (§21 확정 후 이 함수만 교체)
    expect(moves).toEqual([[7, BASE_B], [7, ENEMY_BASE], [7, id(0, 5)], [7, id(3, 2)]]);
    // 선택 유지 (연속 지시 가능)
    expect(ix.selectedFlagId).toBe(7);
    // 남의 깃발 선택 · 선택 없음 = 명령 없이 원형 메뉴 (2026-10-18, contextRadial.test) · 맵 밖 = 아무것도 없음
    const n = cmds().length;
    ix.selectedFlagId = 8;
    expect(ctl.rightClickTile(id(2, 5))).toBe('menu');
    ctl.closeContextMenu();
    ix.selectedFlagId = null;
    expect(ctl.rightClickTile(id(2, 5))).toBe('menu');
    ctl.closeContextMenu();
    ix.selectedFlagId = 7;
    expect(ctl.rightClickTile(-1)).toBeNull();
    expect(cmds()).toHaveLength(n);
    // 출전 메뉴가 떠 있으면 우클릭 = 출전 취소 (이동 아님)
    ix.selectedFlagId = null;
    ctl.click(id(2, 5), 0);
    expect(ix.issue).not.toBeNull();
    ix.selectedFlagId = 7;
    expect(ctl.rightClickTile(id(2, 5))).toBeNull();
    expect(ix.issue).toBeNull();
    expect(cmds()).toHaveLength(n);
  });

  it('귀환 중 깃발은 기지 클릭·우클릭으로 명령하지 않는다 (A-62 취소 불가)', () => {
    const { ctl, ix, cmds } = setup([flag({ id: 7, state: 'RETURNING' })]);
    ix.selectedFlagId = 7;
    ctl.click(BASE_B, 0);
    ix.selectedFlagId = 7;
    expect(ctl.rightClickTile(BASE_B)).toBeNull();
    expect(cmds()).toHaveLength(0);
  });

  it('내 부대 칩 클릭(focusFlag) = 선택 + 카메라를 그 부대로, 출전 메뉴는 닫는다', () => {
    const { ctl, ix } = setup([flag({ id: 7, posTileId: id(4, 5) })]);
    ctl.click(id(2, 5), 0);
    expect(ix.issue).not.toBeNull();
    ctl.focusFlag(7);
    expect(ix.selectedFlagId).toBe(7);
    expect(ix.issue).toBeNull();
    const cam = ctl.renderer.camera;
    expect({ x: cam.cx, y: cam.cy }).toEqual({ x: 5.5, y: 4.5 }); // 칸 (4,5) 중심
    ctl.focusFlag(999); // 없는 깃발 = 무시
    expect(ix.selectedFlagId).toBe(7);
  });

  it('관전·탈락이면 출전 메뉴를 열지 않는다', () => {
    const { store, ctl, ix } = setup();
    store.game!.players.get(1)!.alive = false;
    ctl.click(id(2, 5), 0);
    expect(ix.issue).toBeNull();
  });

  it('게임 종료 후 둘러보기: 출전·귀환·숫자키 명령은 막히고 깃발 선택(정보)은 된다', () => {
    const { store, ctl, ix, cmds, setFlagHit } = setup([flag({ id: 7 })]);
    store.onMessage({ type: 'game_over', finalTick: 30, winnerId: 2, reason: 'threshold', standings: [] });
    expect(store.game!.gameOver).not.toBeNull();
    expect(ctl.canCommand()).toBe(false);
    ctl.click(id(2, 5), 0);
    expect(ix.issue).toBeNull();
    ctl.click(BASE_A, 0);
    expect(ix.issue).toBeNull();
    ctl.click(BASE_A, 0, true);
    expect(ix.issue).toBeNull();
    key(ctl, '1');
    setFlagHit(7);
    ctl.click(id(2, 5), 0);
    expect(ix.selectedFlagId).toBe(7);
    setFlagHit(null);
    ctl.click(BASE_B, 0); // 선택 깃발 + 내 기지 = 귀환이지만 종료 후엔 선택 해제만
    key(ctl, 'r');
    key(ctl, 'f');
    expect(cmds()).toHaveLength(0);
    // 순위표 따라가기 → HUD 기준 플레이어가 바뀐다 (종료 후에만, 진행 중 플레이어는 항상 나)
    expect(store.viewerId).toBe(1);
    store.setFollow(2);
    expect(store.viewerId).toBe(2);
  });
});
