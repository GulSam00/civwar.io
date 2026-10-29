/**
 * 전투 실험실 (/combat-lab) — 좌우 부대 능력치를 정해 1 대 1 교전을 tick 단위로 돌려 본다.
 * 게임 서버 연결 없이 클라이언트 안에서만 돈다. 계산은 combatSim.ts (서버 4단계와 같은 식).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { POSTURE, TERRAIN, TICK_MS, type Unit } from '@civwar/shared';
import { UnitIcon } from '../ui/unitIcons.js';
import { TERRAIN_NAME, UNIT_NAME } from '../ui/text.js';
import { CombatSim, DEFAULT_GLOBAL, SIDE_NAME, defaultSide, presetStats, tickSec, type GlobalConfig, type SideConfig } from './combatSim.js';
import { LabChart, type Series } from './LabChart.js';

const SPEEDS = [0.5, 1, 2, 5, 10, 30] as const;
const PRESET_ORDER: Unit[] = [1, 0, 2]; // 검병, 창병, 기병
const TERRAINS = [TERRAIN.PLAIN, TERRAIN.FERTILE, TERRAIN.HILLS, TERRAIN.DESERT, TERRAIN.MOUNTAIN];
const SIDE_COLOR = ['var(--lab-left)', 'var(--lab-right)'] as const;
const LOG_LIMIT = 500;

type Sides = [SideConfig, SideConfig];

export function CombatLab() {
  const [sides, setSides] = useState<Sides>(() => [defaultSide(1), defaultSide(0)]);
  const [global, setGlobal] = useState<GlobalConfig>(DEFAULT_GLOBAL);
  const [sim, setSim] = useState(() => new CombatSim([defaultSide(1), defaultSide(0)], DEFAULT_GLOBAL));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [eventsOnly, setEventsOnly] = useState(false);
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const reset = (s: Sides = sides, g: GlobalConfig = global) => {
    setRunning(false);
    setSim(new CombatSim(s, g));
  };
  const updateSide = (i: 0 | 1, patch: Partial<SideConfig>) => {
    const next = [...sides] as Sides;
    next[i] = { ...next[i], ...patch };
    setSides(next);
    reset(next);
  };
  const updateGlobal = (patch: Partial<GlobalConfig>) => {
    const next = { ...global, ...patch };
    setGlobal(next);
    reset(sides, next);
  };

  // 재생 루프 — 실제 시간 × 배속만큼 tick 을 진행한다 (1배속 = 게임과 같은 초당 5 tick)
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += ((now - last) * speedRef.current) / TICK_MS;
      last = now;
      let n = Math.floor(acc);
      acc -= n;
      let stepped = false;
      while (n-- > 0 && sim.step()) stepped = true;
      if (stepped) bump();
      if (sim.over) {
        setRunning(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, sim]);

  const runToEnd = () => {
    setRunning(false);
    while (sim.step());
    bump();
  };
  const stepOnce = () => {
    setRunning(false);
    sim.step();
    bump();
  };

  const recs = sim.records;
  const xMax = Math.max(50, recs.length - 1);
  const col = (i: 0 | 1, k: 'troopsMilli' | 'morale' | 'atk' | 'def') => recs.map((r) => (k === 'troopsMilli' ? r.sides[i][k] / 1000 : r.sides[i][k]));
  const troops: Series[] = ([0, 1] as const).map((i) => ({ label: `${SIDE_NAME[i]} ${UNIT_NAME[sides[i].unit]}`, color: SIDE_COLOR[i], dashed: i === 1, values: col(i, 'troopsMilli'), fmt: (v) => v.toFixed(1) }));
  const morale: Series[] = ([0, 1] as const).map((i) => ({ label: `${SIDE_NAME[i]} ${UNIT_NAME[sides[i].unit]}`, color: SIDE_COLOR[i], dashed: i === 1, values: col(i, 'morale') }));
  const stats: Series[] = ([0, 1] as const).flatMap((i) => [
    { label: `${SIDE_NAME[i]} 공`, color: SIDE_COLOR[i], values: col(i, 'atk') },
    { label: `${SIDE_NAME[i]} 방`, color: SIDE_COLOR[i], dashed: true, values: col(i, 'def') },
  ]);
  const statMax = Math.ceil(Math.max(...stats.flatMap((s) => s.values)) / 100) * 100 + 100;
  const troopMax = Math.max(sides[0].troops, sides[1].troops);

  const logs = useMemo(() => {
    const all = eventsOnly ? sim.logs.filter((l) => l.kind !== 'tick') : sim.logs;
    return all.slice(-LOG_LIMIT);
    // sim.logs 는 제자리에서 늘어난다 — 길이로 갱신을 감지
  }, [sim, sim.logs.length, eventsOnly]);
  const logRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const res = sim.result;
  const status = res ? '종료' : running ? '진행 중' : sim.tick > 0 ? '일시정지' : '대기';

  return (
    <div className="lab">
      <header className="lab-header">
        <h1>전투 실험실</h1>
        <span className="muted small">깃발 1 대 1 · 무테크 · 초당 5 tick</span>
        <a href="/" className="lab-back">
          로비로
        </a>
      </header>

      <section className="lab-charts">
        <LabChart title="남은 병력" series={troops} yMax={troopMax} xMax={xMax} />
        <LabChart title="사기" series={morale} yMax={1000} xMax={xMax} />
        <LabChart title="실효 능력치 (‰)" series={stats} yMax={statMax} xMax={xMax} />
      </section>

      <section className="lab-main">
        <SidePanel idx={0} cfg={sides[0]} disabled={running} onChange={(p) => updateSide(0, p)} sim={sim} />

        <div className="lab-center">
          <div className="lab-controls">
            {running ? (
              <button className="btn" onClick={() => setRunning(false)}>
                중단
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!!res} onClick={() => setRunning(true)}>
                {sim.tick > 0 && !res ? '재개' : '전투 시작'}
              </button>
            )}
            <button className="btn" disabled={!!res} onClick={stepOnce} title="1 tick 진행">
              1틱
            </button>
            <button className="btn" disabled={!!res} onClick={runToEnd} title="끝까지 즉시 계산">
              끝까지
            </button>
            <button className="btn" onClick={() => reset()}>
              초기화
            </button>
          </div>
          <div className="lab-speed" role="group" aria-label="속도">
            {SPEEDS.map((s) => (
              <button key={s} className={`btn btn-sm ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
                ×{s}
              </button>
            ))}
          </div>
          <dl className="lab-status">
            <dt>상태</dt>
            <dd>{status}</dd>
            <dt>경과</dt>
            <dd>
              {sim.tick}틱 · {tickSec(sim.tick)}
            </dd>
            {res && (
              <>
                <dt>결과</dt>
                <dd>
                  {res.reason === 'rout' ? '패주' : res.reason === 'breakaway' ? '이탈' : '시간 제한'} · {res.winner === null ? '승자 없음' : `${SIDE_NAME[res.winner]} 승`}
                </dd>
              </>
            )}
            {([0, 1] as const).map((i) => {
              const s = sim.summary(i);
              return (
                <div key={i} className="lab-status-row">
                  <dt style={{ color: SIDE_COLOR[i] }}>{SIDE_NAME[i]}</dt>
                  <dd>
                    {(s.troopsMilli / 1000).toFixed(1)}명 ({s.troopsPct}%) · 사기 0 {s.moraleZeroTick === null ? '-' : tickSec(s.moraleZeroTick)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <fieldset className="lab-global" disabled={running}>
            <legend>공통 상수</legend>
            <NumField label="손실률 (만분율)" title="편 병력 합 대비 tick 당 총 손실 (COMBAT_LOSS_BP)" value={global.lossBp} onChange={(v) => updateGlobal({ lossBp: v })} />
            <NumField label="손실 하한 (만분율)" title="출전 병력 합 대비 tick 당 손실 하한 (COMBAT_LOSS_FLOOR_BP)" value={global.floorBp} onChange={(v) => updateGlobal({ floorBp: v })} />
            <NumField label="최소 손실 (milli)" title="tick 당 최소 손실 (COMBAT_MIN_LOSS_MILLI, 1000 = 1명)" value={global.minLossMilli} onChange={(v) => updateGlobal({ minLossMilli: v })} />
            <NumField label="손실 1%당 사기 감소" title="이번 tick 자기 병력 손실 1% 마다 추가 사기 감소 (MORALE_DROP_LOSS_K)" value={global.lossK} onChange={(v) => updateGlobal({ lossK: v })} />
            <NumField label="최대 tick" title="이 tick 에서 끊는다" value={global.maxTicks} min={1} onChange={(v) => updateGlobal({ maxTicks: v })} />
            <button type="button" className="btn btn-sm" onClick={() => updateGlobal(DEFAULT_GLOBAL)}>
              게임 값으로
            </button>
          </fieldset>
        </div>

        <SidePanel idx={1} cfg={sides[1]} disabled={running} onChange={(p) => updateSide(1, p)} sim={sim} />
      </section>

      <section className="lab-log-wrap">
        <div className="lab-log-head">
          <b>전투 로그</b>
          <label className="small">
            <input type="checkbox" checked={eventsOnly} onChange={(e) => setEventsOnly(e.target.checked)} /> 사건만
          </label>
          {sim.logs.length > LOG_LIMIT && !eventsOnly && <span className="muted small">최근 {LOG_LIMIT}줄</span>}
        </div>
        <div className="lab-log" ref={logRef}>
          {logs.map((l, k) => (
            <div key={`${l.tick}-${k}`} className={`lab-log-line ${l.kind}`}>
              <span className="lab-log-t">{tickSec(l.tick)}</span>
              {l.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SidePanel({ idx, cfg, disabled, onChange, sim }: { idx: 0 | 1; cfg: SideConfig; disabled: boolean; onChange: (p: Partial<SideConfig>) => void; sim: CombatSim }) {
  return (
    <fieldset className="lab-side" disabled={disabled} style={{ borderColor: SIDE_COLOR[idx] }}>
      <legend style={{ color: SIDE_COLOR[idx] }}>
        {SIDE_NAME[idx]} 부대 <UnitIcon unit={cfg.unit} size={16} withName />
      </legend>
      <div className="lab-presets">
        {PRESET_ORDER.map((u) => (
          <button key={u} type="button" className={`btn btn-sm ${cfg.unit === u ? 'on' : ''}`} onClick={() => onChange(presetStats(u))} title={`${UNIT_NAME[u]} 게임 능력치로`}>
            <UnitIcon unit={u} size={14} withName />
          </button>
        ))}
      </div>
      <NumField label="병력" value={cfg.troops} min={1} onChange={(v) => onChange({ troops: v })} />
      <NumField label="시작 사기" title="0 ~ 1000" value={cfg.morale} min={0} max={1000} onChange={(v) => onChange({ morale: v })} />
      <NumField label="공격력 (‰)" title="병종 기본 공격력 (UNIT_ATK_PERMILLE)" value={cfg.atk} min={1} onChange={(v) => onChange({ atk: v })} />
      <NumField label="방어력 (‰)" title="병종 기본 방어력 (UNIT_DEF_PERMILLE)" value={cfg.def} min={1} onChange={(v) => onChange({ def: v })} />
      <NumField label="사기 0 곱 (‰)" title="사기 0 일 때 능력치 곱 (MORALE_FLOOR)" value={cfg.moraleFloor} min={1} onChange={(v) => onChange({ moraleFloor: v })} />
      <NumField label="사기 만땅 곱 (‰)" title="사기 1000 일 때 능력치 곱 (MORALE_FULL), 상한 1500" value={cfg.moraleFull} min={1} onChange={(v) => onChange({ moraleFull: v })} />
      <NumField label="사기 감소/틱 (공격)" title="교전 중 tick 당 고정 사기 감소, 공격 태세 (MORALE_DROP_PER_TICK)" value={cfg.dropAttack} min={0} onChange={(v) => onChange({ dropAttack: v })} />
      <NumField label="사기 감소/틱 (방어)" title="교전 중 tick 당 고정 사기 감소, 방어 태세 (MORALE_DROP_DEFEND_PER_TICK)" value={cfg.dropDefend} min={0} onChange={(v) => onChange({ dropDefend: v })} />
      <NumField label="이탈 대기 (틱)" title="사기 붕괴 후 이탈까지 tick (DISENGAGE_TICKS)" value={cfg.disengageTicks} min={1} onChange={(v) => onChange({ disengageTicks: v })} />
      <label className="lab-field">
        <span>태세</span>
        <select value={cfg.posture} onChange={(e) => onChange({ posture: Number(e.target.value) })}>
          <option value={POSTURE.ATTACK}>공격</option>
          <option value={POSTURE.DEFEND}>방어</option>
        </select>
      </label>
      <label className="lab-field">
        <span>지형</span>
        <select value={cfg.terrain} disabled={cfg.onOwnBase} onChange={(e) => onChange({ terrain: Number(e.target.value) })}>
          {TERRAINS.map((t) => (
            <option key={t} value={t}>
              {TERRAIN_NAME[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="lab-field">
        <span title="지형 대신 기지 배율, 사기 하한 300 (사기 붕괴 후퇴 없음)">자기 기지 위</span>
        <input type="checkbox" checked={cfg.onOwnBase} onChange={(e) => onChange({ onOwnBase: e.target.checked })} />
      </label>
      <div className="lab-side-now muted small">사기 곱 지금 {sim.moraleMult(idx)}‰</div>
    </fieldset>
  );
}

function NumField({ label, title, value, min, max, onChange }: { label: string; title?: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  // 입력 중 빈칸·'-' 를 허용하려고 문자열 초안을 따로 둔다. 숫자가 되면 바로 반영, 포커스를 잃으면 확정값으로 되돌린다
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="lab-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value === '' || !Number.isFinite(v)) return;
          const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
          if (c !== value) onChange(c);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}
