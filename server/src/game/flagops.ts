/**
 * 깃발 명령과 상태 전이 헬퍼 (GDD 4.3 / 4.3a / 4.4 재지정·회수 / 4.15 f·g).
 * 명령 처리는 tick 1단계에서만 호출된다.
 */
import {
  ANY_HOSTILE,
  FLAG_MIN_TROOPS,
  FLAG_RETARGET_LOCK_TICK,
  FRONT_MAX_RANGE,
  POSTURE,
  POSTURE_COOLDOWN_TICKS,
  isClaimable,
  type C2S_CmdFlagIssue,
  type C2S_CmdFlagRecall,
  type C2S_CmdFlagRetarget,
  type C2S_CmdSetPosture,
  type CmdRejectReason,
  type FlagEndReason,
  type Posture,
  type Unit,
  isBaseDispatchReady,
  nextDispatchReadyTick,
  pickOriginBase,
  techConvertPm,
  techDisengageTicks,
  type FlagRecallReason,
} from '@civwar/shared';
import { flagCap } from './economy.js';
import type { Outbox } from './outbox.js';
import { engageEtaTicks, etaTicks, minDistFromTerritory, nextStep, recallTarget, stepToward } from './rules.js';
import { isAlly, makeFlag, type Flag, type GameState } from './state.js';

export type CmdResult = { reason: CmdRejectReason } | { flagId: number; posture: Posture; postureHeld?: boolean };

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
  f.halted = false; // v4.2: 다음 4단계 settle 이 새 태세로 다시 판정
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

/**
 * RETURNING 개시 (회수·IDLE 타임아웃·패주 공통).
 * baseTileId: v4.2 [A-61] 지정 귀환 기지 — 회수 명령은 값/null, IDLE 자동 회수는 null, 패주는 생략(기존 지정 유지).
 */
export function beginReturn(state: GameState, f: Flag, baseTileId?: number | null): void {
  f.state = 'RETURNING';
  f.idleSinceTick = null;
  f.halted = false;
  f.disengageHold = false; // v4.6: 귀환은 종전 이탈 대기 규칙 (태세 전환 간선 유지 없음)
  if (baseTileId !== undefined) f.returnBaseTileId = baseTileId;
  resetGauge(f);
  f.returnTileId = recallTarget(state, f);
  f.nextTileId = stepToward(state, f.ownerId, f.posTileId, f.returnTileId);
}

function startDisengageIfInCombat(state: Readonly<GameState>, f: Flag, t: number, out: Outbox): void {
  if (f.inCombat && f.disengageUntilTick === null) {
    f.disengageUntilTick = t + techDisengageTicks(state.players[f.ownerId].statPm); // v4.5: 명령 수락 시점의 소유자 스탯 (MOB-2B 철수 훈련 10)
    out.broadcast.push({ type: 'flag_disengage_started', tick: t, flagId: f.id, untilTick: f.disengageUntilTick, auto: false });
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

  // v5.1 (GDD 2.5·4.2): 출발 기지 결정 — 지정이면 NOT_BASE → NOT_OWNED_BASE → BASE_COOLDOWN, 생략이면 쿨타임 아닌 가장 가까운 기지(shared pickOriginBase)
  let origin: number;
  let originIsBase = false;
  const ob = msg.originBaseTileId;
  if (ob !== undefined && ob !== null) {
    if (!validTile(state, ob) || !state.map.isBase[ob]) return { reason: 'NOT_BASE' };
    if (state.owners[ob] !== playerId) return { reason: 'NOT_OWNED_BASE' };
    if (!isBaseDispatchReady(baseDispatchReadyTick(state, ob), t)) return { reason: 'BASE_COOLDOWN' };
    origin = ob;
    originIsBase = true;
  } else if (p.baseTiles.length) {
    const pick = pickOriginBaseFor(state, playerId, anchor, t);
    if (pick === null) return { reason: 'BASE_COOLDOWN' };
    origin = pick;
    originIsBase = true;
  } else {
    const own: number[] = [];
    for (let i = 0; i < state.owners.length; i++) if (state.owners[i] === playerId) own.push(i);
    origin = argminDist(state, own, p.homeTileId);
  }

  // v4.3: 편성비 = 플레이어 스탯 CONVERT_<unit> (기병 1150, CAV-2A 1070). 전 병종 편성 효율(구 MOB_CONVERT)은 폐기 [A-75]
  const poolCost = Math.ceil((msg.troops * techConvertPm(p.statPm, unit)) / 1000);
  if (poolCost * 1000 > p.troopsMilli) return { reason: 'INSUFFICIENT' };

  p.troopsMilli -= poolCost * 1000;
  if (originIsBase) state.bases[state.baseIndexOf.get(origin)!].dispatchReadyTick = nextDispatchReadyTick(t); // 거절된 명령은 쿨타임을 만들지 않는다
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
  f.nextTileId = nextStep(state, f, origin, anchor); // v4.5: 방어 태세는 적 땅 회피 경로
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
    engageEtaTick: t + engageEtaTicks(state, f, origin, anchor),
  });
  return { flagId: f.id, posture };
}

