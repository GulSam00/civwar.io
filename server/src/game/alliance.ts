/**
 * 동맹 (GDD 6.2) — 제안·수락·파기·백스탭 쿨다운·신규 체결 마감·Lockout.
 * 동맹 판정(isAlly = ACTIVE ∪ BREAKING)은 front 제외·깃발 전투 편 구성·노출 소모·ZOC 에 쓰인다.
 */
import {
  ALLIANCE_CUTOFF_TICK,
  ALLIANCE_MIN_DURATION,
  BACKSTAB_COOLDOWN_TICK,
  FLAG_IDLE_TIMEOUT,
  LOCKOUT_COUNTDOWN_TICK,
  LOCKOUT_FREEZE_TICK,
  MAX_ALLIES_PER_PLAYER,
  POSTURE,
  PROPOSAL_TTL_TICK,
  type C2S_CmdAllyBreak,
  type C2S_CmdAllyPropose,
  type C2S_CmdAllyRespond,
  type CmdRejectReason,
} from '@civwar/shared';
import type { Outbox } from './outbox.js';
import { isAlly, rebuildAllyMatrix, type GameState } from './state.js';

function allyCount(state: Readonly<GameState>, id: number): number {
  return state.alliances.filter((a) => a.a === id || a.b === id).length;
}

function validPlayer(state: Readonly<GameState>, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id < state.players.length && !!state.players[id] && state.players[id].alive;
}

function formAlliance(state: GameState, x: number, y: number, t: number, out: Outbox): void {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  state.alliances.push({ a, b, state: 'ACTIVE', sinceTick: t, breakAtTick: null });
  state.alliances.sort((p, q) => p.a - q.a || p.b - q.b);
  rebuildAllyMatrix(state);
  out.broadcast.push({ type: 'ally_formed', tick: t, a, b });
  // 둘 사이의 남은 제안 정리
  for (const p of state.proposals.slice()) {
    if ((p.from === a && p.to === b) || (p.from === b && p.to === a)) closeProposal(state, p.id, 'formed', t, out);
  }
  // 상대를 향해 행군/교전 중인 깃발 → 즉시 IDLE + 게이지 0
  for (const f of state.flags) {
    if (f.posture !== POSTURE.ATTACK || f.routed) continue;
    if (f.state !== 'MARCHING' && f.state !== 'ENGAGED') continue;
    const other = f.ownerId === a ? b : f.ownerId === b ? a : 0;
    if (!other || f.targetOwnerId !== other) continue;
    f.state = 'IDLE';
    f.idleSinceTick = t;
    f.progressMilli = 0;
    f.targetTileId = null;
    f.stalled = false;
    f.stallSinceTick = null;
    f.spendBudgetMilli = 0;
    out.broadcast.push({ type: 'flag_idle', tick: t, flagId: f.id, reason: 'allied', autoRecallTick: t + FLAG_IDLE_TIMEOUT });
  }
}

function closeProposal(state: GameState, id: number, reason: 'declined' | 'expired' | 'formed' | 'invalidated', t: number, out: Outbox): void {
  const i = state.proposals.findIndex((p) => p.id === id);
  if (i < 0) return;
  state.proposals.splice(i, 1);
  out.broadcast.push({ type: 'ally_proposal_closed', tick: t, proposalId: id, reason });
}

/** 체결 가능 여부 (제안·수락 공통) */
function formBlocker(state: Readonly<GameState>, me: number, other: number, t: number): CmdRejectReason | null {
  if (t >= ALLIANCE_CUTOFF_TICK) return 'ALLY_CUTOFF';
  if (state.allianceFreezeUntilTick !== null && t < state.allianceFreezeUntilTick) return 'ALLY_FROZEN';
  if (isAlly(state, me, other)) return 'ALREADY_ALLIED';
  if (allyCount(state, me) >= MAX_ALLIES_PER_PLAYER || allyCount(state, other) >= MAX_ALLIES_PER_PLAYER) return 'ALLY_LIMIT';
  return null;
}

export function allyPropose(state: GameState, me: number, msg: C2S_CmdAllyPropose, t: number, out: Outbox): CmdRejectReason | null {
  const to = msg.targetPlayerId;
  if (to === me || !validPlayer(state, to)) return 'BAD_TARGET';
  const blk = formBlocker(state, me, to, t);
  if (blk) return blk;
  if (state.proposals.some((p) => p.from === me && p.to === to)) return 'ALLY_PENDING';
  const reverse = state.proposals.find((p) => p.from === to && p.to === me);
  if (reverse) {
    formAlliance(state, me, to, t, out); // 상호 제안 → 즉시 성립
    return null;
  }
  const id = state.nextProposalId++;
  state.proposals.push({ id, from: me, to, expireTick: t + PROPOSAL_TTL_TICK });
  out.broadcast.push({ type: 'ally_proposed', tick: t, proposalId: id, fromPlayerId: me, toPlayerId: to, expireTick: t + PROPOSAL_TTL_TICK });
  return null;
}

