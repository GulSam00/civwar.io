/**
 * 인게임 입력 — 마우스/키보드 → 카메라 조작 또는 서버 명령(의도).
 *
 * 조작 (2026-10-22 사용자 확정 — 우클릭 병종 고리 · 좌클릭 정보 카드. 삼각 메뉴·우클릭 둘레 메뉴는 폐기):
 *   우클릭 (내 부대 선택 없음) = 그 칸에 바로 출전: 칸 둘레에 창·검·기 병종 고리가 뜬다 → 하나 고르면 가장 가까운 내 기지에서
 *                   발령 (고리 가운데 클릭·F = 방어/공격 선택, 처음 값은 내 땅 = 방어·적·중립 = 공격, originBaseTileId = 하이라이트 기지). 쓸 수 없으면 병종마다 점선 + 이유 툴팁.
 *   내 기지 클릭  → 기지에서 커서까지 경로 화살표가 따라옴 → 지점 클릭 → 같은 병종 고리 → 그 기지에서 발령
 *                   (조준 중 그 기지 자신을 다시 클릭 = 그 기지에 수비 배치 — 고리는 방어 태세. 기지 위에 깃발이 겹쳐 있으면 Alt+클릭으로 기지를 고른다)
 *   1/2/3        병종 고리가 떠 있을 때 병종 선택 (창/검/기)
 *   바깥 클릭 · 다시 우클릭 · Esc = 출전 취소 (고리 닫기)
 *   Q/E, [/]     발령 비율 −/+10% (하단 바)
 *   좌클릭 순서   내 깃발 = 선택 (내·적·동맹 모두 — 우측 정보 패널) → 깃발 선택 중이면 선택 해제 → 내 기지(깃발 없음) = 조준 시작
 *                 → 누군가의 영토 = 그 플레이어 정보 카드 (동맹·이모트·따라가기는 카드에) → 중립·물 = 아무 일 없음
 *   내 깃발 선택 + 우클릭 = 항상 이동 (2026-10-14). 방어 깃발 + 적·중립 땅 = 공격으로 자동 전환, 그 밖엔 태세 그대로 (v5.6)
 *                 (예전 "선택 + 내 기지 좌클릭 = 귀환"은 폐기 — 귀환은 선택 부대 옆 [귀환] 버튼 / R)
 *   F          선택 깃발 태세 전환 (병종 고리가 떠 있으면 출전 태세 선택)      R  선택 깃발 회수(자동 귀환지)      Tab  내 깃발 순환
 *   Esc        취소 · 선택 해제        H  내 수도로        0  맵 전체
 *   T 테크 · P 외교 · O 옵션 창 · C 색각 보조 · V 이동 방향 화살표(모두→내 것만→숨김) · ? 도움말 (React 패널 — Interaction 플래그)
 *   드래그(좌·가운데) / WASD·방향키 = 이동, 휠 = 줌, 터치 = 한 손가락 이동 · 두 손가락 확대
 *   관전: 순위표에서 플레이어를 누르면 따라가기, 드래그하면 자유 카메라
 */
import { POSTURE, techConvertPm, type ServerMessage, type Unit } from '@civwar/shared';
import { panBy, screenToWorld, worldToScreen, zoomAt, clampCamera } from '../render/camera.js';
import type { GameRenderer } from '../render/renderer.js';
import type { ClientStore } from '../state/store.js';
import { troopsForRatio } from './preview.js';
import { RouteCache, computeRoute, type RoutePreview } from './route.js';
import { defaultOptions, nextDirectionMode, saveOptions, type GameOptions } from '../ui/options.js';
import { techStatsOf, unitCombatStats } from '../ui/techInfo.js';
import { RangeCache, computePreview } from './preview.js';
import { unitRingModel, type RingModel } from './unitRing.js';
import { baseWaitTicks, pickIssueOrigin, ticksToSec, type OriginPick } from './origin.js';

export type IssuePosture = 'attack' | 'defend' | 'blocked';

