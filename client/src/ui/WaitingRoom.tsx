import { useEffect, useState } from 'react';
import { PUBLIC_LOBBY_AUTOSTART_MS, PUBLIC_ROOM_PLAYERS, type BotDifficultyName, type S2C_RoomState } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import { playerColor } from '../render/palette.js';
import { pacingText } from './pacing.js';
import { MapThumb } from './Lobby.js';

const DIFF_NAME: Record<BotDifficultyName, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

function mapLabel(store: ClientStore, room: S2C_RoomState): string {
  const m = room.settings.map;
  if (m.kind === 'random') return `무작위 · ${{ S: '작음', M: '보통', L: '큼' }[m.size]}`;
  return store.officialMaps.find((x) => x.id === m.mapId)?.name.ko ?? m.mapId;
}

/** 대기실: 인원 · 설정 요약 · 카운트다운 · 방장 시작 */
export function WaitingRoom({ store, room }: { store: ClientStore; room: S2C_RoomState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  // countdownMs 는 room_state 수신 시점 기준 — 수신 시각을 기억해 로컬로 줄인다
  const [cdAnchor, setCdAnchor] = useState<{ ms: number; at: number } | null>(null);
  // autoStartMs (프론트 2차 추가 필드) — 공개 룸 자동 시작까지 남은 ms, 수신 시각 기준
  const [autoAnchor, setAutoAnchor] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    setCdAnchor(room.countdownMs !== null ? { ms: room.countdownMs, at: Date.now() } : null);
    setAutoAnchor(room.autoStartMs !== null && room.autoStartMs !== undefined ? { ms: room.autoStartMs, at: Date.now() } : null);
  }, [room]);

  const me = store.myPlayerId;
  const meMember = room.players.find((p) => p.playerId === me);
  const humans = room.players.filter((p) => !p.isBot).length;
  const s = room.settings;
  const rec = s.recommended;
  const outOfRec = s.expectedPlayers < rec[0] || s.expectedPlayers > rec[1];
  const pacing = pacingText(s.pacingNote);
  const countdown = cdAnchor ? Math.max(0, cdAnchor.ms - (now - cdAnchor.at)) : null;
  const autoStart = autoAnchor ? Math.max(0, autoAnchor.ms - (now - autoAnchor.at)) : null;

  return (
    <div className="lobby">
      <div className="lobby-card wide">
        <div className="room-head">
          <h2>{room.isPublic ? '공개 방' : '비공개 방'}</h2>
          <span className="room-code" title="친구에게 이 코드를 알려주세요">
            코드 <b>{room.roomCode}</b>
          </span>
        </div>
        {countdown !== null ? (
          <div className="countdown">{Math.ceil(countdown / 1000)}초 후 시작</div>
        ) : room.isPublic && autoStart !== null ? (
          <div className="autostart">
            <b>{Math.ceil(autoStart / 1000)}초</b> 후 자동 시작 <span className="muted">· {PUBLIC_ROOM_PLAYERS}명</span>
            <div className="autostart-bar">
              <div style={{ width: `${(100 * autoStart) / PUBLIC_LOBBY_AUTOSTART_MS}%` }} />
            </div>
          </div>
        ) : room.isPublic ? (
          <p className="muted">{PUBLIC_ROOM_PLAYERS}명 또는 {PUBLIC_LOBBY_AUTOSTART_MS / 1000}초 후 시작</p>
        ) : (
          <p className="muted">시작 대기</p>
        )}
        <div className="room-grid">
          <div>
            <h3>
              참가자 {humans}명 {s.botCount > 0 ? `+ 봇 ${room.isPublic ? s.botCount : Math.min(s.botCount, s.maxPlayers - humans)}` : ''} / 최대 {s.maxPlayers}
            </h3>
            <ul className="member-list">
              {room.players.map((p) => (
                <li key={p.playerId} className={p.playerId === me ? 'me' : ''}>
                  <span className="dot" style={{ background: playerColor(p.playerId) }} />
                  <span className="nick">{p.nickname}</span>
                  {p.isHost && <span className="tag">방장</span>}
                  {p.isBot && <span className="tag">봇</span>}
                  {!p.isBot && p.ready && <span className="tag ok">준비</span>}
                </li>
              ))}
            </ul>
            {room.spectatorCount > 0 && <p className="muted">관전자 {room.spectatorCount}명</p>}
          </div>
          <div>
            <h3>설정</h3>
            <dl className="settings">
              <dt>맵</dt>
              <dd>
                {mapLabel(store, room)}
                {/* v4.5: 물 통행 불가 — 얕은 물 비율 표시 생략 */}
              </dd>
              <dt>최대 인원</dt>
              <dd>
                {s.maxPlayers}명 (추천 {rec[0]}~{rec[1]})
              </dd>
              <dt>봇</dt>
              <dd>
                {s.botCount}명 · {DIFF_NAME[s.botDifficulty]}
              </dd>
              <dt>시작 인원</dt>
              <dd>{s.expectedPlayers}명</dd>
            </dl>
            {s.map.kind === 'preset' && <MapThumb mapId={s.map.mapId} players={s.expectedPlayers} checksum={store.officialMaps.find((x) => x.id === (s.map as { mapId: string }).mapId)?.checksum} />}
            {(outOfRec || pacing) && <p className={outOfRec || s.pacingNote === 'timeout_likely' ? 'warn' : 'muted small'}>{outOfRec ? `추천 ${rec[0]}~${rec[1]} 밖 · ` : ''}{pacing}</p>}
            {store.isHost && !room.isPublic && room.phase === 'LOBBY' && <HostSettings store={store} room={room} humans={humans} />}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => store.leaveRoom()}>
            나가기
          </button>
          {meMember && !meMember.isBot && room.phase === 'LOBBY' && (
            <button className="btn" onClick={() => store.setReady(!meMember.ready)}>
              {meMember.ready ? '준비 취소' : '준비'}
            </button>
          )}
          {store.isHost && room.phase === 'LOBBY' && (
            <button className="btn btn-primary" onClick={() => store.startNow()}>
              게임 시작
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 숫자 입력 — 타이핑 중에는 보내지 않고 blur·Enter 에서 범위 안 값만 보낸다 (QA m-9: 키마다 lobby_update_settings → BAD_ROOM_OPTIONS 토스트).
 * 서버 값이 바뀌면(다른 변경·거절 후 에코) 입력을 서버 값으로 되돌린다.
 */
function CommitNumber({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(v) || v < min || v > max) {
      setDraft(String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(String(value));
      }}
    />
  );
}

/** 방장 간단 설정 */
function HostSettings({ store, room, humans }: { store: ClientStore; room: S2C_RoomState; humans: number }) {
  const s = room.settings;
  return (
    <div className="host-settings">
      <label className="field inline">
        <span>최대 인원</span>
        <CommitNumber value={s.maxPlayers} min={Math.max(2, humans)} max={s.mapMaxPlayers} onCommit={(v) => store.updateSettings({ maxPlayers: v })} />
      </label>
      <label className="field inline">
        <span>봇</span>
        <CommitNumber value={s.botCount} min={0} max={s.maxPlayers - 1} onCommit={(v) => store.updateSettings({ botCount: v })} />
      </label>
      <label className="field inline">
        <span>난이도</span>
        <select value={s.botDifficulty} onChange={(e) => store.updateSettings({ botDifficulty: e.target.value as BotDifficultyName })}>
          <option value="EASY">쉬움</option>
          <option value="NORMAL">보통</option>
          <option value="HARD">어려움</option>
        </select>
      </label>
    </div>
  );
}
