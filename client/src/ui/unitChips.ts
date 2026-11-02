/**
 * 내 출전 부대 칩 · 선택 부대 떠 있는 버튼 — 표시 상태 계산 (2026-10-14 사용자 요청). React 와 분리해 테스트한다.
 */
import { DISENGAGE_TICKS, POSTURE, type FlagSnapshot, type Posture, type Unit } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { flagMoraleBands, type MoraleBands } from './morale.js';

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
  /** §33 사기 0..1000 (전투 모델 2 일 때만, 아니면 null) */
  morale: number | null;
  /** 사기 막대 구간 (morale 이 null 이면 쓰지 않는다) */
  moraleBands: MoraleBands;
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
      morale: g.config.combatModel === 2 ? (f.morale ?? null) : null,
      moraleBands: flagMoraleBands(g, f),
    }));
}

export interface FlagActionState {
  /** [귀환] 비활성 사유 (null = 누를 수 있음) */
  recallBlocked: string | null;
  /** [태세 변경] 비활성 사유 (null = 누를 수 있음). v4.6 §27: 패주·귀환·쿨타임만 — 전투 중·이탈 대기 중에도 누를 수 있다 */
  postureBlocked: string | null;
  /** 태세 전환 쿨타임 남은 초 (0 = 없음) */
  cooldownSec: number;
  /** 바꿀 태세 */
  nextPosture: Posture;
  /**
   * §27.1-4 교전 중 전환 경고 — 눌러서 바꿀 수 있는 상태에서 전투 중이면 "이탈 대기 n초, 방어력 ×0.5" (n = 소유자 스탯 이탈 대기),
   * 이미 이탈 대기 중이면 "대기 시간은 그대로". 아니면 null
   */
  combatWarning: string | null;
}

/**
 * 선택한 내 깃발의 [귀환]/[태세 변경] 버튼 상태 — 서버 거절 순서(프로토콜 §4, §27.1-3)와 같은 조건으로 미리 막는다.
 *  recall: ROUTED → RETURNING
 *  posture: ROUTED → RETURNING → ORDER_COOLDOWN  (DISENGAGING·IN_COMBAT 은 더 이상 거절하지 않는다 — 전투 중 전환은 이탈 대기를 치르고 즉시 적용)
 * disengageTicks: 소유자 스탯 이탈 대기 tick (철수 훈련 10, 기본 15) — 경고 문구의 초
 */
export function flagActionState(f: FlagSnapshot, tick: number, tickMs: number, disengageTicks: number = DISENGAGE_TICKS): FlagActionState {
  const cdTicks = Math.max(0, f.orderCooldownUntilTick - tick);
  const cooldownSec = cdTicks > 0 ? Math.ceil((cdTicks * tickMs) / 1000) : 0;
  const returning = f.state === 'RETURNING';
  const recallBlocked = f.routed ? '패주 중' : returning ? '귀환 중 — 취소 불가' : null;
  const postureBlocked = f.routed ? '패주 중' : returning ? '귀환 중' : cooldownSec > 0 ? `쿨타임 ${cooldownSec}초` : null;
  let combatWarning: string | null = null;
  if (postureBlocked === null && f.disengaging) combatWarning = '이탈 대기 중 — 전환해도 남은 대기 시간은 그대로, 방어력 ×0.5';
  else if (postureBlocked === null && f.inCombat) combatWarning = `교전 중 전환: 이탈 대기 ${Math.ceil((disengageTicks * tickMs) / 1000)}초, 방어력 ×0.5`;
  return {
    recallBlocked,
    postureBlocked,
    cooldownSec,
    nextPosture: f.posture === POSTURE.ATTACK ? POSTURE.DEFEND : POSTURE.ATTACK,
    combatWarning,
  };
}
