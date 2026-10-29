/**
 * 표시용 절대값 계산 (2026-10-28 UI 개선) — 배율(×0.85)·소수(0.0104 골드) 대신 "칸당 병력", "분당 골드" 같은 정수로 보인다.
 * 서버 식을 그대로 옮겼다. 표시 전용 — 서버 값이 권위:
 *   점령 비용  = server/src/game/rules.ts tileCost (중립 7 / 적 11 × 테크 × 인접 × 지형 × 병종 × 보급 × 러시 × 빚, 올림, 최소 4)
 *               v5.1: 병종 배율은 전 병종 1000 (UNIT_ATK_MULT_PERMILLE), 병종 전용 점령 테크(SPE-2A·SPE-3B·SWO-2B·CAV-3A)만 병종 차이를 만든다
 *   기지 함락  = 남은 체력 × 칸 비용 ÷ 1000 (baseCaptureTroops — 체력은 hpPct 근사)
 *   지형 골드  = shared tileGoldWeight × GOLD_RATE × 골드 스탯 (server economy.grossGoldMilliPerTick 를 칸 하나로)
 *   이동       = rules.ts 깃발 속도 (FLAG_SPEED_BASE_MILLI × (병종 속도 + 테크 점수) ÷ 지형 느려짐)
 */
import {
  ADJACENCY_COEF_PERMILLE,
  BASE_HP_MILLI,
  CAPITAL_HP_MILLI,
  DEBT_CAPTURE_COST_PERMILLE,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENEMY_BASE,
  FLAG_SPEED_BASE_MILLI,
  GOLD_RATE_PERMILLE,
  MIN_TILE_COST,
  MORALE_DROP_DEFEND_PER_TICK,
  MORALE_DROP_LOSS_K,
  MORALE_DROP_PER_TICK,
  MORALE_FLOOR,
  MORALE_FULL,
  MORALE_MULT_CAP,
  MORALE_RECOVER,
  MORALE_RECOVER_BASE,
  NEUTRAL_BASE,
  SUPPLY_FREE_RADIUS,
  SUPPLY_MAX_MULT_PERMILLE,
  SUPPLY_NO_BASE_DIST,
  TECH_POINT_PERMILLE,
  TECH_STAT,
  TERRAIN_COST_PERMILLE,
  TICK_MS,
  UNIT_ASSAULT_PERMILLE,
  UNIT_SPEED_PERMILLE,
  techCaptureMultPm,
  techConvertPm,
  techMoraleDropPm,
  techMoraleFullBonus,
  techMoraleRecoverPm,
  techSpeedPts,
  tileGoldWeight,
  type Unit,
} from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { techStatsOf, unitCombatStats } from './techInfo.js';
import { unitUpkeepPerKilo } from './upkeep.js';

type Consts = Record<string, unknown> | undefined;
function c<T>(consts: Consts, name: string, fallback: T): T {
  const v = consts?.[name];
  return (v === undefined ? fallback : v) as T;
}

const MICRO = 1_000_000;

/** 칸 이웃·거리 (render/topology 의 일부 — 테스트에서 가짜로 넣기 쉽게) */
export interface TopoLike {
  neighbors(tileId: number): readonly number[];
  distance(a: number, b: number): number;
}

function statOf(g: GameModel, playerId: number): number[] {
  return techStatsOf(g.players.get(playerId)?.techMask ?? 0, g.config.constants);
}

/** 보급 배율 ‰ — 내 기지(수도 포함) 중 가장 가까운 곳까지 거리 (server supplyPermille) */
function supplyPm(g: GameModel, topo: TopoLike, playerId: number, stat: readonly number[], tile: number): number {
  const k = g.config.constants;
  let d = c(k, 'SUPPLY_NO_BASE_DIST', SUPPLY_NO_BASE_DIST);
  let any = false;
  for (const b of g.bases.values()) {
    if (b.ownerId !== playerId) continue;
    const x = topo.distance(b.tileId, tile);
    d = any ? Math.min(d, x) : x;
    any = true;
  }
  const free = c(k, 'SUPPLY_FREE_RADIUS', SUPPLY_FREE_RADIUS);
  return Math.min(c(k, 'SUPPLY_MAX_MULT_PERMILLE', SUPPLY_MAX_MULT_PERMILLE), 1000 + stat[TECH_STAT.SUPPLY_COEF] * Math.max(0, d - free));
}

/**
 * 그 칸을 한 칸 점령하는 데 드는 병력 (server tileCost 와 같은 순서·floor). 내 땅·동맹·물이면 null.
 * topo 가 없으면 인접 가산·보급 배율을 뺀 값(최소치)이다.
 */
