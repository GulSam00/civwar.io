/**
 * 인게임 입력 — 마우스/키보드 → 카메라 조작 또는 서버 명령(의도).
 *
 * 조작 (v4.2 출전 UI — design-decisions「GDD v4.2 2차 검토 결정」):
 *   맵 지점 클릭  → 가장 가까운 내 기지(서버와 같은 가중 이동 거리) 자동 하이라이트 + 기지→지점 진격 경로 점선 화살표
 *                   + 클릭 지점에 창/검/기 삼각 메뉴 → 하나 고르면 발령 (originBaseTileId = 하이라이트 기지)
 *   내 기지 클릭  → 기지에서 커서까지 경로 화살표가 따라옴 → 지점 클릭 → 삼각 메뉴 → 그 기지에서 발령
 *                   (기지 위에 깃발이 겹쳐 있으면 Alt+클릭으로 기지를 고른다)
 *   1/2/3        삼각 메뉴가 떠 있을 때 병종 선택 (창/검/기)
 *   바깥 클릭 · 우클릭 · Esc = 출전 취소
 *   Q/E, [/]     발령 비율 −/+10% (하단 바)
 *   좌클릭 깃발   선택 (내·적·동맹 모두 — 우측 정보 패널에 공격력·방어력). 병력 바 위 내 부대 칩 클릭 = 선택 + 카메라 이동
 *   내 깃발 선택 + 우클릭 = 항상 이동 (2026-10-14): 내 기지·내 땅 = 그 자리로 가서 방어, 적·중립 = 공격 — 태세는 서버가 도착지로 정한다
 *                 (예전 "선택 + 내 기지 좌클릭 = 귀환"은 폐기 — 귀환은 선택 부대 옆 [귀환] 버튼 / R)
 *   깃발 선택 중 맵 좌클릭 = 선택 해제 (출전 메뉴는 열지 않는다)
 *   F          선택 깃발 태세 전환      R  선택 깃발 회수(자동 귀환지)      Tab  내 깃발 순환
 *   Esc        취소 · 선택 해제        H  내 수도로        0  맵 전체
 *   T 테크 · P 외교 · O 옵션 창 · C 색각 보조 · V 이동 방향 화살표(모두→내 것만→숨김) · ? 도움말 (React 패널 — Interaction 플래그)
 *   드래그(좌·가운데) / WASD·방향키 = 이동, 휠 = 줌, 터치 = 한 손가락 이동 · 두 손가락 확대
 *   관전: 순위표에서 플레이어를 누르면 따라가기, 드래그하면 자유 카메라
 */
import { POSTURE, techConvertPm, techShallowPm, type Unit } from '@civwar/shared';
import { panBy, screenToWorld, worldToScreen, zoomAt, clampCamera } from '../render/camera.js';
import type { GameRenderer } from '../render/renderer.js';
import type { ClientStore } from '../state/store.js';
import { troopsForRatio } from './preview.js';
import { RouteCache, computeRoute, nearestOwnBase, type RoutePreview } from './route.js';
import { defaultOptions, nextDirectionMode, saveOptions, type GameOptions } from '../ui/options.js';
import { techStatsOf } from '../ui/techInfo.js';

export type IssuePosture = 'attack' | 'defend' | 'blocked';

/**
 * 출전(발령) 진행 상태.
 *  aim  : 기지를 골랐고 목적지를 기다리는 중 (기지 → 커서 화살표)
 *  pick : 목적지까지 정해졌고 삼각 메뉴에서 병종을 고르는 중
 */
export type IssueState = { phase: 'aim'; base: number } | { phase: 'pick'; base: number; anchor: number; posture: IssuePosture };

export class Interaction {
  /** 출전 진행 상태 (null = 없음) */
  issue: IssueState | null = null;
  ratio = 0.5;
  selectedFlagId: number | null = null;
  hoverTile = -1;
  hoverX = 0;
  hoverY = 0;
  /** 커서가 맵 캔버스 위에 있다 (HUD·패널·메뉴 위가 아님) — 지형 정보 툴팁 표시 조건 */
  overMap = false;
  /** 열린 패널 */
  panel: 'tech' | 'ally' | null = null;
  /** 테크 창 상세 패널에 연 노드 (null = 닫힘) */
  techDetail: number | null = null;
  /** 좁은 화면 테크 창의 갈래 탭 (0..6) */
  techTab = 0;
  helpOpen = false;
  /** 옵션 창 (톱니 버튼 / O) */
  optionsOpen = false;
  /** 옵션 창 설정 — 색각 보조, 이동 방향 화살표, 지형 툴팁 (ui/options.ts, localStorage) */
  options: GameOptions = defaultOptions();
  get colorblind(): boolean {
    return this.options.colorblind;
  }
  /** 나가기 확인 대화상자 */
  leaveConfirm = false;
  /** React 패널이 다시 그릴지 판단 */
  version = 0;
  bump(): void {
    this.version++;
  }
}

