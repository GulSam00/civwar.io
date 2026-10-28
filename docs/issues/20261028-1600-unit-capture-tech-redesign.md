---
id: 20261028-1600-unit-capture-tech-redesign
title: 병종 전용 점령 소모 테크 재설계 (병종 무관 점령 소모 도입 후속)
status: later
priority: medium
created: 2026-10-28
external:
---

## 맥락

- 2026-10-28 사용자 결정: 점령 소모는 병종과 상관없이 같은 양으로 한다. 지금 병종별 점령 배율은 `UNIT_ATK_MULT_PERMILLE`(창 1.0 · 검 0.85 · 기병 1.4, `shared/src/constants.ts:271`)이고, `tileCost`가 이 배율을 곱한다(`server/src/game/rules.ts:193`). 이 배율을 모두 1.0으로 맞추는 작업이 진행 중이다. 검토 문서는 `_workspace/rule-review-2026-10-28.md` 1번 항목.
- 병종 전용 점령 소모 테크 네 개는 이번 작업에서 그대로 둔다(`shared/src/constants.ts` TECH_NODES).
  - 창 SPE-2A 주둔 진지 −0.10
  - 창 SPE-3B 경장 보급 −0.10
  - 검 SWO-2B 돌격 보병 −0.20
  - 기병 CAV-3A 역참 −0.20
- 기본 배율이 같아지면 이 테크들은 "병종 고유 약점을 메우는" 의미를 잃는다. 사기 소모(`CAPTURE_MORALE_DROP` × 병종 점령 배율, `server/src/game/gauge.ts:174-180`)도 같은 배율을 읽는다.
- 사용자가 추후 테크 업데이트 때 다루기로 했다. 리마인드를 요청했다.
- 결정 필요: 위 4개 테크를 (a) 전 병종 공통 할인으로 바꿀지, (b) 다른 효과로 교체할지, (c) 삭제할지.

## 완료 조건

- [ ] 4개 테크 처리 방안 결정 (사용자)
- [ ] TECH_NODES·클라이언트 테크 설명 문구 반영
- [ ] 테스트 갱신

## 로그

- 2026-10-28: 병종 무관 점령 소모 결정에 따라 후속으로 남김. 테크 업데이트 때 리마인드
