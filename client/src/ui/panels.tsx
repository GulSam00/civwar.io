/**
 * 인게임 패널 — 외교(동맹) · 순위표(관전 따라가기) · 이벤트 피드. (테크 창은 TechWindow.tsx)
 * 모두 store.game 을 주기적으로 읽어 그린다(usePolled). 명령은 store 메서드 → cmd_* → cmd_ack 로만 결과 확인.
 */
import { useState } from 'react';
import { ALLIANCE_CUTOFF_TICK, ALLIANCE_MIN_DURATION, MAX_ALLIES_PER_PLAYER } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameModel } from '../state/gameModel.js';
import type { GameInputController } from '../input/controller.js';
import { usePolled } from './hooks.js';
import { playerColor } from '../render/palette.js';
import { fmtClock } from './text.js';
import { useDraggableWindow } from './draggable.js';
import { fmtCompact } from './fmt.js';
import { LEADER_COL_NAME, LEADER_KEYS, diplomacyState, leaderboardRows, visibleLeaderRows, type LeaderKey, type LeaderRow } from './playerInfo.js';

function constOf<T>(g: GameModel, name: string, fallback: T): T {
  const v = g.config.constants?.[name];
  return (v === undefined ? fallback : v) as T;
}
const ticksToClock = (g: GameModel, ticks: number) => fmtClock(Math.max(0, ticks) * g.config.tickMs);

// ───────────────────────── 외교 ─────────────────────────

type Rel = ReturnType<typeof diplomacyState>['rel'];

