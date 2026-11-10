import { Fragment, useEffect, useRef, useState } from 'react';
import { BASE_BUFF, DISENGAGE_VALUE_PERMILLE_V2, ENDGAME_RUSH_TICK, POSTURE, type FlagSnapshot, type Posture, type Unit } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameModel } from '../state/gameModel.js';
import { GameRenderer } from '../render/renderer.js';
import type { TopologyView } from '../render/topology.js';
import { clampCamera } from '../render/camera.js';
import { GameInputController, Interaction } from '../input/controller.js';
import { RangeCache, computePreview, type CursorPreview } from '../input/preview.js';
import type { RoutePreview } from '../input/route.js';
import { terrainInfo, visibleTipRows, type TipBadge } from './terrainInfo.js';
import { SHIELD_GLYPH, SWORD_GLYPH } from '../render/combatPairs.js';
import { UNIT_GLYPHS } from '../render/unitGlyphs.js';
import { flagStatusParts, moraleDetailRows } from './flagView.js';
import { captureCost, neutralPlainCost, pctOfPm } from './unitStats.js';
import { TOOLTIP_FIELDS, loadOptions } from './options.js';
import { OptionsLayer, GearIcon } from './OptionsPanel.js';
import { PostureIcon, UnitIcon } from './unitIcons.js';
import { unitUpkeepPerKilo } from './upkeep.js';
import { usePolled } from './hooks.js';
import { playerColor } from '../render/palette.js';
import { EMOTE_TEXT, GAME_OVER_REASON, POSTURE_NAME, UNIT_NAME, fmtClock } from './text.js';
import { fmtPts, goldPerSecond, unitCombatStats } from './techInfo.js';
import { flagActionState, myUnitChips } from './unitChips.js';
import { engagePreview } from './engagePreview.js';
import { flagChannels, moraleDetail, moraleTone, type MoraleDetail } from './morale.js';
import { disengageTicksOf } from '../state/disengage.js';
import { incomeOf, productionRows, type SourceRow } from './production.js';
import { DiplomacyPanel, EventFeed, IncomingProposals, Scoreboard, openCard } from './panels.js';
import { PlayerCard } from './PlayerCard.js';
import { fmtCompact, fmtGoldPerMin, ratioBudget, troopBarParts } from './fmt.js';
import { RELATION_NAME, TARGET_KIND_NAME, hoverTarget } from './playerInfo.js';
import { ClockIcon, EmoteIcon, FullscreenIcon, HelpIcon, LeaveIcon } from './hudIcons.js';
import { TechWindow } from './TechWindow.js';
import { purchasableCount } from './techTree.js';
import { Help } from './Help.js';
import { UnitRing } from './UnitRing.js';
import { RING_EXTENT, clampRingCenter, ringScale } from '../input/unitRing.js';

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
  const ctxRef = useRef<HTMLDivElement>(null);
  const terrainRef = useRef<HTMLDivElement>(null);
  const flagActRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<GameInputController | null>(null);
  const narrow = useNarrow();
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new GameRenderer(canvas);
    const ix = new Interaction();
    ix.options = loadOptions(); // 실패하면 기본값 (ui/options.ts)
    const controller = new GameInputController(canvas, renderer, store, ix);
    controller.attach();
    setCtl(controller);
    // 개발 빌드: 화면 확인용 (window.__civwarCtl.renderer.flagScreens 로 깃발 화면 좌표를 읽는다)
    if (import.meta.env.DEV) (window as unknown as { __civwarCtl: GameInputController }).__civwarCtl = controller;
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
      // 예고 대상 칸: 병종 고리 = 확정 지점, 기지→커서 화살표 = 커서, 내 깃발 선택 = 커서(우클릭 재지정)
      const pv = ix.issue?.phase === 'pick' ? ix.issue.anchor : ix.issue?.phase === 'aim' || controller.myFlag(ix.selectedFlagId) ? ix.hoverTile : -1;
      if (game && me !== null && renderer.topo && canCmd && pv >= 0) {
        // v5.6: 공격 깃발은 내 땅으로 가도 공격 그대로 — computePreview 가 지금 태세·쿨타임으로 예고를 고친다
        const sel = !ix.issue && ix.selectedFlagId !== null && controller.myFlag(ix.selectedFlagId) ? game.flags.get(ix.selectedFlagId) : undefined;
        const cdLeft = sel ? Math.max(0, sel.orderCooldownUntilTick - game.tick) : 0;
        const held = sel ? { posture: sel.posture as Posture, sec: Math.ceil((cdLeft * game.config.tickMs) / 1000) } : null;
        preview = computePreview(game, renderer.topo, me, pv, range.get(game, renderer.topo, me), held);
        // v5.6: 병종 고리에서 고른 태세가 칸 기본값과 다르면 보호 원 없이 고른 색으로 예고
        const picked = ix.issue?.phase === 'pick' ? ix.issue.posture : null;
        if (preview && picked && picked !== 'blocked' && preview.kind !== 'blocked' && preview.kind !== picked) {
          preview = { ...preview, kind: picked, posture: picked === 'attack' ? POSTURE.ATTACK : POSTURE.DEFEND, disk: [], count: 0 };
        }
        // 2026-11-10 사용자 요청: 깃발을 선택한 동안(재지정 예고)은 방어 보호 범위(십자 모양 영역)를 그리지 않는다
        if (preview && sel) preview = { ...preview, disk: [] };
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
          // §21: 지명 + 생산력(회복 중일 때만 바 — 가득 차면 숨김). tick 사이를 회복 속도로 보간해 부드럽게 차오른다
          baseExtra: game?.ready ? baseExtraOf(game, game.renderTick(now)) : undefined,
        },
        now,
      );
      if (miniRef.current) renderer.drawMinimap(miniRef.current, game, store.viewerId);
      updateTooltip(tipRef.current, preview, ix, controller, route);
      positionRing(ctxRef.current, controller);
      positionFlagActions(flagActRef.current, controller, narrowRef.current);
      updateTerrainTip(terrainRef.current, game, controller, store, narrowRef.current);
      updateTargetBar(targetRef.current, game, ix, store, narrowRef.current, now);
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
      <div
        ref={targetRef}
        className="target-bar"
        role="status"
        onClick={(e) => {
          // 이름을 누르면 그 플레이어 정보 카드
          const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-owner]')?.dataset.owner ?? 0);
          if (ctl && id > 0) openCard(ctl, id);
        }}
      />
      <div ref={ctxRef} className="ctx-anchor">
        {ctl && <UnitRing store={store} ctl={ctl} />}
      </div>
      <div ref={flagActRef} className="flag-actions-anchor">
        {ctl && !narrow && <FlagActions store={store} ctl={ctl} />}
      </div>
      <canvas ref={miniRef} className="minimap" onPointerDown={onMini} onPointerMove={onMini} title="클릭해 이동" />
      {ctl && <Hud store={store} ctl={ctl} narrow={narrow} />}
      {ctl && <TopCluster store={store} ctl={ctl} narrow={narrow} />}
      {ctl && <Scoreboard store={store} ctl={ctl} compact={narrow} />}
      {ctl && <PlayerCard store={store} ctl={ctl} narrow={narrow} />}
      {ctl && !narrow && <EventFeed store={store} />}
      {ctl && !narrow && <CommandBar store={store} ctl={ctl} />}
      {ctl && <FlagPanel store={store} ctl={ctl} narrow={narrow} />}
      {ctl && <TechWindow store={store} ctl={ctl} narrow={narrow} />}
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

