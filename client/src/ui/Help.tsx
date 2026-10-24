import { useEffect } from 'react';
import {
  ALLIANCE_CUTOFF_TICK,
  ALLIANCE_MIN_DURATION,
  BACKSTAB_COOLDOWN_TICK,
  BASE_HP_DMG_CAP_MILLI_PER_TICK,
  BASE_HP_MILLI,
  CAPITAL_HP_MILLI,
  BASE_PROD_TILES,
  CAPITAL_PROD_TILES,
  COMBAT_LOSS_BP,
  DISENGAGE_TICKS,
  ENDGAME_RUSH_TICK,
  FLAG_MIN_TROOPS,
  FLAG_RECALL_REFUND_PERMILLE,
  FRONT_MAX_RANGE,
  FRONT_RADIUS,
  HARD_TIMEOUT_TICK,
  MAX_ALLIES_PER_PLAYER,
  NEUTRAL_BASE,
  POSTURE_COOLDOWN_TICKS,
  PROGRESS_DECAY_MILLI_PER_TICK,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_START_PCT,
  TICK_MS,
} from '@civwar/shared';
import { UnitIcon } from './unitIcons.js';
import { isNarrowScreen, useDraggableWindow } from './draggable.js';

/** 틱 → "n초" / "n분" */
const sec = (ticks: number) => `${Math.round((ticks * TICK_MS) / 1000)}초`;
const min = (ticks: number) => `${Math.round((ticks * TICK_MS) / 60000)}분`;

/** 표 한 줄 — 이름 · 값 (설명 문장 없음) */
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
              내 땅 = 방어 · 적/중립 땅 = 공격 · 가까운 내 기지에서 출전
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
                최소 {FLAG_MIN_TROOPS}명 · 내 땅에서 {FRONT_MAX_RANGE}칸 · 회수 환급 {FLAG_RECALL_REFUND_PERMILLE / 10}%
              </Row>
              <Row k="병종">
                <UnitIcon unit={0} withName /> 방어↑ 속도↓ · <UnitIcon unit={1} withName /> 중간 · <UnitIcon unit={2} withName /> 공격↑ 속도↑ 방어↓
              </Row>
              <Row k="태세">
                공격(마름모) · 방어(원, 보호 반경 {FRONT_RADIUS}칸) · 전환 쿨타임 {sec(POSTURE_COOLDOWN_TICKS)} · 전환 시 진척도 0
              </Row>
              <Row k="점령">
                진척도 100% = 1칸 · 중립 칸 비용 {NEUTRAL_BASE} · 미는 중이 아니면 {decaySec}초에 0으로 감소
              </Row>
              <Row k="전투">
                1칸 이내 접촉 · 0.2초마다 양쪽 −{COMBAT_LOSS_BP / 100}% · 방어 태세 언덕 ×1.3 · 산 ×1.6 · 내 기지 칸 ×1.5
              </Row>
              <Row k="이탈">
                전투 중 회수·재지정·태세 전환 = 대기 {sec(DISENGAGE_TICKS)} (방어력 ×0.5)
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
