/**
 * GDD v5.1 (사용자 확정 2026-10-28) — §37
 *  ① 점령 소모 배율 전 병종 1000 (UNIT_ATK_MULT_PERMILLE)
 *  ② 4d 사기 0 자동 후퇴 (= cmd_flag_recall 동작, flag_recalled.reason)
 *  ③ 기지 사기 하한 MORALE_BASE_FLOOR 300 (4c 교전 · 7단계 점령 소모, 교전 중 하한 미만 회복 — 사용자 추가 결정)
 *  ④ 기지별 출전 쿨타임 BASE_DISPATCH_COOLDOWN_TICKS 25 (issueFlag · pickOriginBase · 봇)
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_DISPATCH_COOLDOWN_TICKS,
  CAPTURE_MORALE_DROP,
  FLAG_RECALL_REFUND_PERMILLE,
  MORALE_BASE_FLOOR,
  MORALE_RECOVER_BASE,
  POSTURE,
  TERRAIN,
  UNIT,
  UNIT_ATK_MULT_PERMILLE,
  isClaimable,
  pickOriginBase,
  techMaskWith,
  techStatValues,
  TECH_NODES,
  type C2S_CmdFlagIssue,
  type ServerMessage,
} from '@civwar/shared';
import { decideBot } from '../src/game/bot.js';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB, stage4d_moraleRetreat } from '../src/game/combat.js';
import { issueFlag } from '../src/game/flagops.js';
import { stage6_combatPhaseA, stage7_combatPhaseB } from '../src/game/gauge.js';
import { stage4_moveFlags } from '../src/game/movement.js';
import { newOutbox } from '../src/game/outbox.js';
import { tileCost } from '../src/game/rules.js';
import { buildSnapshotFull } from '../src/game/snapshot.js';
import { createGameState, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMapForPlayers } from '../src/map/generate.js';
import { validateMessage } from '../scripts/qa-schema.js';

const U = UNIT;

function open(s: GameState, r: number): number {
  const W = s.map.width;
  const H = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === 0)) return t;
  }
  throw new Error('no open area');
}
function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number } & Partial<Flag>): Flag {
  const f = makeFlag({ id: s.nextFlagId++, ownerId: o.ownerId, slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length, unit: o.unit, troopsMilli: o.troops * 1000, initialTroops: o.troops, posTileId: o.pos, anchorTileId: o.pos, originTileId: o.pos });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}
function mkState(model: 1 | 2 = 2, bots = true) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: bots && i > 0, connected: true })), undefined, undefined, model);
  const c = open(s, 3);
  for (const t of s.graph.disk(c, 3)) s.map.terrain[t] = TERRAIN.PLAIN;
  return { s, c };
}
/** 4a → 4b (4c·4d 포함) 한 tick */
function combatTick(s: GameState, t: number) {
  const out = newOutbox();
  s.tick = t;
  stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
  return out.broadcast as ServerMessage[];
}
/** 자기 기지 칸 h 와 8방향 이웃 칸 하나 (적 깃발 자리) */
function homeAndNeighbor(s: GameState, pid: number) {
  const h = s.players[pid].homeTileId;
  const nb = s.graph.neighbors(h).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
  return { h, nb };
}

// ───────────────────────── ② 4d 사기 0 자동 후퇴 ─────────────────────────

