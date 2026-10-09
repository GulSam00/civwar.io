/**
 * 클라이언트 토폴로지 계층 — 타일 ID ↔ 화면 좌표, 타일 그리기, 거리·이웃.
 *
 * 구현 제약(design-decisions「토폴로지 추상화 필수」): `row * width + col` 같은 사각 격자 전제는
 * **이 파일 안에서만** 쓴다. 렌더러·입력·상태 코드는 `TopologyView` 인터페이스만 호출한다.
 * 육각 전환 시 이 파일에 HexTopologyView 를 추가하고 createTopologyView 분기만 바꾸면 된다.
 *
 * 월드 좌표 단위 = "타일 1칸" (사각: 한 변 1.0). 카메라가 월드 → 화면 변환을 맡는다.
 */

export interface WorldPoint {
  x: number;
  y: number;
}

export interface TopologyView {
  readonly kind: 'square';
  readonly tileCount: number;
  /** 월드 경계 (타일 단위) */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** 타일 중심의 월드 좌표 */
  tileCenter(tileId: number): WorldPoint;
  /** 월드 좌표 → 타일 ID (맵 밖이면 -1) */
  worldToTileId(x: number, y: number): number;
  /** 서버 토폴로지와 같은 거리 (사각 = 맨해튼) */
  distance(a: number, b: number): number;
  neighbors(tileId: number): readonly number[];
  /** distance(center, t) <= r 인 타일 */
  disk(center: number, r: number): number[];
  /** 다중 출발 거리장 (sources 중 최근접까지의 distance). 사각은 장애물 없는 BFS = 맨해튼 최소 */
  distanceField(isSource: (t: number) => boolean): Int32Array;
  /**
   * 타일 색 레이어를 그린다: rgba(타일별 4바이트)를 1 타일 = 1 픽셀 오프스크린에 쓰고,
   * 월드 좌표계(이미 카메라 변환이 걸린 ctx)에 그린다. dirty 가 주어지면 그 타일만 갱신.
   */
  createTileLayer(): TileLayer;
  /** 소유자별 경계선 경로 (owners[t] 와 다른 이웃 사이 변). 0(중립)은 만들지 않는다 */
  buildBorderPaths(owners: Uint8Array, isLand: (t: number) => boolean): Map<number, Path2D>;
  /** 소유자별 영역 채우기 경로 (색각 보조 패턴용). 0(중립) 제외 */
  buildOwnerFillPaths(owners: Uint8Array, isLand: (t: number) => boolean): Map<number, Path2D>;
  /** 타일 칸 하나의 외곽 경로 (월드 좌표) — 선택·게이지 표시용 */
  tilePath(ctx: CanvasRenderingContext2D | Path2D, tileId: number, inset?: number): void;
  /** 타일 집합의 바깥 외곽선 (disk 미리보기 등) */
  regionOutline(tiles: Iterable<number>): Path2D;
}

export interface TileLayer {
  setColor(tileId: number, rgba: number): void;
  /** 변경분을 오프스크린 캔버스로 반영 */
  flush(): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** 화면 좌표 사각형에 전체 맵을 축소해 그린다 (미니맵·썸네일) */
  drawScaled(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
}

export function createTopologyView(topology: string, width: number, height: number): TopologyView {
  if (topology !== 'square') throw new Error(`unsupported topology ${topology}`);
  return new SquareTopologyView(width, height);
}

/** 사각 구현체 — 사각 전제 식은 이 클래스 안에만 */
export class SquareTopologyView implements TopologyView {
  readonly kind = 'square' as const;
  readonly tileCount: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  private readonly adj: number[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tileCount = width * height;
    this.worldWidth = width;
    this.worldHeight = height;
    this.adj = new Array(this.tileCount);
    for (let t = 0; t < this.tileCount; t++) {
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

  tileCenter(tileId: number): WorldPoint {
    const r = Math.floor(tileId / this.width);
    const c = tileId - r * this.width;
    return { x: c + 0.5, y: r + 0.5 };
  }

  worldToTileId(x: number, y: number): number {
    const c = Math.floor(x);
    const r = Math.floor(y);
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return -1;
    return r * this.width + c;
  }

  distance(a: number, b: number): number {
    const ar = Math.floor(a / this.width);
    const br = Math.floor(b / this.width);
    return Math.abs(ar - br) + Math.abs(a - ar * this.width - (b - br * this.width));
  }

  neighbors(tileId: number): readonly number[] {
    return this.adj[tileId] ?? [];
  }

  disk(center: number, r: number): number[] {
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

  distanceField(isSource: (t: number) => boolean): Int32Array {
    const n = this.tileCount;
    const dist = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let t = 0; t < n; t++) {
      if (isSource(t)) {
        dist[t] = 0;
        queue[tail++] = t;
      }
    }
    while (head < tail) {
      const u = queue[head++];
      for (const v of this.adj[u]) {
        if (dist[v] === -1) {
          dist[v] = dist[u] + 1;
          queue[tail++] = v;
        }
      }
    }
    return dist;
  }

  createTileLayer(): TileLayer {
    const w = this.width;
    const h = this.height;
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const cctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const img = cctx.createImageData(w, h);
    const view = new Uint32Array(img.data.buffer);
    let dirty = true;
    return {
      setColor(tileId, rgba) {
        // ImageData 는 리틀엔디언 RGBA 바이트 → Uint32 로는 ABGR
        const abgr = ((rgba & 0xff) << 24) | (((rgba >>> 8) & 0xff) << 16) | (((rgba >>> 16) & 0xff) << 8) | ((rgba >>> 24) & 0xff);
        if (view[tileId] !== abgr >>> 0) {
          view[tileId] = abgr >>> 0;
          dirty = true;
        }
      },
      flush() {
        if (!dirty) return;
        cctx.putImageData(img, 0, 0);
        dirty = false;
      },
      draw(ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas as CanvasImageSource, 0, 0, w, h);
      },
      drawScaled(ctx, dx, dy, dw, dh) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas as CanvasImageSource, dx, dy, dw, dh);
      },
    };
  }

