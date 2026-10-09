/**
 * 이벤트 피드 — 서버 이벤트(§5 표)를 사람이 읽는 한 줄로. 상태는 바꾸지 않는다(표시 전용).
 * 모든 플레이어의 사건을 다 쓰면 10인 봇전에서 초당 수십 줄이 되므로:
 *  - 전원 공지: 기지 함락, 탈락, 동맹 체결/파기, 종반 러시, 승리 기준 하락, Lockout
 *  - 나(또는 관전 중 따라가는 플레이어) 관련만: 전투 개시/종료, 패주, 깃발 종료, 정체, 진척도 감소로 0, 동맹 제안
 */
import type { ServerMessage } from '@civwar/shared';
import { TECH_NAME } from '../ui/techInfo.js';
import { EMOTE_TEXT } from '../ui/text.js';

export interface FeedEntry {
  id: number;
  tick: number;
  text: string;
  kind: 'combat' | 'base' | 'ally' | 'system' | 'flag';
  /** 나와 직접 관련 (강조) */
  mine: boolean;
  important?: boolean;
  toast?: boolean;
}

export interface FeedCtx {
  /** 나 (관전이면 따라가는 플레이어 또는 null) */
  me: number | null;
  nick(id: number): string;
  /** 이벤트 적용 전 깃발 소유자 */
  flagOwner(flagId: number): number | null;
  tickMs: number;
  /** 이벤트 적용 전 동맹 제안 (ally_proposal_closed 에는 당사자가 없다) */
  proposal?(proposalId: number): { fromPlayerId: number; toPlayerId: number } | undefined;
}

/** 받침 유무 — 한글 음절은 종성, 숫자는 읽는 소리(영·일·삼·육·칠·팔 = 받침), 그 외(영문 등)는 null */
export function hasBatchim(word: string): boolean | null {
  const ch = word.trim().slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  return null;
}
/** 조사 붙이기: josa('BOT 3', '이', '가') → 'BOT 3이' / 모르면 '이(가)' */
export function josa(word: string, withBatchim: string, without: string): string {
  const b = hasBatchim(word);
  return word + (b === null ? `${withBatchim}(${without})` : b ? withBatchim : without);
}

type Draft = Omit<FeedEntry, 'id' | 'tick'>;

const FLAG_END_TEXT: Record<string, string> = {
  recalled: '회수 완료',
  routed_returned: '패주 귀환',
  exhausted: '병력 소진',
  attrited: '노출 소모로 소멸',
  eliminated: '탈락으로 소멸',
};