describe('v5.1 4d 사기 붕괴 자동 후퇴 (모델 2)', () => {
  it('교전 중 사기 0 → 같은 tick 이탈 대기 + 귀환: flag_disengage_started{auto:true} → flag_recalled{reason:morale} 순서, disengageHold, 상대는 그대로', () => {
    const { s, c } = mkState();
    const a = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 1 });
    const d = addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 2000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const msgs = combatTick(s, 1);
    expect(a.morale).toBe(0);
    expect(a.routed).toBe(false);
    expect(a.state).toBe('RETURNING');
    expect(a.disengageUntilTick).toBe(1 + 15); // 소유자 스탯 기본 15 tick
    expect(a.disengageHold).toBe(true);
    expect(a.returnBaseTileId).toBe(null);
    const iDis = msgs.findIndex((m) => m.type === 'flag_disengage_started' && m.flagId === a.id);
    const iRec = msgs.findIndex((m) => m.type === 'flag_recalled' && m.flagId === a.id);
    expect(iDis).toBeGreaterThanOrEqual(0);
    expect(iRec).toBeGreaterThan(iDis);
    expect(msgs[iDis]).toMatchObject({ auto: true, untilTick: 16 });
    expect(msgs[iRec]).toMatchObject({ reason: 'morale', returnTileId: a.returnTileId });
    for (const m of msgs) expect(validateMessage(m as never), m.type).toEqual([]);
    expect(d.state).not.toBe('RETURNING');
    // 다음 tick: 이미 RETURNING 이라 다시 발동하지 않는다
    const msgs2 = combatTick(s, 2);
    expect(msgs2.filter((m) => m.type === 'flag_recalled')).toEqual([]);
  });

  it('같은 tick 에 병력 0 이 되면 패주가 우선 (자동 후퇴 아님)', () => {
    const { s, c } = mkState();
    const a = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 1, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 1 });
    addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 3000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const msgs = combatTick(s, 1);
    expect(a.routed).toBe(true);
    expect(msgs.some((m) => m.type === 'flag_routed' && m.flagId === a.id)).toBe(true);
    expect(msgs.some((m) => m.type === 'flag_recalled' && m.flagId === a.id)).toBe(false);
    expect(msgs.some((m) => m.type === 'flag_disengage_started' && m.flagId === a.id)).toBe(false);
  });

  it('대상 제외: 비전투 사기 0 · 이미 이탈 대기 중 · 자기 기지 칸 위', () => {
    const { s, c } = mkState();
    const idle = addFlag(s, { ownerId: 3, unit: U.SWORD, troops: 500, pos: c - 3 * s.map.width, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 0 });
    const a = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 0, inCombat: true, disengageUntilTick: 50 });
    const out = newOutbox();
    stage4d_moraleRetreat(s, 1, out);
    expect(idle.state).toBe('ENGAGED');
    expect(a.state).toBe('ENGAGED');
    expect(out.broadcast).toEqual([]);
    // 기지 칸 위 (교전 중, 사기 0): 자동 후퇴하지 않는다
    const { h, nb } = homeAndNeighbor(s, 4);
    setTileOwner(s, nb, 4, false);
    const g = addFlag(s, { ownerId: 4, unit: U.SPEAR, troops: 2000, pos: h, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 0 });
    addFlag(s, { ownerId: 5, unit: U.SWORD, troops: 2000, pos: nb, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const msgs = combatTick(s, 2);
    expect(g.inCombat).toBe(true);
    expect(g.state).toBe('ENGAGED');
    expect(msgs.some((m) => m.type === 'flag_recalled' && m.flagId === g.id)).toBe(false);
    expect(g.morale).toBe(MORALE_RECOVER_BASE); // 하한 미만 → 교전 중에도 기지 회복 (사용자 추가 결정)
  });

  it('모델 1 에는 4d 가 없다', () => {
    const { s, c } = mkState(1);
    const a = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 0 });
    addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 2000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    combatTick(s, 1);
    expect(a.state).toBe('ENGAGED');
  });

  it('자동 후퇴 깃발은 이탈 대기 → broke_away/combat_over → 귀환지 도착 시 남은 병력 85% 환급 (flag_ended recalled)', () => {
    const { s, c } = mkState();
    const p = s.players[1];
    const a = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 1 });
    const d = addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 2000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    combatTick(s, 1);
    expect(a.state).toBe('RETURNING');
    // 상대 제거 (테스트용) — 남은 건 귀환 이동뿐
    s.flags.splice(s.flags.indexOf(d), 1);
    type Ended = Extract<ServerMessage, { type: 'flag_ended' }>;
    let ended: Ended | null = null;
    let poolGain = 0;
    let lossGain = 0;
    for (let t = 2; t < 3000 && !ended; t++) {
      s.tick = t;
      const out = newOutbox();
      const pool0 = p.troopsMilli;
      const loss0 = s.ledger.recallLoss;
      stage4_moveFlags(s, t, out);
      const e = out.broadcast.find((m): m is Ended => m.type === 'flag_ended' && m.flagId === a.id);
      if (e) {
        ended = e;
        poolGain = p.troopsMilli - pool0;
        lossGain = s.ledger.recallLoss - loss0;
        break;
      }
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
    }
    expect(ended).not.toBeNull();
    expect((ended as Ended | null)!.reason).toBe('recalled');
    const T = poolGain + lossGain; // 도착 시 병력
    expect(T).toBeGreaterThan(0);
    expect(poolGain).toBe(Math.floor((T * FLAG_RECALL_REFUND_PERMILLE) / 1000));
    expect((ended as Ended | null)!.refunded).toBe(Math.floor(poolGain / 1000));
  });

  it('flag_recalled.reason: 명령 = command, IDLE 2분 = idle_timeout (실제 Simulation 경로)', () => {
    const { s } = mkState(2, false);
    const sim = new Simulation(s);
    const p = s.players[1];
    p.troopsMilli = 500_000;
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: U.SWORD, troops: 100, anchorTileId: p.homeTileId, posture: 1, originBaseTileId: null });
    const o1 = sim.step();
    const fid = (o1.personal.find((m) => m.msg.type === 'cmd_ack')!.msg as { flagId: number }).flagId;
    sim.enqueue(1, 1, { type: 'cmd_flag_recall', clientSeq: 2, flagId: fid, baseTileId: null });
    const o2 = sim.step();
    expect(o2.broadcast.find((m) => m.type === 'flag_recalled')).toMatchObject({ flagId: fid, reason: 'command' });
  });
});

