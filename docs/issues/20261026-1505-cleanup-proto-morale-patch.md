---
id: 20261026-1505-cleanup-proto-morale-patch
title: 낡은 시험 스크립트·proto-morale-patch.diff 정리
status: later
priority: low
created: 2026-10-26
external:
---

## 맥락

- 시제품 A 는 패치 12차로 실제 시스템에 들어갔다. `server/scripts/proto-morale-patch.diff` 는 패치 11차 이전 코드 기준이라 더 이상 적용되지 않고, `unit-matchup.ts`/`unit-hold.ts` 의 MU_FLOOR/MU_FULL·proto 옵션 주석도 낡았다.
- 스크립트(`server/scripts/unit-matchup.ts`, `unit-hold.ts`, `base-duel.ts`)가 새 사기 규칙(병종별 곱, 손실 연동 감소)을 쓰도록 옵션을 정리하거나 낡은 옵션을 제거한다.

## 완료 조건

- [ ] 낡은 diff 제거 또는 보관 위치 결정
- [ ] 스크립트 주석·옵션 정리
- [ ] tsc 통과 확인

## 로그

