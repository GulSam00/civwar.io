## 하네스: civwar.io 게임 개발

**목표:** 실시간 멀티플레이어 영토 정복 IO 게임(25~32분 세션, 표준 30분)을 설계-백엔드-프론트엔드-QA 파이프라인으로 개발한다.

**트리거:** 게임 개발/수정 관련 요청 시 `civwar-orchestrator` 스킬을 사용하라. 봇끼리 한 판을 돌려 관전·녹화·피드백하는 요청은 `ai-match-monitor` 스킬을 사용하라 (초기 개발뿐 아니라 규칙 수정, 밸런스 조정, 서버/프론트 보완 등 후속 요청도 포함). 단순 질문은 직접 응답 가능.

이슈 관리는 issues 스킬을 따른다.

**언어:** 모든 작업은 한국어로 진행한다. 아래 항목이 모두 해당한다.
- 사용자에게 하는 응답, 진행 보고, 마무리 요약
- 서브에이전트·다른 세션에 주는 지시문과 그 보고
- 문서(GDD, 리뷰, 이슈, `_workspace/` 산출물)
- 커밋 메시지 본문과 PR 설명
- 코드 주석, UI 문구

식별자·파일 경로·명령어·로그 원문은 그대로 둔다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-08-04 | 초기 구성 (game-designer, multiplayer-backend-engineer, frontend-game-client-engineer, integration-qa + civwar-orchestrator) | 전체 | 빈 레포에서 실시간 IO 게임 개발 하네스 신규 구축 |
| 2026-10-08 | 세션 목표 대역 30~60분 → 25~32분(표준 30분) | CLAUDE.md, game-designer, io-game-design, civwar-orchestrator | GDD v4.0에서 사용자가 표준 종료 30분으로 재조정 |
| 2026-10-18 | ai-match-monitor 스킬 추가 (봇 전용 대전 실시간 관전·녹화·5분 전황·자기 피드백, `server/scripts/watch-game.ts`) | .claude/skills/ai-match-monitor | 사용자가 AI 대전 모니터링 작업을 같은 양식으로 반복할 수 있게 스킬화 요청 |
| 2026-10-28 | 모든 작업을 한국어로 진행한다는 언어 규칙 추가 | CLAUDE.md | 다른 세션 보고가 영어로 오는 일이 있어 사용자가 명시 요청 |
| 2026-08-04 | Notion 프로젝트 관리 문서 자동 동기화 추가, Phase 2(GDD) 완료 후 사용자 승인 게이트 명시 | civwar-orchestrator | 사용자가 Notion을 프로젝트 관리 문서로 지정, 1단계 기획은 진행 전 반드시 검토받기로 합의 |
