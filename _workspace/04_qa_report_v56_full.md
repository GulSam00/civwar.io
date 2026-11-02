# civwar.io QA 보고서 — GDD v5.6 깃발 조작 변경 (전체 경계면)

- 검증일: 2026-11-03. 대상: 커밋 전 작업 트리(`768a7ba` 기준 변경). 코드는 고치지 않았다.
- 검증 도중 추가된 규칙(방어 깃발을 중립·적 땅으로 재지정하면 공격으로 자동 전환)까지 포함한다.
- 결론: 프로토콜 shape·상수·거절 코드는 정합. 재작업 대상은 치명 1건, 경미 11건.

## 1. 실행 결과

| 항목 | 결과 | 시점 |
|---|---|---|
| `npm run typecheck` | 통과 | 자동 전환 반영 후 |
| `npx vitest run` | 48 파일 630 테스트 통과 | 자동 전환 반영 후 |
| `server/scripts/qa-scenarios.ts` | 85/87, 스키마 위반 0 | 자동 전환 반영 후 |
| `client/scripts/qa-v45-integration.ts` | 21/31 | 자동 전환 반영 후 |
| `server/scripts/smoke.ts` | 통과 | **자동 전환 반영 전** |
| `server/scripts/qa-ws.ts` | 82/82, 스키마 위반 0 | **자동 전환 반영 전** |
| `server/scripts/qa-headless.ts` | 스키마 위반 0, 순서 위반 0, 봇 거절 0. `flag.morale` 불일치 5171건 | **자동 전환 반영 전** |
| 임시 장면 S1~S6 (스크래치, 실제 `Simulation` 명령 경로) | 아래 3장 | 자동 전환 반영 후 |
| 봇 6판 계측 (10인 NORMAL, 144×84, 시드 1000~1005) | 아래 4장 | 자동 전환 반영 후 |

실패 항목 해석:

- `qa-scenarios` #7 전투 수치: `HEAD` 에서도 같은 값으로 실패(86/87). v5.6 무관한 기존 실패다.
- `qa-scenarios` "retarget 물 앵커 → WATER": **스크립트 낡음**(M-1).
- `qa-v45-integration` S2 10건: **스크립트 낡음**(M-2). 이 때문에 S2 검증 자체가 안 돌았다.
- `qa-headless` `flag.morale`: 스크립트 재구성 모델 쪽 항목으로 보인다. `HEAD` 대조는 하지 않았다(미검증).

## 2. 중점 항목 판정

### ① 제거·개명 식별자

| 식별자 | 서버·공유·클라이언트 소스 | 스크립트·테스트 |
|---|---|---|
| `LOCKED`, `POSTURE_COOLDOWN`, `resumeTick`, `postureCooldownUntilTick`, `postureManual`, `FLAG_RETARGET_LOCK_TICK`, `POSTURE_COOLDOWN_TICKS`, `flag_posture_changed.auto` | 없음 | 없음 |
| `Flag.lockUntilTick` | 없음 | `server/test/v44.test.ts:211` 은 기지(`BaseState`) 필드라 무관 |
| `postureHeld` | 없음 | **`server/scripts/qa-schema.ts:162` 잔존**, 주석 `client/test/qaV45.test.ts:64`·`uiOct14b.test.ts:210` (M-3) |

기지의 `lockUntilTick`(`basecapture.ts:18`, `gauge.ts:81`)은 깃발과 무관한 별개 필드다. 판정: 잔존 1건(스키마 허용 필드), 런타임 영향 없음.

### ② match_config.constants — 통과

`constantsTable()`(`server/src/game/snapshot.ts:48`)은 shared export 를 자동으로 싣는다. 실행 확인: 226개, `FLAG_ORDER_COOLDOWN_TICKS = 15`, 옛 상수 2개는 undefined. 클라이언트는 옛 키를 읽지 않는다. `renderer.ts`·`Help.tsx` 는 shared import 를 쓴다.

### ③ 서버 ↔ protocol.ts ↔ 문서 ↔ 클라이언트 — 통과 (순서 1건 제외)

