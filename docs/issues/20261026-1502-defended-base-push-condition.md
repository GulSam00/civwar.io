---
id: 20261026-1502-defended-base-push-condition
title: 방어 깃발이 선 기지를 미는 조건 완화 검토
status: later
priority: medium
created: 2026-10-26
external:
---

## 맥락

- `server/src/game/gauge.ts` 의 `defendedBaseTargetRO`: 교전 중 공격 깃발이 방어된 기지를 ×0.5 로 밀 수 있는 조건이 깃발 상태 ENGAGED 또는 halted 라서, 실측에서 공격 깃발 대부분이 MARCHING 이라 거의 발동하지 않는다.
- 탈락 분석(`server/scripts/elim-analysis.ts`)에서 약소국이 잘 안 망하는 원인 중 하나로 확인된 방어 깃발 보호막이다.
- 결정 필요: 조건을 풀 것인지, 풀면 어느 정도까지(상태 조건 제거 / 거리 조건 대체).

## 완료 조건

- [ ] 완화안 선택 (사용자 결정)
- [ ] 구현 + 테스트
- [ ] elim-analysis·selfplay 재측정 (탈락 횟수 변화 확인)

## 로그

- 2026-10-26: 패치 11~12차 측정에서 탈락 0.9~1.3/판. 추가 완화 여부는 보류
