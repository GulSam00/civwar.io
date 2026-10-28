# QA 보고서 — GDD v5.1 백엔드 단독 검증 (오케스트레이터 Phase 4)

- 작성: 2026-10-28, integration-qa
- 대상: 커밋 전 작업 트리 (`af65ac0` + 미커밋 v5.1 변경). `client/` 는 보지 않았다(프론트 할 일만 목록으로 남김).
- 기준 문서: `_workspace/01_game-designer_gdd.md` v5.1 (2.5 · 4.2 · 4.4 · 4.5 · 4.6 · 7.2 · 7.3 · 8 · 부록 A·B), `_workspace/02_backend_protocol.md` §37 · §4 · §6.1 · 이벤트 표
- 코드는 고치지 않았다.

## 결론

**통과 (치명적 문제 0건).** GDD 규칙과 서버 코드, 프로토콜 문서와 실제 송신 shape, 결정론, 봇 회귀 모두 어긋남을 찾지 못했다. 경미한 문제 5건은 문서 낡음과 QA 스크립트 미갱신이고, 게임 동작에는 영향이 없다.

## 실행한 검증

| 항목 | 명령 | 결과 |
|---|---|---|
| 단위·통합 테스트 | `npx vitest run server` | **341/341 통과** (21 파일) |
| 타입 검사 | `npx tsc -p shared --noEmit`, `npx tsc -p server --noEmit` (server 는 src · test · scripts 포함) | 둘 다 0 오류. `.js` 생성 없음 |
| 헤드리스 전 판 + 문서 스키마 + 송신 순서 + 재구성 모델 | `npx tsx server/scripts/qa-headless.ts 777 M 10 NORMAL` | 스키마 위반 **0종**, 송신 순서 위반 0, 회계 위반 0. `flag_recalled` 464건(command 324 · morale 140) 모두 `reason` 있음. 재구성 불일치는 `flag.morale` 1종뿐이고 **HEAD 에서도 같음**(재구성 모델이 `moraleChanged` 를 안 받음 — 기존 QA 도구 한계) |
| 실제 ws 서버 | `npx tsx server/scripts/qa-ws.ts` | **82/82 통과**, 스키마 위반 0 (재접속·관전 `snapshot_full` 포함) |
| 시나리오 | `npx tsx server/scripts/qa-scenarios.ts` | 67/87. HEAD 는 86/87. 늘어난 19건은 스크립트가 v5.1을 반영하지 않아서 생긴 것이고 서버 결함이 아니다 (경미 m-1) |
| v5.1 자가대전 (새 시드) | `npx tsx server/scripts/v51-selfplay.ts 2 1002 M 10` | 1002: 29.4분 임계 · 자동 후퇴 134 · 패주 112 / 1003: 32.0분 시간초과 · 자동 후퇴 126 · 패주 71. **봇 거절 0**, 회계 위반 0 |
| 같은 시드 v5.0 (HEAD 사본) | HEAD 를 `git archive` 로 스크래치에 풀어 같은 스크립트 실행 | 1002: 32.0분 · 패주 190 · 발령 777 / 1003: 29.9분 · 패주 121 · 발령 695 |
| v5.1 불변식 전용 검사 (스크래치 스크립트) | 아래 "불변식 검사" — M10 시드 1000 · 1001, L16 시드 2024, 모델 1 M10 시드 1000, S6 시드 1000 | **5판 모두 위반 0** |

