/**
 * 인게임 입력 — 마우스/키보드 → 카메라 조작 또는 서버 명령(의도).
 *
 * 조작 (GDD 4.3 "병종 키 → 맵 클릭 = 2액션"):
 *   1/2/3      병종 선택(창/검/기) → 커서가 기본 태세·결과 예고 → 좌클릭 = 발령 (Shift+클릭 = 병종 유지)
 *   Q/E, [/]   발령 비율 −/+10%
 *   좌클릭 깃발  선택 (내 깃발이면 조작 가능)
 *   우클릭      선택한 내 깃발 재지정 / 병종 선택 취소
 *   F          선택 깃발 태세 전환      R  선택 깃발 회수      Tab  내 깃발 순환
 *   Esc        취소 · 선택 해제        H  내 수도로        0  맵 전체
 *   드래그(좌·가운데) / WASD·방향키 = 이동, 휠 = 줌
 */
import { POSTURE, UNIT_CONVERT_PERMILLE, MOB_CONVERT_PERMILLE_BY_TIER, type Unit } from '@civwar/shared';
import { panBy, screenToWorld, zoomAt, clampCamera } from '../render/camera.js';
import type { GameRenderer } from '../render/renderer.js';
import type { ClientStore } from '../state/store.js';
import { troopsForRatio } from './preview.js';

export class Interaction {
  armedUnit: Unit | null = null;
  ratio = 0.5;
  selectedFlagId: number | null = null;
  hoverTile = -1;
  hoverX = 0;
  hoverY = 0;
  /** React 패널이 다시 그릴지 판단 */
  version = 0;
  bump(): void {
    this.version++;
  }
}

