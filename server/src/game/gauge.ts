/**
 * 게이지 (GDD v4.1 4.6 / 4.7 / 4.10 / 4.12) — 5·6·7·7c단계, 그리고 9·10단계 깃발 처리.
 * v4.1: 게이지 되돌리기 폐지 -> 밀지 않는 공격 게이지는 자동 감소(7c), 주변 적 깃발이 있으면 유지.
 */
import {
  BASE_CAPTURE_LOCK_TICK,
  BASE_HP_MAX_MILLI,
  BASE_HP_CAPTURE_MILLI,
  FLAG_IDLE_TIMEOUT,
  FLAG_MIN_TROOPS,
  FLAG_SPEND_BUDGET_CAP_TICKS,
  FLAG_SPEND_RATE_PERMILLE,
  FLAG_STALL_TICKS,
  FRONT_RADIUS,
  POSTURE,
  PROGRESS_DECAY_MILLI_PER_TICK,
  PROGRESS_HOLD_RANGE,
  isClaimable,
} from '@civwar/shared';
import { beginReturn, flagById, removeFlag } from './flagops.js';
import type { Outbox } from './outbox.js';
import type { FlagPresence } from './combat.js';
import { availAP, frontNonEmpty, guardCount, maxProgress, selectTargetRO, threatened, tileCost } from './rules.js';
import { NEUTRAL, isAlly, setTileOwner, type Flag, type GameState } from './state.js';

// ───────────────────────── 5. AP 예산 누적 ─────────────────────────

export function stage5_accumulateBudget(state: GameState, _t: number): void {
  for (const f of state.flags) {
    if (f.state !== 'ENGAGED' || f.inCombat) continue;
    const per = f.initialTroops * FLAG_SPEND_RATE_PERMILLE;
    f.spendBudgetMilli = Math.min(f.spendBudgetMilli + per, per * FLAG_SPEND_BUDGET_CAP_TICKS);
  }
}

// ───────────────────────── 6. Phase A (읽기 전용) ─────────────────────────

export interface Push {
  flagId: number;
  tileId: number;
  cost: number;
  adv: number; // > 0 (v4.1: adv == 0 은 push 가 아니다)
}
export interface BaseHit {
  flagId: number;
  tileId: number;
  cost: number;
  dmg: number; // > 0
}
/** v4.1: 방어 배분(defSpend)·되돌리기(undo) 삭제 — 방어 태세 깃발은 게이지 단계에서 아무것도 쓰지 않는다 (4.7 a) */
export interface PushPlan {
  readonly pushes: readonly Push[];
  readonly baseHits: readonly BaseHit[];
}

export function stage6_combatPhaseA(state: Readonly<GameState>, t: number): PushPlan {
  const pushes: Push[] = [];
  const baseHits: BaseHit[] = [];
  for (const f of state.flags) {
    if (f.state !== 'ENGAGED' || f.posture !== POSTURE.ATTACK || f.inCombat) continue;
    const X = selectTargetRO(state, f);
    if (X === null) continue;
    const c = tileCost(state, f, X);
    const adv = Math.min(Math.floor((availAP(f) * 1000) / c), maxProgress(f));
    if (adv === 0) continue; // v4.1: 0 전진은 push 가 아니다
    if (state.map.isBase[X]) {
      const b = state.bases[state.baseIndexOf.get(X)!];
      if (t < b.lockUntilTick) continue;
      baseHits.push({ flagId: f.id, tileId: X, cost: c, dmg: adv });
    } else {
      pushes.push({ flagId: f.id, tileId: X, cost: c, adv });
    }
  }
  return { pushes, baseHits };
}

// ───────────────────────── 7. Phase B (쓰기) ─────────────────────────

function spend(state: GameState, f: Flag, ap: number): void {
  const m = Math.min(ap * 1000, f.troopsMilli);
  f.troopsMilli -= m;
  f.spendBudgetMilli = Math.max(0, f.spendBudgetMilli - ap * 1000);
  state.ledger.spentAP += m;
}

