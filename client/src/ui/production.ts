/**
 * 생산 내역 (프로토콜 §21.4) — 병력·골드 수입 표시와 hover 출처(기지별 + 기타).
 * 서버 `production` 표(milli/초)를 그대로 쓴다: 지역 합 = 플레이어 총 생산(서버가 정확히 맞춘다).
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

export function sumRegions(regions: readonly ProductionRow[]): { troopsMilli: number; grossMilli: number; netMilli: number } {
  let troopsMilli = 0;
  let grossMilli = 0;
  let netMilli = 0;
  for (const r of regions) {
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
  const regions = g.production.get(playerId);
  if (regions && regions.length) {
    const s = sumRegions(regions);
    return { net: s.netMilli / 1000, gross: s.grossMilli / 1000, troops: s.troopsMilli / 1000, fromServer: true };
  }
  const f = goldPerSecond(p.goldWeight, p.techMask, p.upkeepPm, g.config.constants);
  return { net: f.net, gross: f.gross, troops: null, fromServer: false };
}

export interface SourceRow {
  key: string;
  /** 지명 (기지) 또는 "기타" */
  label: string;
  /** 초당 양 */
  amount: number;
  /** 생산력 % (기지 지역만, 기타 = null) */
  prodPct: number | null;
  /** 지역 칸 수 */
  tiles: number;
  capital?: boolean;
}

/**
 * hover 출처 행 — 서버 지역 순서(기지 tileId 오름차순, 기타 맨 끝) 대신 많은 순(같으면 tileId), "기타"는 맨 끝.
 * kind: troops = 병력 재생, gold = 순골드(유지비 차감 후 — 지역별 순골드 합 = 총 순수입).
 * 행의 amount 합 = 총합 (서버 지역 합 = 총합이므로).
 */
export function productionRows(
  regions: readonly ProductionRow[],
  kind: 'troops' | 'gold',
  nameOf: (tile: number) => string | undefined,
  isCapital: (tile: number) => boolean = () => false,
): SourceRow[] {
  const val = (r: ProductionRow) => (kind === 'troops' ? r.troopsPerSecMilli : r.goldNetPerSecMilli) / 1000;
  const bases = regions.filter((r) => r.baseTileId !== null);
  const other = regions.filter((r) => r.baseTileId === null);
  const rows: SourceRow[] = bases
    .map((r) => ({
      key: `base-${r.baseTileId}`,
      label: nameOf(r.baseTileId!) ?? `기지 #${r.baseTileId}`,
      amount: val(r),
      prodPct: Math.floor(r.prodPm / 10),
      tiles: r.tiles,
      capital: isCapital(r.baseTileId!),
    }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  if (other.length) {
    rows.push({ key: 'other', label: '기타', amount: other.reduce((s, r) => s + val(r), 0), prodPct: null, tiles: other.reduce((s, r) => s + r.tiles, 0) });
  }
  return rows;
}
