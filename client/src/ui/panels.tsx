/**
 * 인게임 패널 — 외교(동맹) · 순위표(관전 따라가기) · 이벤트 피드. (테크 창은 TechWindow.tsx)
 * 모두 store.game 을 주기적으로 읽어 그린다(usePolled). 명령은 store 메서드 → cmd_* → cmd_ack 로만 결과 확인.
 */
import { ALLIANCE_CUTOFF_TICK, ALLIANCE_MIN_DURATION, MAX_ALLIES_PER_PLAYER } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import type { GameModel } from '../state/gameModel.js';
import type { GameInputController } from '../input/controller.js';
import { usePolled } from './hooks.js';
import { playerColor } from '../render/palette.js';
import { fmtClock } from './text.js';
import { useDraggableWindow } from './draggable.js';

function constOf<T>(g: GameModel, name: string, fallback: T): T {
  const v = g.config.constants?.[name];
  return (v === undefined ? fallback : v) as T;
}
const ticksToClock = (g: GameModel, ticks: number) => fmtClock(Math.max(0, ticks) * g.config.tickMs);

// ───────────────────────── 외교 ─────────────────────────

type Rel = 'none' | 'active' | 'breaking' | 'outgoing' | 'incoming';

function relation(g: GameModel, me: number, other: number): { rel: Rel; proposalId?: number; expire?: number; since?: number; breakAt?: number | null } {
  const key = me < other ? `${me}-${other}` : `${other}-${me}`;
  const a = g.alliances.get(key);
  if (a) return a.state === 'ACTIVE' ? { rel: 'active', since: a.sinceTick } : { rel: 'breaking', breakAt: a.breakAtTick };
  for (const pr of g.proposals.values()) {
    if (pr.fromPlayerId === other && pr.toPlayerId === me) return { rel: 'incoming', proposalId: pr.proposalId, expire: pr.expireTick };
    if (pr.fromPlayerId === me && pr.toPlayerId === other) return { rel: 'outgoing', expire: pr.expireTick };
  }
  return { rel: 'none' };
}

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
          const r = me !== null ? relation(g, me, p.id) : { rel: 'none' as Rel };
          return (
            <li key={p.id}>
              <span className="dot" style={{ background: playerColor(p.id) }} />
              <span className="nick">{store.nicknameOf(p.id)}</span>
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
      <p className="muted small">동맹끼리는 공격할 수 없습니다. 점유율은 개인 기준 — 동맹 합산으로는 이기지 못합니다.</p>
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

export function Scoreboard({ store, ctl, compact }: { store: ClientStore; ctl: GameInputController; compact: boolean }) {
  usePolled(() => (store.game?.version ?? 0) + store.getVersion() * 7, 300);
  const g = store.game;
  if (!g) return null;
  const me = store.myPlayerId;
  const viewer = store.viewerId;
  // 종료 후 둘러보기(사용자 요청 2026-10-10): 플레이어·탈락자·관전자 모두 순위표로 영토 따라가기
  const over = !!g.gameOver || store.room?.phase === 'GAME_OVER';
  const spectator = over || me === null || !g.players.get(me)?.alive;
  const rows = [...g.players.values()].sort((a, b) => Number(b.alive) - Number(a.alive) || b.tiles - a.tiles);
  const shown = compact ? rows.slice(0, 4) : rows;
  const allyOf = (id: number) => me !== null && g.isAlly(me, id);
  return (
    <div className="scoreboard">
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
      {shown.map((pl) => (
        <button
          key={pl.id}
          className={`score-row ${pl.id === viewer ? 'me' : ''} ${pl.alive ? '' : 'dead'}`}
          onClick={() => {
            if (spectator) store.setFollow(store.followPlayerId === pl.id ? null : pl.id);
            else if (pl.id !== me) {
              ctl.ix.panel = 'ally';
              ctl.ix.bump();
            }
          }}
          title={spectator ? '따라가기' : pl.id !== me ? '외교 창 열기' : ''}
        >
          <span className="dot" style={{ background: playerColor(pl.id) }} />
          {ctl.ix.colorblind && <span className="pnum">{pl.id}</span>}
          <span className="nick">{store.nicknameOf(pl.id)}</span>
          {allyOf(pl.id) && <span className="tag ok">동맹</span>}
          {!pl.connected && pl.alive && <span className="tag">끊김</span>}
          <span className="num">{((pl.tiles * 100) / g.config.totalLandTiles).toFixed(1)}%</span>
        </button>
      ))}
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
        <div key={e.id} className={`feed-row ${e.kind} ${e.mine ? 'mine' : ''} ${e.important ? 'important' : ''}`}>
          <span className="feed-time">{fmtClock(e.tick * g.config.tickMs)}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