/** DOM 조각 도우미 (rAF 루프에서 툴팁을 직접 만든다) */
function h(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 24 격자 선 아이콘의 DOM 판 (rAF 루프 툴팁용) — PostureIcon·UnitIcon 과 같은 모양 데이터 */
function glyphSvg(parts: readonly { d: string; mode: string; width?: number }[], cls: string, size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const part of parts) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', part.d);
    if (part.mode === 'fill') path.setAttribute('fill', 'currentColor');
    else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', String(part.width ?? 2));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(path);
  }
  return svg;
}

/** 태세 아이콘 (검 = 공격 태세 · 방패 = 방어 태세) — PostureIcon 과 같은 그림의 DOM 판 */
function postureSvg(posture: number, size = 11): SVGSVGElement {
  return glyphSvg(posture === POSTURE.ATTACK ? SWORD_GLYPH : SHIELD_GLYPH, `posture-icon ${posture === POSTURE.ATTACK ? 'posture-atk' : 'posture-def'}`, size);
}

function tipBadge(b: TipBadge): HTMLElement {
  const x = h('span', `tt-badge ${b.tone}${b.posture === null ? '' : b.posture === POSTURE.ATTACK ? ' p-atk' : ' p-def'}`);
  x.setAttribute('aria-label', b.long);
  if (b.posture !== null) x.append(postureSvg(b.posture));
  x.append(document.createTextNode(b.text));
  return x;
}

/** 내가 명령할 수 있는 선택 부대의 병종 (없으면 null) */
function selectedMyUnit(game: GameModel, ctl: GameInputController): number | null {
  const id = ctl.ix.selectedFlagId;
  if (id === null || !ctl.myFlag(id) || !ctl.canCommand()) return null;
  return game.flags.get(id)?.unit ?? null;
}

/**
 * 지형 정보 툴팁 — 맵 캔버스 위 칸에서만(HUD·패널 위 제외), 커서 왼쪽 위에 둔다(출전 안내 툴팁은 오른쪽 아래).
 * 병종 고리가 떠 있는 동안은 숨긴다(고리·경로를 가리지 않게).
 * 2026-10-28: 전투·이동 보정 = 지형 이름 옆 배지. 내 부대 선택 중 = 행동에 필요한 것만(보정·그 병종 점령 비용·기지 체력).
 * 깃발 위에 올리면 그 부대의 깃발 카드(flagCard)를 대신 보인다.
 */
function updateTerrainTip(el: HTMLDivElement | null, game: GameModel | null, ctl: GameInputController, store: ClientStore, narrow: boolean): void {
  if (!el) return;
  const ix = ctl.ix;
  const hide = () => {
    if (el.style.display !== 'none') el.style.display = 'none';
    el.dataset.key = '';
  };
  if (!game?.ready || !ix.options.tooltip || !ix.overMap || ix.hoverTile < 0 || ix.issue?.phase === 'pick') return hide();
  const hoverFlag = ctl.renderer.flagAt(ix.hoverX, ix.hoverY);
  const fl = hoverFlag !== null ? game.flags.get(hoverFlag) : undefined;
  const md = fl && !fl.routed ? moraleDetail(game, fl) : null;
  if (fl && md) {
    const status = flagStatusParts(fl, game.moraleRetreat.has(fl.id));
    const key = `m:${fl.id}:${fl.troops}:${md.view.value}:${md.now?.join('/')}:${fl.posture}:${md.baseFloor}:${status.join('/')}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.replaceChildren(...flagCard(fl, md, status, store));
    }
  } else {
    const t = ix.hoverTile;
    const b = game.bases.get(t);
    const o = ix.options;
    const sel = selectedMyUnit(game, ctl);
    const fieldsKey = TOOLTIP_FIELDS.map((f) => (o.tooltipFields[f] ? 1 : 0)).join('');
    const key = `${t}:${game.owners[t]}:${b ? `${Math.round(b.hpPct)}/${Math.floor((game.baseProdPm(t) ?? 0) / 10)}` : ''}:${fieldsKey}:${narrow ? 1 : 0}:${sel}:${game.version}`;
    if (el.dataset.key !== key) {
      const info = terrainInfo(game, t, store.myPlayerId, (id) => store.nicknameOf(id), { topo: ctl.renderer.topo, selectedUnit: sel });
      // 2026-10-18: 넓은 화면은 주인 정보를 상단 대상 바가 보여 준다 → 커서 툴팁은 지형 위주 (소유자 줄 생략)
      const rows = info ? visibleTipRows(info, o.tooltip, o.tooltipFields).filter((r) => narrow || r.field !== 'owner') : [];
      if (!info || !rows.length) return hide();
      el.dataset.key = key;
      // 맨 위 = 지형 이름 + 보정 배지(전투·이동), 그 아래 한 줄에 한 항목 (점령 → 골드 → 소유자 → 기지)
      const head = h('div', 'tt-row tt-terrain');
      const badges = rows.flatMap((r) => r.badges ?? []);
      if (rows.some((r) => r.field === 'terrain')) head.append(h('b', '', info.rows[0].value));
      if (badges.length) {
        const wrap = h('span', 'tt-badges');
        wrap.append(...badges.map(tipBadge));
        head.append(wrap);
      }
      const body = rows
        .filter((r) => r.field !== 'terrain' && !r.badges)
        .map((r) => {
          const row = h('div', `tt-row tt-${r.field}`);
          const v = h('span', 'tt-v');
          if (r.field === 'owner' && info.ownerId) {
            const dot = h('span', 'dot');
            dot.style.background = playerColor(info.ownerId);
            v.append(dot);
          }
          v.append(document.createTextNode(r.value));
          row.append(h('span', 'tt-k', r.label), v);
          return row;
        });
      el.replaceChildren(...(head.childNodes.length ? [head] : []), ...body);
    }
  }
  el.style.display = 'flex'; // .terrain-tip = flex column (한 줄에 한 항목)
  const parent = el.parentElement;
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  let x = ix.hoverX - 14 - w;
  let y = ix.hoverY - 14 - hh;
  if (x < 4) x = ix.hoverX + 16; // 왼쪽 끝이면 오른쪽 위로
  if (y < 64) y = ix.hoverY + 40; // 위쪽 HUD 와 겹치면 커서 아래로
  if (parent) x = Math.min(x, parent.clientWidth - w - 4);
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * 깃발 hover 카드 (2026-11-06 사용자 결정, 이슈 20261104-0112) — 병종·병력·주인 / 태세·상태 / 사기 막대·% / 지금 공격·방어.
 * 사기 상세와 설명은 깃발 선택 패널(접기)과 [?] 도움말에 있다.
 */
function flagCard(f: FlagSnapshot, md: MoraleDetail, status: string[], store: ClientStore): HTMLElement[] {
  const head = h('div', 'tt-row tt-terrain fc-head');
  const who = h('b', 'fc-unit');
  who.append(glyphSvg(UNIT_GLYPHS[f.unit as Unit], 'unit-icon', 15), document.createTextNode(` ${UNIT_NAME[f.unit as Unit]} ${f.troops.toLocaleString()}명`));
  const owner = h('span', 'tt-v fc-owner');
  const dot = h('span', 'dot');
  dot.style.background = playerColor(f.ownerId);
  owner.append(dot, document.createTextNode(store.nicknameOf(f.ownerId)));
  head.append(who, owner);
  const st = h('div', 'tt-row fc-state');
  const pst = h('span', `fc-posture ${f.posture === POSTURE.ATTACK ? 'atk' : 'def'}`);
  pst.append(postureSvg(f.posture, 12), document.createTextNode(` ${POSTURE_NAME[f.posture as Posture]}`));
  st.append(pst, h('span', 'tt-v muted', status.join(' · ')));
  const mrow = h('div', 'tt-row fc-morale');
  const bar = h('span', `mbar wide ${md.view.tone}`);
  const fill = h('i', '');
  fill.style.width = `${md.view.pct}%`;
  bar.append(fill);
  for (const v of [md.view.bands.low, md.view.bands.mid]) {
    const tick = h('u', '');
    tick.style.left = `${v / 10}%`;
    bar.append(tick);
  }
  if (md.baseFloor !== null) {
    // v5.1 기지 사기 하한 눈금 (하늘색)
    const fl = h('s', '');
    fl.style.left = `${md.baseFloor / 10}%`;
    bar.append(fl);
  }
  mrow.append(h('span', 'tt-k', '사기'), bar, h('b', 'fc-pct', `${md.view.pct}%`));
  const out = [head, st, mrow];
  if (md.now) {
    const now = h('div', 'tt-row fc-now');
    const atk = h('span', 'fc-ch');
    atk.append(postureSvg(POSTURE.ATTACK, 11), document.createTextNode(` 공격 ${fmtPts(md.now[0])}`));
    const def = h('span', 'fc-ch');
    def.append(postureSvg(POSTURE.DEFEND, 11), document.createTextNode(` 방어 ${fmtPts(md.now[1])}`));
    now.append(atk, def);
    out.push(now);
  }
  return out;
}

/**
 * 상단 중앙 "가리키는 대상" 바 (2026-10-18 UI 개선 4) — 커서 아래 칸의 주인: 색·이름·종류·병력·골드·기지 수·관계.
 * rAF 루프에서 DOM 을 직접 고친다(내용이 바뀔 때만). 커서가 바 위로 올라가면(이름 클릭) 마지막 대상을 유지한다.
 * 위치: 가운데 맨 위가 왼쪽 HUD·오른쪽 버튼 묶음과 겹치면 HUD 줄 아래로 내린다 (0.3초마다 다시 잰다). 좁은 화면은 숨김.
 */
function updateTargetBar(el: HTMLDivElement | null, game: GameModel | null, ix: Interaction, store: ClientStore, narrow: boolean, now: number): void {
  if (!el) return;
  const hide = () => {
    if (el.style.display !== 'none') el.style.display = 'none';
    el.dataset.key = '';
  };
  if (!game?.ready || narrow) return hide();
  if (!ix.overMap || ix.hoverTile < 0) {
    if (el.style.display === 'flex' && el.matches(':hover')) return; // 바 위 — 이름을 누를 수 있게 유지
    return hide();
  }
  const tgt = hoverTarget(game, ix.hoverTile, store.myPlayerId, store.names);
  if (!tgt) return hide();
  const key = `${tgt.ownerId}:${tgt.troops}:${tgt.gold}:${tgt.bases}:${tgt.relation}:${tgt.name}:${tgt.alive}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const span = (cls: string, text: string) => {
      const x = document.createElement('span');
      x.className = cls;
      x.textContent = text;
      return x;
    };
    const parts: HTMLElement[] = [];
    const who = document.createElement(tgt.ownerId ? 'button' : 'span');
    who.className = 'tb-who';
    if (tgt.ownerId) {
      who.dataset.owner = String(tgt.ownerId);
      who.title = '정보 카드 열기';
    }
    const sw = document.createElement('span');
    sw.className = 'tb-swatch';
    sw.style.background = tgt.ownerId ? playerColor(tgt.ownerId) : '#9aa5b1';
    who.append(sw, span('tb-name', tgt.name));
    parts.push(who);
    if (tgt.ownerId) parts.push(span('tag tb-kind', TARGET_KIND_NAME[tgt.kind])); // 중립은 이름이 이미 '중립 땅'
    if (tgt.relation && tgt.ownerId) parts.push(span(`tag rel-${tgt.relation}`, RELATION_NAME[tgt.relation]));
    if (!tgt.alive) parts.push(span('tag warn-tag', '탈락'));
    const stat = (label: string, value: string) => {
      const x = document.createElement('span');
      x.className = 'tb-stat';
      x.append(span('tb-k', label), span('tb-v', value));
      return x;
    };
    if (tgt.troops !== null) parts.push(stat('병력', fmtCompact(tgt.troops)));
    if (tgt.gold !== null) parts.push(stat('골드', fmtCompact(tgt.gold)));
    parts.push(stat('기지', `${tgt.bases}곳`));
    // 2026-11-06: 점유율은 순위표가 보여 준다 → 대상 바에서 뺌
    el.replaceChildren(...parts);
    el.dataset.kind = tgt.kind;
    el.dataset.posAt = '0'; // 폭이 바뀌었을 수 있다 → 다시 배치
  }
  if (el.style.display !== 'flex') {
    el.style.display = 'flex';
    el.dataset.posAt = '0';
  }
  if (now - Number(el.dataset.posAt || 0) > 300) {
    el.dataset.posAt = String(now);
    placeTargetBar(el);
  }
}

