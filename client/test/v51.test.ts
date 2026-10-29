/**
 * GDD v5.1 클라이언트 반영 (§37, QA F-3~F-7).
 *  - F-3 기지 출전 쿨타임 상태: snapshot_full.bases[].dispatchReadyTick + flag_issued(출발 기지 → tick + 25) · base_captured · 델타 tileChanges(→ 0)
 *        실제 서버 봇 판에서 매 snapshot_full 과 같은지 (불변식 1)
 *  - F-4 출전 미리보기 출발 기지 = shared pickOriginBase (쿨타임 아닌 최근접, 모두 쿨타임이면 남은 초) · 지정 기지 쿨타임이면 고리 비활성 · BASE_COOLDOWN 토스트
 *  - F-5 flag_recalled.reason == 'morale' → "사기 붕괴 후퇴" 알림·지도 태그, 앞선 disengage_started{auto:true} 는 따로 알리지 않음, reason 없음 = command
 *  - F-6 내 기지 칸 위 깃발의 사기 하한 30%
 */
import { describe, expect, it } from 'vitest';
import { MAP_SIZE_PRESETS, POSTURE, pickOriginBase, rleEncode, type FlagSnapshot, type S2C_RoomState, type ServerMessage } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { GameModel } from '../src/state/gameModel.js';
import { GameRenderer } from '../src/render/renderer.js';
import { createTopologyView } from '../src/render/topology.js';
import { GameInputController, Interaction } from '../src/input/controller.js';
import { baseWaitTicks, pickIssueOrigin } from '../src/input/origin.js';
import { SENT_SAFETY_TICKS } from '../src/input/controller.js';
import { describeEvent } from '../src/state/feed.js';
import { moraleDetail } from '../src/ui/morale.js';
import { terrainInfo } from '../src/ui/terrainInfo.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMap } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));

const W = 10;
const H = 6;
const id = (r: number, c: number) => r * W + c;
/** 10×6 평원. 내 땅(1) = 0..3열, 적(2) = 8..9열. 내 기지 A = (1,0), B = (4,3), 적 기지 = (2,9) */
const BASE_A = id(1, 0);
const BASE_B = id(4, 3);
const ENEMY_BASE = id(2, 9);
const ENEMY = id(2, 8);

function setup(opts: { combatModel?: 1 | 2; flags?: FlagSnapshot[]; ready?: [number, number, number]; tick?: number } = {}) {
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
    mapSource: 'random', botDifficulty: 'NORMAL', constants: {}, ...(opts.combatModel ? { combatModel: opts.combatModel } : {}),
  } as never);
  const owners: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) owners.push(c <= 3 ? 1 : c >= 8 ? 2 : 0);
  store.onMessage({ type: 'map_init', terrain: rleEncode(new Array(W * H).fill(1)), spawns: [{ playerId: 1, tileId: BASE_A, homeTileId: BASE_A }], bases: [BASE_A, BASE_B, ENEMY_BASE] });
  const [ra, rb, re] = opts.ready ?? [0, 0, 0];
  store.onMessage({
    type: 'snapshot_full', tick: opts.tick ?? 25, owners: rleEncode(owners),
    players: [
      { id: 1, tiles: 24, troops: 1000, gold: 0, goldWeight: 1000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 5, alive: true, connected: true },
      { id: 2, tiles: 12, troops: 1000, gold: 0, goldWeight: 1000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 5, alive: true, connected: true },
    ],
    flags: opts.flags ?? [],
    bases: [
      { tileId: BASE_A, ownerId: 1, hpPct: 100, dispatchReadyTick: ra },
      { tileId: BASE_B, ownerId: 1, hpPct: 100, dispatchReadyTick: rb },
      { tileId: ENEMY_BASE, ownerId: 2, hpPct: 100, dispatchReadyTick: re },
    ],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9575, endgameRushActive: false,
  });
  const renderer = new GameRenderer({} as HTMLCanvasElement);
  renderer.topo = createTopologyView('square', W, H);
  const ix = new Interaction();
  const ctl = new GameInputController({} as HTMLCanvasElement, renderer, store, ix);
  ctl.pixelToTileId = (sx: number) => sx;
  renderer.flagAt = () => null;
  const cmds = () => sent.filter((m) => String(m.type).startsWith('cmd_'));
  return { store, g: store.game!, ctl, ix, cmds, topo: renderer.topo };
}

