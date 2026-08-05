# civwar.io 진행 체크리스트

- 최종 갱신: 2026-08-05
- 현재 위치: **Phase 2 완료 → 사용자 승인 게이트 대기**
- 파이프라인 정의: `.claude/skills/civwar-orchestrator/SKILL.md`

---

## 파이프라인 진행 상황

### Phase 0–1. 준비 · 설계 결정 확정 — ✅ 완료

- [x] 하네스 구성: 에이전트 4종(`game-designer`, `multiplayer-backend-engineer`, `frontend-game-client-engineer`, `integration-qa`)
- [x] 하네스 구성: 스킬 5종(`civwar-orchestrator`, `io-game-design`, `realtime-multiplayer-server`, `react-game-client`, `ws-protocol-qa`)
- [x] 체크리스트 Q&A로 설계 결정 확정 → `_workspace/00_input/design-decisions.md`
  - 실시간 / 사각 그리드(육각 교체 가능하도록 추상화) / 경량 문명 / 8~12인 / 시야 전체 공개
  - 승리조건: 점유율 임계값 + 하드 타임아웃
  - 방 코드 + 공개 로비, AI 봇, 간단한 동맹, 관전 모드
- [x] v2 개정 결정 확정 (깃발 모델 + 지형 5종 + 종반 러시)
- [x] v2.1 개정 결정 확정 (기지 시스템)

### Phase 2. 게임 설계 (GDD) — ✅ 산출물 완료 / ⏳ 승인 대기

- [x] `game-designer` 호출 → `_workspace/01_game-designer_gdd.md` **v2.1** (1,800줄)
  - [x] 1장 핵심 루프 / 2장 맵·영토 / 3장 자원·성장 / 4장 전투(깃발 모델)
  - [x] 5장 세션 페이싱 검산 (표준 39.3분 / 하한 33.8분 / 하드캡 42분)
  - [x] 6장 승리조건 / 7장 클라이언트-서버 이벤트 초안 / 8장 봇 AI
  - [x] 부록 A 밸런스 상수 전체 표 (백엔드 단일 소스)
  - [x] 미결정 사항 12건 명시
- [ ] **사용자 승인** ← 지금 여기. 승인 없이는 Phase 3으로 넘어가지 않는다
- [ ] Notion 「로드맵」 1단계 체크 + 「기획(GDD 요약)」 섹션 갱신 (⚠️ Notion MCP 미인증으로 보류)

### Phase 3. 백엔드 구현 — ⬜ 미착수

- [ ] `multiplayer-backend-engineer` 호출 (입력: GDD v2.1)
- [ ] 프로젝트 구조 확정 (`server/`, `shared/`) — 이 에이전트가 최초로 결정
- [ ] `shared/constants.ts` — GDD 부록 A 상수 이관 (permille 정수 / 고정소수점 원칙 준수)
- [ ] 토폴로지 추상화 레이어 (`neighbors` / `distance` / `tileCount`) — 사각 전제를 게임 로직에 박지 말 것
- [ ] 고정 tick 루프 + 룸/로비 + 방 코드 + 공개 로비
- [ ] 깃발 시뮬레이션 (행군 / 교전 / 회수 / 재지정 경직)
- [ ] 맵 생성 (지형 5종 + 물, 기지 보로노이 배치, Phase A/B 결정론)
- [ ] 봇 AI
- [ ] `_workspace/02_backend_protocol.md` 작성 (프론트엔드의 신뢰 소스)
- [ ] Notion 「로드맵」 2단계 + 「기술 스택」 + 「WebSocket 프로토콜」 갱신

### Phase 4. QA #1 — 백엔드 단독 정합성 — ⬜ 미착수

- [ ] `integration-qa` 호출 (범위: 프로토콜 문서 ↔ 서버 실제 전송, GDD ↔ 서버 로직)
- [ ] `_workspace/04_qa_report_backend.md`
- [ ] 치명적 이슈 시 백엔드 재호출 (최대 2 사이클)
- [ ] Notion 「로드맵」 3단계 + 「QA·이슈 로그」 갱신

### Phase 5. 프론트엔드 구현 — ⬜ 미착수

- [ ] `frontend-game-client-engineer` 호출 (입력: GDD + 프로토콜 문서)
- [ ] 로비 / 방 코드 입장 / 공개 로비
- [ ] Canvas 맵·영토 렌더링 (`pixelToTileId`와 타일 그리기를 렌더 모듈 한 곳에 격리)
- [ ] 깃발 렌더 보간 — tile-discrete 델타 기반 단조 이징, **스냅 금지** (GDD 미결정 9번)
- [ ] 깃발 발령 UI (앵커 클릭 + 병종/병력) — 발령당 2액션 유지
- [ ] HUD / 미니맵 / 테크 트리 / 동맹 / 관전 모드
- [ ] `_workspace/03_frontend_integration-notes.md`
- [ ] Notion 「로드맵」 4단계 갱신

### Phase 6. QA #2 — 전체 경계면 교차 검증 — ⬜ 미착수

- [ ] `integration-qa` 재호출 (프로토콜 문서 ↔ 서버 ↔ 클라이언트 3자)
- [ ] `_workspace/04_qa_report_full.md`
- [ ] Notion 「로드맵」 5단계 + 「QA·이슈 로그」 갱신

### Phase 7. 정리 및 보고 — ⬜ 미착수

- [ ] 로컬 실행 방법 문서화 (서버 + 클라이언트)
- [ ] 최종 보고 (구현 위치 / QA 결과 / 남은 미결정 사항)
- [ ] Notion 「로드맵」 6단계 + 「변경 이력」 갱신

---

## 블로커 / 확인 필요

| # | 항목 | 상태 |
|---|---|---|
| 1 | **GDD v2.1 승인** — 이후 모든 단계의 기반이라 승인 전 Phase 3 진행 불가 | ⏳ 사용자 대기 |
| 2 | **Notion MCP 미인증** — `/mcp` → "claude.ai Notion" 인증 필요. 인증 전까지 Phase 2 결과가 Notion에 반영되지 않음 | ⏳ 사용자 대기 |

## 구현 전 판단이 필요한 GDD 미결정 사항

전체 12건은 GDD 「미결정 사항」 절 참조. 그중 **구현 착수 전에 값을 확정해야 하는 것**:

- **#1 `FRONT_RADIUS = 6`** — 깃발 모델 전체가 이 값 위에 서 있다. 관전 지표: `flag_idle(reason="front_cleared")` 비율 > 20%면 4~5로 축소
- **#8 `ENDGAME_RUSH_TICK = 37분`** — 표준 게임 종료 40분 vs 하드캡 42분, 여유 2.66분뿐이라 모델 오차에 취약. 실측 후 35분/−30%로 앞당기는 것이 1순위

나머지 10건(깃발 속도 체감, 병종 분포, 조작량 상한, 중립 자동 전환, 산 점유율 오염, 깃발 보간 품질, 동시 공격 낙찰, 재접속 봇 인계, 동맹 상한)은 **플레이테스트 관전 지표로 사후 조정 가능**하므로 구현을 막지 않는다.
