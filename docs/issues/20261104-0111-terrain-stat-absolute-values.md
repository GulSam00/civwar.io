---
id: 20261104-0111-terrain-stat-absolute-values
title: 지형 스탯 표시를 비율 대신 사람이 보기 쉬운 절대값으로 일괄 변경
status: todo
priority: medium
created: 2026-11-04
external:
---

## 맥락

사용자 요청(2026-11-04): 지형 관련 스탯을 "n명/칸", "+n/분 · 100칸" 같은 단위 표기 대신 사람이 바로 읽을 수 있는 절대값으로 일괄 바꾼다.

현재 표기 위치:

- 지형 툴팁: `client/src/ui/terrainInfo.ts:132`(점령 `n명/칸`), `terrainInfo.ts:136`(골드 `+n/분 · 100칸`). 이동·전투 보정은 배지(`이동−44%`, `방어+50%`)다.
- 병종 고리: `client/src/ui/UnitRing.tsx:162`(점령 소모 `n명/칸 (중립 평원)`), `UnitRing.tsx:164`(유지비 `1000명당 골드 −n/분`).
- 계산 함수: `client/src/ui/unitStats.ts:142`(`goldPer100TilesPerMin`), `unitStats.ts:211` 부근(유지비).
- `client/src/ui/GameScreen.tsx:923` 부근 `/분` 표기.

이동은 이번에 정리한 초당 칸 수(예: 평지 검병 0.70칸/초)처럼 실제 값으로 보여 줄 수 있다. 계산식은 `server/src/game/rules.ts:221`(`speedMilliAt`)과 같아야 한다.

결정 필요:

- 지형별로 어떤 값을 보여 줄지. 예: 이동 = 칸당 초, 골드 = 칸당 초당 골드, 점령 = 칸당 병력.
- 시간 단위를 초와 분 중 무엇으로 통일할지.

`20261104-0112-ui-overhaul`(UI 전면 개선)과 범위가 겹친다. 그 이슈보다 먼저 하거나 함께 처리한다.

## 완료 조건

- [ ] 표시 값과 단위 사용자 결정
- [ ] 지형 툴팁·병종 고리·도움말 등 지형 스탯이 나오는 곳 전부 일괄 변경
- [ ] `client/UI-CONVENTIONS.md`에 표기 규칙 추가
- [ ] 테스트·타입 검사 통과

## 로그

- 2026-11-04: 사용자 요청으로 이슈 생성.
