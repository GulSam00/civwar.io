/**
 * 테크 표시 정보 — v4.3 (32노드, techMask). 수치는 상수(match_config.constants 우선, 없으면 shared)에서 만든다 — 하드코딩 금지.
 * 백엔드 v4.3 전환 때 빌드를 유지하려고 최소한으로 맞춘 파일이다. 새 테크 화면(갈래 열 × 티어 격자, 상세 패널)은 프론트 작업에서 교체한다.
 */
import {
  GOLD_RATE_PERMILLE,
  TECH_NODE_BASE_COST,
  TECH_NODES,
  TECH_PROGRESSIVE_COEF_PERMILLE,
  TECH_STAT,
  TECH_STAT_BASE,
  TICK_MS,
  techNodeCost,
  techStatValues,
  type TechNodeDef,
} from '@civwar/shared';

type Consts = Record<string, unknown> | undefined;
function c<T>(consts: Consts, name: string, fallback: T): T {
  const v = consts?.[name];
  return (v === undefined ? fallback : v) as T;
}

export function techNodes(consts?: Consts): readonly TechNodeDef[] {
  return c(consts, 'TECH_NODES', TECH_NODES);
}

/** 플레이어 스탯 (인덱스 = TECH_STAT) — 서버 statPm 과 같은 식 */
export function techStatsOf(techMask: number, consts?: Consts): number[] {
  return techStatValues(techMask, techNodes(consts), c(consts, 'TECH_STAT_BASE', TECH_STAT_BASE));
}

/** 프로토콜 §19: cost = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + 60 × 보유 노드 수) / 1000) */
export function techCost(tier: number, techCount: number, consts?: Consts): number {
  return techNodeCost(tier, techCount, c(consts, 'TECH_NODE_BASE_COST', TECH_NODE_BASE_COST), c(consts, 'TECH_PROGRESSIVE_COEF_PERMILLE', TECH_PROGRESSIVE_COEF_PERMILLE));
}

/**
 * §8 골드: goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹), net = gross − floor(gross × upkeepPm / 1000).
 * goldPm = 스탯 GOLD (techMask 에서). 표시용 초당 값 (실수).
 */
export function goldPerSecond(goldWeight: number, techMask: number, upkeepPm: number, consts?: Consts): { gross: number; net: number } {
  const rate = c(consts, 'GOLD_RATE_PERMILLE', GOLD_RATE_PERMILLE);
  const gpm = techStatsOf(techMask, consts)[TECH_STAT.GOLD];
  const grossMilli = Math.floor((goldWeight * rate * gpm) / 1e9);
  const netMilli = grossMilli - Math.floor((grossMilli * upkeepPm) / 1000);
  const perSec = 1000 / c(consts, 'TICK_MS', TICK_MS);
  return { gross: (grossMilli * perSec) / 1000, net: (netMilli * perSec) / 1000 };
}
