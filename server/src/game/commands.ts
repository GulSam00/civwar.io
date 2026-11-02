/**
 * 1단계 — 입력 큐 드레인과 명령 적용 (GDD 7.4 step 1).
 * 정렬 키: (recvSeq, connId, clientSeq). recvSeq 는 룸 수신 순번(= 수신 시각의 결정론적 대체).
 * 모든 cmd_* 는 반드시 cmd_ack 로 회신한다.
 */
import {
  TECH_NODE_COUNT,
  TECH_NODES,
  techMaskWith,
  techOwned,
  techExclusiveBlocker,
  techPrereqMet,
  techStatValues,
  type C2S_CmdBuyTech,
  type C2S_GameCommand,
  type CmdRejectReason,
  type S2C_CmdAck,
} from '@civwar/shared';
import { allyBreak, allyPropose, allyRespond } from './alliance.js';
import { flagCap, techCost } from './economy.js';
import { issueFlag, recallFlag, retargetFlag, setPosture, type CmdResult } from './flagops.js';
import type { Outbox } from './outbox.js';
import { recomputeGoldWeight, type GameState } from './state.js';

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

function flagAck(out: Outbox, playerId: number, clientSeq: number, r: CmdResult): void {
  if ('reason' in r) ack(out, playerId, clientSeq, r.reason);
  else ack(out, playerId, clientSeq, undefined, { flagId: r.flagId, posture: r.posture });
}

export function stage1_drainInput(state: GameState, queue: QueuedCommand[], t: number, out: Outbox): void {
  queue.sort(compareQueued);
  for (const q of queue) {
    const before = out.personal.length;
    applyCommand(state, q, t, out);
    // QA m-10: 봇(connId 0) 명령의 ack 은 표시만 해 두고 룸이 배달하지 않는다 (인계 후 복귀한 사람에게 모르는 clientSeq ack 방지)
    if (q.connId === 0) for (let i = before; i < out.personal.length; i++) out.personal[i].fromBot = true;
  }
}

function applyCommand(state: GameState, q: QueuedCommand, t: number, out: Outbox): void {
  const p = state.players[q.playerId];
  const seq = q.msg.clientSeq;
  if (!p) return ack(out, q.playerId, seq, 'NOT_IN_GAME');
  if (!p.alive) return ack(out, q.playerId, seq, 'ELIMINATED');
  switch (q.msg.type) {
    case 'cmd_buy_tech':
      return buyTech(state, q.playerId, q.msg, t, out);
    // 깃발 명령은 이 단계에서 즉시 적용 — 같은 tick 4·4a 가 새 상태(태세 포함)를 읽는다 (7.4)
    case 'cmd_flag_issue':
      return flagAck(out, q.playerId, seq, issueFlag(state, q.playerId, q.msg, t, out));
    case 'cmd_flag_retarget':
      return flagAck(out, q.playerId, seq, retargetFlag(state, q.playerId, q.msg, t, out));
    case 'cmd_flag_recall':
      return flagAck(out, q.playerId, seq, recallFlag(state, q.playerId, q.msg, t, out));
    case 'cmd_set_posture':
      return flagAck(out, q.playerId, seq, setPosture(state, q.playerId, q.msg, t, out));
    case 'cmd_ally_propose':
      return ack(out, q.playerId, seq, allyPropose(state, q.playerId, q.msg, t, out) ?? undefined);
    case 'cmd_ally_respond':
      return ack(out, q.playerId, seq, allyRespond(state, q.playerId, q.msg, t, out) ?? undefined);
    case 'cmd_ally_break':
      return ack(out, q.playerId, seq, allyBreak(state, q.playerId, q.msg, t, out) ?? undefined);
  }
}

/**
 * v4.3 테크 구매 (01b 4.4, A-66·A-69). 검증 순서: nodeId 범위(BAD_REQUEST) → 이미 보유(ALREADY_OWNED)
 * → 부모 미보유(PREREQ_MISSING) → 골드(INSUFFICIENT). 성공 = 골드 차감·마스크 갱신·스탯 캐시 재계산(즉시 발효).
 */
function buyTech(state: GameState, playerId: number, msg: C2S_CmdBuyTech, t: number, out: Outbox): void {
  const p = state.players[playerId];
  const { nodeId } = msg;
  if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= TECH_NODE_COUNT) return ack(out, playerId, msg.clientSeq, 'BAD_REQUEST');
  if (techOwned(p.techMask, nodeId)) return ack(out, playerId, msg.clientSeq, 'ALREADY_OWNED');
  if (!techPrereqMet(p.techMask, nodeId)) return ack(out, playerId, msg.clientSeq, 'PREREQ_MISSING');
  if (techExclusiveBlocker(p.techMask, nodeId) !== null) return ack(out, playerId, msg.clientSeq, 'EXCLUSIVE_BLOCKED'); // 2026-10-24: 양자택일 상대 보유
  const cost = techCost(TECH_NODES[nodeId].tier, p.techPurchased);
  if (p.goldMilli < cost * 1000) return ack(out, playerId, msg.clientSeq, 'INSUFFICIENT');
  p.goldMilli -= cost * 1000;
  p.techMask = techMaskWith(p.techMask, nodeId);
  p.techPurchased += 1;
  p.statPm = techStatValues(p.techMask);
  recomputeGoldWeight(state, p); // 지형별 골드 보너스(농경·개간·관개·채굴)는 소유 칸 가중치를 바꾼다
  ack(out, playerId, msg.clientSeq);
  out.broadcast.push({ type: 'tech_purchased', tick: t, playerId, nodeId, cost, newFlagCap: flagCap(p), techMask: p.techMask });
}
