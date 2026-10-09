/**
 * 깃발 명령과 상태 전이 헬퍼 (GDD 4.3 / 4.3a / 4.4 재지정·회수 / 4.15 f·g).
 * 명령 처리는 tick 1단계에서만 호출된다.
 */
import {
  ANY_HOSTILE,
  DISENGAGE_TICKS,
  FLAG_MIN_TROOPS,
  FLAG_RETARGET_LOCK_TICK,
  FRONT_MAX_RANGE,
  MOB_CONVERT_PERMILLE_BY_TIER,
  POSTURE,
  POSTURE_COOLDOWN_TICKS,
  UNIT_CONVERT_PERMILLE,
  isClaimable,
  type C2S_CmdFlagIssue,
  type C2S_CmdFlagRecall,
  type C2S_CmdFlagRetarget,
  type C2S_CmdSetPosture,
  type CmdRejectReason,
  type FlagEndReason,
  type Posture,
  type Unit,
} from '@civwar/shared';
import { flagCap } from './economy.js';
import type { Outbox } from './outbox.js';
import { etaTicks, minDistFromTerritory, mobilityTier, recallTarget, stepToward } from './rules.js';
import { isAlly, makeFlag, type Flag, type GameState } from './state.js';

export type CmdResult = { reason: CmdRejectReason } | { flagId: number; posture: Posture };

export function flagById(state: Readonly<GameState>, id: number): Flag | undefined {
  // state.flags 는 id 오름차순 — 이진 탐색
  let lo = 0;
  let hi = state.flags.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const f = state.flags[m];
    if (f.id === id) return f;
    if (f.id < id) lo = m + 1;
    else hi = m - 1;
  }
  return undefined;
}

function validTile(state: Readonly<GameState>, t: unknown): t is number {
  return typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < state.owners.length;
}

/** 깃발 제거 (슬롯 해제) + flagsGone + flag_ended */
export function removeFlag(state: GameState, f: Flag, t: number, reason: FlagEndReason, refunded: number, out: Outbox): void {
  const i = state.flags.indexOf(f);
  if (i >= 0) state.flags.splice(i, 1);
  state.changes.flagsGone.push(f.id);
  out.broadcast.push({ type: 'flag_ended', tick: t, flagId: f.id, reason, refunded });
}

/** 4.3a applyPosture — 수동 전환·재지정·앵커 함락 재파생 공통 */
export function applyPosture(state: GameState, f: Flag, posture: Posture, t: number): void {
  f.posture = posture;
  f.postureCooldownUntilTick = t + POSTURE_COOLDOWN_TICKS;
  f.progressMilli = 0;
  f.targetTileId = null;
  f.stalled = false;
  f.stallSinceTick = null;
  f.spendBudgetMilli = 0;
  const ao = state.owners[f.anchorTileId];
  f.targetOwnerId = ao === f.ownerId ? ANY_HOSTILE : ao;
}

function resetGauge(f: Flag): void {
  f.progressMilli = 0;
  f.targetTileId = null;
  f.stalled = false;
  f.stallSinceTick = null;
  f.spendBudgetMilli = 0;
}

/** RETURNING 개시 (회수·IDLE 타임아웃·패주 공통) */
export function beginReturn(state: GameState, f: Flag): void {
  f.state = 'RETURNING';
  f.idleSinceTick = null;
  resetGauge(f);
  f.returnTileId = recallTarget(state, f);
  f.nextTileId = stepToward(state, f.ownerId, f.posTileId, f.returnTileId);
}

function startDisengageIfInCombat(f: Flag, t: number, out: Outbox): void {
  if (f.inCombat && f.disengageUntilTick === null) {
    f.disengageUntilTick = t + DISENGAGE_TICKS;
    out.broadcast.push({ type: 'flag_disengage_started', tick: t, flagId: f.id, untilTick: f.disengageUntilTick });
  }
}

// ───────────────────────── 4.3 발령 ─────────────────────────