/** 대상 바 자리: 맨 위 가운데 → (겹치면) HUD 첫 줄 오른쪽 끝 다음 → (그래도 안 되면) HUD 아래 가운데. 순위표·버튼 묶음은 피한다 */
function placeTargetBar(el: HTMLElement): void {
  const root = el.parentElement;
  if (!root) return;
  const R = root.getBoundingClientRect();
  const w = el.offsetWidth;
  const hud = root.querySelector('.hud-top');
  const cluster = root.querySelector('.top-cluster');
  const board = root.querySelector('.scoreboard');
  const hudR = hud?.getBoundingClientRect();
  let statsRight = 8;
  let statsBottom = 8;
  if (hud && hudR) {
    for (const c of Array.from(hud.children)) {
      const r = c.getBoundingClientRect();
      if (!r.width) continue;
      statsBottom = Math.max(statsBottom, r.bottom - R.top);
      if (r.top - hudR.top < 20) statsRight = Math.max(statsRight, r.right - R.left); // 첫 줄
    }
  }
  const clusterLeft = cluster ? cluster.getBoundingClientRect().left - R.left : R.width - 8;
  const boardLeft = board ? board.getBoundingClientRect().left - R.left : R.width - 8;
  let x = (R.width - w) / 2;
  let y = 8;
  const fitsTop = (xx: number) => xx >= statsRight + 8 && xx + w <= clusterLeft - 8;
  if (!fitsTop(x)) {
    if (fitsTop(statsRight + 8)) x = statsRight + 8;
    else {
      y = statsBottom + 6;
      x = Math.max(8, Math.min(x, boardLeft - 8 - w));
    }
  }
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** 전체 화면 여부 (fullscreenchange 구독) */
function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  return on;
}

function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  } catch {
    /* 지원 안 함 — 조용히 무시 */
  }
}

/**
 * 우상단 컨트롤 묶음 (2026-10-18 UI 개선 9) — 남은 시간 · 이모트 · 옵션 · 도움말 · 전체 화면 · 나가기를 한 줄 아이콘으로 (title = 툴팁).
 * 테크·외교는 단축키·배지가 있는 주 버튼이라 왼쪽 HUD 에 남긴다. 좁은 화면은 시간·옵션·도움말·나가기만.
 */
