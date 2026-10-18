/**
 * Canvas 렌더러 — requestAnimationFrame 루프에서 GameModel 을 "읽기만" 한다.
 * 상태 갱신(WS 수신)과 분리: 모델이 바뀌어도 루프를 재시작하지 않는다.
 *
 * 레이어: 타일(지형+영토, 1 타일 = 1 픽셀 오프스크린) → (색각 보조 패턴) → 경계선 → 게이지 대상 칸(공격 방향 그라데이션)
 *        → 예고 원 → 기지 → 앵커 선 → 깃발 → (미니맵은 별도 캔버스)
 * 타일 좌표 변환은 전부 TopologyView 를 거친다 (사각 전제 식은 topology.ts 에만).
 */
import { POSTURE, POSTURE_COOLDOWN_TICKS, type FlagSnapshot } from '@civwar/shared';
import { FLOAT_LIFE_MS, LossFloaters, floatAnim, lossText } from './lossFloaters.js';
import type { GameModel } from '../state/gameModel.js';
import { disengageTicksOf as disengageTicksModel } from '../state/disengage.js';
import { createTopologyView, type TileLayer, type TopologyView } from './topology.js';
import { fitZoom, worldToScreen, type Camera } from './camera.js';
import { FlagInterpolator, type Pt } from './flagInterp.js';
import { COLOR_ATTACK, COLOR_DEFEND, COLOR_DISABLED, playerColor, playerDark, tileRgba } from './palette.js';
import { ownerPattern } from './patterns.js';
import { isDecayTick } from './progressRule.js';
import type { CursorPreview } from '../input/preview.js';
import type { RoutePreview } from '../input/route.js';
import { drawGlyphParts, drawUnitGlyph } from './unitGlyphs.js';
import { SHIELD_GLYPH, SWORD_GLYPH, combatPairs, declutter, glyphOf, pairGlyphKind, type CombatPair } from './combatPairs.js';
import { UNIT_SHORT } from '../ui/text.js';
import { fmtCompact } from '../ui/fmt.js';
import { clampToView, emoteBubble } from './emoteBubble.js';
import { LABEL_DIM_ALPHA, layoutTerritoryLabels, territoryAnchors, type TerritoryAnchor } from './territoryLabels.js';

/**
 * 기지 부가 정보 (프로토콜 §21) — GameScreen.baseExtraOf 가 GameModel(baseProd 보간 · baseNames)에서 만든다.
 *  productivityPct: 기지 생산력 0..100 (점령 직후 비었다가 차오르는 바 — 기지 칸 아래)
 *  name: 지명 (수도·기지 아래 라벨)
 */
export interface BaseExtra {
  productivityPct?: number;
  name?: string;
}

export interface RenderView {
  me: number | null;
  selectedFlagId: number | null;
  hoverTile: number;
  preview: CursorPreview | null;
  /** 출전 중 하이라이트된 출발 기지 (null = 출전 중 아님) */
  issueBase: number | null;
  /** 출전 진격 경로 미리보기 (기지 → 지점, 쟁기 회랑) */
  route: RoutePreview | null;
  /** 경로 색 = 기본 태세 예고 */
  routeKind: 'attack' | 'defend' | 'blocked' | null;
  /** 색각 보조: 영토 패턴 + 깃발 플레이어 번호 */
  colorblind: boolean;
  /** 깃발 이동 방향 화살표: 모두 / 내 깃발만 / 숨김 (옵션 창, V 로 순환) */
  directions: 'all' | 'mine' | 'off';
  /** 최근 이모트 (수도 위 말풍선). targetPlayerId = §26.3 대상 이모트 (대상 영토 이름표 쪽 화살표) */
  emotes: readonly { playerId: number; code: number; at: number; targetPlayerId?: number }[];
  emoteText(code: number): string;
  nicknameOf(id: number): string;
  /** §21: 기지 생산력·지명 (없으면 생략) */
  baseExtra?(tile: number): BaseExtra | undefined;
}

interface FlagScreen {
  id: number;
  x: number;
  y: number;
  r: number;
}

/** 진척도 감소 표시 상태 (GDD 7.6: 전진은 부드럽게, 후퇴는 짧은 플래시) */
interface ProgressTrack {
  pct: number;
  tgt: number | null;
  shownPct: number;
  decayUntil: number;
}

/** 깃발 수가 이보다 많으면(또는 줌이 작으면) 남의 깃발 라벨을 생략 (LOD) */
export const LABEL_LOD_FLAGS = 36;
export const LABEL_LOD_ZOOM = 7;

export class GameRenderer {
  readonly camera: Camera = { cx: 0, cy: 0, zoom: 12, viewW: 1, viewH: 1 };
  topo: TopologyView | null = null;
  private model: GameModel | null = null;
  private layer: TileLayer | null = null;
  private layerOwnersVersion = -1;
  private borders: Map<number, Path2D> = new Map();
  private fills: Map<number, Path2D> = new Map();
  private bordersDirty = true;
  private bordersBuiltAt = 0;
  private interp = new FlagInterpolator();
  private progress = new Map<number, ProgressTrack>();
  private flagScreens: FlagScreen[] = [];
  private previewPathKey = '';
  private previewPath: Path2D | null = null;
  private dpr = 1;
  /** §22.3 틱당 전투 손실 숫자 */
  private losses = new LossFloaters();
  /** 영토 이름 기준점 — 영토가 바뀌었을 때만, 최대 LABEL_REFRESH_MS 에 한 번 다시 계산 */
  private labelAnchors: TerritoryAnchor[] = [];
  private labelsDirty = true;
  /** 이번 프레임에 그린 영토 이름표 화면 위치 (§26.3 대상 이모트 화살표 끝) */
  private labelScreen = new Map<number, { x: number; y: number }>();
  private labelsAt = -Infinity;
  /** 마지막 프레임에 화면에 보인 깃발 위치 (미니맵·따라가기) */
  readonly flagWorld = new Map<number, Pt>();

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** 모델(매치)이 바뀌면 토폴로지·레이어·보간 초기화 + 카메라를 내 수도로 */
  private attach(model: GameModel, me: number | null): void {
    this.model = model;
    this.topo = createTopologyView(model.config.topology, model.width, model.height);
    this.layer = this.topo.createTileLayer();
    this.layerOwnersVersion = -1;
    this.bordersDirty = true;
    this.interp.clear();
    this.progress.clear();
    this.losses.clear();
    this.labelAnchors = [];
    this.labelsDirty = true;
    this.labelsAt = -Infinity;
    const cam = this.camera;
    const home = me !== null ? model.spawns.find((s) => s.playerId === me) : undefined;
    if (home) {
      cam.zoom = Math.max(fitZoom(cam.viewW, cam.viewH, this.topo.worldWidth, this.topo.worldHeight), 10);
      const c = this.topo.tileCenter(home.homeTileId);
      cam.cx = c.x;
      cam.cy = c.y;
    } else this.fitWorld();
  }