const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 7, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: id(2, 5), anchorTileId: id(2, 7),
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, postureCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null, ...over,
});

const issued = (tick: number, flagId: number, originTileId: number) =>
  ({ type: 'flag_issued', tick, flagId, playerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, originTileId, anchorTileId: ENEMY, targetOwnerId: 2, etaTick: tick + 20, engageEtaTick: tick + 20 }) as ServerMessage;
const delta = (tick: number, tileChanges: [number, number][] = []) =>
  ({ type: 'snapshot_delta', tick, tileChanges, playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [] }) as unknown as ServerMessage;

describe('F-3 기지 출전 쿨타임 상태', () => {
  it('snapshot_full 로 초기화 → flag_issued 출발 기지 = tick + 25, 영토 출발은 그대로 → base_captured · tileChanges = 0', () => {
    const { g } = setup({ ready: [0, 40, 0] });
    expect([g.dispatchReadyOf(BASE_A), g.dispatchReadyOf(BASE_B)]).toEqual([0, 40]);
    expect(g.baseDispatchWait(BASE_B)).toBe(15); // tick 25
    g.apply(issued(26, 31, BASE_A));
    expect(g.dispatchReadyOf(BASE_A)).toBe(51);
    g.apply(issued(26, 32, id(0, 2))); // 기지 아닌 칸 출발 (기지 없을 때) — 아무 기지도 안 바뀐다
    expect([g.dispatchReadyOf(BASE_A), g.dispatchReadyOf(BASE_B)]).toEqual([51, 40]);
    g.apply({ type: 'base_captured', tick: 27, tileId: BASE_A, fromPlayerId: 1, toPlayerId: 2, newHpPct: 50 } as ServerMessage);
    expect(g.dispatchReadyOf(BASE_A)).toBe(0);
    g.apply(delta(27, [[BASE_B, 2]])); // 합병 등 이벤트 없이 주인이 바뀐 기지
    expect(g.dispatchReadyOf(BASE_B)).toBe(0);
  });

  it('실제 서버 봇 판: 매 snapshot_full 직전 모델의 dispatchReadyTick = full (불일치 0, 쿨타임 값이 실제로 쓰임)', () => {
    const P = MAP_SIZE_PRESETS.S;
    const state = createGameState(generateMap(321, P.w, P.h, 6), Array.from({ length: 6 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), 'HARD');
    const sim = new Simulation(state, CivBot);
    const model = new GameModel(wire(buildMatchConfig(state)));
    model.apply(wire(buildMapInit(state)));
    model.apply(wire(buildSnapshotFull(state)));
    const bad: string[] = [];
    let nonzero = 0;
    while (!sim.finished && state.tick < 900) {
      const out = sim.step();
      for (const m0 of out.broadcast) {
        const m = wire(m0) as ServerMessage;
        if (m.type === 'snapshot_full') {
          for (const b of m.bases) {
            if ((b.dispatchReadyTick ?? 0) > m.tick) nonzero++;
            if (model.dispatchReadyOf(b.tileId) !== b.dispatchReadyTick) bad.push(`t${m.tick} base ${b.tileId} 모델 ${model.dispatchReadyOf(b.tileId)} / full ${b.dispatchReadyTick}`);
          }
        }
        model.apply(m);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(nonzero).toBeGreaterThan(0);
  }, 60000);
});

describe('F-4 출전 미리보기 출발 기지 = pickOriginBase', () => {
  it('쿨타임 아닌 최근접(토폴로지 거리) 기지, 모두 쿨타임이면 null + 가장 먼저 준비되는 남은 tick', () => {
    const { g, topo } = setup({ ready: [0, 0, 0] });
    // (4,6): A 까지 9, B 까지 3 → B
    expect(pickIssueOrigin(g, topo, 1, id(4, 6))).toMatchObject({ base: BASE_B, nearest: BASE_B, waitTicks: 0 });
    expect(pickIssueOrigin(g, topo, 1, id(4, 6)).base).toBe(pickOriginBase([BASE_A, BASE_B], id(4, 6), g.tick + 1, (t) => g.dispatchReadyOf(t), (a, b) => topo.distance(a, b)));
    g.bases.get(BASE_B)!.dispatchReadyTick = 40;
    expect(pickIssueOrigin(g, topo, 1, id(4, 6))).toMatchObject({ base: BASE_A, nearest: BASE_B });
    g.bases.get(BASE_A)!.dispatchReadyTick = 35;
    expect(pickIssueOrigin(g, topo, 1, id(4, 6))).toMatchObject({ base: null, drawBase: BASE_B, hasBase: true, waitTicks: 9 }); // QA m-3: 준비 tick 35 − 처리 tick 26
    // 다음 tick(26) 처리 기준 — 준비 tick 26 이면 지금 보내도 된다
    g.bases.get(BASE_A)!.dispatchReadyTick = 26;
    expect(pickIssueOrigin(g, topo, 1, id(4, 6)).base).toBe(BASE_A);
  });

  it('우클릭 고리: 가까운 기지가 쿨타임이면 다음 기지에서 출발 · 모두 쿨타임이면 병종 비활성 + 남은 초, 준비되면 다시 활성', () => {
    const { g, ctl, ix, cmds } = setup({ ready: [0, 40, 0] });
    ctl.rightClickTile(id(4, 6));
    let m = ctl.ringModel()!;
    expect(m.base).toBe(BASE_A);
    expect(m.detail).toContain('더 가까운 기지는 출전 준비 중');
    expect(m.units.every((u) => !u.disabled)).toBe(true);
    g.bases.get(BASE_A)!.dispatchReadyTick = 35;
    m = ctl.ringModel()!;
    expect(ix.issue).toMatchObject({ base: BASE_B }); // 화살표는 최근접(쿨타임 무시)에서
    expect(m.units.every((u) => u.disabled && u.reason === '모든 기지가 출전 준비 중입니다 (2초 뒤 가능)')).toBe(true);
    ctl.chooseUnit(1);
    expect(cmds()).toHaveLength(0); // 보내지 않고 이유 토스트
    g.apply(delta(34));
    expect(ctl.ringModel()!.units.every((u) => !u.disabled)).toBe(true);
    ctl.chooseUnit(1);
    expect(cmds()[0]).toMatchObject({ type: 'cmd_flag_issue', originBaseTileId: BASE_A });
  });

  it('직접 고른 기지(조준)가 쿨타임이면 고리 비활성 — 다른 기지로 바꾸지 않는다 (서버도 지정 기지는 바꿔 주지 않는다)', () => {
    const { ctl, cmds } = setup({ ready: [36, 0, 0] });
    ctl.click(BASE_A, 0);
    ctl.click(ENEMY, 0);
    const m = ctl.ringModel()!;
    expect(m.base).toBe(BASE_A);
    expect(m.units.every((u) => u.disabled && u.reason === '이 기지는 출전 준비 중입니다 (2초 뒤 가능)')).toBe(true);
    ctl.chooseUnit(0);
    expect(cmds()).toHaveLength(0);
  });

  it('방금 보낸 기지는 flag_issued 전에도 잠깐 쿨타임으로 본다 — 연타하면 다음 기지에서', () => {
    const { ctl, cmds } = setup();
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0);
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0);
    expect(cmds().map((c) => c.originBaseTileId)).toEqual([BASE_B, BASE_A]);
  });

  it('QA m-3: 남은 tick = 준비 tick − (지금 tick + 1) — 서버 판정 기준', () => {
    const { g } = setup({ ready: [27, 26, 0] }); // tick 25 → 처리 tick 26
    expect(baseWaitTicks(g, BASE_B)).toBe(0); // 26 ≥ 26 → 지금 보내면 된다
    expect(baseWaitTicks(g, BASE_A)).toBe(1);
    g.bases.get(BASE_A)!.dispatchReadyTick = 51; // 방금(tick 26 처리) 출전한 기지 = 25 tick 남음
    expect(baseWaitTicks(g, BASE_A)).toBe(25);
    g.bases.get(BASE_B)!.dispatchReadyTick = 30;
    expect(pickIssueOrigin(g, { distance: () => 1 }, 1, ENEMY).waitTicks).toBe(4);
  });

  it('QA m-1: 응답이 늦어도(1초 넘게) flag_issued 가 올 때까지 보낸 기지를 다시 고르지 않는다 → flag_issued 뒤에는 서버 값', () => {
    const { store, g, ctl, cmds } = setup();
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0);
    for (let t = 26; t <= 40; t++) g.apply(delta(t)); // 응답 없이 15 tick(3초) 흐름
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0);
    expect(cmds().map((c) => c.originBaseTileId)).toEqual([BASE_B, BASE_A]);
    // 첫 발령의 flag_issued 도착 → 임시 표시를 지우고 서버 값(tick + 25)을 쓴다
    store.onMessage({ ...issued(41, 31, BASE_B), playerId: 1 } as ServerMessage);
    expect(g.dispatchReadyOf(BASE_B)).toBe(66);
    expect(baseWaitTicks(g, BASE_B)).toBe(66 - 41);
  });

  it('QA m-1: 응답이 끝내 없으면 안전 만료(SENT_SAFETY_TICKS) 뒤에 풀린다', () => {
    const { g, ctl } = setup();
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0); // B 에서 보냄 (tick 25)
    g.apply(delta(25 + 10));
    expect(ctl.nearestBaseFor(id(4, 6))).toBe(BASE_A); // 2초 뒤에도 유지
    g.apply(delta(26 + SENT_SAFETY_TICKS));
    expect(ctl.nearestBaseFor(id(4, 6))).toBe(BASE_B);
  });

  it('QA m-2: 다른 사유로 거절된 발령의 기지는 거절 cmd_ack 를 받자마자 다시 출전 가능', () => {
    const { store, ctl, cmds } = setup();
    ctl.rightClickTile(id(4, 6));
    ctl.chooseUnit(0);
    ctl.rightClickTile(id(4, 6));
    expect(ctl.ringModel()!.base).toBe(BASE_A); // B 는 응답 대기 중
    ctl.cancelIssue();
    store.onMessage({ type: 'cmd_ack', clientSeq: cmds()[0].clientSeq as number, accepted: false, reason: 'INSUFFICIENT' } as ServerMessage);
    ctl.rightClickTile(id(4, 6));
    expect(ctl.ringModel()!.base).toBe(BASE_B);
    // 수락 ack 는 지우지 않는다 (flag_issued 가 뒤에 올 수 있다)
    ctl.chooseUnit(0);
    store.onMessage({ type: 'cmd_ack', clientSeq: cmds()[1].clientSeq as number, accepted: true, flagId: 32, posture: POSTURE.ATTACK } as ServerMessage);
    ctl.rightClickTile(id(4, 6));
    expect(ctl.ringModel()!.base).toBe(BASE_A);
  });

  it('BASE_COOLDOWN 거절 = 토스트', () => {
    const { store, ctl } = setup();
    ctl.rightClickTile(ENEMY);
    ctl.chooseUnit(0);
    const seq = (store as unknown as { pending: Map<number, unknown> }).pending.keys().next().value as number;
    store.onMessage({ type: 'cmd_ack', clientSeq: seq, accepted: false, reason: 'BASE_COOLDOWN' } as ServerMessage);
    expect(store.toasts.at(-1)).toMatchObject({ kind: 'error' });
    expect(store.toasts.at(-1)!.text).toContain('출전 준비 중인 기지');
  });

  it('지형 hover: 내 기지에 출전 쿨타임 남은 초', () => {
    const { g, store } = setup({ ready: [0, 40, 0] });
    const rows = terrainInfo(g, BASE_B, 1, (i) => store.nicknameOf(i))!.rows;
    expect(rows.find((r) => r.label === '출전')).toEqual({ field: 'baseHp', label: '출전', value: '준비 중 3초' });
    expect(terrainInfo(g, BASE_A, 1, (i) => store.nicknameOf(i))!.rows.find((r) => r.label === '출전')).toBeUndefined();
  });
});