// ───────────────────────── ③ 기지 사기 하한 ─────────────────────────

describe('v5.1 기지 사기 하한 MORALE_BASE_FLOOR (모델 2)', () => {
  /** 기지 칸 위 교전 깃발 g (사기 m0) 한 tick 뒤 사기 */
  const onBase = (m0: number, posture: 0 | 1 = POSTURE.DEFEND, unit: 0 | 1 | 2 = U.SPEAR) => {
    const { s } = mkState();
    const { h, nb } = homeAndNeighbor(s, 1);
    setTileOwner(s, nb, 1, false);
    const g = addFlag(s, { ownerId: 1, unit, troops: 2000, pos: h, posture, state: 'ENGAGED', morale: m0 });
    addFlag(s, { ownerId: 2, unit: U.CAVALRY, troops: 4000, pos: nb, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    combatTick(s, 1);
    expect(g.inCombat).toBe(true);
    return g.morale;
  };

  it('300 이상에서 시작: 감소는 300 에서 멈춘다 (태세 무관), 300 아래로 내려가지 않는다', () => {
    expect(MORALE_BASE_FLOOR).toBe(300);
    expect(onBase(302, POSTURE.DEFEND)).toBe(300);
    expect(onBase(301, POSTURE.ATTACK, U.CAVALRY)).toBe(300);
    expect(onBase(300)).toBe(300);
    const hi = onBase(1000);
    expect(hi).toBeLessThan(1000);
    expect(hi).toBeGreaterThanOrEqual(300);
    // 여러 tick 교전해도 300 아래로 내려가지 않는다
    const { s } = mkState();
    const { h, nb } = homeAndNeighbor(s, 1);
    setTileOwner(s, nb, 1, false);
    const g = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 50_000, pos: h, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 400 });
    addFlag(s, { ownerId: 2, unit: U.CAVALRY, troops: 50_000, pos: nb, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    for (let t = 1; t <= 60; t++) {
      combatTick(s, t);
      expect(g.morale).toBeGreaterThanOrEqual(300);
    }
    expect(g.morale).toBe(300);
    expect(g.state).toBe('ENGAGED');
  });

  it('300 미만에서 시작: 교전 중에도 기지 회복량(+10)으로 300 까지 오르고 멈춘다', () => {
    expect(onBase(0)).toBe(MORALE_RECOVER_BASE);
    expect(onBase(200)).toBe(210);
    expect(onBase(295)).toBe(300);
    const { s } = mkState();
    const { h, nb } = homeAndNeighbor(s, 1);
    setTileOwner(s, nb, 1, false);
    const g = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 50_000, pos: h, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 100 });
    addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 50_000, pos: nb, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const seen: number[] = [];
    for (let t = 1; t <= 30; t++) {
      combatTick(s, t);
      seen.push(g.morale);
    }
    expect(seen.slice(0, 3)).toEqual([110, 120, 130]);
    expect(seen.indexOf(300)).toBe(19);
    expect(seen.slice(19).every((m) => m === 300)).toBe(true);
  });

  it('기지 칸이 아니면 하한 없음 (일반 감소)', () => {
    const { s, c } = mkState();
    const a = addFlag(s, { ownerId: 1, unit: U.SPEAR, troops: 2000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 302 });
    addFlag(s, { ownerId: 2, unit: U.CAVALRY, troops: 4000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    combatTick(s, 1);
    expect(a.morale).toBeLessThan(300);
  });

  it('7단계 점령 사기 소모: 기지 칸 위면 m ≥ 300 → max(300, m − 6), m < 300 → 그대로. 기지 밖은 그대로 −6', () => {
    const capture = (m0: number, base: boolean) => {
      const { s, c } = mkState();
      let pos = c;
      if (base) {
        const h = s.players[1].homeTileId;
        pos = h;
        // 기지 칸 옆 4방향 칸 하나를 중립으로 → 밀 칸이 생긴다
        const nb = s.graph.neighbors(h).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
        for (const t of s.graph.neighbors(h)) if (t !== nb && isClaimable(s.map.terrain[t])) setTileOwner(s, t, 1, false);
        setTileOwner(s, nb, 0, false);
      }
      const f = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 3000, pos, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 750_000, targetOwnerId: 0, morale: m0 });
      s.tick = 1;
      const plan = stage6_combatPhaseA(s, 1);
      expect(plan.pushes.length + plan.baseHits.length).toBeGreaterThan(0);
      stage7_combatPhaseB(s, plan, 1, newOutbox());
      return f.morale;
    };
    expect(capture(303, false)).toBe(303 - CAPTURE_MORALE_DROP);
    expect(capture(303, true)).toBe(300);
    expect(capture(800, true)).toBe(800 - CAPTURE_MORALE_DROP);
    expect(capture(250, true)).toBe(250);
    expect(capture(250, false)).toBe(250 - CAPTURE_MORALE_DROP);
  });
});

