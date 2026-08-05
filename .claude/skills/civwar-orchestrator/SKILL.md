---
name: civwar-orchestrator
description: "civwar.io(실시간 멀티플레이어 영토 정복 IO 게임) 개발 에이전트 파이프라인을 조율하는 오케스트레이터. 게임 설계(GDD) → 백엔드(Node.js/WebSocket 서버) → 프론트엔드(React 클라이언트) → 통합 QA까지 전 과정을 진행한다. '문명 게임 만들어줘', 'civwar 개발', 'IO 게임 서버 구현', '영토 정복 게임', '멀티플레이어 게임 시작' 요청 시 사용. 후속 작업에도 반드시 사용: '게임 규칙 수정', '밸런스 조정', '서버 로직 보완', '프로토콜 업데이트', '프론트 화면 다시', 'GDD 개선', '이전 결과 기반으로 계속', '~만 다시 해줘' 요청 시에도 이 스킬을 트리거할 것."
---

# civwar.io Orchestrator

civwar.io(30~60분 세션의 실시간 영토 정복 IO 게임) 개발을 4개 전문 에이전트의 파이프라인으로 조율하는 오케스트레이터.

## 실행 모드: 서브 에이전트

이 환경에는 `TeamCreate` 도구가 없어(SendMessage/TaskCreate만 존재) 팀 모드 대신 `Agent` 도구로 각 에이전트를 순차/부분 병렬 호출하고, 결과는 **파일(`_workspace/`) + 반환값**으로 전달한다. 이 구조는 어차피 백엔드의 WebSocket 프로토콜에 프론트엔드가 강하게 의존하는 파이프라인이라 팀 모드의 실시간 협상 이점도 원래 크지 않다.

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---------|--------------|------|------|------|
| game-designer | `game-designer` | GDD 작성 | `io-game-design` | `_workspace/01_game-designer_gdd.md` |
| multiplayer-backend-engineer | `multiplayer-backend-engineer` | 서버 구현 + 프로토콜 문서화 | `realtime-multiplayer-server` | `server/`, `_workspace/02_backend_protocol.md` |
| integration-qa (1차) | `integration-qa` | 백엔드 단독 정합성 검증 | `ws-protocol-qa` | `_workspace/04_qa_report_backend.md` |
| frontend-game-client-engineer | `frontend-game-client-engineer` | 클라이언트 구현 | `react-game-client` | `client/`, `_workspace/03_frontend_integration-notes.md` |
| integration-qa (2차) | `integration-qa` | 전체 경계면 교차 검증 | `ws-protocol-qa` | `_workspace/04_qa_report_full.md` |

모든 Agent 호출에 `model: "opus"`를 명시한다.

## 프로젝트 관리 문서 (Notion) 동기화

