/**
 * v4.6 (프로토콜 §27) 클라이언트 연결 — 태세 전환 즉시 적용.
 *  - flagActionState: 전투 중·이탈 대기 중에도 버튼 가능, 쿨타임·패주·귀환만 막힘, 교전 중 전환 경고(실제 이탈 대기 초)
 *  - postureHeld: cmd_ack / flag_retargeted → "태세 전환 쿨타임 중 — 이동만 했습니다" 토스트 (중복 1회)
 *  - 우클릭 이동 예고: 쿨타임 중이면 도착지 기본 태세가 아니라 붙들린(현재) 태세
 *  - 이탈 호: wait_over 는 조용히 닫고, posture_changed 직후 disengage_started{auto:false} 는 "태세 전환 중"
 *  - 실제 Simulation + 실제 ClientStore 종단 검증 (qaV45 에서 폐기된 pendingPosture 검증의 대체)
 */
import { describe, expect, it } from 'vitest';
import { DISENGAGE_TICKS, FLAG_BIT, POSTURE, POSTURE_COOLDOWN_TICKS, TERRAIN, UNIT, isClaimable, rleEncode, type C2S_GameCommand, type FlagSnapshot, type RoomMember, type S2C_RoomState, type S2C_SnapshotDelta, type ServerMessage } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { disengageTicksOf } from '../src/state/disengage.js';
import { flagActionState } from '../src/ui/unitChips.js';
import { computePreview } from '../src/input/preview.js';
import { createTopologyView } from '../src/render/topology.js';
import { generateMapForPlayers } from '../../server/src/map/generate.js';
import { NEUTRAL, createGameState, makeFlag, setTileOwner, type Flag, type GameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';

const flag = (over: Partial<FlagSnapshot>): FlagSnapshot => ({
  id: 7, ownerId: 1, slotIndex: 0, unit: 1, posture: POSTURE.ATTACK, troops: 100, posTileId: 0, anchorTileId: 0,
  targetOwnerId: 0, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false,
  disengaging: false, postureCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null, ...over,
});

// ───────────────────────── flagActionState (§27.5-2) ─────────────────────────
describe('§27 태세 버튼 상태', () => {
  it('전투 중·이탈 대기 중에도 누를 수 있다 — "전투 중"/"이탈 대기 중" 차단 사유는 없다', () => {
    expect(flagActionState(flag({ inCombat: true }), 0, 200).postureBlocked).toBeNull();
    expect(flagActionState(flag({ inCombat: true, disengaging: true, disengageUntilTick: 9 }), 0, 200).postureBlocked).toBeNull();
  });

  it('남은 차단 사유: 패주 > 귀환 > 쿨타임("전환 대기 n초")', () => {
    expect(flagActionState(flag({ routed: true, inCombat: true }), 0, 200).postureBlocked).toBe('패주 중');
    expect(flagActionState(flag({ state: 'RETURNING', inCombat: true }), 0, 200).postureBlocked).toBe('귀환 중');
    const cd = flagActionState(flag({ inCombat: true, postureCooldownUntilTick: 12 }), 2, 200); // 10 tick = 2초
    expect(cd.postureBlocked).toBe('전환 대기 2초');
    expect(cd.cooldownSec).toBe(2);
    expect(cd.combatWarning).toBeNull(); // 막혀 있으면 경고도 없다
  });

  it('교전 중 전환 경고: 이탈 대기 초는 소유자 스탯(기본 15 tick = 3초, 철수 훈련 10 tick = 2초)', () => {
    expect(flagActionState(flag({ inCombat: true }), 0, 200).combatWarning).toBe('교전 중 전환: 이탈 대기 3초, 방어력 ×0.5');
    expect(flagActionState(flag({ inCombat: true }), 0, 200, DISENGAGE_TICKS).combatWarning).toBe('교전 중 전환: 이탈 대기 3초, 방어력 ×0.5');
    expect(flagActionState(flag({ inCombat: true }), 0, 200, 10).combatWarning).toBe('교전 중 전환: 이탈 대기 2초, 방어력 ×0.5');
  });

  it('이미 이탈 대기 중이면 대기 시간은 그대로라는 경고, 평상시는 경고 없음, pendingPosture 필드는 없다', () => {
    expect(flagActionState(flag({ inCombat: true, disengaging: true, disengageUntilTick: 9 }), 0, 200).combatWarning).toMatch(/남은 대기 시간은 그대로/);
    const calm = flagActionState(flag({}), 0, 200);
    expect(calm.combatWarning).toBeNull();
    expect('pendingPosture' in calm).toBe(false);
  });
});

// ───────────────────────── 모델 / 이탈 호 (§27.5-4) ─────────────────────────
const W = 10;
const H = 6;
const id = (r: number, c: number) => r * W + c;
const CAP1 = id(1, 1);
const CAP2 = id(2, 8);

function smallStore(flags: FlagSnapshot[] = []) {
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
  store.onMessage({ type: 'map_init', terrain: rleEncode(new Array(W * H).fill(1)), spawns: [{ playerId: 1, tileId: CAP1, homeTileId: CAP1 }, { playerId: 2, tileId: CAP2, homeTileId: CAP2 }], bases: [CAP1, CAP2], baseNames: ['한울', '누리'] });
  const owners: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) owners.push(c <= 4 ? 1 : c >= 7 ? 2 : 0);
  store.onMessage({
    type: 'snapshot_full', tick: 100, owners: rleEncode(owners),
    players: [
      { id: 1, tiles: 30, troops: 1000, gold: 0, goldWeight: 100000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
      { id: 2, tiles: 18, troops: 1000, gold: 0, goldWeight: 100000, upkeepPm: 0, techMask: 0, techCount: 0, flagCap: 3, alive: true, connected: true },
    ],
    flags,
    bases: [{ tileId: CAP1, ownerId: 1, hpPct: 100 }, { tileId: CAP2, ownerId: 2, hpPct: 100 }],
    alliances: [], allyProposals: [], allianceFreezeUntilTick: null, lockoutDissolveTick: null, thresholdPct: 60, ticksRemaining: 9500, endgameRushActive: false,
  });
  return { store, g: store.game! };
}
const delta = (tick: number, over: Partial<S2C_SnapshotDelta> = {}): S2C_SnapshotDelta => ({
  type: 'snapshot_delta', tick, tileChanges: [], playerDeltas: [], flagMoves: [], flagStats: [], flagProgress: [], flagTargets: [], baseHp: [], flagsGone: [], flagFlags: [], ...over,
});

describe('§27 이탈 호 — 태세 전환 중 / wait_over', () => {
  it('posture_changed{auto:false} 와 같은 tick 의 disengage_started{auto:false} = "태세 전환 중" 표식, wait_over 로 조용히 닫힌다', () => {
    const { store, g } = smallStore([flag({ inCombat: true, state: 'ENGAGED' })]);
    store.onMessage({ type: 'flag_posture_changed', tick: 101, flagId: 7, posture: POSTURE.DEFEND, cooldownUntilTick: 126, auto: false, targetOwnerId: 2 });
    store.onMessage({ type: 'flag_disengage_started', tick: 101, flagId: 7, untilTick: 116, auto: false });
    expect(g.flags.get(7)!.disengageUntilTick).toBe(116);
    expect(g.disengageForPosture.has(7)).toBe(true);
    store.onMessage({ type: 'flag_disengaged', tick: 116, flagId: 7, reason: 'wait_over' });
    expect(g.flags.get(7)!.disengageUntilTick).toBeNull();
    expect(g.disengageForPosture.has(7)).toBe(false);
    expect(g.flags.has(7)).toBe(true); // 빠져나가지 않는다 — 전투에 남음
    expect(store.toasts.length).toBe(0);
  });

  it('회수·재지정의 이탈 대기(posture_changed 없음, 또는 다른 tick)는 "태세 전환 중"이 아니다', () => {
    const { store, g } = smallStore([flag({ inCombat: true, state: 'ENGAGED' })]);
    store.onMessage({ type: 'flag_disengage_started', tick: 101, flagId: 7, untilTick: 116, auto: false });
    expect(g.disengageForPosture.has(7)).toBe(false);
    store.onMessage({ type: 'flag_posture_changed', tick: 105, flagId: 7, posture: POSTURE.DEFEND, cooldownUntilTick: 130, auto: false, targetOwnerId: 2 });
    store.onMessage({ type: 'flag_disengage_started', tick: 106, flagId: 7, untilTick: 121, auto: false });
    expect(g.disengageForPosture.has(7)).toBe(false);
    // auto:true 전환(우클릭 이동) 뒤의 이탈 대기도 이동 이탈이다
    store.onMessage({ type: 'flag_posture_changed', tick: 110, flagId: 7, posture: POSTURE.ATTACK, cooldownUntilTick: 135, auto: true, targetOwnerId: 2 });
    store.onMessage({ type: 'flag_disengage_started', tick: 110, flagId: 7, untilTick: 125, auto: false });
    expect(g.disengageForPosture.has(7)).toBe(false);
  });

  it('패주·델타 disengaging=false 에서도 표식이 사라진다', () => {
    const { store, g } = smallStore([flag({ id: 7, inCombat: true, state: 'ENGAGED' }), flag({ id: 8, slotIndex: 1, inCombat: true, state: 'ENGAGED' })]);
    for (const fid of [7, 8]) {
      store.onMessage({ type: 'flag_posture_changed', tick: 101, flagId: fid, posture: POSTURE.DEFEND, cooldownUntilTick: 126, auto: false, targetOwnerId: 2 });
      store.onMessage({ type: 'flag_disengage_started', tick: 101, flagId: fid, untilTick: 116, auto: false });
    }
    store.onMessage({ type: 'flag_routed', tick: 103, flagId: 7, returnTileId: CAP1 });
    expect(g.disengageForPosture.has(7)).toBe(false);
    expect(g.disengageForPosture.has(8)).toBe(true);
    store.onMessage(delta(104, { flagFlags: [[8, POSTURE.DEFEND, FLAG_BIT.IN_COMBAT, 126]] })); // DISENGAGING 비트 꺼짐
    expect(g.disengageForPosture.has(8)).toBe(false);
  });

  it('모델에 pendingPosture 가 없다 (델타 flagFlags 비트는 0..127 만 읽는다)', () => {
    const { store, g } = smallStore([flag({})]);
    store.onMessage(delta(101, { flagFlags: [[7, POSTURE.DEFEND, FLAG_BIT.IN_COMBAT | FLAG_BIT.DISENGAGING, 120]] }));
    const f = g.flags.get(7)! as unknown as Record<string, unknown>;
    expect(f.pendingPosture).toBeUndefined();
    expect(f.inCombat).toBe(true);
    expect(f.disengaging).toBe(true);
    expect(f.postureCooldownUntilTick).toBe(120);
    expect(Object.keys(FLAG_BIT)).not.toContain('POSTURE_PENDING');
  });

  it('disengageTicksOf: 노드 표가 없는 모델은 무테크 기본값 15 tick (경고·호 길이 공용)', () => {
    const { g } = smallStore([flag({})]);
    expect(disengageTicksOf(g, 1)).toBe(DISENGAGE_TICKS);
    expect(disengageTicksOf(g, 99)).toBe(DISENGAGE_TICKS); // 모르는 플레이어 = 무테크
  });
});

// ───────────────────────── postureHeld 토스트 (§27.5-3) ─────────────────────────
describe('§27 postureHeld 안내', () => {
  const heldAck = (clientSeq: number, flagId = 7) => ({ type: 'cmd_ack' as const, clientSeq, accepted: true, flagId, posture: POSTURE.DEFEND, postureHeld: true });
  const retargeted = (over: Record<string, unknown> = {}) =>
    ({
      type: 'flag_retargeted', tick: 102, flagId: 7, anchorTileId: id(2, 6), targetOwnerId: 0, posture: POSTURE.DEFEND, resumeTick: 102, etaTick: 120, engageEtaTick: 118, auto: false, postureHeld: true, ...over,
    }) as unknown as ServerMessage;

  it('cmd_ack.postureHeld = true → 토스트(남은 초·현재 태세), 같은 tick 의 flag_retargeted 는 중복 토스트를 만들지 않는다', () => {
    const { store, g } = smallStore([flag({ posture: POSTURE.DEFEND, postureCooldownUntilTick: 110 })]);
    store.onMessage(heldAck(5));
    expect(store.toasts.map((t) => t.text)).toEqual(['태세 전환 쿨타임 중 — 이동만 했습니다 (2초 남음, 방어 태세 유지)']);
    store.onMessage(retargeted());
    expect(store.toasts.length).toBe(1);
    expect(g.flags.get(7)!.posture).toBe(POSTURE.DEFEND); // 서버의 실제 태세
  });

  it('flag_retargeted.postureHeld 만 와도 (내 깃발, 사람 명령) 토스트', () => {
    const { store, g } = smallStore([flag({ posture: POSTURE.DEFEND, postureCooldownUntilTick: 125 })]);
    store.onMessage(retargeted());
    expect(store.toasts.length).toBe(1);
    expect(store.toasts[0].text).toMatch(/태세 전환 쿨타임 중 — 이동만 했습니다/);
    expect(g.flags.get(7)!.posture).toBe(POSTURE.DEFEND);
  });

  it('postureHeld = false / 없음 / 남의 깃발 / 거절 ack 는 이동만 안내가 없다', () => {
    const { store } = smallStore([flag({ posture: POSTURE.DEFEND, postureCooldownUntilTick: 125 }), flag({ id: 9, ownerId: 2, slotIndex: 0 })]);
    store.onMessage({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: 7, posture: POSTURE.DEFEND, postureHeld: false });
    store.onMessage({ type: 'cmd_ack', clientSeq: 2, accepted: true, flagId: 7, posture: POSTURE.DEFEND });
    store.onMessage(retargeted({ postureHeld: false }));
    store.onMessage(retargeted({ flagId: 9 }));
    expect(store.toasts.length).toBe(0);
    store.onMessage({ type: 'cmd_ack', clientSeq: 3, accepted: false, reason: 'POSTURE_COOLDOWN' });
    expect(store.toasts.map((t) => t.text)).toEqual(['태세 전환 쿨타임 중입니다']);
  });
});

// ───────────────────────── 우클릭 이동 예고 (§27.5-3) ─────────────────────────
describe('§27 우클릭 이동 예고 — 쿨타임 중이면 붙들린 태세', () => {
  const topo = createTopologyView('square', W, H);
  it('쿨타임이 없으면 도착지 기본 태세 (내 땅 = 방어, 적 땅 = 공격)', () => {
    const { g } = smallStore([flag({ posture: POSTURE.ATTACK })]);
    expect(computePreview(g, topo, 1, id(2, 2), null, null)).toMatchObject({ kind: 'defend', posture: POSTURE.DEFEND });
    expect(computePreview(g, topo, 1, id(2, 8), null, null)).toMatchObject({ kind: 'attack', posture: POSTURE.ATTACK });
  });

  it('쿨타임 중 ATTACK 깃발 → 내 땅 예고는 공격 색 + "공격 태세 유지 (전환 쿨타임 n초)", held 표식', () => {
    const { g } = smallStore([flag({ posture: POSTURE.ATTACK })]);
    const p = computePreview(g, topo, 1, id(2, 2), null, { posture: POSTURE.ATTACK, sec: 3 })!;
    expect(p).toMatchObject({ kind: 'attack', posture: POSTURE.ATTACK, held: true, disk: [], count: 0 });
    expect(p.label).toContain('공격 태세 유지 (전환 쿨타임 3초)');
  });

  it('쿨타임 중 DEFEND 깃발 → 적 땅 예고는 방어 색 (서버가 방어로 유지한 채 이동)', () => {
    const { g } = smallStore([flag({ posture: POSTURE.DEFEND })]);
    const p = computePreview(g, topo, 1, id(2, 8), null, { posture: POSTURE.DEFEND, sec: 1 })!;
    expect(p).toMatchObject({ kind: 'defend', posture: POSTURE.DEFEND, held: true });
  });

  it('도착지 기본 태세 = 붙들린 태세면 평소 예고 그대로(held 없음), 불가 칸(물)은 그대로 불가', () => {
    const { g } = smallStore([flag({ posture: POSTURE.DEFEND })]);
    const p = computePreview(g, topo, 1, id(2, 2), null, { posture: POSTURE.DEFEND, sec: 4 })!;
    expect(p.held).toBeUndefined();
    expect(p).toMatchObject({ kind: 'defend', posture: POSTURE.DEFEND });
    g.terrain![id(0, 0)] = 0; // 물
    expect(computePreview(g, topo, 1, id(0, 0), null, { posture: POSTURE.ATTACK, sec: 4 })).toMatchObject({ kind: 'blocked', posture: null });
  });
});

// ───────────────────────── 실제 Simulation + 실제 ClientStore ─────────────────────────
const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
function roomState(state: GameState): S2C_RoomState {
  const players: RoomMember[] = state.players
    .filter(Boolean)
    .map((p) => ({ playerId: p.id, sessionId: p.id === 1 ? 's_me' : null, nickname: `n${p.id}`, isBot: p.id !== 1, isHost: p.id === 1, ready: true, status: p.alive ? 'PLAYING' : 'ELIMINATED_SPECTATING' }));
  return {
    type: 'room_state', roomId: 'r1', roomCode: 'QAQAQA', isPublic: false, phase: 'IN_GAME', hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: players.length, botCount: players.length - 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'x', expectedPlayers: players.length },
    players, spectatorCount: 0, countdownMs: null, autoStartMs: null,
  };
}
function bootstrap(state: GameState): ClientStore {
  const s = new ClientStore('ws://unused');
  s.sessionId = 's_me';
  s.onMessage(wire(roomState(state)));
  s.onMessage(wire(buildMatchConfig(state)));
  s.onMessage(wire(buildMapInit(state)));
  s.onMessage(wire(buildSnapshotFull(state)));
  return s;
}
let seq = 0;
function step(sim: Simulation, cmds: [number, Record<string, unknown>][], store: ClientStore) {
  const seqs: number[] = [];
  for (const [pid, c] of cmds) {
    const clientSeq = ++seq;
    seqs.push(clientSeq);
    sim.enqueue(pid, pid, { ...c, clientSeq } as unknown as C2S_GameCommand);
  }
  const out = sim.step();
  const msgs = [...out.broadcast, ...out.personal.map((p) => p.msg)].map((m) => wire(m) as ServerMessage);
  for (const m of msgs) store.onMessage(m);
  return { msgs, acks: seqs.map((q) => msgs.find((m) => m.type === 'cmd_ack' && (m as { clientSeq?: number }).clientSeq === q) as unknown as Record<string, unknown>) };
}
function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number; anchor?: number } & Partial<Flag>): Flag {
  const f = makeFlag({ id: s.nextFlagId++, ownerId: o.ownerId, slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length, unit: o.unit, troopsMilli: o.troops * 1000, initialTroops: o.troops, posTileId: o.pos, anchorTileId: o.anchor ?? o.pos, originTileId: o.pos });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, anchor: _a, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}