### 불변식 검사 (스크래치 `v51check.mts`, 매 tick)
1. **클라이언트 재구성 = 서버 값**: 첫 `snapshot_full` 의 `dispatchReadyTick` 에서 시작해, 문서 §37.1 의 규칙(`flag_issued` 의 출발 칸이 기지면 `tick + 25`, `base_captured` 와 델타 `tileChanges` 의 기지 칸이면 0)만 적용한 값이 이후 모든 `snapshot_full.bases[].dispatchReadyTick` 과 일치하는지 본다. M10 1000에서 384회, 1001에서 357회, L16에서 384회 비교해 불일치는 0건이었다. 합병된 기지도 `tileChanges` 에 실리므로 이 규칙으로 따라잡을 수 있다.
2. **쿨타임 위반 0**: 같은 주인이 같은 기지에서 25 tick 안에 두 번 출전한 경우가 없다. 기지 출전은 M10에서 703회와 629회, L16에서 1257회, 모델 1에서 742회였다.
3. **4d 누락 0**: tick 이 끝났을 때 `inCombat ∧ morale 0 ∧ ¬routed ∧ 병력>0 ∧ ¬RETURNING ∧ disengageUntilTick null ∧ ¬onOwnBase` 인 깃발이 없다.
4. **이벤트 순서**: `flag_recalled{reason:"morale"}` 바로 앞 메시지는 언제나 같은 깃발의 `flag_disengage_started{auto:true}` 였다.
5. **기지 사기 하한**: 같은 자기 기지 칸에 머문 깃발에서 사기가 300 이상에서 300 미만으로 떨어진 경우가 없다. 300 미만인 깃발은 사기가 줄지 않았다(패주 제외, 그 tick 에 소유권이 바뀐 칸 제외). 깃발-tick 표본은 7만, 5.7만, 13.4만이었다.
6. **모델 1**: `flag_recalled.reason` 은 command 뿐이었고 4d·하한은 동작하지 않았다. 쿨타임은 적용됐다(§37.3-3과 같음).

## 항목별 대조

### ① 점령 소모 배율 통일 — 통과
- `shared/src/constants.ts:275` `UNIT_ATK_MULT_PERMILLE = [1000,1000,1000]`. 병종 전용 테크 노드는 바뀌지 않았다(`v51.test.ts:433` 이 SWO-2B 800을 확인).
- 7단계 사기 소모는 식을 그대로 둔 채 전 병종 6이 된다(`combatModel2.test.ts:634-636`).
- `match_config.constants` 를 직접 확인했다: `BASE_DISPATCH_COOLDOWN_TICKS=25`, `MORALE_BASE_FLOOR=300`, `UNIT_ATK_MULT_PERMILLE=[1000,1000,1000]`. 함수(`pickOriginBase`)는 빠진다.

### ② 4d 사기 붕괴 자동 후퇴 — 통과
- 판정 시점: `combat.ts:374-377`, 모델 2에서만 4c 직후, `trackCombatEvents` 앞. GDD 7.3과 같다.
- 대상 조건: `combat.ts:418-424` 가 GDD 4.6의 1~6번과 하나씩 맞는다. 패주가 우선한다: 4b 패주 루프(`:324-337`)가 `routed=true` · `inCombat=false` 로 바꾸므로 4d 대상에서 빠진다.
- 동작: `flagops.ts:316-325` `autoRecallFlag` 의 순서는 `recallFlag`(`:302-307`)와 같다(이탈 대기 개시 → `beginReturn(null)` → `disengageHold`). 차이는 `auto:true` 하나다.
- 이탈 대기 15 tick: 4d 가 tick t 에 `until = t + 15` 를 정하고, 다음 tick 부터 4b 만료 루프가 판정한다. 귀환 상태라서 `broke_away` 갈래로 간다(`:356-362`). 명령 회수(1단계에서 정함)와 실효 길이가 같다.
- 환급: 도착 시 기존 회수 경로를 탄다. 자동 후퇴 깃발이 끝난 방식은 M10 1000 기준 recalled 104, routed_returned 37, attrited 5이고, 회계 위반은 0이다.
- 결정론: `state.flags` 는 id 순으로 push 되므로 flagId ASC 가 보장된다(`flagops.ts:176`). 정수 연산만 쓴다.

### ③ 기지 사기 하한 300 — 통과
- 4c: `combat.ts:390-399`. 교전 중이고 자기 기지 칸이면 `m<300 → min(300, m+rec)`, 아니면 `max(floor, m−d)`. GDD 4.5와 프로토콜 §37.2 ③의 식과 같다. 비전투 경로는 그대로다.
- 7단계: `gauge.ts:173-182`, `max(min(m, floor), m − d)`. 기지 밖이면 floor 0 이라 `max(0, m−d)` 가 되어 이전과 같다.
- 패주는 4b 에서 `morale = 0` 을 직접 넣고, 4c 는 `skip` 으로 그 깃발을 건너뛴다. 하한이 걸리지 않는다([A-5.1-19]와 같음).

