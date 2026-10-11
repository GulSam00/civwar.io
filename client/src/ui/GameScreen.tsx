import { useEffect, useRef, useState } from 'react';
import { ENDGAME_RUSH_TICK, POSTURE, techShallowPm, type Unit } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameModel } from '../state/gameModel.js';
import { GameRenderer } from '../render/renderer.js';
import type { TopologyView } from '../render/topology.js';
import { clampCamera } from '../render/camera.js';
import { GameInputController, Interaction } from '../input/controller.js';
import { RangeCache, computePreview, type CursorPreview } from '../input/preview.js';
import type { RoutePreview } from '../input/route.js';
import { terrainInfo, visibleTipRows } from './terrainInfo.js';
import { TOOLTIP_FIELDS, loadOptions } from './options.js';
import { OptionsLayer, GearIcon } from './OptionsPanel.js';
import { UnitIcon } from './unitIcons.js';
import { detectRule, nextFlagExtraPm, type UpkeepRule } from './upkeep.js';
import { usePolled } from './hooks.js';
import { playerColor } from '../render/palette.js';
import { EMOTE_TEXT, FLAG_STATE_NAME, GAME_OVER_REASON, POSTURE_NAME, UNIT_NAME, fmtClock } from './text.js';
import { goldPerSecond, techStatsOf } from './techInfo.js';
import { DiplomacyPanel, EventFeed, IncomingProposals, Scoreboard, TechPanel } from './panels.js';
import { Help } from './Help.js';

