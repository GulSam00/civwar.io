/**
 * 맵 미리보기 썸네일 — 지형 RLE + 스폰 + 기지를 작은 캔버스에 그린다.
 * 타일 그리기·좌표는 TopologyView 를 거친다 (사각 전제는 topology.ts 에만).
 */
import { rleDecode, type MapThumbnail } from '@civwar/shared';
import { createTopologyView } from './topology.js';
import { PLAYER_HEX, tileRgba } from './palette.js';

export interface MapPreviewData {
  topology: string;
  width: number;
  height: number;
  terrain: number[]; // RLE
  spawns: number[];
  bases: number[];
  /** 프리셋 2.8 f: N 인 게임의 스폰 인덱스 부분집합 (없으면 spawns 앞 N 개) */
  spawnSets?: Record<string, number[]>;
}

/** 서버 presetSpawnIndices 와 같은 규칙: spawnSets[N] → 없으면 0..N-1 (QA m-7) */
export function previewSpawns(m: MapPreviewData, n: number): number[] {
  const set = m.spawnSets?.[String(n)];
  const idx = set ?? Array.from({ length: Math.min(n, m.spawns.length) }, (_, i) => i);
  return idx.map((i) => m.spawns[i]).filter((t) => t !== undefined);
}

export function drawMapPreview(canvas: HTMLCanvasElement, m: MapPreviewData, spawnCount: number): void {
  const topo = createTopologyView(m.topology, m.width, m.height);
  const terrain = rleDecode(m.terrain, topo.tileCount);
  const { ctx, k, ox, oy } = drawTerrain(canvas, topo, terrain);
  const used = previewSpawns(m, spawnCount);
  const spawnSet = new Set(used);
  for (const b of m.bases) {
    if (spawnSet.has(b)) continue;
    const c = topo.tileCenter(b);
    ctx.fillStyle = '#f5f1e6';
    ctx.strokeStyle = '#111';
    ctx.fillRect(ox + c.x * k - 2.5, oy + c.y * k - 2.5, 5, 5);
    ctx.strokeRect(ox + c.x * k - 2.5, oy + c.y * k - 2.5, 5, 5);
  }
  used.forEach((s, i) => {
    const c = topo.tileCenter(s);
    ctx.fillStyle = PLAYER_HEX[i + 1] ?? '#fff';
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.rect(ox + c.x * k - 3.5, oy + c.y * k - 3.5, 7, 7);
    ctx.fill();
    ctx.stroke();
  });
}

/** 지형 배열을 캔버스 크기에 맞춰 그린다 (가운데 정렬). 돌려주는 k·ox·oy 로 위에 표식을 얹는다 */
function drawTerrain(canvas: HTMLCanvasElement, topo: ReturnType<typeof createTopologyView>, terrain: ArrayLike<number>) {
  const layer = topo.createTileLayer();
  for (let t = 0; t < topo.tileCount; t++) layer.setColor(t, tileRgba(terrain[t], 0));
  layer.flush();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c1118';
  ctx.fillRect(0, 0, w, h);
  const k = Math.min(w / topo.worldWidth, h / topo.worldHeight);
  const ox = (w - topo.worldWidth * k) / 2;
  const oy = (h - topo.worldHeight * k) / 2;
  layer.drawScaled(ctx, ox, oy, topo.worldWidth * k, topo.worldHeight * k);
  return { ctx, k, ox, oy };
}

/**
 * 무작위 맵 방의 썸네일 (2026-10-18 로비 카드). room_list 에는 지형이 없어(시드도 없음) 실제 맵이 아니라
 * 방 id 로 만든 "분위기용" 그림이다 — 카드에 "무작위" 표시를 함께 단다. 같은 방은 늘 같은 그림.
 * 값 잡음 2옥타브 + 가장자리로 갈수록 바다(호수형 맵 느낌). 지형 코드는 shared TERRAIN (0 바다 … 6 호수).
 */
export function randomPreviewTerrain(seed: number, width: number, height: number): Uint8Array {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const grid = (cell: number) => {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const v = Array.from({ length: gw * gh }, rnd);
    return (x: number, y: number) => {
      const fx = x / cell;
      const fy = y / cell;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => v[b * gw + a];
      const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
      const bot = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
      return top * (1 - sy) + bot * sy;
    };
  };
  const big = grid(Math.max(6, Math.round(Math.min(width, height) / 4)));
  const small = grid(4);
  const rough = grid(7);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ex = Math.min(x, width - 1 - x) / (width / 2);
      const ey = Math.min(y, height - 1 - y) / (height / 2);
      const edge = Math.min(1, Math.min(ex, ey) * 3.2);
      const h = (big(x, y) * 0.7 + small(x, y) * 0.3) * edge;
      const r = rough(x, y);
      let t: number;
      if (h < 0.26) t = edge < 0.6 ? 0 : 6; // 가장자리 = 바다, 안쪽 = 호수
      else if (h > 0.62) t = 5;
      else if (h > 0.52) t = 3;
      else t = r > 0.7 ? 4 : r < 0.3 ? 2 : 1;
      out[y * width + x] = t;
    }
  }
  return out;
}

export function drawRandomPreview(canvas: HTMLCanvasElement, seed: number, width: number, height: number): void {
  const topo = createTopologyView('square', width, height);
  drawTerrain(canvas, topo, randomPreviewTerrain(seed, width, height));
}

/**
 * §26.2 room_list.rooms[].thumbnail 풀기 — 축소 지형 RLE(길이 합 = width × height) + 기지 축소 칸 index.
 * 형식이 어긋나면(길이 합 불일치·범위 밖 기지) null → 호출자는 분위기 그림으로 물러난다.
 */
export function decodeThumbnail(t: MapThumbnail): { width: number; height: number; terrain: Uint8Array; bases: number[] } | null {
  const n = t.width * t.height;
  if (!(t.width > 0 && t.height > 0) || !Array.isArray(t.terrain) || t.terrain.length % 2 !== 0) return null;
  let sum = 0;
  for (let i = 1; i < t.terrain.length; i += 2) sum += t.terrain[i];
  if (sum !== n) return null;
  const terrain = Uint8Array.from(rleDecode(t.terrain, n));
  const bases = (t.bases ?? []).filter((b) => Number.isInteger(b) && b >= 0 && b < n);
  return { width: t.width, height: t.height, terrain, bases };
}

/** §26.2 무작위 맵 방의 실제 축소 지형 + 기지 점. 그렸으면 true (형식 오류면 false — 호출자가 분위기 그림) */
export function drawThumbnailPreview(canvas: HTMLCanvasElement, t: MapThumbnail): boolean {
  const d = decodeThumbnail(t);
  if (!d) return false;
  const topo = createTopologyView('square', d.width, d.height);
  const { ctx, k, ox, oy } = drawTerrain(canvas, topo, d.terrain);
  const r = Math.max(1.5, Math.min(3, k * 0.6));
  ctx.fillStyle = '#f5f1e6';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  for (const b of d.bases) {
    const c = topo.tileCenter(b);
    ctx.fillRect(ox + c.x * k - r, oy + c.y * k - r, r * 2, r * 2);
    ctx.strokeRect(ox + c.x * k - r, oy + c.y * k - r, r * 2, r * 2);
  }
  return true;
}
