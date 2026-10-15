import { useEffect } from 'react';
import {
  ALLIANCE_CUTOFF_TICK,
  ALLIANCE_MIN_DURATION,
  BACKSTAB_COOLDOWN_TICK,
  DISENGAGE_TICKS,
  ENDGAME_RUSH_TICK,
  FLAG_MIN_TROOPS,
  FLAG_RECALL_REFUND_PERMILLE,
  FRONT_MAX_RANGE,
  FRONT_RADIUS,
  HARD_TIMEOUT_TICK,
  MAX_ALLIES_PER_PLAYER,
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

/**
 * 도움말 — 규칙 설명만 (튜토리얼 없음, 디자인 결정 「화면/UX 1차」).
 * 수치는 shared 상수에서 가져온다 (밸런스가 바뀌면 문구도 따라 바뀐다).
 */
export function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const drag = useDraggableWindow<HTMLElement>('help', !isNarrowScreen());
  const decaySec = Math.round((1000 / PROGRESS_DECAY_MILLI_PER_TICK) * TICK_MS / 1000);
  return (
    <div className="overlay help-overlay" onClick={onClose}>
      <article ref={drag.ref} style={drag.style} className="help" onClick={(e) => e.stopPropagation()}>
        <header className="help-head drag-handle" {...drag.handleProps}>
          <h2>규칙 도움말</h2>
          <button className="btn" onClick={onClose}>
            닫기 <kbd>Esc</kbd>
          </button>
        </header>

        <section>
          <h3>목표</h3>
          <p>
            깃발을 보내 땅을 넓히세요. 육지의 <b>{THRESHOLD_START_PCT}%</b>를 먼저 차지하면 승리합니다. 승리 기준은 {min(THRESHOLD_DECAY_START)}부터 조금씩 내려가
            {` ${THRESHOLD_FLOOR_PCT}%`}에서 멈춥니다. {min(HARD_TIMEOUT_TICK)}이 지나면 그때 땅이 가장 넓은 사람이 이깁니다. 다른 모두가 탈락해도 이깁니다.
          </p>
        </section>

        <section>
          <h3>병력과 깃발</h3>
          <p>
            병력은 내 땅이 넓을수록 빨리 차오르고 상한도 커집니다. 병력을 <b>깃발</b>에 실어 보내야 땅을 얻습니다. 동시에 둘 수 있는 깃발 수(슬롯)는 땅
            크기와 기동 테크(참모부)로 늘어납니다.
          </p>
          <ul>
            <li>
              맵의 지점을 클릭하면 가장 가까운 내 기지에서 그 지점까지 <b>진격 경로</b>(점선 화살표)가 나오고, 지점 둘레에 <UnitIcon unit={0} withName />·<UnitIcon unit={1} withName />·<UnitIcon unit={2} withName /> <b>삼각 메뉴</b>가 뜹니다(위 = 창, 왼쪽 아래 = 검, 오른쪽 아래 = 기병). 하나를 고르면(<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>도 가능) 출전합니다. 내 기지를 먼저 클릭하면 그 기지에서 출전합니다(깃발이 겹쳐 있으면 <kbd>Alt</kbd>+클릭). 바깥 클릭·우클릭·<kbd>Esc</kbd> = 취소. 최소 {FLAG_MIN_TROOPS}명, 내 땅에서 {FRONT_MAX_RANGE}칸 안.
            </li>
            <li>
              <kbd>Q</kbd>/<kbd>E</kbd>(하단 바)로 보낼 병력 비율을 바꿉니다. 공격 깃발은 가는 길 옆의 적·중립 칸을 모두 먹으며 나아갑니다(붉은 음영이 미리 보여 줍니다).
            </li>
            <li>
              깃발(내 것·적·동맹 모두)을 클릭하면 노란 고리로 선택되고, 오른쪽 아래 정보 창에 <b>공격력·방어력</b>(병종 기본 × 테크, 지형 보정 제외)이 나옵니다. 출전한 내 부대는 하단 병력 바 위에 칩(병종·병력·태세)으로 보이고, 칩을 누르면 그 부대를 선택하고 화면을 옮깁니다(<kbd>Tab</kbd>도 같음).
            </li>
            <li>
              내 부대를 선택한 채 <b>우클릭하면 그곳으로 이동</b>합니다. 내 땅·내 기지면 그 자리로 가서 방어하고, 적·중립 땅이면 공격합니다 — 태세는 도착 지점으로 자동으로 정해집니다. 선택한 부대 옆에 뜨는 <b>[귀환]</b>(<kbd>R</kbd>, 가까운 내 기지로 — 취소할 수 없음)·<b>[태세 변경]</b>(<kbd>F</kbd>, 쿨타임 표시) 버튼으로도 명령합니다. 회수하면 남은 병력의 {FLAG_RECALL_REFUND_PERMILLE / 10}%가 돌아옵니다.
            </li>
            <li>
              <b><UnitIcon unit={0} withName /></b>(창)은 느리지만 방어에 강하고, <b><UnitIcon unit={2} withName /></b>(말굽)은 빠르고 공격에 강하지만 방어에 약합니다. <b><UnitIcon unit={1} withName /></b>(검)은 그 사이입니다. 맵의 깃발 표식 가운데에도 같은 아이콘이 그려집니다.
            </li>
          </ul>
        </section>

        <section>
          <h3>태세 — 공격과 방어</h3>
          <p>
            적·중립 땅으로 보내면 <span className="atk">공격 태세</span>(마름모), 내 땅으로 보내면 <span className="def">방어 태세</span>(원)가 기본으로 붙습니다. 커서의
            경로 색(붉음/푸름)과 삼각 메뉴가 미리 알려 주고, 방어 태세는 보호 원(반경 {FRONT_RADIUS}칸)도 보여 줍니다. 선택한 깃발은 <kbd>F</kbd>로 태세를 바꿀 수 있지만 {sec(POSTURE_COOLDOWN_TICKS)} 쿨타임이 있고,
            전투 중이거나 이탈 대기 중에는 바꿀 수 없습니다. 바꾸면 진척도가 0이 됩니다.
          </p>
        </section>

        <section>
          <h3>게이지와 진척도</h3>
          <p>
            공격 깃발은 앵커 주변 원 안에서 내 땅과 맞닿은 칸을 하나씩 골라 <b>진척도</b>를 밀어 올립니다. 100%가 되면 그 칸을 점령합니다. 대상 칸은 내 땅
            쪽에서부터 색이 차오릅니다. 적 땅은 중립보다 비싸고, 지형(언덕·산은 비쌈, 사막은 쌈)과 기지에서 먼 거리(보급선)가 비용을 올립니다.
          </p>
          <p>
            밀지 않는 동안 진척도는 자동으로 줄어듭니다(가득 찬 게이지가 약 {decaySec}초에 0). 줄어드는 중에는 게이지가 회색으로 깜빡입니다. 단, 바로 옆(1칸)에 적
            깃발이 있거나 전투 중이면 줄지 않고 유지됩니다.
          </p>
        </section>

        <section>
          <h3>깃발 전투와 지형</h3>
          <p>
            적 깃발과 1칸 이내(대각선 포함 8방향)로 붙으면 전투가 시작되고 양쪽 병력이 줄어듭니다. 싸우는 두 깃발 사이에 선이 그어지고, 공격 태세 쪽엔 검, 방어 태세 쪽엔 방패 아이콘이 붙습니다(멀리서 보면 쌍마다 아이콘 하나). 전투 중에는 게이지를 밀지 않습니다. 병력이 0이 된 깃발은 <b>패주</b>해 자동으로
            돌아가며(회색, 조작 불가) 슬롯을 계속 차지합니다. 공격 태세는 공격력, 방어 태세는 방어력으로 싸우며, 방어 태세는 언덕(×1.3)·산(×1.6)·비옥지에서 더
            단단합니다. 여러 깃발이 함께 싸우면 한 편이 되어 손실을 나눕니다.
          </p>
        </section>

        <section>
          <h3>행군 차단(대치)과 후퇴</h3>
          <p>
            방어 태세 깃발 바로 옆 칸(대각선 포함)으로는 적이 지나가지 못하고 멈춥니다(<b>대치</b>, 주황 태그). 대치 중 공격 태세로 바꾸면 다음 순간 전투가 시작됩니다.
          </p>
          <p>
            전투 중에 재지정·회수하면 바로 빠지지 못하고 <b>이탈 대기</b> {sec(DISENGAGE_TICKS)}(노란 호)를 치릅니다. 그동안 움직일 수 없고 방어력이 절반이 되며 계속 피해를
            받습니다.
          </p>
        </section>

        <section>
          <h3>물과 상륙</h3>
          <p>
            짙은 남색 깊은 물은 지나갈 수 없습니다. 탁한 청색 얕은 물은 지나갈 수 있지만 매우 느리고(평지의 0.2배), 내 땅이 아닌 곳에서는 병력이 조금씩 줄어듭니다.
            물은 점령할 수 없고 앵커로 고를 수도 없습니다. 물 건너 땅을 공격(상륙)하면 물 위 깃발이 불리합니다. 기동 테크(조선술·상륙정)가 물 위 속도와 상륙 전투를 개선합니다.
          </p>
        </section>

        <section>
          <h3>기지</h3>
          <p>
            칸을 꽉 채운 사각형이 기지입니다(십자 = 일반 기지, 금색 테두리 + 별 = 수도). 영토 한가운데에는 그 플레이어의 이름이 떠 있습니다. 기지는 깃발의 출발점이고 보급선 기준입니다. 기지 칸은 바로 점령되지 않고 체력(위쪽 바)을 깎아야 함락됩니다.
            함락되면 체력 절반으로 새 주인에게 넘어갑니다. 기지마다 지명이 있고(수도는 금색 이름), 내 기지 칸 위에 방어 태세로 서면 지형 대신 ×1.5로 지킵니다 — 그 깃발을 이기기 전에는 기지 체력이 깎이지 않습니다.
          </p>
          <p>
            기지마다 <b>생산력</b>이 있습니다. 함락될 때마다 절반이 되고(두 번 연속이면 25%), 그 뒤 분당 약 17%씩 회복합니다 — 기지 아래 금색 바가 차오릅니다. 내 땅은 가장 가까운 기지 지역에 속해 그 기지 생산력만큼 병력·골드를 냅니다. HUD의 병력·골드에 마우스를 올리면 기지별 + 기타 출처가 보입니다.
            기지를 <b>모두</b> 잃으면 즉시 멸망하고, 남은 땅은 전부 마지막 기지를 점령한 나라에 합병됩니다.
          </p>
        </section>

        <section>
          <h3>테크와 골드</h3>
          <p>
            골드는 땅(특히 비옥지)에서 나옵니다. HUD의 <b>테크</b> 버튼이나 <kbd>T</kbd>로 테크 창을 엽니다(버튼 숫자 = 지금 살 수 있는 노드 수). 갈래 7개(군사·경제·영토·기동 + 창병·검병·기병) × 1·2·3티어
            트리이고, 노드마다 부모 하나 — 부모를 사야 자식이 열립니다. 노드를 누르면 상세 창에 효과(지금 → 구매 후 값), 가격, 선행 조건, 모일 때까지 걸리는 시간이 나오고
            <b>구매</b> 버튼으로 삽니다. 노드 표시: 색 채움 + 체크 = 보유, 굵은 테두리 = 구매 가능, 얇은 테두리 + 진행 링 = 골드 부족, 시계 = 요청 중, 점선 + 자물쇠 = 잠김.
            하나 살 때마다 남은 모든 노드가 6% 비싸집니다. <kbd>Esc</kbd>나 창 바깥 클릭으로 닫습니다. 관전 중에는 따라가는 플레이어의 트리를 볼 수 있습니다.
            내 땅을 앵커로 두고 자리 잡은 깃발(주둔)은 골드 유지비를 냅니다 — 행군·대기 중에는 들지 않습니다.
          </p>
        </section>

        <section>
          <h3>동맹</h3>
          <p>
            <kbd>P</kbd> 외교 창에서 동맹을 제안·수락합니다(최대 {MAX_ALLIES_PER_PLAYER}명). 동맹끼리는 공격할 수 없습니다. 성립 후 {sec(ALLIANCE_MIN_DURATION)}이 지나야 파기할 수 있고, 파기해도
            {` ${sec(BACKSTAB_COOLDOWN_TICK)}`} 동안은 서로 공격할 수 없습니다. {min(ALLIANCE_CUTOFF_TICK)}부터는 새 동맹을 맺을 수 없습니다. 생존자 전원이 동맹이 되면 30초 뒤 모든
            동맹이 강제로 풀리고 잠시 재체결이 금지됩니다. 점유율은 개인 기준입니다 — 동맹 합산으로는 이기지 못합니다.
          </p>
        </section>

        <section>
          <h3>종반</h3>
          <p>
            {min(ENDGAME_RUSH_TICK)}부터 <b>종반 러시</b>: 땅 점령 비용이 싸져 판이 빠르게 정리됩니다. {min(HARD_TIMEOUT_TICK)}에 시간 종료.
          </p>
        </section>

        <section>
          <h3>옵션</h3>
          <p>
            HUD의 톱니 버튼이나 <kbd>O</kbd>로 옵션 창을 엽니다. 색각 보조(영토 무늬·플레이어 번호), 깃발 이동 방향 화살표(모두 / 내 깃발만 / 숨김), 지형 툴팁과 그
            항목(지형 유형·방어 배율·이동 속도·점령 비용·골드·소유자·기지 체력)을 고를 수 있고, 설정은 이 브라우저에 저장됩니다. <kbd>Esc</kbd> 또는 바깥 클릭으로 닫습니다.
          </p>
        </section>

        <section>
          <h3>조작 요약</h3>
          <p className="keys">
            지점(또는 기지 → 지점) 클릭 → 삼각 메뉴 병종(<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>) 출전 · <kbd>Q</kbd>/<kbd>E</kbd> 비율 · 깃발 클릭(또는 병력 바 위 칩) 선택 · 내 부대 선택 + 우클릭 이동 · <kbd>F</kbd> 태세 ·{' '}
            <kbd>R</kbd> 귀환 · 창 제목 줄 드래그 = 창 옮기기 · <kbd>Tab</kbd> 내 깃발 · <kbd>T</kbd> 테크(노드 클릭 → 상세 → 구매, <kbd>Esc</kbd> 닫기) · <kbd>P</kbd> 외교 · <kbd>O</kbd> 옵션(톱니 버튼) · <kbd>C</kbd> 색각 보조 · <kbd>V</kbd> 이동 방향 화살표(모두 → 내 깃발만 → 숨김) · <kbd>H</kbd> 수도 · <kbd>0</kbd> 전체 지도 · 드래그/WASD 이동 · 휠 확대 · 미니맵 클릭 이동
          </p>
        </section>
      </article>
    </div>
  );
}