export function issueFlag(state: GameState, playerId: number, msg: C2S_CmdFlagIssue, t: number, out: Outbox): CmdResult {
  const p = state.players[playerId];
  const unit = msg.unit;
  const anchor = msg.anchorTileId;
  if (!validTile(state, anchor) || !Number.isInteger(msg.troops)) return { reason: 'BAD_REQUEST' };
  const mine = state.flags.filter((f) => f.ownerId === playerId);
  if (mine.length >= flagCap(p)) return { reason: 'NO_SLOT' };
  if (unit !== 0 && unit !== 1 && unit !== 2) return { reason: 'BAD_UNIT' };
  if (!isClaimable(state.map.terrain[anchor])) return { reason: 'WATER' };
  if (minDistFromTerritory(state, playerId, anchor) > FRONT_MAX_RANGE) return { reason: 'OUT_OF_RANGE' };
  if (msg.troops < FLAG_MIN_TROOPS) return { reason: 'TOO_SMALL' };

  const anchorOwner = state.owners[anchor];
  let posture: Posture;
  let targetOwnerId: number;
  if (anchorOwner === playerId) {
    posture = POSTURE.DEFEND;
    targetOwnerId = ANY_HOSTILE;
  } else {
    if (isAlly(state, playerId, anchorOwner)) return { reason: 'ALLIED' };
    posture = POSTURE.ATTACK;
    targetOwnerId = anchorOwner;
  }

  let origin: number;
  const ob = msg.originBaseTileId;
  if (ob !== undefined && ob !== null) {
    if (!validTile(state, ob) || !state.map.isBase[ob]) return { reason: 'NOT_BASE' };
    if (state.owners[ob] !== playerId) return { reason: 'NOT_OWNED_BASE' };
    origin = ob;
  } else if (p.baseTiles.length) {
    origin = argminDist(state, p.baseTiles, anchor);
  } else {
    const own: number[] = [];
    for (let i = 0; i < state.owners.length; i++) if (state.owners[i] === playerId) own.push(i);
    origin = argminDist(state, own, p.homeTileId);
  }

  const convertEff = MOB_CONVERT_PERMILLE_BY_TIER[mobilityTier(p)];
  const poolCost = Math.ceil((msg.troops * UNIT_CONVERT_PERMILLE[unit]) / convertEff);
  if (poolCost * 1000 > p.troopsMilli) return { reason: 'INSUFFICIENT' };

  p.troopsMilli -= poolCost * 1000;
  state.ledger.conversion += poolCost * 1000 - msg.troops * 1000;
  const used = new Set(mine.map((f) => f.slotIndex));
  let slot = 0;
  while (used.has(slot)) slot++;
  const f = makeFlag({
    id: state.nextFlagId++,
    ownerId: playerId,
    slotIndex: slot,
    unit: unit as Unit,
    troopsMilli: msg.troops * 1000,
    initialTroops: msg.troops,
    posTileId: origin,
    anchorTileId: anchor,
    originTileId: origin,
  });
  f.posture = posture;
  f.targetOwnerId = targetOwnerId;
  f.nextTileId = stepToward(state, playerId, origin, anchor);
  state.flags.push(f); // id 단조증가 → 정렬 유지
  out.broadcast.push({
    type: 'flag_issued',
    tick: t,
    flagId: f.id,
    playerId,
    slotIndex: slot,
    unit: f.unit,
    posture,
    troops: msg.troops,
    originTileId: origin,
    anchorTileId: anchor,
    targetOwnerId,
    etaTick: t + etaTicks(state, f, origin, anchor),
  });
  return { flagId: f.id, posture };
}

function argminDist(state: Readonly<GameState>, tiles: readonly number[], to: number): number {
  let best = tiles[0];
  let bd = Infinity;
  for (const x of tiles) {
    const d = state.graph.distance(x, to);
    if (d < bd || (d === bd && x < best)) {
      best = x;
      bd = d;
    }
  }
  return best;
}

// ───────────────────────── 4.4 재지정 ─────────────────────────

