/**
 * 테크 창 v4.3 — 01b 5.2 안 A(갈래 열 × 티어 줄 격자), 좁은 화면은 5.3 안 B(갈래 탭 + 세로 트리).
 * 열기/닫기: HUD "테크" 버튼 · T · Esc(상세 → 창 순서) · 창 바깥 클릭. 게임은 계속 돈다(맵을 다 가리지 않는 반투명 창).
 * 노드 상태 5종(techTree.ts)은 색 + 테두리 모양 + 기호로 구분(색각 보조). 구매는 상세 패널의 버튼으로만(cmd_buy_tech{nodeId}).
 * 보는 플레이어 = store.viewerId (관전·탈락·종료 후 따라가기 대상의 트리도 볼 수 있다, 구매는 나만·명령 가능할 때만).
 */
import { useEffect, useState } from 'react';
import { TECH_BRANCH_COUNT, TECH_BRANCH_NAME, type TechNodeDef, type Unit } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameInputController } from '../input/controller.js';
import { usePolled } from './hooks.js';
import { goldPerSecond, techNodes } from './techInfo.js';
import { fmtWait, secondsToAfford, techAncestors, techDetailRows, techLayout, techNodeViews, techPriceInfo, techScopeText, purchasableByBranch, type TechNodeState, type TechNodeView } from './techTree.js';
import { StateGlyph, TechIcon } from './techIcons.js';
import { UnitIcon } from './unitIcons.js';
import { useDraggableWindow } from './draggable.js';

/** 갈래 색 (어두운 패널 #1c2733 위 대비 4.5:1 이상). 병종 3갈래는 공통 강철 회색 + 병종 미니 기호 (01b 5.1) */
export const TECH_BRANCH_COLOR = ['#e8826a', '#e6b93f', '#62c472', '#62aef2', '#aab7c5', '#aab7c5', '#aab7c5'] as const;
/** 갈래 0..3 = 공통, 4..6 = 병종(창·검·기) */
const unitOfBranch = (b: number): Unit | null => (b >= 4 ? ((b - 4) as Unit) : null);
const ROMAN = ['I', 'II', 'III'] as const;

export const STATE_NAME: Record<TechNodeState, string> = {
  owned: '보유',
  pending: '구매 요청 중',
  buyable: '구매 가능',
  short: '골드 부족',
  locked: '잠김',
};

function closeTech(ctl: GameInputController): void {
  ctl.ix.panel = null;
  ctl.ix.techDetail = null;
  ctl.ix.bump();
}

