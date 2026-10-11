/** 표시 문자열 (한국어). 코드 값은 프로토콜 문서 §6 그대로 키로 쓴다. */
import type { CmdRejectReason, ErrorCode, FlagState, GameOverReason } from '@civwar/shared';

export const UNIT_NAME = ['창병', '검병', '기병'] as const;
export const UNIT_SHORT = ['창', '검', '기'] as const;
export const POSTURE_NAME = ['공격', '방어'] as const;
export const TERRAIN_NAME = ['깊은 물', '평원', '비옥지', '언덕', '사막', '산', '얕은 물'] as const;

export const FLAG_STATE_NAME: Record<FlagState, string> = {
  MARCHING: '행군',
  ENGAGED: '교전',
  RETURNING: '귀환',
  IDLE: '대기',
};

export const REJECT_TEXT: Record<CmdRejectReason, string> = {
  ELIMINATED: '탈락한 플레이어는 명령할 수 없습니다',
  NO_SLOT: '깃발 슬롯이 꽉 찼습니다',
  BAD_UNIT: '잘못된 병종입니다',
  WATER: '물은 앵커로 지정할 수 없습니다',
  ALLIED: '동맹 영토입니다',
  OUT_OF_RANGE: '내 영토에서 너무 멉니다 (40칸 초과)',
  TOO_SMALL: '병력이 너무 적습니다 (최소 40)',
  INSUFFICIENT: '병력(또는 골드)이 부족합니다',
  NO_FLAG: '없는 깃발입니다',
  RETURNING: '귀환 중인 깃발입니다',
  LOCKED: '방금 재지정한 깃발입니다 (잠시 후 가능)',
  NOT_BASE: '기지가 아닙니다',
  NOT_OWNED_BASE: '내 기지가 아닙니다',
  ROUTED: '패주 중인 깃발은 조작할 수 없습니다',
  IN_COMBAT: '전투 중에는 태세를 바꿀 수 없습니다',
  DISENGAGING: '이탈 대기 중입니다',
  POSTURE_COOLDOWN: '태세 전환 쿨타임 중입니다',
  SAME_POSTURE: '이미 그 태세입니다',
  BAD_REQUEST: '잘못된 요청입니다',
  NOT_IN_GAME: '게임 중이 아닙니다',
  TECH_ORDER: '선행 테크가 필요합니다',
  PREREQ_MISSING: '선행 테크가 필요합니다',
  ALREADY_OWNED: '이미 보유한 테크입니다',
  RATE_LIMITED: '명령이 너무 빠릅니다',
  NOT_IMPLEMENTED: '아직 지원하지 않는 명령입니다',
  BAD_TARGET: '대상이 올바르지 않습니다',
  ALLY_LIMIT: '동맹 수 한도를 넘습니다',
  ALLY_CUTOFF: '동맹 마감 시각이 지났습니다',
  ALLY_FROZEN: '동맹 재체결 금지 기간입니다',
  ALREADY_ALLIED: '이미 동맹입니다',
  ALLY_PENDING: '이미 제안을 보냈습니다',
  NO_PROPOSAL: '유효한 제안이 없습니다',
  NOT_ALLIED: '동맹이 아닙니다',
  MIN_DURATION: '동맹 최소 유지 시간이 지나지 않았습니다',
};

export const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  BAD_NICKNAME: '닉네임은 1~16자여야 합니다',
  BAD_VERSION: '클라이언트 버전이 서버와 다릅니다. 새로고침하세요',
  ROOM_NOT_FOUND: '방을 찾을 수 없습니다',
  ROOM_FULL: '방이 가득 찼습니다',
  ROOM_IN_PROGRESS: '이미 시작된 방입니다 (관전은 가능)',
  ALREADY_IN_ROOM: '이미 다른 방에 있습니다',
  NOT_IN_ROOM: '방에 있지 않습니다',
  NOT_HOST: '방장만 할 수 있습니다',
  NOT_LOBBY: '대기 중인 방이 아닙니다',
  BAD_ROOM_OPTIONS: '방 설정이 올바르지 않습니다',
  MAP_NOT_FOUND: '맵을 찾을 수 없습니다',
  NOT_ENOUGH_PLAYERS: '시작 인원이 2명 미만입니다',
};

export const GAME_OVER_REASON: Record<GameOverReason, string> = {
  last_standing: '최후의 생존자',
  threshold: '점유율 승리',
  timeout: '시간 종료',
};

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 이모트 문구 (프로토콜 §4 emote: 코드 0..EMOTE_CODE_MAX(15) — 의미는 클라이언트 정의, 서버는 코드만 중계).
 */
export const EMOTE_TEXT = [
  '안녕하세요',
  '좋아요',
  '고마워요',
  '미안해요',
  '동맹 어때요?',
  '공격 멈춰요',
  '도와주세요',
  '여기!',
  '조심하세요',
  '잘했어요',
  'ㅋㅋㅋ',
  '아쉽다',
  '잠깐만요',
  '가자!',
  '항복',
  'GG',
] as const;