### ④ 기지별 출전 쿨타임 — 통과
- 검증 순서: `flagops.ts:131-154` 는 `NOT_BASE → NOT_OWNED_BASE → BASE_COOLDOWN → INSUFFICIENT` 이고 문서 §4 표 · §6.1 · §37.1과 같다. 지정한 기지가 쿨타임이면 다른 기지로 바꿔 주지 않는다. 생략했는데 기지가 모두 쿨타임이면 `BASE_COOLDOWN` 이다.
- 거절된 명령은 쿨타임을 만들지 않는다. 쿨타임 갱신(`:157`)이 모든 거절 검사 뒤에 있다.
- 동률 처리: `shared/src/dispatch.ts` `pickOriginBase` 는 거리가 같으면 tileId 가 작은 쪽을 고른다. `baseTiles` 는 `setTileOwner` 가 오름차순 삽입으로 유지한다(`state.ts:469-473`).
- 소유권 변경 시 초기화: `state.ts:474-477` 에서 함락 · 합병 · 중립화가 모두 이 경로를 지나 0 이 된다.
- 같은 tick 의 여러 발령은 `compareQueued`(recvSeq → connId → clientSeq) 순서로 처리되므로 앞 명령이 쓴 기지가 뒤 명령에서는 쿨타임이다(`v51.test.ts:380`, qa-scenarios 1번 절에서도 실제로 관찰).
- 스냅숏: `snapshot.ts:179` 는 `snapshot_full` 에만 싣는다. 델타에는 기지 쿨타임이 없다. 문서와 `qa-schema.ts:143` 은 이 필드를 필수로 둔다.

### ⑤ `flag_recalled.reason` — 통과
- 송신 지점 4곳: `flagops.ts:307` command, `combat.ts:422` → `flagops.ts:324` morale, `basecapture.ts:30` base_lost, `gauge.ts:382` idle_timeout. 이것 말고 `flag_recalled` 를 보내는 곳은 없다(grep 확인). `qa-schema.ts:175` enum 은 4개 값을 필수로 검사한다.

### 봇 회귀 — 통과
- 판정 tick 이 `t + 1` 인 것은 맞다. 봇은 11단계에서 결정하고 `tick.ts:325-326` 에서 다음 tick 큐에 넣으며, 사이에 끼는 단계는 12단계(합병)뿐이다. 합병은 기지를 늘리기만 하고 늘어난 기지는 준비 tick 이 0 이다. 그래서 봇이 예측한 출발 기지와 서버가 실제로 고르는 기지는 같다.
- 거절 폭증: 없다. v5.1 자가대전 4판(1000~1003)에서 봇 거절은 0, `BASE_COOLDOWN` 도 0이었다.
- 발령 정지: 없다. 같은 시드의 분당 발령은 v5.0 24.3 / 23.2에서 v5.1 22.7 / 20.8로 7~10% 줄었다. 쿨타임 때문에 예상되는 감소 폭이다.
- 무한 쿨타임: 구조적으로 불가능하다. 준비 tick 은 `t + 25` 로만 정해지고, `busyBases` 의 `MAX_SAFE_INTEGER` 는 결정 하나 안에서만 쓰는 지역 Set 이다(`bot.ts:1420`).
- `issue()` 는 `defendReachable` 이 실패하면 `busyBases` 에 넣기 전에 반환한다(`bot.ts:393-397`). 출전하지 않은 기지를 쿨타임으로 잘못 세지 않는다.

## 치명적 문제
없음.

## 경미한 문제