/** 좁은 화면(모바일) = 관전·간단 보기 (PC 우선 결정) */
function useNarrow(): boolean {
  const q = '(max-width: 760px), (pointer: coarse)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** 따라가기 목표: 그 플레이어의 수도(소유 중이면) 아니면 영토 무게중심 */
function followTarget(g: GameModel, topo: TopologyView, id: number): { x: number; y: number } | null {
  const sp = g.spawns.find((s) => s.playerId === id);
  if (sp && g.owners[sp.homeTileId] === id) return topo.tileCenter(sp.homeTileId);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let t = 0; t < g.tileCount; t++) {
    if (g.owners[t] !== id) continue;
    const c = topo.tileCenter(t);
    sx += c.x;
    sy += c.y;
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/**
 * 인게임 화면. Canvas 렌더 루프(rAF)는 마운트 시 1회 시작하고, 상태는 store.game 을 매 프레임 읽는다.
 * React 는 HUD 패널만 주기적으로 다시 그린다.
 */
export function GameScreen({ store }: { store: ClientStore }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const radialRef = useRef<HTMLDivElement>(null);
  const terrainRef = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<GameInputController | null>(null);
  const narrow = useNarrow();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new GameRenderer(canvas);
    const ix = new Interaction();
    ix.options = loadOptions(); // 실패하면 기본값 (ui/options.ts)
    const controller = new GameInputController(canvas, renderer, store, ix);
    controller.attach();
    setCtl(controller);
    const range = new RangeCache();
    let frame = 0;
    let last = performance.now();
    let followAt = 0;
    let followGoal: { x: number; y: number } | null = null;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      controller.tick(dt);
      const game = store.game;
      const me = store.myPlayerId;
      if (ix.selectedFlagId !== null && !game?.flags.has(ix.selectedFlagId)) {
        ix.selectedFlagId = null;
        ix.bump();
      }
      // 관전 따라가기 (자유 카메라 조작 시 해제 — controller)
      if (game?.ready && renderer.topo && store.followPlayerId !== null) {
        if (now - followAt > 500) {
          followGoal = followTarget(game, renderer.topo, store.followPlayerId);
          followAt = now;
        }
        if (followGoal) {
          const k = Math.min(1, dt / 250);
          renderer.camera.cx += (followGoal.x - renderer.camera.cx) * k;
          renderer.camera.cy += (followGoal.y - renderer.camera.cy) * k;
          clampCamera(renderer.camera, renderer.topo.worldWidth, renderer.topo.worldHeight);
        }
      }
      let preview: CursorPreview | null = null;
      const canCmd = controller.canCommand();
      if (!canCmd && ix.issue) controller.cancelIssue();
      // 예고 대상 칸: 삼각 메뉴 = 확정 지점, 기지→커서 화살표 = 커서, 내 깃발 선택 = 커서(우클릭 재지정)
      const pv = ix.issue?.phase === 'pick' ? ix.issue.anchor : ix.issue?.phase === 'aim' || controller.myFlag(ix.selectedFlagId) ? ix.hoverTile : -1;
      if (game && me !== null && renderer.topo && canCmd && pv >= 0) {
        preview = computePreview(game, renderer.topo, me, pv, range.get(game, renderer.topo, me));
      }
      const route = canCmd ? controller.currentRoute() : null;
      const routeKind = ix.issue ? (ix.issue.phase === 'pick' ? ix.issue.posture : preview ? (preview.kind as 'attack' | 'defend' | 'blocked') : null) : null;
      renderer.frame(
        game,
        {
          me: store.viewerId,
          selectedFlagId: ix.selectedFlagId,
          hoverTile: ix.hoverTile,
          preview,
          issueBase: ix.issue?.base ?? null,
          route,
          routeKind,
          colorblind: ix.colorblind,
          directions: ix.options.directions,
          emotes: store.emotes,
          emoteText: (c) => EMOTE_TEXT[c] ?? `#${c}`,
          nicknameOf: (id) => store.nicknameOf(id),
        },
        now,
      );
      if (miniRef.current) renderer.drawMinimap(miniRef.current, game, store.viewerId);
      updateTooltip(tipRef.current, preview, ix, controller, route);
      positionRadial(radialRef.current, controller);
      updateTerrainTip(terrainRef.current, game, ix, store);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      controller.dispose();
    };
    // 루프는 마운트 시 1회만 — store 는 앱 수명 동안 같다
  }, [store]);

  // 미니맵 클릭·드래그 → 카메라 이동
  const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ctl || (e.type === 'pointermove' && e.buttons !== 1)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const renderer = ctl.renderer;
    const w = renderer.minimapToWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    renderer.camera.cx = w.x;
    renderer.camera.cy = w.y;
    if (renderer.topo) clampCamera(renderer.camera, renderer.topo.worldWidth, renderer.topo.worldHeight);
    store.setFollowSilently(null);
  };

  return (
    <div className={`game ${narrow ? 'narrow' : ''}`}>
      <canvas ref={canvasRef} className="game-canvas" />
      <div ref={tipRef} className="cursor-tip" />
      <div ref={terrainRef} className="terrain-tip" aria-hidden="true" />
      <div ref={radialRef} className="radial-anchor">
        {ctl && <IssueRadial store={store} ctl={ctl} />}
      </div>
      <canvas ref={miniRef} className="minimap" onPointerDown={onMini} onPointerMove={onMini} title="클릭해 이동" />
      {ctl && <Hud store={store} ctl={ctl} narrow={narrow} />}
      {ctl && <Scoreboard store={store} ctl={ctl} compact={narrow} />}
      {ctl && !narrow && <EventFeed store={store} />}
      {ctl && !narrow && <CommandBar store={store} ctl={ctl} />}
      {ctl && <FlagPanel store={store} ctl={ctl} narrow={narrow} />}
      {ctl && !narrow && <TechPanel store={store} ctl={ctl} />}
      {ctl && !narrow && <DiplomacyPanel store={store} ctl={ctl} />}
      {ctl && !narrow && <IncomingProposals store={store} ctl={ctl} />}
      {ctl && <HelpLayer ctl={ctl} />}
      {ctl && <OptionsLayer ctl={ctl} />}
      {store.game && (store.game.gameOver || store.room?.phase === 'GAME_OVER') && <GameOverOverlay store={store} game={store.game} />}
      {ctl && <LeaveDialog store={store} ctl={ctl} />}
      {store.reconnecting && <div className="banner">연결이 끊겼습니다 — 다시 연결하는 중…</div>}
    </div>
  );
}