export function describeEvent(m: ServerMessage, c: FeedCtx): Draft | null {
  const me = c.me;
  const isMe = (id: number | null | undefined) => me !== null && id === me;
  const who = (id: number) => (isMe(id) ? '나' : c.nick(id));
  /** 주어: 나 → "내가", 그 외 닉네임 + 이/가 (QA m-5) */
  const subj = (id: number) => (isMe(id) ? '내가' : josa(c.nick(id), '이', '가'));
  switch (m.type) {
    case 'base_captured': {
      const mine = isMe(m.toPlayerId) || isMe(m.fromPlayerId);
      const from = m.fromPlayerId === 0 ? '중립' : who(m.fromPlayerId);
      return { kind: 'base', mine, text: `${subj(m.toPlayerId)} ${from} 기지를 함락`, important: isMe(m.fromPlayerId), toast: isMe(m.fromPlayerId) };
    }
    case 'player_eliminated':
      return {
        kind: 'system',
        mine: isMe(m.playerId) || isMe(m.byPlayerId),
        text: `${who(m.playerId)} 탈락${m.byPlayerId ? ` (${who(m.byPlayerId)})` : ''}`,
        important: isMe(m.playerId),
      };
    case 'endgame_rush':
      return { kind: 'system', mine: false, text: `종반 러시 — 점령 비용 ×${m.costMultPermille / 1000}, 동맹 신규 체결 마감`, important: true, toast: true };
    case 'threshold_update':
      return { kind: 'system', mine: false, text: `승리 기준 ${m.thresholdPct.toFixed(1)}%로 하락` };
    case 'tech_purchased':
      return isMe(m.playerId) ? { kind: 'system', mine: true, text: `테크 구매: ${TECH_NAME[m.axis]} T${m.tier} (${m.cost} 골드)` } : null;
    case 'ally_proposed':
      if (isMe(m.toPlayerId)) return { kind: 'ally', mine: true, text: `${subj(m.fromPlayerId)} 동맹을 제안했습니다`, important: true, toast: true };
      if (isMe(m.fromPlayerId)) return { kind: 'ally', mine: true, text: `${who(m.toPlayerId)}에게 동맹 제안` };
      return null;
    case 'ally_formed':
      return { kind: 'ally', mine: isMe(m.a) || isMe(m.b), text: `동맹 성립: ${who(m.a)} · ${who(m.b)}`, toast: isMe(m.a) || isMe(m.b) };
    case 'ally_break_started':
      return {
        kind: 'ally',
        mine: isMe(m.a) || isMe(m.b),
        text: `${subj(m.byPlayerId)} 동맹 파기 (${who(m.a)} · ${who(m.b)}) — ${Math.round(((m.breakAtTick - m.tick) * c.tickMs) / 1000)}초 뒤 해제`,
        important: (isMe(m.a) || isMe(m.b)) && !isMe(m.byPlayerId),
        toast: (isMe(m.a) || isMe(m.b)) && !isMe(m.byPlayerId),
      };
    case 'ally_broken':
      return { kind: 'ally', mine: isMe(m.a) || isMe(m.b), text: `동맹 해제: ${who(m.a)} · ${who(m.b)}${m.reason === 'lockout' ? ' (전원 동맹 봉쇄)' : ''}` };
    case 'ally_proposal_closed': {
      // QA m-6: 내가 보낸 제안이 거절·만료되면 알린다 (formed 는 ally_formed 가 알림)
      const pr = c.proposal?.(m.proposalId);
      if (!pr || m.reason === 'formed') return null;
      if (isMe(pr.fromPlayerId)) {
        const why = m.reason === 'declined' ? '거절했습니다' : m.reason === 'expired' ? '응답하지 않아 만료됐습니다' : '무효가 됐습니다';
        return { kind: 'ally', mine: true, text: `${subj(pr.toPlayerId)} 동맹 제안을 ${why}`, toast: m.reason === 'declined' };
      }
      if (isMe(pr.toPlayerId) && m.reason === 'expired') return { kind: 'ally', mine: true, text: `${c.nick(pr.fromPlayerId)}의 동맹 제안이 만료됐습니다` };
      return null;
    }
    case 'emote_broadcast':
      return { kind: 'system', mine: isMe(m.playerId), text: `${who(m.playerId)}: ${EMOTE_TEXT[m.code] ?? `#${m.code}`}` };
    case 'alliance_lockout':
      if (m.phase === 'countdown') return { kind: 'ally', mine: false, text: '생존자 전원이 동맹 — 30초 뒤 모든 동맹이 강제 해제됩니다', important: true, toast: true };
      if (m.phase === 'dissolved') return { kind: 'ally', mine: false, text: '모든 동맹 강제 해제 · 60초간 재체결 금지', important: true, toast: true };
      return { kind: 'ally', mine: false, text: '동맹 봉쇄 카운트다운 취소' };
    case 'combat_started': {
      const owners = m.sides.flatMap((s) => s.ownerIds);
      if (!owners.some((o) => isMe(o))) return null;
      const foes = owners.filter((o) => !isMe(o)).map((o) => (o === 0 ? '중립' : c.nick(o)));
      return { kind: 'combat', mine: true, text: `전투 개시 — vs ${[...new Set(foes)].join(', ') || '?'}` };
    }
    case 'combat_ended': {
      const routedMine = m.routedFlagIds.filter((id) => isMe(c.flagOwner(id))).length;
      if (routedMine) return { kind: 'combat', mine: true, text: `전투 패배 — 내 깃발 ${routedMine}개 패주 (병력 0, 자동 귀환)`, important: true };
      return null;
    }
    case 'flag_ended': {
      const o = c.flagOwner(m.flagId);
      if (!isMe(o)) return null;
      return { kind: 'flag', mine: true, text: `깃발 종료: ${FLAG_END_TEXT[m.reason] ?? m.reason}${m.refunded ? ` (+${m.refunded} 환급)` : ''}` };
    }
    case 'flag_stalled':
      return isMe(c.flagOwner(m.flagId)) ? { kind: 'flag', mine: true, text: '깃발 정체 — 5초 동안 한 칸도 못 밀었습니다' } : null;
    case 'flag_progress_lost':
      if (!isMe(c.flagOwner(m.flagId))) return null;
      if (m.cause === 'decayed') return { kind: 'flag', mine: true, text: '진척도가 감소해 0이 되었습니다 (밀지 않는 동안 줄어듭니다)' };
      if (m.cause === 'captured_by_other') return { kind: 'flag', mine: true, text: '다른 깃발이 먼저 점령해 진척도를 잃었습니다' };
      return null;
    case 'flag_idle':
      return isMe(c.flagOwner(m.flagId))
        ? { kind: 'flag', mine: true, text: m.reason === 'allied' ? '동맹 성립으로 깃발 대기' : m.reason === 'guard_lost' ? '지킬 땅을 잃어 깃발 대기' : '밀 대상이 없어 깃발 대기 (2분 뒤 자동 회수)' }
        : null;
    case 'bot_takeover':
      return { kind: 'system', mine: isMe(m.playerId), text: `${who(m.playerId)} 연결 끊김 — 봇이 대신 조종` };
    case 'player_reconnected':
      return { kind: 'system', mine: isMe(m.playerId), text: `${who(m.playerId)} 재접속` };
    default:
      return null;
  }
}
