/**
 * 4단계 — 깃발 이동 (GDD 4.4 / 4.4a / 4.15 f·g·h — v4.2). flagId ASC.
 */
import {
  FLAG_EXPOSED_ATTRITION_BP,
  FLAG_EXPOSED_ATTRITION_NEUTRAL_PCM,
  FLAG_EXPOSED_MIN_MILLI,
  FLAG_EXPOSED_NEUTRAL_MIN_MILLI,
  FLAG_IDLE_TIMEOUT,
  FLAG_RECALL_REFUND_PERMILLE,
  POSTURE,
} from '@civwar/shared';
import { combatEligible, hostile } from './combat.js';
import { removeFlag } from './flagops.js';
import type { Outbox } from './outbox.js';
import {
  attackReady,
  defendArrived,
  destOf,
  guardCount,
  marchFrontCount,
  recallTarget,
  returnBaseValid,
  speedMilliAt,
  defendDest,
  defendPathing,
  nextStep,
} from './rules.js';
import { NEUTRAL, isAlly, type Flag, type GameState } from './state.js';

/** v4.5 (§22.13): 이 칸에서의 노출 소모량 (milli, 0 = 없음). 패주 깃발은 기존처럼 면제 */
export function exposureLossMilli(state: Readonly<GameState>, f: Readonly<Flag>): number {
  if (f.routed) return 0;
  const o = state.owners[f.posTileId];
  if (o === f.ownerId || isAlly(state, f.ownerId, o)) return 0; // 내 땅·동맹 땅
  const a =
    o === NEUTRAL
      ? Math.max(FLAG_EXPOSED_NEUTRAL_MIN_MILLI, Math.floor((f.troopsMilli * FLAG_EXPOSED_ATTRITION_NEUTRAL_PCM) / 100000)) // 중립: 절반 [A-113]
      : Math.max(FLAG_EXPOSED_MIN_MILLI, Math.floor((f.troopsMilli * FLAG_EXPOSED_ATTRITION_BP) / 10000)); // 적 땅: 기존
  return Math.min(a, f.troopsMilli);
}

