/**
 * 플레이어 정보 카드 (2026-10-18 UI 개선 6 — OpenFront.io 참고). 순위표·상단 대상 바·외교 창의 이름을 누르면 열린다.
 * 색·이름·종류·관계, 점유율·병력(상한·회복)·골드(순수입)·테크 수, 기지(생산력·체력), 동맹 목록, 동맹 파기 횟수(§23 allyBreaks — 없으면 줄 숨김).
 * 버튼: 동맹 제안/파기/수락·거절(외교 창과 같은 규칙·쿨타임 — playerInfo.diplomacyAction), 이모트(이 플레이어 대상 §26.3 — 전체 공개), 카메라 따라가기.
 * 제목 줄 드래그(넓은 화면). Esc 또는 × 로 닫는다.
 */
import { useState } from 'react';
import type { ClientStore } from '../state/store.js';
import type { GameInputController } from '../input/controller.js';
import { usePolled } from './hooks.js';
import { useDraggableWindow } from './draggable.js';
import { playerColor } from '../render/palette.js';
import { EMOTE_TEXT, fmtClock } from './text.js';
import { fmtCompact, fmtRate } from './fmt.js';
import { RELATION_NAME, diplomacyAction, playerCardData } from './playerInfo.js';
import { CloseIcon, EmoteIcon, FollowIcon } from './hudIcons.js';

