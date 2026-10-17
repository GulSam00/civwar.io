---
name: ai-match-monitor
description: "civwar.io를 봇만으로 한 판(실시간 최대 32분) 돌리며 모니터링하는 절차. 관전 화면 영상 녹화, 한 줄 = 사건 하나인 사람용 로그, 5분 전황 보고, 끝난 뒤 과정·결과 자기 피드백(review.md)까지 `_workspace/ai-match/<날짜>/`에 같은 양식으로 남긴다. 'AI로만 게임 돌려봐', 'AI 대전 모니터링', '봇끼리 한 판 관전', '게임 녹화하고 로그 남겨', '판 하나 돌려서 피드백' 요청 시 반드시 이 스킬을 사용할 것."
---

# AI 전용 대전 모니터링

봇 10명(기본)이 실시간으로 한 판을 두는 동안 아래를 남기고, 끝나면 스스로 피드백을 쓴다.
- 영상
- 로그
- 5분 전황 보고

자가대전(`selfplay`)은 빠르게 통계를 뽑는 용도다. 이 스킬은 **사람이 읽고 볼 수 있는 기록 한 판**을 만드는 용도다.

## 산출물 양식 (`_workspace/ai-match/<YYYY-MM-DD>[-n]/`)

| 파일 | 내용 | 커밋 |
|---|---|---|
| `game-log.md` | 머리말(맵·시드·인원·플레이어 성향·수도), 한 줄 = 사건 하나, 사이사이 5분 전황 보고, 끝에 누계 | O |
| `highlights.md` | 기지 함락·탈락·외교·1위 교체·승리 기준·종반 러시·종료만 모은 짧은 로그 | O |
| `reports/05min.md` … `30min.md`, `final.md` | 5분 전황 보고: 요약 줄, 순위표, 주목 | O |
| `review.md` | 과정·결과 자기 피드백 (아래 템플릿) | O |
| `shots/*.png` | 0분과 5분마다 찍은 전체 맵 화면, 최종 화면 | X (png 무시) |
| `video/match.webm`, `video/match-8x.webm` | 실시간 녹화(약 200MB)와 8배속 요약본(약 25MB) | X (gitignore) |
| `events.jsonl` | 원본 이벤트(재분석용) | X |

로그 한 줄 형식은 `[분:초] 분류 내용`이다. 분류는 출전·재지정·회수·태세·해산·교전·교전끝·★기지·테크·✖탈락·외교·기준·러시·1위·종료가 있다. 깃발은 `병종#번호(병력, 태세, 위치)`로, 기지는 `P3 수도 '지명'(x,y)`로 적는다.

## 절차

### 0. 준비 (한 번만)
```bash
npm run build:client
npm install --prefix .claude/skills/ai-match-monitor/recorder
```
- 녹화는 `playwright-core`(recorder 폴더, git 제외)와 `%LOCALAPPDATA%/ms-playwright/chromium-*`의 Chromium을 쓴다. `watch-game.ts`가 둘 다 자동으로 찾는다.
- Chromium이 없으면 녹화만 건너뛰고 로그·보고는 그대로 남는다. 녹화를 빼고 싶으면 `NO_VIDEO=1`을 준다.
- 클라이언트 코드를 바꿨다면 `build:client`를 다시 돌린다. 스크립트가 `client/dist`를 직접 서빙하기 때문이다.

### 1. 시험 실행 (2분)
```bash
MAX_MIN=2 npx tsx server/scripts/watch-game.ts <scratchpad>/dry 10 M NORMAL
```
확인할 것:
- `shots/final.png`이 전체 맵 관전 화면인지
- `highlights.md`가 생겼는지
- 로그 줄에 지명이 나오는지

규칙이나 프로토콜이 바뀐 직후라면 여기서 타입 오류나 화면 깨짐을 먼저 잡는다.

### 2. 본 실행 (백그라운드, 실시간 최대 32분)
- 출력 폴더는 `_workspace/ai-match/<오늘 날짜>`다. 같은 날 두 번째 판이면 `-2`를 붙인다.
- 인자는 `[폴더] [인원=10] [크기=M] [난이도=NORMAL]`이다. 포트는 기본 8095(ws)와 5185(http)를 쓰고, 겹치면 `PORT_WS`·`PORT_HTTP`로 바꾼다.
- Bash `run_in_background`로 실행하고 stdout은 scratchpad의 `watch-run.txt`로 보낸다.
- **Monitor**로 5분 보고를 받는다. 30분이 지나 만료되면 다시 켠다.
  ```bash
  tail -n +1 -f <scratchpad>/watch-run.txt | grep -E --line-buffered "전황 보고|^- 승리 기준|^- 최근|^- 주목|room .* started|recording|recorder failed|녹화 생략|Error|error|outputs:"
  ```