describe('F-5 사기 붕괴 자동 후퇴', () => {
  const ctxFor = (g: GameModel) => ({ me: 1, nick: (i: number) => `P${i}`, flagOwner: (i: number) => g.flags.get(i)?.ownerId ?? null, tickMs: 200 });
  it('flag_recalled{morale} = 알림(토스트), 앞선 disengage_started{auto:true} 는 알리지 않음, reason 없음/command/base_lost = 조용히', () => {
    const { g } = setup({ flags: [flag({ id: 57, inCombat: true, state: 'ENGAGED', morale: 0 })], combatModel: 2 });
    const c = ctxFor(g);
    expect(describeEvent({ type: 'flag_disengage_started', tick: 812, flagId: 57, untilTick: 827, auto: true } as ServerMessage, c)).toBeNull();
    const e = describeEvent({ type: 'flag_recalled', tick: 812, flagId: 57, returnTileId: BASE_A, reason: 'morale' } as ServerMessage, c)!;
    expect(e).toMatchObject({ kind: 'flag', mine: true, toast: true, important: true });
    expect(e.text.startsWith('사기 붕괴 후퇴')).toBe(true);
    expect(describeEvent({ type: 'flag_recalled', tick: 812, flagId: 57, returnTileId: BASE_A } as ServerMessage, c)).toBeNull();
    expect(describeEvent({ type: 'flag_recalled', tick: 812, flagId: 57, returnTileId: BASE_A, reason: 'base_lost' } as ServerMessage, c)).toBeNull();
    // 남의 깃발이면 알리지 않는다
    expect(describeEvent({ type: 'flag_recalled', tick: 812, flagId: 57, returnTileId: BASE_A, reason: 'morale' } as ServerMessage, { ...c, me: 2 })).toBeNull();
  });

  it('모델: morale 회수 깃발 표식 (태세 전환 중 아님) → 종료·소멸에서 지움, reason 없는 회수는 표식 없음', () => {
    const { g, store } = setup({ flags: [flag({ id: 57, inCombat: true, state: 'ENGAGED' }), flag({ id: 58, slotIndex: 1 })], combatModel: 2 });
    store.onMessage({ type: 'flag_disengage_started', tick: 26, flagId: 57, untilTick: 41, auto: true } as ServerMessage);
    store.onMessage({ type: 'flag_recalled', tick: 26, flagId: 57, returnTileId: BASE_A, reason: 'morale' } as ServerMessage);
    store.onMessage({ type: 'flag_recalled', tick: 26, flagId: 58, returnTileId: BASE_A } as ServerMessage);
    expect(g.moraleRetreat.has(57)).toBe(true);
    expect(g.disengageForPosture.has(57)).toBe(false);
    expect(g.moraleRetreat.has(58)).toBe(false);
    expect(g.flags.get(57)!.state).toBe('RETURNING');
    expect(store.toasts.some((t) => t.text.startsWith('사기 붕괴 후퇴'))).toBe(true);
    store.onMessage({ type: 'flag_ended', tick: 60, flagId: 57, reason: 'recalled', refunded: 40 } as ServerMessage);
    expect(g.moraleRetreat.has(57)).toBe(false);
  });
});

describe('F-6 기지 사기 하한', () => {
  it('내 기지 칸 위 깃발 = 하한 300, 다른 칸·모델 1 = 없음 · 300 미만이면 "전투 중에도 회복" 문구', () => {
    const { g } = setup({ combatModel: 2 });
    const onBase = flag({ posTileId: BASE_A, morale: 120, inCombat: true });
    expect(moraleDetail(g, onBase)!.baseFloor).toBe(300);
    expect(moraleDetail(g, flag({ posTileId: id(2, 5), morale: 120 }))!.baseFloor).toBeNull();
    expect(moraleDetail(g, flag({ ownerId: 2, posTileId: BASE_A, morale: 120 }))!.baseFloor).toBeNull(); // 남의 기지 위
    const g1 = setup({ combatModel: 1 }).g;
    expect(moraleDetail(g1, onBase)).toBeNull();
  });
});