civwar.io의 프로젝트 관리 문서는 Notion 페이지 **civwar.io** (`page_id: 3b2286f3-bd70-8002-84bf-c9ddce1d9a57`, https://app.notion.com/p/3b2286f3bd70800284bfc9ddce1d9a57 )다. 페이지 구조: 프로젝트 개요 / 로드맵·진행 상황 / 기획(GDD 요약) / 기술 스택 / WebSocket 프로토콜 / QA·이슈 로그 / 변경 이력.

- **동기화는 오케스트레이터(리더)가 직접 수행한다.** 서브 에이전트에게 Notion 쓰기를 위임하지 않는다 — 여러 에이전트가 동시에 같은 페이지를 편집하면 포맷이 깨지거나 내용이 덮어써질 수 있고, 오케스트레이터는 어차피 각 Phase 산출물을 다 읽으므로 요약해 반영하는 편이 가장 신뢰할 수 있다.
- 매 Phase 완료 직후 해당 섹션만 `mcp__claude_ai_Notion__notion-update-page`(`command: "update_content"`, 대상 섹션만 search-and-replace)로 갱신한다. 페이지 전체를 매번 `replace_content`로 덮어쓰지 않는다 — 사용자가 Notion에서 직접 남긴 메모/코멘트를 지울 위험이 있다.
- 갱신 전 `mcp__claude_ai_Notion__notion-fetch`로 현재 페이지 내용을 먼저 읽어, 사용자가 그 사이 직접 수정한 내용이 있으면 덮어쓰지 않고 반영한다.
- Notion 업데이트가 실패해도 로컬 `_workspace/` 산출물은 이미 존재하므로 파이프라인을 멈추지 않는다 (에러 핸들링 참조).

| Phase | 갱신 섹션 | 내용 |
|-------|----------|------|
| 2 (게임 설계, 승인 후) | 로드맵(1단계 체크), 기획(GDD 요약) | GDD 핵심 결정 요약 (핵심 루프, 세션 페이싱 근거, 승리조건) |
| 3 (백엔드 구현) | 로드맵(2단계 체크), 기술 스택(실제 구조 확정), WebSocket 프로토콜 | 실제 채택한 프로젝트 구조, 메시지 스키마 요약 |
| 4 (백엔드 QA) | 로드맵(3단계 체크), QA·이슈 로그 | 통과 여부, 발견/수정된 이슈 요약 |
| 5 (프론트 구현) | 로드맵(4단계 체크) | 구현된 화면 목록 |
| 6 (전체 QA) | 로드맵(5단계 체크), QA·이슈 로그 | 최종 통과 여부, 남은 이슈 |
| 7 (정리) | 로드맵(6단계 체크), 변경 이력 | 실행 방법 요약, 날짜+요약 1줄 추가 |

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

1. `_workspace/` 디렉토리 존재 여부 확인
2. 실행 모드 결정:
   - **미존재** → 초기 실행. Phase 1로 진행
   - **존재 + 부분 수정 요청** (예: "밸런스만 조정", "프론트 화면만 다시") → 부분 재실행. 해당 Phase의 에이전트만 재호출하고, 하위 Phase(뒤 단계) 산출물 중 영향받는 부분만 다시 만든다
   - **존재 + 새 입력/전면 재설계 요청** → 새 실행. 기존 `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 이동한 뒤 Phase 1 진행
3. 부분 재실행 시: 변경이 상위 Phase(예: 백엔드 프로토콜)에 영향을 주면, 하위 Phase(프론트엔드) 재검증도 함께 스케줄한다 — 예: "전투 규칙만 수정해줘"는 GDD→백엔드까지만 바뀌어도 되지만, 프로토콜 필드가 바뀌면 프론트/QA도 재실행 대상이다.

### Phase 1: 준비
1. 사용자 요청 분석 — 실시간/턴제 여부(기본은 실시간), 특별히 요청된 게임 규칙, 기술 스택 제약(기본: React+TS+Vite 클라이언트, Node.js+TS+WebSocket 서버)
2. `_workspace/`(초기 실행 시 신규 생성) 준비

### Phase 2: 게임 설계
`game-designer` 호출 (`model: "opus"`, `run_in_background: true`). 사용자 요청 원문 + (부분 재실행이면) 기존 GDD 경로와 수정 요청을 프롬프트에 포함한다.

완료 대기 → `_workspace/01_game-designer_gdd.md` 확인 → 핵심 결정(핵심 루프, 세션 길이 근거, 승리조건, 전투 규칙)을 사용자에게 보고.

**승인 게이트 — 반드시 사용자 승인 후 Phase 3으로 진행한다.** GDD는 이후 모든 단계(프로토콜, 서버 로직, 클라이언트)의 기반이라 여기서 방향을 잘못 잡으면 뒤에서 되돌리는 비용이 훨씬 크다. 사용자가 수정을 요청하면 `game-designer`를 재호출해 반영하고 다시 보고한다. 승인 없이 임의로 Phase 3을 시작하지 않는다.

승인을 받으면 Notion 페이지의 "로드맵"(1단계 체크) + "기획(GDD 요약)" 섹션을 갱신한다.

### Phase 3: 백엔드 구현
`multiplayer-backend-engineer` 호출. 입력으로 `_workspace/01_game-designer_gdd.md` 경로를 전달한다. 프로젝트 구조(`server/`, `shared/`)를 아직 정하지 않았다면 이 에이전트가 최초로 정한다는 것을 명시한다.

완료 대기 → `_workspace/02_backend_protocol.md`와 `server/` 존재 확인 → Notion "로드맵"(2단계 체크) + "기술 스택"(실제 구조) + "WebSocket 프로토콜" 섹션 갱신.

### Phase 4: 증분 QA — 백엔드 단독 검증
`integration-qa` 호출. **이 시점에는 프론트엔드가 없으므로 검증 범위를 백엔드 내부 정합성으로 한정**한다: `_workspace/02_backend_protocol.md` ↔ 서버 코드 실제 전송, GDD ↔ 서버 로직. 출력은 `_workspace/04_qa_report_backend.md`.

치명적 이슈 발견 시 `multiplayer-backend-engineer`를 재호출해 수정 요청 (에러 핸들링 참조). 통과하면 Notion "로드맵"(3단계 체크) + "QA·이슈 로그" 갱신 후 Phase 5로 진행.

### Phase 5: 프론트엔드 구현
`frontend-game-client-engineer` 호출. 입력으로 `_workspace/01_game-designer_gdd.md`(맥락)와 `_workspace/02_backend_protocol.md`(신뢰 소스) 경로를 전달한다.

완료 대기 → `client/`와 `_workspace/03_frontend_integration-notes.md` 존재 확인 → Notion "로드맵"(4단계 체크) 갱신.

### Phase 6: 증분 QA — 전체 경계면 교차 검증
`integration-qa` 재호출. 이번에는 범위를 전체로 확장: 프로토콜 문서 ↔ 서버 ↔ 클라이언트 3자 교차 검증 (`ws-protocol-qa` 체크리스트 전체). 출력은 `_workspace/04_qa_report_full.md`.

치명적 이슈가 있으면 해당 에이전트(백엔드/프론트)를 재호출한다. 재호출 후에는 QA를 다시 1회 돌려 확인한다(무한 루프 방지를 위해 이 사이클은 최대 2회). 통과하면 Notion "로드맵"(5단계 체크) + "QA·이슈 로그" 갱신.

### Phase 7: 정리 및 보고
1. `_workspace/` 보존 (삭제하지 않음 — 사후 검증/재실행 시 입력으로 재사용)
2. 사용자에게 요약 보고: GDD 핵심 결정, 서버/클라이언트 구현 위치, 실행 방법(로컬에서 서버+클라이언트 띄우는 법), QA 결과(치명적 이슈 유무), 남은 미결정 사항(GDD의 "미결정 사항" 섹션)
3. Notion "로드맵"(6단계 체크) + "변경 이력"에 날짜와 한 줄 요약 추가
4. 개선하고 싶은 부분이 있는지 사용자에게 질문 (Phase 7 하네스 진화 원칙)

## 데이터 흐름

```
[사용자 요청]
      │
      ▼
[game-designer] → _workspace/01_gdd.md
      │
      ▼
[multiplayer-backend-engineer] → server/, _workspace/02_backend_protocol.md
      │
      ▼
[integration-qa #1: 백엔드 단독] → _workspace/04_qa_report_backend.md
      │ (통과)
      ▼
[frontend-game-client-engineer] → client/, _workspace/03_frontend_integration-notes.md
      │
      ▼
[integration-qa #2: 전체 교차검증] → _workspace/04_qa_report_full.md
      │ (통과)
      ▼
[정리 및 사용자 보고]
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 에이전트 1개 실패/중단 | 1회 재시도. 재실패 시 해당 Phase 결과 없이 다음 Phase로 진행하고, 최종 보고서에 "{에이전트} 산출물 누락" 명시 |
| QA에서 치명적 이슈 발견 | 원인 에이전트를 구체적 수정 요청과 함께 재호출 → QA 재검증. 최대 2회 사이클, 그래도 실패하면 사용자에게 보고하고 판단을 맡김 |
| GDD와 백엔드 구현이 상충 | 백엔드 에이전트의 판단(구현 관점에서 실현 가능한 값)을 우선하되, `_workspace/02_backend_protocol.md`에 GDD와 다르게 결정한 이유를 남기도록 지시 |
| 프로토콜 변경으로 프론트가 깨질 우려 | 부분 재실행 시 Phase 0에서 감지 — 백엔드 프로토콜 변경이 있었으면 프론트/QA도 재실행 대상에 자동 포함 |
| 타임아웃 | 현재까지 수집된 부분 결과로 다음 Phase 진행 여부를 사용자에게 확인 |
| Notion 동기화 실패 | 파이프라인을 막지 않는다. 로컬 `_workspace/` 산출물은 이미 존재하므로 다음 Phase로 계속 진행하고, Phase 7 최종 보고에 "Notion 갱신 실패 — 수동 동기화 필요" 명시 |

## 테스트 시나리오

### 정상 흐름
1. 사용자가 "civwar.io 실시간 영토 정복 게임 만들어줘"라고 요청
2. Phase 0에서 `_workspace/` 미존재 확인 → 초기 실행
3. Phase 2에서 `game-designer`가 GDD 작성 (핵심 루프, 세션 페이싱 30~60분 근거 포함) → 사용자에게 보고하고 **승인 대기**
4. 사용자가 승인 → Notion "로드맵"(1단계) + "기획" 섹션 갱신 → Phase 3 진행
5. Phase 3에서 `multiplayer-backend-engineer`가 `server/` + 프로토콜 문서 작성 → Notion 갱신
6. Phase 4에서 `integration-qa`가 백엔드 단독 검증 → 통과 → Notion 갱신
7. Phase 5에서 `frontend-game-client-engineer`가 `client/` 작성 → Notion 갱신
8. Phase 6에서 `integration-qa`가 전체 교차 검증 → 통과 → Notion 갱신
9. Phase 7에서 실행 방법과 함께 결과 보고, Notion 변경 이력에 기록
10. 예상 결과: `server/`, `client/`, `_workspace/` 전 산출물 생성 + QA 통과 보고 + Notion 페이지가 진행 상황을 반영

### 에러 흐름
1. Phase 6에서 `integration-qa`가 "`STATE_UPDATE`의 `troops` 필드명이 서버(`troopCount`)와 클라이언트(`troops`) 간 불일치"를 발견
2. 오케스트레이터가 `multiplayer-backend-engineer`에게 구체적 수정 요청(파일:라인 포함)과 함께 재호출
3. 수정 완료 후 `integration-qa` 재호출 → 해당 항목만 재검증
4. 통과하면 Phase 7 진행. 2회 사이클 후에도 실패하면 QA 리포트를 첨부해 사용자에게 보고하고 직접 판단을 요청
