import { useEffect } from 'react';
import type { ClientStore } from './state/store.js';
import { useStore } from './ui/hooks.js';
import { Lobby } from './ui/Lobby.js';
import { WaitingRoom } from './ui/WaitingRoom.js';
import { GameScreen } from './ui/GameScreen.js';

/** 화면 전환은 서버 메시지(room_state.phase / match_config)로만 — 클라이언트가 추측하지 않는다 */
export function App({ store }: { store: ClientStore }) {
  useStore(store);
  useEffect(() => {
    const id = setInterval(() => store.pruneToasts(), 500);
    return () => clearInterval(id);
  }, [store]);

  const room = store.room;
  let screen;
  if (room && (room.phase === 'IN_GAME' || room.phase === 'GAME_OVER') && store.game) screen = <GameScreen store={store} />;
  else if (room && (room.phase === 'LOBBY' || room.phase === 'COUNTDOWN')) screen = <WaitingRoom store={store} room={room} />;
  else if (room && (room.phase === 'IN_GAME' || room.phase === 'GAME_OVER')) screen = <div className="lobby"><div className="lobby-card">게임 상태를 불러오는 중…</div></div>;
  else screen = <Lobby store={store} />;

  return (
    <>
      {screen}
      <div className="toasts">
        {store.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