| 대상 | 서버 | protocol.ts | 문서 | 클라이언트 |
|---|---|---|---|---|
| `cmd_flag_issue.posture` | `validate.ts` 필수, `flagops.ts:118` | 필수 | L258, §40.2 | `store.issueFlag`, `controller.ts` |
| `ORDER_COOLDOWN` | `flagops.ts:228·313` 부근 | L42 | L269·271·543 | `text.ts:34` |
| `orderCooldownUntilTick` | `snapshot.ts:163·205·320` | L449·578 | §40.2 | `gameModel.ts:256·264·470` |
| `flag_retargeted.cooldownUntilTick` | `flagops.ts` | L713 | L504 | `gameModel.ts:256` |
| `flag_posture_changed` (auto 없음) | 수동·자동 전환 둘 다 전송 | L802 부근 | L514 | `gameModel.ts:261` |
| `cmd_ack.postureHeld` 제거 | 제거 | 제거 | §40.2 | 제거 |

실측: 쿨타임 경계는 `t < cd` 거절이 맞다. 출전 다음 tick 재지정 수락, 쿨타임 중 회수 수락(쿨타임 불변), 이탈 대기 중 재재지정 `ORDER_COOLDOWN`(S5·S6). ETA 는 `tick` 기준이다.

`PROTOCOL_VERSION` 은 1 그대로다. 호환이 깨지는 변경이지만 이 레포는 지금까지 올린 적이 없어 관례대로다. 옛 클라이언트의 발령은 `BAD_MESSAGE` 계열로 거절된다.

### ④ UI 문구 — 대체로 통과

"5초"(태세 쿨타임 의미), "도착지로 태세 결정" 문구는 남아 있지 않다. 남은 "5초"는 기지 출전 쿨타임·정체 판정·로비 갱신 등 다른 규칙이다. 잔존 문제는 M-6.

### ⑤ 태세·도착지가 어긋난 경우

| 경우 | 서버 동작 (실측) | 클라이언트 예고 | 판정 |
|---|---|---|---|
| 공격 → 내 땅 재지정 | 공격 유지, 옆 칸 없으면 `IDLE(front_cleared)` | "공격 태세 유지 · 내 땅까지 이동" | 정합. 이후 F 는 **C-1** |
| 방어 → 적·중립 재지정 | 공격 자동 전환, 쿨타임 1회, 전투 중 `disengageHold=true` (S6) | 공격 예고 | 정합. 이벤트 순서는 M-4 |
| 방어 출전 → 먼 적 땅 | 적 땅 앞에서 `IDLE(unreachable)` | 막힘 경로 | 정합. 뒤이은 F 는 M-7 |
| 방어 출전 → 내 땅 근처 적·중립 | **첫 내 칸에서 바로 `ENGAGED`**(S3) | 앵커까지 경로 | **불일치 M-5** |
| 병종 고리 태세 토글 | 명령대로 전송 | 경로는 맞고 칸 예고는 그대로 | **불일치 M-8** |

### ⑥ botPlannedPosture — 아래 4장. 반복 거절·영구 미처리는 없다. 낡은 예정·중복 투입·부작용은 있다.

### 추가 규칙(자동 전환) — 통과

- `retargetFlag`(`server/src/game/flagops.ts:238-241`): 조건·`targetOwnerId`·쿨타임 1회·`disengageHold` 모두 사용자 규칙과 일치. 공격 깃발의 내 땅 이동은 불변.
- 봇 `retarget`(`server/src/game/bot.ts:441`): 공격→내 땅만 예정을 둔다. 6판에서 ATTACK 예정 0건. 봇 명령 거절 0건.
- `computePreview`(`client/src/input/preview.ts`): 4가지 조합 모두 서버와 같다.
- 문서 §40.1·§40.3·§40.4, GDD 4.2, Help·패널 문구 일치. `applyPosture` 호출처 2곳도 문서와 같다.

## 3. 이슈

### 치명

#### C-1. 공격 깃발이 내 땅에 도착한 뒤 방어로 바꾸면 수비로 들어가지 않고 2분 뒤 귀환한다

