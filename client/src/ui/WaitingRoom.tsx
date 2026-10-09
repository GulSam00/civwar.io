import { useEffect, useState } from 'react';
import { PUBLIC_LOBBY_AUTOSTART_MS, PUBLIC_ROOM_PLAYERS, type BotDifficultyName, type S2C_RoomState } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import { playerColor } from '../render/palette.js';

const DIFF_NAME: Record<BotDifficultyName, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

function mapLabel(store: ClientStore, room: S2C_RoomState): string {
  const m = room.settings.map;
  if (m.kind === 'random') return `무작위 · ${{ S: '작음', M: '보통', L: '큼' }[m.size]}`;
  return store.officialMaps.find((x) => x.id === m.mapId)?.name.ko ?? m.mapId;
}

function pacingText(note: string): string | null {
  if (note === 'guaranteed') return null;
  if (note === 'timeout_likely') return '예상 판 길이가 32분을 넘어 시간 종료로 끝날 가능성이 큽니다';
  const m = /^estimate:(\d+)/.exec(note);
  return m ? `예상 판 길이 약 ${m[1]}분 (참고값)` : null;
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
  useEffect(() => {
    setCdAnchor(room.countdownMs !== null ? { ms: room.countdownMs, at: Date.now() } : null);
  }, [room]);

  const me = store.myPlayerId;
  const meMember = room.players.find((p) => p.playerId === me);
  const humans = room.players.filter((p) => !p.isBot).length;
  const s = room.settings;
  const rec = s.recommended;
  const outOfRec = s.expectedPlayers < rec[0] || s.expectedPlayers > rec[1];
  const pacing = pacingText(s.pacingNote);
  const countdown = cdAnchor ? Math.max(0, cdAnchor.ms - (now - cdAnchor.at)) : null;

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
        ) : room.isPublic ? (
          <p className="muted">
            {PUBLIC_ROOM_PLAYERS}명이 모이거나 첫 입장 후 {PUBLIC_LOBBY_AUTOSTART_MS / 1000}초가 지나면 빈자리를 봇으로 채우고 자동으로 시작합니다.
          </p>
        ) : (
          <p className="muted">방장이 시작하면 3초 후 게임이 시작됩니다.</p>
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
              <dd>{mapLabel(store, room)}</dd>
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
            {(outOfRec || pacing) && <p className="warn">{outOfRec ? `추천 인원(${rec[0]}~${rec[1]})을 벗어났습니다. ` : ''}{pacing}</p>}
            {store.isHost && room.phase === 'LOBBY' && <HostSettings store={store} room={room} humans={humans} />}
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

/** 방장 간단 설정 (세부 UI 는 2차) */
function HostSettings({ store, room, humans }: { store: ClientStore; room: S2C_RoomState; humans: number }) {
  const s = room.settings;
  return (
    <div className="host-settings">
      <label className="field inline">
        <span>최대 인원</span>
        <input
          type="number"
          min={Math.max(2, humans)}
          max={s.mapMaxPlayers}
          value={s.maxPlayers}
          onChange={(e) => store.updateSettings({ maxPlayers: Number(e.target.value) })}
        />
      </label>
      <label className="field inline">
        <span>봇</span>
        <input type="number" min={0} max={s.maxPlayers - 1} value={s.botCount} onChange={(e) => store.updateSettings({ botCount: Number(e.target.value) })} />
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