/** v5.1 (QA m-1): 보낸 기지 임시 쿨타임의 안전 만료 — 응답(cmd_ack·flag_issued)이 끝내 안 올 때만 쓴다 (25 tick = 5초) */
export const SENT_SAFETY_TICKS = 25;

/**
 * 출전(발령) 진행 상태.
 *  aim  : 기지를 골랐고 목적지를 기다리는 중 (기지 → 커서 화살표)
 *  pick : 목적지까지 정해졌고 병종 고리에서 병종을 고르는 중 (base = 출발 기지 — 우클릭인데 내 기지가 없으면 null)
 */
export type IssueState = { phase: 'aim'; base: number } | { phase: 'pick'; base: number | null; anchor: number; posture: IssuePosture };

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
  /** 플레이어 정보 카드 (2026-10-18) — 열린 플레이어 id, null = 닫힘 */
  cardPlayerId: number | null = null;
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
  private range = new RangeCache();
  /** v5.1: 지금 열린 고리의 출발 기지를 직접 고르지 않았다(우클릭) — 쿨타임이 바뀌면 출발 기지를 다시 고른다 */
  private autoOrigin = false;
  /**
   * v5.1: 방금 발령을 보낸 기지 → { 예상 준비 tick, 보낸 tick, clientSeq } — 응답 전 연타로 같은 기지를 다시 고르지 않게 (QA m-1·m-2).
   * 그 발령의 flag_issued(출발 기지 = 이 기지)가 오면 서버 값이 모델에 들어오므로 지운다. 거절 cmd_ack 면 곧바로 지운다.
   * 수락 cmd_ack 는 flag_issued 보다 먼저 올 수 있어 지우지 않는다. 응답이 끝내 없으면 SENT_SAFETY_TICKS 뒤 버린다.
   */
  private sentFrom = new Map<number, { ready: number; sent: number; seq: number }>();
  private unobserve: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly renderer: GameRenderer,
    private readonly store: ClientStore,
    readonly ix: Interaction,
  ) {
    this.unobserve = store.observe((m) => this.onServerMessage(m));
  }

  /** v5.1 (QA m-1·m-2): 보낸 기지 임시 쿨타임 해제 — 그 발령의 거절 cmd_ack, 또는 그 기지에서 나간 내 flag_issued */
  private onServerMessage(m: ServerMessage): void {
    if (!this.sentFrom.size) return;
    if (m.type === 'cmd_ack') {
      if (m.accepted) return;
      for (const [b, v] of this.sentFrom) if (v.seq === m.clientSeq) this.sentFrom.delete(b);
    } else if (m.type === 'flag_issued') {
      if (m.playerId === this.store.myPlayerId) this.sentFrom.delete(m.originTileId);
    }
  }

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
    this.unobserve?.();
    this.unobserve = null;
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

  /** v5.1: 방금 보낸 발령의 기지 (응답 전 임시 표시 — onServerMessage 가 지우고, 응답이 없으면 SENT_SAFETY_TICKS 뒤 버린다) */
  private localBusy(): Map<number, number> | null {
    const g = this.store.game;
    if (!g || !this.sentFrom.size) return null;
    const out = new Map<number, number>();
    for (const [b, v] of this.sentFrom) {
      if (g.tick > v.sent + SENT_SAFETY_TICKS) this.sentFrom.delete(b);
      else out.set(b, v.ready);
    }
    return out;
  }

  /**
   * v5.1 (GDD 4.2, §37.2 ④): 출발 기지를 생략했을 때 서버가 고를 기지 — shared pickOriginBase(쿨타임 아닌 내 기지 중 토폴로지 거리 최소, 동률 tileId ASC).
   * 모두 쿨타임이면 base = null, drawBase = 쿨타임 무시 최근접 (화살표용), waitTicks = 가장 먼저 준비되는 기지까지.
   */
  originFor(anchor: number): OriginPick | null {
    const g = this.store.game;
    const me = this.store.myPlayerId;
    const topo = this.renderer.topo;
    if (!g || me === null || !topo || anchor < 0) return null;
    return pickIssueOrigin(g, topo, me, anchor, this.localBusy());
  }

  /** 우클릭 출전의 출발 기지 (쿨타임 아닌 최근접 — 모두 쿨타임이면 쿨타임 무시 최근접). 내 기지가 없으면 null */
  nearestBaseFor(anchor: number): number | null {
    return this.originFor(anchor)?.drawBase ?? null;
  }

  /** 지점의 기본 태세 (내 땅 = 방어, 적·중립 = 공격, 물·동맹 = 불가) — 병종 고리의 처음 선택값. 실제 태세는 cmd_flag_issue 가 보낸다 */
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
    if (!g || me === null || !topo || !g.terrain || !is || is.base === null) return null;
    const anchor = is.phase === 'aim' ? this.ix.hoverTile : is.anchor;
    if (anchor < 0) return null;
    // 방어 태세만 §22.12 적 땅 회피 경로 (불가 지점은 공격 경로로 '도달 불가' 표시 — 기존과 같다)
    const attack = (is.phase === 'pick' ? is.posture : this.postureAt(anchor)) !== 'defend';
    // 방어 경로는 소유·동맹에 달려 있다 → 소유 변경(ownersVersion·tick)·동맹 수로 다시 계산
    const key = `${is.base}:${anchor}:${attack}:${g.ownersVersion}:${g.tick}:${g.alliances.size}`;
    if (key !== this.routeKey) {
      const field = this.routes.fieldFor(g, topo, anchor);
      this.route = computeRoute(g, topo, field, me, is.base, anchor, attack);
      this.routeKey = key;
    }
    return this.route;
  }

  /** 병종 고리의 화면 위치 (확정 지점 칸 중심 — 카메라를 따라간다) */
  pickScreenPos(): { x: number; y: number } | null {
    const is = this.ix.issue;
    const topo = this.renderer.topo;
    if (!is || is.phase !== 'pick' || !topo) return null;
    const c = topo.tileCenter(is.anchor);
    return worldToScreen(this.renderer.camera, c.x, c.y);
  }

  /** 출전 취소 (병종 고리 닫기 포함) */
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

  /**
   * 목적지 확정 → 병종 고리. base 가 없으면 가장 가까운 내 기지 (그것도 없으면 고리는 뜨되 전부 "출전할 내 기지가 없습니다").
   * 명령할 수 없으면(관전·탈락·종료 후) 열지 않는다.
   */
  beginPick(anchor: number, base: number | null): boolean {
    const g = this.store.game;
    if (!g?.ready || !this.canCommand() || anchor < 0 || anchor >= g.tileCount) return false;
    const b = base ?? this.nearestBaseFor(anchor);
    this.autoOrigin = base === null;
    this.ix.issue = { phase: 'pick', base: b, anchor, posture: this.postureAt(anchor) };
    this.ix.selectedFlagId = null;
    this.ix.bump();
    return true;
  }

  /** 지금 열린 병종 고리의 내용 (닫혀 있으면 null). 매번 모델에서 다시 만든다 — 서버 상태가 바뀌면 바로 반영 */
  ringModel(): RingModel | null {
    const is = this.ix.issue;
    const g = this.store.game;
    if (!is || is.phase !== 'pick' || !g) return null;
    const me = this.store.myPlayerId;
    const topo = this.renderer.topo;
    const canCmd = this.canCommand();
    const preview = canCmd && me !== null && topo && g.terrain ? computePreview(g, topo, me, is.anchor, this.range.get(g, topo, me)) : null;
    // v5.1 출전 쿨타임: 우클릭(자동) = 지금 쿨타임으로 출발 기지를 다시 고른다 (서버와 같은 함수), 직접 고른 기지 = 쿨타임이면 비활성
    let cooldown: string | null = null;
    let skippedNearer = false;
    if (this.autoOrigin) {
      const o = this.originFor(is.anchor);
      if (o && is.base !== o.drawBase) is.base = o.drawBase; // 표시용 상태 — 화살표·하이라이트가 따라간다
      if (o && o.base === null && o.hasBase) cooldown = `모든 기지가 출전 준비 중입니다 (${ticksToSec(g, o.waitTicks)}초 뒤 가능)`;
      skippedNearer = !!o && o.base !== null && o.nearest !== null && o.nearest !== o.base;
    } else if (is.base !== null) {
      const w = baseWaitTicks(g, is.base, this.localBusy());
      if (w > 0) cooldown = `이 기지는 출전 준비 중입니다 (${ticksToSec(g, w)}초 뒤 가능)`;
    }
    return unitRingModel({
      cooldown,
      skippedNearer,
      g,
      tile: is.anchor,
      me,
      spectating: this.store.spectating,
      canCommand: canCmd,
      base: is.base,
      posture: is.posture,
      preview,
      troopsFor: (u) => this.troopsToSend(u),
    });
  }

  /** 병종 선택 → 발령 (cmd_flag_issue, originBaseTileId = 하이라이트 기지). 쓸 수 없는 병종이면 이유를 알리고 고리를 유지 */
  chooseUnit(u: Unit): void {
    const is = this.ix.issue;
    if (!is || is.phase !== 'pick') return;
    if (!this.canCommand()) return this.cancelIssue();
    // 고리가 떠 있는 동안 기지를 잃었으면(서버는 NOT_OWNED_BASE) 그 지점의 출발 기지를 다시 고른다 (v5.1: 쿨타임 아닌 최근접)
    if (!this.autoOrigin && !(is.base !== null && this.isMyBase(is.base))) this.autoOrigin = true;
    const base = this.autoOrigin ? this.nearestBaseFor(is.anchor) : is.base;
    if (base !== is.base) {
      this.ix.issue = { ...is, base };
      this.ix.bump();
    }
    const item = this.ringModel()?.units.find((x) => x.unit === u);
    if (item?.disabled) {
      this.store.toast(item.reason ?? '지금은 보낼 수 없습니다', 'error', 2000);
      return;
    }
    if (base === null) return this.cancelIssue();
    // 출발 기지는 미리보기와 같은 기지를 지정해 보낸다 (화살표 = 실제 경로). 서버가 그 사이 쿨타임이면 BASE_COOLDOWN → 토스트
    const seq = this.store.issueFlag(u, this.troopsToSend(u), is.anchor, is.posture === 'defend' ? POSTURE.DEFEND : POSTURE.ATTACK, base);
    const g = this.store.game;
    if (g && seq >= 0) this.sentFrom.set(base, { ready: g.tick + 1 + g.dispatchCooldownTicks, sent: g.tick, seq });
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

  /** 칸 주인 (육지가 아니거나 주인 없음 = 0) */
  ownerAt(tile: number): number {
    const g = this.store.game;
    if (!g?.ready || tile < 0 || tile >= g.tileCount || !g.isLand(tile)) return 0;
    return g.owners[tile];
  }

  /**
   * 좌클릭 (드래그 아님) — 테스트에서도 직접 호출. alt = Alt+클릭 (깃발이 겹친 내 기지를 출전 기지로 고를 때)
   * 우선순위: 병종 고리(캔버스 클릭 = 바깥 = 취소) > 기지→커서 화살표(지점 확정 → 고리 · 그 기지 자신 = 수비 배치) > Alt+내 기지(출전 기지)
   *          > 깃발 클릭(내 것·남의 것 선택) > 선택 해제 > 내 기지(화살표 시작) > 누군가의 영토(그 플레이어 정보 카드) > 중립·물(없음)
   */
  click(sx: number, sy: number, alt = false): void {
    const tile = this.pixelToTileId(sx, sy);
    const is = this.ix.issue;
    // 병종 고리 버튼은 DOM 이라 캔버스 클릭으로 오지 않는다 → 여기 오면 바깥 클릭 (그 클릭은 다른 동작을 하지 않는다)
    if (is?.phase === 'pick') return this.cancelIssue();
    if (is?.phase === 'aim') {
      if (tile < 0 || !this.canCommand()) return this.cancelIssue();
      if (alt && tile !== is.base && this.isMyBase(tile)) return this.beginAim(tile); // Alt+다른 내 기지 = 출발 기지 바꾸기
      // 출발 기지 자신을 다시 클릭 = 그 기지에 수비 배치 (고리는 방어 태세, 앵커·출발 = 그 기지)
      return void this.beginPick(tile, is.base);
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
    if (tile < 0) return;
    if (this.canCommand() && this.isMyBase(tile)) return this.beginAim(tile);
    // 2026-10-22: 누군가의 영토(나 포함) = 그 플레이어 정보 카드. 중립·물 = 아무 일 없음 (지형은 커서 툴팁이 보여 준다)
    const owner = this.ownerAt(tile);
    if (owner > 0) {
      this.ix.cardPlayerId = owner;
      this.ix.bump();
    }
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.ix.issue) return void this.rightClickTile(-1); // 병종 고리 닫기 · 출전 취소 (좌표 불필요)
    const p = this.local(e);
    this.rightClickTile(this.pixelToTileId(p.x, p.y));
  }

  /**
   * 우클릭 라우팅 (테스트에서도 직접 호출).
   *  병종 고리·조준 중 → 닫기/취소 (두 번째 우클릭)
   *  내 깃발 선택 → 어디든 "이동" (2026-10-14) — 내 기지도 귀환이 아니라 기지 위 방어
   *  그 외(선택 없음·남의 깃발 선택) → 그 칸에 바로 출전하는 병종 고리 (2026-10-22). 내 기지 칸이면 그 기지에 수비 배치
   * 반환: 'move' = 이동 명령을 보냄, 'ring' = 병종 고리를 염, null = 아무것도 안 함(닫기·취소·관전 포함)
   */
  rightClickTile(tile: number): 'move' | 'ring' | null {
    if (this.ix.issue) {
      this.cancelIssue();
      return null;
    }
    const id = this.ix.selectedFlagId;
    if (!this.myFlag(id)) return this.beginPick(tile, null) ? 'ring' : null;
    if (tile < 0 || !this.canCommand()) return null;
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

  /** v5.6: 병종 고리의 출전 태세 바꾸기 (가운데 클릭·F) */
  toggleIssuePosture(): void {
    const is = this.ix.issue;
    if (is?.phase !== 'pick' || is.posture === 'blocked' || !this.canCommand()) return;
    this.ix.issue = { ...is, posture: is.posture === 'attack' ? 'defend' : 'attack' };
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
    if (this.ix.issue) this.ix.issue = null;
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
        // 병종 고리가 떠 있을 때만 병종 선택
        if (this.ix.issue?.phase === 'pick') this.chooseUnit((Number(k) - 1) as Unit);
        return;
      case 'q':
      case '[':
        return this.setRatio(this.ix.ratio - 0.1);
      case 'e':
      case ']':
        return this.setRatio(this.ix.ratio + 0.1);
      case 'f':
        return this.ix.issue?.phase === 'pick' ? this.toggleIssuePosture() : this.togglePosture();
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
        // 병종 고리가 떠 있으면 그것만 닫는다 (가장 위에 뜬 것부터)
        if (this.ix.issue?.phase === 'pick') return this.cancelIssue();
        // 테크 창: 상세 패널이 열려 있으면 그것만 먼저 닫는다
        if (this.ix.panel === 'tech' && this.ix.techDetail !== null && !this.ix.helpOpen && !this.ix.optionsOpen && !this.ix.leaveConfirm) {
          this.ix.techDetail = null;
          this.ix.bump();
          return;
        }
        if (this.ix.helpOpen || this.ix.optionsOpen || this.ix.panel || this.ix.leaveConfirm || this.ix.cardPlayerId !== null) {
          this.ix.cardPlayerId = null;
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