- 위치: `server/src/game/movement.ts:133-144` (IDLE 분기는 공격 재점화만 본다), `server/src/game/economy.ts:110` (`isGarrison` 은 ENGAGED 필수), `server/src/game/gauge.ts:380`
- 재현(S1): 공격 태세로 내 땅 내부 출전 → t63 `IDLE(front_cleared)` → F 수락 → `state=IDLE posture=1` 유지, `calmTicks 0` → t663 `flag_recalled{idle_timeout}`.
- 규칙 대조: GDD 4.3(L273)은 공격 태세 IDLE 까지만 말한다. 태세가 방어로 바뀐 뒤의 동작은 어디에도 없다. v5.6 전에는 재지정이 방어를 자동으로 줘서 드물었지만, 이제 "내 땅으로 이동 → F" 가 방어를 만드는 기본 조작이다. 화면에는 방어 태세로 보이는데 말없이 빠진다.
- 수정: 방어로 전환할 때 IDLE 깃발이 `defendArrived` 면 `ENGAGED` + `flag_engaged`, 아니면 `MARCHING` 으로 되돌린다. `setPosture` 또는 stage4 IDLE 분기. 동맹 IDLE(`reason: allied`)은 예외 여부를 정해야 한다.
- 담당: `multiplayer-backend-engineer` (GDD 한 줄 추가 필요)

### 경미

| # | 위치 | 내용 | 수정 |
|---|---|---|---|
| M-1 | `server/scripts/qa-scenarios.ts:120,134` | 앞선 전환으로 쿨타임이 도는 깃발 2로 WATER 를 검사해 `ORDER_COOLDOWN` 이 나온다. 서버가 맞고 스크립트가 낡았다 | 쿨타임 없는 깃발로 검사 |
| M-2 | `client/scripts/qa-v45-integration.ts:144` | S2 "방어 발령" 이 `POSTURE.ATTACK` 을 보낸다. 방어 경로 ↔ unreachable 경계 검증이 지금 안 돌고 있다 | `POSTURE.DEFEND`, `BASE_COOLDOWN` 대비 |
| M-3 | `server/scripts/qa-schema.ts:162` | `'postureHeld?'` 잔존 — 서버가 되살려도 스키마가 못 잡는다 | 삭제. 테스트 주석 2곳 정리 |
| M-4 | `server/src/game/flagops.ts:240-241` ↔ `client/src/state/gameModel.ts:272` | 전투 중 자동 전환의 이벤트 순서가 `disengage_started` → `retargeted` → `posture_changed`(S6). 클라이언트는 `posture_changed` 가 먼저 와야 "태세 전환 중"으로 표시하므로 이 경우 표식이 안 붙는다 | 서버 전송 순서를 `cmd_set_posture` 와 맞추거나 `flag_retargeted.posture` 변화로 판정. §40 에 순서 명시 |
| M-5 | `server/src/game/rules.ts:146` ↔ `client/src/input/route.ts:230` | 방어 출전의 앵커가 내 땅이 아니면 `defendArrived` 가 관할 원 안 첫 내 칸에서 멈춘다. S3: 5칸 앞 중립으로 보내도 기지에서 안 나간다(`etaTick 41`, `engageEtaTick 1`). 경로 예고는 5칸, 고리 안내는 "그 방향으로 보내 지킵니다". GDD L273 은 unreachable 규칙만 적었다 | 의도 확인 필요. 유지면 `computeRoute` 가 첫 도착 칸에서 끊고 GDD 보강 |
| M-6 | `client/src/ui/GameScreen.tsx:1115` | 패널 쿨타임 표시가 "(전환 n초)" — 재지정도 막힌다 | "쿨타임 n초" (`unitChips.ts` 와 통일) |
| M-7 | `server/src/game/movement.ts:133` ↔ `client/src/state/feed.ts:172` | `IDLE(unreachable)` 에서 F 로 공격 전환하면 앵커로 가지 않고 그 자리에서 옆 칸만 밀다 다시 IDLE(S2, 앵커 2칸 앞). 토스트는 "공격 태세로 바꾸거나"라고 안내한다. 재지정은 자동 전환으로 정상 진격 | C-1 수정에서 함께 `MARCHING` 복귀 |
| M-8 | `client/src/ui/GameScreen.tsx:129-132`, `client/src/render/renderer.ts:599` | 고리 단계 `computePreview` 가 고른 태세를 모른다. 내 땅에서 공격으로 토글해도 푸른 보호 원, 적 땅에서 방어로 토글해도 붉은 칸이 남는다. 화살표·고리는 맞다 | 고리 단계는 `is.posture` 로 kind·disk 를 덮어쓴다 |
| M-9 | `server/src/game/bot.ts:1081-1089` | 낡은 예정(4장) | 적용 전 앵커 소유 재확인 |
| M-10 | `server/src/game/bot.ts:898,979` | 중복 투입(4장) | 수비 계산에 `botPlannedPosture === DEFEND` 포함 |
| M-11 | `server/src/game/bot.ts:441,1454`, `server/test/bot.test.ts:79`, `gauge.ts:338`, `bot.ts:392,457` | `decideBot` 부작용과 낡은 주석 | 아래 |