  fitWorld(): void {
    if (!this.topo) return;
    this.camera.zoom = fitZoom(this.camera.viewW, this.camera.viewH, this.topo.worldWidth, this.topo.worldHeight);
    this.camera.cx = this.topo.worldWidth / 2;
    this.camera.cy = this.topo.worldHeight / 2;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.camera.viewW = w;
    this.camera.viewH = h;
  }

  /** 화면 좌표의 깃발 (가장 위에 그려진 것). 없으면 null */
  flagAt(sx: number, sy: number, filter?: (id: number) => boolean): number | null {
    for (let i = this.flagScreens.length - 1; i >= 0; i--) {
      const f = this.flagScreens[i];
      if (filter && !filter(f.id)) continue;
      const dx = sx - f.x;
      const dy = sy - f.y;
      if (dx * dx + dy * dy <= (f.r + 3) * (f.r + 3)) return f.id;
    }
    return null;
  }

  frame(model: GameModel | null, view: RenderView, now: number): void {
    this.resize();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#121a24';
    ctx.fillRect(0, 0, this.camera.viewW, this.camera.viewH);
    if (!model || !model.terrain || !model.ready) {
      this.model = null;
      return;
    }
    if (model !== this.model) this.attach(model, view.me);
    const topo = this.topo!;
    this.syncTiles(model, now);

    const cam = this.camera;
    ctx.save();
    ctx.translate(cam.viewW / 2, cam.viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.cx, -cam.cy);
    this.layer!.draw(ctx);
    if (view.colorblind) this.drawPatterns(ctx);
    this.drawOwnerBands(ctx);
    ctx.lineWidth = Math.max(1.2 / cam.zoom, 0.06);
    for (const [owner, path] of this.borders) {
      ctx.strokeStyle = playerDark(owner);
      ctx.stroke(path);
    }
    if (view.me !== null && this.borders.has(view.me)) {
      ctx.lineWidth = Math.max(2.4 / cam.zoom, 0.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke(this.borders.get(view.me)!);
    }
    this.drawGaugeTargets(ctx, model, topo, now);
    this.drawPreview(ctx, topo, view.preview);
    this.drawRoute(ctx, topo, view);
    if (view.hoverTile >= 0) {
      ctx.beginPath();
      topo.tilePath(ctx, view.hoverTile, 0.04);
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
    ctx.restore();

    this.drawAnnexFlash(ctx, model, topo, now);
    this.drawTerritoryNames(ctx, model, topo, view, now);
    this.drawBases(ctx, model, topo, view);
    this.drawRouteArrow(ctx, topo, view);
    this.drawFlags(ctx, model, topo, view, now);
    this.drawEmotes(ctx, model, topo, view);
  }

  /**
   * 영토 이름 (2026-10-14) — 영토 한가운데(무게중심에 가장 가까운 자기 칸). 기준점 계산은 영토가 바뀌었을 때 최대 1초에 한 번,
   * 화면 배치·겹침 정리는 매 프레임(플레이어 수만큼). 색각 보조면 플레이어 번호를 앞에 붙인다.
   */
  private drawTerritoryNames(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView, now: number): void {
    if (this.labelsDirty && now - this.labelsAt >= LABEL_REFRESH_MS) {
      this.labelAnchors = territoryAnchors(model.owners, topo.tileCount, (t) => topo.tileCenter(t), (t) => model.isLand(t), (t) => topo.neighbors(t));
      this.labelsDirty = false;
      this.labelsAt = now;
    }
    this.labelScreen.clear();
    if (!this.labelAnchors.length) return;
    const cam = this.camera;
    const font = (size: number) => `800 ${size}px system-ui, "Malgun Gothic", sans-serif`;
    const subFont = (size: number) => `700 ${size}px system-ui, "Malgun Gothic", sans-serif`;
    // 기준점이 기지(대개 수도) 칸이거나 그 옆이면 이름을 기지 아이콘 아래로 내린다 (아이콘에 가리지 않게)
    const s = baseIconSize(cam.zoom);
    const baseCenters = model.baseTiles.map((t) => topo.tileCenter(t));
    // 2026-10-18: 이름 왼쪽 작은 문장(플레이어 색 방패) + 이름 아래 총 병력 ("2.55K")
    const emblemW = (size: number) => Math.round(size * 0.78) + 4;
    // 2026-10-19: 깃발·기지 아이콘 자리 (직전 프레임 깃발 위치) — 이름이 이 위에 놓이면 비껴 놓거나 흐리게
    const obstacles: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const c of baseCenters) {
      const q = worldToScreen(cam, c.x, c.y);
      obstacles.push({ x0: q.x - s, y0: q.y - s, x1: q.x + s, y1: q.y + s * 1.6 });
    }
    for (const w of this.flagWorld.values()) {
      const q = worldToScreen(cam, w.x, w.y);
      obstacles.push({ x0: q.x - 12, y0: q.y - 12, x1: q.x + 12, y1: q.y + 12 });
    }
    const placed = layoutTerritoryLabels(
      this.labelAnchors.filter((a) => model.players.get(a.owner)?.alive ?? true),
      (id) => (view.colorblind ? `${id}. ${view.nicknameOf(id)}` : view.nicknameOf(id)),
      (x, y) => {
        const p = worldToScreen(cam, x, y);
        const nearBase = baseCenters.some((c) => Math.abs(c.x - x) <= 1.01 && Math.abs(c.y - y) <= 1.01);
        return nearBase ? { x: p.x, y: p.y + s * 1.5 + 12 } : p;
      },
      cam.zoom,
      (text, size, isSub) => {
        ctx.font = isSub ? subFont(size) : font(size);
        return ctx.measureText(text).width + (isSub ? 0 : emblemW(size));
      },
      { w: cam.viewW, h: cam.viewH },
      (id) => fmtCompact(model.players.get(id)?.troops ?? 0),
      obstacles,
    );
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of placed) {
      this.labelScreen.set(l.owner, { x: l.x, y: l.y });
      ctx.font = font(l.size);
      const tw = ctx.measureText(l.text).width;
      const ew = emblemW(l.size);
      const left = l.x - (tw + ew) / 2;
      const tx = left + ew + tw / 2;
      ctx.globalAlpha = l.dim ? LABEL_DIM_ALPHA : 0.9;
      drawEmblem(ctx, left + (ew - 4) / 2, l.y, Math.round(l.size * 0.78), playerColor(l.owner));
      ctx.lineWidth = Math.max(3, l.size * 0.22);
      ctx.strokeStyle = 'rgba(8,12,18,0.8)';
      ctx.strokeText(l.text, tx, l.y);
      ctx.fillStyle = l.owner === view.me ? '#ffffff' : '#eef2f6';
      ctx.fillText(l.text, tx, l.y);
      if (l.sub && l.subSize) {
        const sy = l.y + l.size / 2 + l.subSize * 0.6;
        ctx.font = subFont(l.subSize);
        ctx.lineWidth = Math.max(2.5, l.subSize * 0.24);
        ctx.strokeText(l.sub, l.x, sy);
        ctx.fillStyle = 'rgba(232,237,242,0.92)';
        ctx.fillText(l.sub, l.x, sy);
      }
    }
    ctx.restore();
  }

