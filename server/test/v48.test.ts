/**
 * v4.6 (프로토콜 §27, 사용자 2026-10-19): 태세 전환 즉시 적용 — 쿨타임 = "같은 깃발이 다시 전환하기까지의 시간".
 * pendingPosture 폐기, 전투 중 전환 = 회수와 같은 이탈 대기(3초 ×0.5), 우클릭 이동의 자동 태세는 쿨타임 중이면 유지.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DISENGAGE_TICKS, POSTURE, FLAG_ORDER_COOLDOWN_TICKS, TERRAIN, UNIT, isClaimable, type C2S_GameCommand, type ServerMessage } from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { beginReturn } from '../src/game/flagops.js';
import { etaTicks } from '../src/game/rules.js';
import { buildSnapshotFull, flagBits } from '../src/game/snapshot.js';
import { NEUTRAL, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup));
}

function findOpenArea(s: GameState, r: number): number {
  const W = s.map.width;
  const H = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('no open area');
}

function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number; anchor?: number } & Partial<Flag>): Flag {
  const f = makeFlag({
    id: s.nextFlagId++,
    ownerId: o.ownerId,
    slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length,
    unit: o.unit,
    troopsMilli: o.troops * 1000,
    initialTroops: o.troops,
    posTileId: o.pos,
    anchorTileId: o.anchor ?? o.pos,
    originTileId: o.pos,
  });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, anchor: _a, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}

function scenario(seed = 4242) {
  const sim = makeSim(seed);
  const s = sim.state;
  const c = findOpenArea(s, 8);
  for (const t of s.graph.disk(c, 8)) s.map.terrain[t] = TERRAIN.PLAIN;
  return { sim, s, c };
}

function run(sim: Simulation, n: number) {
  const all: ServerMessage[] = [];
  const personal: ServerMessage[] = [];
  for (let i = 0; i < n; i++) {
    const out = sim.step();
    all.push(...out.broadcast);
    personal.push(...out.personal.map((p) => p.msg));
    expect(ledgerImbalance(sim.state)).toBe(0);
  }
  return { all, personal };
}

/** 공격 1 (c+1, 검, ATTACK) ↔ 수비 2 (c, 검, DEFEND). 수비가 땅 주인 */
function fight(opts: { attackerPosture?: 0 | 1 } = {}) {
  const { sim, s, c } = scenario();
  setTileOwner(s, c, 2, false);
  setTileOwner(s, c + 1, 1, false);
  const atk = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c + 1, anchor: c, posture: opts.attackerPosture ?? POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
  const def = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
  run(sim, 1);
  expect(atk.inCombat && def.inCombat).toBe(true);
  return { sim, s, c, atk, def };
}