S4 참고: 방어 태세로 먼 중립 앵커에 가면 같은 tick 에 `flag_engaged`(`guardTileCount 0`)와 `IDLE(guard_lost)` 가 나오고, 100명 깃발이 200 tick 에 7명까지 노출 소모된다. 규칙 위반은 아니지만 고리 경고는 없다.

## 4. 봇 계측 (`botPlannedPosture`)

6판 합계. 비교: `HEAD` 같은 시드. 이 맵·시드는 6판 모두 시간 만료로 끝났다.

| 지표 | 값 |
|---|---|
| 봇 명령 거절 | **0** (수락 14511) |
| 예정 생성 / 적용 | 252 / 227. 나머지는 대부분 귀환 전환으로 추정(귀환·패주 잔류 671 flag·tick). 개별 추적은 안 했다 |
| 예정 최대 보유 | 221 tick (약 44초, 전투 중 `canPosture` 대기) |
| **적용 시 앵커 소유가 예정과 어긋남** | **66 / 227 (29%)** |
| 적용 시 state | MARCHING 205, IDLE 20, ENGAGED 2 |
| 방어 예정 앵커에 다시 재지정 / 새 방어 발령 | 24 / 10 |

- **반복 거절: 없음.** `canRetarget`·`canPosture` 가 서버 쿨타임과 같은 tick 을 본다.
- **영구 미처리: 없음.** 전투가 끝나거나 귀환하면 풀린다. 귀환 깃발의 잔류 값은 깃발과 함께 사라져 해가 없다.
- **낡은 예정(M-9):** 대기 중 앵커가 적에게 넘어가도 방어로 바꾼다. 이 깃발은 적 앵커를 향한 방어 태세가 된다.
- **중복 투입(M-10):** `isBaseGuard`(L898)·`defend` 의 `covered`(L979)는 지금 `DEFEND` 만 세어, 전환 대기 중인 깃발을 수비대로 치지 않는다. `plannedDefend` 는 결정 1회만 산다. 34회 관측. 추가 투입이 전부 불필요했는지는 판정하지 않았다.
- **부작용(M-11):** `decideBot` 은 `Readonly<GameState>` 를 캐스팅해 쓴다. 서버가 거절해도 예정이 남고, 호출 결과를 버려도 예정이 지워진다. `CivBot` 주석의 "무상태", `bot.test.ts:79` 의 "decide 는 순수 함수"가 더는 사실이 아니다. 이 테스트는 두 호출의 명령만 비교해 잡지 못한다. 재접속한 사람 깃발에 값이 남았다가 재이탈 때 실행될 수도 있다(코드 추론, 미재현). 실제 게임 경로는 결정론을 유지한다.
- 재지정 뒤 태세 전환까지 하면 한 깃발이 최소 3초 + 결정 주기 동안 재지정도 못 한다. 설계상 결과다.

`HEAD` 대비 6판 합계: 기지 함락 44 → 57, 멸망 6 → 1, 방어 발령 626 → 735, 재지정 3829 → 4032. 표본이 작아 밸런스 결론은 내리지 않는다. 공식 맵·표준 판 길이 측정은 별도로 필요하다.

## 5. 미검증

- 실제 브라우저 화면(토글 버튼, 색, 툴팁). 코드 대조와 단위 테스트까지만 했다.
- 자동 전환 반영 후의 `smoke`·`qa-ws`·`qa-headless` 재실행.
- 위 M-11 의 재접속 경로 재현.

## 6. 재작업 전달

- `multiplayer-backend-engineer`: C-1, M-4, M-5, M-7, M-9, M-10, M-11, M-1, M-3
- `frontend-game-client-engineer`: M-2, M-6, M-8 (M-5 유지 시 경로 예고)
- `game-designer`: C-1 전환 후 상태, M-5 의도 확정