export function captureCost(g: GameModel, topo: TopoLike | null, playerId: number, unit: number, tile: number): number | null {
  if (!g.terrain || !g.isLand(tile)) return null;
  const o = g.owners[tile];
  if (o === playerId || (o !== 0 && g.isAlly(playerId, o))) return null;
  const k = g.config.constants;
  const stat = statOf(g, playerId);
  let v: number;
  if (o === 0) {
    v = c(k, 'NEUTRAL_BASE', NEUTRAL_BASE) * MICRO;
    v = Math.floor((v * stat[TECH_STAT.NEUTRAL_COST]) / 1000);
  } else {
    v = c(k, 'ENEMY_BASE', ENEMY_BASE) * MICRO;
    v = Math.floor((v * statOf(g, o)[TECH_STAT.DEF_COST]) / 1000);
    v = Math.floor((v * stat[TECH_STAT.ATK_COST]) / 1000);
    let n = 0;
    if (topo) for (const x of topo.neighbors(tile)) if (g.owners[x] === o) n++;
    v = Math.floor((v * (1000 + c(k, 'ADJACENCY_COEF_PERMILLE', ADJACENCY_COEF_PERMILLE) * n)) / 1000);
  }
  v = Math.floor((v * c<readonly number[]>(k, 'TERRAIN_COST_PERMILLE', TERRAIN_COST_PERMILLE)[g.terrain[tile]]) / 1000);
  v = Math.floor((v * techCaptureMultPm(stat, unit)) / 1000);
  if (topo) v = Math.floor((v * supplyPm(g, topo, playerId, stat, tile)) / 1000);
  if (g.endgameRushActive) v = Math.floor((v * c(k, 'ENDGAME_RUSH_COST_MULT_PERMILLE', ENDGAME_RUSH_COST_MULT_PERMILLE)) / 1000);
  if ((g.players.get(playerId)?.gold ?? 0) < 0) v = Math.floor((v * c(k, 'DEBT_CAPTURE_COST_PERMILLE', DEBT_CAPTURE_COST_PERMILLE)) / 1000);
  return Math.max(c(k, 'MIN_TILE_COST', MIN_TILE_COST), Math.floor((v + MICRO - 1) / MICRO));
}

/**
 * v5.1 (GDD 4.4 점령 비용 표시, [A-5.1-6·7]) — 그 기지를 함락하는 데 드는 병력 ≈ ceil(남은 체력 milli × 칸 비용 ÷ 1000).
 * 서버 applyBaseHits 의 지출 = 적용 피해 × tileCost ÷ 1000 (tick 마다 올림). 공성·요새화 배율은 속도·상한만 바꾸고 체력당 병력은 그대로.
 * 근사: 남은 체력은 스냅숏 hpPct(정수 %)에서 되돌린다 — 최대 체력 = 처음 수도였던 칸(map_init.spawns[].homeTileId) 15000, 나머지 10000.
 * tick 마다 올림하므로 실제 소모가 조금 더 많을 수 있다 → 표시는 "약 N명". 기지가 아니거나 칸 비용이 없으면(내 땅·동맹) null.
 */
export function baseCaptureTroops(g: GameModel, topo: TopoLike | null, playerId: number, unit: number, tile: number): number | null {
  const b = g.bases.get(tile);
  if (!b) return null;
  const cost = captureCost(g, topo, playerId, unit, tile);
  if (cost === null) return null;
  const k = g.config.constants;
  const maxHp = g.capitalTiles.has(tile) ? c(k, 'CAPITAL_HP_MILLI', CAPITAL_HP_MILLI) : c(k, 'BASE_HP_MILLI', BASE_HP_MILLI);
  const hp = Math.round((maxHp * Math.max(0, Math.min(100, b.hpPct))) / 100);
  return Math.ceil((hp * cost) / 1000);
}

/** 기준 점령 비용 — 보급 거리 안 중립 평원 한 칸 (병종 비교용) */
export function neutralPlainCost(g: GameModel, playerId: number, unit: number): number {
  const k = g.config.constants;
  const stat = statOf(g, playerId);
  let v = c(k, 'NEUTRAL_BASE', NEUTRAL_BASE) * MICRO;
  v = Math.floor((v * stat[TECH_STAT.NEUTRAL_COST]) / 1000);
  v = Math.floor((v * techCaptureMultPm(stat, unit)) / 1000);
  if ((g.players.get(playerId)?.gold ?? 0) < 0) v = Math.floor((v * c(k, 'DEBT_CAPTURE_COST_PERMILLE', DEBT_CAPTURE_COST_PERMILLE)) / 1000);
  return Math.max(c(k, 'MIN_TILE_COST', MIN_TILE_COST), Math.floor((v + MICRO - 1) / MICRO));
}

/** 그 지형 100칸이 1분에 버는 골드 (테크 반영, 반올림). 물 = 0 */
export function goldPer100TilesPerMin(g: GameModel, playerId: number | null, terrain: number): number {
  const k = g.config.constants;
  const stat = playerId !== null ? statOf(g, playerId) : techStatsOf(0, k);
  const w = tileGoldWeight(terrain, stat);
  const milliPerTick = (w * c(k, 'GOLD_RATE_PERMILLE', GOLD_RATE_PERMILLE) * stat[TECH_STAT.GOLD]) / 1e9;
  const ticksPerMin = 60000 / c(k, 'TICK_MS', TICK_MS);
  return Math.round((milliPerTick * ticksPerMin * 100) / 1000);
}