export function retargetFlag(state: GameState, playerId: number, msg: C2S_CmdFlagRetarget, t: number, out: Outbox): CmdResult {
  const f = flagById(state, msg.flagId);
  if (!f || f.ownerId !== playerId) return { reason: 'NO_FLAG' };
  if (f.routed) return { reason: 'ROUTED' };
  if (f.state === 'RETURNING' && !f.inCombat) return { reason: 'RETURNING' };
  // LOCKED: 재지정 경직 중 재재지정 금지. 단 이탈 대기 중엔 허용 (4.15 g "목적지만 바뀌고 타이머 유지")
  if (t < f.lockUntilTick && f.disengageUntilTick === null) return { reason: 'LOCKED' };
  const anchor = msg.anchorTileId;
  if (!validTile(state, anchor)) return { reason: 'BAD_REQUEST' };
  if (!isClaimable(state.map.terrain[anchor])) return { reason: 'WATER' };
  const newOwner = state.owners[anchor];
  if (isAlly(state, playerId, newOwner)) return { reason: 'ALLIED' };
  if (minDistFromTerritory(state, playerId, anchor) > FRONT_MAX_RANGE) return { reason: 'OUT_OF_RANGE' };

  f.anchorTileId = anchor;
  const def: Posture = newOwner === playerId ? POSTURE.DEFEND : POSTURE.ATTACK;
  let postureChanged = false;
  if (def !== f.posture && t >= f.postureCooldownUntilTick && !f.inCombat) {
    applyPosture(state, f, def, t);
    postureChanged = true;
  }
  f.postureManual = false;
  f.targetOwnerId = newOwner === playerId ? ANY_HOSTILE : newOwner;
  startDisengageIfInCombat(f, t, out);
  f.state = 'MARCHING';
  f.idleSinceTick = null;
  f.lockUntilTick = t + FLAG_RETARGET_LOCK_TICK;
  resetGauge(f);
  f.returnTileId = null;
  f.nextTileId = stepToward(state, playerId, f.posTileId, anchor);
  out.broadcast.push({
    type: 'flag_retargeted',
    tick: t,
    flagId: f.id,
    anchorTileId: anchor,
    targetOwnerId: f.targetOwnerId,
    posture: f.posture,
    resumeTick: f.lockUntilTick,
    etaTick: f.lockUntilTick + etaTicks(state, f, f.posTileId, anchor),
    auto: false,
  });
  if (postureChanged) {
    out.broadcast.push({ type: 'flag_posture_changed', tick: t, flagId: f.id, posture: f.posture, cooldownUntilTick: f.postureCooldownUntilTick, auto: true, targetOwnerId: f.targetOwnerId });
  }
  return { flagId: f.id, posture: f.posture };
}

// ───────────────────────── 회수 ─────────────────────────

export function recallFlag(state: GameState, playerId: number, msg: C2S_CmdFlagRecall, t: number, out: Outbox): CmdResult {
  const f = flagById(state, msg.flagId);
  if (!f || f.ownerId !== playerId) return { reason: 'NO_FLAG' };
  if (f.routed) return { reason: 'ROUTED' };
  if (f.state === 'RETURNING' && !f.inCombat) return { reason: 'RETURNING' };
  startDisengageIfInCombat(f, t, out);
  beginReturn(state, f);
  out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
  return { flagId: f.id, posture: f.posture };
}

// ───────────────────────── 4.3a 태세 전환 ─────────────────────────

export function setPosture(state: GameState, playerId: number, msg: C2S_CmdSetPosture, t: number, out: Outbox): CmdResult {
  const f = flagById(state, msg.flagId);
  if (!f || f.ownerId !== playerId) return { reason: 'NO_FLAG' };
  if (f.routed) return { reason: 'ROUTED' };
  if (f.disengageUntilTick !== null) return { reason: 'DISENGAGING' };
  if (f.inCombat) return { reason: 'IN_COMBAT' };
  if (msg.posture === f.posture) return { reason: 'SAME_POSTURE' };
  if (t < f.postureCooldownUntilTick) return { reason: 'POSTURE_COOLDOWN' };
  applyPosture(state, f, msg.posture, t);
  f.postureManual = true;
  out.broadcast.push({ type: 'flag_posture_changed', tick: t, flagId: f.id, posture: f.posture, cooldownUntilTick: f.postureCooldownUntilTick, auto: false, targetOwnerId: f.targetOwnerId });
  return { flagId: f.id, posture: f.posture };
}

