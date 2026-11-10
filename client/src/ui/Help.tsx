import { useEffect } from 'react';
import {
  ALLIANCE_CUTOFF_TICK,
  ALLIANCE_MIN_DURATION,
  BACKSTAB_COOLDOWN_TICK,
  BASE_HP_DMG_CAP_MILLI_PER_TICK,
  BASE_BUFF,
  BASE_HP_MILLI,
  TERRAIN,
  TERRAIN_BUFF,
  CAPITAL_HP_MILLI,
  BASE_PROD_TILES,
  CAPITAL_PROD_TILES,
  COMBAT_LOSS_BP,
  DISENGAGE_TICKS,
  DISENGAGE_VALUE_PERMILLE_V2,
  ENDGAME_RUSH_TICK,
  FLAG_MIN_TROOPS,
  FLAG_RECALL_REFUND_PERMILLE,
  FRONT_MAX_RANGE,
  FRONT_RADIUS,
  HARD_TIMEOUT_TICK,
  MAX_ALLIES_PER_PLAYER,
  NEUTRAL_BASE,
  FLAG_ORDER_COOLDOWN_TICKS,
  PROGRESS_DECAY_MILLI_PER_TICK,
  RETURN_BREAKAWAY_TICKS,
  RETURN_SPEED_PERMILLE,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_START_PCT,
  TICK_MS,
} from '@civwar/shared';
import { UnitIcon } from './unitIcons.js';
import { isNarrowScreen, useDraggableWindow } from './draggable.js';
import { techStatsOf } from './techInfo.js';
import { TERRAIN_NAME } from './text.js';
import { fmt1, terrainGoldPerMin, terrainMoveCost, unitMovePerSec } from './unitStats.js';

/** 틱 → "n초" / "n분" */
const sec = (ticks: number) => `${Math.round((ticks * TICK_MS) / 1000)}초`;
const sec1 = (ticks: number) => `${+((ticks * TICK_MS) / 1000).toFixed(1)}초`; // v5.10: 이탈 대기처럼 1초 단위가 아닌 값
const min = (ticks: number) => `${Math.round((ticks * TICK_MS) / 60000)}분`;

/** 표 한 줄 — 이름 · 값 (설명 문장 없음) */
/** 2026-11-05 지형 표기 (무테크): 칸당 이동력(평원 100) · 칸당 골드/분 — 육지 다섯 지형 */
const LAND = [TERRAIN.PLAIN, TERRAIN.FERTILE, TERRAIN.HILLS, TERRAIN.DESERT, TERRAIN.MOUNTAIN];
const NO_TECH = techStatsOf(0);

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <tr>
    <th scope="row">{k}</th>
    <td>{children}</td>
  </tr>
);

/**
 * 도움말 — 시작 안내 + 수치표. 설명 문장은 쓰지 않는다 (2026-10-24 결정: 수치만, 신규 유저 안내는 유지).
 * 수치는 shared 상수에서 가져온다 (밸런스가 바뀌면 표도 따라 바뀐다).
 */
