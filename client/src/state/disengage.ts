/**
 * 소유자 스탯 이탈 대기 tick — match_config 의 노드 표 우선 (v4.5 §22.7: 무테크 15, 기동 「철수 훈련」 10).
 * 이탈 호(렌더러)와 태세 버튼의 교전 중 전환 경고(§27)가 같은 값을 쓴다.
 */
import { DISENGAGE_TICKS, TECH_NODES, TECH_STAT_BASE, techDisengageTicks, techOrderCooldownTicks, techStatValues, type TechNodeDef } from '@civwar/shared';
import type { GameModel } from './gameModel.js';

function ownerStat(model: GameModel, ownerId: number): number[] {
  const mask = model.players.get(ownerId)?.techMask ?? 0;
  const consts = model.config.constants;
  const nodes = (consts?.TECH_NODES as readonly TechNodeDef[] | undefined) ?? TECH_NODES;
  const base = (consts?.TECH_STAT_BASE as readonly number[] | undefined) ?? TECH_STAT_BASE;
  return techStatValues(mask, nodes, base);
}

export function disengageTicksOf(model: GameModel, ownerId: number): number {
  return Math.max(1, techDisengageTicks(ownerStat(model, ownerId)) || DISENGAGE_TICKS);
}

/** v5.8: 소유자 스탯 재지정·태세 공용 쿨타임 tick — 쿨타임 호의 분모 */
export function orderCooldownTicksOf(model: GameModel, ownerId: number): number {
  return Math.max(1, techOrderCooldownTicks(ownerStat(model, ownerId)));
}
