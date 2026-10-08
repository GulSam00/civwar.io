import { TERRAIN } from '@civwar/shared';
import type { MapGraph, Topology } from './topology.js';

/**
 * 사각 격자 구현체. 타일 ID = row * width + col 은 이 파일 안에서만 쓴다.
 * 인접 순서 고정: 상, 좌, 우, 하 (= tileId 오름차순) → 결정론.
 */
export class SquareTopology implements Topology {
  readonly kind = 'square' as const;
  private readonly adj: number[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.adj = new Array(n);
    for (let t = 0; t < n; t++) {
      const r = Math.floor(t / width);
      const c = t - r * width;
      const list: number[] = [];
      if (r > 0) list.push(t - width);
      if (c > 0) list.push(t - 1);
      if (c < width - 1) list.push(t + 1);
      if (r < height - 1) list.push(t + width);
      this.adj[t] = list;
    }
  }

  tileCount(): number {
    return this.width * this.height;
  }

  distance(a: number, b: number): number {
    const ar = Math.floor(a / this.width);
    const br = Math.floor(b / this.width);
    return Math.abs(ar - br) + Math.abs(a - ar * this.width - (b - br * this.width));
  }

  adjacent(t: number): readonly number[] {
    return this.adj[t];
  }

  isBorder(t: number): boolean {
    const r = Math.floor(t / this.width);
    const c = t - r * this.width;
    return r === 0 || c === 0 || r === this.height - 1 || c === this.width - 1;
  }

  disk(center: number, r: number): readonly number[] {
    const w = this.width;
    const cr = Math.floor(center / w);
    const cc = center - cr * w;
    const out: number[] = [];
    for (let rr = Math.max(0, cr - r); rr <= Math.min(this.height - 1, cr + r); rr++) {
      const rem = r - Math.abs(rr - cr);
      for (let c = Math.max(0, cc - rem); c <= Math.min(w - 1, cc + rem); c++) out.push(rr * w + c);
    }
    return out;
  }

  // ── 사각 전용 헬퍼: 맵 생성기(사각 구현체 내부 취급)만 사용 ──

  /** 8방향 이웃 중 pred 를 만족하는 개수 (경계 밖 = 0) */
  count8(t: number, pred: (n: number) => boolean): number {
    const w = this.width;
    const r = Math.floor(t / w);
    const c = t - r * w;
    let k = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= this.height) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const cc = c + dc;
        if (cc < 0 || cc >= w) continue;
        if (pred(rr * w + cc)) k++;
      }
    }
    return k;
  }

  /** 중심 t 의 size×size 블록 타일 (경계 밖 제외), tileId 오름차순 */
  block(t: number, size: number): number[] {
    const w = this.width;
    const r = Math.floor(t / w);
    const c = t - r * w;
    const half = Math.floor(size / 2);
    const out: number[] = [];
    for (let rr = r - half; rr <= r + half; rr++) {
      if (rr < 0 || rr >= this.height) continue;
      for (let cc = c - half; cc <= c + half; cc++) {
        if (cc < 0 || cc >= w) continue;
        out.push(rr * w + cc);
      }
    }
    return out;
  }
}

/** isPassable — 경로 계층 내부 전용 (게임 로직은 호출하지 않는다) */
export function isPassable(terrain: number): boolean {
  return terrain !== TERRAIN.DEEP;
}

/** 지형 위 이동 그래프. 이웃 목록은 생성 시 1회 계산 (지형 불변) */
export class TerrainGraph implements MapGraph {
  private readonly nb: number[][];

  constructor(
    readonly topology: Topology,
    terrain: Uint8Array,
  ) {
    const n = topology.tileCount();
    this.nb = new Array(n);
    for (let t = 0; t < n; t++) {
      this.nb[t] = isPassable(terrain[t])
        ? topology.adjacent(t).filter((x) => isPassable(terrain[x]))
        : [];
    }
  }

  tileCount(): number {
    return this.topology.tileCount();
  }
  distance(a: number, b: number): number {
    return this.topology.distance(a, b);
  }
  neighbors(t: number): readonly number[] {
    return this.nb[t];
  }
  private readonly diskCache = new Map<number, readonly number[]>();
  disk(center: number, r: number): readonly number[] {
    const key = center * 128 + r;
    let d = this.diskCache.get(key);
    if (!d) {
      d = this.topology.disk(center, r);
      this.diskCache.set(key, d);
    }
    return d;
  }
}
