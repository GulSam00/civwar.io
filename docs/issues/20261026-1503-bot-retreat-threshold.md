---
id: 20261026-1503-bot-retreat-threshold
title: 봇 후퇴·회수 임계값 재검토
status: later
priority: low
created: 2026-10-26
external:
---

## 맥락

- 탈락 분석: 약소국을 노린 공격 깃발의 최후 중 대부분이 회수(recalled)이고, 교전 중 회수 원인은 "버티는시간비 < 0.8"이 가장 많다(`server/src/game/bot.ts` 후퇴 규칙).
- 공격 깃발 병력/수비 병력 중앙값이 263% 로 공격 쪽이 우세한데도 회수된다. 후퇴 임계값(0.8)을 낮추거나 사기 조건을 같이 볼지 검토.

## 완료 조건

- [ ] 후퇴 규칙 개선안 선택
- [ ] 구현 + bot 테스트 갱신
- [ ] selfplay·elim-analysis 재측정

## 로그

- 2026-10-26: elim-p11.txt 기준 측정치 확보. 개선안 미정
