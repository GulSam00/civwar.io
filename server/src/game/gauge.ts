/**
 * 게이지 (GDD v4.2 4.4a c / 4.6 / 4.7 / 4.10 / 4.12) — 5·6·7·7c단계, 그리고 9·10단계 깃발 처리.
 * v4.2: 대상 = pushing(f) (ENGAGED·ATTACK 또는 행군 중 halted), 타깃 = selectAttackTarget(marchFront).
 * v4.1: 게이지 되돌리기 폐지 -> 밀지 않는 공격 게이지는 자동 감소(7c), 주변 적 깃발이 있으면 유지.
 */
import {
  BASE_CAPTURE_LOCK_TICK,
  BASE_DEFENDED_DMG_PERMILLE,
  CAPTURE_MORALE_DROP,
  BASE_HP_DMG_CAP_MILLI_PER_TICK,
  techBaseDmgPm,
  techCaptureMultPm,
  techSiegePm,
  BASE_HP_MAX_MILLI,
  BASE_HP_CAPTURE_MILLI,
  BASE_PROD_CAPTURE_PERMILLE,
  TICKS_PER_MIN,
  FLAG_IDLE_TIMEOUT,
  FLAG_MIN_TROOPS,
  FLAG_SPEND_BUDGET_CAP_TICKS,
  FLAG_SPEND_RATE_PERMILLE,
  FLAG_STALL_TICKS,
  POSTURE,
  PROGRESS_DECAY_MILLI_PER_TICK,
  PROGRESS_HOLD_RANGE,
} from '@civwar/shared';
import { captureBase } from './basecapture.js';
import { beginReturn, flagById, removeFlag } from './flagops.js';
import type { Outbox } from './outbox.js';
import { combatEligible, type FlagPresence } from './combat.js';
import { isGarrison } from './economy.js';
import { availAP, guardCount, marchFrontNonEmpty, maxProgress, pushing, selectAttackTargetRO, threatened, tileCost } from './rules.js';
import { ANNEX } from './annex.js';
import { baseProdPm, isAlly, NEUTRAL, setTileOwner, type Flag, type GameState } from './state.js';

// ───────────────────────── 5. AP 예산 누적 ─────────────────────────

export function stage5_accumulateBudget(state: GameState, _t: number): void {
  for (const f of state.flags) {
    if (!pushing(f) && defendedBaseTargetRO(state, f) === null) continue; // v4.2: ENGAGED·ATTACK 또는 halted, 비전투. 걷는 MARCHING 은 누적 없음
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
    // 패치 4차: 교전 중이어도 방어 깃발이 선 기지는 밀 수 있다 (피해 ×BASE_DEFENDED_DMG_PERMILLE)
    const defX = pushing(f) ? null : defendedBaseTargetRO(state, f);
    if (!pushing(f) && defX === null) continue; // v4.2 (4.4a c)
    const X = defX ?? selectAttackTargetRO(state, f);
    if (X === null) continue;
    const c = tileCost(state, f, X);
    const rawAdv = Math.min(Math.floor((availAP(f) * 1000) / c), maxProgress(f));
    const adv = defX === null ? rawAdv : Math.floor((rawAdv * BASE_DEFENDED_DMG_PERMILLE) / 1000);
    if (adv === 0) continue; // v4.1: 0 전진은 push 가 아니다
    if (state.map.isBase[X]) {
      const b = state.bases[state.baseIndexOf.get(X)!];
      if (t < b.lockUntilTick) continue;
      // v4.4 (§21) [A-88]: 기지 칸 위에 적대 깃발(전투 가능)이 서 있으면 체력을 깎지 못한다 — 먼저 그 깃발을 이겨야 한다.
      // (기지에 붙은 공격 깃발은 기지 칸과 항상 접촉 → 4a 에서 이미 전투 중이라 pushing 이 아니다. 이 검사는 그 불변식의 명시판)
      if (defX === null && baseOccupiedByHostile(state, X, f.ownerId)) continue;
      baseHits.push({ flagId: f.id, tileId: X, cost: c, dmg: adv });
    } else {
      pushes.push({ flagId: f.id, tileId: X, cost: c, adv });
    }
  }
  return { pushes, baseHits };
}

/**
 * 패치 4차 (모델 2) — 방어 깃발이 서 있는 기지를 미는 교전 중 공격 깃발의 목표 기지 칸. 해당 없으면 null.
 * 교전 중이라 pushing(f) 는 아니지만, 타깃이 "전투 가능한 적대 깃발이 선 기지"면 피해 ×BASE_DEFENDED_DMG_PERMILLE 로 밀 수 있다.
 */