describe('v4.6 태세 전환 즉시 적용 (§27)', () => {
  it('쿨타임이 안 돌면 즉시 전환, 전환 직후 쿨타임 시작, 쿨타임 중 재전환은 ORDER_COOLDOWN (대기열 없음)', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 1, flagId: f.id, posture: POSTURE.ATTACK });
    const r = run(sim, 1);
    const t0 = s.tick;
    expect(r.personal[0]).toEqual({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: f.id, posture: POSTURE.ATTACK });
    expect(f.posture).toBe(POSTURE.ATTACK); // 같은 tick 에 이미 적용
    expect(f.orderCooldownUntilTick).toBe(t0 + FLAG_ORDER_COOLDOWN_TICKS);
    expect(r.all.find((m) => m.type === 'flag_posture_changed')).toMatchObject({ flagId: f.id, posture: POSTURE.ATTACK, cooldownUntilTick: t0 + FLAG_ORDER_COOLDOWN_TICKS });
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 2, flagId: f.id, posture: POSTURE.DEFEND });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'ORDER_COOLDOWN' });
    expect(f.posture).toBe(POSTURE.ATTACK); // 거절 — 나중에 적용되는 요청이 남지 않는다
    run(sim, FLAG_ORDER_COOLDOWN_TICKS + 3);
    expect(f.posture).toBe(POSTURE.ATTACK);
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 3, flagId: f.id, posture: POSTURE.DEFEND });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
  });

  it('IN_COMBAT / DISENGAGING 거절은 더 이상 없다 — 전투 중 전환도 수락', () => {
    const { sim, def } = fight();
    sim.enqueue(2, 2, { type: 'cmd_set_posture', clientSeq: 1, flagId: def.id, posture: POSTURE.ATTACK });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK });
  });

  it('전투 중 전환: 즉시 적용 + 회수와 같은 이탈 대기(3초, 실효값 ×0.5), 제자리 깃발은 만료돼도 전투에 남는다 (wait_over)', () => {
    const { sim, s, atk, def } = fight();
    // 대조군: 같은 싸움을 전환 없이 15 tick
    const ctl = fight();
    run(ctl.sim, DISENGAGE_TICKS + 1);
    const ctlLoss = 1000 * 1000 - ctl.def.troopsMilli;

    sim.enqueue(2, 2, { type: 'cmd_set_posture', clientSeq: 1, flagId: def.id, posture: POSTURE.ATTACK });
    const r = run(sim, 1);
    const t0 = s.tick;
    expect(def.posture).toBe(POSTURE.ATTACK);
    expect(def.disengageUntilTick).toBe(t0 + DISENGAGE_TICKS);
    expect(def.disengageHold).toBe(true);
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toMatchObject({ flagId: def.id, untilTick: t0 + DISENGAGE_TICKS, auto: false });
    expect(r.all.find((m) => m.type === 'flag_posture_changed')).toMatchObject({ flagId: def.id });
    const r2 = run(sim, DISENGAGE_TICKS);
    expect(r2.all.find((m) => m.type === 'flag_disengaged')).toMatchObject({ flagId: def.id, reason: 'wait_over' });
    expect(def.disengageUntilTick).toBeNull();
    expect(def.disengageHold).toBe(false);
    expect(def.breakaway).toBe(false); // 영구 면역 방지
    expect(def.inCombat).toBe(true);
    expect(atk.inCombat).toBe(true);
    // 공격 태세 검 vs 공격 태세 검 (정상 1000 vs 1000) 이지만 ×0.5 로 3초간 더 잃는다 — 대조군(방어 지형 1000, 같은 1000)보다 수비 손실이 크다
    expect(1000 * 1000 - def.troopsMilli).toBeGreaterThan(ctlLoss);
  });

  it('공격→방어 전환으로 방어↔방어가 돼도 이탈 대기 동안은 전투가 유지되고, 대기가 끝나면 끊긴다 (공짜 탈출 없음)', () => {
    const { sim, s, atk, def } = fight();
    const d0 = def.troopsMilli;
    const a0 = atk.troopsMilli;
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 1, flagId: atk.id, posture: POSTURE.DEFEND });
    run(sim, 1);
    const t0 = s.tick;
    expect(atk.posture).toBe(POSTURE.DEFEND);
    expect(atk.disengageUntilTick).toBe(t0 + DISENGAGE_TICKS);
    run(sim, DISENGAGE_TICKS - 2);
    expect(atk.inCombat).toBe(true); // 방어↔방어인데도 간선 유지
    expect(a0 - atk.troopsMilli).toBeGreaterThan(0);
    expect(d0 - def.troopsMilli).toBeGreaterThan(0);
    const aMid = atk.troopsMilli;
    const r = run(sim, 4);
    expect(r.all.find((m) => m.type === 'flag_disengaged')).toMatchObject({ flagId: atk.id, reason: 'wait_over' });
    expect(atk.inCombat).toBe(false);
    expect(def.inCombat).toBe(false);
    expect(r.all.map((m) => m.type)).toContain('combat_ended');
    const aEnd = atk.troopsMilli;
    run(sim, 20);
    expect(atk.troopsMilli).toBe(aEnd); // 이후 손실 없음
    expect(aMid).toBeGreaterThanOrEqual(aEnd);
  });

  it('전투 중 전환 직후 쿨타임: 다시 전환하면 ORDER_COOLDOWN', () => {
    const { sim, def } = fight();
    sim.enqueue(2, 2, { type: 'cmd_set_posture', clientSeq: 1, flagId: def.id, posture: POSTURE.ATTACK });
    run(sim, 1);
    sim.enqueue(2, 2, { type: 'cmd_set_posture', clientSeq: 2, flagId: def.id, posture: POSTURE.DEFEND });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'ORDER_COOLDOWN' });
  });

  it('귀환·패주 깃발은 종전대로 RETURNING / ROUTED 거절', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    beginReturn(s, f);
    sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 2, flagId: f.id, posture: POSTURE.ATTACK });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'RETURNING' });
  });
});

