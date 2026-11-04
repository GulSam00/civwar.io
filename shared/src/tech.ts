/**
 * 테크 v4.3 순수 함수 — 서버·클라이언트 공용 (정수 연산만, 결정론).
 * 상수 원본은 constants.ts 의 TECH_NODES / TECH_STAT / TECH_STAT_BASE / TECH_NODE_BASE_COST / TECH_PROGRESSIVE_COEF_PERMILLE.
 */
import {
  FLAG_ORDER_COOLDOWN_TICKS,
  SHALLOW_MOVE_PERMILLE,
  TERRAIN,
  TERRAIN_GOLD_MILLI,
  TECH_NODE_BASE_COST,
  TECH_NODE_COUNT,
  TECH_NODES,
  TECH_PROGRESSIVE_COEF_PERMILLE,
  TECH_STAT,
  TECH_STAT_BASE,
  TECH_STAT_COUNT,
  type TechNodeDef,
} from './constants.js';

/** 노드 표 불변식 — 모듈 로드 시 1회 검사 (위반이면 서버가 뜨지 않는다) */
function validateTechNodes(nodes: readonly TechNodeDef[]): void {
  if (nodes.length !== TECH_NODE_COUNT || TECH_NODE_COUNT > 53) throw new Error('TECH_NODES: 노드 수 (techMask 는 53비트 안전 정수)');
  if (TECH_STAT_BASE.length !== TECH_STAT_COUNT) throw new Error('TECH_STAT_BASE: 길이');
  const setOf = new Map<number, number>();
  const addOf = new Set<number>();
  nodes.forEach((n, i) => {
    if (n.id !== i) throw new Error(`TECH_NODES[${i}].id`);
    if (!Number.isInteger(n.value) || n.stat < 0 || n.stat >= TECH_STAT_COUNT) throw new Error(`TECH_NODES[${i}] stat/value`);
    if (n.tier === 1 ? n.parent !== null : n.parent === null) throw new Error(`TECH_NODES[${i}] parent`);
    if (n.parent !== null) {
      const p = nodes[n.parent];
      if (!p || p.branch !== n.branch || p.tier !== n.tier - 1) throw new Error(`TECH_NODES[${i}] parent 갈래·티어`);
    }
    if (n.parentAlt !== undefined) {
      const p = nodes[n.parentAlt];
      if (n.parent === null || !p || p.branch !== n.branch || p.tier !== n.tier - 1 || n.parentAlt === n.parent) throw new Error(`TECH_NODES[${i}] parentAlt`);
    }
    if (n.exclusive !== undefined) {
      const q = nodes[n.exclusive];
      if (!q || q.exclusive !== i || q.branch !== n.branch || q.tier !== n.tier) throw new Error(`TECH_NODES[${i}] exclusive 는 같은 갈래·티어에서 서로 대칭이어야 한다`);
    }
    if (n.op === 'set') {
      if (setOf.has(n.stat)) throw new Error(`TECH_NODES[${i}] 같은 스탯 set 노드 둘`);
      setOf.set(n.stat, i);
    } else addOf.add(n.stat);
  });
  for (const s of setOf.keys()) if (addOf.has(s)) throw new Error(`TECH_STAT ${s}: set 과 add 혼용`);
}
validateTechNodes(TECH_NODES);

// 2026-10-24: 노드가 32개를 넘어 마스크를 비트 연산(32비트) 대신 **53비트 안전 정수** 산술로 다룬다 (필드·프로토콜 모양 불변, 노드 ≤ 53).
const POW2 = Array.from({ length: 53 }, (_, i) => 2 ** i);

/** 노드 i 보유 여부 (mask = 안전 정수, 비트 i = 노드 i) */
export function techOwned(mask: number, nodeId: number): boolean {
  return Math.floor(mask / POW2[nodeId]) % 2 === 1;
}

/** mask 에 노드 추가 (이미 보유면 그대로) */
export function techMaskWith(mask: number, nodeId: number): number {
  return techOwned(mask, nodeId) ? mask : mask + POW2[nodeId];
}

/** mask 에서 노드 제거 (표시용 "없을 때" 계산) */
export function techMaskWithout(mask: number, nodeId: number): number {
  return techOwned(mask, nodeId) ? mask - POW2[nodeId] : mask;
}

/** 보유 노드 수 (popcount) */
export function techCount(mask: number): number {
  let m = mask;
  let k = 0;
  while (m > 0) {
    k += m % 2;
    m = Math.floor(m / 2);
  }
  return k;
}

