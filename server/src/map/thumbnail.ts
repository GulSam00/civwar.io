/**
 * §26 방 카드 썸네일 — 실제로 만들어진 맵을 작은 격자(기본 최대 50×30)로 줄인 지형 RLE.
 * 클라이언트가 맵 생성기(server/src/map/generate.ts — shared 에 없다)를 갖지 않아도 같은 맵 그림을 그릴 수 있게 서버가 줄여서 보낸다.
 *
 * - 블록 한 변 scale = ceil(max(W / maxW, H / maxH)) (정사각 블록, 가장자리 블록은 잘린다)
 * - 축소 칸 지형 = 블록 안 지형 코드 최빈값, 동률은 작은 코드 (결정론)
 * - bases = 기지가 들어 있는 축소 칸 index (오름차순, 중복 없음)
 */
import { rleEncode, type MapThumbnail } from '@civwar/shared';

export const THUMB_MAX_W = 50;
export const THUMB_MAX_H = 30;

export interface ThumbSource {
  readonly width: number;
  readonly height: number;
  /** tileId = y × width + x (사각 토폴로지) */
  readonly terrain: ArrayLike<number>;
  readonly baseTiles: readonly number[];
}

export function buildThumbnail(map: ThumbSource, maxW = THUMB_MAX_W, maxH = THUMB_MAX_H): MapThumbnail {
  const { width: W, height: H } = map;
  const scale = Math.max(1, Math.ceil(Math.max(W / maxW, H / maxH)));
  const w = Math.ceil(W / scale);
  const h = Math.ceil(H / scale);
  const cells = new Uint8Array(w * h);
  const count = new Uint16Array(256);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      count.fill(0);
      for (let y = cy * scale; y < Math.min(H, (cy + 1) * scale); y++)
        for (let x = cx * scale; x < Math.min(W, (cx + 1) * scale); x++) count[map.terrain[y * W + x]]++;
      let best = 0;
      for (let v = 1; v < 256; v++) if (count[v] > count[best]) best = v;
      cells[cy * w + cx] = best;
    }
  }
  const bases = [...new Set(map.baseTiles.map((t) => Math.floor(Math.floor(t / W) / scale) * w + Math.floor((t % W) / scale)))].sort((a, b) => a - b);
  return { width: w, height: h, scale, terrain: rleEncode(cells), bases };
}
