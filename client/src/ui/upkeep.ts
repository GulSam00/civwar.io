/**
 * 깃발 유지비 표시 (하단 바 — 사용자 요청 2026-10-10, 패치 7차 2026-10-25 병력 비례로 개편). 표시 전용, 서버 값이 권위.
 *
 * 프로토콜(02_backend_protocol §8): 서버는 플레이어별 `upkeepPm`(총 골드 수입 대비 유지비, ‰ — 1000 초과 = 적자)만 보낸다.
 *   유지비 골드/초 = 총수입 − 순수입 (goldPerSecond) → 서버 값만으로 정확.
 *
 * 패치 7차 규칙: 출전한 깃발(패주 제외)의 병력 1000명당 골드/초 — 창 0.5 / 검 0.8 / 기병 1.5 (테크 반영). 풀 병력은 무료.
 * 그래서 "다음 깃발이 더할 유지비"는 병력 수에 비례하는 단가표로 보인다.
 */
import { UNIT_GARRISON_PERMILLE, UNIT_UPKEEP_RATE_MILLI, TECH_STAT, type Unit } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { techStatsOf } from './techInfo.js';

/** 그 플레이어의 병종 단가: 병력 1000명당 골드/초 (서버 unitUpkeepRateMilli 와 같은 식, 마구간 등 테크 반영) */
export function unitUpkeepPerKilo(m: GameModel, playerId: number, unit: Unit): number {
  const c = m.config.constants;
  const rates = (c?.UNIT_UPKEEP_RATE_MILLI as readonly number[] | undefined) ?? UNIT_UPKEEP_RATE_MILLI;
  const base = (c?.UNIT_GARRISON_PERMILLE as readonly number[] | undefined) ?? UNIT_GARRISON_PERMILLE;
  const stat = techStatsOf(m.players.get(playerId)?.techMask ?? 0, c);
  const weight = stat[TECH_STAT.UPKEEP_WEIGHT_SPEAR + unit] ?? base[unit];
  return Math.floor((rates[unit] * weight) / base[unit]) / 1000;
}
