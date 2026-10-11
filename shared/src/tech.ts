/**
 * 테크 v4.3 순수 함수 — 서버·클라이언트 공용 (정수 연산만, 결정론).
 * 상수 원본은 constants.ts 의 TECH_NODES / TECH_STAT / TECH_STAT_BASE / TECH_NODE_BASE_COST / TECH_PROGRESSIVE_COEF_PERMILLE.
 */
import {
  SHALLOW_MOVE_PERMILLE_MIN,
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
  if (nodes.length !== TECH_NODE_COUNT || TECH_NODE_COUNT > 32) throw new Error('TECH_NODES: 노드 수');
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
    if (n.op === 'set') {
      if (setOf.has(n.stat)) throw new Error(`TECH_NODES[${i}] 같은 스탯 set 노드 둘`);
      setOf.set(n.stat, i);
    } else addOf.add(n.stat);
  });
  for (const s of setOf.keys()) if (addOf.has(s)) throw new Error(`TECH_STAT ${s}: set 과 add 혼용`);
}
validateTechNodes(TECH_NODES);

/** 노드 i 보유 여부 (mask = uint32) */
export function techOwned(mask: number, nodeId: number): boolean {
  return ((mask >>> nodeId) & 1) === 1;
}

/** mask 에 노드 추가 (uint32 유지 — 비트 31 도 양수) */
export function techMaskWith(mask: number, nodeId: number): number {
  return (mask | (1 << nodeId)) >>> 0;
}

/** 보유 노드 수 (popcount) */
export function techCount(mask: number): number {
  let m = mask >>> 0;
  let k = 0;
  while (m) {
    m &= m - 1;
    k++;
  }
  return k;
}

/** 선행 조건: 부모가 없거나(T1) 부모를 보유 [A-66] */
export function techPrereqMet(mask: number, nodeId: number, nodes: readonly TechNodeDef[] = TECH_NODES): boolean {
  const p = nodes[nodeId].parent;
  return p === null || techOwned(mask, p);
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

/** 깃발 전투값 테크 배율 ‰ — 공격 태세 = COMBAT_ATK + COMBAT_ATK_<unit>, 방어 태세 = COMBAT_DEF + COMBAT_DEF_<unit> */
export function techCombatPm(stat: readonly number[], unit: number, defend: boolean): number {
  return defend ? stat[TECH_STAT.COMBAT_DEF] + stat[TECH_STAT.COMBAT_DEF_SPEAR + unit] : stat[TECH_STAT.COMBAT_ATK] + stat[TECH_STAT.COMBAT_ATK_SPEAR + unit];
}

/** 깃발 이동속도 테크 배율 ‰ = SPEED + SPEED_<unit> */
export function techSpeedPm(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.SPEED] + stat[TECH_STAT.SPEED_SPEAR + unit];
}

/** 얕은 물 이동배율 ‰ (하한 SHALLOW_MOVE_PERMILLE_MIN) */
export function techShallowPm(stat: readonly number[]): number {
  return Math.max(SHALLOW_MOVE_PERMILLE_MIN, stat[TECH_STAT.SHALLOW_MOVE]);
}

/** 그 플레이어의 병종 유지비 가중치 (UNIT_GARRISON_PERMILLE 대체) */
export function techUpkeepWeight(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.UPKEEP_WEIGHT_SPEAR + unit];
}

/** 그 플레이어의 병종 편성비 ‰ (UNIT_CONVERT_PERMILLE 대체). 풀 차감 = ceil(병력 × 이 값 / 1000) */
export function techConvertPm(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.CONVERT_SPEAR + unit];
}

/** 그 플레이어의 병종 점령비용 배율 ‰ (UNIT_ATK_MULT_PERMILLE 대체) */
export function techCaptureMultPm(stat: readonly number[], unit: number): number {
  return stat[TECH_STAT.CAPTURE_MULT_SPEAR + unit];
}