/** 평원 10칸을 걷는 데 걸리는 초 (지형 느려짐 1000 기준, 귀환 가속 제외) */
export function secPer10Tiles(g: GameModel, playerId: number, unit: number): number {
  const k = g.config.constants;
  const stat = statOf(g, playerId);
  const speed = c<readonly number[]>(k, 'UNIT_SPEED_PERMILLE', UNIT_SPEED_PERMILLE)[unit] + TECH_POINT_PERMILLE * techSpeedPts(stat, unit);
  const milliTilesPerTick = Math.max(1, Math.floor((c(k, 'FLAG_SPEED_BASE_MILLI', FLAG_SPEED_BASE_MILLI) * speed) / 1000));
  return Math.round((10_000 / milliTilesPerTick) * (c(k, 'TICK_MS', TICK_MS) / 1000));
}

/** 사기 곱 범위 ‰ — 사기 0 일 때 / 100% 일 때 (테크 기세 반영) */
export function moraleRange(unit: number, stat: readonly number[]): { floor: number; full: number } {
  return { floor: MORALE_FLOOR[unit], full: Math.min(MORALE_MULT_CAP, MORALE_FULL[unit] + techMoraleFullBonus(stat, unit)) };
}

/** 전투력 ±0 이 되는 사기 (0..1000). 사기 0 에서도 보너스면(창병) null */
export function moraleNeutralPoint(unit: number, stat: readonly number[]): number | null {
  const { floor, full } = moraleRange(unit, stat);
  if (floor >= 1000) return null;
  if (full <= 1000) return 1000;
  return Math.ceil(((1000 - floor) * 1000) / (full - floor));
}

/** 사기 변화 속도 (%/초, 테크 반영) — 교전 고정 감소(공격·방어 태세)·비전투 회복·내 기지 위 회복. 손실 1%당 추가 감소 %p */
export function moraleRates(unit: number, stat: readonly number[]): { dropAtk: number; dropDef: number; lossK: number; recover: number; recoverBase: number } {
  const perSec = 1000 / TICK_MS / 10; // ‰/tick → %/초
  const dropPm = techMoraleDropPm(stat, unit);
  const recPm = techMoraleRecoverPm(stat, unit);
  const drop = (fixed: number) => Math.max(1, Math.floor((fixed * dropPm) / 1000)) * perSec;
  return {
    dropAtk: drop(MORALE_DROP_PER_TICK[unit]),
    dropDef: drop(MORALE_DROP_DEFEND_PER_TICK[unit]),
    lossK: (MORALE_DROP_LOSS_K * dropPm) / 1000 / 10,
    recover: (Math.floor((MORALE_RECOVER * recPm) / 1000) * perSec),
    recoverBase: (Math.floor((MORALE_RECOVER_BASE * recPm) / 1000) * perSec),
  };
}

/** ‰ 곱 → "+20%" / "−15%" / "±0%" */
export function pctOfPm(pm: number): string {
  const d = Math.round((pm - 1000) / 10);
  return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}%`;
}

/** 소수 한 자리까지만 (정수면 정수로) */
export function fmt1(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** 출전 버튼 툴팁용 병종 능력치 (그 플레이어 테크 반영) */
export interface UnitSpec {
  atk: number;
  def: number;
  /** 점령 속도 점수 (검병 100) */
  assault: number;
  sec10: number;
  /** 중립 평원 한 칸 점령 병력 */
  capture: number;
  /** 병력 100명을 편성할 때 풀에서 빠지는 병력 */
  convertPer100: number;
  /** 병력 1000명당 유지비 골드/분 */
  upkeepPerMin: number;
  moraleFloor: number;
  moraleFull: number;
  moraleNeutral: number | null;
  rates: ReturnType<typeof moraleRates>;
}

export function unitSpec(g: GameModel, playerId: number, unit: Unit): UnitSpec {
  const k = g.config.constants;
  const stat = statOf(g, playerId);
  const cs = unitCombatStats(unit, g.players.get(playerId)?.techMask ?? 0, k);
  const mr = moraleRange(unit, stat);
  return {
    atk: Math.round(cs.atk / TECH_POINT_PERMILLE),
    def: Math.round(cs.def / TECH_POINT_PERMILLE),
    assault: Math.round(c<readonly number[]>(k, 'UNIT_ASSAULT_PERMILLE', UNIT_ASSAULT_PERMILLE)[unit] / 10),
    sec10: secPer10Tiles(g, playerId, unit),
    capture: neutralPlainCost(g, playerId, unit),
    convertPer100: Math.ceil(techConvertPm(stat, unit) / 10),
    upkeepPerMin: Math.round(unitUpkeepPerKilo(g, playerId, unit) * 60),
    moraleFloor: mr.floor,
    moraleFull: mr.full,
    moraleNeutral: moraleNeutralPoint(unit, stat),
    rates: moraleRates(unit, stat),
  };
}

/** 병종 한 줄 성격 (수치에서 나온 요약 — 별도 상성표는 없다: 교전 손실은 양쪽 공격·방어 수치 비교로 나뉜다) */
export const UNIT_ROLE = ['방어 강함 · 편성 저렴 · 사기 안정', '균형형', '공격·이동·점령 빠름 · 편성·유지 비쌈 · 사기 기복 큼'] as const;

