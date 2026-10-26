/**
 * 소유자 스탯 이탈 대기 tick — match_config 의 노드 표 우선 (v4.5 §22.7: 무테크 15, 기동 「철수 훈련」 10).
 * 이탈 호(렌더러)와 태세 버튼의 교전 중 전환 경고(§27)가 같은 값을 쓴다.
 */
import { DISENGAGE_TICKS, TECH_NODES, TECH_STAT_BASE, techDisengageTicks, techStatValues, type TechNodeDef } from '@civwar/shared';
import type { GameModel } from './gameModel.js';

export function disengageTicksOf(model: GameModel, ownerId: number): number {
  const mask = model.players.get(ownerId)?.techMask ?? 0;
  const consts = model.config.constants;
  const nodes = (consts?.TECH_NODES as readonly TechNodeDef[] | undefined) ?? TECH_NODES;
  const base = (consts?.TECH_STAT_BASE as readonly number[] | undefined) ?? TECH_STAT_BASE;
  return Math.max(1, techDisengageTicks(techStatValues(mask, nodes, base)) || DISENGAGE_TICKS);
}
