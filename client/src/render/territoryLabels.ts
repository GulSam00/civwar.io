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
  /** 월드 좌표 (칸 중심) */
  x: number;
  y: number;
  tiles: number;
}

/**
 * owners[t] = 소유자(0 = 중립). isLand 가 false 인 칸은 건너뛴다.
 * 결과는 칸 수 내림차순 (같으면 owner 오름차순).
 */
export function territoryAnchors(
  owners: ArrayLike<number>,
  tileCount: number,
  tileCenter: (t: number) => { x: number; y: number },
  isLand: (t: number) => boolean = () => true,
): TerritoryAnchor[] {
  const sum = new Map<number, { sx: number; sy: number; n: number }>();
  for (let t = 0; t < tileCount; t++) {
    const o = owners[t];
    if (!o || !isLand(t)) continue;
    const c = tileCenter(t);
    const a = sum.get(o);
    if (a) {
      a.sx += c.x;
      a.sy += c.y;
      a.n++;
    } else sum.set(o, { sx: c.x, sy: c.y, n: 1 });
  }
  const best = new Map<number, { d: number; x: number; y: number }>();
  for (let t = 0; t < tileCount; t++) {
    const o = owners[t];
    if (!o || !isLand(t)) continue;
    const a = sum.get(o)!;
    const c = tileCenter(t);
    const dx = c.x - a.sx / a.n;
    const dy = c.y - a.sy / a.n;
    const d = dx * dx + dy * dy;
    const b = best.get(o);
    if (!b || d < b.d) best.set(o, { d, x: c.x, y: c.y });
  }
  const out: TerritoryAnchor[] = [];
  for (const [owner, a] of sum) {
    const b = best.get(owner)!;
    out.push({ owner, x: b.x, y: b.y, tiles: a.n });
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
}

export const LABEL_MIN_PX = 11;
export const LABEL_MAX_PX = 30;
/** 월드 단위 글자 크기 = √칸 수 × 이 값 (칸 1 = 월드 1) */
export const LABEL_WORLD_PER_SQRT_TILE = 0.32;

/** 영토 크기·줌 → 화면 글자 크기 (px) */
export function labelSizePx(tiles: number, zoom: number, min = LABEL_MIN_PX, max = LABEL_MAX_PX): number {
  const s = Math.sqrt(Math.max(1, tiles)) * LABEL_WORLD_PER_SQRT_TILE * zoom;
  return Math.round(Math.min(max, Math.max(min, s)));
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * 화면 배치. toScreen = 월드 → 화면, measure(text, size) = 글자 폭(px), view = 화면 크기.
 * 화면 밖 이름은 버린다. 겹침은 위 설명대로 정리.
 */
export function layoutTerritoryLabels(
  anchors: readonly TerritoryAnchor[],
  text: (owner: number) => string,
  toScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  measure: (text: string, size: number) => number,
  view: { w: number; h: number },
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const rects: Rect[] = [];
  const pad = 3;
  const rectOf = (x: number, y: number, w: number, size: number): Rect => ({ x0: x - w / 2 - pad, y0: y - size / 2 - pad, x1: x + w / 2 + pad, y1: y + size / 2 + pad });
  for (const a of anchors) {
    const p = toScreen(a.x, a.y);
    const label = text(a.owner);
    if (!label) continue;
    const want = labelSizePx(a.tiles, zoom);
    for (const size of want > LABEL_MIN_PX ? [want, LABEL_MIN_PX] : [want]) {
      const w = measure(label, size);
      const r = rectOf(p.x, p.y, w, size);
      if (r.x1 < 0 || r.y1 < 0 || r.x0 > view.w || r.y0 > view.h) break; // 화면 밖
      if (rects.some((q) => overlaps(q, r))) continue; // 겹침 → 줄여 보기 / 생략
      rects.push(r);
      placed.push({ owner: a.owner, text: label, x: p.x, y: p.y, size });
      break;
    }
  }
  return placed;
}