function TopCluster({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => (store.game?.version ?? 0) * 7 + store.getVersion() + ctl.ix.version * 131, 250);
  const fs = useFullscreen();
  const g = store.game;
  if (!g || !g.ready) return null;
  const me = store.myPlayerId;
  const spectating = me === null || store.viewerId !== me;
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  const msLeft = g.ticksRemaining * g.config.tickMs;
  const canFs = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  return (
    <div className="top-cluster" role="toolbar" aria-label="게임 메뉴">
      <span className={`tc-time ${g.endgameRushActive ? 'warn' : ''}`} title={g.endgameRushActive ? '남은 시간 — 종반 러시 중' : '남은 시간'} aria-label={`남은 시간 ${fmtClock(msLeft)}`}>
        <ClockIcon size={14} />
        <b>{fmtClock(msLeft)}</b>
      </span>
      {!narrow && !spectating && !over && <EmoteMenu store={store} />}
      <OptionsBtn ctl={ctl} />
      <button className={`hud-btn icon-btn ${ctl.ix.helpOpen ? 'on' : ''}`} onClick={() => ((ctl.ix.helpOpen = !ctl.ix.helpOpen), ctl.ix.bump())} title="도움말 (?)" aria-label="도움말 (?)">
        <HelpIcon size={16} />
      </button>
      {!narrow && canFs && (
        <button className={`hud-btn icon-btn ${fs ? 'on' : ''}`} onClick={toggleFullscreen} title={fs ? '전체 화면 끝내기' : '전체 화면'} aria-label={fs ? '전체 화면 끝내기' : '전체 화면'} aria-pressed={fs}>
          <FullscreenIcon size={16} on={fs} />
        </button>
      )}
      <button className="hud-btn icon-btn leave-btn" onClick={() => requestLeave(store, ctl)} title="나가기" aria-label="나가기">
        <LeaveIcon size={16} />
      </button>
    </div>
  );
}

/** 렌더러용 기지 부가 정보 (§21.4 생산력 · §21.5 지명). 생산력 바는 회복 중(< 100%)일 때만 */
export function baseExtraOf(g: GameModel, tickFloat: number): (tile: number) => { productivityPct?: number; name?: string } {
  return (tile) => {
    const pm = g.baseProdPm(tile, tickFloat);
    return { name: g.baseNames.get(tile), productivityPct: pm !== null && pm < 1000 ? pm / 10 : undefined };
  };
}

/**
 * 병종 고리를 출전 지점 칸 중심 화면 위치로 (카메라를 매 프레임 따라감). 가장자리에서는 고리 전체가 보이게 안쪽으로 당기고,
 * 원래 칸은 핀(--pin-x/y)으로 가리킨다. 작은 창은 배율(--ctx-scale)을 줄인다. data-side = 툴팁을 펼 쪽.
 */
function positionRing(el: HTMLDivElement | null, ctl: GameInputController): void {
  if (!el) return;
  const p = ctl.pickScreenPos();
  const parent = el.parentElement;
  if (!p || !parent) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  const W = parent.clientWidth;
  const H = parent.clientHeight;
  const s = ringScale(W, H);
  const q = clampRingCenter(p.x, p.y, W, H, RING_EXTENT * s, 6, 48); // 48 = 위쪽 HUD 줄
  el.style.display = 'block';
  el.style.setProperty('--ctx-scale', s.toFixed(3));
  el.style.setProperty('--pin-x', `${((p.x - q.x) / s).toFixed(1)}px`);
  el.style.setProperty('--pin-y', `${((p.y - q.y) / s).toFixed(1)}px`);
  el.style.transform = `translate(${q.x}px, ${q.y}px)`;
  el.dataset.side = q.x > W * 0.5 ? 'left' : 'right';
}

/**
 * 선택한 내 부대 옆 [귀환]/[태세 변경] 버튼 — 깃발 보간 위치를 매 프레임 따라간다 (2026-10-14).
 * 내 깃발이 아니거나 명령할 수 없거나 좁은 화면이면 숨긴다. 병종 고리가 떠 있으면 겹치지 않게 숨긴다.
 */
