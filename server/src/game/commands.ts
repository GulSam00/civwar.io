/**
 * 1단계 — 입력 큐 드레인과 명령 적용 (GDD 7.4 step 1).
 * 정렬 키: (recvSeq, connId, clientSeq). recvSeq 는 룸 수신 순번(= 수신 시각의 결정론적 대체).
 * 모든 cmd_* 는 반드시 cmd_ack 로 회신한다.
 */
import {
  TECH_AXIS_COUNT,
  TECH_MAX_TIER,
  type C2S_CmdBuyTech,
  type C2S_GameCommand,
  type CmdRejectReason,
  type S2C_CmdAck,
} from '@civwar/shared';
import { flagCap, techCost } from './economy.js';
import type { Outbox } from './outbox.js';
import type { GameState } from './state.js';

export interface QueuedCommand {
  recvSeq: number;
  connId: number; // 봇 = 0
  playerId: number;
  msg: C2S_GameCommand;
}

export function compareQueued(a: QueuedCommand, b: QueuedCommand): number {
  return a.recvSeq - b.recvSeq || a.connId - b.connId || a.msg.clientSeq - b.msg.clientSeq;
}

function ack(out: Outbox, playerId: number, clientSeq: number, reason?: CmdRejectReason, extra?: Partial<S2C_CmdAck>): void {
  const msg: S2C_CmdAck = { type: 'cmd_ack', clientSeq, accepted: reason === undefined, ...extra };
  if (reason !== undefined) msg.reason = reason;
  out.personal.push({ playerId, msg });
}

export function stage1_drainInput(state: GameState, queue: QueuedCommand[], t: number, out: Outbox): void {
  queue.sort(compareQueued);
  for (const q of queue) applyCommand(state, q, t, out);
}

function applyCommand(state: GameState, q: QueuedCommand, t: number, out: Outbox): void {
  const p = state.players[q.playerId];
  const seq = q.msg.clientSeq;
  if (!p) return ack(out, q.playerId, seq, 'NOT_IN_GAME');
  if (!p.alive) return ack(out, q.playerId, seq, 'ELIMINATED');
  switch (q.msg.type) {
    case 'cmd_buy_tech':
      return buyTech(state, q.playerId, q.msg, t, out);
    case 'cmd_flag_issue':
    case 'cmd_flag_retarget':
    case 'cmd_flag_recall':
    case 'cmd_set_posture':
      // 2차: 4.3 / 4.3a / 4.4 검증 + 적용. 태세 전환은 이 단계에서 즉시 적용(같은 tick 4a 가 새 태세를 읽음)
      return ack(out, q.playerId, seq, 'NOT_IMPLEMENTED');
    case 'cmd_ally_propose':
    case 'cmd_ally_respond':
    case 'cmd_ally_break':
      // 2차 이후: 6.2 동맹
      return ack(out, q.playerId, seq, 'NOT_IMPLEMENTED');
  }
}

function buyTech(state: GameState, playerId: number, msg: C2S_CmdBuyTech, t: number, out: Outbox): void {
  const p = state.players[playerId];
  const { axis, tier } = msg;
  if (!Number.isInteger(axis) || axis < 0 || axis >= TECH_AXIS_COUNT || !Number.isInteger(tier) || tier < 1 || tier > TECH_MAX_TIER) {
    return ack(out, playerId, msg.clientSeq, 'BAD_REQUEST');
  }
  if (p.tech[axis] !== tier - 1) return ack(out, playerId, msg.clientSeq, 'TECH_ORDER');
  const cost = techCost(tier, p.techPurchased);
  if (p.goldMilli < cost * 1000) return ack(out, playerId, msg.clientSeq, 'INSUFFICIENT');
  p.goldMilli -= cost * 1000;
  p.tech[axis] = tier;
  p.techPurchased += 1;
  ack(out, playerId, msg.clientSeq);
  out.broadcast.push({ type: 'tech_purchased', tick: t, playerId, axis, tier, cost, newFlagCap: flagCap(p) });
}
