/**
 * 영토 이름 (2026-10-14 사용자 요청) — 각 플레이어 이름을 영토 한가운데에 띄운다.
 *
 * 1) 기준점(territoryAnchors): 소유 칸 중심들의 무게중심 → 그 점에 가장 가까운 "자기 땅" 칸 중심.
 *    (오목한 영토·섬으로 갈린 영토는 무게중심이 바다·남의 땅일 수 있어 자기 칸으로 붙인다)
 *    O(칸 수) — 렌더러가 영토가 바뀌었을 때만, 그것도 최대 1초에 한 번 다시 계산한다(매 프레임 아님).
 * 2) 배치(layoutTerritoryLabels): 매 프레임, 화면 좌표·글자 크기·겹침 정리. 플레이어 수(≤ 32)만큼이라 싸다.
 *    글자 크기 = 영토 크기(√칸 수)에 비례 × 줌, 화면 픽셀로 [min, max] 안 (두 줌 단계 모두 읽히게).
 *    큰 영토부터 놓고, 이미 놓인 이름과 겹치면 최소 크기까지 줄여 보고 그래도 겹치면 생략한다.
 * 칸 좌표는 TopologyView.tileCenter 로만 얻는다 (사각 전제 식 없음).
 */

export interface TerritoryAnchor {
  owner: number;
  /** 월드 좌표 (칸 중심) — 가장 큰 연결 덩어리의 중심 */
  x: number;
  y: number;
  /** 소유 칸 총수 (이름 우선순위 = 큰 영토 먼저) */
  tiles: number;
  /** 이름이 붙은 연결 덩어리(가장 큰 조각)의 칸 수 — 글자 크기 기준. 없으면 tiles */
  pieceTiles?: number;
}

/**
 * owners[t] = 소유자(0 = 중립). isLand 가 false 인 칸은 건너뛴다.
 * 결과는 칸 수 내림차순 (같으면 owner 오름차순).
 * neighbors 가 주어지면 소유자별로 연결 덩어리를 나눠 **가장 큰 덩어리**(같으면 가장 작은 칸 id 가 든 쪽)의 중심에 붙인다 —
 * 조각난 영토의 이름이 조각들 사이 남의 땅·바다 위에 뜨지 않게 (2026-10-19). 없으면 영토 전체 무게중심(예전 방식).
 */
export function territoryAnchors(
  owners: ArrayLike<number>,
  tileCount: number,
  tileCenter: (t: number) => { x: number; y: number },
  isLand: (t: number) => boolean = () => true,
  neighbors?: (t: number) => readonly number[],
): TerritoryAnchor[] {
  const total = new Map<number, number>();
  for (let t = 0; t < tileCount; t++) {
    const o = owners[t];
    if (o && isLand(t)) total.set(o, (total.get(o) ?? 0) + 1);
  }
  // 소유자별 "이름이 붙을 칸 집합" — 가장 큰 연결 덩어리(neighbors 없으면 전부)
  const piece = new Map<number, number[]>();
  if (neighbors) {
    const seen = new Uint8Array(tileCount);
    for (let t = 0; t < tileCount; t++) {
      const o = owners[t];
      if (!o || !isLand(t) || seen[t]) continue;
      const comp: number[] = [t];
      seen[t] = 1;
      for (let i = 0; i < comp.length; i++) {
        for (const n of neighbors(comp[i])) {
          if (!seen[n] && owners[n] === o && isLand(n)) {
            seen[n] = 1;
            comp.push(n);
          }
        }
      }
      const cur = piece.get(o);
      if (!cur || comp.length > cur.length) piece.set(o, comp); // t 오름차순 순회 → 같은 크기면 먼저 만난(작은 id) 조각 유지
    }
  } else {
    for (let t = 0; t < tileCount; t++) {
      const o = owners[t];
      if (!o || !isLand(t)) continue;
      const arr = piece.get(o);
      if (arr) arr.push(t);
      else piece.set(o, [t]);
    }
  }
  const out: TerritoryAnchor[] = [];
  for (const [owner, tiles] of piece) {
    let sx = 0;
    let sy = 0;
    for (const t of tiles) {
      const c = tileCenter(t);
      sx += c.x;
      sy += c.y;
    }
    const mx = sx / tiles.length;
    const my = sy / tiles.length;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (const t of [...tiles].sort((p, q) => p - q)) {
      const c = tileCenter(t);
      const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
      if (d < best) {
        best = d;
        bx = c.x;
        by = c.y;
      }
    }
    out.push({ owner, x: bx, y: by, tiles: total.get(owner)!, pieceTiles: tiles.length });
  }
  return out.sort((p, q) => q.tiles - p.tiles || p.owner - q.owner);
}