function openArea(s: GameState, r: number): number {
  const Wd = s.map.width;
  const Hd = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / Wd);
    const col = t % Wd;
    if (row < r + 1 || col < r + 1 || row >= Hd - r - 1 || col >= Wd - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('no open area');
}
function scenario() {
  const map = generateMapForPlayers(4242, 8);
  const state = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true })));
  const c = openArea(state, 8);
  for (const t of state.graph.disk(c, 8)) state.map.terrain[t] = TERRAIN.PLAIN;
  return { state, sim: new Simulation(state), c };
}

describe('§27 종단 — 실제 서버 시뮬레이션 + ClientStore', () => {
  it('쿨타임 중 우클릭: 이동만 (postureHeld), 쿨타임이 끝나도 자동 전환 없음, 토스트 1회, 모델 = 서버', () => {
    const { state, sim, c } = scenario();
    const f = addFlag(state, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, anchor: c + 2, posture: POSTURE.ATTACK, state: 'MARCHING' });
    const store = bootstrap(state);
    const g = store.game!;
    step(sim, [], store);
    // 즉시 전환 → 쿨타임 시작
    let r = step(sim, [[1, { type: 'cmd_set_posture', flagId: f.id, posture: POSTURE.DEFEND }]], store);
    expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
    expect(r.msgs.some((m) => m.type === 'flag_posture_changed' && (m as { auto?: boolean }).auto === false)).toBe(true);
    const cdUntil = f.postureCooldownUntilTick;
    expect(cdUntil).toBe(state.tick + POSTURE_COOLDOWN_TICKS);
    expect(g.flags.get(f.id)!.postureCooldownUntilTick).toBe(cdUntil);
    // 쿨타임 중 재전환은 거절
    r = step(sim, [[1, { type: 'cmd_set_posture', flagId: f.id, posture: POSTURE.ATTACK }]], store);
    expect(r.acks[0]).toMatchObject({ accepted: false, reason: 'POSTURE_COOLDOWN' });
    store.toasts = [];
    // 쿨타임 중 중립 칸 우클릭 → 도착지 기본 ATTACK 이지만 DEFEND 유지
    r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: f.id, anchorTileId: c + 4 }]], store);
    expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND, postureHeld: true });
    expect(r.msgs.find((m) => m.type === 'flag_retargeted')).toMatchObject({ posture: POSTURE.DEFEND, postureHeld: true });
    expect(r.msgs.some((m) => m.type === 'flag_posture_changed')).toBe(false);
    expect(g.flags.get(f.id)!.posture).toBe(POSTURE.DEFEND);
    const held = store.toasts.filter((t) => /이동만 했습니다/.test(t.text));
    expect(held.length).toBe(1);
    expect(held[0].text).toMatch(/방어 태세 유지/);
    // 쿨타임이 끝나도 자동 전환 없음
    let autoChanged = false;
    while (state.tick < cdUntil + 10) autoChanged ||= step(sim, [], store).msgs.some((m) => m.type === 'flag_posture_changed' && (m as { flagId: number }).flagId === f.id);
    expect(autoChanged).toBe(false);
    expect(f.posture).toBe(POSTURE.DEFEND);
    expect(g.flags.get(f.id)!.posture).toBe(POSTURE.DEFEND);
    // 쿨타임이 끝난 뒤의 우클릭은 이동과 함께 즉시 전환 (postureHeld = false → 토스트 없음)
    store.toasts = [];
    r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: f.id, anchorTileId: c + 5 }]], store);
    expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK, postureHeld: false });
    expect(r.msgs.find((m) => m.type === 'flag_posture_changed')).toMatchObject({ auto: true, posture: POSTURE.ATTACK });
    expect(store.toasts.length).toBe(0);
    expect(g.flags.get(f.id)!.posture).toBe(POSTURE.ATTACK);
  });

  it('쿨타임 중이어도 도착지 기본 태세가 이미 현재 태세면 postureHeld = false (토스트 없음)', () => {
    const { state, sim, c } = scenario();
    const f = addFlag(state, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, anchor: c + 2, posture: POSTURE.ATTACK, state: 'MARCHING' });
    const store = bootstrap(state);
    step(sim, [], store);
    step(sim, [[1, { type: 'cmd_set_posture', flagId: f.id, posture: POSTURE.DEFEND }]], store);
    store.toasts = [];
    const r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: f.id, anchorTileId: state.players[1].homeTileId }]], store); // 내 땅 → 기본 DEFEND = 현재
    expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND, postureHeld: false });
    expect(store.toasts.length).toBe(0);
  });

  it('전투 중 전환: 수락 + posture_changed → disengage_started 같은 tick → "태세 전환 중", 대기 끝 wait_over 로 조용히 닫히고 전투에 남는다', () => {
    const { state, sim, c } = scenario();
    setTileOwner(state, c, 2, false);
    setTileOwner(state, c + 1, 1, false);
    const mine = addFlag(state, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c + 1, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
    addFlag(state, { ownerId: 2, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const store = bootstrap(state);
    const g = store.game!;
    step(sim, [], store);
    expect(g.flags.get(mine.id)!.inCombat).toBe(true);
    // 버튼이 막히지 않고 경고가 실제 이탈 대기 초를 쓴다
    const st = flagActionState(g.flags.get(mine.id)!, g.tick, g.config.tickMs, disengageTicksOf(g, 1));
    expect(st.postureBlocked).toBeNull();
    expect(st.combatWarning).toBe('교전 중 전환: 이탈 대기 3초, 방어력 ×0.5');
    const r = step(sim, [[1, { type: 'cmd_set_posture', flagId: mine.id, posture: POSTURE.DEFEND }]], store);
    expect(r.acks[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
    const types = r.msgs.map((m) => m.type);
    expect(types.indexOf('flag_posture_changed')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('flag_disengage_started')).toBeGreaterThan(types.indexOf('flag_posture_changed'));
    const mf = g.flags.get(mine.id)!;
    expect(mf.disengageUntilTick).toBe(state.tick + DISENGAGE_TICKS);
    expect(g.disengageForPosture.has(mine.id)).toBe(true);
    // 쿨타임 중이라 버튼은 다시 막힌다 (이탈 대기 때문이 아니라)
    expect(flagActionState(mf, g.tick, g.config.tickMs).postureBlocked).toMatch(/^전환 대기 \d초$/);
    let over: ServerMessage | undefined;
    for (let i = 0; i < DISENGAGE_TICKS + 2 && !over; i++) over = step(sim, [], store).msgs.find((m) => m.type === 'flag_disengaged');
    expect(over).toMatchObject({ flagId: mine.id, reason: 'wait_over' });
    expect(g.disengageForPosture.has(mine.id)).toBe(false);
    expect(g.flags.get(mine.id)!.disengageUntilTick).toBeNull();
    expect(g.flags.get(mine.id)!.inCombat).toBe(true);
  });
});
