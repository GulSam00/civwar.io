# 이슈 / 할 일 (docs/issues)

git 으로 동기화되는 이슈 트래커다. 외부 트래커는 쓰지 않고 모든 상태가 이 폴더의 파일이다. 규칙은 `.claude/skills/issues/SKILL.md`.

## 규칙
- **이슈 하나 = 파일 하나** (`<id>.md`). 여러 머신에서 동시에 추가해도 merge conflict 가 나지 않는다.
- **id = `YYYYMMDD-HHmm-<kebab-slug>`** (로컬 시각, 파일명과 frontmatter `id` 가 같아야 한다). 순번(001)은 머신 간 충돌하므로 쓰지 않는다.
- **파일은 삭제하지 않는다.** 완료는 `status: done`.
- 비밀값(.env 값, 토큰, 키)은 적지 않는다.

## 포맷
```markdown
---
id: 20261026-1500-unit-terrain-defense-coefficient
title: 한 줄 제목
status: later        # todo | doing | later | done
priority: medium     # high | medium | low
created: 2026-10-26
external:            # 비워 둔다 (외부 트래커 연결용 자리)
---

## 맥락
왜 필요한지, 근거(파일 경로·측정 수치), 결정이 필요한 것.

## 완료 조건
- [ ] 확인 가능한 항목

## 로그
- 2026-10-26: 날짜별 한 줄 (중단했다면 어디까지 했고 다음이 무엇인지)
```

| status | 뜻 |
|---|---|
| doing | 지금 진행 중 |
| todo | 해야 할 일 (다음 후보) |
| later | 나중에. 작업 중 발견한 범위 밖 문제도 여기에 기록 |
| done | 완료 (파일은 남긴다) |

## 보기
세션을 시작하면 훅이 열린 이슈(done 제외)를 status(doing → todo → later), priority(high → medium → low) 순으로 보여준다. 수동 실행:

```bash
node .claude/skills/issues/list-issues.mjs
```

형식이 잘못된 파일은 목록에서 빠지고 끝에 `형식 오류`로 보고된다. 타입 검사: `npx tsc -p .claude/skills/issues/tsconfig.json`.

## 예시
이 폴더의 `20261026-1500-unit-terrain-defense-coefficient.md` 가 실제 이슈이자 예시다.
