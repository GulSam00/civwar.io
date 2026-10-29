---
id: 20261029-2358-claude-docs-cleanup
title: CLAUDE 관련 마크다운 문서(CLAUDE.md·에이전트·스킬) 재정비
status: done
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

## 점검 결과 (2026-10-30)

추적 중인 md 문서 전체(`docs/issues/*.md`, `_workspace/ai-match/` 제외)를 대상으로 참조처와 최종 수정일을 확인했다.

### 쓰이고 있지만 내용이 낡은 것

- `civwar-orchestrator/SKILL.md`
  - Notion 동기화 절 전체(26~41줄)와 각 Phase·에러 표·테스트 시나리오의 Notion 갱신 단계. 이슈 관리는 `docs/issues`로 옮겼고 `issues` 스킬은 "Notion을 쓰지 않는다"고 적어 서로 충돌한다.
  - 산출물 표가 초기 파이프라인 기준(`04_qa_report_backend.md`·`04_qa_report_full.md`). 실제로는 `04_qa_report_v45.md`·`04_qa_report_v51_*.md`처럼 버전별로 만든다.
  - Phase 0의 "`_workspace_{YYYYMMDD_HHMMSS}/`로 이동" 전면 재설계 절차는 한 번도 쓰이지 않았고, 지금 `_workspace/`를 옮기면 문서 참조가 깨진다.
  - 지금 작업 형태(밸런스 패치, UI 수정, 측정 스크립트, AI 대전)는 Phase 2~7 파이프라인을 거의 타지 않는다. 부분 재실행 규칙만 실제로 쓰인다.
- `game-designer.md`: 목표 문구가 "30분~1시간"으로 남아 있다(2026-10-08 세션 목표 25~32분으로 바꿀 때 빠짐).
- `integration-qa.md`: 출력 파일이 `_workspace/04_qa_report.md`로 적혀 있어 오케스트레이터 표·실제 파일명과 다르다. "`general-purpose` 타입으로 동작한다"는 문장도 지금 전용 에이전트 타입과 맞지 않는다.
- `CLAUDE.md`: 변경 이력 마지막 행(2026-08-04 Notion)이 날짜순이 아니고, 이미 쓰지 않는 Notion 절차를 설명한다.

### 쓰지 않는(사실상 폐기된) 문서

- `_workspace/HANDOFF.md`, `_workspace/CHECKLIST.md`: 마지막 수정 2026-10-09(Phase 7 완료 시점). 이후 패치 1~12차, GDD v5.x가 반영되지 않았고 참조하는 곳은 서로뿐이다. 세션 시작 훅·`docs/issues`가 그 역할을 대신한다.
- `_workspace/BACKLOG.md`: 2026-10-26 이후 갱신 없음. 남은 항목은 `docs/issues` 20261026-15xx 이슈들로 옮겨졌다. GDD·프로토콜 일부가 아직 이 파일을 가리킨다.
- `_workspace/04_qa_report_v45.md`, `_workspace/04_qa_report_v51_full.md`: 참조처 없음(기록용 보관물).
- `_workspace/01a_gdd_v2.1_map-sections.md`, `01b`, `01c`, `05_combat_redesign_draft.md`, `06_tech_overhaul_draft.md`: 초안·제안서. 본문은 GDD v5.x·프로토콜에 흡수됐지만 코드 주석(`shared/src/constants.ts`, `combatMath.ts`, 테스트)이 절 번호로 가리키므로 지우면 안 된다.
- `.claude/worktrees/open-issues-d6bbb4/`: 2026-10-26 detached HEAD(39fa54d, main에 포함됨), 작업 트리 변경 없음. 지금 문서와 다른 낡은 사본이라 grep 결과를 오염시킨다.

### 문제 없음

- `CLAUDE.md`(이력 정리 제외), `README.md`, `client/UI-CONVENTIONS.md`, `docs/issues/README.md`, `issues`·`ai-match-monitor`·`react-game-client` 스킬, `frontend-game-client-engineer.md`: 최근 갱신, 참조 연결 정상.
- `io-game-design`·`realtime-multiplayer-server`·`ws-protocol-qa` 스킬, `multiplayer-backend-engineer.md`: 일반 방법론이라 버전 의존 내용은 없다. 2026-08 이후 갱신은 없지만 지금 규칙과 충돌하는 문장도 찾지 못했다.

## 완료 조건

- [x] 대상 문서 전수 점검, 낡은 내용·중복·충돌 목록 작성
- [x] 재정비 범위 결정 (사용자 결정: 낡은 내용 수정 + 폐기 문서 정리)
- [x] 문서 수정과 `CLAUDE.md` 변경 이력 갱신

## 로그

- 2026-10-29: 사용자 요청으로 추가. 대상 문서 목록만 확인함
- 2026-10-30: 전수 점검 완료(위 "점검 결과"). 범위 결정 대기
- 2026-10-30: 사용자 결정 "낡은 내용 수정 + 폐기 정리". 오케스트레이터 Notion 절차 제거·부분 재실행 중심 갱신·QA 파일명 통일, game-designer 목표 문구, integration-qa 출력 경로, CLAUDE.md 이력 순서·새 행. HANDOFF·CHECKLIST 삭제, BACKLOG 폐기 표시(남은 항목은 20261030-0006 이슈 2건으로 이관), 워크트리 open-issues-d6bbb4 제거(브랜치 `claude/open-issues-d6bbb4`는 남김)
