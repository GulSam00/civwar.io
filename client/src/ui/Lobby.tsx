import { useEffect, useRef, useState } from 'react';
import { BOT_DIFFICULTY_DEFAULT, MAP_SIZE_PRESETS, NICKNAME_MAX_LEN, type BotDifficultyName, type MapSizeClass, type RoomOptions } from '@civwar/shared';
import type { ClientStore } from '../state/store.js';
import { useStore } from './hooks.js';
import { Help } from './Help.js';
import { drawMapPreview } from '../render/mapPreview.js';
import { loadOfficialMap } from './officialMaps.js';
import { estimatePacing, landOfRandom, landOfTerrain, pacingText } from './pacing.js';

type Panel = null | 'create' | 'join' | 'spectate';

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
      <p className="hint">
        PC 권장 · 마우스 + 단축키 (1/2/3 병종, 클릭 발령) ·{' '}
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
export function MapThumb({ mapId, players }: { mapId: string; players: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadOfficialMap(mapId).then((m) => {
      if (!alive) return;
      if (!m || !ref.current) return setMissing(true);
      setMissing(false);
      drawMapPreview(ref.current, m, players);
    });
    return () => {
      alive = false;
    };
  }, [mapId, players]);
  return (
    <div className="map-thumb">
      <canvas ref={ref} />
      {missing && <span className="muted small">미리보기 없음</span>}
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
    void loadOfficialMap(map.mapId).then((m) => alive && setPresetLand(m ? landOfTerrain(m.terrain, m.width, m.height) : null));
    return () => {
      alive = false;
    };
  }, [map]);

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
      {map.kind === 'preset' && <MapThumb mapId={map.mapId} players={mp} />}
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