- 대비용으로 30분 뒤 깨어나는 ScheduleWakeup을 하나 걸어 둔다. 판이 끝나면 꼭 취소한다.

### 3. 5분마다 사용자에게 보고 (한국어)
보고 알림이 오면 `reports/NNmin.md`를 읽고 짧게 정리해 보낸다.
- 핵심 순위표: 상위 3 + 하위 2. 칸, 점유율, 병력/상한, 기지 정도만.
- 이번 구간에 일어난 일: 교전 수, 기지·수도 함락, 탈락, 병종 비율 변화
- 관찰 한두 줄: 지난 구간과 비교해 무엇이 달라졌는지, 우려되는 패턴

### 4. 끝난 뒤 분석
`events.jsonl`로 수치를 뽑는다. python은 `-X utf8`로 스크립트 파일을 만들어 실행한다(Windows 인코딩 문제).
- 교전 시간 중간값과 상위 10%. 짝이 맞는 교전만 쓰고, 짝 비율은 로그 끝 누계에 있다.
- 기지별 주인 교체 횟수, 2분 안에 되찾은 비율
- 깃발 종료 사유 분포(소진·회수·패주 귀환·전멸), 출전 병력 대비 환급
- 테크 구매 상위 노드, 병종 비율
- 30분 화면(`shots/30min.png`)을 직접 보고 시각적 패턴을 확인한다. 예: 영토 안 중립 구멍, 띠 모양 확장, 전선 형태.

### 5. 8배속 영상 (전송용 30MB 이하)
Playwright에 같이 들어 있는 ffmpeg는 필터가 빠진 빌드라서 `-vf`를 쓸 수 없다. 대신 `-itsscale`과 `-r`을 쓴다.
```bash
"$LOCALAPPDATA/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe" -y -itsscale 0.125 -i video/match.webm -r 15 -an -c:v libvpx -b:v 1000k -deadline realtime -cpu-used 8 video/match-8x.webm
```

### 6. review.md 작성 — 아래 템플릿 그대로

```markdown
# AI 전용 대전 관전 리뷰 — <날짜>
<인원> 봇(<난이도>), <맵>, 실시간 <분>. 코드 기준 <커밋>.

## 산출물            ← 파일 표
## 결과 요약          ← 판정·승자·탈락·누계, 5분 흐름 표(시각 | 1위(점유율) | 중립 땅 | 교전 | 사건)
## 게임 피드백 — 관찰된 문제   ← 번호 목록, 각 항목에 수치 근거
## 게임 피드백 — 잘 된 점
## 제안 (결정은 사용자 몫)      ← 표: # | 문제 | 조정 후보
## 과정 피드백 — 모니터링 자체에 대한 반성   ← 잘 된 점 / 부족했던 점(다음에 고칠 것)
```

원칙은 다음과 같다.
- 수치 근거 없는 주장은 쓰지 않는다.
- 한 판이라는 한계를 밝히고, 이전 자가대전이나 이전 판과 겹치는 경향만 강하게 말한다.
- 제안은 선택지로만 쓰고 직접 정하지 않는다. 설계 결정은 사용자 몫이다(design-decisions.md 원칙).
- 지난 리뷰(`_workspace/ai-match/*/review.md`)의 "부족했던 점"이 이번에 고쳐졌는지도 확인해 적는다.

### 7. 전달·커밋
- **SendUserFile**로 보낸다.
  - `review.md`, `highlights.md`, `game-log.md`
  - `shots/10min.png`, `shots/30min.png`
  - `video/match-8x.webm`
  - 원본 영상은 30MB 제한을 넘으니 데스크톱에만 있다고 알린다.
- 커밋 대상은 `game-log.md`, `highlights.md`, `reports/`, `review.md`다. events.jsonl·영상·png는 제외한다.
- 커밋 메시지 예: `chore: AI 대전 관전 기록 <날짜> — <한 줄 결과>`
- 최종 답변에는 결과 요약, 게임 쪽 문제 상위 3~5개, 모니터링 과정의 부족한 점을 한국어로 정리한다.

## 주의
- 판이 끝날 때까지 실제 시간 32분이 걸린다. 기다리는 동안 sleep 폴링을 하지 말고 Monitor 알림을 쓴다.
- 서버 규칙·프로토콜이 바뀌면 `watch-game.ts`의 `onEvent` 문구와 `report()` 열이 낡을 수 있다. 시험 실행에서 로그 줄을 눈으로 확인한다.
- 방장 자리(P1)도 시작 즉시 봇이 조종한다(`botControlled = true`). 사람 없는 판이다.
- 스크립트는 같은 프로세스에서 서버를 띄우고 `sim.step`을 감싸 이벤트를 기록한다. 서버 내부 구조(`room.sim`, `state.players`)가 바뀌면 함께 고친다.
