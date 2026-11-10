---
id: 20261110-2055-base-siege-time-x2
title: 기지 공성 시간 2배, 병력 소모는 1.5배로 조정
status: todo
priority: medium
created: 2026-11-10
external:
---

## 맥락

사용자 요청(2026-11-10): 기지 공성에 걸리는 시간을 지금의 2배로 늘린다. 병력 소모는 2배가 아니라 1.5배 수준으로 늘린다.

현재 규칙 (`308bd4e` 기준):

- 기지 체력: 일반·중립 기지 `BASE_HP_MILLI` 10000, 처음 수도였던 칸 `CAPITAL_HP_MILLI` 15000(`shared/src/constants.ts:137`).
- 시간: 한 tick에 기지가 잃는 체력 상한이 `BASE_HP_DMG_CAP_MILLI_PER_TICK` 200이다(`constants.ts:150`). 일반 기지 최소 50 tick(10초), 수도 75 tick(15초). 방어 깃발이 선 기지는 상한이 더 줄고, 요새화·공성 테크 배율이 상한에도 곱해진다(`server/src/game/gauge.ts:239` 부근, `splitBaseDamage`).
- 병력: 깎은 체력 × 칸 점령 비용 ÷ 1000(클라이언트 표시 `baseCaptureTroops`, `client/src/ui/unitStats.ts:122`). 서버 계산은 `gauge.ts`의 기지 체력 전투다.

두 값을 함께 바꾸면 요청을 맞출 수 있다. 시간 = 체력 ÷ 상한, 병력 = 체력 × 칸 비용이다.
- 체력 ×1.5 (일반 15000, 수도 22500) → 병력 ×1.5
- tick당 상한 ×0.75 (200 → 150) → 시간 = 1.5 ÷ 0.75 = ×2

결정 필요: 위 방식(체력 ×1.5 + 상한 ×0.75)으로 할지, 기지 칸 점령 비용 배율 같은 다른 방식으로 할지. 점령 직후 체력(`BASE_HP_CAPTURE_PERMILLE` 50%)과 회복량(`BASE_HP_REGEN_MILLI`)을 같이 바꿀지도 정한다.

주의: 판 길이(25~32분)에 직접 영향이 있다. selfplay로 판 길이와 수도 함락·탈락 빈도를 다시 측정한다. 봇 기지 공격 판단(`BOT_BASE_HP_REF` 22500, `constants.ts:550`)도 확인한다. 관련 이슈: `20261027-2359-capital-quick-recapture`.

## 완료 조건

- [ ] 조정 방식 사용자 결정
- [ ] 상수·서버 반영, 공성 시간 2배·병력 1.5배를 테스트로 확인
- [ ] 클라이언트 표시(함락까지 병력·시간)·도움말·GDD 갱신
- [ ] selfplay로 판 길이 재측정
- [ ] 타입 검사·테스트 통과

## 로그

- 2026-11-10: 사용자 요청으로 이슈 생성.
