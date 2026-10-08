/**
 * 게이지 줄다리기 (GDD 4.6 / 4.7 / 4.10 / 4.12) — 5·6·7단계, 그리고 9·10단계 깃발 처리.
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
  isClaimable,
} from '@civwar/shared';
import { applyPosture, beginReturn, flagById, removeFlag } from './flagops.js';
import type { Outbox } from './outbox.js';
import { availAP, frontNonEmpty, guardContains, guardCount, maxProgress, selectTargetRO, tileCost, undoPerAP } from './rules.js';
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
  adv: number;
  cur: number;
  undo: number;
}
export interface BaseHit {
  flagId: number;
  tileId: number;
  cost: number;
  dmg: number;
  undo: number;
}
export interface PushPlan {
  readonly pushes: readonly Push[];
  readonly baseHits: readonly BaseHit[];
  readonly defSpend: ReadonlyMap<number, number>; // flagId → AP
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
    if (state.map.isBase[X]) {
      const b = state.bases[state.baseIndexOf.get(X)!];
      if (t < b.lockUntilTick) continue;
      baseHits.push({ flagId: f.id, tileId: X, cost: c, dmg: adv, undo: 0 });
    } else {
      pushes.push({ flagId: f.id, tileId: X, cost: c, adv, cur: X === f.targetTileId ? f.progressMilli : 0, undo: 0 });
    }
  }
  const defSpend = new Map<number, number>();
  for (const d of state.flags) {
    if (d.state !== 'ENGAGED' || d.posture !== POSTURE.DEFEND || d.inCombat) continue;
    const ap = availAP(d);
    let remain = ap;
    const bt = baseHits.filter((b) => guardContains(state, d, b.tileId)).sort((a, b) => b.dmg - a.dmg || a.tileId - b.tileId);
    const pt = pushes.filter((p) => guardContains(state, d, p.tileId)).sort((a, b) => b.cur + b.adv - (a.cur + a.adv) || a.flagId - b.flagId);
    const targets: (Push | BaseHit)[] = [...bt, ...pt];
    for (const tgt of targets) {
      if (remain === 0) break;
      const u = undoPerAP(state, d, tgt.tileId);
      if (u === 0) continue;
      const pending = ('dmg' in tgt ? tgt.dmg : tgt.adv) - tgt.undo;
      if (pending <= 0) continue;
      const use = Math.min(remain, Math.ceil(pending / u));
      tgt.undo += use * u;
      remain -= use;
    }
    if (ap - remain > 0) defSpend.set(d.id, ap - remain);
  }
  return { pushes, baseHits, defSpend };
}

// ───────────────────────── 7. Phase B (쓰기) ─────────────────────────

function spend(state: GameState, f: Flag, ap: number): void {
  const m = Math.min(ap * 1000, f.troopsMilli);
  f.troopsMilli -= m;
  f.spendBudgetMilli = Math.max(0, f.spendBudgetMilli - ap * 1000);
  state.ledger.spentAP += m;
}

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

export function stage7_combatPhaseB(state: GameState, plan: PushPlan, t: number, out: Outbox): void {
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
    if (group[0].kind === 'push') applyTilePushes(state, X, group.map((g) => g.e as Push), t, out);
    else applyBaseHits(state, X, group.map((g) => g.e as BaseHit), t, out);
  }
  for (const [id, ap] of plan.defSpend) {
    const d = flagById(state, id);
    if (d) spend(state, d, ap);
  }
}

/** 4.7 b + 4.10 게이지 레이스 — 한 타일에 걸린 게이지들 (flagId ASC) */
function applyTilePushes(state: GameState, X: number, list: Push[], t: number, out: Outbox): void {
  let winner: Flag | null = null;
  const touched: Flag[] = [];
  for (const p of list) {
    const f = flagById(state, p.flagId);
    if (!f) continue;
    setTarget(f, X, t, out);
    spend(state, f, Math.ceil((p.adv * p.cost) / 1000));
    const net = p.adv - p.undo;
    if (winner) {
      // 같은 tick 에 먼저(flagId ASC) 1000 에 닿은 깃발이 이미 가져감
      f.progressMilli = 0;
      f.targetTileId = null;
      out.broadcast.push({ type: 'flag_progress_lost', tick: t, flagId: f.id, tileId: X, cause: 'captured_by_other' });
      continue;
    }
    f.progressMilli += net;
    updateStall(f, net, t, out);
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
      f.progressMilli = Math.max(0, f.progressMilli);
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
    const net = h.dmg - h.undo;
    updateStall(f, net, t, out);
    if (net <= 0) continue;
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

// ───────────────────────── 9. 파생 상태 ─────────────────────────

/** 앵커 소유 변화에 따른 기본 태세 자동 재파생 (4.3a, postureManual == false 만) + calmTicks */
export function stage9_derived(state: GameState, t: number, out: Outbox): void {
  for (const f of state.flags) {
    const garrison = f.state === 'ENGAGED' && state.owners[f.anchorTileId] === f.ownerId;
    f.calmTicks = garrison && !f.inCombat ? f.calmTicks + 1 : 0;
    if (f.routed || f.postureManual || f.inCombat) continue; // 전투 중 태세 고정 [A-28]
    const ao = state.owners[f.anchorTileId];
    const def = ao === f.ownerId ? POSTURE.DEFEND : POSTURE.ATTACK;
    if (def === f.posture) continue;
    applyPosture(state, f, def, t);
    out.broadcast.push({ type: 'flag_posture_changed', tick: t, flagId: f.id, posture: f.posture, cooldownUntilTick: f.postureCooldownUntilTick, auto: true });
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