export function defendedBaseTargetRO(state: Readonly<GameState>, f: Readonly<Flag>): number | null {
  if (state.combatModel !== 2 || !f.inCombat || f.posture !== POSTURE.ATTACK || f.routed || f.breakaway) return null;
  if (!(f.state === 'ENGAGED' || f.halted)) return null;
  const X = selectAttackTargetRO(state, f);
  if (X === null || !state.map.isBase[X] || !baseOccupiedByHostile(state, X, f.ownerId)) return null;
  return X;
}

/** v4.4: 기지 칸 X 위에 ownerId 와 적대인 전투 가능 깃발(패주·소진·이탈 직후 아님)이 있는가 */
export function baseOccupiedByHostile(state: Readonly<GameState>, X: number, ownerId: number): boolean {
  for (const g of state.flags) {
    if (g.posTileId !== X || !combatEligible(g)) continue;
    if (g.ownerId !== ownerId && !isAlly(state, ownerId, g.ownerId)) return true;
  }
  return false;
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
    if (!pushing(f) || pushedSet.has(f.id)) continue; // v4.2: updateStall 대상 = pushing(f)
    updateStall(f, 0, t, out);
  }
  // 2026-10-24 [A] 모델 2: 점령·기지 공격으로 게이지를 민 tick 마다 사기 소모 (병종별 실효 점령 배율 비례, flagId ASC)
  if (state.combatModel === 2) {
    for (const f of state.flags) {
      if (!pushedSet.has(f.id)) continue;
      const mult = techCaptureMultPm(state.players[f.ownerId].statPm, f.unit);
      f.morale = Math.max(0, f.morale - Math.max(1, Math.floor((CAPTURE_MORALE_DROP * mult) / 1000)));
    }
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

/**
 * v4.5 [A-104] 기지 피해 상한 분배 (순수 함수). want = 깃발별 원래 피해(flagId ASC, > 0), hp = 현재 체력.
 * 총 적용량 = min(Σwant, BASE_HP_DMG_CAP_MILLI_PER_TICK, hp) — 체력보다 많이 깎지 않는다(초과 피해에 병력을 쓰지 않게).
 * 총량이 Σwant 보다 작으면 원래 피해 비례로 floor 분배, 잔여 milli 는 (want DESC, 순서 ASC) 로 1씩 — 결정론, 합 = 총 적용량.
 */
export function splitBaseDamage(want: readonly number[], hp: number, cap: number = BASE_HP_DMG_CAP_MILLI_PER_TICK): number[] {
  const sum = want.reduce((a, b) => a + b, 0);
  const total = Math.max(0, Math.min(sum, cap, hp));
  if (total === sum) return want.slice();
  const out = want.map((w) => Math.floor((total * w) / sum));
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = want.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; rem > 0; k = (k + 1) % order.length, rem--) out[order[k].i] += 1;
  return out;
}

/**
 * 4.12 기지 체력 전투. v4.5 (사용자 2026-10-15): 한 tick 에 기지가 잃는 체력 합 ≤ BASE_HP_DMG_CAP_MILLI_PER_TICK(300)
 * — 깃발 수와 무관(빈 기지도 최소 15초). 깃발별 적용 피해 = splitBaseDamage, **지출 = 적용된 피해의 AP 만** [A-104]
 * (상한·체력에 잘려 버려진 피해에는 병력을 쓰지 않는다). 함락자 = 적용 피해 최대(동률 flagId 작은 쪽) — 기존 규칙.
 */
function applyBaseHits(state: GameState, B: number, list: BaseHit[], t: number, out: Outbox): void {
  const base = state.bases[state.baseIndexOf.get(B)!];
  let winner: Flag | null = null;
  let bestNet = 0;
  const hitters: Flag[] = [];
  const hits: { f: Flag; h: BaseHit }[] = [];
  for (const h of list) {
    const f = flagById(state, h.flagId);
    if (f) hits.push({ f, h });
  }
  // 2026-10-24 요새화(TER-2B): 기지 소유자의 피해 배율 (중립 기지는 1000)
  const owner = state.players[state.owners[B]];
  const defPm = owner ? techBaseDmgPm(owner.statPm) : 1000;
  // 2026-10-24 공성(MIL-2A·3A): 공격자 쪽 피해 배율. 깃발별로 그 깃발 소유자의 값을 쓴다
  const siegeOf = (f: Flag) => techSiegePm(state.players[f.ownerId].statPm);
  const maxSiege = hits.reduce((m, x) => Math.max(m, siegeOf(x.f)), 1000);
  const dmgPm = defPm;
  // 피해 상한(tick 당 합)에도 같은 배율(방어측 × 공격측 최대)을 곱한다 — 상한에 걸리는 큰 공격에도 효과가 있게
  const capPm = Math.floor((defPm * maxSiege) / 1000);
  const applied = splitBaseDamage(
    hits.map((x) => {
      const pm = Math.floor((defPm * siegeOf(x.f)) / 1000);
      return pm === 1000 ? x.h.dmg : Math.max(1, Math.floor((x.h.dmg * pm) / 1000));
    }),
    base.hpMilli,
    capPm === 1000 ? BASE_HP_DMG_CAP_MILLI_PER_TICK : Math.max(1, Math.floor((BASE_HP_DMG_CAP_MILLI_PER_TICK * capPm) / 1000)),
  );
  for (let i = 0; i < hits.length; i++) {
    const { f, h } = hits[i];
    setTarget(f, B, t, out);
    hitters.push(f);
    const net = applied[i]; // v4.1: 기지 방어 = 격파 + 회복만 [A-44]
    spend(state, f, Math.ceil((net * h.cost) / 1000));
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
    for (const f of hitters) f.targetTileId = null;
    captureBase(state, B, winner.ownerId, t, out);
  }
}