describe('v5.6 깃발 조작 — 경직 제거 · 공용 쿨타임 · 위치 기반 태세 폐지', () => {
  const idleFlag = (posture: 0 | 1) => {
    const { sim, s, c } = scenario();
    for (const t of s.graph.disk(c, 3)) setTileOwner(s, t, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, anchor: c, posture, state: 'IDLE', idleSinceTick: 0 });
    return { sim, s, c, f };
  };
  const retarget = (flagId: number, anchorTileId: number, clientSeq = 1): C2S_GameCommand => ({ type: 'cmd_flag_retarget', clientSeq, flagId, anchorTileId });
  const setPosture = (flagId: number, posture: 0 | 1, clientSeq = 2): C2S_GameCommand => ({ type: 'cmd_set_posture', clientSeq, flagId, posture });

  it('재지정은 경직 없이 바로 움직이고 ETA 에 경직이 없다', () => {
    const { sim, s, c, f } = idleFlag(POSTURE.ATTACK);
    sim.enqueue(1, 1, retarget(f.id, c + 2));
    const r = run(sim, 1);
    const ev = r.all.find((m) => m.type === 'flag_retargeted');
    expect(ev).toMatchObject({ flagId: f.id, cooldownUntilTick: s.tick + FLAG_ORDER_COOLDOWN_TICKS });
    expect(f.moveProgMilli).toBeGreaterThan(0); // 같은 tick 4단계부터 이동
    expect(ev && 'etaTick' in ev ? ev.etaTick - ev.tick : 0).toBe(etaTicks(s, { ...f, posTileId: c }, c, c + 2));
  });

  it('공격 깃발은 내 땅으로 재지정해도 공격 그대로, 방어 깃발은 내 땅으로 가면 방어 그대로', () => {
    const a = idleFlag(POSTURE.ATTACK);
    a.sim.enqueue(1, 1, retarget(a.f.id, a.c + 2));
    const ra = run(a.sim, 1);
    expect(ra.personal[0]).toEqual({ type: 'cmd_ack', clientSeq: 1, accepted: true, flagId: a.f.id, posture: POSTURE.ATTACK });
    expect(ra.all.find((m) => m.type === 'flag_posture_changed')).toBeUndefined();
    const d = idleFlag(POSTURE.DEFEND);
    d.sim.enqueue(1, 1, retarget(d.f.id, d.c + 2));
    expect(run(d.sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
  });

  it('방어 깃발을 중립·적 땅으로 재지정하면 공격으로 자동 전환, 쿨타임은 한 번', () => {
    const d = idleFlag(POSTURE.DEFEND);
    const neutral = d.s.graph.disk(d.c, 6).find((x) => d.s.owners[x] === NEUTRAL && isClaimable(d.s.map.terrain[x]))!;
    d.sim.enqueue(1, 1, retarget(d.f.id, neutral));
    const r = run(d.sim, 1);
    expect(r.personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK });
    expect(d.f.posture).toBe(POSTURE.ATTACK);
    expect(d.f.orderCooldownUntilTick).toBe(d.s.tick + FLAG_ORDER_COOLDOWN_TICKS);
    expect(r.all.find((m) => m.type === 'flag_retargeted')).toMatchObject({ posture: POSTURE.ATTACK });
    expect(r.all.find((m) => m.type === 'flag_posture_changed')).toMatchObject({ flagId: d.f.id, posture: POSTURE.ATTACK, cooldownUntilTick: d.f.orderCooldownUntilTick, targetOwnerId: NEUTRAL });
    const e = idleFlag(POSTURE.DEFEND);
    const foe = e.c + 4;
    setTileOwner(e.s, foe, 2, false);
    e.sim.enqueue(1, 1, retarget(e.f.id, foe));
    expect(run(e.sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK });
    expect(e.f.targetOwnerId).toBe(2);
  });

  it('전투 중 방어 깃발의 적 땅 재지정: 공격 전환 + 이탈 대기 동안 간선 유지', () => {
    const { sim, s, c, def } = fight();
    expect(def.posture).toBe(POSTURE.DEFEND);
    const anchor = s.graph.neighbors(c).find((x) => s.owners[x] === 1 && isClaimable(s.map.terrain[x]))!;
    sim.enqueue(2, 2, { type: 'cmd_flag_retarget', clientSeq: 1, flagId: def.id, anchorTileId: anchor });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK });
    expect(def.disengageUntilTick).not.toBeNull();
    expect(def.disengageHold).toBe(true);
    expect(def.inCombat).toBe(true);
  });

  it('재지정 뒤 쿨타임 중에는 재지정·태세 변경 둘 다 ORDER_COOLDOWN, 끝나면 둘 다 가능', () => {
    const { sim, c, f } = idleFlag(POSTURE.ATTACK);
    sim.enqueue(1, 1, retarget(f.id, c + 2));
    run(sim, 1);
    sim.enqueue(1, 1, retarget(f.id, c + 1, 2));
    sim.enqueue(1, 1, setPosture(f.id, POSTURE.DEFEND, 3));
    expect(run(sim, 1).personal).toMatchObject([{ accepted: false, reason: 'ORDER_COOLDOWN' }, { accepted: false, reason: 'ORDER_COOLDOWN' }]);
    run(sim, FLAG_ORDER_COOLDOWN_TICKS - 2);
    sim.enqueue(1, 1, setPosture(f.id, POSTURE.DEFEND, 4));
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true });
  });

  it('태세 변경 뒤 쿨타임 중에는 재지정도 거절된다', () => {
    const { sim, c, f } = idleFlag(POSTURE.ATTACK);
    sim.enqueue(1, 1, setPosture(f.id, POSTURE.DEFEND));
    run(sim, 1);
    sim.enqueue(1, 1, retarget(f.id, c + 2));
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'ORDER_COOLDOWN' });
    expect(f.anchorTileId).toBe(c);
  });

  it('이탈 대기 중에도 쿨타임 예외는 없다', () => {
    const { sim, c, atk } = fight();
    sim.enqueue(1, 1, retarget(atk.id, c + 1));
    run(sim, 1);
    expect(atk.disengageUntilTick).not.toBeNull();
    sim.enqueue(1, 1, retarget(atk.id, c, 2));
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'ORDER_COOLDOWN' });
  });

  it('회수는 쿨타임에 막히지 않는다', () => {
    const { sim, c, f } = idleFlag(POSTURE.ATTACK);
    sim.enqueue(1, 1, retarget(f.id, c + 2));
    run(sim, 1);
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 2, flagId: f.id });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true });
    expect(f.state).toBe('RETURNING');
  });

  it('출전 태세는 명령이 정하고, 출전 직후 쿨타임이 없다', () => {
    const { sim, s } = idleFlag(POSTURE.ATTACK);
    const home = s.players[1].homeTileId;
    const issue = (clientSeq: number, posture: 0 | 1): C2S_GameCommand => ({ type: 'cmd_flag_issue', clientSeq, unit: UNIT.SWORD, troops: 60, anchorTileId: home, posture, originBaseTileId: null });
    sim.enqueue(1, 1, issue(1, POSTURE.ATTACK));
    const r = run(sim, 1);
    expect(r.personal[0]).toMatchObject({ accepted: true, posture: POSTURE.ATTACK }); // 내 땅인데도 공격
    expect(r.all.find((m) => m.type === 'flag_issued')).toMatchObject({ posture: POSTURE.ATTACK, targetOwnerId: 254 });
    const f = s.flags.find((x) => x.id === (r.personal[0] as { flagId: number }).flagId)!;
    expect(f.orderCooldownUntilTick).toBe(0);
    sim.enqueue(1, 1, setPosture(f.id, POSTURE.DEFEND));
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
  });

  it('IDLE 깃발의 태세 전환은 새 태세로 다시 판정한다: 내 땅의 공격 깃발이 방어로 바뀌면 수비에 들어가 자동 귀환하지 않는다', () => {
    const { sim, s, c, f } = idleFlag(POSTURE.ATTACK);
    for (const t of s.graph.disk(c, 6)) setTileOwner(s, t, 1, false);
    f.idleSinceTick = s.tick;
    sim.enqueue(1, 1, setPosture(f.id, POSTURE.DEFEND));
    const r = run(sim, 1);
    expect(r.all.find((m) => m.type === 'flag_engaged')).toMatchObject({ flagId: f.id, posture: POSTURE.DEFEND });
    expect(f.state).toBe('ENGAGED');
    expect(f.idleSinceTick).toBeNull();
  });

  it('공격 태세로 내 땅 깊숙이 가면 IDLE 뒤 기존 자동 귀환 규칙을 따른다', () => {
    const { sim, s, c, f } = idleFlag(POSTURE.ATTACK);
    for (const t of s.graph.disk(c, 6)) setTileOwner(s, t, 1, false);
    sim.enqueue(1, 1, retarget(f.id, c + 1));
    const r = run(sim, 40);
    expect(f.posture).toBe(POSTURE.ATTACK);
    expect(f.state).toBe('IDLE');
    expect(r.all.find((m) => m.type === 'flag_idle')).toMatchObject({ reason: 'front_cleared' });
  });
});

