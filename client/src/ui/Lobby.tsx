import { useState } from 'react';
import { BOT_DIFFICULTY_DEFAULT, MAP_SIZE_PRESETS, NICKNAME_MAX_LEN, type BotDifficultyName, type MapSizeClass, type RoomOptions } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';

type Panel = null | 'create' | 'join' | 'spectate';

/** 첫 화면: 닉네임 → 빠른 시작(큰 버튼). 방 만들기·코드 입장·관전은 보조 */
export function Lobby({ store }: { store: ClientStore }) {
  const [nick, setNick] = useState(store.nickname);
  const [panel, setPanel] = useState<Panel>(null);
  const [code, setCode] = useState('');
  const nickOk = nick.trim().length >= 1 && nick.trim().length <= NICKNAME_MAX_LEN;

  const commitNick = () => {
    if (nick.trim() !== store.nickname) store.setNickname(nick);
  };
  const openPanel = (p: Panel) => {
    if (!nickOk) return;
    commitNick();
    setPanel(panel === p ? null : p);
    if (p === 'create') store.ensureHello(); // 공식 맵 목록은 welcome 에 실려 온다
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="logo">civwar.io</h1>
        <p className="tagline">깃발을 보내 땅을 넓히세요. 30분 안에 가장 넓은 나라가 이깁니다.</p>
        <label className="field">
          <span>닉네임</span>
          <input
            autoFocus
            maxLength={NICKNAME_MAX_LEN}
            value={nick}
            placeholder="닉네임 (1~16자)"
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nickOk) {
                commitNick();
                store.quickStart();
              }
            }}
          />
        </label>
        <button
          className="btn btn-primary btn-huge"
          disabled={!nickOk}
          onClick={() => {
            commitNick();
            store.quickStart();
          }}
        >
          빠른 시작
        </button>
        <div className="secondary-row">
          <button className="btn btn-link" disabled={!nickOk} onClick={() => openPanel('create')}>
            방 만들기
          </button>
          <button className="btn btn-link" disabled={!nickOk} onClick={() => openPanel('join')}>
            코드로 입장
          </button>
          <button className="btn btn-link" disabled={!nickOk} onClick={() => openPanel('spectate')}>
            관전
          </button>
        </div>
        {(panel === 'join' || panel === 'spectate') && (
          <div className="panel">
            <label className="field">
              <span>방 코드</span>
              <input value={code} maxLength={6} placeholder="예: DFV7MV" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <button
              className="btn btn-primary"
              disabled={code.trim().length !== 6}
              onClick={() => (panel === 'join' ? store.joinByCode(code) : store.spectate(code))}
            >
              {panel === 'join' ? '입장' : '관전 시작'}
            </button>
          </div>
        )}
        {panel === 'create' && <CreateRoomPanel store={store} />}
        <ConnectionLine store={store} />
      </div>
      <p className="hint">PC 권장 · 마우스 + 단축키 (1/2/3 병종, 클릭 발령)</p>
    </div>
  );
}

function ConnectionLine({ store }: { store: ClientStore }) {
  const text =
    store.kicked ? '다른 창에서 접속해 이 창의 연결이 끊겼습니다' : store.conn === 'open' ? '' : store.conn === 'connecting' ? '서버에 연결 중…' : store.conn === 'closed' ? '서버 연결 끊김 — 재시도 중' : '';
  return text ? <p className="conn-line">{text}</p> : null;
}

type MapSel = { kind: 'random'; size: MapSizeClass } | { kind: 'preset'; mapId: string };

export function CreateRoomPanel({ store }: { store: ClientStore }) {
  const [map, setMap] = useState<MapSel>({ kind: 'random', size: 'M' });
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [botCount, setBotCount] = useState(9);
  const [diff, setDiff] = useState<BotDifficultyName>(BOT_DIFFICULTY_DEFAULT);

  const preset = map.kind === 'preset' ? store.officialMaps.find((m) => m.id === map.mapId) : undefined;
  const mapMax = map.kind === 'random' ? MAP_SIZE_PRESETS[map.size].max : (preset?.players.max ?? 12);
  const rec = map.kind === 'random' ? MAP_SIZE_PRESETS[map.size].recommended : preset ? [preset.players.recommendedMin, preset.players.recommendedMax] : [2, 12];
  const mp = Math.min(maxPlayers, mapMax);
  const bc = Math.min(botCount, mp - 1);
  const outOfRec = mp < rec[0] || mp > rec[1];

  const submit = () => {
    const opts: RoomOptions = {
      map: map.kind === 'random' ? { kind: 'random', size: map.size } : { kind: 'preset', mapId: map.mapId },
      maxPlayers: mp,
      botCount: bc,
      botDifficulty: diff,
    };
    store.createRoom(opts);
  };

  const mapValue = map.kind === 'random' ? `random:${map.size}` : `preset:${map.mapId}`;
  return (
    <div className="panel create-panel">
      <label className="field">
        <span>맵</span>
        <select
          value={mapValue}
          onChange={(e) => {
            const [k, v] = e.target.value.split(':');
            setMap(k === 'random' ? { kind: 'random', size: v as MapSizeClass } : { kind: 'preset', mapId: v });
          }}
        >
          <optgroup label="무작위 생성">
            <option value="random:S">무작위 · 작음 (72×42, 추천 5~6)</option>
            <option value="random:M">무작위 · 보통 (100×60, 추천 9~11)</option>
            <option value="random:L">무작위 · 큼 (108×66, 추천 11~12)</option>
          </optgroup>
          {store.officialMaps.length > 0 && (
            <optgroup label="공식 맵">
              {store.officialMaps.map((m) => (
                <option key={m.id} value={`preset:${m.id}`}>
                  {m.name.ko} · {m.sizeClass} (추천 {m.players.recommendedMin}~{m.players.recommendedMax})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="field">
        <span>최대 인원 {mp}</span>
        <input type="range" min={2} max={mapMax} value={mp} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>봇 {bc}명</span>
        <input type="range" min={0} max={mp - 1} value={bc} onChange={(e) => setBotCount(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>봇 난이도</span>
        <select value={diff} onChange={(e) => setDiff(e.target.value as BotDifficultyName)}>
          <option value="EASY">쉬움</option>
          <option value="NORMAL">보통</option>
          <option value="HARD">어려움</option>
        </select>
      </label>
      {outOfRec && (
        <p className="warn">
          이 맵의 추천 인원은 {rec[0]}~{rec[1]}명입니다. 판 길이가 30분에서 벗어날 수 있습니다.
        </p>
      )}
      <button className="btn btn-primary" onClick={submit}>
        방 만들기
      </button>
    </div>
  );
}
