/**
 * 맵 미리보기 썸네일 — 지형 RLE + 스폰 + 기지를 작은 캔버스에 그린다.
 * 타일 그리기·좌표는 TopologyView 를 거친다 (사각 전제는 topology.ts 에만).
 */
import { rleDecode } from '@civwar/shared';
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
