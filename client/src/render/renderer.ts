/**
 * Canvas 렌더러 — requestAnimationFrame 루프에서 GameModel 을 "읽기만" 한다.
 * 상태 갱신(WS 수신)과 분리: 모델이 바뀌어도 루프를 재시작하지 않는다.
 *
 * 레이어: 타일(지형+영토, 1 타일 = 1 픽셀 오프스크린) → (색각 보조 패턴) → 경계선 → 게이지 대상 칸(공격 방향 그라데이션)
 *        → 예고 원 → 기지 → 앵커 선 → 깃발 → (미니맵은 별도 캔버스)
 * 타일 좌표 변환은 전부 TopologyView 를 거친다 (사각 전제 식은 topology.ts 에만).
 */
import { DISENGAGE_TICKS, POSTURE, POSTURE_COOLDOWN_TICKS, type FlagSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { createTopologyView, type TileLayer, type TopologyView } from './topology.js';
import { fitZoom, worldToScreen, type Camera } from './camera.js';
import { FlagInterpolator, type Pt } from './flagInterp.js';
import { COLOR_ATTACK, COLOR_DEFEND, COLOR_DISABLED, playerColor, playerDark, tileRgba } from './palette.js';
import { ownerPattern } from './patterns.js';
import { isDecayTick } from './progressRule.js';
import type { CursorPreview } from '../input/preview.js';
import { UNIT_SHORT } from '../ui/text.js';

export interface RenderView {
  me: number | null;
  selectedFlagId: number | null;
  hoverTile: number;
  preview: CursorPreview | null;
  /** 발령 출발 기지 (null = 자동) */
  originBase: number | null;
  /** 병종이 선택된 상태 — 내 기지를 강조(출발 기지 선택 가능) */
  armed: boolean;
  /** 색각 보조: 영토 패턴 + 깃발 플레이어 번호 */
  colorblind: boolean;
  /** 최근 이모트 (수도 위 말풍선) */
  emotes: readonly { playerId: number; code: number; at: number }[];
  emoteText(code: number): string;
  nicknameOf(id: number): string;
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
    if (view.hoverTile >= 0) {
      ctx.beginPath();
      topo.tilePath(ctx, view.hoverTile, 0.04);
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
    ctx.restore();

    this.drawBases(ctx, model, topo, view);
    this.drawOriginLine(ctx, topo, view);
    this.drawFlags(ctx, model, topo, view, now);
    this.drawEmotes(ctx, model, topo, view);
  }

  /** 이모트 말풍선 — 그 플레이어의 수도(스폰) 위, 4초 동안 서서히 사라진다 */
  private drawEmotes(ctx: CanvasRenderingContext2D, model: GameModel, topo: TopologyView, view: RenderView): void {
    const t = Date.now();
    for (const e of view.emotes) {
      const age = t - e.at;
      if (age > 4000) continue;
      const sp = model.spawns.find((s) => s.playerId === e.playerId);
      if (!sp) continue;
      const c = topo.tileCenter(sp.homeTileId);
      const p = worldToScreen(this.camera, c.x, c.y);
      const text = `${view.nicknameOf(e.playerId)}: ${view.emoteText(e.code)}`;
      ctx.save();
      ctx.globalAlpha = age > 3000 ? (4000 - age) / 1000 : 1;
      ctx.font = 'bold 12px system-ui, "Malgun Gothic", sans-serif';
      const w = ctx.measureText(text).width + 12;
      const x = p.x - w / 2;
      const y = p.y - 46;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = playerDark(e.playerId);
      ctx.lineWidth = 2;
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
      ctx.fillText(text, p.x, y + 10);
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
    } else if (model.dirtyTiles.length) {
      for (const t of model.dirtyTiles) layer.setColor(t, tileRgba(terrain[t], model.owners[t]));
      model.dirtyTiles.length = 0;
      this.bordersDirty = true;
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
        // 내 땅과 맞닿지 않은 칸(상륙 등) — 깃발 쪽에서 차오른다
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

  private drawOriginLine(ctx: CanvasRenderingContext2D, topo: TopologyView, view: RenderView): void {
    if (view.originBase === null || !view.armed) return;
    const o = topo.tileCenter(view.originBase);
    const p = worldToScreen(this.camera, o.x, o.y);
    ctx.save();
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(10, this.camera.zoom * 0.7), 0, Math.PI * 2);
    ctx.stroke();
    if (view.preview) {
      const a = topo.tileCenter(view.preview.tile);
      const q = worldToScreen(this.camera, a.x, a.y);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
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
      if (view.armed && view.me !== null && b.ownerId === view.me) {
        // 출발 기지로 고를 수 있음 (Alt+클릭 / B)
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 0.95, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,214,0,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#f5f1e6';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
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
      const bw = Math.max(s * 1.4, 18);
      const bh = 4;
      const bx = p.x - bw / 2;
      const by = p.y - s / 2 - bh - 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = b.ownerId ? playerColor(b.ownerId) : '#ddd';
      ctx.fillRect(bx, by, (bw * Math.max(0, Math.min(100, b.hpPct))) / 100, bh);
      if (capital && b.ownerId && cam.zoom >= 9) {
        const name = view.colorblind ? `${b.ownerId}. ${view.nicknameOf(b.ownerId)}` : view.nicknameOf(b.ownerId);
        this.label(ctx, name, p.x, p.y + s / 2 + 11, 11, '#fff');
      }
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
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
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

    if (r >= 8) this.label(ctx, UNIT_SHORT[f.unit] ?? '?', x, y + 1, Math.round(r * 1.05), '#fff', true);
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
      const left = Math.max(0, f.disengageUntilTick - model.tick) / DISENGAGE_TICKS;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.strokeStyle = '#ffd600';
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

function rank(f: FlagSnapshot, view: RenderView): number {
  if (f.id === view.selectedFlagId) return 3;
  if (f.ownerId === view.me) return 2;
  return 1;
}
