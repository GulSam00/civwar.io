/**
 * v4.7 (프로토콜 §29, 사용자 2026-10-22) 교전 길이 대책 A5:
 *  - 시스템 규칙 A3: 교전 중 회수도 이탈 대기(3초 ×0.5) + 접촉 간선 유지 (사람·봇 공통)
 *  - 봇 전용: 전투 시작 후 BOT_MIN_ENGAGE_TICKS(50) 동안 후퇴·회수·재지정 명령을 내지 않는다
 */
import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTY, BOT_MIN_ENGAGE_TICKS, DISENGAGE_TICKS, POSTURE, TERRAIN, UNIT, isClaimable, type ServerMessage } from '@civwar/shared';
import { decideBot } from '../src/game/bot.js';
import { generateMapForPlayers } from '../src/map/generate.js';
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

/** 공격 1 (c+1, ATTACK) ↔ 수비 2 (c, DEFEND). 수비가 땅 주인 */
function fight(atkTroops = 1000, defTroops = 1000) {
  const sim = makeSim();
  const s = sim.state;
  const c = findOpenArea(s, 8);
  for (const t of s.graph.disk(c, 8)) s.map.terrain[t] = TERRAIN.PLAIN;
  setTileOwner(s, c, 2, false);
  setTileOwner(s, c + 1, 1, false);
  const atk = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: atkTroops, pos: c + 1, anchor: c, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED' });
  const def = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: defTroops, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
  run(sim, 1);
  expect(atk.inCombat && def.inCombat).toBe(true);
  return { sim, s, c, atk, def };
}

describe('v4.7 A3 — 교전 중 회수의 이탈 대기 (§29)', () => {
  it('공격 깃발이 방어 깃발과 싸우다 회수: 3초 이탈 대기 동안 간선 유지(전투 계속, ×0.5), 만료 시 broke_away', () => {
    const { sim, s, atk, def } = fight();
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 1, flagId: atk.id });
    const r = run(sim, 1);
    const t0 = s.tick;
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toMatchObject({ flagId: atk.id, untilTick: t0 + DISENGAGE_TICKS, auto: false });
    expect(atk.state).toBe('RETURNING');
    expect(atk.disengageHold).toBe(true);
    // RETURNING 이라 공격 쪽이 아니지만(상대는 방어) 대기 동안 전투가 이어진다 — 예전엔 즉시 combat_over
    expect(atk.inCombat && def.inCombat).toBe(true);
    const before = atk.posTileId;
    const r2 = run(sim, DISENGAGE_TICKS - 1);
    expect(atk.inCombat).toBe(true);
    expect(atk.posTileId).toBe(before); // 대기 중엔 움직이지 않는다
    const r3 = run(sim, 1);
    expect([...r2.all, ...r3.all].find((m) => m.type === 'flag_disengaged')).toMatchObject({ flagId: atk.id, reason: 'broke_away' });
    expect(atk.disengageHold).toBe(false);
    expect(atk.breakaway).toBe(true);
    expect(atk.inCombat).toBe(false);
  });

  it('방어 깃발이 회수해도 똑같이 적용된다 (공격 쪽이 있으니 간선은 원래 유지)', () => {
    const { sim, s, atk, def } = fight();
    sim.enqueue(2, 2, { type: 'cmd_flag_recall', clientSeq: 1, flagId: def.id });
    const r = run(sim, 1);
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toMatchObject({ flagId: def.id, untilTick: s.tick + DISENGAGE_TICKS, auto: false });
    expect(def.inCombat && atk.inCombat).toBe(true);
  });

  it('비전투 회수는 이탈 대기·hold 없음', () => {
    const sim = makeSim();
    const s = sim.state;
    const c = findOpenArea(s, 8);
    setTileOwner(s, c, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 200, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 1, flagId: f.id });
    const r = run(sim, 1);
    expect(f.disengageUntilTick).toBeNull();
    expect(f.disengageHold).toBe(false);
    expect(r.all.find((m) => m.type === 'flag_disengage_started')).toBeUndefined();
  });

  it('이미 귀환 중인 깃발·패주 깃발은 회수가 거절되어 이중 부과가 없다', () => {
    const { sim, atk, def } = fight();
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 1, flagId: atk.id });
    run(sim, 1);
    const until = atk.disengageUntilTick;
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 2, flagId: atk.id });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'RETURNING' });
    expect(atk.disengageUntilTick).toBe(until);
    def.routed = true;
    sim.enqueue(2, 2, { type: 'cmd_flag_recall', clientSeq: 1, flagId: def.id });
    expect(run(sim, 1).personal[0]).toMatchObject({ accepted: false, reason: 'ROUTED' });
  });
});

describe('v4.7 A5 — 봇 최소 교전 시간 (§29)', () => {
  it('전투 시작 50틱 안에는 불리해도 회수·재지정 명령이 없고, 50틱이 지나면 후퇴 규칙이 다시 작동한다', () => {
    const { s, def } = fight(2500, 1000); // 봇(2) 수비가 불리하지만 이탈 손실을 버틸 만큼은 남는다
    const cmdsOf = () => decideBot(s, 2, s.tick, BOT_DIFFICULTY.NORMAL).filter((c) => 'flagId' in c && c.flagId === def.id && (c.type === 'cmd_flag_recall' || c.type === 'cmd_flag_retarget'));
    def.combatSinceTick = s.tick - (BOT_MIN_ENGAGE_TICKS - 1);
    expect(cmdsOf()).toHaveLength(0);
    def.combatSinceTick = s.tick - BOT_MIN_ENGAGE_TICKS;
    expect(cmdsOf().map((c) => c.type)).toContain('cmd_flag_recall');
  });

  it('상수 = 50틱(10초)', () => {
    expect(BOT_MIN_ENGAGE_TICKS).toBe(50);
  });
});
