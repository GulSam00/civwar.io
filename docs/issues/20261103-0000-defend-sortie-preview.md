---
id: 20261103-0000-defend-sortie-preview
title: 내 땅이 아닌 앵커로 낸 방어 출전 — 첫 내 칸 정지 동작과 경로 예고 불일치, 봇 전환 대기 수비대 계산
status: later
priority: low
created: 2026-11-03
external:
---

## 맥락

v5.6 QA(`_workspace/04_qa_report_v56_full.md`) 남은 항목. 출전 태세를 직접 고르게 되면서 생긴 경우다.

- M-5: 방어 태세로 내 땅이 아닌 앵커에 출전하면 `defendArrived`(관할 원 안 내 칸)가 먼저 참이 되어 첫 내 칸에서 멈춘다. 기지에서 5칸 앞 중립으로 보내도 출발하지 않는데 경로 예고는 5칸이다(`server/src/game/rules.ts:146`, `client/src/input/route.ts:230`). 동작을 유지할지 정하고 예고를 맞춘다.
- M-4: 전투 중 자동 공격 전환은 `flag_disengage_started` 가 `flag_posture_changed` 보다 먼저 와서 "태세 전환 중" 표식이 붙지 않는다. 이동 이탈로 보여도 되는지 판단한다.
- M-10: 봇이 방어 전환 대기 중인 깃발을 수비대로 치지 않아 같은 앵커에 추가 투입이 생긴다(`server/src/game/bot.ts`, 관측 34회).

## 완료 조건

- [ ] M-5 동작 결정, 서버·경로 예고 일치
- [ ] M-4, M-10 처리 여부 결정

## 로그

- 2026-11-03: v5.6 QA 후속으로 생성.
