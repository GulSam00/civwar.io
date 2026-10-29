---
name: civwar-orchestrator
description: "civwar.io(실시간 멀티플레이어 영토 정복 IO 게임) 개발 에이전트 파이프라인을 조율하는 오케스트레이터. 게임 설계(GDD) → 백엔드(Node.js/WebSocket 서버) → 프론트엔드(React 클라이언트) → 통합 QA까지 전 과정을 진행한다. '문명 게임 만들어줘', 'civwar 개발', 'IO 게임 서버 구현', '영토 정복 게임', '멀티플레이어 게임 시작' 요청 시 사용. 후속 작업에도 반드시 사용: '게임 규칙 수정', '밸런스 조정', '서버 로직 보완', '프로토콜 업데이트', '프론트 화면 다시', 'GDD 개선', '이전 결과 기반으로 계속', '~만 다시 해줘' 요청 시에도 이 스킬을 트리거할 것."
---

# civwar.io Orchestrator

civwar.io(25~32분 세션 · 표준 30분의 실시간 영토 정복 IO 게임) 개발을 4개 전문 에이전트의 파이프라인으로 조율하는 오케스트레이터.

초기 구축(Phase 1~7 전체)은 2026-10-09에 한 번 끝났다. 지금 요청은 대부분 **부분 재실행**(규칙 수정, 밸런스 패치, 서버 보완, UI 수정, QA)이다. Phase 0에서 범위를 정하고 필요한 Phase만 돈다.

## 실행 모드: 서브 에이전트

이 환경에는 `TeamCreate` 도구가 없어(SendMessage/TaskCreate만 존재) 팀 모드 대신 `Agent` 도구로 각 에이전트를 순차/부분 병렬 호출하고, 결과는 **파일(`_workspace/`) + 반환값**으로 전달한다. 이 구조는 어차피 백엔드의 WebSocket 프로토콜에 프론트엔드가 강하게 의존하는 파이프라인이라 팀 모드의 실시간 협상 이점도 원래 크지 않다.

에이전트에게 주는 지시문과 에이전트의 보고는 한국어로 한다(`CLAUDE.md` 언어 규칙).

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---------|--------------|------|------|------|
| game-designer | `game-designer` | GDD 작성·갱신 | `io-game-design` | `_workspace/01_game-designer_gdd.md` |
| multiplayer-backend-engineer | `multiplayer-backend-engineer` | 서버 구현 + 프로토콜 문서화 | `realtime-multiplayer-server` | `server/`, `shared/`, `_workspace/02_backend_protocol.md` |
| integration-qa (1차) | `integration-qa` | 백엔드 단독 정합성 검증 | `ws-protocol-qa` | `_workspace/04_qa_report_<판>_backend.md` |
| frontend-game-client-engineer | `frontend-game-client-engineer` | 클라이언트 구현 | `react-game-client` | `client/`, `_workspace/03_frontend_integration-notes.md` |
| integration-qa (2차) | `integration-qa` | 전체 경계면 교차 검증 | `ws-protocol-qa` | `_workspace/04_qa_report_<판>_full.md` |

- QA 보고서는 덮어쓰지 않고 GDD 판 번호를 붙여 새로 만든다(예: `04_qa_report_v51_backend.md`). 판 번호 없는 `04_qa_report_backend.md`·`04_qa_report_full.md`는 초기 구축 때 기록이다.
- 모든 Agent 호출에 `model: "opus"`를 명시한다.

## 관련 문서와 다른 스킬

| 문서 | 용도 |
|---|---|
| `_workspace/01_game-designer_gdd.md` | 현행 규칙서. 구 판 전문은 `01z_gdd_history_v2-v4.6.md` |
| `_workspace/02_backend_protocol.md` | 프로토콜·서버 구현 기록. 프론트의 신뢰 소스 |
| `_workspace/00_input/design-decisions.md` | 사용자 결정 원문 |
| `client/UI-CONVENTIONS.md` | UI 규칙. 프론트 작업 전에 읽는다 |
| `docs/issues/` | 할 일·이슈. `issues` 스킬로 관리한다 |