  /**
   * 멸망·합병 (§21.3) — 넘어간 칸을 합병한 플레이어 색 + 흰 테두리로 1.6초 동안 번쩍였다가 사라진다.
   * 칸 목록은 GameModel.annexFlashes (player_eliminated 직후 같은 tick tileChanges). Path2D 는 flash 마다 한 번 만든다.
   */
  private annexPaths = new WeakMap<object, { fill: Path2D; edge: Path2D }>();
  private drawAnnexFlash(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, now: number): void {
    if (!model.annexFlashes.length) return;
    const DUR = 1600;
    const wall = model.clock();
    model.annexFlashes = model.annexFlashes.filter((a) => wall - a.at < DUR + 2000); // 칸이 아직 안 왔을 수도 있어 여유
    const cam = this.camera;
    ctx.save();
    ctx.translate(cam.viewW / 2, cam.viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.cx, -cam.cy);
    for (const a of model.annexFlashes) {
      if (!a.tiles.length) continue;
      const k = (wall - a.at) / DUR;
      if (k >= 1) continue;
      let path = this.annexPaths.get(a);
      if (!path) {
        const fill = new Path2D();
        for (const t of a.tiles) topo.tilePath(fill, t, 0);
        path = { fill, edge: topo.regionOutline(a.tiles) };
        this.annexPaths.set(a, path);
      }
      const alpha = (1 - k) * (0.6 + 0.4 * Math.abs(Math.sin(now / 110)));
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = playerColor(a.byPlayerId);
      ctx.fill(path.fill);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3 / cam.zoom;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(path.edge);
    }
    ctx.restore();
  }

