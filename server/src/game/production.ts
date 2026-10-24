/**
 * v4.5 기지 생산 (사용자 2026-10-15, 프로토콜 §22 — 2026-10-14 "생산 지역" 해석 폐기).
 *
 * - 생산 지역 개념은 없다. 플레이어 생산 = **영토 생산**(내 땅 전부, 생산력 페널티 없음) + **기지 생산**(내 기지 칸마다).
 * - 기지 한 칸 = 영토(평원) BASE_PROD_TILES 60칸분, 수도 칸(어느 플레이어의 시작 수도든) = CAPITAL_PROD_TILES 100칸분 [A-107].
 *   점령 페널티(생산력 ×0.5 → 분당 +167‰ 회복)는 그 기지 생산에만 곱한다.
 *
 * 정수식 [A-103] (milli / tick):
 *   병력  terr   = 0.8 + 0.5·√T                                    (economy.terrRegenBaseMilli — 기존 영토 식)
 *         base_b = floor(eq_b × pm_b × PROD_REF_REGEN_MILLI / (PROD_REF_TILES × 1000))   (칸당 = 기준 390칸 평균 재생, 선형)
 *         R      = round((terr + Σ base_b) × 재생 테크 × (1 − troops/cap))   (economy.applyRegenMult — 로지스틱은 합에 한 번)
 *         행     = R 을 가중치 [base_b…, terr] 로 분배
 *   골드  GW_terr = p.goldWeight (지형 가중 합), GW_b = floor(eq_b × 1000(평원) × pm_b / 1000)
 *         gross  = floor(ΣGW × GOLD_RATE × 골드 테크 / 1e9), 행 = GW 비례 분배
 *         net    = gross − floor(gross × 유지비 / 1000) (총액에 한 번), 행 = gross 행 비례 분배
 *   분배 = 각 몫 floor, 잔여는 가중치 최대(동률 = 앞) 행에 → 행 합 = 총합 (정확히). 병력 상한은 그대로(전체 칸 수 기준).
 */
import { CAPITAL_PROD_TILES, BASE_PROD_TILES, GOLD_RATE_PERMILLE, TECH_STAT, techBaseProdPm } from '@civwar/shared';
import { applyRegenMult, baseGoldWeight, baseRegenBaseMilli, garrisonUpkeepPermille, terrRegenBaseMilli } from './economy.js';
import { baseProdPm, type GameState, type PlayerState, type ProductionYield } from './state.js';

/** total 을 weights 비례로 floor 분배, 잔여는 가중치 최대(동률 = 앞) 항목에. 합 = total. 가중치 합 0 이면 전부 0 (total 은 첫 항목에) */
export function distribute(total: number, weights: readonly number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (W <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const parts = weights.map((w) => Math.floor((total * w) / W));
  const rem = total - parts.reduce((a, b) => a + b, 0);
  if (rem !== 0) {
    let k = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[k]) k = i;
    parts[k] += rem;
  }
  return parts;
}

/** v4.5 [A-107]: 기지 칸의 환산 칸 수 — 시작 수도였던 칸(누가 갖고 있든) 100, 그 밖의 기지 60 */
export function baseEqTiles(state: Readonly<GameState>, tileId: number): number {
  const eq = state.capitalTiles.has(tileId) ? CAPITAL_PROD_TILES : BASE_PROD_TILES;
  // 2026-10-24 기지 증산(TER-3A): 그 칸을 지금 소유한 플레이어의 기지 생산 배율 (수도 포함 모든 기지)
  const own = state.players[state.owners[tileId]];
  return own ? Math.floor((eq * techBaseProdPm(own.statPm)) / 1000) : eq;
}

export interface ProductionResult {
  regenMilli: number;
  grossMilli: number;
  netMilli: number;
  upkeepPm: number;
  /** 기지 행(tileId ASC) + 영토 행(맨 끝) */
  yields: ProductionYield[];
}

/** 2단계 정산값 (상태를 쓰지 않는다) */
export function computeProduction(state: Readonly<GameState>, p: Readonly<PlayerState>): ProductionResult {
  const bases = p.baseTiles; // tileId ASC
  const eqs = bases.map((b) => baseEqTiles(state, b));
  const pms = bases.map((b) => baseProdPm(state.bases[state.baseIndexOf.get(b)!]));
  // 병력 — 가중치 순서 = [기지…, 영토]
  const wT = bases.map((_, i) => baseRegenBaseMilli(eqs[i], pms[i]));
  wT.push(p.tiles > 0 ? terrRegenBaseMilli(p.tiles) : 0);
  const regenMilli = applyRegenMult(
    p,
    wT.reduce((a, b) => a + b, 0),
  );
  const troops = distribute(regenMilli, wT);
  // 골드
  const gw = bases.map((_, i) => baseGoldWeight(eqs[i], pms[i]));
  gw.push(p.goldWeight);
  const sumGW = gw.reduce((a, b) => a + b, 0);
  const grossMilli = Math.floor((sumGW * GOLD_RATE_PERMILLE * p.statPm[TECH_STAT.GOLD]) / 1_000_000_000);
  const upkeepPm = garrisonUpkeepPermille(state, p);
  const netMilli = grossMilli - Math.floor((grossMilli * upkeepPm) / 1000);
  const gross = distribute(grossMilli, gw);
  const net = distribute(netMilli, gross);
  const yields: ProductionYield[] = bases.map((b, i) => ({
    kind: 'base',
    baseTileId: b,
    tiles: eqs[i],
    prodPm: pms[i],
    troopsMilli: troops[i],
    goldGrossMilli: gross[i],
    goldNetMilli: net[i],
  }));
  const k = bases.length;
  yields.push({ kind: 'territory', baseTileId: -1, tiles: p.tiles, prodPm: 1000, troopsMilli: troops[k], goldGrossMilli: gross[k], goldNetMilli: net[k] });
  return { regenMilli, grossMilli, netMilli, upkeepPm, yields };
}