export class GameInputController {
  private dragging: { x: number; y: number; moved: boolean; button: number } | null = null;
  private keysHeld = new Set<string>();
  private detach: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: GameRenderer,
    private readonly store: ClientStore,
    readonly ix: Interaction,
  ) {}

  /** 내가 명령할 수 있는가 (관전·탈락 제외) */
  canCommand(): boolean {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    if (!g || me === null || this.store.spectating || g.gameOver) return false;
    return g.players.get(me)?.alive ?? false;
  }

  myFlag(id: number | null): boolean {
    if (id === null) return false;
    const f = this.store.game?.flags.get(id);
    return !!f && f.ownerId === this.store.myPlayerId;
  }

  /** 현재 비율·병종으로 보낼 병력 */
  troopsToSend(unit: Unit): number {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    if (!g || me === null) return 0;
    const p = g.players.get(me);
    if (!p) return 0;
    const uc = (g.config.constants?.UNIT_CONVERT_PERMILLE as readonly number[] | undefined) ?? UNIT_CONVERT_PERMILLE;
    const mc = (g.config.constants?.MOB_CONVERT_PERMILLE_BY_TIER as readonly number[] | undefined) ?? MOB_CONVERT_PERMILLE_BY_TIER;
    return troopsForRatio(p.troops, this.ix.ratio, uc[unit], mc[p.tech[3]]);
  }

  attach(): void {
    const c = this.canvas;
    const onDown = (e: MouseEvent) => this.onMouseDown(e);
    const onMove = (e: MouseEvent) => this.onMouseMove(e);
    const onUp = (e: MouseEvent) => this.onMouseUp(e);
    const onWheel = (e: WheelEvent) => this.onWheel(e);
    const onCtx = (e: MouseEvent) => this.onContextMenu(e);
    const onKey = (e: KeyboardEvent) => this.onKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => this.keysHeld.delete(e.key.toLowerCase());
    const onLeave = () => {
      this.ix.hoverTile = -1;
    };
    const onBlur = () => this.keysHeld.clear();
    c.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('contextmenu', onCtx);
    c.addEventListener('mouseleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.detach = () => {
      c.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('contextmenu', onCtx);
      c.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }

  /** 렌더 프레임마다: 키보드 팬 */
  tick(dtMs: number): void {
    const speed = (dtMs / 1000) * 700; // 화면 px/s
    let dx = 0;
    let dy = 0;
    if (this.keysHeld.has('a') || this.keysHeld.has('arrowleft')) dx += speed;
    if (this.keysHeld.has('d') || this.keysHeld.has('arrowright')) dx -= speed;
    if (this.keysHeld.has('w') || this.keysHeld.has('arrowup')) dy += speed;
    if (this.keysHeld.has('s') || this.keysHeld.has('arrowdown')) dy -= speed;
    if (dx || dy) {
      panBy(this.renderer.camera, dx, dy);
      this.clamp();
      this.refreshHover();
    }
  }

  private clamp(): void {
    const t = this.renderer.topo;
    if (t) clampCamera(this.renderer.camera, t.worldWidth, t.worldHeight);
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** 화면 좌표 → 타일 ID (카메라 반영). 타일 변환은 TopologyView 에 위임 */
  pixelToTileId(sx: number, sy: number): number {
    const topo = this.renderer.topo;
    if (!topo) return -1;
    const w = screenToWorld(this.renderer.camera, sx, sy);
    return topo.worldToTileId(w.x, w.y);
  }

  private refreshHover(): void {
    this.ix.hoverTile = this.pixelToTileId(this.ix.hoverX, this.ix.hoverY);
  }

  private onMouseDown(e: MouseEvent): void {
    const p = this.local(e);
    if (e.button === 0 || e.button === 1) {
      this.dragging = { x: p.x, y: p.y, moved: false, button: e.button };
      if (e.button === 1) e.preventDefault();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const p = this.local(e);
    if (this.dragging) {
      const dx = p.x - this.dragging.x;
      const dy = p.y - this.dragging.y;
      if (!this.dragging.moved && Math.abs(dx) + Math.abs(dy) > 5) this.dragging.moved = true;
      if (this.dragging.moved) {
        panBy(this.renderer.camera, dx, dy);
        this.clamp();
        this.dragging.x = p.x;
        this.dragging.y = p.y;
      }
    }
    const inside = p.x >= 0 && p.y >= 0 && p.x <= this.canvas.clientWidth && p.y <= this.canvas.clientHeight;
    this.ix.hoverX = p.x;
    this.ix.hoverY = p.y;
    this.ix.hoverTile = inside ? this.pixelToTileId(p.x, p.y) : -1;
  }

  private onMouseUp(e: MouseEvent): void {
    const d = this.dragging;
    this.dragging = null;
    if (!d || d.moved || e.button !== 0 || d.button !== 0) return;
    const p = this.local(e);
    this.click(p.x, p.y, e.shiftKey);
  }

  /** 좌클릭 (드래그 아님) — 테스트에서도 직접 호출 */
  click(sx: number, sy: number, keepArmed = false): void {
    const tile = this.pixelToTileId(sx, sy);
    if (this.ix.armedUnit !== null) {
      if (tile < 0 || !this.canCommand()) return;
      const unit = this.ix.armedUnit;
      this.store.issueFlag(unit, this.troopsToSend(unit), tile);
      if (!keepArmed) this.ix.armedUnit = null;
      this.ix.bump();
      return;
    }
    const hit = this.renderer.flagAt(sx, sy);
    this.ix.selectedFlagId = hit;
    this.ix.bump();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.ix.armedUnit !== null) {
      this.ix.armedUnit = null;
      this.ix.bump();
      return;
    }
    const p = this.local(e);
    const tile = this.pixelToTileId(p.x, p.y);
    if (tile >= 0 && this.myFlag(this.ix.selectedFlagId) && this.canCommand()) {
      this.store.retarget(this.ix.selectedFlagId!, tile);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    zoomAt(this.renderer.camera, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    this.clamp();
    this.refreshHover();
  }

  armUnit(u: Unit): void {
    if (!this.canCommand()) return;
    this.ix.armedUnit = this.ix.armedUnit === u ? null : u;
    this.ix.bump();
  }

  setRatio(r: number): void {
    this.ix.ratio = Math.round(Math.min(1, Math.max(0.1, r)) * 10) / 10;
    this.ix.bump();
  }

  togglePosture(): void {
    const id = this.ix.selectedFlagId;
    if (!this.myFlag(id) || !this.canCommand()) return;
    const f = this.store.game!.flags.get(id!)!;
    this.store.setPosture(f.id, f.posture === POSTURE.ATTACK ? POSTURE.DEFEND : POSTURE.ATTACK);
  }

  recallSelected(): void {
    const id = this.ix.selectedFlagId;
    if (!this.myFlag(id) || !this.canCommand()) return;
    this.store.recall(id!);
  }

  centerHome(): void {
    const g = this.store.game;
    const topo = this.renderer.topo;
    const me = this.store.myPlayerId;
    if (!g || !topo) return;
    const s = g.spawns.find((x) => x.playerId === me);
    if (!s) return this.renderer.fitWorld();
    const c = topo.tileCenter(s.homeTileId);
    this.renderer.camera.cx = c.x;
    this.renderer.camera.cy = c.y;
  }

  cycleMyFlags(): void {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    const topo = this.renderer.topo;
    if (!g || me === null || !topo) return;
    const mine = g.flagsOf(me).sort((a, b) => a.slotIndex - b.slotIndex);
    if (!mine.length) return;
    const i = mine.findIndex((f) => f.id === this.ix.selectedFlagId);
    const next = mine[(i + 1) % mine.length];
    this.ix.selectedFlagId = next.id;
    const c = topo.tileCenter(next.posTileId);
    this.renderer.camera.cx = c.x;
    this.renderer.camera.cy = c.y;
    this.ix.bump();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
      this.keysHeld.add(k);
      e.preventDefault();
      return;
    }
    switch (k) {
      case '1':
        return this.armUnit(0);
      case '2':
        return this.armUnit(1);
      case '3':
        return this.armUnit(2);
      case 'q':
      case '[':
        return this.setRatio(this.ix.ratio - 0.1);
      case 'e':
      case ']':
        return this.setRatio(this.ix.ratio + 0.1);
      case 'f':
        return this.togglePosture();
      case 'r':
        return this.recallSelected();
      case 'h':
        return this.centerHome();
      case '0':
        return this.renderer.fitWorld();
      case 'tab':
        e.preventDefault();
        return this.cycleMyFlags();
      case 'escape':
        this.ix.armedUnit = null;
        this.ix.selectedFlagId = null;
        this.ix.bump();
        return;
    }
  }
}
