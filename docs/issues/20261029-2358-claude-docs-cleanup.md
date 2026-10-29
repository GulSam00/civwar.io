---
id: 20261029-2358-claude-docs-cleanup
title: CLAUDE 관련 마크다운 문서(CLAUDE.md·에이전트·스킬) 재정비
status: todo
priority: low
created: 2026-10-29
external:
---

## 맥락

- 사용자 요청(2026-10-29): 현재 Claude 관련 마크다운 문서를 재정비하고 싶다.
- 대상(2026-10-29 기준)
  - `CLAUDE.md` (26줄): 하네스 목표·트리거·언어 규칙·변경 이력. 변경 이력 표의 마지막 행(2026-08-04)이 날짜순이 아니다.
  - `.claude/agents/` 4개: `game-designer.md`, `multiplayer-backend-engineer.md`, `frontend-game-client-engineer.md`, `integration-qa.md`
  - `.claude/skills/` 7개: `civwar-orchestrator`(147줄), `ai-match-monitor`, `io-game-design`, `realtime-multiplayer-server`, `react-game-client`, `ws-protocol-qa`, `issues`
  - 연결 문서: `client/UI-CONVENTIONS.md`, `docs/issues/README.md`
  - `.claude/worktrees/open-issues-d6bbb4/CLAUDE.md` 같은 워크트리 사본이 남아 있다(정리 대상인지 확인).
- 점검할 것
  - 내용이 지금 코드·GDD(v5.1)와 맞는지. 초기 구성(2026-08-04) 이후 바뀐 규칙이 문서에 남아 있는지.
  - 에이전트·스킬 간 중복 설명, 서로 어긋나는 지시.
  - Notion 동기화 언급 등 지금은 쓰지 않는 절차(이슈 관리는 `docs/issues`로 옮김).
  - 언어 규칙(한국어) 반영 여부.
- 결정 필요: 재정비 범위(내용 정합성만 vs 구조 개편까지).

## 완료 조건

- [ ] 대상 문서 전수 점검, 낡은 내용·중복·충돌 목록 작성
- [ ] 재정비 범위 결정 (사용자 결정)
- [ ] 문서 수정과 `CLAUDE.md` 변경 이력 갱신

## 로그

- 2026-10-29: 사용자 요청으로 추가. 대상 문서 목록만 확인함