export interface PlacedLabel {
  owner: number;
  text: string;
  /** 화면 좌표 (글자 가운데) */
  x: number;
  y: number;
  /** 글자 크기 px */
  size: number;
  /** 이름 아래 작은 줄 (총 병력 — 2026-10-18). 없으면 없음 */
  sub?: string;
  /** 작은 줄 글자 크기 px */
  subSize?: number;
  /** 깃발·기지 아이콘을 비껴 놓을 자리가 없어 그 위에 놓인 이름 — 렌더러가 흐리게 그린다 */
  dim?: boolean;
}

/** 이름 아래 병력 줄 글자 크기 = 이름의 0.62배, 최소 9px */
export const LABEL_SUB_MIN_PX = 9;
export function subSizePx(size: number): number {
  return Math.max(LABEL_SUB_MIN_PX, Math.round(size * 0.62));
}

export const LABEL_MIN_PX = 11;
/** 2026-10-19: 30 → 20 (전체 맵 보기에서 이름이 서로·아이콘을 덮던 문제) */
export const LABEL_MAX_PX = 20;
/** 월드 단위 글자 크기 = √칸 수 × 이 값 (칸 1 = 월드 1). 0.32 → 0.2 */
export const LABEL_WORLD_PER_SQRT_TILE = 0.2;
/** 아이콘 위에 놓일 때 이름 투명도 */
export const LABEL_DIM_ALPHA = 0.4;

/** 영토 크기·줌 → 화면 글자 크기 (px) */
export function labelSizePx(tiles: number, zoom: number, min = LABEL_MIN_PX, max = LABEL_MAX_PX): number {
  const s = Math.sqrt(Math.max(1, tiles)) * LABEL_WORLD_PER_SQRT_TILE * zoom;
  return Math.round(Math.min(max, Math.max(min, s)));
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * 화면 배치. toScreen = 월드 → 화면, measure(text, size) = 글자 폭(px), view = 화면 크기.
 * 화면 밖 이름은 버린다. 겹침은 위 설명대로 정리.
 * sub(owner) = 이름 아래 작은 줄(총 병력, 2026-10-18). 주어지면 겹침 상자가 그 줄까지 포함한다(이름 y 는 그대로, 줄은 아래).
 */
export function layoutTerritoryLabels(
  anchors: readonly TerritoryAnchor[],
  text: (owner: number) => string,
  toScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  measure: (text: string, size: number, isSub?: boolean) => number,
  view: { w: number; h: number },
  sub?: (owner: number) => string,
  /** 피할 화면 사각형 (깃발·기지 아이콘). 겹치면 위·아래로 비껴 놓고, 그래도 안 되면 흐리게 */
  obstacles: readonly Rect[] = [],
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const rects: Rect[] = [];
  const pad = 3;
  const rectOf = (x: number, y: number, w: number, size: number, below: number): Rect => ({ x0: x - w / 2 - pad, y0: y - size / 2 - pad, x1: x + w / 2 + pad, y1: y + size / 2 + below + pad });
  for (const a of anchors) {
    const p = toScreen(a.x, a.y);
    const label = text(a.owner);
    if (!label) continue;
    const subText = sub ? sub(a.owner) : '';
    const want = labelSizePx(a.pieceTiles ?? a.tiles, zoom);
    for (const size of want > LABEL_MIN_PX ? [want, LABEL_MIN_PX] : [want]) {
      const ss = subSizePx(size);
      const w = subText ? Math.max(measure(label, size, false), measure(subText, ss, true)) : measure(label, size, false);
      const below = subText ? ss * 1.15 : 0;
      const h = size + below;
      const r0 = rectOf(p.x, p.y, w, size, below);
      if (r0.x1 < 0 || r0.y1 < 0 || r0.x0 > view.w || r0.y0 > view.h) break; // 화면 밖
      if (rects.some((q) => overlaps(q, r0))) continue; // 이미 놓인(더 큰 영토) 이름과 겹침 → 줄여 보기 / 생략
      // 아이콘(깃발·기지)과 겹치면 위·아래로 한두 줄 높이 비껴 본다 (다른 이름·아이콘 모두 피하는 자리만). 없으면 제자리에 흐리게
      let fit: { y: number; r: Rect; clear: boolean } = { y: p.y, r: r0, clear: !obstacles.some((q) => overlaps(q, r0)) };
      if (!fit.clear) {
        for (const dy of [-h * 0.9, h * 0.9, -h * 1.8, h * 1.8]) {
          const r = rectOf(p.x, p.y + dy, w, size, below);
          if (rects.some((q) => overlaps(q, r)) || obstacles.some((q) => overlaps(q, r))) continue;
          fit = { y: p.y + dy, r, clear: true };
          break;
        }
      }
      rects.push(fit.r);
      const l: PlacedLabel = subText ? { owner: a.owner, text: label, x: p.x, y: fit.y, size, sub: subText, subSize: ss } : { owner: a.owner, text: label, x: p.x, y: fit.y, size };
      if (!fit.clear) l.dim = true;
      placed.push(l);
      break;
    }
  }
  return placed;
}