  buildBorderPaths(owners: Uint8Array, isLand: (t: number) => boolean): Map<number, Path2D> {
    const w = this.width;
    const h = this.height;
    const paths = new Map<number, Path2D>();
    const get = (o: number) => {
      let p = paths.get(o);
      if (!p) {
        p = new Path2D();
        paths.set(o, p);
      }
      return p;
    };
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const t = r * w + c;
        const o = owners[t];
        if (o === 0 || !isLand(t)) continue;
        const p = get(o);
        if (r === 0 || owners[t - w] !== o) {
          p.moveTo(c, r);
          p.lineTo(c + 1, r);
        }
        if (r === h - 1 || owners[t + w] !== o) {
          p.moveTo(c, r + 1);
          p.lineTo(c + 1, r + 1);
        }
        if (c === 0 || owners[t - 1] !== o) {
          p.moveTo(c, r);
          p.lineTo(c, r + 1);
        }
        if (c === w - 1 || owners[t + 1] !== o) {
          p.moveTo(c + 1, r);
          p.lineTo(c + 1, r + 1);
        }
      }
    }
    return paths;
  }

  buildOwnerFillPaths(owners: Uint8Array, isLand: (t: number) => boolean): Map<number, Path2D> {
    const w = this.width;
    const paths = new Map<number, Path2D>();
    for (let r = 0; r < this.height; r++) {
      // 같은 소유자 가로 구간을 한 사각형으로 묶는다
      let c = 0;
      while (c < w) {
        const t = r * w + c;
        const o = owners[t];
        if (o === 0 || !isLand(t)) {
          c++;
          continue;
        }
        let e = c + 1;
        while (e < w && owners[r * w + e] === o && isLand(r * w + e)) e++;
        let p = paths.get(o);
        if (!p) {
          p = new Path2D();
          paths.set(o, p);
        }
        p.rect(c, r, e - c, 1);
        c = e;
      }
    }
    return paths;
  }

  tilePath(ctx: CanvasRenderingContext2D | Path2D, tileId: number, inset = 0): void {
    const r = Math.floor(tileId / this.width);
    const c = tileId - r * this.width;
    ctx.rect(c + inset, r + inset, 1 - inset * 2, 1 - inset * 2);
  }

  regionOutline(tiles: Iterable<number>): Path2D {
    const w = this.width;
    const set = new Set(tiles);
    const p = new Path2D();
    for (const t of set) {
      const r = Math.floor(t / w);
      const c = t - r * w;
      if (r === 0 || !set.has(t - w)) {
        p.moveTo(c, r);
        p.lineTo(c + 1, r);
      }
      if (r === this.height - 1 || !set.has(t + w)) {
        p.moveTo(c, r + 1);
        p.lineTo(c + 1, r + 1);
      }
      if (c === 0 || !set.has(t - 1)) {
        p.moveTo(c, r);
        p.lineTo(c, r + 1);
      }
      if (c === w - 1 || !set.has(t + 1)) {
        p.moveTo(c + 1, r);
        p.lineTo(c + 1, r + 1);
      }
    }
    return p;
  }
}