- 봇끼리 한 판을 돌려 관전·녹화·피드백하는 요청은 `ai-match-monitor` 스킬이 맡는다.
- 작업 중 범위 밖 문제를 발견하면 `issues` 스킬에 따라 `docs/issues/`에 `later`로 남긴다.

## 워크플로우

### Phase 0: 컨텍스트 확인

1. 요청과 관련된 `docs/issues/` 이슈가 있으면 먼저 읽고 `status: doing`으로 바꾼다.
2. 실행 범위 결정:
   - **부분 수정 요청** (예: "밸런스만 조정", "프론트 화면만 다시") → 해당 Phase의 에이전트만 재호출하고, 뒤 Phase 산출물 중 영향받는 부분만 다시 만든다.
   - **전면 재설계 요청** → `_workspace/` 문서는 옮기거나 지우지 않는다. 코드 주석·테스트·이슈가 경로와 절 번호로 참조하기 때문이다. GDD를 새 판으로 갱신하고, 바뀌기 전 본문은 `01z_gdd_history_*.md`처럼 따로 보관한다.
3. 변경이 상위 Phase(예: 백엔드 프로토콜)에 영향을 주면 하위 Phase(프론트엔드) 재검증도 함께 스케줄한다 — 예: "전투 규칙만 수정해줘"는 GDD→백엔드까지만 바뀌어도 되지만, 프로토콜 필드가 바뀌면 프론트/QA도 재실행 대상이다.

### Phase 1: 준비
사용자 요청 분석 — 특별히 요청된 게임 규칙, 기술 스택 제약(기본: React+TS+Vite 클라이언트, Node.js+TS+WebSocket 서버), 사용자 결정이 필요한 항목.

### Phase 2: 게임 설계
`game-designer` 호출 (`model: "opus"`, `run_in_background: true`). 사용자 요청 원문 + 기존 GDD 경로와 수정 요청을 프롬프트에 포함한다.

완료 대기 → `_workspace/01_game-designer_gdd.md` 확인 → 핵심 결정(핵심 루프, 세션 길이 근거, 승리조건, 전투 규칙 중 바뀐 것)을 사용자에게 보고.

**승인 게이트 — 반드시 사용자 승인 후 Phase 3으로 진행한다.** GDD는 이후 모든 단계(프로토콜, 서버 로직, 클라이언트)의 기반이라 여기서 방향을 잘못 잡으면 뒤에서 되돌리는 비용이 훨씬 크다. 사용자가 수정을 요청하면 `game-designer`를 재호출해 반영하고 다시 보고한다. 승인 없이 임의로 Phase 3을 시작하지 않는다.

### Phase 3: 백엔드 구현
`multiplayer-backend-engineer` 호출. 입력으로 `_workspace/01_game-designer_gdd.md` 경로와 바뀐 절을 전달한다.

완료 대기 → `_workspace/02_backend_protocol.md`의 새 절과 `server/` 변경 확인.

### Phase 4: 증분 QA — 백엔드 단독 검증
`integration-qa` 호출. **검증 범위를 백엔드 내부 정합성으로 한정**한다: `_workspace/02_backend_protocol.md` ↔ 서버 코드 실제 전송, GDD ↔ 서버 로직. 출력은 `_workspace/04_qa_report_<판>_backend.md`.

치명적 이슈 발견 시 `multiplayer-backend-engineer`를 재호출해 수정 요청 (에러 핸들링 참조). 통과하면 Phase 5로 진행.

### Phase 5: 프론트엔드 구현
`frontend-game-client-engineer` 호출. 입력으로 `_workspace/01_game-designer_gdd.md`(맥락), `_workspace/02_backend_protocol.md`(신뢰 소스), `client/UI-CONVENTIONS.md`(UI 규칙) 경로를 전달한다.

완료 대기 → `client/` 변경과 `_workspace/03_frontend_integration-notes.md`의 새 절 확인.

### Phase 6: 증분 QA — 전체 경계면 교차 검증
`integration-qa` 재호출. 이번에는 범위를 전체로 확장: 프로토콜 문서 ↔ 서버 ↔ 클라이언트 3자 교차 검증 (`ws-protocol-qa` 체크리스트 전체). 출력은 `_workspace/04_qa_report_<판>_full.md`.

