import { useEffect, useRef, useState } from 'react';
import { BOT_DIFFICULTY_DEFAULT, MAP_SIZE_PRESETS, NICKNAME_MAX_LEN, type BotDifficultyName, type MapSizeClass, type RoomOptions } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import { useStore } from './hooks.js';
import { Help } from './Help.js';
import { drawMapPreview } from '../render/mapPreview.js';
import { loadOfficialMapChecked } from './officialMaps.js';
import { fmtClock } from './text.js';
import { estimatePacing, landOfRandom, landOfTerrain, pacingText } from './pacing.js';

type Panel = null | 'create' | 'join' | 'spectate' | 'browse';

/** 첫 화면: 닉네임 → 빠른 시작(큰 버튼). 방 만들기·코드 입장·관전은 보조 */
export function Lobby({ store }: { store: ClientStore }) {
  const [nick, setNick] = useState(store.nickname);
  const [panel, setPanel] = useState<Panel>(null);
  const [code, setCode] = useState('');
  const [help, setHelp] = useState(false);
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
          <button className="btn btn-link" disabled={!nickOk} onClick={() => openPanel('browse')}>
            방 찾기
          </button>
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
        {panel === 'browse' && <RoomBrowser store={store} />}
        <ConnectionLine store={store} />
      </div>
      <p className="hint">
        PC 권장 · 마우스 (지점 클릭 → 병종 선택으로 출전) ·{' '}
        <button className="btn-link" onClick={() => setHelp(true)}>
          규칙 도움말
        </button>
      </p>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function ConnectionLine({ store }: { store: ClientStore }) {
  const text =
    store.kicked ? '다른 창에서 접속해 이 창의 연결이 끊겼습니다' : store.conn === 'open' ? '' : store.conn === 'connecting' ? '서버에 연결 중…' : store.conn === 'closed' ? '서버 연결 끊김 — 재시도 중' : '';
  return text ? <p className="conn-line">{text}</p> : null;
}

type MapSel = { kind: 'random'; size: MapSizeClass } | { kind: 'preset'; mapId: string };
type WaterSel = { mode: 'BORDER_ONLY' } | { mode: 'SHALLOW_QUOTA'; pct: number };

/** 공식 맵 미리보기 (지형·스폰·기지) — 데이터는 번들된 맵 파일 */
export function MapThumb({ mapId, players, checksum }: { mapId: string; players: number; checksum?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState<null | 'none' | 'mismatch'>(null);
  useEffect(() => {
    let alive = true;
    void loadOfficialMapChecked(mapId, checksum).then(({ map, mismatch }) => {
      if (!alive) return;
      if (!map || !ref.current) {
        if (ref.current) ref.current.getContext('2d')?.clearRect(0, 0, ref.current.width, ref.current.height);
        return setMissing(mismatch ? 'mismatch' : 'none');
      }
      setMissing(null);
      drawMapPreview(ref.current, map, players);
    });
    return () => {
      alive = false;
    };
  }, [mapId, players, checksum]);
  return (
    <div className="map-thumb">
      <canvas ref={ref} />
      {missing && <span className="muted small">{missing === 'mismatch' ? '미리보기 없음 (서버 맵 버전이 다름)' : '미리보기 없음'}</span>}
    </div>
  );
}

export function CreateRoomPanel({ store }: { store: ClientStore }) {
  useStore(store); // officialMaps 는 welcome 으로 늦게 온다
  const [map, setMap] = useState<MapSel>({ kind: 'random', size: 'M' });
  const [water, setWater] = useState<WaterSel>({ mode: 'BORDER_ONLY' });
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [botCount, setBotCount] = useState(9);
  const [diff, setDiff] = useState<BotDifficultyName>(BOT_DIFFICULTY_DEFAULT);
  const [presetLand, setPresetLand] = useState<number | null>(null);

  const preset = map.kind === 'preset' ? store.officialMaps.find((m) => m.id === map.mapId) : undefined;
  useEffect(() => {
    if (map.kind !== 'preset') return setPresetLand(null);
    let alive = true;
    // 서버 checksum 과 다른 번들 파일이면 판 길이 추정도 하지 않는다 (방이 생기면 서버 pacingNote 사용)
    void loadOfficialMapChecked(map.mapId, preset?.checksum).then(({ map: m }) => alive && setPresetLand(m ? landOfTerrain(m.terrain, m.width, m.height) : null));
    return () => {
      alive = false;
    };
  }, [map, preset?.checksum]);

  const mapMax = map.kind === 'random' ? MAP_SIZE_PRESETS[map.size].max : (preset?.players.max ?? 12);
  const rec = map.kind === 'random' ? MAP_SIZE_PRESETS[map.size].recommended : preset ? [preset.players.recommendedMin, preset.players.recommendedMax] : [2, 12];
  const mp = Math.min(maxPlayers, mapMax);
  const bc = Math.min(botCount, mp - 1);
  const startPlayers = 1 + bc; // 방장 혼자 시작할 때 (친구가 들어오면 봇 자리를 대신한다 — 정원 이내)
  const outOfRec = startPlayers < rec[0] || startPlayers > rec[1];
  const land = map.kind === 'random' ? landOfRandom(map.size) : presetLand;
  const pacing =
    land !== null
      ? pacingText(estimatePacing({ land, players: startPlayers, defaultSetup: map.kind === 'random' && map.size === 'M' && water.mode === 'BORDER_ONLY' && diff === 'NORMAL' }))
      : null;

  const submit = () => {
    const opts: RoomOptions = {
      map:
        map.kind === 'random'
          ? { kind: 'random', size: map.size, water: water.mode === 'BORDER_ONLY' ? { waterMode: 'BORDER_ONLY', shallowPermille: 1000 } : { waterMode: 'SHALLOW_QUOTA', shallowPermille: water.pct * 10 } }
          : { kind: 'preset', mapId: map.mapId },
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
      {map.kind === 'preset' && <MapThumb mapId={map.mapId} players={startPlayers} checksum={preset?.checksum} />}
      {map.kind === 'random' && (
        <div className="field">
          <span>물 구성</span>
          <div className="seg">
            <button className={`btn btn-sm ${water.mode === 'BORDER_ONLY' ? 'on' : ''}`} onClick={() => setWater({ mode: 'BORDER_ONLY' })}>
              기본 (가장자리만 깊은 물)
            </button>
            <button className={`btn btn-sm ${water.mode === 'SHALLOW_QUOTA' ? 'on' : ''}`} onClick={() => setWater({ mode: 'SHALLOW_QUOTA', pct: water.mode === 'SHALLOW_QUOTA' ? water.pct : 50 })}>
              얕은 물 비율 지정
            </button>
          </div>
          {water.mode === 'SHALLOW_QUOTA' && (
            <label className="field">
              <span>안쪽 물 중 얕은 물(통행 가능) {water.pct}% — 나머지는 깊은 물(벽)</span>
              <input type="range" min={0} max={100} step={5} value={water.pct} onChange={(e) => setWater({ mode: 'SHALLOW_QUOTA', pct: Number(e.target.value) })} />
            </label>
          )}
        </div>
      )}
      <label className="field">
        <span>
          최대 인원 {mp} <span className="muted">(맵 최대 {mapMax}, 추천 {rec[0]}~{rec[1]})</span>
        </span>
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
      <p className={outOfRec || pacing?.includes('넘어') ? 'warn' : 'muted small'}>
        혼자 시작하면 {startPlayers}명.{outOfRec ? ` 이 맵의 추천 인원(${rec[0]}~${rec[1]})을 벗어납니다.` : ''} {pacing ?? ''}
      </p>
      <button className="btn btn-primary" onClick={submit}>
        방 만들기
      </button>
    </div>
  );
}

const SIZE_NAME: Record<string, string> = { S: '작음', M: '보통', L: '큼' };

/**
 * 방 찾기 (플레이테스트 후속): 공개 방만 — 대기 중이면 입장, 진행 중이면 관전. 비공개 방은 코드로만.
 * 열려 있는 동안 5초마다 새로고침(서버 1초 1회 제한), 경과 시간은 수신 시각 기준으로 로컬 증가.
 */
export function RoomBrowser({ store }: { store: ClientStore }) {
  useStore(store);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    store.listRooms();
    const id = setInterval(() => store.listRooms(), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [store]);
  const list = store.roomList;
  const age = list ? Math.max(0, now - store.roomListAt) : 0;
  return (
    <div className="panel browse-panel">
      <div className="browse-head">
        <b>공개 방</b>
        <span className="muted small">{list ? `${list.rooms.length}개` : '불러오는 중…'}</span>
        <button className="btn btn-sm" onClick={() => store.listRooms()}>
          새로고침
        </button>
      </div>
      {list && list.rooms.length === 0 && <p className="muted small">열린 공개 방이 없습니다. 빠른 시작으로 새 방을 만들 수 있습니다.</p>}
      <ul className="room-list">
        {list?.rooms.map((r) => {
          const mapText = r.mapName ? r.mapName.ko : r.map.kind === 'random' ? `무작위 · ${SIZE_NAME[r.map.size] ?? r.map.size}` : r.map.mapId;
          const live = r.phase === 'IN_GAME' ? r.elapsedMs + age : r.elapsedMs;
          const status =
            r.phase === 'LOBBY'
              ? r.autoStartMs !== null
                ? `대기 중 · ${Math.max(0, Math.ceil((r.autoStartMs - age) / 1000))}초 후 시작`
                : '대기 중'
              : r.phase === 'COUNTDOWN'
                ? '곧 시작'
                : r.phase === 'IN_GAME'
                  ? `진행 ${fmtClock(live)}`
                  : '종료';
          return (
            <li key={r.roomId}>
              <div className="room-main">
                <b>{mapText}</b> <span className="muted small">{r.width}×{r.height}</span>
                <div className="muted small">
                  사람 {r.humans} · 봇 {r.bots} / 최대 {r.maxPlayers}
                  {r.spectatorCount > 0 ? ` · 관전 ${r.spectatorCount}` : ''}
                </div>
              </div>
              <span className={`room-status ${r.phase === 'LOBBY' ? 'open' : ''}`}>{status}</span>
              {r.joinable && (
                <button className="btn btn-sm btn-primary" onClick={() => store.joinListed(r.roomId, false)}>
                  입장
                </button>
              )}
              {r.spectatable && (
                <button className="btn btn-sm" onClick={() => store.joinListed(r.roomId, true)}>
                  관전
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small">비공개 방은 목록에 나오지 않습니다 — 방 코드로 입장하세요.</p>
    </div>
  );
}