/** v5.1: 기지 칸의 출전 준비 tick (기지가 아니면 0) */
export function baseDispatchReadyTick(state: Readonly<GameState>, tileId: number): number {
  const i = state.baseIndexOf.get(tileId);
  return i === undefined ? 0 : state.bases[i].dispatchReadyTick;
}

/**
 * v5.1: 출발 기지 생략 시 실제 출발 기지 (서버·봇 공용). 쿨타임이 아닌 내 기지 중 앵커까지 최단(동률 tileId ASC).
 * null = 내 기지가 없거나 모두 쿨타임. extraBusy = 봇이 한 결정 안에서 앞 발령에 쓴 기지 [A-5.1-15]
 */
export function pickOriginBaseFor(state: Readonly<GameState>, playerId: number, anchor: number, t: number, extraBusy?: ReadonlySet<number>): number | null {
  return pickOriginBase(
    state.players[playerId].baseTiles,
    anchor,
    t,
    (x) => (extraBusy?.has(x) ? Number.MAX_SAFE_INTEGER : baseDispatchReadyTick(state, x)),
    (a, b) => state.graph.distance(a, b),
  );
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
  if (f.state === 'RETURNING') return { reason: 'RETURNING' }; // v4.2 [A-62]: 귀환 취소 불가 — 전투 중이어도 거절 (QA I-2 수락 경로 폐기)
  // LOCKED: 재지정 경직 중 재재지정 금지. 단 이탈 대기 중엔 허용 (4.15 g "목적지만 바뀌고 타이머 유지")
  if (t < f.lockUntilTick && f.disengageUntilTick === null) return { reason: 'LOCKED' };
  const anchor = msg.anchorTileId;
  if (!validTile(state, anchor)) return { reason: 'BAD_REQUEST' };
  if (!isClaimable(state.map.terrain[anchor])) return { reason: 'WATER' };
  const newOwner = state.owners[anchor];
  if (isAlly(state, playerId, newOwner)) return { reason: 'ALLIED' };
  if (minDistFromTerritory(state, playerId, anchor) > FRONT_MAX_RANGE) return { reason: 'OUT_OF_RANGE' };

  f.anchorTileId = anchor;
  // v4.6 (§27, 사용자 2026-10-19): 태세 = 도착지의 기본 태세 (내 땅·내 기지 = DEFEND, 적·중립 = ATTACK).
  // 쿨타임이 안 돌면 이동과 함께 즉시 바꾼다(전투 중이어도). 쿨타임 중이면 이동은 하되 태세는 그대로 (postureHeld, 대기 없음).
  const def: Posture = newOwner === playerId ? POSTURE.DEFEND : POSTURE.ATTACK;
  let postureChanged = false;
  let postureHeld = false;
  if (def !== f.posture) {
    if (t >= f.postureCooldownUntilTick) {
      applyPosture(state, f, def, t);
      postureChanged = true;
    } else postureHeld = true;
  }
  f.postureManual = false;
  f.targetOwnerId = newOwner === playerId ? ANY_HOSTILE : newOwner;
  startDisengageIfInCombat(state, f, t, out);
  if (postureChanged && f.inCombat) f.disengageHold = true; // 방어↔방어로 바뀌어도 이탈 비용 없이 끊기지 않게 (§27 [A])
  f.state = 'MARCHING';
  f.halted = false;
  f.idleSinceTick = null;
  f.lockUntilTick = t + FLAG_RETARGET_LOCK_TICK;
  resetGauge(f);
  f.returnTileId = null;
  f.nextTileId = nextStep(state, f, f.posTileId, anchor); // v4.5: 방어 태세는 적 땅 회피 경로
  out.broadcast.push({
    type: 'flag_retargeted',
    tick: t,
    flagId: f.id,
    anchorTileId: anchor,
    targetOwnerId: f.targetOwnerId,
    posture: f.posture,
    resumeTick: f.lockUntilTick,
    etaTick: f.lockUntilTick + etaTicks(state, f, f.posTileId, anchor),
    engageEtaTick: f.lockUntilTick + engageEtaTicks(state, f, f.posTileId, anchor),
    auto: false,
    postureHeld,
  });
  if (postureChanged) {
    out.broadcast.push({ type: 'flag_posture_changed', tick: t, flagId: f.id, posture: f.posture, cooldownUntilTick: f.postureCooldownUntilTick, auto: true, targetOwnerId: f.targetOwnerId });
  }
  return { flagId: f.id, posture: f.posture, postureHeld };
}