/** 선행 조건: 부모가 없거나(T1) 부모(또는 대체 부모)를 보유 [A-66] */
export function techPrereqMet(mask: number, nodeId: number, nodes: readonly TechNodeDef[] = TECH_NODES): boolean {
  const n = nodes[nodeId];
  if (n.parent === null) return true;
  return techOwned(mask, n.parent) || (n.parentAlt !== undefined && techOwned(mask, n.parentAlt));
}

/** 양자택일 상대를 이미 보유해 살 수 없으면 그 노드 id, 아니면 null (2026-10-24) */
export function techExclusiveBlocker(mask: number, nodeId: number, nodes: readonly TechNodeDef[] = TECH_NODES): number | null {
  const x = nodes[nodeId].exclusive;
  return x !== undefined && techOwned(mask, x) ? x : null;
}

/** [A-69·A-70] cost(node, n) = floor(BASE[tier-1] × (1000 + 60 × n) / 1000), n = 지금까지 산 노드 수 */
export function techNodeCost(
  tier: number,
  purchasedCount: number,
  baseCost: readonly number[] = TECH_NODE_BASE_COST,
  coefPermille: number = TECH_PROGRESSIVE_COEF_PERMILLE,
): number {
  return Math.floor((baseCost[tier - 1] * (1000 + coefPermille * purchasedCount)) / 1000);
}

/**
 * [A-71] 플레이어 스탯 캐시 — 인덱스 = TECH_STAT.
 * 값 = (보유 'set' 노드의 value, 없으면 TECH_STAT_BASE) + Σ 보유 'add' 노드의 value. 정수 덧셈만 → 구매 순서 무관.
 */
export function techStatValues(mask: number, nodes: readonly TechNodeDef[] = TECH_NODES, base: readonly number[] = TECH_STAT_BASE): number[] {
  const v = base.slice();
  for (const n of nodes) if (n.op === 'set' && techOwned(mask, n.id)) v[n.stat] = n.value;
  for (const n of nodes) if (n.op === 'add' && techOwned(mask, n.id)) v[n.stat] += n.value;
  return v;
}

// ── 스탯 읽기 도우미 (서버 계산식과 클라이언트 표시가 같은 식을 쓰도록) ──

/** 점수 → ‰ (1점 = 10‰). 병종 기본 ‰ 에 이 값을 더한다 (2026-10-24 절대값 전환) */
export const TECH_POINT_PERMILLE = 10;

/** 깃발 전투값 테크 **점수** — 공격 태세 = COMBAT_ATK + COMBAT_ATK_<unit>, 방어 태세 = COMBAT_DEF + COMBAT_DEF_<unit> */
export function techCombatPts(stat: readonly number[], unit: number, defend: boolean): number {
  return defend ? stat[TECH_STAT.COMBAT_DEF] + stat[TECH_STAT.COMBAT_DEF_SPEAR + unit] : stat[TECH_STAT.COMBAT_ATK] + stat[TECH_STAT.COMBAT_ATK_SPEAR + unit];
}

/**
 * §33 (전투 모델 2): 채널별 테크 점수 — 태세와 무관하게 COMBAT_ATK* -> ATK 채널, COMBAT_DEF* -> DEF 채널 [A-D6].
 * 같은 태세에서는 techCombatPts 와 같은 값이다.
 */
export function techChannelPts(stat: readonly number[], unit: number, channel: number): number {
  return channel === 0 ? stat[TECH_STAT.COMBAT_ATK] + stat[TECH_STAT.COMBAT_ATK_SPEAR + unit] : stat[TECH_STAT.COMBAT_DEF] + stat[TECH_STAT.COMBAT_DEF_SPEAR + unit];
}

/** §33: 사기 감소율 배율 ‰ (공통 + 병종별). 구 서버 설정(칸 없음)이면 1000 */
export function techMoraleDropPm(stat: readonly number[], unit: number): number {
  return (stat[TECH_STAT.MORALE_DROP] ?? 1000) + (stat[TECH_STAT.MORALE_DROP_SPEAR + unit] ?? 0);
}

/** §33: 사기 회복 배율 ‰ (공통 + 병종별). 구 서버 설정이면 1000 */
export function techMoraleRecoverPm(stat: readonly number[], unit: number): number {
  return (stat[TECH_STAT.MORALE_RECOVER] ?? 1000) + (stat[TECH_STAT.MORALE_RECOVER_SPEAR + unit] ?? 0);
}

/** §33: 사기 만땅 곱 가산 ‰ (공통 + 병종별, 기세). 구 서버 설정이면 0 */
export function techMoraleFullBonus(stat: readonly number[], unit: number): number {
  return (stat[TECH_STAT.MORALE_FULL_BONUS] ?? 0) + (stat[TECH_STAT.MORALE_FULL_BONUS_SPEAR + unit] ?? 0);
}