export function PlayerCard({ store, ctl, narrow }: { store: ClientStore; ctl: GameInputController; narrow: boolean }) {
  usePolled(() => ctl.ix.version * 1000 + (store.game?.version ?? 0) + store.getVersion() * 7, 200);
  const drag = useDraggableWindow<HTMLDivElement>('player-card', !narrow);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const g = store.game;
  const id = ctl.ix.cardPlayerId;
  const me = store.myPlayerId;
  const d = g && id !== null ? playerCardData(g, id, me, store.names) : null;
  if (!g || !d) return null;
  const close = () => {
    ctl.ix.cardPlayerId = null;
    ctl.ix.bump();
  };
  const canAct = ctl.canCommand();
  const act = diplomacyAction(g, me, d.id, canAct);
  const clock = (ticks: number) => fmtClock(ticks * g.config.tickMs);
  const following = store.followPlayerId === d.id;
  return (
    <div ref={drag.ref} style={drag.style} className={`player-card ${narrow ? 'pc-narrow' : ''}`} role="dialog" aria-label={`${d.name} 정보`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="pc-head drag-handle" {...drag.handleProps}>
        <span className="pc-swatch" style={{ background: playerColor(d.id) }} />
        <b className="pc-name">{d.name}</b>
        <span className="tag">{d.kind === 'bot' ? '봇' : '플레이어'}</span>
        {d.relation && d.relation !== 'neutral' && <span className={`tag rel-${d.relation}`}>{RELATION_NAME[d.relation]}</span>}
        {!d.alive && <span className="tag warn-tag">탈락</span>}
        {d.alive && !d.connected && <span className="tag">끊김</span>}
        <button className="btn btn-x" onClick={close} aria-label="닫기">
          <CloseIcon size={14} />
        </button>
      </div>
      <dl className="pc-stats">
        <div>
          <dt>점유율</dt>
          <dd>
            {d.share.toFixed(1)}% <span className="muted small">{d.tiles.toLocaleString()}칸</span>
          </dd>
        </div>
        <div>
          <dt>병력</dt>
          <dd>
            {fmtCompact(d.troops)} <span className="muted small">/ {fmtCompact(d.troopCap)}</span>
            {d.troopRate !== null && <span className="muted small"> {fmtRate(d.troopRate)}</span>}
          </dd>
        </div>
        <div>
          <dt>골드</dt>
          <dd>
            {fmtCompact(d.gold)}
            {d.goldNet !== null && <span className="muted small"> {fmtRate(d.goldNet)}</span>}
          </dd>
        </div>
        <div>
          <dt>테크</dt>
          <dd>{d.techCount}개</dd>
        </div>
      </dl>
      <section className="pc-sec">
        <h4>
          기지 <span className="muted">{d.bases.length}곳</span>
        </h4>
        {d.bases.length === 0 ? (
          <p className="muted small">기지 없음</p>
        ) : (
          <ul className="pc-bases">
            {d.bases.slice(0, 8).map((b) => (
              <li key={b.tileId}>
                <span className="pc-bname">
                  {b.capital ? '★ ' : ''}
                  {b.name ?? (b.capital ? '수도' : '기지')}
                </span>
                {b.prodPct !== null && (
                  <span className={`pc-prod ${b.prodPct < 100 ? 'low' : ''}`} title="기지 생산력">
                    생산 {b.prodPct}%
                  </span>
                )}
                <span className="muted small" title="기지 체력">
                  체력 {b.hpPct}%
                </span>
              </li>
            ))}
            {d.bases.length > 8 && <li className="muted small">외 {d.bases.length - 8}곳</li>}
          </ul>
        )}
      </section>
      <section className="pc-sec">
        <h4>
          동맹 <span className="muted">{d.allies.length}</span>
        </h4>
        {d.allies.length === 0 ? (
          <p className="muted small">동맹 없음</p>
        ) : (
          <ul className="pc-allies">
            {d.allies.map((a) => (
              <li key={a.id}>
                <button className="btn-link nick-link" onClick={() => ((ctl.ix.cardPlayerId = a.id), ctl.ix.bump())}>
                  <span className="dot" style={{ background: playerColor(a.id) }} />
                  {a.name}
                </button>
                {a.breakingTicks !== null && <span className="tag warn-tag">해제까지 {clock(a.breakingTicks)}</span>}
              </li>
            ))}
          </ul>
        )}
        {d.allyBreaks !== null && (
          <p className="pc-breaks small">
            동맹 파기 <b className={d.allyBreaks > 0 ? 'warn-text' : ''}>{d.allyBreaks}회</b>
          </p>
        )}
      </section>
      <div className="pc-actions">
        {act.kind === 'propose' && (
          <button className="btn btn-sm btn-primary" disabled={act.disabled} title={act.reason ?? '동맹 제안 (상대가 수락하면 성립)'} onClick={() => store.proposeAlly(d.id)}>
            동맹 제안
          </button>
        )}
        {act.kind === 'break' && (
          <button className="btn btn-sm btn-danger" disabled={act.disabled} title={act.reason ?? '파기하면 30초 뒤 해제 (그동안 서로 공격 불가)'} onClick={() => store.breakAlly(d.id)}>
            {act.waitTicks > 0 ? `파기 ${clock(act.waitTicks)}` : '동맹 파기'}
          </button>
        )}
        {act.kind === 'respond' && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => store.respondAlly(act.proposalId, true)}>
              동맹 수락
            </button>
            <button className="btn btn-sm" onClick={() => store.respondAlly(act.proposalId, false)}>
              거절 <span className="muted small">{clock(act.expireTicks)}</span>
            </button>
          </>
        )}
        {act.kind === 'outgoing' && <span className="tag">제안함 {clock(act.expireTicks)}</span>}
        {act.kind === 'breaking' && <span className="tag warn-tag">해제까지 {clock(act.breakTicks)}</span>}
        {canAct && (
          <span className="emote-wrap">
            <button className={`btn btn-sm icon-btn ${emoteOpen ? 'on' : ''}`} onClick={() => setEmoteOpen(!emoteOpen)} title={d.id === me ? '이모트 보내기 (모두에게 보입니다)' : `${d.name}에게 이모트 (모두에게 보입니다)`} aria-label={d.id === me ? '이모트 보내기' : `${d.name}에게 이모트 보내기`}>
              <EmoteIcon size={15} /> 이모트
            </button>
            {emoteOpen && (
              <div className="emote-menu pc-emote-menu">
                {EMOTE_TEXT.map((t, code) => (
                  <button
                    key={code}
                    className="btn btn-sm"
                    onClick={() => {
                      // §26.3 이 카드의 플레이어를 향한 이모트 (내 카드면 대상 없음 — store 가 거른다)
                      if (store.sendEmote(code, d.id)) setEmoteOpen(false);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
        <button className={`btn btn-sm icon-btn ${following ? 'on' : ''}`} onClick={() => store.setFollow(following ? null : d.id)} title={following ? '따라가기 끄기 (자유 카메라)' : '카메라로 따라가기'} aria-pressed={following}>
          <FollowIcon size={15} /> {following ? '따라가는 중' : '따라가기'}
        </button>
      </div>
      {act.kind === 'none' && act.reason && d.id !== me && <p className="muted small pc-note">{act.reason}</p>}
    </div>
  );
}