export function TechWindow({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => ctl.ix.version * 1_000_003 + (store.game?.version ?? 0) * 31 + store.pendingTechNodes().size + store.getVersion() * 7, 150);
  // 2026-10-14: 제목 줄 드래그 (좁은 화면 시트는 고정)
  const drag = useDraggableWindow<HTMLDivElement>('tech', !narrow);
  const rootRef = drag.ref;
  const [hover, setHover] = useState<number | null>(null);
  const open = ctl.ix.panel === 'tech';

  // 바깥 클릭으로 닫기 — 캡처 단계에서 받아 맵 클릭(출전 등)으로 이어지지 않게 한다. 토글 버튼은 자기 onClick 이 처리.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Element | null;
      if (!t || rootRef.current?.contains(t) || t.closest?.('[data-tech-toggle]')) return;
      // 도움말·옵션·나가기 대화상자 위 클릭은 그 창의 일이다
      if (t.closest?.('.overlay, .help, .options-panel')) return;
      closeTech(ctl);
      if (t.tagName === 'CANVAS') {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('touchstart', onDown, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('touchstart', onDown, true);
    };
  }, [open, ctl]);

  const g = store.game;
  if (!g || !open) return null;
  const consts = g.config.constants;
  const me = store.myPlayerId;
  const viewerId = store.viewerId;
  const viewer = viewerId !== null ? g.players.get(viewerId) : undefined;
  const mine = viewer !== undefined && viewer.id === me;
  const canBuy = mine && ctl.canCommand();
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  const nodes = techNodes(consts);

  const head = (
    <div className="tw-head drag-handle" {...drag.handleProps}>
      <b>테크</b>
      {viewer && !mine && <span className="tw-who">{store.nicknameOf(viewer.id)}의 트리 · 보기 전용</span>}
      {viewer && mine && !canBuy && <span className="tw-who">{over ? '게임 종료 · 보기 전용' : '보기 전용'}</span>}
      {viewer && (
        <span className="tw-gold">
          골드 <b>{viewer.gold.toLocaleString()}</b>
          <span className="muted"> (+{goldPerSecond(viewer.goldWeight, viewer.techMask, viewer.upkeepPm, consts).net.toFixed(1)}/초)</span>
          <span className="muted"> · 구매 {viewer.techCount}회</span>
        </span>
      )}
      <button className="btn btn-x" onClick={() => closeTech(ctl)} aria-label="테크 창 닫기 (Esc)" title="닫기 (Esc)">
        ×
      </button>
    </div>
  );

  if (!viewer) {
    return (
      <div ref={rootRef} className={`tech-window ${narrow ? 'tw-narrow' : ''}`} style={drag.style} role="dialog" aria-label="테크">
        {head}
        <p className="muted">순위표에서 플레이어 이름을 누르면 그 플레이어의 테크 트리가 보입니다.</p>
      </div>
    );
  }

  const views = techNodeViews(viewer, consts, mine ? store.pendingTechNodes() : undefined);
  const selected = ctl.ix.techDetail !== null ? (views[ctl.ix.techDetail] ?? null) : null;
  const pick = (id: number) => {
    ctl.ix.techDetail = ctl.ix.techDetail === id ? null : id;
    ctl.ix.bump();
  };
  const hoverPath = hover !== null ? techAncestors(nodes, hover) : null;
  const detail = selected && (
    <TechDetailPanel
      key={selected.node.id}
      view={selected}
      nodes={nodes}
      store={store}
      ctl={ctl}
      canBuy={canBuy}
      over={over}
      mine={mine}
      onClose={() => ((ctl.ix.techDetail = null), ctl.ix.bump())}
    />
  );

  return (
    <div ref={rootRef} className={`tech-window ${narrow ? 'tw-narrow' : ''}`} style={drag.style} role="dialog" aria-label="테크 트리">
      {head}
      {narrow ? (
        <NarrowTree views={views} nodes={nodes} ctl={ctl} techCount={viewer.techCount} selectedId={selected?.node.id ?? null} onPick={pick} />
      ) : (
        <div className="tw-body">
          <TechGrid views={views} nodes={nodes} techCount={viewer.techCount} selectedId={selected?.node.id ?? null} hoverPath={hoverPath} onHover={setHover} onPick={pick} />
          {detail ?? <div className="tw-detail tw-detail-empty muted">노드를 누르면 효과·가격·선행 조건을 봅니다.{canBuy ? ' 구매는 상세 창의 버튼으로 합니다.' : ''}</div>}
        </div>
      )}
      {narrow && detail}
      <Legend />
    </div>
  );
}

// ───────────── 격자 (안 A) ─────────────

const COL = 118;
const GROUP_GAP = 20;
const ROW = 96;
const TOP = 30;
const LEFT = 24;
const NODE = 44;

function colLeft(branch: number): number {
  return LEFT + branch * COL + (branch >= 4 ? GROUP_GAP : 0);
}

function TechGrid({
  views,
  nodes,
  techCount,
  selectedId,
  hoverPath,
  onHover,
  onPick,
}: {
  views: TechNodeView[];
  nodes: readonly TechNodeDef[];
  techCount: number;
  selectedId: number | null;
  hoverPath: Set<number> | null;
  onHover: (id: number | null) => void;
  onPick: (id: number) => void;
}) {
  const layout = techLayout(nodes);
  const pos = (id: number) => {
    const l = layout[id];
    return { x: colLeft(l.branch) + l.fx * COL, y: TOP + (l.tier - 1) * ROW + NODE / 2 + 4 };
  };
  const width = colLeft(TECH_BRANCH_COUNT - 1) + COL;
  const height = TOP + 3 * ROW - 8;
  return (
    <div className="tw-grid-wrap">
      <div className="tw-grid" style={{ width, height }}>
        {Array.from({ length: TECH_BRANCH_COUNT }, (_, b) => (
          <div key={b} className="tw-col-head" style={{ left: colLeft(b), width: COL, color: TECH_BRANCH_COLOR[b] }}>
            <BranchMark branch={b} />
            <span>{TECH_BRANCH_NAME[b]}</span>
          </div>
        ))}
        <div className="tw-divider" style={{ left: colLeft(4) - GROUP_GAP / 2, top: TOP - 4, height: height - TOP }} aria-hidden="true" />
        {ROMAN.map((r, i) => (
          <div key={r} className="tw-row-head" style={{ top: TOP + i * ROW + NODE / 2 - 4 }} aria-hidden="true">
            {r}
          </div>
        ))}
        <svg className="tw-lines" width={width} height={height} aria-hidden="true">
          {views.map(({ node }) => {
            if (node.parent === null) return null;
            const a = pos(node.parent);
            const b = pos(node.id);
            const parentOwned = views[node.parent].state === 'owned';
            const hot = hoverPath?.has(node.id) && hoverPath.has(node.parent);
            return (
              <line
                key={node.id}
                x1={a.x}
                y1={a.y + NODE / 2 + 2}
                x2={b.x}
                y2={b.y - NODE / 2 - 2}
                stroke={parentOwned ? TECH_BRANCH_COLOR[node.branch] : '#6b7a8a'}
                strokeWidth={(parentOwned ? 2 : 1) + (hot ? 2 : 0)}
                strokeDasharray={parentOwned ? undefined : '4 3'}
                opacity={hoverPath && !hot ? 0.55 : 1}
              />
            );
          })}
        </svg>
        {views.map((v) => {
          const p = pos(v.node.id);
          return <TechNodeButton key={v.node.id} view={v} x={p.x} y={p.y} techCount={techCount} selected={selectedId === v.node.id} onHover={onHover} onPick={onPick} />;
        })}
      </div>
    </div>
  );
}

