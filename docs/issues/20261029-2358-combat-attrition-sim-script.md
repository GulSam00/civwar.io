---
id: 20261029-2358-combat-attrition-sim-script
title: 병력·사기 소모 속도 확인용 전투 시뮬레이션 스크립트 (상수 조절형)
status: todo
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

- [ ] 틱당 사망률이 어디서 어떻게 계산되는지 정리 (상수로 꺼낼지 판단)
- [ ] `server/scripts/`에 상수 블록이 맨 위에 있는 전투 시뮬레이션 스크립트 작성 (실제 `combat.ts` 단계 함수 사용)
- [ ] 현재 상수 기준 병종 조합별 소모 곡선·패주 시간 출력 확인
- [ ] 실행법과 상수 설명을 스크립트 머리 주석에 기록

## 로그

- 2026-10-29: 사용자 요청으로 추가. 관련 상수 위치만 확인함