// ───────────────────────── 회수 ─────────────────────────

/**
 * 회수 (4.4 v4.2). 검증 순서: NO_FLAG → ROUTED → RETURNING(전투 중이어도 거절 [A-62]) → baseTileId 지정 시 NOT_BASE / NOT_OWNED_BASE [A-61].
 * 전투 중이면 이탈 대기 개시 후 RETURNING (기존과 같다).
 */
export function recallFlag(state: GameState, playerId: number, msg: C2S_CmdFlagRecall, t: number, out: Outbox): CmdResult {
  const f = flagById(state, msg.flagId);
  if (!f || f.ownerId !== playerId) return { reason: 'NO_FLAG' };
  if (f.routed) return { reason: 'ROUTED' };
  if (f.state === 'RETURNING') return { reason: 'RETURNING' };
  const base = msg.baseTileId ?? null;
  if (base !== null) {
    if (!validTile(state, base) || !state.map.isBase[base]) return { reason: 'NOT_BASE' };
    if (state.owners[base] !== playerId) return { reason: 'NOT_OWNED_BASE' };
  }
  const wasInCombat = f.inCombat;
  startDisengageIfInCombat(state, f, t, out);
  beginReturn(state, f, base);
  // v4.7 (§29) A3 [A-128]: 교전 중 회수도 이탈 대기(3초, ×0.5) 동안 접촉 간선을 유지한다 — 상대가 방어 태세여도 공짜로 끊기지 않는다
  if (wasInCombat) f.disengageHold = true;
  out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId!, reason: 'command' });
  return { flagId: f.id, posture: f.posture };
}

/**
 * v5.1 (GDD 4.6) 사기 붕괴 자동 후퇴 — recallFlag 의 검증 뒤 본체와 같다 (지정 귀환 기지 없음).
 * 이탈 대기 개시(flag_disengage_started{auto:true}) → beginReturn(null) → disengageHold → flag_recalled{reason}.
 * 호출자(4d)가 inCombat·비패주·비귀환·비이탈대기를 보장한다.
 */
export function autoRecallFlag(state: GameState, f: Flag, t: number, reason: FlagRecallReason, out: Outbox): void {
  const wasInCombat = f.inCombat;
  if (wasInCombat && f.disengageUntilTick === null) {
    f.disengageUntilTick = t + techDisengageTicks(state.players[f.ownerId].statPm);
    out.broadcast.push({ type: 'flag_disengage_started', tick: t, flagId: f.id, untilTick: f.disengageUntilTick, auto: true });
  }
  beginReturn(state, f, null);
  if (wasInCombat) f.disengageHold = true;
  out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId!, reason });
}

// ───────────────────────── 4.3a 태세 전환 ─────────────────────────

export function setPosture(state: GameState, playerId: number, msg: C2S_CmdSetPosture, t: number, out: Outbox): CmdResult {
  const f = flagById(state, msg.flagId);
  if (!f || f.ownerId !== playerId) return { reason: 'NO_FLAG' };
  if (f.routed) return { reason: 'ROUTED' };
  if (f.state === 'RETURNING') return { reason: 'RETURNING' }; // v4.2 [A-62]
  if (msg.posture === f.posture) return { reason: 'SAME_POSTURE' };
  if (t < f.postureCooldownUntilTick) return { reason: 'POSTURE_COOLDOWN' };
  // v4.6 (§27): 쿨타임이 안 돌면 어떤 상태에서든 즉시 전환. 전투 중이면 회수와 같은 이탈 대기(3초 ×0.5)를 치른다.
  applyPosture(state, f, msg.posture, t);
  f.postureManual = true;
  out.broadcast.push({ type: 'flag_posture_changed', tick: t, flagId: f.id, posture: f.posture, cooldownUntilTick: f.postureCooldownUntilTick, auto: false, targetOwnerId: f.targetOwnerId });
  if (f.inCombat) {
    startDisengageIfInCombat(state, f, t, out);
    f.disengageHold = true;
  }
  return { flagId: f.id, posture: f.posture };
}