// ───────────────────────── 7c. 진척도 자동 감소 (v4.1, 4.7 e) ─────────────────────────

/**
 * 7c — flagId ASC. 이번 tick 안 민 깃발(pushedSet 밖) 중 holdProgress 가 아닌 것만
 * progressMilli -= PROGRESS_DECAY_MILLI_PER_TICK (0 클램프). 0 도달 시 flag_progress_lost(cause="decayed") 1회.
 * targetTileId 는 유지(sticky) — 다시 밀면 같은 타깃에서 0부터.
 *
 * holdProgress(f) = f.inCombat or 적대 깃발 g in presence4a : touching(pos4a[f], pos4a[g]) (2026-10-11: 8방향 접촉 — PROGRESS_HOLD_RANGE 1 = 접촉).
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

/** PROGRESS_HOLD_RANGE (= 1) 안 = 같은 칸 + 접촉 이웃 (사각 8방향) */
function holdTiles(state: Readonly<GameState>, pos: number): readonly number[] {
  if (PROGRESS_HOLD_RANGE !== 1) throw new Error('PROGRESS_HOLD_RANGE 는 접촉(1)만 지원');
  return [pos, ...state.graph.contactNeighbors(pos)];
}

export function holdProgress(state: Readonly<GameState>, presence: FlagPresence, f: Readonly<Flag>): boolean {
  if (f.inCombat) return true;
  const pos = presence.posOf.get(f.id) ?? f.posTileId;
  for (const x of holdTiles(state, pos)) {
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
    f.calmTicks = isGarrison(state, f) && !threatened(state, f) ? f.calmTicks + 1 : 0; // v4.2: isGarrison 에 DEFEND [A-60]
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

// v4.2: 4.5 중립 자동 전환(neutralAutoSwitch)·flag_retargeted(auto=true) 송신 삭제 — 공격 대상이 소유자를 가리지 않는다

function exhaust(state: GameState, f: Flag, t: number, out: Outbox): void {
  state.ledger.exhausted += f.troopsMilli;
  f.troopsMilli = 0;
  removeFlag(state, f, t, 'exhausted', 0, out);
}

export function stage10_flagEnd(state: GameState, t: number, out: Outbox): void {
  for (const f of state.flags.slice()) {
    if (f.inCombat || !state.players[f.ownerId].alive) continue;
    if (f.state === 'ENGAGED' && f.posture === POSTURE.ATTACK) {
      if (!marchFrontNonEmpty(state, f)) goIdle(f, t, 'front_cleared', out); // v4.2: 옆 칸이 없으면 IDLE [A-59]
      else if (f.troopsMilli < FLAG_MIN_TROOPS * 1000) exhaust(state, f, t, out);
      continue;
    } else if (f.state === 'ENGAGED' && f.posture === POSTURE.DEFEND) {
      if (guardCount(state, f) === 0) goIdle(f, t, 'guard_lost', out);
      else if (f.troopsMilli < FLAG_MIN_TROOPS * 1000) exhaust(state, f, t, out);
      continue;
    } else if (f.state === 'MARCHING' && f.halted && f.troopsMilli < FLAG_MIN_TROOPS * 1000) {
      exhaust(state, f, t, out); // v4.2 (4.4a c): 정지 점령도 소진 규칙 동일
      continue;
    }
    if (f.state === 'IDLE' && f.idleSinceTick !== null && t - f.idleSinceTick >= FLAG_IDLE_TIMEOUT) {
      beginReturn(state, f, null); // [A-61]: IDLE 자동 회수는 지정 기지 없음
      out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
    }
  }
}