function HelpLayer({ ctl }: { ctl: GameInputController }) {
  usePolled(() => ctl.ix.version, 120);
  if (!ctl.ix.helpOpen) return null;
  return (
    <Help
      onClose={() => {
        ctl.ix.helpOpen = false;
        ctl.ix.bump();
      }}
    />
  );
}

/**
 * 지형 정보 툴팁 — 맵 캔버스 위 칸에서만(HUD·패널 위 제외), 커서 왼쪽 위에 둔다(출전 안내 툴팁은 오른쪽 아래).
 * 삼각 메뉴가 떠 있는 동안은 숨긴다(메뉴·경로를 가리지 않게).
 */
function updateTerrainTip(el: HTMLDivElement | null, game: GameModel | null, ix: Interaction, store: ClientStore): void {
  if (!el) return;
  const hide = () => {
    if (el.style.display !== 'none') el.style.display = 'none';
    el.dataset.key = '';
  };
  if (!game?.ready || !ix.options.tooltip || !ix.overMap || ix.hoverTile < 0 || ix.issue?.phase === 'pick') return hide();
  const viewer = store.viewerId;
  // v4.3: 얕은 물 이동배율 ‰ (보는 플레이어의 MOB-2B 반영)
  const tier = techShallowPm(techStatsOf(viewer !== null ? (game.players.get(viewer)?.techMask ?? 0) : 0, game.config.constants));
  const t = ix.hoverTile;
  const b = game.bases.get(t);
  const o = ix.options;
  const fieldsKey = TOOLTIP_FIELDS.map((f) => (o.tooltipFields[f] ? 1 : 0)).join('');
  const key = `${t}:${game.owners[t]}:${b ? Math.round(b.hpPct) : ''}:${tier}:${fieldsKey}`;
  if (el.dataset.key !== key) {
    const info = terrainInfo(game, t, store.myPlayerId, tier, (id) => store.nicknameOf(id));
    const rows = info ? visibleTipRows(info, o.tooltip, o.tooltipFields) : [];
    if (!info || !rows.length) return hide();
    el.dataset.key = key;
    // 한 줄에 한 항목 (flex column): 지형 → 보정들 → 소유자 → 기지 체력
    el.replaceChildren(
      ...rows.map((r) => {
        const row = document.createElement('div');
        row.className = `tt-row tt-${r.field}`;
        if (r.field === 'terrain') {
          const name = document.createElement('b');
          name.textContent = r.value;
          row.append(name);
          return row;
        }
        const k = document.createElement('span');
        k.className = 'tt-k';
        k.textContent = r.label;
        const v = document.createElement('span');
        v.className = 'tt-v';
        if (r.field === 'owner' && info.ownerId) {
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = playerColor(info.ownerId);
          v.append(dot);
        }
        v.append(document.createTextNode(r.value));
        row.append(k, v);
        return row;
      }),
    );
  }
  el.style.display = 'flex'; // .terrain-tip = flex column (한 줄에 한 항목)
  const parent = el.parentElement;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = ix.hoverX - 14 - w;
  let y = ix.hoverY - 14 - h;
  if (x < 4) x = ix.hoverX + 16; // 왼쪽 끝이면 오른쪽 위로
  if (y < 64) y = ix.hoverY + 40; // 위쪽 HUD 와 겹치면 커서 아래로
  if (parent) x = Math.min(x, parent.clientWidth - w - 4);
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** 삼각 메뉴를 확정 지점 화면 위치로 (카메라 이동을 매 프레임 따라감) */
function positionRadial(el: HTMLDivElement | null, ctl: GameInputController): void {
  if (!el) return;
  const p = ctl.pickScreenPos();
  if (!p) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
}

function routeText(route: RoutePreview | null, kind: string | undefined): string {
  if (!route) return '';
  if (!route.reachable) return ' · 갈 수 있는 경로 없음';
  const steps = route.path.length - 1;
  return kind === 'attack' ? ` · 경로 ${steps}칸 · 옆 칸 ${route.corridor.length}개 공격` : ` · 경로 ${steps}칸`;
}

function updateTooltip(el: HTMLDivElement | null, p: CursorPreview | null, ix: Interaction, ctl: GameInputController, route: RoutePreview | null): void {
  if (!el) return;
  let text: string | null = null;
  let kind = p?.kind ?? 'info';
  const g = ix.hoverTile;
  if (ix.issue?.phase === 'pick') text = null; // 삼각 메뉴가 안내한다
  else if (ix.issue?.phase === 'aim') {
    if (g === ix.issue.base) {
      text = '같은 기지 다시 클릭 = 취소';
      kind = 'info';
    } else if (p) text = `클릭 = 병종 선택 · ${p.label}${routeText(route, p.kind)}`;
  } else if (ctl.canCommand() && g >= 0) {
    const myFlag = ctl.myFlag(ix.selectedFlagId);
    if (myFlag && ctl.isMyBase(g)) {
      text = '클릭 = 이 기지로 귀환';
      kind = 'defend';
    } else if (myFlag && ctl.isBaseTile(g)) {
      text = '클릭 = 이 기지로 재지정';
      kind = 'attack';
    } else if (myFlag && p && p.kind !== 'blocked') text = `우클릭 재지정 → ${p.label}`;
    else if (myFlag && p) text = p.label;
    else if (!myFlag && ix.selectedFlagId === null && ctl.isMyBase(g)) {
      text = '클릭 = 이 기지에서 출전 (목적지를 고르세요)';
      kind = 'info';
    }
  }
  if (!text) {
    el.style.display = 'none';
    return;
  }
  if (el.textContent !== text) el.textContent = text;
  el.dataset.kind = kind;
  el.style.display = 'block';
  // 화면 오른쪽·아래 끝에서는 커서 반대편으로 뒤집는다
  const parent = el.parentElement;
  const flipX = parent ? ix.hoverX + 16 + el.offsetWidth > parent.clientWidth - 4 : false;
  const flipY = parent ? ix.hoverY + 18 + el.offsetHeight > parent.clientHeight - 4 : false;
  const x = flipX ? ix.hoverX - 12 - el.offsetWidth : ix.hoverX + 16;
  const y = flipY ? ix.hoverY - 12 - el.offsetHeight : ix.hoverY + 18;
  el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

/**
 * 삼각(라디얼) 병종 메뉴 — 확정 지점 둘레에 창(위)·검(왼쪽 아래)·기(오른쪽 아래).
 * 색 = 기본 태세 예고(내 땅 = 방어 푸름, 적·중립 = 공격 붉음, 불가 = 회색). 고르면 cmd_flag_issue.
 */
function IssueRadial({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  const is = ctl.ix.issue;
  if (!is || is.phase !== 'pick') return null;
  const route = ctl.currentRoute();
  const postureLabel = is.posture === 'defend' ? '방어 태세' : is.posture === 'attack' ? '공격 태세' : '지정 불가?';
  return (
    <div className={`radial radial-${is.posture}`} role="menu" aria-label={`병종 선택 · ${postureLabel}`} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => (e.preventDefault(), ctl.cancelIssue())}>
      <div className="radial-center">
        <b>{postureLabel}</b>
        <small>{routeText(route, is.posture).replace(/^ · /, '') || ' '}</small>
      </div>
      {([0, 1, 2] as Unit[]).map((u) => (
        <button
          key={u}
          role="menuitem"
          className={`radial-btn radial-u${u}`}
          onClick={() => ctl.chooseUnit(u)}
          title={`${UNIT_NAME[u]} · 단축키 ${u + 1}`}
          aria-label={`${UNIT_NAME[u]} ${ctl.troopsToSend(u)}명 · 단축키 ${u + 1}`}
        >
          <kbd>{u + 1}</kbd>
          <UnitIcon unit={u} size={22} />
          <small>{ctl.troopsToSend(u)}</small>
        </button>
      ))}
    </div>
  );
}

function Hud({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => (store.game?.version ?? 0) * 7 + store.getVersion() + ctl.ix.version * 131);
  const g = store.game;
  if (!g || !g.ready) return <div className="hud-top">맵을 불러오는 중…</div>;
  const me = store.myPlayerId;
  const viewer = store.viewerId;
  const p = viewer !== null ? g.players.get(viewer) : undefined;
  const msLeft = g.ticksRemaining * g.config.tickMs;
  const share = (tiles: number) => (tiles * 100) / g.config.totalLandTiles;
  const flagsUsed = viewer !== null ? g.flagsOf(viewer).length : 0;
  const rushTick = (g.config.endgameRush?.tick as number | undefined) ?? ENDGAME_RUSH_TICK;
  const spectating = me === null || viewer !== me;
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  const income = p ? goldPerSecond(p.goldWeight, p.techMask, p.upkeepPm, g.config.constants) : null;
  return (
    <div className="hud-top">
      {spectating && <span className="pill spectate-pill">{me !== null && g.players.get(me) && !g.players.get(me)!.alive ? '탈락 · 관전' : '관전'}{p ? ` · ${store.nicknameOf(p.id)}` : ''}</span>}
      {p && (
        <>
          <Stat label="병력" value={`${p.troops.toLocaleString()} / ${g.troopCapOf(p).toLocaleString()}`} />
          <Stat
            label={p.upkeepPm > 0 ? `골드 · 유지비 −${(p.upkeepPm / 10).toFixed(0)}%` : '골드'}
            value={`${p.gold.toLocaleString()}${income ? ` +${income.net.toFixed(1)}/초` : ''}`}
            warn={p.upkeepPm >= 300}
          />
          {!narrow && <Stat label="타일" value={p.tiles.toLocaleString()} />}
          <Stat label="점유율" value={`${share(p.tiles).toFixed(1)}%`} />
          {!narrow && <Stat label="깃발" value={`${flagsUsed} / ${p.flagCap}`} />}
        </>
      )}
      <Stat label="승리 기준" value={`${g.thresholdPct.toFixed(1)}%`} />
      <Stat label="남은 시간" value={fmtClock(msLeft)} warn={g.endgameRushActive} />
      {g.endgameRushActive ? (
        <span className="pill warn-pill">종반 러시</span>
      ) : (
        !narrow && g.tick > rushTick - 1500 && <span className="pill">러시까지 {fmtClock((rushTick - g.tick) * g.config.tickMs)}</span>
      )}
      {g.lockoutDissolveTick !== null && <span className="pill warn-pill">전원 동맹 — 강제 해제 {fmtClock((g.lockoutDissolveTick - g.tick) * g.config.tickMs)}</span>}
      {!narrow && (
        <span className="hud-buttons">
          {!spectating && !over && (
            <>
              <HudBtn on={ctl.ix.panel === 'tech'} k="T" label="테크" onClick={() => ((ctl.ix.panel = ctl.ix.panel === 'tech' ? null : 'tech'), ctl.ix.bump())} />
              <HudBtn on={ctl.ix.panel === 'ally'} k="P" label="외교" onClick={() => ((ctl.ix.panel = ctl.ix.panel === 'ally' ? null : 'ally'), ctl.ix.bump())} />
            </>
          )}
          <OptionsBtn ctl={ctl} />
          <HudBtn on={ctl.ix.helpOpen} k="?" label="도움말" onClick={() => ((ctl.ix.helpOpen = !ctl.ix.helpOpen), ctl.ix.bump())} />
          {!spectating && !over && <EmoteMenu store={store} />}
          <button className="hud-btn leave-btn" onClick={() => requestLeave(store, ctl)}>
            나가기
          </button>
        </span>
      )}
      {narrow && (
        <span className="hud-buttons">
          <OptionsBtn ctl={ctl} />
          <button className="btn btn-sm" onClick={() => ((ctl.ix.helpOpen = true), ctl.ix.bump())}>
            ?
          </button>
          <button className="btn btn-sm" onClick={() => requestLeave(store, ctl)}>
            나가기
          </button>
        </span>
      )}
    </div>
  );
}

/** 살아 있는 플레이어가 진행 중인 판을 떠날 때만 확인 — 탈락자·관전자·종료 후는 바로 나간다 (QA J-1) */
function requestLeave(store: ClientStore, ctl: GameInputController): void {
  const g = store.game;
  const me = store.myPlayerId;
  const aliveInGame = !!g && me !== null && store.room?.phase === 'IN_GAME' && !g.gameOver && (g.players.get(me)?.alive ?? false);
  if (aliveInGame) {
    ctl.ix.leaveConfirm = true;
    ctl.ix.bump();
  } else store.leaveRoom();
}

function LeaveDialog({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version, 120);
  if (!ctl.ix.leaveConfirm) return null;
  const close = () => {
    ctl.ix.leaveConfirm = false;
    ctl.ix.bump();
  };
  return (
    <div className="overlay" onClick={close}>
      <div className="gameover-card leave-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>게임에서 나갈까요?</h2>
        <p>
          내 자리는 연결이 끊긴 상태로 남고, <b>90초 뒤 봇이 대신 조종</b>합니다. 나가면 이 판으로 <b>다시 돌아올 수 없습니다</b>.
        </p>
        <div className="actions">
          <button className="btn" autoFocus onClick={close}>
            계속하기
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              close();
              store.leaveRoom();
            }}
          >
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 이모트 (§4 emote) — 코드 0..15, 문구는 클라이언트 정의 */
function EmoteMenu({ store }: { store: ClientStore }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="emote-wrap">
      <button className={`hud-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        말풍선
      </button>
      {open && (
        <div className="emote-menu">
          {EMOTE_TEXT.map((t, code) => (
            <button
              key={code}
              className="btn btn-sm"
              onClick={() => {
                store.sendEmote(code);
                setOpen(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** 옵션 창 톱니 버튼 (O) */
function OptionsBtn({ ctl }: { ctl: GameInputController }) {
  return (
    <button className={`hud-btn gear-btn ${ctl.ix.optionsOpen ? 'on' : ''}`} onClick={() => ctl.toggleOptions()} title="옵션 (O)" aria-label="옵션 (O)" aria-haspopup="dialog" aria-expanded={ctl.ix.optionsOpen}>
      <GearIcon size={16} />
    </button>
  );
}

function HudBtn({ on, k, label, onClick }: { on: boolean; k: string; label: string; onClick: () => void }) {
  return (
    <button className={`hud-btn ${on ? 'on' : ''}`} onClick={onClick}>
      <kbd>{k}</kbd> {label}
    </button>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/**
 * 하단 바 — 병력 비율 파라미터 + 골드 수지(사용자 요청 2026-10-10: 깃발 유지비로 초당 얼마가 나가는지, 순수입).
 * 병종은 삼각 메뉴에서 고른다(v4.2 출전 UI). 유지비는 서버 upkeepPm 으로 계산(upkeep.ts), 다음 깃발 미리보기는
 * 서버 값과 식이 맞을 때만 보인다.
 */
function CommandBar({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  const lastRule = useRef<UpkeepRule | null>(null);
  if (!ctl.canCommand()) return null;
  const ix = ctl.ix;
  const g = store.game;
  const me = store.myPlayerId;
  const p = g && me !== null ? g.players.get(me) : undefined;
  let gold: JSX.Element | null = null;
  if (g && p && me !== null) {
    const inc = goldPerSecond(p.goldWeight, p.techMask, p.upkeepPm, g.config.constants);
    const upkeep = Math.max(0, inc.gross - inc.net);
    const rule = detectRule(g, me, p.upkeepPm);
    if (rule) lastRule.current = rule;
    const extra = ([0, 1, 2] as Unit[]).map((u) => nextFlagExtraPm(g, me, rule ?? lastRule.current, u));
    const showExtra = extra.every((e) => e !== null);
    gold = (
      <div className="gold-flow" title="유지비 = 배치된 깃발 때문에 골드 수입에서 빠지는 몫 (서버 값)">
        <span>
          골드 순수입 <b className={inc.net <= 0 ? 'warn-text' : ''}>+{inc.net.toFixed(1)}/초</b>
        </span>
        <span className="muted small">
          총 +{inc.gross.toFixed(1)} · 깃발 유지비 <b className={upkeep > 0 ? 'upkeep' : ''}>−{upkeep.toFixed(1)}/초</b>
          {p.upkeepPm > 0 && ` (${(p.upkeepPm / 10).toFixed(0)}%)`}
        </span>
        {showExtra && (
          <span className="muted small">
            다음 깃발 유지비{' '}
            {extra.map((e, u) => (
              <span key={u} className="upkeep-unit">
                <UnitIcon unit={u as Unit} size={13} /> −{((inc.gross * e!) / 1000).toFixed(1)}
              </span>
            ))}
            /초
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="command-bar">
      <label className="ratio">
        <span>
          보낼 병력 비율 <b>{Math.round(ix.ratio * 100)}%</b> <kbd>Q</kbd>/<kbd>E</kbd>
        </span>
        <input type="range" min={10} max={100} step={10} value={Math.round(ix.ratio * 100)} onChange={(e) => ctl.setRatio(Number(e.target.value) / 100)} />
      </label>
      {gold}
    </div>
  );
}

function FlagPanel({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  const g = store.game;
  const id = ctl.ix.selectedFlagId;
  const f = id !== null ? g?.flags.get(id) : undefined;
  if (!g || !f) return null;
  const mine = ctl.myFlag(f.id) && ctl.canCommand() && !narrow;
  const cd = Math.max(0, f.postureCooldownUntilTick - g.tick);
  const eta = g.flagEta.get(f.id);
  const status = [
    FLAG_STATE_NAME[f.state],
    f.inCombat && '전투 중',
    f.routed && '패주',
    f.blocked && '대치',
    f.disengaging && '이탈 대기',
    f.stalled && '정체',
  ]
    .filter(Boolean)
    .join(' · ');
  const returning = f.state === 'RETURNING'; // v4.2 A-62: 귀환 중엔 모든 명령 거절
  const postureBlocked = returning || f.routed || f.inCombat || f.disengaging || cd > 0;
  return (
    <div className="flag-panel">
      <div className="flag-panel-head">
        <span className="dot" style={{ background: playerColor(f.ownerId) }} />
        <b>{store.nicknameOf(f.ownerId)}</b> · 깃발 #{f.slotIndex + 1}
      </div>
      <div className="flag-panel-body">
        <div>
          <UnitIcon unit={f.unit as Unit} size={18} withName /> <b>{f.troops}</b>
        </div>
        <div>
          태세 <b className={f.posture === POSTURE.ATTACK ? 'atk' : 'def'}>{POSTURE_NAME[f.posture]}</b>
          {cd > 0 && <span className="muted"> (전환 {Math.ceil((cd * g.config.tickMs) / 1000)}초)</span>}
        </div>
        <div className="muted">{status}</div>
        {f.state === 'MARCHING' && eta !== undefined && <div>교전 개시 예상 약 {Math.max(0, Math.ceil(((eta - g.tick) * g.config.tickMs) / 1000))}초 <span className="muted small">(영토 변화·대치·전투 제외)</span></div>}
        {f.posture === POSTURE.ATTACK && f.state === 'ENGAGED' && <div>진척도 {f.progressPct}%</div>}
      </div>
      {mine && (
        <div className="flag-panel-actions">
          <button className="btn" disabled={postureBlocked} onClick={() => ctl.togglePosture()} title="단축키 F">
            <kbd>F</kbd> {f.posture === POSTURE.ATTACK ? '방어로' : '공격으로'}
          </button>
          <button className="btn" disabled={f.routed || returning} onClick={() => ctl.recallSelected()} title="단축키 R">
            <kbd>R</kbd> 회수
          </button>
          <span className="muted small">{returning ? '귀환 중 — 취소 불가' : '우클릭 = 재지정 · 내 기지 클릭 = 그 기지로 귀환'}</span>
        </div>
      )}
    </div>
  );
}

function GameOverOverlay({ store, game }: { store: ClientStore; game: GameModel }) {
  usePolled(() => game.version, 300);
  const me = store.myPlayerId;
  const [hidden, setHidden] = useState(false);
  // QA J-2: 서버가 game_over 를 다시 보내기 전(구버전)이거나 못 받았으면 마지막 상태로 순위를 대신 보여준다
  const go =
    game.gameOver ?? {
      type: 'game_over' as const,
      finalTick: game.tick,
      winnerId: null,
      reason: 'timeout' as const,
      standings: [...game.players.values()]
        .sort((a, b) => Number(b.alive) - Number(a.alive) || b.tiles - a.tiles)
        .map((p, i) => ({ rank: i + 1, playerId: p.id, tiles: p.tiles, troops: p.troops, goldEarned: 0, alive: p.alive })),
    };
  const partial = !game.gameOver;
  const won = go.winnerId !== null && go.winnerId === me;
  if (hidden)
    // 종료 후 둘러보기: 맵은 자유 카메라·툴팁·순위표 따라가기, 명령은 canCommand 가 막는다
    return (
      <div className="gameover-pill" role="status">
        <span>
          게임 종료 · {go.winnerId !== null ? `${store.nicknameOf(go.winnerId)} 승리` : '승자 없음'}
        </span>
        <button className="btn btn-sm btn-primary" onClick={() => setHidden(false)}>
          결과 보기
        </button>
        <button className="btn btn-sm" onClick={() => store.leaveRoom()}>
          로비로
        </button>
      </div>
    );
  return (
    <div className="overlay">
      <div className="gameover-card">
        <h2>{won ? '승리!' : go.winnerId !== null ? `${store.nicknameOf(go.winnerId)} 승리` : '게임 종료'}</h2>
        <p className="muted">
          {partial ? '결과를 받지 못해 마지막 상태로 표시합니다' : GAME_OVER_REASON[go.reason]} · {fmtClock(go.finalTick * game.config.tickMs)}
        </p>
        <table className="standings">
          <thead>
            <tr>
              <th>순위</th>
              <th>플레이어</th>
              <th>타일</th>
              <th>점유율</th>
              <th>병력</th>
            </tr>
          </thead>
          <tbody>
            {go.standings.map((s) => (
              <tr key={s.playerId} className={s.playerId === me ? 'me' : ''}>
                <td>{s.rank}</td>
                <td>
                  <span className="dot" style={{ background: playerColor(s.playerId) }} /> {store.nicknameOf(s.playerId)}
                  {!s.alive && <span className="muted"> (탈락)</span>}
                </td>
                <td>{s.tiles}</td>
                <td>{((s.tiles * 100) / game.config.totalLandTiles).toFixed(1)}%</td>
                <td>{s.troops}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button className="btn" onClick={() => setHidden(true)}>
            맵 보기
          </button>
          <button className="btn btn-primary" onClick={() => store.leaveRoom()}>
            로비로
          </button>
        </div>
      </div>
    </div>
  );
}