export function allyRespond(state: GameState, me: number, msg: C2S_CmdAllyRespond, t: number, out: Outbox): CmdRejectReason | null {
  const p = state.proposals.find((x) => x.id === msg.proposalId && x.to === me);
  if (!p) return 'NO_PROPOSAL';
  if (!msg.accept) {
    closeProposal(state, p.id, 'declined', t, out);
    return null;
  }
  if (!validPlayer(state, p.from)) {
    closeProposal(state, p.id, 'invalidated', t, out);
    return 'BAD_TARGET';
  }
  const blk = formBlocker(state, me, p.from, t);
  if (blk) return blk;
  formAlliance(state, me, p.from, t, out);
  return null;
}

export function allyBreak(state: GameState, me: number, msg: C2S_CmdAllyBreak, t: number, out: Outbox): CmdRejectReason | null {
  const x = Math.min(me, msg.allyPlayerId);
  const y = Math.max(me, msg.allyPlayerId);
  const a = state.alliances.find((q) => q.a === x && q.b === y);
  if (!a || a.state !== 'ACTIVE') return 'NOT_ALLIED';
  if (t - a.sinceTick < ALLIANCE_MIN_DURATION) return 'MIN_DURATION';
  a.state = 'BREAKING';
  a.breakAtTick = t + BACKSTAB_COOLDOWN_TICK;
  rebuildAllyMatrix(state);
  out.broadcast.push({ type: 'ally_break_started', tick: t, a: x, b: y, byPlayerId: me, breakAtTick: a.breakAtTick });
  return null;
}

/** 3단계 외교 타이머 */
export function allianceTimers(state: GameState, t: number, out: Outbox): void {
  for (const p of state.proposals.slice()) if (t >= p.expireTick) closeProposal(state, p.id, 'expired', t, out);
  let changed = false;
  for (const a of state.alliances.slice()) {
    if (a.state === 'BREAKING' && a.breakAtTick !== null && t >= a.breakAtTick) {
      state.alliances.splice(state.alliances.indexOf(a), 1);
      out.broadcast.push({ type: 'ally_broken', tick: t, a: a.a, b: a.b, reason: 'cooldown_elapsed' });
      changed = true;
    }
  }
  if (changed) rebuildAllyMatrix(state);
  if (state.allianceFreezeUntilTick !== null && t >= state.allianceFreezeUntilTick) state.allianceFreezeUntilTick = null;

  // Lockout — 생존자 전원이 동맹 그래프 한 덩어리
  const alive: number[] = [];
  for (let id = 1; id < state.players.length; id++) if (state.players[id]?.alive) alive.push(id);
  let all = false;
  if (alive.length >= 2) {
    const seen = new Set<number>([alive[0]]);
    const q = [alive[0]];
    while (q.length) {
      const u = q.pop()!;
      for (const v of alive) if (!seen.has(v) && isAlly(state, u, v)) {
        seen.add(v);
        q.push(v);
      }
    }
    all = seen.size === alive.length;
  }
  if (all) {
    if (state.lockoutDissolveTick === null) {
      state.lockoutDissolveTick = t + LOCKOUT_COUNTDOWN_TICK;
      out.broadcast.push({ type: 'alliance_lockout', tick: t, phase: 'countdown', reason: 'all_allied', forceDissolveTick: state.lockoutDissolveTick, freezeUntilTick: null });
    } else if (t >= state.lockoutDissolveTick) {
      for (const a of state.alliances) out.broadcast.push({ type: 'ally_broken', tick: t, a: a.a, b: a.b, reason: 'lockout' });
      state.alliances = [];
      rebuildAllyMatrix(state);
      for (const p of state.proposals.slice()) closeProposal(state, p.id, 'invalidated', t, out);
      state.allianceFreezeUntilTick = t + LOCKOUT_FREEZE_TICK;
      state.lockoutDissolveTick = null;
      out.broadcast.push({ type: 'alliance_lockout', tick: t, phase: 'dissolved', reason: 'all_allied', forceDissolveTick: null, freezeUntilTick: state.allianceFreezeUntilTick });
    }
  } else if (state.lockoutDissolveTick !== null) {
    state.lockoutDissolveTick = null;
    out.broadcast.push({ type: 'alliance_lockout', tick: t, phase: 'cancelled', reason: 'all_allied', forceDissolveTick: null, freezeUntilTick: null });
  }
}

/** 탈락 시 동맹·제안 즉시 소멸 (4.14) */
export function dropPlayerDiplomacy(state: GameState, id: number, t: number, out: Outbox): void {
  const keep = [];
  for (const a of state.alliances) {
    if (a.a === id || a.b === id) out.broadcast.push({ type: 'ally_broken', tick: t, a: a.a, b: a.b, reason: 'eliminated' });
    else keep.push(a);
  }
  state.alliances = keep;
  rebuildAllyMatrix(state);
  for (const p of state.proposals.slice()) if (p.from === id || p.to === id) closeProposal(state, p.id, 'invalidated', t, out);
}