/** 4.7 (f) — 민 깃발은 net = adv, ENGAGED·ATTACK·비전투인데 못 민 깃발은 net = 0. inCombat 은 호출하지 않는다 */
function updateStall(f: Flag, net: number, t: number, out: Outbox): void {
  if (net <= 0) {
    if (f.stallSinceTick === null) f.stallSinceTick = t;
    if (t - f.stallSinceTick >= FLAG_STALL_TICKS && !f.stalled) {
      f.stalled = true;
      out.broadcast.push({ type: 'flag_stalled', tick: t, flagId: f.id, tileId: f.targetTileId });
    }
  } else {
    f.stallSinceTick = null;
    f.stalled = false;
  }
}

function setTarget(f: Flag, X: number, t: number, out: Outbox): void {
  if (f.targetTileId === X) return;
  if (f.targetTileId !== null && f.progressMilli > 0) {
    out.broadcast.push({ type: 'flag_progress_lost', tick: t, flagId: f.id, tileId: f.targetTileId, cause: 'target_lost' });
  }
  f.targetTileId = X;
  f.progressMilli = 0;
}

/**
 * 7단계. 반환값 = 이번 tick 에 민 깃발 집합 pushedSet (tick 로컬, 7c 가 읽는다).
 * 순서: (tileId ASC, flagId ASC) 로 게이지·기지 적용 → 안 민 ENGAGED·ATTACK·비전투 깃발 updateStall(f, 0) (flagId ASC).
 */
export function stage7_combatPhaseB(state: GameState, plan: PushPlan, t: number, out: Outbox): Set<number> {
  const pushedSet = new Set<number>();
  type Entry = { kind: 'push'; e: Push } | { kind: 'base'; e: BaseHit };
  const entries: Entry[] = [
    ...plan.pushes.map((e) => ({ kind: 'push' as const, e })),
    ...plan.baseHits.map((e) => ({ kind: 'base' as const, e })),
  ].sort((a, b) => a.e.tileId - b.e.tileId || a.e.flagId - b.e.flagId);

  let i = 0;
  while (i < entries.length) {
    const X = entries[i].e.tileId;
    let j = i;
    while (j < entries.length && entries[j].e.tileId === X) j++;
    const group = entries.slice(i, j);
    i = j;
    for (const g of group) pushedSet.add(g.e.flagId);
    if (group[0].kind === 'push') applyTilePushes(state, X, group.map((g) => g.e as Push), t, out);
    else applyBaseHits(state, X, group.map((g) => g.e as BaseHit), t, out);
  }
  for (const f of state.flags) {
    if (f.state !== 'ENGAGED' || f.posture !== POSTURE.ATTACK || f.inCombat || pushedSet.has(f.id)) continue;
    updateStall(f, 0, t, out);
  }
  return pushedSet;
}

/** 4.7 b + 4.10 게이지 레이스 — 한 타일에 걸린 게이지들 (flagId ASC). net = adv (되돌리기 없음) */
function applyTilePushes(state: GameState, X: number, list: Push[], t: number, out: Outbox): void {
  let winner: Flag | null = null;
  const touched: Flag[] = [];
  for (const p of list) {
    const f = flagById(state, p.flagId);
    if (!f) continue;
    setTarget(f, X, t, out);
    spend(state, f, Math.ceil((p.adv * p.cost) / 1000));
    if (winner) {
      // 같은 tick 에 먼저(flagId ASC) 1000 에 닿은 깃발이 이미 가져감
      f.progressMilli = 0;
      f.targetTileId = null;
      out.broadcast.push({ type: 'flag_progress_lost', tick: t, flagId: f.id, tileId: X, cause: 'captured_by_other' });
      continue;
    }
    f.progressMilli += p.adv;
    updateStall(f, p.adv, t, out);
    if (f.progressMilli >= 1000) {
      winner = f;
      setTileOwner(state, X, f.ownerId);
      f.progressMilli = 0;
      f.targetTileId = null;
      for (const g of touched) {
        if (g.targetTileId !== X) continue;
        g.progressMilli = 0;
        g.targetTileId = null;
        out.broadcast.push({ type: 'flag_progress_lost', tick: t, flagId: g.id, tileId: X, cause: 'captured_by_other' });
      }
    } else {
      touched.push(f);
    }
  }
}