/** 노출 소모. 소멸했으면 true */
export function applyExposureAttrition(state: GameState, f: Flag, t: number, out: Outbox): boolean {
  const a = exposureLossMilli(state, f);
  if (a <= 0) return false;
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

/**
 * 4.4a (b) settle — MARCHING 깃발이 이 칸에서 멈추는가. 우선순위 [A-55]:
 * 방어 도착(A-29) > 공격 옆 칸 있음(앵커 칸이면 ENGAGED, 아니면 halted) > 앵커 칸이면 IDLE. 멈추면 true.
 */
function settle(state: GameState, f: Flag, t: number, out: Outbox): boolean {
  if (f.posture === POSTURE.DEFEND && defendArrived(state, f)) {
    f.state = 'ENGAGED';
    f.halted = false;
    f.moveProgMilli = 0;
    out.broadcast.push({ type: 'flag_engaged', tick: t, flagId: f.id, posture: f.posture, guardTileCount: guardCount(state, f) });
    return true;
  }
  // v4.5 [A-112] (§22.12): 방어 태세가 적 땅 때문에 앵커에 못 가면 "적 땅 바로 앞"(defendDest)에서 멈춘다 → IDLE(unreachable).
  // 방어 도착(위)이 먼저다 — 앵커가 남의 땅이고 내 땅 관할 원 안에 들어왔으면 ENGAGED. IDLE 은 기존처럼 FLAG_IDLE_TIMEOUT 뒤 자동 귀환
  if (defendPathing(f) && f.posTileId !== f.anchorTileId && defendDest(state, f.ownerId, f.posTileId, f.anchorTileId) === f.posTileId) {
    f.state = 'IDLE';
    f.idleSinceTick = t;
    f.halted = false;
    f.moveProgMilli = 0;
    out.broadcast.push({ type: 'flag_idle', tick: t, flagId: f.id, reason: 'unreachable', autoRecallTick: t + FLAG_IDLE_TIMEOUT });
    return true;
  }
  const atAnchor = f.posTileId === f.anchorTileId;
  if (attackReady(f)) {
    const n = marchFrontCount(state, f);
    if (n > 0) {
      if (atAnchor) {
        f.state = 'ENGAGED';
        f.halted = false;
        f.moveProgMilli = 0;
        out.broadcast.push({ type: 'flag_engaged', tick: t, flagId: f.id, posture: f.posture, frontTileCount: n });
      } else {
        f.halted = true; // 가는 길 정지 점령 (state = MARCHING 유지, A-54)
      }
      return true;
    }
  }
  if (atAnchor) {
    f.state = 'IDLE';
    f.idleSinceTick = t;
    f.halted = false;
    f.moveProgMilli = 0;
    out.broadcast.push({ type: 'flag_idle', tick: t, flagId: f.id, reason: 'front_cleared', autoRecallTick: t + FLAG_IDLE_TIMEOUT });
    return true;
  }
  return false;
}

/**
 * 4단계 (v4.2 4.4a b — 4.4 루프 대체). flagId ASC.
 *  ENGAGED·inCombat: halted = false, 노출 소모만. IDLE: 공격 태세면 옆 칸 생길 때 그 자리 재점화 [A-59].
 *  MARCHING: settle(현 위치) → 이동 → settle(새 칸, 남은 moveProgMilli 버림).
 *  RETURNING: 귀환지 재평가(지정 기지 우선 [A-61], 잃으면 폴백 + returnBaseTileId = null), × RETURN_SPEED, ZOC 무시 [A-62][A-63].
 */
export function stage4_moveFlags(state: GameState, t: number, out: Outbox): void {
  // ZOC 는 tick 시작 위치 스냅숏 기준 (flagId 처리 순서와 무관) [A-30]
  const zoc: ZocSource[] = [];
  for (const g of state.flags) if (g.posture === POSTURE.DEFEND && combatEligible(g)) zoc.push({ id: g.id, ownerId: g.ownerId, pos: g.posTileId });
  const zocBy = (f: Flag, tile: number): number[] => {
    const ids: number[] = [];
    for (const g of zoc) if (hostile(state, f.ownerId, g.ownerId) && state.graph.touching(tile, g.pos)) ids.push(g.id); // 2026-10-11: ZOC = 8방향 접촉
    return ids;
  };
  state.zocBlocked = new Map();

  for (const f of state.flags.slice()) {
    if (f.inCombat || f.state === 'ENGAGED') {
      f.halted = false;
      applyExposureAttrition(state, f, t, out);
      continue;
    }
    if (f.state === 'IDLE') {
      if (attackReady(f)) {
        const n = marchFrontCount(state, f);
        if (n > 0) {
          f.state = 'ENGAGED';
          f.idleSinceTick = null;
          out.broadcast.push({ type: 'flag_engaged', tick: t, flagId: f.id, posture: f.posture, frontTileCount: n });
        }
      }
      applyExposureAttrition(state, f, t, out);
      continue;
    }
    if (f.state === 'MARCHING') {
      f.nextTileId = nextStep(state, f, f.posTileId, f.anchorTileId);
      if (settle(state, f, t, out)) {
        applyExposureAttrition(state, f, t, out); // ① 현 위치 판정
        continue;
      }
      f.halted = false;
    } else if (f.state === 'RETURNING') {
      if (f.returnBaseTileId !== null && !returnBaseValid(state, f)) f.returnBaseTileId = null; // 지정 기지 상실 → 폴백, 복귀 안 함
      const rt = recallTarget(state, f); // 매 tick 재평가
      if (rt !== f.returnTileId) f.returnTileId = rt;
    }
    const dest = destOf(f);
    f.nextTileId = nextStep(state, f, f.posTileId, dest);
    let moved = false;
    if (f.posTileId !== dest) {
      const blockedBy = f.state === 'RETURNING' ? [] : zocBy(f, f.nextTileId); // v4.2 [A-62]: 귀환(패주 포함)은 ZOC 무시
      if (blockedBy.length && zocBy(f, f.posTileId).length) {
        state.zocBlocked.set(f.id, blockedBy); // 대치: moveProgMilli 유지
      } else {
        f.moveProgMilli += speedMilliAt(state, f, f.posTileId);
        while (f.moveProgMilli >= 1000) {
          f.moveProgMilli -= 1000;
          f.posTileId = f.nextTileId;
          moved = true;
          f.nextTileId = nextStep(state, f, f.posTileId, dest);
          if (f.posTileId === dest || f.nextTileId === f.posTileId) break; // v4.5: 방어 경로가 막히면 그 자리
        }
      }
    }
    if (moved && !(f.state === 'RETURNING' && t < f.breakawayUntilTick)) f.breakaway = false; // v5.10: 귀환 이탈 면제 RETURN_BREAKAWAY_TICKS
    if (applyExposureAttrition(state, f, t, out)) continue;

    if (f.state === 'MARCHING') {
      if (moved && settle(state, f, t, out)) f.moveProgMilli = 0; // ③ 새 칸 판정. 남은 이동 진행도는 버린다
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