export function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const drag = useDraggableWindow<HTMLElement>('help', !isNarrowScreen());
  const decaySec = Math.round((1000 / PROGRESS_DECAY_MILLI_PER_TICK) * TICK_MS / 1000);
  const pctOf = (pm: number) => `${pm >= 1000 ? '+' : '−'}${Math.abs(pm - 1000) / 10}%`;
  const baseMinSec = Math.round(((BASE_HP_MILLI / BASE_HP_DMG_CAP_MILLI_PER_TICK) * TICK_MS) / 1000);
  const capitalMinSec = Math.round(((CAPITAL_HP_MILLI / BASE_HP_DMG_CAP_MILLI_PER_TICK) * TICK_MS) / 1000);
  return (
    <div className="overlay help-overlay" onClick={onClose}>
      <article ref={drag.ref} style={drag.style} className="help" onClick={(e) => e.stopPropagation()}>
        <header className="help-head drag-handle" {...drag.handleProps}>
          <h2>도움말</h2>
          <button className="btn" onClick={onClose}>
            닫기 <kbd>Esc</kbd>
          </button>
        </header>

        <section>
          <h3>시작</h3>
          <ol className="help-steps">
            <li>
              맵 칸을 <b>우클릭</b> → 병종 고리에서 <UnitIcon unit={0} withName />·<UnitIcon unit={1} withName />·<UnitIcon unit={2} withName /> 선택 (<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>)
            </li>
            <li>
              고리 가운데를 눌러 방어·공격 선택 (<kbd>F</kbd>, 처음엔 내 땅 = 방어 · 적/중립 땅 = 공격) · 가까운 내 기지에서 출전
            </li>
            <li>
              육지의 <b>{THRESHOLD_START_PCT}%</b>를 먼저 차지하면 승리
            </li>
          </ol>
        </section>

        <section>
          <h3>규칙</h3>
          <table className="help-table">
            <tbody>
              <Row k="승리">
                점유율 {THRESHOLD_START_PCT}% ({min(THRESHOLD_DECAY_START)}부터 하락, 바닥 {THRESHOLD_FLOOR_PCT}%) · {min(ENDGAME_RUSH_TICK)} 종반 러시 · {min(HARD_TIMEOUT_TICK)} 종료 시 최대 영토
              </Row>
              <Row k="깃발">
                최소 {FLAG_MIN_TROOPS}명 · 점령 중엔 칸 하나를 더 못 먹을 만큼 줄면 소진 · 방어 깃발은 {FLAG_MIN_TROOPS}명 미만이면 소진 · 내 땅에서 {FRONT_MAX_RANGE}칸 · 회수 환급 {FLAG_RECALL_REFUND_PERMILLE / 10}%
              </Row>
              <Row k="병종">
                <UnitIcon unit={0} withName /> 방어↑ 속도↓ · <UnitIcon unit={1} withName /> 중간 · <UnitIcon unit={2} withName /> 공격↑ 속도↑ 방어↓
              </Row>
              <Row k="이동력">
                칸당 {LAND.map((t) => `${TERRAIN_NAME[t]} ${terrainMoveCost(t)}`).join(' · ')} · 초당 <UnitIcon unit={0} /> {fmt1(unitMovePerSec(0, NO_TECH))} · <UnitIcon unit={1} /> {fmt1(unitMovePerSec(1, NO_TECH))} · <UnitIcon unit={2} /> {fmt1(unitMovePerSec(2, NO_TECH))} · 칸 이동력 ÷ 초당 이동력 = 칸당 초
              </Row>
              <Row k="골드">
                칸당 {LAND.map((t) => `${TERRAIN_NAME[t]} +${terrainGoldPerMin(t, NO_TECH)}`).join(' · ')}/분 (테크 전)
              </Row>
              <Row k="지형 툴팁">이동력·점령·골드 값은 모두 그 칸 하나 기준 (이동력 125 = 칸 하나를 지나는 데 125 · 점령 10명 = 칸 하나에 10명)</Row>
              <Row k="태세">
                공격(마름모) · 방어(원, 보호 반경 {FRONT_RADIUS}칸) · 재지정·전환 공용 쿨타임 {sec(FLAG_ORDER_COOLDOWN_TICKS)} · 전환 시 진척도 0 · 방어 깃발을 적·중립 땅으로 보내면 공격으로 자동 전환
              </Row>
              <Row k="점령">
                진척도 100% = 1칸 · 중립 칸 비용 {NEUTRAL_BASE} · 미는 중이 아니면 {decaySec}초에 0으로 감소
              </Row>
              <Row k="전투">
                1칸 이내 접촉 · 0.2초마다 양쪽 −{COMBAT_LOSS_BP / 100}% · 지형: 평원·비옥 공격 태세 공격력 {pctOf(TERRAIN_BUFF[TERRAIN.PLAIN][0][0])} · 언덕 방어 태세 방어력 {pctOf(TERRAIN_BUFF[TERRAIN.HILLS][1][1])} · 산 방어 태세 방어력 {pctOf(TERRAIN_BUFF[TERRAIN.MOUNTAIN][1][1])} · 사막 공격력 {pctOf(TERRAIN_BUFF[TERRAIN.DESERT][0][0])} · 내 기지 칸 방어력 ×{(BASE_BUFF[1][1] / 1000).toFixed(1)}
              </Row>
              <Row k="이탈">
                전투 중 회수·재지정·태세 전환 = 대기 {sec1(DISENGAGE_TICKS)} (제자리, 전투력 −{(1000 - DISENGAGE_VALUE_PERMILLE_V2) / 10}%) · 귀환 깃발은 빠져나간 뒤 {sec1(RETURN_BREAKAWAY_TICKS)} 동안 다시 붙잡히지 않음 · 귀환 속도 ×{RETURN_SPEED_PERMILLE / 1000}
              </Row>
              <Row k="기지">
                생산 {BASE_PROD_TILES}칸분 (수도 {CAPITAL_PROD_TILES}) · 함락 최단 {baseMinSec}초 (수도 {capitalMinSec}초) · 모두 잃으면 멸망
              </Row>
              <Row k="동맹">
                최대 {MAX_ALLIES_PER_PLAYER}명 · 파기 가능 {sec(ALLIANCE_MIN_DURATION)} 뒤 · 파기 후 {sec(BACKSTAB_COOLDOWN_TICK)} 공격 불가 · {min(ALLIANCE_CUTOFF_TICK)} 이후 신규 불가
              </Row>
              <Row k="물">통행·점령 불가</Row>
            </tbody>
          </table>
        </section>

        <section>
          <h3>조작</h3>
          <p className="keys">
            칸 우클릭 = 병종 고리 · 내 기지 클릭 → 지점 클릭 (기지 재클릭 = 수비 배치) · 영토 좌클릭 = 정보 카드 · <kbd>Q</kbd>/<kbd>E</kbd> 비율 · 깃발 클릭 / <kbd>Tab</kbd> 선택 · 선택 후 우클릭 = 이동 ·{' '}
            <kbd>F</kbd> 태세 · <kbd>R</kbd> 귀환 · <kbd>T</kbd> 테크 · <kbd>P</kbd> 외교 · <kbd>O</kbd> 옵션 · <kbd>C</kbd> 색각 보조 · <kbd>V</kbd> 화살표 · <kbd>H</kbd> 수도 · <kbd>0</kbd> 전체 지도 · WASD/드래그 이동 · 휠 확대
          </p>
        </section>
      </article>
    </div>
  );
}