function BranchMark({ branch, size = 14 }: { branch: number; size?: number }) {
  const u = unitOfBranch(branch);
  if (u !== null) return <UnitIcon unit={u} size={size} title={`${TECH_BRANCH_NAME[branch]} 갈래`} />;
  // 공통 갈래 = 그 갈래 1티어 노드 아이콘 (MIL-1 0, ECO-1 5, TER-1 10, MOB-1 15)
  return <TechIcon nodeId={branch * 5} size={size} />;
}

function TechNodeButton({
  view,
  x,
  y,
  techCount,
  selected,
  onHover,
  onPick,
  labelWidth = 58,
}: {
  view: TechNodeView;
  x: number;
  y: number;
  techCount: number;
  selected: boolean;
  onHover?: (id: number | null) => void;
  onPick: (id: number) => void;
  labelWidth?: number;
}) {
  const { node, state, cost, progress } = view;
  const color = TECH_BRANCH_COLOR[node.branch];
  const unit = unitOfBranch(node.branch);
  const R = NODE / 2 + 3;
  const circumference = 2 * Math.PI * R;
  const label = `${node.name} · ${TECH_BRANCH_NAME[node.branch]} ${node.tier}티어 · ${STATE_NAME[state]}${state === 'short' || state === 'buyable' ? ` · ${cost.toLocaleString()} 골드` : ''}`;
  return (
    <>
      <button
        className={`tnode s-${state} ${selected ? 'sel' : ''}`}
        style={{ left: x - NODE / 2, top: y - NODE / 2, ['--bc' as string]: color }}
        onClick={() => onPick(node.id)}
        onMouseEnter={() => onHover?.(node.id)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(node.id)}
        onBlur={() => onHover?.(null)}
        aria-label={label}
        aria-pressed={selected}
        title={`${node.name} — ${node.desc}`}
      >
        <TechIcon nodeId={node.id} size={24} />
        {state === 'short' && (
          <svg className="tnode-ring" width={2 * R + 4} height={2 * R + 4} aria-hidden="true">
            <circle cx={R + 2} cy={R + 2} r={R} className="ring-bg" />
            <circle cx={R + 2} cy={R + 2} r={R} className="ring-fg" strokeDasharray={`${circumference * progress} ${circumference}`} transform={`rotate(-90 ${R + 2} ${R + 2})`} />
          </svg>
        )}
        {unit !== null && (
          <span className="tnode-unit" aria-hidden="true">
            <UnitIcon unit={unit} size={11} />
          </span>
        )}
        {state === 'locked' && (
          <span className="tnode-badge tr" aria-hidden="true">
            <StateGlyph kind="lock" size={11} />
          </span>
        )}
        {state === 'pending' && (
          <span className="tnode-badge tr pending" aria-hidden="true">
            <StateGlyph kind="clock" size={11} />
          </span>
        )}
        {state === 'owned' && (
          <span className="tnode-badge bc" aria-hidden="true">
            <StateGlyph kind="check" size={10} />
          </span>
        )}
      </button>
      <div className={`tnode-label s-${state}`} style={{ left: x - labelWidth / 2, top: y + NODE / 2 + (state === 'owned' ? 8 : 4), width: labelWidth }} aria-hidden="true">
        <span className="tn-name">{node.name}</span>
        {state === 'owned' ? null : state === 'locked' ? null : (
          <span key={techCount} className="tn-price">
            {cost.toLocaleString()}
          </span>
        )}
      </div>
    </>
  );
}

