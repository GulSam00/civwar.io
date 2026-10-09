/**
 * Canvas 렌더러 — requestAnimationFrame 루프에서 GameModel 을 "읽기만" 한다.
 * 상태 갱신(WS 수신)과 분리: 모델이 바뀌어도 루프를 재시작하지 않는다.
 *
 * 레이어: 타일(지형+영토, 1 타일 = 1 픽셀 오프스크린) → 경계선 → 게이지 대상 칸 → 기지 → 앵커 선 → 깃발 → 커서 예고
 * 타일 좌표 변환은 전부 TopologyView 를 거친다 (사각 전제 식은 topology.ts 에만).
 */
import { DISENGAGE_TICKS, POSTURE, POSTURE_COOLDOWN_TICKS, type FlagSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { createTopologyView, type TileLayer, type TopologyView } from './topology.js';
import { fitZoom, worldToScreen, type Camera } from './camera.js';
import { FlagInterpolator, type Pt } from './flagInterp.js';
import { COLOR_ATTACK, COLOR_DEFEND, COLOR_DISABLED, playerColor, playerDark, tileRgba } from './palette.js';
import type { CursorPreview } from '../input/preview.js';
import { UNIT_SHORT } from '../ui/text.js';

export interface RenderView {
  me: number | null;
  selectedFlagId: number | null;
  hoverTile: number;
  preview: CursorPreview | null;
  nicknameOf(id: number): string;
}

interface FlagScreen {
  id: number;
  x: number;
  y: number;
  r: number;
}

export class GameRenderer {
  readonly camera: Camera = { cx: 0, cy: 0, zoom: 12, viewW: 1, viewH: 1 };
  topo: TopologyView | null = null;
  private model: GameModel | null = null;
  private layer: TileLayer | null = null;
  private layerOwnersVersion = -1;
  private borders: Map<number, Path2D> = new Map();
  private bordersDirty = true;
  private bordersBuiltAt = 0;
  private interp = new FlagInterpolator();
  private flagScreens: FlagScreen[] = [];
  private previewPathKey = '';
  private previewPath: Path2D | null = null;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** 모델(매치)이 바뀌면 토폴로지·레이어·보간 초기화 + 카메라를 내 수도로 */
  private attach(model: GameModel, me: number | null): void {
    this.model = model;
    this.topo = createTopologyView(model.config.topology, model.width, model.height);
    this.layer = this.topo.createTileLayer();
    this.layerOwnersVersion = -1;
    this.bordersDirty = true;
    this.interp.clear();
    const cam = this.camera;
    cam.zoom = Math.max(fitZoom(cam.viewW, cam.viewH, this.topo.worldWidth, this.topo.worldHeight), 10);
    const home = me !== null ? model.spawns.find((s) => s.playerId === me) : undefined;
    const c = home ? this.topo.tileCenter(home.homeTileId) : { x: this.topo.worldWidth / 2, y: this.topo.worldHeight / 2 };
    cam.cx = c.x;
    cam.cy = c.y;
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
    // 월드 변환
    ctx.save();
    ctx.translate(cam.viewW / 2, cam.viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.cx, -cam.cy);
    this.layer!.draw(ctx);
    // 영토 경계
    ctx.lineWidth = Math.max(1.2 / cam.zoom, 0.06);
    for (const [owner, path] of this.borders) {
      ctx.strokeStyle = playerDark(owner);
      ctx.stroke(path);
    }
    // 내 영토는 한 번 더 밝게
    if (view.me !== null && this.borders.has(view.me)) {
      ctx.lineWidth = Math.max(2.4 / cam.zoom, 0.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke(this.borders.get(view.me)!);
    }
    this.drawGaugeTargets(ctx, model, topo);
    this.drawPreview(ctx, topo, view.preview);
    // 호버 칸
    if (view.hoverTile >= 0) {
      ctx.beginPath();
      topo.tilePath(ctx, view.hoverTile, 0.04);
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
    ctx.restore();

    // 화면 공간 (선명한 아이콘·텍스트)
    this.drawBases(ctx, model, topo, view);
    this.drawFlags(ctx, model, topo, view, now);
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
    } else if (model.dirtyTiles.length) {
      for (const t of model.dirtyTiles) layer.setColor(t, tileRgba(terrain[t], model.owners[t]));
      model.dirtyTiles.length = 0;
      this.bordersDirty = true;
    }
    layer.flush();
    // 경계선은 최대 5Hz 로 다시 만든다
    if (this.bordersDirty && now - this.bordersBuiltAt > 180) {
      this.borders = topo.buildBorderPaths(model.owners, (t) => model.isLand(t));
      this.bordersDirty = false;
      this.bordersBuiltAt = now;
    }
  }

  private drawGaugeTargets(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView): void {
    for (const f of model.flags.values()) {
      if (f.posture !== POSTURE.ATTACK || f.targetTileId === null || f.state !== 'ENGAGED') continue;
      const pct = f.progressPct / 100;
      ctx.beginPath();
      topo.tilePath(ctx, f.targetTileId, 0);
      ctx.fillStyle = playerColor(f.ownerId);
      ctx.globalAlpha = 0.25 + 0.65 * pct;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.strokeStyle = f.stalled ? '#ffb300' : playerDark(f.ownerId);
      ctx.stroke();
    }
  }

  private drawPreview(ctx: CanvasRenderingContext2D, topo: TopologyView, p: CursorPreview | null): void {
    if (!p) return;
    const key = `${p.tile}:${p.disk.length}`;
    if (key !== this.previewPathKey) {
      this.previewPath = topo.regionOutline(p.disk);
      this.previewPathKey = key;
    }
    const color = p.kind === 'attack' ? COLOR_ATTACK : p.kind === 'defend' ? COLOR_DEFEND : COLOR_DISABLED;
    ctx.save();
    ctx.lineWidth = 2.5 / this.camera.zoom;
    ctx.strokeStyle = color;
    ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
    ctx.stroke(this.previewPath!);
    ctx.setLineDash([]);
    ctx.beginPath();
    topo.tilePath(ctx, p.tile, 0.08);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.restore();
  }

  private drawBases(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView): void {
    const cam = this.camera;
    const s = Math.max(8, Math.min(22, cam.zoom * 0.8));
    for (const tile of model.baseTiles) {
      const b = model.bases.get(tile);
      if (!b) continue;
      const c = topo.tileCenter(tile);
      const p = worldToScreen(cam, c.x, c.y);
      if (p.x < -40 || p.y < -40 || p.x > cam.viewW + 40 || p.y > cam.viewH + 40) continue;
      const capital = model.capitalTiles.has(tile);
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#f5f1e6';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
      // 기지 표식: 안쪽 사각(일반) / 이중 테두리(수도)
      ctx.strokeStyle = b.ownerId ? 'rgba(255,255,255,0.9)' : '#555';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (capital) ctx.rect(p.x - s / 2 + 3, p.y - s / 2 + 3, s - 6, s - 6);
      else {
        ctx.moveTo(p.x - s / 4, p.y);
        ctx.lineTo(p.x + s / 4, p.y);
        ctx.moveTo(p.x, p.y - s / 4);
        ctx.lineTo(p.x, p.y + s / 4);
      }
      ctx.stroke();
      // 체력 바
      const bw = Math.max(s * 1.4, 18);
      const bh = 4;
      const bx = p.x - bw / 2;
      const by = p.y - s / 2 - bh - 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#ddd';
      ctx.fillRect(bx, by, (bw * Math.max(0, Math.min(100, b.hpPct))) / 100, bh);
      if (capital && b.ownerId && cam.zoom >= 9) {
        this.label(ctx, view.nicknameOf(b.ownerId), p.x, p.y + s / 2 + 11, 11, '#fff');
      }
    }
  }

  private drawFlags(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView, now: number): void {
    const cam = this.camera;
    const r = Math.max(8, Math.min(16, cam.zoom * 0.55));
    this.interp.retain((id) => model.flags.has(id));
    const screens: FlagScreen[] = [];
    const positions = new Map<number, Pt>();
    // 위치 계산 (보간)
    for (const f of model.flags.values()) {
      const w = this.interp.update(f.id, f.posTileId, topo.tileCenter(f.posTileId), now);
      positions.set(f.id, w);
    }
    // 내 깃발 · 선택 깃발: 앵커까지 선
    for (const f of model.flags.values()) {
      const mine = f.ownerId === view.me;
      if (!mine && f.id !== view.selectedFlagId) continue;
      const w = positions.get(f.id)!;
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
      // 앵커 표식 (X)
      ctx.beginPath();
      ctx.moveTo(q.x - 4, q.y - 4);
      ctx.lineTo(q.x + 4, q.y + 4);
      ctx.moveTo(q.x + 4, q.y - 4);
      ctx.lineTo(q.x - 4, q.y + 4);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    // 깃발 본체: 선택·내 깃발을 위에 그리도록 정렬
    const order = [...model.flags.values()].sort((a, b) => rank(a, view) - rank(b, view) || a.id - b.id);
    for (const f of order) {
      const w = positions.get(f.id)!;
      const p = worldToScreen(cam, w.x, w.y);
      if (p.x < -50 || p.y < -50 || p.x > cam.viewW + 50 || p.y > cam.viewH + 50) continue;
      this.drawFlag(ctx, model, f, p.x, p.y, r, view, now);
      screens.push({ id: f.id, x: p.x, y: p.y, r });
    }
    this.flagScreens = screens;
  }

  private drawFlag(ctx: CanvasRenderingContext2D, model: GameModel, f: FlagSnapshot, x: number, y: number, r: number, view: RenderView, now: number): void {
    const attack = f.posture === POSTURE.ATTACK;
    const postureColor = attack ? COLOR_ATTACK : COLOR_DEFEND;
    const selected = f.id === view.selectedFlagId;
    ctx.save();
    if (f.routed) ctx.globalAlpha = 0.55;

    // 교전: 붉은 맥동 링
    if (f.inCombat) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,59,48,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    // 본체 모양: 공격 = 마름모, 방어 = 원 (색 + 모양 이중 신호)
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

    // 병종 글자
    this.label(ctx, UNIT_SHORT[f.unit] ?? '?', x, y + 1, Math.round(r * 1.05), '#fff', true);

    // 병력 수
    this.label(ctx, String(f.troops), x, y + r + 12, 12, '#fff');

    // 진척도 게이지 (공격·교전)
    if (attack && f.state === 'ENGAGED') {
      const bw = r * 2.4;
      const bx = x - bw / 2;
      const by = y - r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = f.stalled ? '#ffb300' : '#ffe082';
      ctx.fillRect(bx, by, (bw * f.progressPct) / 100, 4);
    }

    // 이탈 대기: 노란 감소 호
    if (f.disengaging && f.disengageUntilTick !== null) {
      const left = Math.max(0, f.disengageUntilTick - model.tick) / DISENGAGE_TICKS;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // 태세 쿨타임 링 (선택된 내 깃발)
    if (selected && model.tick < f.postureCooldownUntilTick) {
      const left = (f.postureCooldownUntilTick - model.tick) / POSTURE_COOLDOWN_TICKS;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left));
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 상태 태그
    const tag = f.routed ? '패주' : f.disengaging ? '이탈' : f.blocked ? '대치' : f.stalled ? '정체' : f.state === 'RETURNING' ? '귀환' : f.state === 'IDLE' ? '대기' : null;
    if (tag) {
      const tx = x + r + 4;
      const ty = y - r - 2;
      ctx.font = 'bold 10px system-ui, sans-serif';
      const tw = ctx.measureText(tag).width + 6;
      ctx.fillStyle = f.routed ? '#555' : f.blocked ? '#ef6c00' : f.disengaging ? '#c49000' : f.stalled ? '#b26a00' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx, ty - 7, tw, 13);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tx + 3, ty);
    }
    ctx.restore();
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

function rank(f: FlagSnapshot, view: RenderView): number {
  if (f.id === view.selectedFlagId) return 3;
  if (f.ownerId === view.me) return 2;
  return 1;
}