/** 4.12 기지 체력 전투 */
function applyBaseHits(state: GameState, B: number, list: BaseHit[], t: number, out: Outbox): void {
  const base = state.bases[state.baseIndexOf.get(B)!];
  let winner: Flag | null = null;
  let bestNet = 0;
  const hitters: Flag[] = [];
  for (const h of list) {
    const f = flagById(state, h.flagId);
    if (!f) continue;
    setTarget(f, B, t, out);
    hitters.push(f);
    spend(state, f, Math.ceil((h.dmg * h.cost) / 1000));
    const net = h.dmg; // v4.1: 기지 방어 = 격파 + 회복만 [A-44]
    updateStall(f, net, t, out);
    base.hpMilli -= net;
    base.lastDamageTick = t;
    base.damagedThisTick = true;
    if (net > bestNet) {
      bestNet = net;
      winner = f;
    }
  }
  if (base.hpMilli <= 0 && winner) {
    const from = state.owners[B];
    setTileOwner(state, B, winner.ownerId);
    base.hpMilli = BASE_HP_CAPTURE_MILLI;
    base.lockUntilTick = t + BASE_CAPTURE_LOCK_TICK;
    for (const f of hitters) f.targetTileId = null;
    out.broadcast.push({ type: 'base_captured', tick: t, tileId: B, fromPlayerId: from, toPlayerId: winner.ownerId, newHpPct: Math.floor((BASE_HP_CAPTURE_MILLI * 100) / BASE_HP_MAX_MILLI) });
  }
}

// ───────────────────────── 7c. 진척도 자동 감소 (v4.1, 4.7 e) ─────────────────────────

/**
 * 7c — flagId ASC. 이번 tick 안 민 깃발(pushedSet 밖) 중 holdProgress 가 아닌 것만
 * progressMilli -= PROGRESS_DECAY_MILLI_PER_TICK (0 클램프). 0 도달 시 flag_progress_lost(cause="decayed") 1회.
 * targetTileId 는 유지(sticky) — 다시 밀면 같은 타깃에서 0부터.
 *
 * holdProgress(f) = f.inCombat or 적대 깃발 g in presence4a : distance(pos4a[f], pos4a[g]) <= PROGRESS_HOLD_RANGE.
 * presence4a 는 4a 스냅숏(이동 직후, 4b 손실 전)이라 4b 에서 패주한 깃발도 이번 tick 엔 "주변 적"이다.
 * 각 깃발은 자기 progressMilli 만 바꾸므로 처리 순서가 결과를 바꾸지 않는다.
 */
export function stage7c_progressDecay(state: GameState, presence: FlagPresence, pushedSet: ReadonlySet<number>, t: number, out: Outbox): void {
  for (const f of state.flags) {
    if (f.progressMilli <= 0 || pushedSet.has(f.id)) continue;
    if (holdProgress(state, presence, f)) continue;
    f.progressMilli = Math.max(0, f.progressMilli - PROGRESS_DECAY_MILLI_PER_TICK);
    if (f.progressMilli === 0) {
      out.broadcast.push({ type: 'flag_progress_lost', tick: t, flagId: f.id, tileId: f.targetTileId!, cause: 'decayed' }); // progress > 0 ⇒ 타깃 있음
    }
  }
}

export function holdProgress(state: Readonly<GameState>, presence: FlagPresence, f: Readonly<Flag>): boolean {
  if (f.inCombat) return true;
  const pos = presence.posOf.get(f.id) ?? f.posTileId;
  for (const x of state.graph.disk(pos, PROGRESS_HOLD_RANGE)) {
    const owners = presence.ownersAt.get(x);
    if (!owners) continue;
    for (const o of owners) if (o !== f.ownerId && !isAlly(state, f.ownerId, o)) return true;
  }
  return false;
}