// ───────────── 좁은 화면 (안 B: 갈래 탭 + 세로 트리) ─────────────

function NarrowTree({
  views,
  nodes,
  ctl,
  techCount,
  selectedId,
  onPick,
}: {
  views: TechNodeView[];
  nodes: readonly TechNodeDef[];
  ctl: GameInputController;
  techCount: number;
  selectedId: number | null;
  onPick: (id: number) => void;
}) {
  const tab = ctl.ix.techTab;
  const dots = purchasableByBranch(views);
  const layout = techLayout(nodes);
  const W = 240;
  const RW = 84;
  const inTab = views.filter((v) => v.node.branch === tab);
  const pos = (id: number) => ({ x: 8 + layout[id].fx * W, y: 8 + NODE / 2 + (layout[id].tier - 1) * RW });
  const height = 8 + 3 * RW;
  return (
    <>
      <div className="tw-tabs" role="tablist" aria-label="갈래">
        {Array.from({ length: TECH_BRANCH_COUNT }, (_, b) => (
          <button
            key={b}
            role="tab"
            aria-selected={tab === b}
            className={`tw-tab ${tab === b ? 'on' : ''}`}
            style={{ ['--bc' as string]: TECH_BRANCH_COLOR[b] }}
            onClick={() => ((ctl.ix.techTab = b), ctl.ix.bump())}
            title={TECH_BRANCH_NAME[b]}
          >
            <BranchMark branch={b} size={16} />
            <span className="tw-tab-name">{TECH_BRANCH_NAME[b]}</span>
            {dots[b] && <span className="tw-tab-dot" aria-label="살 수 있음" />}
          </button>
        ))}
      </div>
      <div className="tw-vtree" style={{ width: W + 16, height }}>
        <svg className="tw-lines" width={W + 16} height={height} aria-hidden="true">
          {inTab.map(({ node }) => {
            if (node.parent === null) return null;
            const a = pos(node.parent);
            const b = pos(node.id);
            const owned = views[node.parent].state === 'owned';
            return (
              <line
                key={node.id}
                x1={a.x}
                y1={a.y + NODE / 2 + 2}
                x2={b.x}
                y2={b.y - NODE / 2 - 2}
                stroke={owned ? TECH_BRANCH_COLOR[node.branch] : '#6b7a8a'}
                strokeWidth={owned ? 2 : 1}
                strokeDasharray={owned ? undefined : '4 3'}
              />
            );
          })}
        </svg>
        {inTab.map((v) => {
          const p = pos(v.node.id);
          return <TechNodeButton key={v.node.id} view={v} x={p.x} y={p.y} techCount={techCount} selected={selectedId === v.node.id} onPick={onPick} labelWidth={96} />;
        })}
      </div>
    </>
  );
}

// ───────────── 상세 패널 ─────────────