### m-1. `qa-scenarios.ts` 가 v5.1을 반영하지 않음 → 거절 순서 커버리지 손실
- `server/scripts/qa-scenarios.ts:66-95`: 1번 절이 수도 하나에서 같은 tick 에 여러 번 발령하는데, 두 번째부터 `BASE_COOLDOWN` 이 난다. 그 결과 "발령 2·3 → ACCEPT", "4번째 → NO_SLOT", "cap 초과 + 물 → NO_SLOT" 이 실패하고, 이후 그 깃발을 쓰는 재지정 · 태세 · 회수 검사 12건도 `NO_FLAG` 로 실패한다. **`NO_SLOT` 순서 검사가 사실상 꺼진 상태다.**
- `:306-311`: 검병 → 창병 패주 장면에서 공격 깃발이 사기 0에 먼저 자동 후퇴하므로 `flag_routed` 가 나오지 않는다. 그 뒤 ROUTED 검사 3건도 `NO_FLAG` 로 실패한다.
- 재현: `npx tsx server/scripts/qa-scenarios.ts` → 67/87. HEAD 사본에서는 86/87이고, 남는 1건(#7 전투 수치)은 원래 있던 실패다.
- 수정 방법(백엔드): 1번 절 발령 사이에 `b.dispatchReadyTick = 0` 을 넣거나 `stepWith` 를 25 tick 띄운다. 패주 장면은 모델 1로 돌리거나 사기를 고정해 패주를 강제한다.

### m-2. 프로토콜 문서 §37.2 ③ · §37.3-1 이 낡음
- `_workspace/02_backend_protocol.md:2741` 에 "GDD 본문은 game-designer 가 따로 고친다"고 적혀 있다. 그런데 GDD 4.5(`01_game-designer_gdd.md:319-322`)는 이미 교전 중 하한 미만 회복으로 고쳐져 있다. `:2756` 의 "GDD 와 다르게"도 더는 차이가 아니다.
- 수정: 두 줄을 "GDD v5.1 본문에 반영됨"으로 바꾼다.

### m-3. GDD 변경 이력 · 후속 절이 "코드 미구현"으로 남아 있음
- `_workspace/01_game-designer_gdd.md:14` 에 "설계만 반영, 코드 미구현", `:535` 에 "코드 미반영: …"이 남아 있다. 지금은 구현이 끝났다. 클라이언트 표시 3종만 미구현이다.

### m-4. GDD 4.6 조건 5의 "다음 tick 4d" 와 실제 동작이 다름 (`wait_over` 경우)
- GDD `:341` 은 "태세 전환 · 재지정 이탈 대기가 끝난 뒤 사기 0 · 교전 중이면 다음 tick 4d 대상"이라고 쓴다.
- 코드는 다르다. 제자리(ENGAGED/IDLE) 깃발의 태세 전환 대기가 만료되면 `combat.ts:351-355` 가 `disengageUntilTick=null` 로 두고 `inCombat` 은 그대로 둔다. 4d(`:376`)는 그 뒤에 돌기 때문에 **같은 tick** 에 자동 후퇴가 걸린다. 이동 중인 깃발의 대기는 `broke_away` 로 끝나 `inCombat=false` 가 되므로 4d 대상이 되지 않는다.
- 영향: 1 tick 차이일 뿐이고 결정론도 유지된다. 이벤트는 같은 tick 에 `flag_disengaged{wait_over}` → `flag_disengage_started{auto:true}` → `flag_recalled{morale}` 순서로 나간다.
- 수정: GDD 문구를 "같은 tick 4d"로 고칠지, 코드를 그대로 둘지는 game-designer 가 정한다.
- 재현 근거: 코드 순서(`combat.ts:345-364` 만료 루프가 `:374-377` 4c/4d 보다 앞)로 확인했다. 따로 테스트는 없다.

### m-5. 이벤트 표의 `flag_disengage_started.auto:true` 설명이 낡음
- `_workspace/02_backend_protocol.md:515` 는 `auto:true` 를 "귀환 깃발이 전투에 붙잡혀 서버가 자동 개시"로만 설명한다. v5.1부터는 사기 0 자동 후퇴에서도 `auto:true` 가 나간다. §37.1 예시에는 나오지만 표에는 빠졌다. 클라이언트가 이 설명대로 "귀환 중 붙잡힘" 문구를 띄우면 사기 붕괴를 잘못 표시한다(프론트 할 일 F-5).
- 참고(v5.1 이전부터 있던 것): `base_lost` 퇴각은 4b 가 아니라 7단계에서 일어나므로 `flag_disengage_started` 가 **다음 tick** 에 따로 나간다(`basecapture.ts:24-31`). 문서에 적어 두면 좋다.

## 관찰 (결함 아님, 밸런스 참고)
- 자동 후퇴 깃발의 약 30%는 이탈 대기 3초 동안 병력이 0이 되어 패주로 끝난다(M10 1000: 146건 중 routed_returned 37, 1001: 133건 중 45, L16: 274건 중 85). "사기 0 = 회수"라도 열세 교전에서는 환급이 0인 경우가 꽤 많다.
- 점령만 하다 사기가 0에 붙은 깃발이 처음 교전한 tick 에 곧바로 자동 후퇴한 경우는 판당 1~3건이었다. 드물다.
- 같은 시드에서 판당 패주 수가 v5.0 190 / 121에서 v5.1 112 / 71로 줄었다.

## 프론트 할 일 (frontend-game-client-engineer — 이번 범위 밖, 목록만)
- **F-1** `client/src/ui/text.ts:17` `REJECT_TEXT` 에 `BASE_COOLDOWN` 키를 추가한다(tsc 깨짐, 이미 알려진 건).
- **F-2** 테스트 기대값을 갱신한다: `client/test/options.test.ts:105·112`, `client/test/techTree.test.ts:104`, `client/test/unitStats.test.ts:61`, `client/test/qaV45.test.ts:107`(§37.6).
- **F-3** 기지 출전 쿨타임 상태를 유지한다. `snapshot_full.bases[].dispatchReadyTick` 으로 초기화하고, `flag_issued` 의 `originTileId` 가 기지면 `tick + 25`, `base_captured` 와 델타 `tileChanges` 의 기지 칸이면 0으로 둔다. 이 세 규칙만으로 서버 값과 정확히 일치함을 확인했다(불변식 1). 게이지에는 숫자를 함께 표기한다.
- **F-4** 출전 미리보기의 출발 기지는 `@civwar/shared` `pickOriginBase` 에 서버와 같은 토폴로지 거리를 넣어 구한다. 모두 쿨타임이면 남은 초를 보이고, `BASE_COOLDOWN` 토스트를 띄운다. 지정 출발 기지 UI 가 있으면 쿨타임 기지는 비활성으로 표시한다.
- **F-5** `flag_recalled.reason` 으로 분기한다. `morale` 이면 "사기 붕괴 후퇴" 알림과 깃발 표기를 쓴다. 같은 tick 에 바로 앞서 오는 `flag_disengage_started{auto:true}` 를 "귀환 중 붙잡힘"으로 표시하지 않는다. reason 이 없는 구 메시지는 `command` 로 본다.
- **F-6** 기지 칸 위 깃발의 사기 하한 30%를 툴팁이나 사기 막대에 표시한다(선택).
- **F-7** 점령 비용 표시(지형 hover)는 배율 1000 통일을 따른다. 기지는 "약 N명"으로 표기한다(GDD 4.4).
- **F-8** 재접속자에게는 자동 후퇴 깃발이 `RETURNING` + `disengaging` 으로만 보인다. "사기 붕괴" 표기는 이벤트를 받은 클라이언트만 할 수 있다(§37.1, 이것으로 충분).

## 미검증
- 사람 클라이언트가 `originBaseTileId` 를 지정하는 실제 UI 흐름: 클라이언트가 범위 밖이다.
- 장시간 다판 밸런스(GDD 5.1의 8판 재측정): 4판(1000~1003)만 봤다. 평균 판 길이는 v5.1 30.8분(29.8 / 32.0 / 29.4 / 32.0)으로 목표 대역 상단에 있다.
