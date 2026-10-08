/**
 * 4단계 — 깃발 이동 (GDD 4.4 / 4.15 f·g·h). flagId ASC.
 */
import {
  FLAG_ENGAGE_RANGE,
  FLAG_EXPOSED_ATTRITION_BP,
  FLAG_IDLE_TIMEOUT,
  FLAG_RECALL_REFUND_PERMILLE,
  POSTURE,
  WATER_EXPOSURE_PERMILLE_BY_TIER,
  isClaimable,
} from '@civwar/shared';
import { combatEligible, hostile } from './combat.js';
import { removeFlag } from './flagops.js';
import type { Outbox } from './outbox.js';
import { defendArrived, destOf, frontCount, frontWithin, guardCount, mobilityTier, recallTarget, speedMilliAt, stepToward } from './rules.js';
import { isAlly, type Flag, type GameState } from './state.js';

/** 노출 소모. 소멸했으면 true */
export function applyExposureAttrition(state: GameState, f: Flag, t: number, out: Outbox): boolean {
  if (f.routed) return false;
  const o = state.owners[f.posTileId];
  if (o === f.ownerId || isAlly(state, f.ownerId, o)) return false;
  let a = Math.max(1000, Math.floor((f.troopsMilli * FLAG_EXPOSED_ATTRITION_BP) / 10000));
  if (!isClaimable(state.map.terrain[f.posTileId])) {
    a = Math.max(1000, Math.floor((a * WATER_EXPOSURE_PERMILLE_BY_TIER[mobilityTier(state.players[f.ownerId])]) / 1000));
  }
  a = Math.min(a, f.troopsMilli);
  f.troopsMilli -= a;
  state.ledger.exposure += a;
  if (f.troopsMilli <= 0) {
    removeFlag(state, f, t, 'attrited', 0, out);
    return true;
  }
  return false;
}

interface ZocSource {
  id: number;
  ownerId: number;
  pos: number;
}

export function stage4_moveFlags(state: GameState, t: number, out: Outbox): void {
  // ZOC 는 tick 시작 위치 스냅숏 기준 (flagId 처리 순서와 무관) [A-30]
  const zoc: ZocSource[] = [];
  for (const g of state.flags) if (g.posture === POSTURE.DEFEND && combatEligible(g)) zoc.push({ id: g.id, ownerId: g.ownerId, pos: g.posTileId });
  const zocBy = (f: Flag, tile: number): number[] => {
    const ids: number[] = [];
    for (const g of zoc) if (hostile(state, f.ownerId, g.ownerId) && state.graph.distance(tile, g.pos) <= 1) ids.push(g.id);
    return ids;
  };
  state.zocBlocked = new Map();

  for (const f of state.flags.slice()) {
    if (t < f.lockUntilTick) continue;
    if (f.inCombat || f.state === 'ENGAGED' || f.state === 'IDLE') {
      applyExposureAttrition(state, f, t, out);
      continue;
    }
    if (f.state === 'RETURNING') {
      const rt = recallTarget(state, f); // 매 tick 재평가
      if (rt !== f.returnTileId) f.returnTileId = rt;
    }
    const dest = destOf(f);
    f.nextTileId = stepToward(state, f.ownerId, f.posTileId, dest);
    let moved = false;
    if (f.posTileId !== dest) {
      const blockedBy = f.routed ? [] : zocBy(f, f.nextTileId);
      if (blockedBy.length && zocBy(f, f.posTileId).length) {
        state.zocBlocked.set(f.id, blockedBy); // 대치: moveProgMilli 유지
      } else {
        f.moveProgMilli += speedMilliAt(state, f, f.posTileId);
        while (f.moveProgMilli >= 1000) {
          f.moveProgMilli -= 1000;
          f.posTileId = f.nextTileId;
          moved = true;
          f.nextTileId = stepToward(state, f.ownerId, f.posTileId, dest);
          if (f.posTileId === dest) break;
        }
      }
    }
    if (moved) f.breakaway = false;
    if (applyExposureAttrition(state, f, t, out)) continue;

    if (f.state === 'MARCHING') {
      if (f.posture === POSTURE.ATTACK && frontWithin(state, f, FLAG_ENGAGE_RANGE)) {
        f.state = 'ENGAGED';
        f.moveProgMilli = 0;
        out.broadcast.push({ type: 'flag_engaged', tick: t, flagId: f.id, posture: f.posture, frontTileCount: frontCount(state, f) });
      } else if (f.posture === POSTURE.DEFEND && defendArrived(state, f)) {
        f.state = 'ENGAGED';
        f.moveProgMilli = 0;
        out.broadcast.push({ type: 'flag_engaged', tick: t, flagId: f.id, posture: f.posture, guardTileCount: guardCount(state, f) });
      } else if (f.posTileId === f.anchorTileId) {
        f.state = 'IDLE';
        f.idleSinceTick = t;
        f.moveProgMilli = 0;
        out.broadcast.push({ type: 'flag_idle', tick: t, flagId: f.id, reason: 'front_cleared', autoRecallTick: t + FLAG_IDLE_TIMEOUT });
      }
    } else if (f.state === 'RETURNING' && f.posTileId === f.returnTileId) {
      const p = state.players[f.ownerId];
      const refund = f.routed ? 0 : Math.floor((f.troopsMilli * FLAG_RECALL_REFUND_PERMILLE) / 1000);
      state.ledger.recallLoss += f.troopsMilli - refund;
      p.troopsMilli += refund;
      f.troopsMilli = 0;
      removeFlag(state, f, t, f.routed ? 'routed_returned' : 'recalled', Math.floor(refund / 1000), out);
    }
  }
}