/** 깃발 이동속도 테크 **점수** = SPEED + SPEED_<unit> */
export function techSpeedPts(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.SPEED] + stat[TECH_STAT.SPEED_SPEAR + unit];
}

/** 2026-10-24: 기지 체력 피해 배율 ‰ (요새화로 줄어든다). 구 서버 설정이면 1000 */
export function techBaseDmgPm(stat: readonly number[]): number {
  return stat[TECH_STAT.BASE_DMG] ?? 1000;
}

/** 2026-10-24: 기지 생산력 회복 속도 배율 ‰ (기지 재건). 구 서버 설정이면 1000 */
export function techBaseRecoverPm(stat: readonly number[]): number {
  return stat[TECH_STAT.BASE_RECOVER] ?? 1000;
}

/** 2026-10-24: 공성 — 내 깃발이 적 기지에 입히는 체력 피해 배율 ‰ (공성 전술·공성 장비). 구 서버 설정이면 1000 */
export function techSiegePm(stat: readonly number[]): number {
  return stat[TECH_STAT.SIEGE] ?? 1000;
}

/** 2026-10-24: 모든 기지 생산 배율 ‰ (v5.8: 노드 없음). 구 서버 설정이면 1000 */
export function techBaseProdPm(stat: readonly number[]): number {
  return stat[TECH_STAT.BASE_PROD] ?? 1000;
}

/** v5.8: 기지 칸 골드 가중 배율 ‰ (세금 징수·교역소). 구 서버 설정이면 1000 */
export function techBaseGoldPm(stat: readonly number[]): number {
  return stat[TECH_STAT.BASE_GOLD] ?? 1000;
}

/** 2026-10-24 재정 개편: 영토 한 칸의 골드 가중치 = floor(지형 기본 × (1000 + 지형 보너스) / 1000). 평지·비옥·언덕은 GOLD_PLAIN, 사막·산은 GOLD_POOR */
export function tileGoldWeight(terrain: number, stat: readonly number[]): number {
  const w = TERRAIN_GOLD_MILLI[terrain] ?? 0;
  if (w === 0) return 0;
  const bonus = terrain === TERRAIN.PLAIN || terrain === TERRAIN.FERTILE || terrain === TERRAIN.HILLS ? (stat[TECH_STAT.GOLD_PLAIN] ?? 0) : (stat[TECH_STAT.GOLD_POOR] ?? 0);
  return Math.floor((w * (1000 + bonus)) / 1000);
}

/**
 * @deprecated v4.5 (2026-10-15): 해상 이동 폐지 — 물은 통행 불가. 항상 SHALLOW_MOVE_PERMILLE(기록값)을 돌려준다.
 * 구 클라이언트 호출 호환용으로만 남긴다 (스탯 칸 11 은 이제 DISENGAGE_TICKS).
 */
export function techShallowPm(_stat: readonly number[]): number {
  return SHALLOW_MOVE_PERMILLE;
}

/** v4.5: 그 플레이어의 이탈 대기 tick (무테크 15, MOB-3B 철수 훈련 10) */
export function techDisengageTicks(stat: readonly number[]): number {
  return stat[TECH_STAT.DISENGAGE_TICKS];
}

/** v4.5: 그 플레이어의 귀환 속도 배율 ‰ (무테크 1500, MOB-1 1700, MOB-2B 급속 귀환 2000) */
export function techReturnSpeedPm(stat: readonly number[]): number {
  return stat[TECH_STAT.RETURN_SPEED];
}

/** v5.8: 그 플레이어의 재지정·태세 공용 쿨타임 tick (무테크 20, 전령 −2 · 지휘 체계 −3). 구 서버 설정이면 기본값 */
export function techOrderCooldownTicks(stat: readonly number[]): number {
  return stat[TECH_STAT.ORDER_COOLDOWN] ?? FLAG_ORDER_COOLDOWN_TICKS;
}

/** 그 플레이어의 병종 유지비 가중치 (UNIT_GARRISON_PERMILLE 대체) */
export function techUpkeepWeight(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.UPKEEP_WEIGHT_SPEAR + unit];
}

/** 그 플레이어의 병종 편성비 ‰ (UNIT_CONVERT_PERMILLE 대체). 풀 차감 = ceil(병력 × 이 값 / 1000) */
export function techConvertPm(stat: readonly number[], unit: number): number {
  return Math.floor((stat[TECH_STAT.CONVERT_SPEAR + unit] * (stat[TECH_STAT.CONVERT] ?? 1000)) / 1000);
}

/** 그 플레이어의 병종 점령비용 배율 ‰ (UNIT_ATK_MULT_PERMILLE 대체) */
export function techCaptureMultPm(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.CAPTURE_MULT_SPEAR + unit];
}