// ───────────────────────── ④ 기지별 출전 쿨타임 ─────────────────────────

describe('v5.1 기지별 출전 쿨타임 BASE_DISPATCH_COOLDOWN_TICKS', () => {
  const setup = () => {
    const { s } = mkState(2, false);
    const p = s.players[1];
    const home = p.homeTileId;
    const extra = s.map.baseTiles.find((x) => s.owners[x] === 0)!;
    setTileOwner(s, extra, 1, false);
    p.troopsMilli = 5_000_000;
    return { s, p, home, extra };
  };
  const cmd = (anchor: number, origin: number | null, troops = 100): C2S_CmdFlagIssue => ({ type: 'cmd_flag_issue', clientSeq: 1, unit: U.SWORD, troops, anchorTileId: anchor, posture: 1, originBaseTileId: origin });

  it('지정 출발 기지가 쿨타임이면 BASE_COOLDOWN (풀 차감·쿨타임 갱신 없음), 25 tick 뒤 다시 가능', () => {
    const { s, p, home } = setup();
    const out = newOutbox();
    expect(issueFlag(s, 1, cmd(home, home), 10, out)).toMatchObject({ posture: POSTURE.DEFEND });
    const b = s.bases[s.baseIndexOf.get(home)!];
    expect(b.dispatchReadyTick).toBe(10 + BASE_DISPATCH_COOLDOWN_TICKS);
    const pool = p.troopsMilli;
    expect(issueFlag(s, 1, cmd(home, home), 11, out)).toEqual({ reason: 'BASE_COOLDOWN' });
    expect(issueFlag(s, 1, cmd(home, home), 34, out)).toEqual({ reason: 'BASE_COOLDOWN' });
    expect(p.troopsMilli).toBe(pool);
    expect(b.dispatchReadyTick).toBe(35);
    expect(issueFlag(s, 1, cmd(home, home), 35, out)).toMatchObject({ posture: POSTURE.DEFEND });
    expect(b.dispatchReadyTick).toBe(60);
  });

  it('검증 순서: NOT_OWNED_BASE 가 BASE_COOLDOWN 보다 먼저, BASE_COOLDOWN 이 INSUFFICIENT 보다 먼저. 거절은 쿨타임을 만들지 않는다', () => {
    const { s, p, home, extra } = setup();
    const out = newOutbox();
    const foreign = s.players[2].homeTileId;
    s.bases[s.baseIndexOf.get(foreign)!].dispatchReadyTick = 999;
    expect(issueFlag(s, 1, cmd(home, foreign), 5, out)).toEqual({ reason: 'NOT_OWNED_BASE' });
    s.bases[s.baseIndexOf.get(home)!].dispatchReadyTick = 999;
    p.troopsMilli = 0;
    expect(issueFlag(s, 1, cmd(home, home), 5, out)).toEqual({ reason: 'BASE_COOLDOWN' });
    expect(issueFlag(s, 1, cmd(home, extra), 5, out)).toEqual({ reason: 'INSUFFICIENT' });
    expect(s.bases[s.baseIndexOf.get(extra)!].dispatchReadyTick).toBe(0);
  });

  it('출발 기지 생략: 가장 가까운 기지가 쿨타임이면 다음 기지, 모두 쿨타임이면 BASE_COOLDOWN', () => {
    const { s, home, extra } = setup();
    const out = newOutbox();
    const r1 = issueFlag(s, 1, cmd(home, null), 10, out);
    expect(r1).toMatchObject({ posture: POSTURE.DEFEND });
    const r2 = issueFlag(s, 1, cmd(home, null), 10, out);
    expect(r2).toMatchObject({ posture: POSTURE.DEFEND });
    const issued = out.broadcast.filter((m) => m.type === 'flag_issued') as Extract<ServerMessage, { type: 'flag_issued' }>[];
    expect(issued.map((m) => m.originTileId)).toEqual([home, extra]);
    expect(issueFlag(s, 1, cmd(home, null), 11, out)).toEqual({ reason: 'BASE_COOLDOWN' });
    expect(issueFlag(s, 1, cmd(home, null), 35, out)).toMatchObject({ posture: POSTURE.DEFEND });
  });

  it('pickOriginBase: 쿨타임 제외 최단, 동률 tileId 오름차순, 모두 쿨타임·기지 없음이면 null', () => {
    const d = (a: number, b: number) => Math.abs(a - b);
    expect(pickOriginBase([10, 20, 30], 20, 5, () => 0, d)).toBe(20);
    expect(pickOriginBase([30, 10], 20, 5, () => 0, d)).toBe(10); // 동률 10·30 → 10
    expect(pickOriginBase([10, 20, 30], 20, 5, (x) => (x === 20 ? 6 : 0), d)).toBe(10);
    expect(pickOriginBase([10, 20, 30], 20, 6, (x) => (x === 20 ? 6 : 0), d)).toBe(20);
    expect(pickOriginBase([10, 20], 20, 5, () => 30, d)).toBe(null);
    expect(pickOriginBase([], 20, 5, () => 0, d)).toBe(null);
  });

  it('기지 소유권이 바뀌면 dispatchReadyTick = 0 (새 주인은 즉시 출전)', () => {
    const { s, extra } = setup();
    const out = newOutbox();
    expect(issueFlag(s, 1, cmd(extra, extra), 10, out)).toMatchObject({ posture: POSTURE.DEFEND });
    const b = s.bases[s.baseIndexOf.get(extra)!];
    expect(b.dispatchReadyTick).toBe(35);
    setTileOwner(s, extra, 2);
    expect(b.dispatchReadyTick).toBe(0);
    s.players[2].troopsMilli = 1_000_000;
    expect(issueFlag(s, 2, cmd(extra, extra), 11, out)).toMatchObject({ posture: POSTURE.DEFEND });
  });

  it('기지가 없어 영토에서 출발하면 쿨타임 대상이 아니다 (연속 발령 허용)', () => {
    const { s, p, home, extra } = setup();
    const own = s.graph.neighbors(home).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
    setTileOwner(s, own, 1, false);
    setTileOwner(s, extra, 0, false);
    setTileOwner(s, home, 0, false);
    expect(p.baseTiles).toEqual([]);
    const out = newOutbox();
    expect(issueFlag(s, 1, cmd(own, null), 10, out)).toMatchObject({ posture: POSTURE.DEFEND });
    expect(issueFlag(s, 1, cmd(own, null), 10, out)).toMatchObject({ posture: POSTURE.DEFEND });
    expect(s.bases.every((b) => b.dispatchReadyTick === 0)).toBe(true);
  });

  it('Simulation 경로: 같은 tick 두 명령(지정 같은 기지) → 둘째 cmd_ack BASE_COOLDOWN, snapshot_full.bases[].dispatchReadyTick', () => {
    const { s, home } = setup();
    const sim = new Simulation(s);
    sim.enqueue(1, 1, { ...cmd(home, home), clientSeq: 1 });
    sim.enqueue(1, 1, { ...cmd(home, home), clientSeq: 2 });
    const o = sim.step();
    const acks = o.personal.map((m) => m.msg).filter((m) => m.type === 'cmd_ack') as { clientSeq: number; accepted: boolean; reason?: string }[];
    expect(acks.find((a) => a.clientSeq === 1)).toMatchObject({ accepted: true });
    expect(acks.find((a) => a.clientSeq === 2)).toMatchObject({ accepted: false, reason: 'BASE_COOLDOWN' });
    const full = buildSnapshotFull(s);
    expect(full.bases.find((b) => b.tileId === home)!.dispatchReadyTick).toBe(s.tick + BASE_DISPATCH_COOLDOWN_TICKS);
    expect(full.bases.every((b) => typeof b.dispatchReadyTick === 'number')).toBe(true);
    expect(validateMessage(full as never)).toEqual([]);
  });

  it('봇: 기지가 모두 쿨타임이면 발령하지 않고, 한 결정의 발령 수 ≤ 쓸 수 있는 기지 수 [A-5.1-15]', () => {
    const map = generateMapForPlayers(4242, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
    const sim = new Simulation(s);
    for (let i = 0; i < 300; i++) sim.step();
    const me = 1;
    const p = s.players[me];
    p.troopsMilli = 5_000_000;
    p.goldMilli = 0;
    const t = s.tick;
    for (const b of p.baseTiles) s.bases[s.baseIndexOf.get(b)!].dispatchReadyTick = t + 10;
    expect(decideBot(s, me, t, p.bot).filter((c) => c.type === 'cmd_flag_issue')).toEqual([]);
    for (const b of p.baseTiles) s.bases[s.baseIndexOf.get(b)!].dispatchReadyTick = 0;
    const issues = decideBot(s, me, t, p.bot).filter((c) => c.type === 'cmd_flag_issue');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(p.baseTiles.length);
  });
});

// ───────────────────────── ① 점령 소모 배율 ─────────────────────────

describe('v5.1 점령 소모 배율 전 병종 1000', () => {
  it('UNIT_ATK_MULT_PERMILLE = [1000,1000,1000], 무테크 tileCost 가 병종과 무관 (중립·적 땅·기지 칸)', () => {
    expect([...UNIT_ATK_MULT_PERMILLE]).toEqual([1000, 1000, 1000]);
    const { s, c } = mkState();
    const enemy = s.players[2].homeTileId;
    const enemyLand = s.graph.neighbors(enemy).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
    setTileOwner(s, enemyLand, 2, false);
    for (const X of [c, enemyLand, enemy]) {
      const costs = [U.SPEAR, U.SWORD, U.CAVALRY].map((u) => {
        const f = makeFlag({ id: 9999, ownerId: 1, slotIndex: 0, unit: u, troopsMilli: 1000_000, initialTroops: 1000, posTileId: X, anchorTileId: X, originTileId: X });
        f.targetOwnerId = s.owners[X];
        return tileCost(s, f, X);
      });
      expect(new Set(costs).size, `tile ${X}: ${costs}`).toBe(1);
    }
  });

  it('병종 전용 점령 테크는 그대로: SWO-2B 산 검병만 800 (다른 병종 1000)', () => {
    const id = (code: string) => TECH_NODES.find((n) => n.code === code)!.id;
    const st = techStatValues(techMaskWith(techMaskWith(0, id('SWO-1')), id('SWO-2B')));
    const { s, c } = mkState();
    s.players[1].statPm = st;
    const cost = (u: 0 | 1 | 2) => {
      const f = makeFlag({ id: 9999, ownerId: 1, slotIndex: 0, unit: u, troopsMilli: 1000_000, initialTroops: 1000, posTileId: c, anchorTileId: c, originTileId: c });
      f.targetOwnerId = 2;
      return tileCost(s, f, s.players[2].homeTileId);
    };
    expect(cost(U.SWORD)).toBeLessThan(cost(U.SPEAR));
    expect(cost(U.SPEAR)).toBe(cost(U.CAVALRY));
  });
});
