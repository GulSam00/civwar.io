---
id: 20261029-2358-combat-attrition-sim-script
title: 병력·사기 소모 속도 확인용 전투 실험실 페이지 (상수 조절형)
status: done
priority: medium
created: 2026-10-29
external:
---

## 맥락

- 사용자 판단(2026-10-29): 교전 중 병력과 사기가 너무 빨리 줄어든다. 조절하기 전에 스크립트로 전투를 돌려 소모 곡선을 확인하고 싶다.
- 지금 소모를 정하는 상수(`shared/src/constants.ts`)
  - 병종 능력치: `UNIT_ATK_PERMILLE` [900, 1000, 1200], `UNIT_DEF_PERMILLE` [1100, 1000, 900] (600~601행)
  - 사기 곱: `MORALE_FLOOR` [1050, 850, 750], `MORALE_FULL` [1100, 1200, 1300], `MORALE_MULT_CAP` 1500 (642~644행)
  - 사기 감소: `MORALE_DROP_PER_TICK` [3, 4, 6], `MORALE_DROP_DEFEND_PER_TICK` [2, 3, 5], 손실 1%당 추가 `MORALE_DROP_LOSS_K` 10 (646~650행)
  - 회복·기지: `MORALE_RECOVER` 3, `MORALE_RECOVER_BASE` 10, `MORALE_BASE_FLOOR` 300, 점령 소모 `CAPTURE_MORALE_DROP` 6
  - 틱당 사망률은 `server/src/game/combat.ts`의 `stage4a_flagCombatPhaseA`/`stage4b_flagCombatPhaseB`가 정한다. 사망률을 상수로 꺼내야 하는지 확인이 필요하다.
- 비슷한 기존 스크립트: `server/scripts/unit-matchup.ts`가 결투를 돌리지만 argv 위치 인자와 환경변수(`MU_FLOOR`, `MFULL`, `proto` 등)가 뒤섞여 있어 값을 바꿔 가며 돌리기 어렵다. `base-duel.ts`, `duels.ts`도 있다. 정리 대상은 `20261026-1505-cleanup-proto-morale-patch`와 겹친다.
- 원하는 형태
  - 스크립트 맨 위에 조절할 상수(능력치, 병종, 사기 감소 속도, 틱당 사망률, 병력, 태세, 지형, 기지 여부)를 한곳에 모은다.
  - 게임 상수는 바꾸지 않고 그 프로세스 안에서만 덮어써서 돌린다.
  - 출력: 틱(또는 초)마다 양쪽 병력·사기, 사기 0(패주)까지 걸린 시간, 교전 종료 시간, 남은 병력 비율.
  - 병종 조합(3×3)과 태세 조합을 한 번에 표로 보는 모드가 있으면 좋다.

## 완료 조건

2026-10-30 사용자 결정으로 스크립트 대신 프런트 테스트 페이지로 바꿨다.

- [x] 틱당 사망률 정리 — 무리 손실 `L = max(S × COMBAT_LOSS_BP, R × COMBAT_LOSS_FLOOR_BP, COMBAT_MIN_LOSS_MILLI) ÷ 깃발 수`, 총량 `T = 편 수 × L`을 shared `sideLossDetail`이 채널 대비(γ=2)로 나눈다. 세 값은 이미 상수라 따로 꺼낼 필요 없음
- [x] 전투 실험실 페이지 `/combat-lab` (`client/src/lab/`) — 좌우 부대 능력치·프리셋(검·창·기병), 시작/중단/1틱/끝까지/초기화, 속도 ×0.5~×30, 상단 그래프(병력·사기·실효 능력치, hover 값), 하단 전투 로그(사건만 보기)
- [x] 공통 상수(손실률·하한률·최소 손실·손실 1%당 사기 감소) 조절
- [x] 사용자가 페이지로 소모 곡선을 확인하고 조정 방향 결정 — 지금 버전이 마음에 든다고 해서 조정 없이 완료
- 병종 조합(3×3) 한 번에 보는 표 모드는 넣지 않았다. 필요하면 후속으로

## 로그

- 2026-10-29: 사용자 요청으로 추가. 관련 상수 위치만 확인함
- 2026-10-30: 스크립트 대신 프런트 페이지로 방향 변경. `client/src/lab/combatSim.ts`(서버 4a~4d 1 대 1 경로 이식) + `CombatLab.tsx`, shared `CombatFlagInput.statOverride` 선택 필드 추가(서버 미사용). 기본값(검 100 대 창 100, 평원, 공격 태세)으로 13.8초(69틱)에 사기 0 → 이탈, 남은 병력 24% / 38%
- 2026-10-31: 사용자가 현재 버전이 마음에 든다고 확인해 조정 없이 완료 처리