export function DiplomacyPanel({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0), 200);
  // 2026-10-14: 제목 줄 드래그 (외교 창은 넓은 화면에서만 열린다)
  const drag = useDraggableWindow<HTMLDivElement>('ally');
  const g = store.game;
  const me = store.myPlayerId;
  if (!g || ctl.ix.panel !== 'ally') return null;
  const cutoff = constOf(g, 'ALLIANCE_CUTOFF_TICK', ALLIANCE_CUTOFF_TICK);
  const minDur = constOf(g, 'ALLIANCE_MIN_DURATION', ALLIANCE_MIN_DURATION);
  const maxAllies = constOf(g, 'MAX_ALLIES_PER_PLAYER', MAX_ALLIES_PER_PLAYER);
  const myAllies = me !== null ? [...g.alliances.values()].filter((a) => a.a === me || a.b === me).length : 0;
  const frozen = g.allianceFreezeUntilTick !== null && g.tick < g.allianceFreezeUntilTick;
  const closed = g.tick >= cutoff;
  const canAct = ctl.canCommand();
  const others = [...g.players.values()].filter((p) => p.id !== me && p.alive).sort((a, b) => b.tiles - a.tiles);
  return (
    <div ref={drag.ref} className="side-panel ally-panel" style={drag.style}>
      <div className="side-head drag-handle" {...drag.handleProps}>
        <b>외교</b>
        <span className="muted small">
          {' '}
          동맹 {myAllies}/{maxAllies}
        </span>
        <button className="btn btn-x" onClick={() => ((ctl.ix.panel = null), ctl.ix.bump())} aria-label="닫기">
          ×
        </button>
      </div>
      <div className="ally-timers small">
        {closed ? <span className="warn">신규 동맹 마감됨</span> : <span>신규 동맹 마감까지 {ticksToClock(g, cutoff - g.tick)}</span>}
        {frozen && <span className="warn"> · 재체결 금지 {ticksToClock(g, g.allianceFreezeUntilTick! - g.tick)}</span>}
        {g.lockoutDissolveTick !== null && <span className="warn"> · 전원 동맹 — 강제 해제까지 {ticksToClock(g, g.lockoutDissolveTick - g.tick)}</span>}
      </div>
      <ul className="ally-list">
        {others.map((p) => {
          const r = me !== null ? diplomacyState(g, me, p.id) : { rel: 'none' as Rel, proposalId: undefined, since: undefined, breakAt: undefined, expire: undefined };
          return (
            <li key={p.id}>
              <span className="dot" style={{ background: playerColor(p.id) }} />
              <button className="nick btn-link nick-link" onClick={() => openCard(ctl, p.id)} title="정보 카드">
                {store.nicknameOf(p.id)}
              </button>
              <span className="muted small">{((p.tiles * 100) / g.config.totalLandTiles).toFixed(1)}%</span>
              <span className="ally-actions">
                {r.rel === 'active' && (
                  <>
                    <span className="tag ok">동맹</span>
                    <button
                      className="btn btn-sm"
                      disabled={!canAct || g.tick < (r.since ?? 0) + minDur}
                      title={g.tick < (r.since ?? 0) + minDur ? `성립 후 ${Math.round((minDur * g.config.tickMs) / 1000)}초가 지나야 파기 가능` : '파기하면 30초 뒤 해제 (그동안 서로 공격 불가)'}
                      onClick={() => store.breakAlly(p.id)}
                    >
                      {g.tick < (r.since ?? 0) + minDur ? `파기 ${ticksToClock(g, (r.since ?? 0) + minDur - g.tick)}` : '파기'}
                    </button>
                  </>
                )}
                {r.rel === 'breaking' && <span className="tag warn-tag">해제까지 {ticksToClock(g, (r.breakAt ?? g.tick) - g.tick)}</span>}
                {r.rel === 'incoming' && (
                  <>
                    <button className="btn btn-sm btn-primary" disabled={!canAct} onClick={() => store.respondAlly(r.proposalId!, true)}>
                      수락
                    </button>
                    <button className="btn btn-sm" disabled={!canAct} onClick={() => store.respondAlly(r.proposalId!, false)}>
                      거절
                    </button>
                  </>
                )}
                {r.rel === 'outgoing' && <span className="tag">제안함 {ticksToClock(g, (r.expire ?? g.tick) - g.tick)}</span>}
                {r.rel === 'none' && (
                  <button className="btn btn-sm" disabled={!canAct || closed || frozen || myAllies >= maxAllies} onClick={() => store.proposeAlly(p.id)}>
                    동맹 제안
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 나에게 온 동맹 제안 — 패널을 닫아도 보이는 알림 */
export function IncomingProposals({ store, ctl }: { store: ClientStore; ctl: GameInputController }) {
  usePolled(() => store.game?.version ?? 0, 250);
  const g = store.game;
  const me = store.myPlayerId;
  if (!g || me === null || !ctl.canCommand()) return null;
  const incoming = [...g.proposals.values()].filter((p) => p.toPlayerId === me);
  if (!incoming.length) return null;
  return (
    <div className="incoming">
      {incoming.map((pr) => (
        <div key={pr.proposalId} className="incoming-card">
          <span className="dot" style={{ background: playerColor(pr.fromPlayerId) }} />
          <b>{store.nicknameOf(pr.fromPlayerId)}</b> 동맹 제안 <span className="muted small">{ticksToClock(g, pr.expireTick - g.tick)}</span>
          <button className="btn btn-sm btn-primary" onClick={() => store.respondAlly(pr.proposalId, true)}>
            수락
          </button>
          <button className="btn btn-sm" onClick={() => store.respondAlly(pr.proposalId, false)}>
            거절
          </button>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── 순위표 ─────────────────────────

/** 플레이어 정보 카드 열기 (같은 사람이면 닫기) */
export function openCard(ctl: GameInputController, id: number, toggle = false): void {
  ctl.ix.cardPlayerId = toggle && ctl.ix.cardPlayerId === id ? null : id;
  ctl.ix.bump();
}

/** 넓은 화면 기본 표시 줄 수 (펼치면 전부) · 좁은 화면(OpenFront 처럼 4줄 + 내 줄) */
export const LEADER_TOP_WIDE = 8;
export const LEADER_TOP_NARROW = 4;

/**
 * 순위표 (2026-10-18 UI 개선 3) — 순위·이름·점유율·병력·골드·기지 표, 열 머리를 누르면 정렬(다시 누르면 방향 바꿈).
 * 위 N 줄 + 기준 플레이어(나, 관전이면 따라가는 사람)가 그 밖이면 맨 아래 고정. 줄을 누르면 정보 카드, 관전자는 따라가기도 켠다.
 * 좁은 화면은 #·이름·점유율·병력만.
 */
export function Scoreboard({ store, ctl, compact }: { store: ClientStore; ctl: GameInputController; compact: boolean }) {
  usePolled(() => (store.game?.version ?? 0) + store.getVersion() * 7 + ctl.ix.version * 131, 300);
  const [sort, setSort] = useState<{ key: LeaderKey; desc: boolean }>({ key: 'share', desc: true });
  const [expanded, setExpanded] = useState(false);
  const g = store.game;
  if (!g) return null;
  const me = store.myPlayerId;
  const viewer = store.viewerId;
  // 종료 후 둘러보기(사용자 요청 2026-10-10): 플레이어·탈락자·관전자 모두 순위표로 영토 따라가기
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  const spectator = over || me === null || !g.players.get(me)?.alive;
  const rows = leaderboardRows(g, store.names, sort.key, sort.desc);
  const topN = compact ? LEADER_TOP_NARROW : expanded ? rows.length : LEADER_TOP_WIDE;
  const { top, pinned } = visibleLeaderRows(rows, topN, viewer);
  const cols: LeaderKey[] = compact ? ['share', 'troops'] : [...LEADER_KEYS];
  const onRow = (id: number) => {
    openCard(ctl, id, true);
    if (spectator) store.setFollow(store.followPlayerId === id ? null : id);
  };
  const clickSort = (key: LeaderKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const row = (pl: LeaderRow, pin = false) => (
    <tr
      key={pin ? `pin-${pl.id}` : pl.id}
      className={`lb-row ${pl.id === viewer ? 'me' : ''} ${pl.alive ? '' : 'dead'} ${pin ? 'pinned' : ''} ${ctl.ix.cardPlayerId === pl.id ? 'sel' : ''} ${store.followPlayerId === pl.id ? 'following' : ''}`}
      onClick={() => onRow(pl.id)}
    >
      <td className="lb-rank">{pl.rank}</td>
      <td className="lb-name">
        <button className="lb-nick" onClick={(e) => (e.stopPropagation(), onRow(pl.id))} title={spectator ? '정보 카드 · 따라가기' : '정보 카드'}>
          <span className="dot" style={{ background: playerColor(pl.id) }} />
          {ctl.ix.colorblind && <span className="pnum">{pl.id}</span>}
          <span className="nick">{pl.name}</span>
          {me !== null && g.isAlly(me, pl.id) && <span className="tag ok">동맹</span>}
          {!pl.connected && pl.alive && <span className="tag">끊김</span>}
        </button>
      </td>
      {cols.map((k) => (
        <td key={k} className={`lb-num ${sort.key === k ? 'sorted' : ''}`}>
          {k === 'share' ? `${pl.share.toFixed(1)}%` : k === 'bases' ? pl.bases : fmtCompact(pl[k])}
        </td>
      ))}
    </tr>
  );
  return (
    <div className={`scoreboard leaderboard ${compact ? 'compact' : ''}`}>
      {spectator && (
        <div className="score-head small">
          {store.followPlayerId !== null ? (
            <>
              따라가는 중: <b>{store.nicknameOf(store.followPlayerId)}</b>{' '}
              <button className="btn-link" onClick={() => store.setFollow(null)}>
                자유 카메라
              </button>
            </>
          ) : (
            <span className="muted">이름을 누르면 따라가기</span>
          )}
        </div>
      )}
      <table className="lb-table">
        <thead>
          <tr>
            <th className="lb-rank">#</th>
            <th className="lb-name">이름</th>
            {cols.map((k) => (
              <th key={k} className="lb-num" aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button className={`lb-sort ${sort.key === k ? 'on' : ''}`} onClick={() => clickSort(k)} title={`${LEADER_COL_NAME[k]} 순으로 정렬`}>
                  {LEADER_COL_NAME[k]}
                  {sort.key === k ? (sort.desc ? ' ▾' : ' ▴') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {top.map((pl) => row(pl))}
          {pinned && (
            <>
              <tr className="lb-gap" aria-hidden="true">
                <td colSpan={2 + cols.length}>⋯</td>
              </tr>
              {row(pinned, true)}
            </>
          )}
        </tbody>
      </table>
      {!compact && rows.length > LEADER_TOP_WIDE && (
        <button className="btn-link lb-more small" onClick={() => setExpanded(!expanded)}>
          {expanded ? '접기' : `전체 ${rows.length}명 보기`}
        </button>
      )}
    </div>
  );
}

// ───────────────────────── 이벤트 피드 ─────────────────────────

export function EventFeed({ store }: { store: ClientStore }) {
  usePolled(() => store.feedVersion, 200);
  const g = store.game;
  if (!g) return null;
  const items = store.feed.slice(-7);
  return (
    <div className="feed" aria-live="polite">
      {items.map((e) => (
        <div key={e.id} className={`feed-row ${e.kind} ${e.mine ? 'mine' : ''} ${e.important ? 'important' : ''} ${e.toMe ? 'to-me' : ''}`}>
          <span className="feed-time">{fmtClock(e.tick * g.config.tickMs)}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