export class GameInputController {
  private dragging: { x: number; y: number; moved: boolean; button: number } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private touchMoved = false;
  private keysHeld = new Set<string>();
  private detach: (() => void) | null = null;
  private routes = new RouteCache();
  private routeKey = '';
  private route: RoutePreview | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly renderer: GameRenderer,
    private readonly store: ClientStore,
    readonly ix: Interaction,
  ) {}

  /** 내가 명령할 수 있는가 (관전·탈락 제외) */
  canCommand(): boolean {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    if (!g || me === null || this.store.spectating || g.gameOver) return false;
    // QA J-2: 종료 단계(재접속·늦은 입장으로 game_over 를 못 받은 경우 포함)에는 명령하지 않는다
    if (this.store.room?.phase === 'GAME_OVER') return false;
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
    // v4.3: 편성비 = 플레이어 스탯 CONVERT_<unit> (구 전 병종 편성 효율 폐기 → 나누는 값 1000)
    return troopsForRatio(p.troops, this.ix.ratio, techConvertPm(techStatsOf(p.techMask, g.config.constants), unit), 1000);
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
      this.ix.overMap = false;
    };
    const onBlur = () => this.keysHeld.clear();
    c.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('contextmenu', onCtx);
    c.addEventListener('mouseleave', onLeave);
    const onTouchStart = (e: TouchEvent) => this.onTouch(e, 'start');
    const onTouchMove = (e: TouchEvent) => this.onTouch(e, 'move');
    const onTouchEnd = (e: TouchEvent) => this.onTouch(e, 'end');
    c.addEventListener('touchstart', onTouchStart, { passive: false });
    c.addEventListener('touchmove', onTouchMove, { passive: false });
    c.addEventListener('touchend', onTouchEnd);
    c.addEventListener('touchcancel', onTouchEnd);
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
      c.removeEventListener('touchstart', onTouchStart);
      c.removeEventListener('touchmove', onTouchMove);
      c.removeEventListener('touchend', onTouchEnd);
      c.removeEventListener('touchcancel', onTouchEnd);
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
      this.store.setFollowSilently(null);
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
        this.store.setFollowSilently(null);
        panBy(this.renderer.camera, dx, dy);
        this.clamp();
        this.dragging.x = p.x;
        this.dragging.y = p.y;
      }
    }
    const inside = p.x >= 0 && p.y >= 0 && p.x <= this.canvas.clientWidth && p.y <= this.canvas.clientHeight;
    this.ix.hoverX = p.x;
    this.ix.hoverY = p.y;
    this.ix.overMap = inside && e.target === this.canvas;
    this.ix.hoverTile = inside ? this.pixelToTileId(p.x, p.y) : -1;
  }

  private onMouseUp(e: MouseEvent): void {
    const d = this.dragging;
    this.dragging = null;
    if (!d || d.moved || e.button !== 0 || d.button !== 0) return;
    const p = this.local(e);
    this.click(p.x, p.y, e.altKey);
  }

  // ───────────── 출전 (v4.2 UI) ─────────────

  /** 내 기지 칸인가 */
  isMyBase(tile: number): boolean {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    if (!g || me === null || tile < 0) return false;
    return g.bases.get(tile)?.ownerId === me;
  }

  /** 기지 칸인가 (소유 무관) */
  isBaseTile(tile: number): boolean {
    return tile >= 0 && !!this.store.game?.bases.has(tile);
  }

  /** v4.3: 내 얕은 물 이동배율 ‰ (MOB-2B 조선술 반영) — 거리장 키 */
  private myMobilityTier(): number {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    const p = g && me !== null ? g.players.get(me) : undefined;
    return techShallowPm(techStatsOf(p?.techMask ?? 0, g?.config.constants));
  }

  /** 목적지까지 이동 거리(서버와 같은 가중 경로)가 가장 짧은 내 기지 */
  nearestBaseFor(anchor: number): number | null {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    const topo = this.renderer.topo;
    if (!g || me === null || !topo || !g.terrain || anchor < 0) return null;
    const field = this.routes.fieldFor(g, topo, anchor, this.myMobilityTier());
    return nearestOwnBase(g, field, me);
  }

  /** 지점의 기본 태세 예고 (내 땅 = 방어, 적·중립 = 공격, 물·동맹 = 불가) — 표시 전용, 서버가 최종 판정 */
  postureAt(tile: number): IssuePosture {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    if (!g || me === null || tile < 0 || !g.isLand(tile)) return 'blocked';
    const o = g.owners[tile];
    if (o === me) return 'defend';
    if (g.isAlly(me, o)) return 'blocked';
    return 'attack';
  }

  /**
   * 지금 그릴 진격 경로 (렌더 루프가 매 프레임 호출 — 키가 같으면 캐시).
   *  aim  : 고른 기지 → 커서 칸
   *  pick : 기지 → 확정 지점
   */
  currentRoute(): RoutePreview | null {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    const topo = this.renderer.topo;
    const is = this.ix.issue;
    if (!g || me === null || !topo || !g.terrain || !is) return null;
    const anchor = is.phase === 'aim' ? this.ix.hoverTile : is.anchor;
    if (anchor < 0) return null;
    const attack = (is.phase === 'pick' ? is.posture : this.postureAt(anchor)) === 'attack';
    const tier = this.myMobilityTier();
    const key = `${is.base}:${anchor}:${attack}:${tier}:${g.ownersVersion}:${g.tick}`;
    if (key !== this.routeKey) {
      const field = this.routes.fieldFor(g, topo, anchor, tier);
      this.route = computeRoute(g, topo, field, me, is.base, anchor, attack);
      this.routeKey = key;
    }
    return this.route;
  }

  /** 삼각 메뉴의 화면 위치 (확정 지점 칸 중심) */
  pickScreenPos(): { x: number; y: number } | null {
    const is = this.ix.issue;
    const topo = this.renderer.topo;
    if (!is || is.phase !== 'pick' || !topo) return null;
    const c = topo.tileCenter(is.anchor);
    return worldToScreen(this.renderer.camera, c.x, c.y);
  }

  /** 출전 취소 */
  cancelIssue(): void {
    if (!this.ix.issue) return;
    this.ix.issue = null;
    this.ix.bump();
  }

  /** 기지 → 커서 화살표 단계 시작 */
  beginAim(base: number): void {
    if (!this.canCommand() || !this.isMyBase(base)) return;
    this.ix.issue = { phase: 'aim', base };
    this.ix.selectedFlagId = null;
    this.ix.bump();
  }

  /** 목적지 확정 → 삼각 메뉴. base 가 없으면 가장 가까운 내 기지 */
  beginPick(anchor: number, base: number | null): void {
    if (!this.canCommand() || anchor < 0) return;
    const b = base ?? this.nearestBaseFor(anchor);
    if (b === null) {
      this.store.toast('출전할 내 기지가 없습니다', 'error', 2000);
      this.ix.issue = null;
    } else this.ix.issue = { phase: 'pick', base: b, anchor, posture: this.postureAt(anchor) };
    this.ix.selectedFlagId = null;
    this.ix.bump();
  }

  /** 삼각 메뉴에서 병종 선택 → 발령 (cmd_flag_issue, originBaseTileId = 하이라이트 기지) */
  chooseUnit(u: Unit): void {
    const is = this.ix.issue;
    if (!is || is.phase !== 'pick') return;
    if (!this.canCommand()) return this.cancelIssue();
    // 메뉴가 떠 있는 동안 기지를 잃었으면(서버는 NOT_OWNED_BASE) 그 지점의 가장 가까운 내 기지로 바꾼다
    const base = this.isMyBase(is.base) ? is.base : this.nearestBaseFor(is.anchor);
    if (base === null) return this.cancelIssue();
    this.store.issueFlag(u, this.troopsToSend(u), is.anchor, base);
    this.ix.issue = null;
    this.ix.bump();
  }

  private onTouch(e: TouchEvent, phase: 'start' | 'move' | 'end'): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const prev = new Map(this.touches);
    for (const t of Array.from(e.changedTouches)) {
      if (phase === 'end') this.touches.delete(t.identifier);
      else this.touches.set(t.identifier, { x: t.clientX - r.left, y: t.clientY - r.top });
    }
    if (phase === 'start') {
      this.touchMoved = false;
      this.pinchDist = 0;
    }
    const pts = [...this.touches.values()];
    if (phase === 'move' && pts.length === 1) {
      const id = [...this.touches.keys()][0];
      const before = prev.get(id);
      if (before) {
        const dx = pts[0].x - before.x;
        const dy = pts[0].y - before.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) this.touchMoved = true;
        this.store.setFollowSilently(null);
        panBy(this.renderer.camera, dx, dy);
        this.clamp();
      }
    } else if (pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      if (this.pinchDist > 0) zoomAt(this.renderer.camera, mx, my, d / this.pinchDist);
      this.pinchDist = d;
      this.touchMoved = true;
      this.clamp();
    }
    if (phase === 'end' && this.touches.size === 0 && !this.touchMoved) {
      const t = e.changedTouches[0];
      if (t) {
        // 탭 = 깃발 선택만 (모바일은 관전·간단 보기 — 명령은 PC)
        this.ix.selectedFlagId = this.renderer.flagAt(t.clientX - r.left, t.clientY - r.top);
        this.ix.bump();
      }
    }
  }

  /**
   * 좌클릭 (드래그 아님) — 테스트에서도 직접 호출. alt = Alt+클릭 (깃발이 겹친 내 기지를 출전 기지로 고를 때)
   * 우선순위: 삼각 메뉴(캔버스 클릭 = 바깥 = 취소) > 기지→커서 화살표(지점 확정) > Alt+내 기지(출전 기지)
   *          > 깃발 선택 > 선택 해제 > 내 기지(화살표 시작) > 지점(최근접 기지 + 삼각 메뉴)
   */
  click(sx: number, sy: number, alt = false): void {
    const tile = this.pixelToTileId(sx, sy);
    const is = this.ix.issue;
    // 삼각 메뉴 버튼은 DOM 이라 캔버스 클릭으로 오지 않는다 → 여기 오면 바깥 클릭
    if (is?.phase === 'pick') return this.cancelIssue();
    if (is?.phase === 'aim') {
      if (tile < 0 || !this.canCommand() || tile === is.base) return this.cancelIssue(); // 같은 기지 다시 클릭 = 취소
      if (alt && this.isMyBase(tile)) return this.beginAim(tile); // Alt+다른 내 기지 = 출발 기지 바꾸기
      return this.beginPick(tile, is.base);
    }
    const sel = this.ix.selectedFlagId;
    // 2026-10-14: 선택 깃발 + 기지 좌클릭(귀환/재지정)은 폐기 — 이동은 우클릭(moveSelectedTo), 귀환은 [귀환] 버튼·R
    if (alt && this.isMyBase(tile)) return this.beginAim(tile);
    const hit = this.renderer.flagAt(sx, sy);
    if (hit !== null) {
      this.ix.selectedFlagId = hit;
      this.ix.bump();
      return;
    }
    if (sel !== null) {
      this.ix.selectedFlagId = null;
      this.ix.bump();
      return;
    }
    if (tile < 0 || !this.canCommand()) return;
    if (this.isMyBase(tile)) return this.beginAim(tile);
    this.beginPick(tile, null);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.ix.issue) return this.cancelIssue(); // 출전 중 우클릭 = 취소
    const p = this.local(e);
    this.rightClickTile(this.pixelToTileId(p.x, p.y));
  }

  /**
   * 우클릭 라우팅 (테스트에서도 직접 호출). 내 깃발이 선택돼 있으면 어디든 "이동" — 내 기지도 귀환이 아니라 기지 위 방어.
   * 반환: 보낸 명령 종류 (없으면 null)
   */
  rightClickTile(tile: number): 'move' | null {
    if (this.ix.issue) {
      this.cancelIssue();
      return null;
    }
    const id = this.ix.selectedFlagId;
    if (tile < 0 || !this.myFlag(id) || !this.canCommand()) return null;
    const f = this.store.game!.flags.get(id!)!;
    if (f.state === 'RETURNING') {
      this.store.toast('귀환 중 — 취소할 수 없습니다', 'info', 1800);
      return null;
    }
    this.store.moveFlag(id!, tile);
    return 'move';
  }

  /** 깃발 선택 + 카메라를 그 깃발로 (병력 바 위 내 부대 칩) */
  focusFlag(id: number): void {
    const g = this.store.game;
    const f = g?.flags.get(id);
    if (!f) return;
    this.ix.selectedFlagId = id;
    if (this.ix.issue) this.ix.issue = null;
    const topo = this.renderer.topo;
    const w = this.renderer.flagWorld.get(id) ?? topo?.tileCenter(f.posTileId);
    if (w) {
      this.store.setFollowSilently(null);
      this.renderer.camera.cx = w.x;
      this.renderer.camera.cy = w.y;
      this.clamp();
    }
    this.ix.bump();
  }

  /** 선택한 깃발의 화면 위치 (보간 위치 — 떠 있는 [귀환]/[태세 변경] 버튼 자리). 없으면 null */
  selectedFlagScreenPos(): { x: number; y: number } | null {
    const id = this.ix.selectedFlagId;
    if (id === null) return null;
    const f = this.store.game?.flags.get(id);
    const topo = this.renderer.topo;
    if (!f || !topo) return null;
    const w = this.renderer.flagWorld.get(id) ?? topo.tileCenter(f.posTileId);
    return worldToScreen(this.renderer.camera, w.x, w.y);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    zoomAt(this.renderer.camera, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    this.clamp();
    this.refreshHover();
  }

  setRatio(r: number): void {
    this.ix.ratio = Math.round(Math.min(1, Math.max(0.1, r)) * 10) / 10;
    this.ix.bump();
  }

  /** V: 이동 방향 화살표 모두 → 내 깃발만 → 숨기기 */
  toggleDirections(): void {
    this.setOptions({ directions: nextDirectionMode(this.ix.options.directions) });
  }

  setColorblind(on: boolean): void {
    this.setOptions({ colorblind: on });
  }

  /** 옵션 일부 변경 + 저장 (저장 실패 = 이번 세션만) */
  setOptions(patch: Partial<GameOptions>): void {
    this.ix.options = { ...this.ix.options, ...patch, tooltipFields: { ...this.ix.options.tooltipFields, ...patch.tooltipFields } };
    saveOptions(this.ix.options);
    this.ix.bump();
  }

  toggleOptions(open = !this.ix.optionsOpen): void {
    this.ix.optionsOpen = open;
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
      case '2':
      case '3':
        // 삼각 메뉴가 떠 있을 때만 병종 선택 (기존 "병종 키 → 클릭" 흐름은 v4.2 출전 UI 로 대체)
        if (this.ix.issue?.phase === 'pick') this.chooseUnit((Number(k) - 1) as Unit);
        return;
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
      case 'v':
        return this.toggleDirections();
      case 't':
        this.ix.panel = this.ix.panel === 'tech' ? null : 'tech';
        if (this.ix.panel !== 'tech') this.ix.techDetail = null;
        this.ix.bump();
        return;
      case 'p':
        this.ix.panel = this.ix.panel === 'ally' ? null : 'ally';
        this.ix.bump();
        return;
      case 'c':
        this.setColorblind(!this.ix.colorblind);
        return;
      case 'o':
        return this.toggleOptions();
      case '?':
      case '/':
        this.ix.helpOpen = !this.ix.helpOpen;
        this.ix.bump();
        return;
      case 'escape':
        // 테크 창: 상세 패널이 열려 있으면 그것만 먼저 닫는다
        if (this.ix.panel === 'tech' && this.ix.techDetail !== null && !this.ix.helpOpen && !this.ix.optionsOpen && !this.ix.leaveConfirm) {
          this.ix.techDetail = null;
          this.ix.bump();
          return;
        }
        if (this.ix.helpOpen || this.ix.optionsOpen || this.ix.panel || this.ix.leaveConfirm) {
          this.ix.helpOpen = false;
          this.ix.optionsOpen = false;
          this.ix.panel = null;
          this.ix.techDetail = null;
          this.ix.leaveConfirm = false;
        } else if (this.ix.issue) {
          this.ix.issue = null;
        } else {
          this.ix.selectedFlagId = null;
        }
        this.ix.bump();
        return;
    }
  }
}