describe('v4.6 직렬화 · 결정론', () => {
  it('스냅숏·델타에 pendingPosture 필드와 비트 128 이 없다', () => {
    const { sim, s, c } = scenario();
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, anchor: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    f.orderCooldownUntilTick = s.tick + 50;
    const neutral = s.graph.disk(c, 8).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]))!;
    sim.enqueue(1, 1, { type: 'cmd_flag_retarget', clientSeq: 1, flagId: f.id, anchorTileId: neutral });
    for (let i = 0; i < 60; i++) {
      const out = sim.step();
      expect(flagBits(f) & 128).toBe(0);
      for (const m of out.broadcast) {
        if (m.type === 'snapshot_delta') for (const ff of m.flagFlags ?? []) expect(ff[2] & 128).toBe(0);
      }
    }
    for (const fl of buildSnapshotFull(s).flags) expect(fl).not.toHaveProperty('pendingPosture');
  });

  it('같은 시드·같은 명령이면 전투 중 전환 포함 결과가 동일하다', () => {
    const play = () => {
      const { sim, atk, def } = fight();
      const h = createHash('sha256');
      for (let i = 0; i < 160; i++) {
        if (i === 3) sim.enqueue(2, 2, { type: 'cmd_set_posture', clientSeq: 1, flagId: def.id, posture: POSTURE.ATTACK });
        if (i === 40) sim.enqueue(1, 1, { type: 'cmd_set_posture', clientSeq: 2, flagId: atk.id, posture: POSTURE.DEFEND });
        const out = sim.step();
        h.update(JSON.stringify(out.broadcast));
      }
      return h.digest('hex');
    };
    expect(play()).toBe(play());
  });
});
