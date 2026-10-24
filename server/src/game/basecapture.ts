/**
 * 기지 함락 처리 (4.12, §21, §31) — 게이지 경로(gauge.applyBaseHits)와 교전 소모 경로(combat.stage4d_baseCombatWear)가 함께 쓴다.
 * 소유권 이전, 체력·무적·생산력, 이전 주인(·동맹) 깃발 퇴각(모델 2), base_captured 이벤트.
 */
import { BASE_CAPTURE_LOCK_TICK, BASE_HP_CAPTURE_MILLI, BASE_HP_MAX_MILLI, BASE_PROD_CAPTURE_PERMILLE, TICKS_PER_MIN } from '@civwar/shared';
import { ANNEX } from './annex.js';
import { beginReturn } from './flagops.js';
import type { Outbox } from './outbox.js';
import { baseProdPm, isAlly, NEUTRAL, setTileOwner, type GameState } from './state.js';

/** B 기지를 newOwner 가 차지한다. 호출자가 체력 0 을 확인한 뒤 부른다 */
export function captureBase(state: GameState, B: number, newOwner: number, t: number, out: Outbox): void {
  const base = state.bases[state.baseIndexOf.get(B)!];
  const from = state.owners[B];
  const lastBase = from !== NEUTRAL && state.players[from].baseTiles.length === 1; // §31: 이 함락 = 멸망
  setTileOwner(state, B, newOwner);
  base.hpMilli = BASE_HP_CAPTURE_MILLI;
  base.lockUntilTick = t + BASE_CAPTURE_LOCK_TICK;
  // v4.4 (§21): 생산력 = 현재 값 × 0.5 (중립 기지 포함). 이후 8단계가 선형 회복
  const prodPm = lastBase && ANNEX.fullProd ? baseProdPm(base) : Math.floor((baseProdPm(base) * BASE_PROD_CAPTURE_PERMILLE) / 1000);
  base.prodScaled = prodPm * TICKS_PER_MIN;
  // 패치 2차 [A] (모델 2): 함락된 기지 칸 위의 이전 주인(·동맹) 깃발은 퇴각 — 귀환 상태로 남은 기지로 간다. 교전 중이면 이탈 대기 동안 접촉 유지.
  // 마지막 기지(멸망)는 12단계에서 깃발이 전부 사라지므로 건너뛴다.
  if (state.combatModel === 2 && !lastBase && from !== NEUTRAL) {
    for (const f of state.flags) {
      if (f.posTileId !== B || f.routed || f.state === 'RETURNING' || (f.ownerId !== from && !isAlly(state, f.ownerId, from))) continue;
      const wasInCombat = f.inCombat;
      beginReturn(state, f, null);
      if (wasInCombat) f.disengageHold = true;
      out.broadcast.push({ type: 'flag_recalled', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
    }
  }
  out.broadcast.push({
    type: 'base_captured',
    tick: t,
    tileId: B,
    fromPlayerId: from,
    toPlayerId: newOwner,
    newHpPct: Math.floor((BASE_HP_CAPTURE_MILLI * 100) / BASE_HP_MAX_MILLI),
    newProdPm: prodPm,
  });
}
