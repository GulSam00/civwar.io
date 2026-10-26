---
id: 20261026-1500-unit-terrain-defense-coefficient
title: 병종별 지형 방어 계수 (창 크게 · 검 작게 · 기병 거의 없음)
status: later
priority: medium
created: 2026-10-26
external:
---

## 맥락

- 사용자 의도: 지형 방어 보너스를 병종마다 다르게 — 창병은 크게, 검병은 작게, 기병은 거의 없게. 지금은 `TERRAIN_BUFF`/`BASE_BUFF` 가 병종과 무관해서 병종 정체성을 못 살린다.
- 패치 11차에서 지형·기지 보정을 채널 한정으로 바꿨고(`shared/src/constants.ts`), 12차에서 구릉 방어력 +20%·산 +50% 로 올렸다. 병종 계수는 아직 없다.
- 결정 필요: 계수 표(병종 x 지형)와 적용 위치(`shared/src/combatMath.ts` `channelValues`), 클라이언트 지형 툴팁·도움말 표기 방식.

## 완료 조건

- [ ] 계수 표 확정 (사용자 결정)
- [ ] `channelValues` 에 병종 계수 반영 + 테스트 갱신
- [ ] 클라이언트 지형 툴팁·Help 갱신
- [ ] 프로토콜 문서 §36.x 와 selfplay 재측정

## 로그

- 2026-10-26: 패치 12차 완료 후 다음 후보로 남김. 사용자 응답 대기
