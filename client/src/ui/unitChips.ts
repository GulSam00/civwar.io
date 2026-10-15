/**
 * 내 출전 부대 칩 · 선택 부대 떠 있는 버튼 — 표시 상태 계산 (2026-10-14 사용자 요청). React 와 분리해 테스트한다.
 */
import { POSTURE, type FlagSnapshot, type Posture, type Unit } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';

export interface UnitChip {
  id: number;
  unit: Unit;
  troops: number;
  posture: Posture;
  slotIndex: number;
  selected: boolean;
  /** 패주(조작 불가·회색) */
  routed: boolean;
  /** 귀환 중(취소 불가) */
  returning: boolean;
  inCombat: boolean;
}

/** 병력 바 위 칩 — 내 깃발 전부, 슬롯 순. 없으면 빈 배열 */
export function myUnitChips(g: GameModel, me: number | null, selectedFlagId: number | null): UnitChip[] {
  if (me === null) return [];
  return g
    .flagsOf(me)
    .sort((a, b) => a.slotIndex - b.slotIndex || a.id - b.id)
    .map((f) => ({
      id: f.id,
      unit: f.unit as Unit,
      troops: f.troops,
      posture: f.posture as Posture,
      slotIndex: f.slotIndex,
      selected: f.id === selectedFlagId,
      routed: f.routed,
      returning: f.state === 'RETURNING',
      inCombat: f.inCombat,
    }));
}

export interface FlagActionState {
  /** [귀환] 비활성 사유 (null = 누를 수 있음) */
  recallBlocked: string | null;
  /** [태세 변경] 비활성 사유 (null = 누를 수 있음) */
  postureBlocked: string | null;
  /** 태세 전환 쿨타임 남은 초 (0 = 없음) */
  cooldownSec: number;
  /** 바꿀 태세 */
  nextPosture: Posture;
  /**
   * §21.2 대기 태세 — 우클릭 이동이 정한 도착지 태세가 쿨타임·전투 때문에 아직 적용되지 않았으면 그 태세(현재의 반대), 아니면 null.
   * 조건이 풀리면 서버가 자동 적용한다.
   */
  pendingPosture: Posture | null;
}

/**
 * 선택한 내 깃발의 [귀환]/[태세 변경] 버튼 상태 — 서버 거절 순서(프로토콜 §4)와 같은 조건으로 미리 막는다.
 *  recall: ROUTED → RETURNING
 *  posture: ROUTED → RETURNING → DISENGAGING → IN_COMBAT → POSTURE_COOLDOWN
 */
export function flagActionState(f: FlagSnapshot, tick: number, tickMs: number): FlagActionState {
  const cdTicks = Math.max(0, f.postureCooldownUntilTick - tick);
  const cooldownSec = cdTicks > 0 ? Math.ceil((cdTicks * tickMs) / 1000) : 0;
  const returning = f.state === 'RETURNING';
  const recallBlocked = f.routed ? '패주 중' : returning ? '귀환 중 — 취소 불가' : null;
  const postureBlocked = f.routed ? '패주 중' : returning ? '귀환 중' : f.disengaging ? '이탈 대기 중' : f.inCombat ? '전투 중' : cooldownSec > 0 ? `전환 대기 ${cooldownSec}초` : null;
  const pending = f.pendingPosture ?? null;
  return {
    recallBlocked,
    postureBlocked,
    cooldownSec,
    nextPosture: f.posture === POSTURE.ATTACK ? POSTURE.DEFEND : POSTURE.ATTACK,
    pendingPosture: pending !== null && pending !== f.posture && !f.routed && !returning ? (pending as Posture) : null,
  };
}
