---
id: 20261110-2056-defend-posture-capture
title: 방어 태세에서도 점령 가능하게 변경 (점령 속도 0.6배)
status: todo
priority: medium
created: 2026-11-10
external:
---

## 맥락

사용자 요청(2026-11-10): 방어 태세 깃발도 땅을 점령할 수 있게 한다. 점령 속도는 공격 태세의 0.6배다.

현재 규칙 (`308bd4e` 기준):

- 점령은 공격 태세만 한다. `attackReady`(`server/src/game/rules.ts:86`)와 `pushing`(`rules.ts:91`)이 `POSTURE.ATTACK`을 요구한다. 행군 중 정지 점령, ENGAGED 진입, 점령 게이지(`server/src/game/gauge.ts`), 소진 판정(`stage10_flagEnd`)이 이 함수들에 묶여 있다.
- 방어 태세는 ZOC를 만들고, 적 땅을 피하는 경로(`nextStep` → `stepTowardDefend`)로 움직이며, 도착하면 주둔한다(`defendArrived`). 방어 태세 사기 감소는 공격보다 작다(`MORALE_DROP_DEFEND_PER_TICK`).
- 점령 속도 기준값은 `FLAG_TILE_RATE_BASE`·`FLAG_SPEND_RATE_PERMILLE`(`shared/src/constants.ts:222` 부근)이다.

결정 필요:

- 방어 깃발이 언제 점령하는지. 예: 주둔 중 옆 칸만 점령, 행군 중에도 점령, 적 땅 회피 경로는 그대로.
- 0.6배를 무엇에 적용하는지. 게이지 진행 속도만인지, 병력 소모도 같이 줄이는지.
- 방어 깃발이 점령하는 동안 ZOC·방어 보너스를 그대로 유지할지.
- 방어 깃발도 점령 중 병력이 바닥나면 소진되는지(현재 공격 깃발만 "칸 하나를 더 못 살 때 소진", GDD v5.9).

주의: 방어 태세가 공격 태세의 상위 호환이 되지 않는지 확인한다. 봇(`server/src/game/bot.ts`)의 태세 선택과 클라이언트 점령 예고(`client/src/ui/engagePreview.ts`)도 같이 맞춘다.

## 완료 조건

- [ ] 결정 필요 항목 사용자 결정, GDD·프로토콜 문서 반영
- [ ] 서버 구현 (방어 태세 점령, 속도 0.6배)
- [ ] 봇·클라이언트 예고·도움말 갱신
- [ ] selfplay로 태세 사용 비율과 판 길이 확인
- [ ] 타입 검사·테스트 통과

## 로그

- 2026-11-10: 사용자 요청으로 이슈 생성.