// ───────────────────────── 9. 파생 상태 ─────────────────────────

/**
 * 9단계: calmTicks 갱신만 (threatened = v4.1 [A-43] 재정의. GARRISON_ESCALATE_MAX = 1 이라 현재 규칙 영향 없음). 기본 태세는 발령·재지정 때만 정해진다 —
 * "앵커 함락 → 자동 방어 전환" 재파생은 폐지(사용자 결정, GDD 4.3a 개정). 공격 깃발은 front 가 빌 때까지 계속 민다.
 */
export function stage9_derived(state: GameState, _t: number, _out: Outbox): void {
  for (const f of state.flags) {
    const garrison = f.state === 'ENGAGED' && state.owners[f.anchorTileId] === f.ownerId;
    f.calmTicks = garrison && !threatened(state, f) ? f.calmTicks + 1 : 0;
  }
}

// ───────────────────────── 10. 깃발 종료 판정 (4.11 b) ─────────────────────────

function goIdle(f: Flag, t: number, reason: 'front_cleared' | 'guard_lost', out: Outbox): void {
  f.state = 'IDLE';
  f.progressMilli = 0;
  f.targetTileId = null;
  f.idleSinceTick = t;
  out.broadcast.push({ type: 'flag_idle', tick: t, flagId: f.id, reason, autoRecallTick: t + FLAG_IDLE_TIMEOUT });
}

/** 4.5 중립 자동 전환 — 성공하면 true */
function neutralAutoSwitch(state: GameState, f: Flag, t: number, out: Outbox): boolean {
  const best = new Map<number, number>(); // owner → 최소 tileCost
  for (const x of state.graph.disk(f.anchorTileId, FRONT_RADIUS)) {
    const o = state.owners[x];
    if (o === NEUTRAL || o === f.ownerId || !isClaimable(state.map.terrain[x]) || isAlly(state, f.ownerId, o)) continue;
    const c = tileCost(state, f, x);
    const prev = best.get(o);
    if (prev === undefined || c < prev) best.set(o, c);
  }
  let pick = -1;
  let pc = Infinity;
  for (const [o, c] of best) if (c < pc || (c === pc && o < pick)) [pick, pc] = [o, c];
  if (pick < 0) return false;
  f.targetOwnerId = pick;
  f.targetTileId = null;
  f.progressMilli = 0;
  out.broadcast.push({ type: 'flag_retargeted', tick: t, flagId: f.id, anchorTileId: f.anchorTileId, targetOwnerId: pick, posture: f.posture, resumeTick: t, etaTick: t, auto: true });
  return true;
}

function exhaust(state: GameState, f: Flag, t: number, out: Outbox): void {
  state.ledger.exhausted += f.troopsMilli;
  f.troopsMilli = 0;
  removeFlag(state, f, t, 'exhausted', 0, out);
}

export function stage10_flagEnd(state: GameState, t: number, out: Outbox): void {
  for (const f of state.flags.slice()) {
    if (f.inCombat || !state.players[f.ownerId].alive) continue;
    if (f.state === 'ENGAGED' && f.posture === POSTURE.ATTACK) {
      if (!frontNonEmpty(state, f)) {
        if (f.targetOwnerId === NEUTRAL && neutralAutoSwitch(state, f, t, out)) continue;
        goIdle(f, t, 'front_cleared', out);
      } else if (f.troopsMilli < FLAG_MIN_TROOPS * 1000) exhaust(state, f, t, out);
    } else if (f.state === 'ENGAGED' && f.posture === POSTURE.DEFEND) {
      if (guardCount(state, f) === 0) goIdle(f, t, 'guard_lost', out);
      else if (f.troopsMilli < FLAG_MIN_TROOPS * 1000) exhaust(state, f, t, out);
    }
    if (f.state === 'IDLE' && f.idleSinceTick !== null && t - f.idleSinceTick >= FLAG_IDLE_TIMEOUT) {
      beginReturn(state, f);
      out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
    }
  }
}

