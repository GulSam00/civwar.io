/**
 * 생산 내역 (프로토콜 §21.4 → v4.5 §22.5) — 병력·골드 수입 표시와 hover 출처(기지별 + 영토).
 * 서버 `production.rows`(§22.5 — 기지 행 + 영토 행, milli/초)를 그대로 쓴다: 행 합 = 플레이어 총 생산(서버가 정확히 맞춘다).
 * 표가 아직 없으면(구 서버·부트스트랩 직후) 예전 클라이언트 식(goldPerSecond)으로 대신한다 — 생산력이 깎인 기지가 있으면 과대 추정.
 */
import type { ProductionRow } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { goldPerSecond } from './techInfo.js';

export interface Income {
  /** 순골드/초 (유지비 차감 후) */
  net: number;
  /** 그로스 골드/초 */
  gross: number;
  /** 병력 재생/초 (production 이 없으면 null) */
  troops: number | null;
  /** production 표에서 왔는가 */
  fromServer: boolean;
}

export function sumRows(rows: readonly ProductionRow[]): { troopsMilli: number; grossMilli: number; netMilli: number } {
  let troopsMilli = 0;
  let grossMilli = 0;
  let netMilli = 0;
  for (const r of rows) {
    troopsMilli += r.troopsPerSecMilli;
    grossMilli += r.goldGrossPerSecMilli;
    netMilli += r.goldNetPerSecMilli;
  }
  return { troopsMilli, grossMilli, netMilli };
}

/** 플레이어 수입 — §21.4 "수입 표시는 production 합" */
export function incomeOf(g: GameModel, playerId: number): Income | null {
  const p = g.players.get(playerId);
  if (!p) return null;
  const prodRows = g.production.get(playerId);
  if (prodRows && prodRows.length) {
    const s = sumRows(prodRows);
    return { net: s.netMilli / 1000, gross: s.grossMilli / 1000, troops: s.troopsMilli / 1000, fromServer: true };
  }
  const f = goldPerSecond(p.goldWeight, p.techMask, p.upkeepPm, g.config.constants);
  return { net: f.net, gross: f.gross, troops: null, fromServer: false };
}

export interface SourceRow {
  /** base-<tileId> | territory */
  key: string;
  kind: 'base' | 'territory';
  /** 지명 (기지) 또는 "영토" */
  label: string;
  /** 초당 양 */
  amount: number;
  /** 생산력 % (기지 행만, 영토 = null) */
  prodPct: number | null;
  /** 기지 행 = 환산 칸 수(60 / 수도 100), 영토 행 = 실제 소유 칸 수 */
  tiles: number;
  capital?: boolean;
}

/**
 * hover 출처 행 (§22.5) — 기지 행(지명·생산력, 많은 순 · 같으면 tileId) + 영토 합산 행 1개(맨 끝).
 * kind: troops = 병력 재생, gold = 순골드(유지비 차감 후 — 행 순골드 합 = 총 순수입).
 * 행의 amount 합 = 총합 (서버 행 합 = 총합이므로). 생산 지역 개념은 v4.5 에서 폐기됐다.
 */
export function productionRows(
  rows: readonly ProductionRow[],
  kind: 'troops' | 'gold',
  nameOf: (tile: number) => string | undefined,
  isCapital: (tile: number) => boolean = () => false,
): SourceRow[] {
  const val = (r: ProductionRow) => (kind === 'troops' ? r.troopsPerSecMilli : r.goldNetPerSecMilli) / 1000;
  const isBase = (r: ProductionRow) => r.kind === 'base' && r.baseTileId !== null;
  const out: SourceRow[] = rows
    .filter(isBase)
    .map((r) => ({
      key: `base-${r.baseTileId}`,
      kind: 'base' as const,
      label: nameOf(r.baseTileId!) ?? `기지 #${r.baseTileId}`,
      amount: val(r),
      prodPct: Math.floor(r.prodPm / 10),
      tiles: r.tiles,
      capital: isCapital(r.baseTileId!),
    }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const terr = rows.filter((r) => !isBase(r));
  if (terr.length) {
    out.push({ key: 'territory', kind: 'territory', label: '영토', amount: terr.reduce((s, r) => s + val(r), 0), prodPct: null, tiles: terr.reduce((s, r) => s + r.tiles, 0) });
  }
  return out;
}