function TechDetailPanel({
  view,
  nodes,
  store,
  ctl,
  canBuy,
  over,
  mine,
  onClose,
}: {
  view: TechNodeView;
  nodes: readonly TechNodeDef[];
  store: ClientStore;
  ctl: GameInputController;
  canBuy: boolean;
  over: boolean;
  mine: boolean;
  onClose: () => void;
}) {
  const g = store.game!;
  const consts = g.config.constants;
  const viewer = g.players.get(store.viewerId!)!;
  const { node, state } = view;
  const color = TECH_BRANCH_COLOR[node.branch];
  const parent = node.parent !== null ? nodes[node.parent] : null;
  const parentOwned = parent ? ((viewer.techMask >>> parent.id) & 1) === 1 : true;
  const price = techPriceInfo(node.tier, viewer.techCount, consts);
  const inc = goldPerSecond(viewer.goldWeight, viewer.techMask, viewer.upkeepPm, consts);
  const wait = secondsToAfford(viewer.gold, price.cost, inc.net);
  const detail = techDetailRows(node, {
    consts,
    techMask: viewer.techMask,
    goldWeight: viewer.goldWeight,
    upkeepPm: viewer.upkeepPm,
    troopCap: (mask) => g.troopCapOf({ tiles: viewer.tiles, techMask: mask }),
    flagCap: (mask) => g.flagCapOf({ tiles: viewer.tiles, techMask: mask }),
  });
  const owned = state === 'owned';
  const buyLabel = owned
    ? '보유함'
    : state === 'pending'
      ? '구매 요청 중…'
      : !canBuy
        ? over
          ? '게임 종료 — 구매 불가'
          : mine
            ? '구매 불가 (탈락·관전)'
            : '보기 전용'
        : state === 'locked'
          ? '선행 노드 필요'
          : state === 'short'
            ? '골드 부족'
            : `구매 — ${price.cost.toLocaleString()} 골드`;
  const enabled = canBuy && state === 'buyable';
  return (
    <section className="tw-detail" aria-label={`${node.name} 상세`}>
      <div className="twd-head">
        <span className={`twd-icon s-${state}`} style={{ ['--bc' as string]: color }}>
          <TechIcon nodeId={node.id} size={30} />
        </span>
        <div className="twd-title">
          <b>{node.name}</b>
          <span className="muted small">
            {TECH_BRANCH_NAME[node.branch]} · {node.tier}티어 · {node.code} · <span className={`twd-state s-${state}`}>{STATE_NAME[state]}</span>
          </span>
        </div>
        <button className="btn btn-x" onClick={onClose} aria-label="상세 닫기" title="상세 닫기 (Esc)">
          ×
        </button>
      </div>
      <p className="twd-desc">{node.desc}</p>
      <div className="twd-stats" role="table" aria-label={`${detail.beforeLabel} → ${detail.afterLabel}`}>
        {detail.rows.map((r, i) => (
          <div key={i} className={`twd-row ${r.changed ? 'chg' : ''}`} role="row">
            <div className="twd-k" role="rowheader">
              {r.label}
            </div>
            <div className="twd-v" role="cell">
              <span className="muted small">{detail.beforeLabel}</span> <span className="num">{r.before}</span> <span className="arrow" aria-label="에서">→</span>{' '}
              <span className="muted small">{detail.afterLabel}</span> <span className="num after">{r.after}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">{techScopeText(node)} · 다른 보유 노드까지 합친 실제 값</p>
      <dl className="twd-facts">
        <dt>선행</dt>
        <dd>
          {parent ? (
            <>
              {parent.name} <span className={parentOwned ? 'ok-text' : 'warn-text'}>{parentOwned ? '✓ 보유' : '✗ 미보유'}</span>
            </>
          ) : (
            '없음 (1티어)'
          )}
        </dd>
        {!owned && (
          <>
            <dt>가격</dt>
            <dd>
              <b key={viewer.techCount} className="tn-price-big">
                {price.cost.toLocaleString()} 골드
              </b>{' '}
              <span className="muted small">
                (기본 {price.base} · 구매 {price.purchased}회 반영 +{price.surchargePct}%)
              </span>
            </dd>
            <dt>골드</dt>
            <dd>
              {viewer.gold.toLocaleString()}
              {wait === 0 ? <span className="ok-text"> — 지금 살 수 있음</span> : wait === null ? <span className="warn-text"> — 순수입이 없어 모이지 않음</span> : <span> → {fmtWait(wait)} (순수입 +{inc.net.toFixed(1)}/초)</span>}
            </dd>
          </>
        )}
      </dl>
      {!owned && <p className="muted small">하나 살 때마다 남은 모든 노드 가격이 6% 오릅니다 (갈래 무관, 다음 구매 시 이 노드 {price.nextCost.toLocaleString()}). 효과는 즉시, 되돌릴 수 없음.</p>}
      <button
        className={`btn twd-buy ${enabled ? 'btn-primary' : ''}`}
        disabled={!enabled}
        onClick={() => {
          if (!enabled) return;
          store.buyTech(node.id);
          ctl.ix.bump();
        }}
      >
        {buyLabel}
      </button>
    </section>
  );
}

function Legend() {
  const items: TechNodeState[] = ['owned', 'buyable', 'short', 'pending', 'locked'];
  return (
    <div className="tw-legend small" aria-label="노드 상태 범례">
      {items.map((s) => (
        <span key={s} className="tw-legend-item">
          <span className={`tnode-mini s-${s}`} style={{ ['--bc' as string]: TECH_BRANCH_COLOR[3] }} aria-hidden="true">
            {s === 'owned' && <StateGlyph kind="check" size={9} />}
            {s === 'locked' && <StateGlyph kind="lock" size={9} />}
            {s === 'pending' && <StateGlyph kind="clock" size={9} />}
          </span>
          {STATE_NAME[s]}
        </span>
      ))}
      <span className="muted"> · T 열기/닫기 · Esc 닫기</span>
    </div>
  );
}