function positionFlagActions(el: HTMLDivElement | null, ctl: GameInputController, narrow: boolean): void {
  if (!el) return;
  const p = !narrow && !ctl.ix.issue && ctl.myFlag(ctl.ix.selectedFlagId) && ctl.canCommand() ? ctl.selectedFlagScreenPos() : null;
  if (!p) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  // 깃발 오른쪽 위 (화면 오른쪽 끝이면 왼쪽으로)
  const parent = el.parentElement;
  const w = el.offsetWidth || 120;
  let x = p.x + 24;
  if (parent && x + w > parent.clientWidth - 8) x = p.x - 24 - w;
  const y = Math.max(64, p.y - 34);
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function routeText(route: RoutePreview | null, kind: string | undefined): string {
  if (!route) return '';
  if (!route.reachable) return ' · 갈 수 있는 경로 없음';
  const steps = route.path.length - 1;
  // §22.12 방어 태세는 적 땅을 지나지 못한다 — 막히면 적 땅 앞에서 멈춘다
  if (route.blocked) return steps > 0 ? ` · 적 땅에 막혀 ${steps}칸 가서 멈춤` : ' · 적 땅에 막혀 출발 못 함';
  return kind === 'attack' ? ` · 경로 ${steps}칸 · 옆 칸 ${route.corridor.length}개 공격` : ` · 경로 ${steps}칸`;
}

function updateTooltip(el: HTMLDivElement | null, p: CursorPreview | null, ix: Interaction, ctl: GameInputController, route: RoutePreview | null): void {
  if (!el) return;
  let text: string | null = null;
  let kind = p?.kind ?? 'info';
  const g = ix.hoverTile;
  if (ix.issue?.phase === 'pick') text = null; // 병종 고리가 안내한다
  else if (ix.issue?.phase === 'aim') {
    if (g === ix.issue.base) {
      text = '수비 배치';
      kind = 'defend';
    } else if (p) text = `${p.label}${routeText(route, p.kind)}`;
  } else if (ctl.canCommand() && g >= 0) {
    const myFlag = ctl.myFlag(ix.selectedFlagId);
    // 2026-10-14: 선택 부대 우클릭 = 항상 이동
    if (myFlag && p?.held && p.kind !== 'blocked') text = `우클릭 = 이동 → ${p.label}`;
    else if (myFlag && ctl.isMyBase(g)) {
      text = '이동 · 방어';
      kind = 'defend';
    } else if (myFlag && ctl.isBaseTile(g) && p?.kind !== 'blocked') {
      text = '이동 · 공격';
      kind = 'attack';
    } else if (myFlag && p && p.kind !== 'blocked') text = `우클릭 = 이동 → ${p.label}`;
    else if (myFlag && p) text = p.label;
    else if (!myFlag && ix.selectedFlagId === null && ctl.isMyBase(g)) {
      text = '출전 기지';
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

function Hud({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => (store.game?.version ?? 0) * 7 + store.getVersion() + ctl.ix.version * 131);
  const g = store.game;
  if (!g || !g.ready) return <div className="hud-top">맵을 불러오는 중…</div>;
  const me = store.myPlayerId;
  const viewer = store.viewerId;
  const p = viewer !== null ? g.players.get(viewer) : undefined;
  const share =(tiles: number) => (tiles * 100) / g.config.totalLandTiles;
  const flagsUsed = viewer !== null ? g.flagsOf(viewer).length : 0;
  const rushTick = (g.config.endgameRush?.tick as number | undefined) ?? ENDGAME_RUSH_TICK;
  const spectating = me === null || viewer !== me;
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  // §21.4: 수입 = production 합 (없으면 예전 식). hover = 기지별 + 기타
  const income = p ? incomeOf(g, p.id) : null;
  const prodRows = p ? g.production.get(p.id) : undefined;
  const nameOf = (t: number) => g.baseNames.get(t);
  const isCap = (t: number) => g.capitalTiles.has(t);
  const troopTip = prodRows?.length ? { title: `병력 재생 +${(income?.troops ?? 0).toFixed(1)}/초 — 출처`, unit: '/초', rows: productionRows(prodRows, 'troops', nameOf, isCap) } : null;
  // 2026-11-05: 골드는 /분 (서버 값 골드/초 × 60)
  const goldTip = prodRows?.length
    ? {
        title: `골드 순수입 ${fmtGoldPerMin(income?.net ?? 0)} — 출처${income && income.gross > income.net ? ` (유지비 ${fmtGoldPerMin(income.net - income.gross)} 반영)` : ''}`,
        unit: '/분',
        rows: productionRows(prodRows, 'gold', nameOf, isCap).map((r) => ({ ...r, amount: r.amount * 60 })),
      }
    : null;
  // 테크 버튼 배지 = 지금 살 수 있는 노드 수 (내가 명령할 수 있을 때만)
  const mineP = me !== null ? g.players.get(me) : undefined;
  const techBadge = mineP && ctl.canCommand() ? purchasableCount(mineP, g.config.constants) : 0;
  const toggleTech = () => {
    ctl.ix.panel = ctl.ix.panel === 'tech' ? null : 'tech';
    if (ctl.ix.panel !== 'tech') ctl.ix.techDetail = null;
    ctl.ix.bump();
  };
  return (
    <div className="hud-top">
      {spectating && <span className="pill spectate-pill">{me !== null && g.players.get(me) && !g.players.get(me)!.alive ? '탈락 · 관전' : '관전'}{p ? ` · ${store.nicknameOf(p.id)}` : ''}</span>}
      {p && (
        <>
          <Stat label="병력" value={`${fmtCompact(p.troops + g.deployedTroopsOf(p.id))} / ${fmtCompact(g.troopCapOf(p))}`} breakdown={troopTip} />
          <Stat
            label={p.upkeepPm > 0 ? `골드 · 유지비 −${(p.upkeepPm / 10).toFixed(0)}%` : '골드'}
            value={`${p.gold.toLocaleString()}${income ? ` ${fmtGoldPerMin(income.net)}` : ''}`}
            warn={p.upkeepPm >= 300}
            breakdown={goldTip}
          />
          {/* 2026-11-06: 타일 수는 점유율과 같은 정보라 hover 로 옮김 */}
          <Stat label="점유율" value={`${share(p.tiles).toFixed(1)}%`} title={`${p.tiles.toLocaleString()}칸`} />
          {!narrow && <Stat label="깃발" value={`${flagsUsed} / ${p.flagCap}`} />}
        </>
      )}
      <Stat label="승리 기준" value={`${g.thresholdPct.toFixed(1)}%`} />
      {/* 남은 시간은 우상단 컨트롤 묶음(TopCluster)으로 옮겼다 (2026-10-18) */}
      {g.endgameRushActive ? (
        <span className="pill warn-pill">종반 러시</span>
      ) : (
        !narrow && g.tick > rushTick - 1500 && <span className="pill">러시까지 {fmtClock((rushTick - g.tick) * g.config.tickMs)}</span>
      )}
      {g.lockoutDissolveTick !== null && <span className="pill warn-pill">전원 동맹 — 강제 해제 {fmtClock((g.lockoutDissolveTick - g.tick) * g.config.tickMs)}</span>}
      {!narrow && (
        <span className="hud-buttons">
          {/* 테크 창은 관전·종료 후에도 열 수 있다(보기 전용) */}
          <HudBtn on={ctl.ix.panel === 'tech'} k="T" label="테크" badge={techBadge} techToggle onClick={toggleTech} />
          {!spectating && !over && <HudBtn on={ctl.ix.panel === 'ally'} k="P" label="외교" onClick={() => ((ctl.ix.panel = ctl.ix.panel === 'ally' ? null : 'ally'), ctl.ix.bump())} />}
          {/* 옵션·도움말·이모트·전체 화면·나가기 = 우상단 TopCluster (2026-10-18) */}
        </span>
      )}
      {narrow && (
        <span className="hud-buttons">
          <button className={`btn btn-sm tech-btn ${ctl.ix.panel === 'tech' ? 'on' : ''}`} data-tech-toggle onClick={toggleTech} aria-label={techBadge ? `테크 (살 수 있는 노드 ${techBadge}개)` : '테크'}>
            테크{techBadge > 0 && <span className="hud-badge">{techBadge}</span>}
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
        <p>90초 뒤 봇이 대신 조종 · 재입장 불가</p>
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
      <button className={`hud-btn icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="이모트 (말풍선 — 모두에게 보입니다)" aria-label="이모트" aria-expanded={open}>
        <EmoteIcon size={16} />
      </button>
      {open && (
        <div className="emote-menu">
          {EMOTE_TEXT.map((t, code) => (
            <button
              key={code}
              className="btn btn-sm"
              onClick={() => {
                if (store.sendEmote(code)) setOpen(false); // 대상 없음 (§26.3 — 오른쪽 위 버튼은 전체 말풍선)
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

function HudBtn({ on, k, label, onClick, badge = 0, techToggle = false }: { on: boolean; k: string; label: string; onClick: () => void; badge?: number; techToggle?: boolean }) {
  return (
    <button
      className={`hud-btn ${on ? 'on' : ''}`}
      onClick={onClick}
      data-tech-toggle={techToggle ? '' : undefined}
      aria-label={badge > 0 ? `${label} (${k}) — 살 수 있는 노드 ${badge}개` : undefined}
      title={badge > 0 ? `지금 살 수 있는 노드 ${badge}개` : undefined}
    >
      <kbd>{k}</kbd> {label}
      {badge > 0 && <span className="hud-badge">{badge}</span>}
    </button>
  );
}

function Stat({ label, value, warn, breakdown, title }: { label: string; value: string; warn?: boolean; breakdown?: { title: string; unit: string; rows: SourceRow[] } | null; title?: string }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''} ${breakdown ? 'has-breakdown' : ''}`} tabIndex={breakdown ? 0 : undefined} title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {breakdown && <SourceTip {...breakdown} />}
    </div>
  );
}

/**
 * 병력·골드 hover 출처 내역 (§22.5 production.rows — 기지별 + 영토). 제목 줄(총합) → 기지 행(수도 ★, 지명, 환산 칸 수 60/100, 생산력 %, 초당 양 — 많은 순)
 * → 구분선 → 영토 합산 행(실제 칸 수). 행 합 = 총합.
 */
function SourceTip({ title, unit, rows }: { title: string; unit: string; rows: SourceRow[] }) {
  return (
    <div className="source-tip" role="tooltip">
      <div className="source-tip-head">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className={`source-row ${r.kind === 'territory' ? 'territory' : ''} ${r.capital ? 'capital' : ''}`}>
          <span className="source-name">
            {r.capital ? '★ ' : ''}
            {r.label}
            <span className="source-tiles muted"> {r.kind === 'territory' ? `${r.tiles.toLocaleString()}칸` : `${r.tiles}칸분`}</span>
          </span>
          {r.prodPct !== null ? (
            <span className={`source-prod ${r.prodPct < 100 ? 'low' : ''}`} title="기지 생산력">
              {r.prodPct}%
            </span>
          ) : (
            <span className="source-prod muted">—</span>
          )}
          <span className="source-amt">
            +{unit === '/분' ? Math.round(r.amount).toLocaleString() : r.amount.toFixed(r.amount < 10 ? 2 : 1)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 하단 바 — 병력 비율 파라미터 + 골드 수지(사용자 요청 2026-10-10: 깃발 유지비로 초당 얼마가 나가는지, 순수입).
 * 병종은 병종 고리에서 고른다(우클릭 · 기지 조준). 유지비는 서버 upkeepPm 으로 계산(upkeep.ts), 다음 깃발 미리보기는
 * 서버 값과 식이 맞을 때만 보인다.
 */
function CommandBar({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  if (!ctl.canCommand()) return null;
  const ix = ctl.ix;
  const g = store.game;
  const me = store.myPlayerId;
  const p = g && me !== null ? g.players.get(me) : undefined;
  let gold: JSX.Element | null = null;
  if (g && p && me !== null) {
    // §21.4: production 합 (생산력이 깎인 기지 반영). 없으면 예전 식
    const inc = incomeOf(g, me) ?? goldPerSecond(p.goldWeight, p.techMask, p.upkeepPm, g.config.constants);
    const upkeep = Math.max(0, inc.gross - inc.net);
    const perKilo = ([0, 1, 2] as Unit[]).map((u) => unitUpkeepPerKilo(g, me, u));
    gold = (
      <div className="gold-flow">
        {/* 2026-11-06: 순수입은 상단 HUD 골드 옆에 있다 → 여기선 유지비만 */}
        {/* 2026-11-10: 병종별 1000명당 유지비는 hover 로 (독 한 줄 절약) */}
        <span title={`출전한 깃발 병력 1000명당 유지비 (테크 반영, 기지에 남은 병력은 무료): ${perKilo.map((r, u) => `${UNIT_NAME[u as Unit]} −${Math.round(r * 60)}`).join(' · ')}/분`}>
          깃발 유지비 <b className={upkeep > 0 ? 'upkeep' : ''}>−{fmtGoldPerMin(upkeep, false)}</b>
          <span className="muted small"> · 총수입 {fmtGoldPerMin(inc.gross)}</span>
          {inc.net <= 0 && <b className="warn-text"> · 순수입 {fmtGoldPerMin(inc.net)}</b>}
          {p.gold < 0 && <b className="warn-text"> · 골드 마이너스</b>}
        </span>
      </div>
    );
  }
  // 2026-10-18: 병력 = 현재/상한 채움 바 + 초당 회복, 비율 옆 실제로 빠질 병력 (OpenFront 참고)
  let troopBar: JSX.Element | null = null;
  let budget: number | null = null;
  if (g && p && me !== null) {
    const inc = incomeOf(g, me);
    const deployed = g.deployedTroopsOf(me);
    const tb = troopBarParts(p.troops, g.troopCapOf(p), inc?.troops ?? null, deployed);
    budget = ratioBudget(p.troops, ix.ratio);
    troopBar = (
      <div
        className={`troop-bar ${tb.full ? 'full' : ''}`}
        role="meter"
        aria-label="병력"
        aria-valuemin={0}
        aria-valuemax={g.troopCapOf(p)}
        aria-valuenow={p.troops + deployed}
        title={`대기 ${p.troops.toLocaleString()} · 출전 중 ${deployed.toLocaleString()} / 상한 ${g.troopCapOf(p).toLocaleString()}${tb.full ? ' — 가득 참 (더 늘지 않음)' : ''}`}
      >
        <span className="tb-cur">{tb.cur}</span>
        <span className="tb-track">
          <span className="tb-fill" style={{ width: `${tb.fillPct}%` }} />
          {tb.deployedPct > 0 && <span className="tb-deployed" style={{ left: `${tb.fillPct}%`, width: `${tb.deployedPct}%` }} />}
          {tb.rate && <span className="tb-rate">{tb.full ? '가득 참' : tb.rate}</span>}
        </span>
        <span className="tb-cap">{tb.cap}</span>
      </div>
    );
  }
  const perUnit = ([0, 1, 2] as Unit[]).map((u) => `${UNIT_NAME[u]} ${ctl.troopsToSend(u)}`).join(' · ');
  return (
    <div className="bottom-dock">
      <UnitChips store={store} ctl={ctl} />
      <div className="command-bar">
        {troopBar}
        <label className="ratio" title={`깃발 병력 (병종 편성비 반영): ${perUnit}`}>
          <span>
            보낼 병력 <b>{Math.round(ix.ratio * 100)}%</b>
            {budget !== null && <b className="ratio-n"> ({budget.toLocaleString()}명)</b>} <kbd>Q</kbd>/<kbd>E</kbd>
          </span>
          <input type="range" min={10} max={100} step={10} value={Math.round(ix.ratio * 100)} onChange={(e) => ctl.setRatio(Number(e.target.value) / 100)} />
        </label>
        {gold}
      </div>
    </div>
  );
}

/**
 * 병력 바 위 내 출전 부대 칩 (2026-10-14) — 병종 아이콘 + 병력 + 태세 아이콘. 누르면 선택 + 카메라 이동.
 */
function UnitChips({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  const g = store.game;
  if (!g) return null;
  const chips = myUnitChips(g, store.myPlayerId, ctl.ix.selectedFlagId);
  if (!chips.length) return null;
  return (
    <div className="unit-chips" role="toolbar" aria-label="출전한 내 부대">
      {chips.map((c) => (
        <button
          key={c.id}
          className={`unit-chip ${c.selected ? 'on' : ''} ${c.routed ? 'routed' : ''} ${c.returning ? 'returning' : ''} ${c.inCombat ? 'fighting' : ''}`}
          onClick={() => ctl.focusFlag(c.id)}
          title={`깃발 #${c.slotIndex + 1} · ${UNIT_NAME[c.unit]} ${c.troops}명 · ${POSTURE_NAME[c.posture]}${c.routed ? ' · 패주' : c.returning ? ' · 귀환 중' : c.inCombat ? ' · 전투 중' : ''}${c.morale !== null ? ` · 사기 ${Math.round(c.morale / 10)}%` : ''} — 눌러서 선택`}
          aria-pressed={c.selected}
        >
          <UnitIcon unit={c.unit} size={15} />
          <b>{c.troops}</b>
          <PostureIcon posture={c.posture} size={13} />
          {c.morale !== null && (
            <span className={`mbar ${moraleTone(c.morale, c.moraleBands)}`} role="img" aria-label={`사기 ${Math.round(c.morale / 10)}%`}>
              <i style={{ width: `${Math.round(c.morale / 10)}%` }} />
              <u style={{ left: `${c.moraleBands.low / 10}%` }} />
              <u style={{ left: `${c.moraleBands.mid / 10}%` }} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** 선택한 내 부대 옆 떠 있는 버튼 — [귀환](cmd_flag_recall, 자동 귀환지) · [태세 변경](cmd_set_posture, 쿨타임 표시) */
function FlagActions({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  const g = store.game;
  const id = ctl.ix.selectedFlagId;
  const f = id !== null ? g?.flags.get(id) : undefined;
  if (!g || !f || !ctl.myFlag(f.id) || !ctl.canCommand()) return null;
  const st = flagActionState(f, g.tick, g.config.tickMs, disengageTicksOf(g, f.ownerId));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="flag-actions" onMouseDown={stop} onContextMenu={(e) => e.preventDefault()}>
      <button className="btn btn-sm fa-btn" disabled={!!st.recallBlocked} onClick={() => ctl.recallSelected()} title={st.recallBlocked ?? '가까운 내 기지로 귀환 (R) — 귀환은 취소할 수 없습니다'}>
        <kbd>R</kbd> 귀환
      </button>
      <button
        className="btn btn-sm fa-btn"
        disabled={!!st.postureBlocked}
        onClick={() => ctl.togglePosture()}
        title={st.postureBlocked ?? `${POSTURE_NAME[st.nextPosture]} 태세로 바꾸기 (F) — 진척도가 0이 됩니다${st.combatWarning ? ` · ${st.combatWarning}` : ''}`}
      >
        <kbd>F</kbd> 태세 변경 <PostureIcon posture={st.nextPosture} size={12} />
        {st.cooldownSec > 0 && <span className="fa-cd">{st.cooldownSec}초</span>}
      </button>
      {st.combatWarning !== null && (
        <span className="fa-warn" role="status" data-testid="posture-combat-warning">
          {st.combatWarning}
        </span>
      )}
    </div>
  );
}

/**
 * 깃발 패널 각 요소 설명 (2026-10-28 UI 개선 6) — 행 hover(title)와 [?] 도움말이 같은 문구를 쓴다. 의미는 서버 규칙에서 확인한 것:
 *   태세 쿨타임 = FLAG_ORDER_COOLDOWN_TICKS · 공격/방어 점수 = 병종 기본 + 테크 · 지금 값 = combatMath.channelValues
 *   교전 = 적대 깃발이 8방향으로 닿고 한쪽 이상이 공격 태세일 때 (combat.ts 간선) · 방어 원 = rules.guardContains (앵커에서 FRONT_RADIUS 칸 안 내 땅)
 */
const FP_HELP = {
  head: '이 부대의 주인과 깃발 번호(출전 슬롯)',
  troops: '부대 병력 — 교전·점령·노출 소모로 줄고, 0이 되면 패주(회색 점선 테두리)해 귀환합니다',
  posture: '공격 = 적·중립 칸을 점령하며 진격 · 방어 = 점령하지 않고 목적지 둘레 내 땅을 지킴. 방어 깃발을 적·중립 땅으로 보내면 공격으로 바뀝니다. 바꾸면 재지정과 공용인 쿨타임이 돌고 진척도가 0이 됩니다',
  status: `행군·교전·귀환·대기 상태와 표시: 전투 중(적 깃발과 맞붙음) · 패주 · 대치(적 깃발에 길이 막힘) · 이탈 대기(전투에서 빠지는 중, 전투력 −${(1000 - DISENGAGE_VALUE_PERMILLE_V2) / 10}%) · 정체(5초 동안 한 칸도 못 밂)`,
  atkdef: '병종 기본 + 테크 점수. 지형·기지·사기는 빼고 본 값 — 지금 태세 쪽이 밝게 보입니다',
  capture: '땅 한 칸을 점령할 때 깃발에서 빠지는 병력. 앞 숫자 = 보급 거리 안 중립 평원 기준, 목표 칸 = 지금 밀고 있는 칸(지형·인접·보급 거리 반영)',
  morale: '사기 막대 — 공격력·방어력에 같은 배율로 곱해집니다. 흰 눈금 = 색이 바뀌는 구간 (위쪽 눈금은 검·기병의 전투력 ±0 경계). 교전하면 줄고, 쉬거나 내 기지 위에 있으면 회복',
  moraleDetail:
    '사기 배율 = 지금 사기가 공격력·방어력에 곱하는 값 · 사기 0 → 100% = 배율 범위 · ±0 경계 = 배율이 ±0이 되는 사기 (창병은 늘 보너스) · 교전 중 = 지금 태세의 초당 감소와 병력 손실 1%당 추가 감소 · 회복 = 교전 밖 초당 회복(내 기지 위는 더 빠름) · 기지 사기 하한 = 내 기지 칸 위에서는 이 아래로 떨어지지 않고, 아래면 전투 중에도 여기까지 회복',
  now: '지형·기지·사기·이탈 대기·골드 빚을 모두 반영한 지금 공격/방어 값 — 교전 손실은 양쪽 이 값의 비교로 나뉩니다',
  engage: '지금 상태가 이어질 때 이 교전에서 양쪽이 잃을 병력 비율 예상',
  base: '내 기지 칸 위에서는 지형 보정 대신 기지 보정을 받습니다',
  eta: '목적지에 닿아 행동을 시작하기까지 남은 시간',
  progress: '지금 점령 중인 칸의 진척도 — 100%가 되면 그 칸을 차지합니다',
} as const;

/** 맵 위 선·원 범례 (renderer.ts 에서 그리는 것) */
const MAP_LEGEND: [string, string][] = [
  ['파란 점선 + ✕', '방어 태세 부대 → 목적지(앵커) 칸. ✕ 가 목적지 (공격 태세면 빨간 점선)'],
  ['파란 점선 원', '출전 조준 중 내 땅을 가리키면 보이는 방어 범위 미리보기 — 목적지에서 6칸 안 내 땅을 지킵니다. 원 안에 내 땅이 하나도 안 남으면 부대는 대기로 바뀝니다'],
  ['움직이는 점선 + 화살촉', '출전·이동 경로 미리보기 (빨강 = 공격, 파랑 = 방어, 회색 = 갈 수 없음)'],
  ['회색 점선 + 멈춤 표시', '방어 태세는 적 땅을 지나지 못해 그 앞에서 멈춥니다'],
  ['깃발 테두리 색', '빨강 = 공격 태세 · 파랑 = 방어 태세 · 회색 점선 = 패주'],
];

function FlagPanel({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 100);
  const [help, setHelp] = useState(false);
  const [moraleOpen, setMoraleOpen] = useState(false); // 2026-11-06: 사기 상세 = 접기 (기본 닫힘)
  const g = store.game;
  const id = ctl.ix.selectedFlagId;
  const f = id !== null ? g?.flags.get(id) : undefined;
  if (!g || !f) return null;
  const mine = ctl.myFlag(f.id) && ctl.canCommand() && !narrow;
  const cd = Math.max(0, f.orderCooldownUntilTick - g.tick);
  const eta = g.flagEta.get(f.id);
  const status = flagStatusParts(f, g.moraleRetreat.has(f.id)).join(' · ');
  const returning = f.state === 'RETURNING'; // v4.2 A-62: 귀환 중엔 모든 명령 거절
  // 2026-10-14: 공격력·방어력 (병종 기본 × 테크, 지형 보정 제외) — 그 깃발 주인의 테크
  const owner = g.players.get(f.ownerId);
  const cs = unitCombatStats(f.unit, owner?.techMask ?? 0, g.config.constants);
  const atkNow = f.posture === POSTURE.ATTACK;
  // v4.5 (§22.6): 자기 기지 칸 위면 태세와 무관하게 ×1.5 (방어 = 지형 대신, 공격 = 공격값에 곱) — 위 수치는 지형·기지 보정 제외
  const onOwnBase = g.bases.get(f.posTileId)?.ownerId === f.ownerId;
  const st = flagActionState(f, g.tick, g.config.tickMs, disengageTicksOf(g, f.ownerId));
  const md = moraleDetail(g, f); // §33 모델 2 에서만
  const ch = md ? null : flagChannels(g, f);
  const nowCh = md ? md.now : ch; // 지형·기지·사기·이탈·빚 반영한 지금 공격/방어
  const ep = engagePreview(g, f); // §33 교전 중일 때만
  // 2026-10-28: 점령 소모 = 칸당 병력 (배율 대신). 목표 칸이 있으면 그 칸의 실제 비용
  const capBase = neutralPlainCost(g, f.ownerId, f.unit);
  const capTarget = f.targetTileId !== null && f.posture === POSTURE.ATTACK ? captureCost(g, ctl.renderer.topo, f.ownerId, f.unit, f.targetTileId) : null;
  return (
    <div className={`flag-panel ${help ? 'with-help' : ''}`}>
      <div className="flag-panel-head" title={FP_HELP.head}>
        <span className="dot" style={{ background: playerColor(f.ownerId) }} />
        <b>{store.nicknameOf(f.ownerId)}</b> · 깃발 #{f.slotIndex + 1}
        <button className={`fp-help-btn ${help ? 'on' : ''}`} onClick={() => setHelp(!help)} title="각 항목 설명 · 맵 표시 범례" aria-label="깃발 패널 설명" aria-expanded={help}>
          <HelpIcon size={14} />
        </button>
      </div>
      <div className="flag-panel-body">
        <div className="fp-line">
          <span title={FP_HELP.troops}>
            <UnitIcon unit={f.unit as Unit} size={18} withName /> <b>{f.troops.toLocaleString()}</b>
          </span>
          <span className="fp-posture" title={FP_HELP.posture}>
            <PostureIcon posture={f.posture} size={13} /> <b className={f.posture === POSTURE.ATTACK ? 'atk' : 'def'}>{POSTURE_NAME[f.posture]}</b>
            {cd > 0 && <span className="muted"> 쿨타임 {Math.ceil((cd * g.config.tickMs) / 1000)}초</span>}
          </span>
        </div>
        <div className="muted" title={FP_HELP.status}>
          {status}
        </div>
        <div className="combat-stats" aria-label="전투값">
          <div className="cs-row cs-pair">
            <span className={`cs-cell ${atkNow ? 'now' : ''}`} title={`${FP_HELP.atkdef} · 기본 ${fmtPts(cs.atkBase)} + 테크 ${cs.atkTechPts}`}>
              <PostureIcon posture={POSTURE.ATTACK} size={13} /> 공격력 <b>{fmtPts(cs.atk)}</b>
            </span>
            <span className={`cs-cell ${!atkNow ? 'now' : ''}`} title={`${FP_HELP.atkdef} · 기본 ${fmtPts(cs.defBase)} + 테크 ${cs.defTechPts}`}>
              <PostureIcon posture={POSTURE.DEFEND} size={13} /> 방어력 <b>{fmtPts(cs.def)}</b>
            </span>
          </div>
          {nowCh !== null && (
            <div className="cs-row" data-testid="flag-now" title={FP_HELP.now}>
              지금 공격 <b>{fmtPts(nowCh[0])}</b> · 방어 <b>{fmtPts(nowCh[1])}</b>
            </div>
          )}
          <div className="cs-row" title={FP_HELP.capture}>
            점령 <b>{capBase}명</b>
            {capTarget !== null && (
              <span className="muted small">
                {' '}
                · 목표 칸 <b>{capTarget}명</b>
              </span>
            )}
          </div>
          {(owner?.gold ?? 0) < 0 && (
            <div className="cs-row debt-row" data-testid="debt-note" title="골드가 마이너스인 동안 걸리는 벌칙">
              골드 빚 — 전투력 −30% · 점령 속도 −50% · 점령 소모 +50%
            </div>
          )}
          {md !== null && (
            <>
              <div className="cs-row morale-row" data-testid="flag-morale" title={FP_HELP.morale}>
                사기
                <span className={`mbar wide ${md.view.tone}`} role="img" aria-label={md.view.text}>
                  <i style={{ width: `${md.view.pct}%` }} />
                  <u style={{ left: `${md.view.bands.low / 10}%` }} />
                  <u style={{ left: `${md.view.bands.mid / 10}%` }} />
                  {md.baseFloor !== null && <s style={{ left: `${md.baseFloor / 10}%` }} title="기지 사기 하한" />}
                </span>
                <b>{md.view.pct}%</b>
                <button className={`btn-link fp-more ${moraleOpen ? 'on' : ''}`} onClick={() => setMoraleOpen(!moraleOpen)} aria-expanded={moraleOpen} title="사기가 바꾸는 값 · 증감 속도">
                  {moraleOpen ? '접기' : '상세'}
                </button>
              </div>
              {moraleOpen && (
                <div className="morale-effects" data-testid="morale-detail">
                  {moraleDetailRows(f, md).map(([k, v, cls]) => (
                    <div key={k} className={`me-row ${cls ?? ''}`}>
                      <span className="muted">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {ep !== null && (
            <div className={`cs-row engage-preview ${ep.verdict}`} data-testid="engage-preview" title={`${FP_HELP.engage} · 깃발 ${ep.flagCount}개가 얽힌 교전${ep.ratio !== null ? ` · 교환비 1 : ${ep.ratio.toFixed(1)}` : ''}`}>
              교전 예상 <b>{ep.text}</b>
            </div>
          )}
          {onOwnBase && (
            <div className="cs-base" title={FP_HELP.base}>
              기지 위 <b>{g.config.combatModel === 2 ? `방어력 ${pctOfPm(BASE_BUFF[f.posture][1])}` : '+50%'}</b>
            </div>
          )}
        </div>
        {f.state === 'MARCHING' && eta !== undefined && <div title={FP_HELP.eta}>도착까지 약 {Math.max(0, Math.ceil(((eta - g.tick) * g.config.tickMs) / 1000))}초</div>}
        {f.posture === POSTURE.ATTACK && f.state === 'ENGAGED' && <div title={FP_HELP.progress}>점령 진척 {f.progressPct}%</div>}
      </div>
      {mine && (
        <div className="flag-panel-actions">
          <button className="btn" disabled={!!st.postureBlocked} onClick={() => ctl.togglePosture()} title={st.postureBlocked ?? (st.combatWarning ? `단축키 F · ${st.combatWarning}` : '단축키 F — 태세를 바꿉니다 (진척도 0, 재지정과 공용 쿨타임)')}>
            <kbd>F</kbd> {f.posture === POSTURE.ATTACK ? '방어로' : '공격으로'}
          </button>
          {st.combatWarning !== null && <span className="fa-warn small">{st.combatWarning}</span>}
          <button className="btn" disabled={f.routed || returning} onClick={() => ctl.recallSelected()} title="단축키 R — 가까운 내 기지로 돌아갑니다 (취소 불가)">
            <kbd>R</kbd> 귀환
          </button>
          {returning && <span className="muted small">귀환 중</span>}
        </div>
      )}
      {help && (
        <div className="fp-help" role="note" aria-label="깃발 패널 설명">
          <dl>
            <dt>병종 · 병력</dt>
            <dd>{FP_HELP.troops}</dd>
            <dt>태세</dt>
            <dd>{FP_HELP.posture}</dd>
            <dt>상태 줄</dt>
            <dd>{FP_HELP.status}</dd>
            <dt>공격력 · 방어력</dt>
            <dd>{FP_HELP.atkdef}</dd>
            <dt>점령 소모</dt>
            <dd>{FP_HELP.capture}</dd>
            {md !== null && (
              <>
                <dt>사기</dt>
                <dd>{FP_HELP.morale}</dd>
                <dt>사기 상세 (접기)</dt>
                <dd>{FP_HELP.moraleDetail}</dd>
                <dt>지금 공격 / 방어</dt>
                <dd>{FP_HELP.now}</dd>
              </>
            )}
            <dt>교전 예상 · 기지 위</dt>
            <dd>
              {FP_HELP.engage}. {FP_HELP.base}
            </dd>
            <dt>F · R 버튼 (부대 옆에도 뜸)</dt>
            <dd>F = 태세 바꾸기, R = 가까운 기지로 귀환. 전투 중·패주·귀환 중에는 막힙니다</dd>
          </dl>
          <div className="fp-help-sub">맵 표시</div>
          <dl>
            {MAP_LEGEND.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
          </dl>
          <div className="muted small">방어 태세끼리는 싸우지 않습니다 — 적 깃발과 8방향으로 닿고 한쪽이라도 공격 태세면 교전합니다.</div>
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