  /**
   * 이모트 말풍선 — 그 플레이어의 수도(스폰) 위, 4초 동안 서서히 사라진다.
   * §26.3 대상 이모트: "A → B: 😀" + 말풍선에서 B 영토 이름표(없으면 B 수도) 쪽 점선 화살표. 화면 밖이면 가장자리에서 멈춘다.
   * 대상이 나면 노란 말풍선·화살표로 강조.
   */
  private drawEmotes(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView): void {
    const t = Date.now();
    const cam = this.camera;
    const screenOfHome = (playerId: number) => {
      const sp = model.spawns.find((s) => s.playerId === playerId);
      if (!sp) return null;
      const c = topo.tileCenter(sp.homeTileId);
      return worldToScreen(cam, c.x, c.y);
    };
    for (const e of view.emotes) {
      const age = t - e.at;
      if (age > 4000) continue;
      const p = screenOfHome(e.playerId);
      if (!p) continue;
      const b = emoteBubble(e, view.me, (id) => view.nicknameOf(id), (c) => view.emoteText(c));
      const accent = b.toMe ? '#ffd54f' : playerDark(e.playerId);
      ctx.save();
      ctx.globalAlpha = age > 3000 ? (4000 - age) / 1000 : 1;
      ctx.font = 'bold 12px system-ui, "Malgun Gothic", sans-serif';
      const w = ctx.measureText(b.text).width + 12;
      const x = p.x - w / 2;
      const y = p.y - 46;
      if (b.target !== null) {
        const goal = this.labelScreen.get(b.target) ?? screenOfHome(b.target);
        if (goal) {
          const from = { x: p.x, y: y + 10 };
          const end = clampToView(from, goal, cam.viewW, cam.viewH);
          const dx = end.x - from.x;
          const dy = end.y - from.y;
          const len = Math.hypot(dx, dy);
          if (len > w / 2 + 16) {
            const ux = dx / len;
            const uy = dy / len;
            // 말풍선 상자 가장자리에서 출발, 이름표 바로 앞(14px)에서 멈춘다
            const exit = Math.min(ux ? w / 2 / Math.abs(ux) : Infinity, uy ? 10 / Math.abs(uy) : Infinity);
            const sx = from.x + ux * exit;
            const sy = from.y + uy * exit;
            const ex = end.x - ux * (end.clamped ? 0 : 14);
            const ey = end.y - uy * (end.clamped ? 0 : 14);
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = b.toMe ? '#ffd54f' : 'rgba(255,255,255,0.85)';
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - ux * 10 - uy * 6, ey - uy * 10 + ux * 6);
            ctx.lineTo(ex - ux * 10 + uy * 6, ey - uy * 10 - ux * 6);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      ctx.fillStyle = b.toMe ? 'rgba(255,244,196,0.97)' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = accent;
      ctx.lineWidth = b.toMe ? 3 : 2;
      ctx.beginPath();
      ctx.rect(x, y, w, 20);
      ctx.moveTo(p.x - 5, y + 20);
      ctx.lineTo(p.x, y + 27);
      ctx.lineTo(p.x + 5, y + 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, p.x, y + 10);
      ctx.restore();
    }
  }

  private syncTiles(model: GameModel, now: number): void {
    const topo = this.topo!;
    const layer = this.layer!;
    const terrain = model.terrain!;
    if (this.layerOwnersVersion !== model.ownersVersion) {
      for (let t = 0; t < topo.tileCount; t++) layer.setColor(t, tileRgba(terrain[t], model.owners[t]));
      this.layerOwnersVersion = model.ownersVersion;
      model.dirtyTiles.length = 0;
      this.bordersDirty = true;
      this.labelsDirty = true;
    } else if (model.dirtyTiles.length) {
      for (const t of model.dirtyTiles) layer.setColor(t, tileRgba(terrain[t], model.owners[t]));
      model.dirtyTiles.length = 0;
      this.bordersDirty = true;
      this.labelsDirty = true;
    }
    layer.flush();
    if (this.bordersDirty && now - this.bordersBuiltAt > 180) {
      const isLand = (t: number) => model.isLand(t);
      this.borders = topo.buildBorderPaths(model.owners, isLand);
      this.fills = topo.buildOwnerFillPaths(model.owners, isLand);
      this.bordersDirty = false;
      this.bordersBuiltAt = now;
    }
  }

  /**
   * 영토 안쪽 테두리 띠 — 채우기가 반투명(OWNER_FILL_ALPHA)이라 소유 구분을 경계에서 보강한다.
   * 경계선을 플레이어 색으로 굵게 긋고 그 플레이어 영토 안으로만 잘라(clip) 바깥 칸을 물들이지 않는다.
   * 띠 폭은 화면 약 5px(타일의 최대 0.35칸).
   */
  private drawOwnerBands(ctx: CanvasRenderingContext2D): void {
    const z = this.camera.zoom;
    const w = Math.min(0.7, 10 / z);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = w;
    ctx.lineJoin = 'miter';
    for (const [owner, border] of this.borders) {
      const fill = this.fills.get(owner);
      if (!fill) continue;
      ctx.save();
      ctx.clip(fill);
      ctx.strokeStyle = playerColor(owner);
      ctx.stroke(border);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawPatterns(ctx: CanvasRenderingContext2D): void {
    const z = this.camera.zoom;
    for (const [owner, path] of this.fills) {
      const pat = ownerPattern(ctx, owner);
      if (!pat) continue;
      // 패턴은 화면 픽셀 크기로 고정 (줌과 무관하게 같은 촘촘함)
      pat.setTransform(new DOMMatrix().scale(1 / z, 1 / z));
      ctx.fillStyle = pat;
      ctx.fill(path);
    }
  }

  /**
   * 공격 대상 칸: 내 땅 쪽에서 반대쪽으로 진척도만큼 차오르는 그라데이션 (GDD v3.0 "공격 방향에서 그라데이션").
   * 진척도가 줄어드는 중(자동 감소)이면 회색 + 깜빡임 테두리로 구분 (GDD 7.6).
   */
  private drawGaugeTargets(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, now: number): void {
    const seen = new Set<number>();
    for (const f of model.flags.values()) {
      const tr = this.trackProgress(f, now);
      seen.add(f.id);
      if (f.posture !== POSTURE.ATTACK || f.targetTileId === null) continue;
      if (tr.shownPct <= 0 && f.state !== 'ENGAGED') continue;
      const t = f.targetTileId;
      const c = topo.tileCenter(t);
      // 공격 방향 = 대상 칸 이웃 중 공격자 소유 칸들의 평균 방향
      let dx = 0;
      let dy = 0;
      for (const n of topo.neighbors(t)) {
        if (model.owners[n] !== f.ownerId) continue;
        const p = topo.tileCenter(n);
        dx += p.x - c.x;
        dy += p.y - c.y;
      }
      if (dx === 0 && dy === 0) {
        // 내 땅과 맞닿지 않은 칸(월경지 등) — 깃발 쪽에서 차오른다
        const fp = topo.tileCenter(f.posTileId);
        dx = fp.x - c.x;
        dy = fp.y - c.y;
        if (dx === 0 && dy === 0) dy = 1;
      }
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const pct = Math.max(0, Math.min(1, tr.shownPct / 100));
      const decaying = now < tr.decayUntil;
      const color = decaying ? '#9aa5b1' : playerColor(f.ownerId);
      const g = ctx.createLinearGradient(c.x + ux * 0.5, c.y + uy * 0.5, c.x - ux * 0.5, c.y - uy * 0.5);
      g.addColorStop(0, color);
      g.addColorStop(Math.max(0.001, pct), color);
      g.addColorStop(Math.min(1, pct + 0.08), 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      topo.tilePath(ctx, t, 0);
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      const flash = decaying && Math.floor(now / 150) % 2 === 0;
      ctx.lineWidth = (flash ? 3 : 2) / this.camera.zoom;
      ctx.strokeStyle = flash ? '#ffffff' : f.stalled ? '#ffb300' : playerDark(f.ownerId);
      ctx.stroke();
    }
    for (const id of this.progress.keys()) if (!seen.has(id)) this.progress.delete(id);
  }

  private trackProgress(f: FlagSnapshot, now: number): ProgressTrack {
    let tr = this.progress.get(f.id);
    if (!tr) {
      tr = { pct: f.progressPct, tgt: f.targetTileId, shownPct: f.progressPct, decayUntil: 0 };
      this.progress.set(f.id, tr);
      return tr;
    }
    const cur = { pct: f.progressPct, tgt: f.targetTileId };
    if (cur.pct !== tr.pct || cur.tgt !== tr.tgt) {
      if (isDecayTick(tr, cur)) tr.decayUntil = now + 450;
      else if (cur.pct > tr.pct || cur.tgt !== tr.tgt) tr.decayUntil = 0;
    }
    if (cur.tgt !== tr.tgt) tr.shownPct = cur.pct; // 대상이 바뀌면 새 칸 값에서 시작
    tr.pct = cur.pct;
    tr.tgt = cur.tgt;
    // 전진은 부드럽게 따라가고, 감소·리셋은 즉시
    tr.shownPct = tr.pct >= tr.shownPct ? tr.shownPct + (tr.pct - tr.shownPct) * 0.35 : tr.pct;
    return tr;
  }

  private drawPreview(ctx: CanvasRenderingContext2D, topo: TopologyView, p: CursorPreview | null): void {
    if (!p) return;
    const color = p.kind === 'attack' ? COLOR_ATTACK : p.kind === 'defend' ? COLOR_DEFEND : COLOR_DISABLED;
    ctx.save();
    // v4.2: 공격 원 폐기 — 원은 방어 보호 원(guard)만 (disk 가 비어 있으면 생략)
    if (p.disk.length) {
      const key = `${p.tile}:${p.disk.length}`;
      if (key !== this.previewPathKey) {
        this.previewPath = topo.regionOutline(p.disk);
        this.previewPathKey = key;
      }
      ctx.lineWidth = 2.5 / this.camera.zoom;
      ctx.strokeStyle = color;
      ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
      ctx.stroke(this.previewPath!);
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    topo.tilePath(ctx, p.tile, 0.08);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.restore();
  }

  /** 쟁기 회랑 음영 (월드 좌표, 공격 태세만) — 경로 칸 옆의 적·중립 칸 */
  private drawRoute(ctx: CanvasRenderingContext2D, topo: TopologyView, view: RenderView): void {
    const r = view.route;
    if (!r || view.routeKind !== 'attack' || !r.corridor.length) return;
    ctx.save();
    ctx.fillStyle = COLOR_ATTACK;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (const t of r.corridor) topo.tilePath(ctx, t, 0.06);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 출전 기지 하이라이트 + 기지 → 지점 진격 경로 점선 화살표 (화면 좌표).
   * 경로는 서버 이동 규칙과 같은 가중 경로(route.ts) — 칸 중심을 잇는 꺾은선, 끝에 화살촉.
   */
  private drawRouteArrow(ctx: CanvasRenderingContext2D, topo: TopologyView, view: RenderView): void {
    if (view.issueBase === null) return;
    const cam = this.camera;
    const o = topo.tileCenter(view.issueBase);
    const bp = worldToScreen(cam, o.x, o.y);
    const s = baseIconSize(cam.zoom);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    ctx.save();
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, s * 0.75 + 5 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    const r = view.route;
    if (r && r.path.length > 1) {
      const color = !r.reachable || view.routeKind === 'blocked' ? COLOR_DISABLED : view.routeKind === 'defend' ? COLOR_DEFEND : COLOR_ATTACK;
      const pts = r.path.map((t) => {
        const c = topo.tileCenter(t);
        return worldToScreen(cam, c.x, c.y);
      });
      const line = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      line();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
      line();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -((performance.now() / 40) % 12);
      ctx.stroke();
      ctx.setLineDash([]);
      // 화살촉: 마지막 구간 방향 (짧으면 몇 칸 앞에서)
      const end = pts[pts.length - 1];
      const from = pts[Math.max(0, pts.length - 3)];
      const dx = end.x - from.x;
      const dy = end.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const h = 11;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - ux * h - uy * h * 0.6, end.y - uy * h + ux * h * 0.6);
      ctx.lineTo(end.x - ux * h + uy * h * 0.6, end.y - uy * h - ux * h * 0.6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // §22.12 방어 태세가 적 땅에 막힘: 멈춤 칸 표식 + 멈춤 칸 → 앵커 옅은 점선 (그 너머로는 가지 않는다)
    if (r?.blocked && r.stopTile !== null) {
      const sc = topo.tileCenter(r.stopTile);
      const sp = worldToScreen(cam, sc.x, sc.y);
      const ac = topo.tileCenter(r.anchor);
      const ap = worldToScreen(cam, ac.x, ac.y);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ap.x, ap.y);
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(200,205,212,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      drawStopMarker(ctx, sp.x, sp.y, Math.max(9, Math.min(14, cam.zoom * 0.55)));
    }
    ctx.restore();
  }

  /**
   * 기지 (2026-10-14: 칸을 꽉 채운다). 일반 기지 = 소유자 색 칸 + 검은 테두리 + 십자,
   * 수도 = 금색 바깥 테두리 + 안쪽 사각 + 별 (칸이 커도 한눈에 구분). 위 = 체력 바.
   * §21: 아래 = 생산력 바(baseExtra.productivityPct, 회복 중일 때만), 체력 바 위 = 지명(baseExtra.name — 수도 줌 7+, 기지 줌 9+).
   */
  private drawBases(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView): void {
    const cam = this.camera;
    const s = baseIconSize(cam.zoom);
    for (const tile of model.baseTiles) {
      const b = model.bases.get(tile);
      if (!b) continue;
      const c = topo.tileCenter(tile);
      const p = worldToScreen(cam, c.x, c.y);
      if (p.x < -s - 40 || p.y < -s - 40 || p.x > cam.viewW + s + 40 || p.y > cam.viewH + s + 40) continue;
      const capital = model.capitalTiles.has(tile);
      const x0 = p.x - s / 2;
      const y0 = p.y - s / 2;
      if (view.issueBase !== null && view.me !== null && b.ownerId === view.me && tile !== view.issueBase) {
        // 출전 중: 다른 내 기지(Alt+클릭으로 출발 기지 변경 가능)
        ctx.beginPath();
        ctx.rect(x0 - 4, y0 - 4, s + 8, s + 8);
        ctx.strokeStyle = 'rgba(255,214,0,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const lw = Math.max(1.5, Math.min(3, s * 0.08));
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#f5f1e6';
      ctx.fillRect(x0, y0, s, s);
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#111';
      ctx.strokeRect(x0, y0, s, s);
      const mark = b.ownerId ? 'rgba(255,255,255,0.92)' : '#555';
      if (capital) {
        // 금색 바깥 테두리 (칸 밖으로 살짝) + 안쪽 사각 + 별
        ctx.lineWidth = Math.max(2, lw);
        ctx.strokeStyle = '#ffd54f';
        ctx.strokeRect(x0 - lw, y0 - lw, s + lw * 2, s + lw * 2);
        const k = Math.max(2.5, s * 0.16);
        ctx.lineWidth = Math.max(1.2, lw * 0.7);
        ctx.strokeStyle = mark;
        ctx.strokeRect(x0 + k, y0 + k, s - 2 * k, s - 2 * k);
        if (s >= 14) {
          starPath(ctx, p.x, p.y, s * 0.24, s * 0.1);
          ctx.fillStyle = b.ownerId ? '#ffd54f' : '#8a7a3a';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
        }
      } else {
        ctx.lineWidth = Math.max(1.5, s * 0.1);
        ctx.strokeStyle = mark;
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.28, p.y);
        ctx.lineTo(p.x + s * 0.28, p.y);
        ctx.moveTo(p.x, p.y - s * 0.28);
        ctx.lineTo(p.x, p.y + s * 0.28);
        ctx.stroke();
      }
      const bw = Math.max(s, 18);
      const bh = s >= 28 ? 5 : 4;
      const bx = p.x - bw / 2;
      const by = y0 - bh - (capital ? 4 + lw : 3);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#ddd';
      ctx.fillRect(bx, by, (bw * Math.max(0, Math.min(100, b.hpPct))) / 100, bh);
      // §21.4 생산력 바 (칸 아래, 금색 — 회복 중일 때만 GameScreen 이 넘긴다) · §21.5 지명 (체력 바 위)
      const extra = view.baseExtra?.(tile);
      const below = y0 + s + (capital ? 4 + lw : 3);
      if (extra?.productivityPct !== undefined) {
        const pct = Math.max(0, Math.min(100, extra.productivityPct));
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(bx - 1, below - 1, bw + 2, bh + 2);
        ctx.fillStyle = '#ffd54f';
        ctx.fillRect(bx, below, (bw * pct) / 100, bh);
        if (cam.zoom >= 14) {
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          const t = `생산 ${Math.floor(pct)}%`;
          ctx.strokeText(t, bx + bw + 4, below + bh / 2);
          ctx.fillStyle = '#ffe9a8';
          ctx.fillText(t, bx + bw + 4, below + bh / 2);
        }
      }
      if (extra?.name && cam.zoom >= (capital ? 7 : 9)) this.label(ctx, extra.name, p.x, by - 9, capital ? 12 : 11, capital ? '#ffe9a8' : '#fff');
    }
  }

  private drawFlags(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView, now: number): void {
    const cam = this.camera;
    this.interp.retain((id) => model.flags.has(id));
    const screens: FlagScreen[] = [];
    this.flagWorld.clear();
    for (const f of model.flags.values()) {
      const w = this.interp.update(f.id, f.posTileId, topo.tileCenter(f.posTileId), now);
      this.flagWorld.set(f.id, w);
    }
    // LOD: 화면 안 깃발 수
    let visible = 0;
    for (const w of this.flagWorld.values()) {
      const p = worldToScreen(cam, w.x, w.y);
      if (p.x >= 0 && p.y >= 0 && p.x <= cam.viewW && p.y <= cam.viewH) visible++;
    }
    const lod = visible > LABEL_LOD_FLAGS || cam.zoom < LABEL_LOD_ZOOM;
    const baseR = Math.max(lod ? 6 : 8, Math.min(16, cam.zoom * 0.55));

    for (const f of model.flags.values()) {
      const mine = f.ownerId === view.me;
      if (!mine && f.id !== view.selectedFlagId) continue;
      const w = this.flagWorld.get(f.id)!;
      const a = topo.tileCenter(f.anchorTileId);
      const p = worldToScreen(cam, w.x, w.y);
      const q = worldToScreen(cam, a.x, a.y);
      ctx.save();
      ctx.strokeStyle = f.posture === POSTURE.ATTACK ? COLOR_ATTACK : COLOR_DEFEND;
      ctx.globalAlpha = f.id === view.selectedFlagId ? 0.95 : 0.5;
      ctx.lineWidth = f.id === view.selectedFlagId ? 2 : 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(q.x - 4, q.y - 4);
      ctx.lineTo(q.x + 4, q.y + 4);
      ctx.moveTo(q.x + 4, q.y - 4);
      ctx.lineTo(q.x - 4, q.y + 4);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    if (view.directions !== 'off') this.drawDirections(ctx, model, topo, view, lod, baseR);
    // 교전 쌍 (§20 8방향 접촉) — 연결선은 깃발 아래, 검/방패 아이콘은 깃발 위
    const pairs = combatPairs(model.flags.values(), (a, b) => topo.touching(a, b), (a, b) => model.isAlly(a, b));
    this.drawCombatLinks(ctx, pairs);
    const order = [...model.flags.values()].sort((a, b) => rank(a, view) - rank(b, view) || a.id - b.id);
    for (const f of order) {
      const w = this.flagWorld.get(f.id)!;
      const p = worldToScreen(cam, w.x, w.y);
      if (p.x < -50 || p.y < -50 || p.x > cam.viewW + 50 || p.y > cam.viewH + 50) continue;
      const important = f.ownerId === view.me || f.id === view.selectedFlagId;
      const r = important ? Math.max(8, baseR) : baseR;
      this.drawFlag(ctx, model, f, p.x, p.y, r, view, now, !lod || important);
      screens.push({ id: f.id, x: p.x, y: p.y, r });
    }
    this.flagScreens = screens;
    this.drawCombatBadges(ctx, pairs, lod, baseR, now);
    this.drawLossNumbers(ctx, model, view, now, lod, baseR);
  }

  /** 소유자 스탯 이탈 대기 tick (match_config 의 노드 표 우선) */
  private disengageTicksOf(model: GameModel, ownerId: number): number {
    return disengageTicksModel(model, ownerId);
  }

  /**
   * §22.3 틱당 전투 손실 "−n" — 깃발 위로 떠올라 사라진다. 합산·스로틀·상한은 LossFloaters.
   * 화면 픽셀 고정 크기(줌 무관), 어두운 외곽선 + 밝은 글자(색각 보조와 무관하게 읽힘). 축소 보기(LOD)에선 내 깃발·선택만.
   */
  private drawLossNumbers(ctx: CanvasRenderingContext2D, model: GameModel, view: RenderView, now: number, lod: boolean, r: number): void {
    for (const q of model.combatLossQueue) {
      this.losses.ingest(q.tick, q.losses, now, (id) => model.flags.get(id)?.ownerId === view.me || id === view.selectedFlagId);
    }
    model.combatLossQueue.length = 0;
    this.losses.retain((id) => model.flags.has(id));
    const list = this.losses.active(now);
    if (!list.length) return;
    const cam = this.camera;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const fl of list) {
      if (lod && !fl.important) continue;
      const w = this.flagWorld.get(fl.flagId);
      if (!w) continue;
      const p = worldToScreen(cam, w.x, w.y);
      if (p.x < -40 || p.y < -40 || p.x > cam.viewW + 40 || p.y > cam.viewH + 40) continue;
      const a = floatAnim((now - fl.born) / FLOAT_LIFE_MS);
      const size = Math.round((fl.important ? 13 : 12) * a.scale);
      // 깃발 바로 위에서 떠오른다 (좌우로 비키면 붙어 싸우는 상대 깃발 숫자와 겹친다 — 브라우저 확인)
      const x = p.x;
      const y = p.y - r - 8 + a.dy;
      const text = lossText(fl.milli);
      ctx.globalAlpha = a.alpha;
      ctx.font = `800 ${size}px system-ui, "Malgun Gothic", sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(10,12,16,0.9)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = view.colorblind ? '#ffffff' : fl.important ? '#ff8a80' : '#ffd0cc';
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  /** 교전 쌍의 화면 좌표 (보간 위치) */
  private pairScreen(pr: CombatPair): { p: Pt; q: Pt } | null {
    const wa = this.flagWorld.get(pr.a);
    const wb = this.flagWorld.get(pr.b);
    if (!wa || !wb) return null;
    return { p: worldToScreen(this.camera, wa.x, wa.y), q: worldToScreen(this.camera, wb.x, wb.y) };
  }

  /** 교전 연결선 — 깃발 사이 짧은 선 (어두운 외곽 + 밝은 선: 바탕·색각 보조와 무관하게 보인다) */
  private drawCombatLinks(ctx: CanvasRenderingContext2D, pairs: readonly CombatPair[]): void {
    if (!pairs.length) return;
    const cam = this.camera;
    ctx.save();
    ctx.lineCap = 'round';
    for (const pr of pairs) {
      const s = this.pairScreen(pr);
      if (!s) continue;
      const { p, q } = s;
      if (Math.max(p.x, q.x) < -40 || Math.max(p.y, q.y) < -40 || Math.min(p.x, q.x) > cam.viewW + 40 || Math.min(p.y, q.y) > cam.viewH + 40) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,170,0.95)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 새 교전 쌍이 처음 보인 시각 (짧은 섬광) */
  private pairSeen = new Map<string, number>();

  /**
   * 교전 아이콘. 쌍마다 한 자리(두 깃발 중점에서 선에 수직으로 비켜 난 곳 — 깃발에 가리지 않게).
   *  - 보통: 작은 원 배지 둘, 선 방향으로 각 깃발 쪽에 그 깃발 태세(공격 = 검, 방어 = 방패)
   *  - 축소 보기(LOD·쌍이 많을 때): 배지 하나(검 둘 / 방패 위 검 / 방패)
   * 겹치는 자리는 버린다(declutter). 배지 둘레가 천천히 맥동하고, 새 쌍은 한 번 퍼지는 섬광.
   */
  private drawCombatBadges(ctx: CanvasRenderingContext2D, pairs: readonly CombatPair[], lod: boolean, r: number, now: number): void {
    const seen = this.pairSeen;
    const live = new Set<string>();
    if (!pairs.length) {
      seen.clear();
      return;
    }
    const cam = this.camera;
    const compact = lod || pairs.length > 16;
    const items: { pr: CombatPair; m: Pt; at: Pt; u: Pt; key: string }[] = [];
    for (const pr of pairs) {
      const s = this.pairScreen(pr);
      if (!s) continue;
      const { p, q } = s;
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (m.x < -30 || m.y < -30 || m.x > cam.viewW + 30 || m.y > cam.viewH + 30) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      const u = d > 0.5 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
      // 수직 방향 중 화면 위쪽(같으면 오른쪽)
      let nx = -u.y;
      let ny = u.x;
      if (ny > 0 || (ny === 0 && nx < 0)) (nx = -nx), (ny = -ny);
      const off = compact ? r + 8 : r + Math.max(9, Math.min(13, r * 0.8)) + 4;
      const key = `${pr.a}-${pr.b}`;
      live.add(key);
      if (!seen.has(key)) seen.set(key, now);
      items.push({ pr, m, at: { x: m.x + nx * off, y: m.y + ny * off }, u, key });
    }
    for (const k of [...seen.keys()]) if (!live.has(k)) seen.delete(k);
    const keep = declutter(
      items.map((it) => it.at),
      compact ? 16 : 3 * Math.max(9, Math.min(13, r * 0.8)) + 4,
    );
    ctx.save();
    for (const i of keep) {
      const { pr, m, at, u, key } = items[i];
      const pulse = 0.5 + 0.5 * Math.sin(now / 160 + ((pr.a * 7 + pr.b * 13) % 10));
      // 새 교전 섬광 (0.7초 동안 한 번 퍼짐)
      const age = now - (seen.get(key) ?? now);
      if (age < 700) {
        const k = age / 700;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 6 + 26 * k, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,236,170,${(1 - k) * 0.9})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      // 중점 → 배지 짧은 끈 (어느 선의 아이콘인지)
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(at.x, at.y);
      ctx.strokeStyle = 'rgba(255,236,170,0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (compact) {
        const kind = pairGlyphKind(pr);
        this.combatBadge(ctx, at.x, at.y, 8.5, kind === 'swords' ? COLOR_ATTACK : kind === 'shields' ? COLOR_DEFEND : '#ffd54f', pulse);
        drawGlyphParts(ctx, glyphOf(kind), at.x, at.y, 12);
      } else {
        // 깃발 크기에 맞춰 키운다 (확대할수록 깃발이 커지므로 아이콘도 따라 커짐)
        const rad = Math.max(9, Math.min(13, r * 0.8));
        const g = rad + 1;
        const pa = { x: at.x - u.x * g, y: at.y - u.y * g };
        const pb = { x: at.x + u.x * g, y: at.y + u.y * g };
        this.combatBadge(ctx, pa.x, pa.y, rad, pr.aAttack ? COLOR_ATTACK : COLOR_DEFEND, pulse);
        this.combatBadge(ctx, pb.x, pb.y, rad, pr.bAttack ? COLOR_ATTACK : COLOR_DEFEND, pulse);
        drawGlyphParts(ctx, pr.aAttack ? SWORD_GLYPH : SHIELD_GLYPH, pa.x, pa.y, Math.round(rad * 1.45));
        drawGlyphParts(ctx, pr.bAttack ? SWORD_GLYPH : SHIELD_GLYPH, pb.x, pb.y, Math.round(rad * 1.45));
      }
    }
    ctx.restore();
  }

  private combatBadge(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, ring: string, pulse: number): void {
    ctx.beginPath();
    ctx.arc(x, y, rad + 2 + pulse * 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,236,170,${0.15 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,16,22,0.9)';
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * 이동 방향 (플레이테스트 후속): 모든 깃발(적 포함)에 짧은 화살표 — 행군 = 앵커 쪽, 귀환 = 귀환지 쪽(flag_recalled/routed.returnTileId),
   * 공격 교전 = 대상 칸 쪽. 소유자 어두운 색 + 흰 외곽(배경·색각 보조와 무관하게 모양으로 읽힘). LOD 에선 더 짧고 옅게.
   * 프로토콜에 이미 있는 값만 쓴다 (anchorTileId / targetTileId / returnTileId).
   */
  private drawDirections(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView, lod: boolean, r: number): void {
    const cam = this.camera;
    ctx.save();
    const mineOnly = view.directions === 'mine';
    for (const f of model.flags.values()) {
      if (mineOnly && f.ownerId !== view.me) continue;
      let dest: number | null = null;
      if (f.state === 'MARCHING') dest = f.anchorTileId;
      else if (f.state === 'RETURNING') dest = model.flagReturn.get(f.id) ?? null;
      else if (f.state === 'ENGAGED' && f.posture === POSTURE.ATTACK) dest = f.targetTileId;
      if (dest === null) continue;
      const w = this.flagWorld.get(f.id);
      if (!w) continue;
      const p = worldToScreen(cam, w.x, w.y);
      if (p.x < -60 || p.y < -60 || p.x > cam.viewW + 60 || p.y > cam.viewH + 60) continue;
      const dc = topo.tileCenter(dest);
      const q = worldToScreen(cam, dc.x, dc.y);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      const start = r * 1.25 + 3;
      if (dist < 2) continue;
      const ux = dx / dist;
      const uy = dy / dist;
      const mine = f.ownerId === view.me;
      // 목적지가 바로 옆(교전 대상 칸 등)이어도 방향은 보이게 최소 길이를 둔다
      const len = Math.max(lod && !mine ? 6 : 9, Math.min(dist - start, lod && !mine ? 14 : 30));
      const x0 = p.x + ux * start;
      const y0 = p.y + uy * start;
      const x1 = x0 + ux * len;
      const y1 = y0 + uy * len;
      const head = lod && !mine ? 4 : 6;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * head - uy * head * 0.7, y1 - uy * head + ux * head * 0.7);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * head + uy * head * 0.7, y1 - uy * head - ux * head * 0.7);
      };
      ctx.globalAlpha = f.routed ? 0.35 : lod && !mine ? 0.45 : 0.75;
      ctx.lineCap = 'round';
      path();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      path();
      ctx.strokeStyle = f.routed ? '#666' : playerDark(f.ownerId);
      ctx.lineWidth = 1.8;
      if (f.state === 'RETURNING') ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawFlag(ctx: CanvasRenderingContext2D, model: GameModel, f: FlagSnapshot, x: number, y: number, r: number, view: RenderView, now: number, detail: boolean): void {
    const attack = f.posture === POSTURE.ATTACK;
    const postureColor = attack ? COLOR_ATTACK : COLOR_DEFEND;
    const selected = f.id === view.selectedFlagId;
    ctx.save();
    if (f.routed) ctx.globalAlpha = 0.55;
    if (f.inCombat) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,59,48,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (selected) {
      // 선택 강조 (2026-10-14): 어두운 바탕 고리 + 노란 고리 + 천천히 퍼지는 바깥 고리
      const pulse = (now % 1200) / 1200;
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + pulse * 8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,0,${0.7 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    if (attack) {
      const k = r * 1.2;
      ctx.moveTo(x, y - k);
      ctx.lineTo(x + k, y);
      ctx.lineTo(x, y + k);
      ctx.lineTo(x - k, y);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = f.routed ? '#8a8a8a' : playerColor(f.ownerId);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = postureColor;
    if (f.routed) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#111';
    ctx.stroke();

    // 병종 아이콘 (창 / 검 / 말굽) — 모양으로 구분되므로 색각 보조 모드에서도 같다. 작은 줌(LOD r=6)에서도 그린다.
    if (r >= 6 && !drawUnitGlyph(ctx, f.unit, x, y, Math.max(10, Math.round(r * 1.5)))) {
      this.label(ctx, UNIT_SHORT[f.unit] ?? '?', x, y + 1, Math.round(r * 1.05), '#fff', true);
    }
    // 색각 보조: 플레이어 번호 배지
    if (view.colorblind && r >= 7) {
      const bx = x - r - 2;
      const by = y - r - 2;
      ctx.fillStyle = '#111';
      ctx.fillRect(bx - 6, by - 6, 12, 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(f.ownerId), bx, by + 0.5);
    }
    if (!detail) {
      ctx.restore();
      return;
    }
    // 병력 + (내 행군 깃발) 도착 예상
    const eta = model.flagEta.get(f.id);
    const etaSec = eta !== undefined && f.state === 'MARCHING' && f.ownerId === view.me ? Math.max(0, Math.ceil(((eta - model.tick) * model.config.tickMs) / 1000)) : null;
    this.label(ctx, etaSec !== null ? `${f.troops} · ${etaSec}초` : String(f.troops), x, y + r + 12, 12, '#fff');

    if (attack && f.state === 'ENGAGED') {
      const tr = this.progress.get(f.id);
      const decaying = tr ? now < tr.decayUntil : false;
      const pct = tr ? tr.shownPct : f.progressPct;
      const bw = r * 2.4;
      const bx = x - bw / 2;
      const by = y - r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = decaying ? '#9aa5b1' : f.stalled ? '#ffb300' : '#ffe082';
      ctx.fillRect(bx, by, (bw * pct) / 100, 4);
      if (decaying) {
        ctx.fillStyle = '#cfd8dc';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('▼', bx + bw + 3, by + 2);
      }
    }
    if (f.disengaging && f.disengageUntilTick !== null) {
      // v4.5 (§22.7): 이탈 대기 길이 = 소유자 스탯 DISENGAGE_TICKS (철수 훈련 15 → 10)
      const left = Math.min(1, Math.max(0, f.disengageUntilTick - model.tick) / this.disengageTicksOf(model, f.ownerId));
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      // v4.6 (§27): 태세 전환이 연 이탈 대기 = 하늘색 호 + "전환" 태그 (회수·재지정의 노란 호와 구분)
      ctx.strokeStyle = model.disengageForPosture.has(f.id) ? '#4fc3f7' : '#ffd600';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (selected && model.tick < f.postureCooldownUntilTick) {
      const left = (f.postureCooldownUntilTick - model.tick) / POSTURE_COOLDOWN_TICKS;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left));
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const tag = f.routed ? '패주' : f.disengaging ? (model.disengageForPosture.has(f.id) ? '태세 전환 중' : '이탈') : f.blocked ? '대치' : f.stalled ? '정체' : f.state === 'RETURNING' ? '귀환' : f.state === 'IDLE' ? (model.flagIdleReason.get(f.id) === 'unreachable' ? '막힘' : '대기') : null;
    if (tag) {
      const tx = x + r + 4;
      const ty = y - r - 2;
      ctx.font = 'bold 10px system-ui, sans-serif';
      const tw = ctx.measureText(tag).width + 6;
      ctx.fillStyle = f.routed ? '#555' : f.blocked ? '#ef6c00' : f.disengaging ? (model.disengageForPosture.has(f.id) ? '#0277bd' : '#c49000') : f.stalled ? '#b26a00' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx, ty - 7, tw, 13);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tx + 3, ty);
    }
    ctx.restore();
  }

  /**
   * 미니맵: 전체 맵 축소 + 깃발 점 + 현재 카메라 영역. 월드 경계 비율로만 변환(토폴로지 무관).
   */
  drawMinimap(mini: HTMLCanvasElement, model: GameModel | null, me: number | null): void {
    const ctx = mini.getContext('2d');
    if (!ctx || !this.topo || !this.layer || !model?.ready) return;
    const dpr = window.devicePixelRatio || 1;
    const w = mini.clientWidth;
    const h = mini.clientHeight;
    if (mini.width !== Math.round(w * dpr) || mini.height !== Math.round(h * dpr)) {
      mini.width = Math.round(w * dpr);
      mini.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c1118';
    ctx.fillRect(0, 0, w, h);
    const r = this.minimapRect(w, h);
    this.layer.drawScaled(ctx, r.x, r.y, r.w, r.h);
    const sx = r.w / this.topo.worldWidth;
    const sy = r.h / this.topo.worldHeight;
    for (const f of model.flags.values()) {
      const p = this.flagWorld.get(f.id) ?? this.topo.tileCenter(f.posTileId);
      ctx.fillStyle = f.ownerId === me ? '#fff' : playerDark(f.ownerId);
      const s = f.ownerId === me ? 3 : 2;
      ctx.fillRect(r.x + p.x * sx - s / 2, r.y + p.y * sy - s / 2, s, s);
    }
    const cam = this.camera;
    const vw = (cam.viewW / cam.zoom) * sx;
    const vh = (cam.viewH / cam.zoom) * sy;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + cam.cx * sx - vw / 2, r.y + cam.cy * sy - vh / 2, vw, vh);
  }

  /** 미니맵 안 맵 영역 (비율 유지, 가운데 정렬) */
  minimapRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const ww = this.topo?.worldWidth ?? 1;
    const wh = this.topo?.worldHeight ?? 1;
    const k = Math.min(w / ww, h / wh);
    return { x: (w - ww * k) / 2, y: (h - wh * k) / 2, w: ww * k, h: wh * k };
  }

  /** 미니맵 좌표 → 월드 좌표 */
  minimapToWorld(mx: number, my: number, w: number, h: number): Pt {
    const r = this.minimapRect(w, h);
    return { x: ((mx - r.x) / r.w) * (this.topo?.worldWidth ?? 0), y: ((my - r.y) / r.h) * (this.topo?.worldHeight ?? 0) };
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, bold = true): void {
    ctx.font = `${bold ? 'bold ' : ''}${size}px system-ui, "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

/** 영토 이름 기준점 재계산 최소 간격 (ms) */
export const LABEL_REFRESH_MS = 1000;

/** 기지 아이콘 한 변 (화면 px) — 칸(zoom px)을 꽉 채운다. 아주 작은 줌에서도 10px 은 유지 */
export function baseIconSize(zoom: number): number {
  return Math.max(10, Math.min(64, zoom));
}

/** 다섯 꼭짓점 별 경로 */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? outer : inner;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 멈춤 표식: 주황 원 + 흰 가로 막대 (색이 아니라 모양으로도 읽힌다) */
function drawStopMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ef6c00';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - r * 0.55, y - r * 0.17, r * 1.1, r * 0.34);
}

function rank(f: FlagSnapshot, view: RenderView): number {
  if (f.id === view.selectedFlagId) return 3;
  if (f.ownerId === view.me) return 2;
  return 1;
}

/** 영토 이름 옆 작은 문장 — 플레이어 색 방패 (가운데 cx, cy, 높이 h). 어두운 테두리로 어느 땅 위에서도 보이게 */
function drawEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, color: string): void {
  const w = h * 0.82;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w, y0 + h * 0.5);
  ctx.quadraticCurveTo(x0 + w, y0 + h * 0.85, cx, y0 + h);
  ctx.quadraticCurveTo(x0, y0 + h * 0.85, x0, y0 + h * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, h * 0.12);
  ctx.strokeStyle = 'rgba(8,12,18,0.85)';
  ctx.stroke();
}