치명적 이슈가 있으면 해당 에이전트(백엔드/프론트)를 재호출한다. 재호출 후에는 QA를 다시 1회 돌려 확인한다(무한 루프 방지를 위해 이 사이클은 최대 2회).

### Phase 7: 정리 및 보고
1. `_workspace/` 보존 (삭제하지 않음 — 사후 검증/재실행 시 입력으로 재사용)
2. 관련 `docs/issues/` 이슈의 체크리스트·로그·`status`를 갱신하고, 새로 나온 미결정 사항은 이슈로 남긴다.
3. 사용자에게 요약 보고: 바뀐 규칙, 서버/클라이언트 변경 위치, 실행·테스트 방법, QA 결과(치명적 이슈 유무), 남은 결정 사항
4. 개선하고 싶은 부분이 있는지 사용자에게 질문 (하네스 진화 원칙)

## 데이터 흐름

```
[사용자 요청]
      │
      ▼
[game-designer] → _workspace/01_game-designer_gdd.md
      │ (사용자 승인)
      ▼
[multiplayer-backend-engineer] → server/, shared/, _workspace/02_backend_protocol.md
      │
      ▼
[integration-qa #1: 백엔드 단독] → _workspace/04_qa_report_<판>_backend.md
      │ (통과)
      ▼
[frontend-game-client-engineer] → client/, _workspace/03_frontend_integration-notes.md
      │
      ▼
[integration-qa #2: 전체 교차검증] → _workspace/04_qa_report_<판>_full.md
      │ (통과)
      ▼
[정리: docs/issues 갱신 + 사용자 보고]
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 에이전트 1개 실패/중단 | 1회 재시도. 재실패 시 해당 Phase 결과 없이 다음 Phase로 진행하고, 최종 보고서에 "{에이전트} 산출물 누락" 명시 |
| QA에서 치명적 이슈 발견 | 원인 에이전트를 구체적 수정 요청과 함께 재호출 → QA 재검증. 최대 2회 사이클, 그래도 실패하면 사용자에게 보고하고 판단을 맡김 |
| GDD와 백엔드 구현이 상충 | 백엔드 에이전트의 판단(구현 관점에서 실현 가능한 값)을 우선하되, `_workspace/02_backend_protocol.md`에 GDD와 다르게 결정한 이유를 남기도록 지시 |
| 프로토콜 변경으로 프론트가 깨질 우려 | 부분 재실행 시 Phase 0에서 감지 — 백엔드 프로토콜 변경이 있었으면 프론트/QA도 재실행 대상에 자동 포함 |
| 타임아웃 | 현재까지 수집된 부분 결과로 다음 Phase 진행 여부를 사용자에게 확인 |

## 테스트 시나리오

### 정상 흐름 (부분 재실행)
1. 사용자가 "구릉 방어 보정을 올려줘"라고 요청
2. Phase 0에서 관련 이슈를 찾아 `doing`으로 바꾸고, GDD → 백엔드 → 백엔드 QA 범위로 결정 (프로토콜 필드 변화 없음 → 프론트 제외)
3. Phase 2에서 `game-designer`가 GDD 해당 절 갱신 → 사용자에게 보고하고 **승인 대기**
4. 승인 → Phase 3에서 `multiplayer-backend-engineer`가 상수·로직 수정, 프로토콜 문서에 새 절 추가
5. Phase 4에서 `integration-qa`가 백엔드 단독 검증 → 통과
6. Phase 7에서 이슈 로그 갱신, 변경 내용과 테스트 결과 보고

### 에러 흐름
1. Phase 6에서 `integration-qa`가 "`STATE_UPDATE`의 `troops` 필드명이 서버(`troopCount`)와 클라이언트(`troops`) 간 불일치"를 발견
2. 오케스트레이터가 `multiplayer-backend-engineer`에게 구체적 수정 요청(파일:라인 포함)과 함께 재호출
3. 수정 완료 후 `integration-qa` 재호출 → 해당 항목만 재검증
4. 통과하면 Phase 7 진행. 2회 사이클 후에도 실패하면 QA 리포트를 첨부해 사용자에게 보고하고 직접 판단을 요청
