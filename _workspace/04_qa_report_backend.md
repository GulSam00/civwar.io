# civwar.io Phase 4: 백엔드 단독 정합성 QA 보고서

- 대상: 커밋 `cf1f438` (브랜치 `docs/gdd-v3.1-and-v4.0-plan`), 프로토콜 문서 `_workspace/02_backend_protocol.md`, `shared/src/protocol.ts`·`constants.ts`, `server/src/**`, GDD v4.1(부록 A·2.8·4.7e/f·4.11b·4.15·6.1·6.2·7.3·7.4 절만 읽음), `_workspace/00_input/design-decisions.md`
- 범위: (1) 문서와 서버의 실제 송수신 메시지 대조, (2) GDD v4.1과 서버 로직 대조. 클라이언트 항목은 제외했다(프론트 미구현).
- 코드는 고치지 않았다. QA 스크립트는 `server/scripts/qa-*.ts`에 새로 만들었고 커밋하지 않았다.
- 작성: integration-qa, 2026-10-09

## 1. 판정: 조건부 통과

| 구분 | 수 |
|---|---|
| 치명 | **0** |
| 주요 | **3** (이 중 2건은 프로토콜·규칙 문제, 1건은 이미 알려진 페이싱 문제) |
| 경미 | **15** |

**근거 요약**
- 실제 ws(서버 기동)와 헤드리스 전체 판 4회로 메시지 **약 4만 5천 건**을 받았다. 받은 메시지를 모두 JSON 왕복한 뒤, 문서만 보고 옮겨 적은 스키마로 검사했다. 필드 누락, 문서에 없는 여분 필드, 타입·enum·범위 위반이 **0건**이었다.
- 문서에 없는 메시지 type도 0건이었다.
- "프론트 재구성 모델"을 따로 만들었다. 문서대로 이벤트와 delta만 적용하는 모델이다. 이 모델을 매 `snapshot_full`과 대조하니 불일치는 `targetOwnerId` 한 필드에 몰려 있었다(I-1). 그 외에는 `disengageUntilTick` 1건이 있었다(경미 m-8).
- 회계 불변식 위반: 0 tick
- 송신 순서 위반: 0건. 순서는 이벤트 → `snapshot_delta` → `snapshot_full` → `game_over`이고, 이벤트의 tick은 처리 tick과 같았다.
- 서버 크래시: 0건
- 문서 §6.1의 거절 코드 31종 가운데 `NOT_IMPLEMENTED`를 뺀 전부를 문서의 조건에서 실제로 끌어냈다.
- 기존 검사: `npm run typecheck` 통과, `npm test` 8 파일 119 테스트 통과, `npm run smoke` 결과 SMOKE PASSED

**재작업이 필요한 쪽**
- 백엔드: I-1, I-2(GDD 확인 후)
- 문서: I-1, 경미 m-1~m-12
- game-designer: I-2 규칙 확인, I-3, m-13~m-15

## 2. 이슈 표

### 주요

| ID | 심각도 | 위치 | 증상 | 재현 | 기대값 | 수정 담당 |
|---|---|---|---|---|---|---|
| **I-1** | 주요 | `server/src/game/flagops.ts:59-69`(`applyPosture`), `:253-265`(`setPosture`) / `shared/src/protocol.ts:609-616` / 문서 §4 L251, §5 L445 | `cmd_set_posture`가 `targetOwnerId`를 다시 계산한다. 앵커 소유자가 나면 `254`, 아니면 그 소유자다. 그런데 `flag_posture_changed`에는 `targetOwnerId`가 없고, delta에도 이 필드가 없다. 그래서 문서대로 구현한 클라이언트는 다음 `snapshot_full`까지(최대 5초) 틀린 공격 대상을 표시한다. 대상 소유자를 바탕으로 한 front·tileCost 예측도 틀린다. 문서는 "targetOwnerId 재계산"이라고만 쓰고 계산식은 주지 않는다. | `npx tsx server/scripts/qa-headless.ts 777 M 10 HARD 1`을 돌리면 재구성 불일치 `flag.targetOwnerId`가 66건 나온다(예: t500 flag 47, DEFEND, 모델 0 / full 254). L 12인 판에서는 45건, S 7인 판에서는 19건이다. | 클라이언트가 이벤트만으로 `targetOwnerId`를 알 수 있어야 한다. 검증 결과: `flag_posture_changed`를 받는 시점에 클라이언트 owners로 `owners[anchor]==me ? 254 : owners[anchor]`를 계산하면 불일치가 0이 된다(`QA_DERIVE_TOI=1`). | **백엔드**: `flag_posture_changed`에 `targetOwnerId`를 추가하는 것을 권장한다(필드 추가만 하므로 하위 호환). **또는 문서**: 위 계산식과 적용 시점(그 tick의 delta를 적용하기 전 owners)을 §5에 명시한다. |
| **I-2** | 주요 | `server/src/game/flagops.ts:195`(retarget), `:244`(recall)이 RETURNING이면 거절한다. 이동 단계는 inCombat 깃발을 움직이지 않는다. / GDD 4.15(g) L2306, 문서 §4 L249-250 | 귀환 중(RETURNING) 깃발이 추격하는 적 공격 깃발과 붙으면 교전에 들어간다. 이 깃발은 **움직일 수 없고, 재회수·재지정이 모두 `RETURNING`으로 거절되어 이탈할 수단이 없다**. 결국 패주하거나 상대가 소멸할 때까지 싸운다. GDD 4.15(g)는 "재교전 … 다시 빠지려면 명령을 다시 내리고 3초를 또 치른다"고 해서 재이탈을 허용한다. breakaway 뒤 기병에게 추격당하는 것, IDLE 타임아웃으로 귀환하는 깃발이 모두 이 경우에 해당한다. | `npx tsx server/scripts/qa-scenarios.ts` 섹션 6: RETURNING 창병과 인접한 기병 공격 깃발을 놓는다. tick 1에 교전이 시작되고, tick 2에 `cmd_flag_recall`과 `cmd_flag_retarget`이 둘 다 `RETURNING`으로 거절된다. 이후 40 tick 동안 이동하지 않고 병력이 521까지 줄어든다. | `inCombat ∧ RETURNING` 깃발의 회수·재지정을 수락하고 `flag_disengage_started`를 내야 한다. 또는 GDD가 "귀환 중 피습은 이탈 불가"로 바꾸고 문서에 명시해야 한다. | **game-designer** 규칙 확인 → **백엔드** 검증 순서 변경. 예: `RETURNING` 검사를 `!f.inCombat` 조건으로 한정한다. 문서 §4 표도 갱신한다. |
| **I-3** | 주요(알려진 문제) | 문서 §11 페이싱 관찰, §13-8 / GDD 5장 | 자가대전에서 표준 30분 대역이 재현되지 않는다. 문서 기록은 10판 중 9판이 32분 하드 타임아웃이었다. 이번 QA 헤드리스 3판(M10 HARD, S7 EASY, L12 NORMAL)도 3판 모두 `timeout` 9600으로 끝났다. 프로토콜과는 무관하고 GDD↔구현 결과의 문제다. | `qa-headless.ts` 실행 결과 `game_over.reason`이 3판 모두 timeout | 기본 설정(M·10·NORMAL)에서 25~32분, 표준 약 30분 | **game-designer** (상수·봇 레버 판단). 백엔드 코드 결함은 아니다. |

### 경미

| ID | 위치 | 증상 | 재현 / 근거 | 수정 담당 |
|---|---|---|---|---|
| m-1 | `server/src/net/validate.ts:181` / 문서 §4 L180 | 65자 이상 닉네임이 `BAD_NICKNAME`이 아니라 `error BAD_MESSAGE`로 거절된다(17~64자는 `BAD_NICKNAME`). | `qa-ws.ts` "65자 닉네임" | 백엔드(64자 검사를 `BAD_NICKNAME`으로) 또는 문서 |
| m-2 | `validate.ts:207` / 문서 §4 L248 | `unit`이 0..2를 벗어나면 형식 검증 단계에서 `BAD_REQUEST`가 된다. 그래서 문서 표의 `BAD_UNIT`(검증 순서 4번째)은 **WS 경로에서 절대 나오지 않는다**. | `qa-ws.ts` 형식 견고성 #0. sim 직접 경로에서만 `BAD_UNIT`이 나온다. | 문서(`BAD_UNIT`은 도달 불가·예약이라고 명시) |
| m-3 | `validate.ts:173-174` / 문서 §4 L173-174 | `clientSeq`가 없거나 uint32가 아닌 `cmd_*`는 `cmd_ack`이 아니라 `error BAD_MESSAGE`를 받는다. 이는 불가피하지만, 문서의 "모든 cmd_*는 반드시 cmd_ack 1회"와 충돌한다. | `qa-ws.ts` "clientSeq 없는 cmd_*" | 문서 |
| m-4 | `server/src/net/server.ts:17,21` / 문서 §2 L133 | 4 KB를 넘는 프레임에는 `error`가 오지 않고 **소켓이 close 1009로 끊긴다**. 문서는 "최대 페이로드 4 KB"라고만 쓴다. | `qa-ws.ts` "4KB 초과 프레임" | 문서(클라이언트 재접속 처리 안내) |
| m-5 | `server/src/room/room.ts:133-136`(`deliver` = broadcast 전부 → personal) / 문서 §5 L420 | `cmd_ack`은 처리 tick의 이벤트, `snapshot_delta`, `snapshot_full`, `game_over` **뒤에** 온다. 이 때문에 (a) 문서의 "game_over = 마지막 메시지"가 틀린다. 그 tick의 ack이 `game_over` 뒤에 온다. (b) `flag_issued`가 ack보다 먼저 와서, clientSeq로 내 새 깃발을 매칭하려면 버퍼링이 필요하다. | `qa-ws.ts` [관찰] "cmd_ack 직전 delta tick 8" / 코드 판독 | 문서(순서 명시). 원하면 백엔드가 personal을 delta 앞으로 옮긴다. |
| m-6 | `room.ts:266-272` / 문서 §3 L157 | 공개 룸에서도 방장(첫 입장자)이 `lobby_start_now`로 30초 전에 강제로 시작할 수 있다. `isPublic` 검사가 없다. 문서와 GDD 2.8(h)에는 이 경로가 없다. | 코드 판독(`startNow` → `startCountdown`) | 문서 또는 백엔드(공개 룸 거절 코드 결정) |
| m-7 | `room.ts:242-255` | 재접속 부트스트랩 `snapshot_full`에는 **본인의 `connected=false`**가 담긴다. 플래그를 바꾸기 전에 보내기 때문이다. 이어서 `player_reconnected`가 와야 true가 된다. `PlayerDelta`에는 `connected`가 없다. 문서는 `connected`가 어떤 경로로 갱신되는지(full / `player_reconnected` / room_state status) 정리해 두지 않았다. | `qa-ws.ts` [관찰] "p2 connected=false" | 문서. 원하면 백엔드가 플래그를 먼저 바꾼다. |
| m-8 | `server/src/game/combat.ts:238` | 이탈 대기 중 패주하면 `disengageUntilTick`이 `flag_disengaged` 이벤트 없이 null이 된다. DISENGAGING 비트는 `flagFlags`로 정상 해제되므로 숫자 필드만 다음 full까지 남는다. | `qa-headless.ts 1009 L 12 NORMAL` 재구성 불일치 1건(t7150 flag 1064) | 문서("flag_routed 시 disengageUntilTick = null") |
| m-9 | `server/src/game/tick.ts:215-222`, `room.ts:371-375` | 게임이 끝난 tick 뒤 큐에 남은 명령은 처리되지 않아 **ack이 오지 않는다**. "모든 cmd_*는 반드시 ack 1회"의 예외다. | 코드 판독(재현 안 함) | 문서 또는 백엔드(종료 시 큐를 `NOT_IN_GAME`으로 플러시) |
| m-10 | `server/src/game/bot.ts`(clientSeq = t×64+n), `room.ts:135` | 봇 인계 중에 낸 봇 명령의 `cmd_ack`은 personal로 그 playerId의 세션에 배달된다. 그래서 복귀한 사람이 자기가 보내지 않은 clientSeq의 ack을 받을 수 있다. 사람의 clientSeq와 충돌할 가능성은 낮지만 0은 아니다. | 코드 판독(재현 안 함) | 백엔드(connId 0 명령은 ack 생략) 또는 문서("모르는 clientSeq의 ack은 무시") |
| m-11 | 문서 L19, L106·L548, L327, L346-354, §13-6 | 문서 안에 오래된 내용이 남아 있다. §0의 "8~12인"(현재 2~12). 테스트 수 119/116 혼재(실제 119). `match_config` 예시가 90×54(기본 M은 100×60). `snapshot_full` 예시 JSON에 `allyProposals`·`allianceFreezeUntilTick`·`lockoutDissolveTick`이 없다(아래 산문에만 있다). §13-6 "미해결"인데 GDD 3.1은 이미 28/32분으로 고쳐졌다. | 문서 대조 | 문서 |
| m-12 | 문서 §10 / GDD 2.8(a)·(h) | §10(GDD와 다르게 정한 것)에 빠진 항목이 있다. `botCount` 범위가 GDD는 `0..maxPlayers−사람`, 서버는 `0..maxPlayers−1` 후 시작 시 클램프다(§4에는 적혀 있다). 상수 이름도 다르다. GDD `PUBLIC_AUTOSTART_MS`/`PUBLIC_ROOM_MAP`, 코드 `PUBLIC_LOBBY_AUTOSTART_MS`/`PUBLIC_ROOM_SIZE`. | 대조 | 문서 |
| m-13 | GDD 4.15(g) L2307, 4.15(d) 표 #7 | GDD 예시 "창 방어 언덕, 개시 즉시 회수: 수비 −220 / 공격 −186, 환급 663"은 약 15 tick 손실분이다. 그런데 GDD 의사코드대로라면 회수는 교전 개시 다음 tick에야 가능하고(1 tick은 전액 손실), 대기 손실은 t+0..t+15로 16 tick이다. 서버는 의사코드를 따르므로 broke_away 시점 수비 744 / 공격 772(환급 약 632)가 된다. 서버 결함은 아니다. | `qa-scenarios.ts` 섹션 4 이력(tick:공/수 … 17:772/744) | GDD(예시 수치 갱신) |
| m-14 | GDD 4.7(e) 표 vs 4.11(b) | 4.7(e)는 "IDLE: 감소"라고 하지만 4.11(b)와 서버는 IDLE로 바뀔 때 `progressMilli = 0`으로 만든다. 그래서 IDLE 진척도 감소는 생기지 않는다. 규칙 결과는 같고 서술만 모순이다. | GDD L1770, L1978 | GDD |
| m-15 | GDD L1536, L3458, 7.3 L3381-3382, 6.2 L3267 | GDD 본문에 오래된 내용이 남아 있다. `endgameRushMult` 주석 "37분". 7.4 11단계 "t % 15"(v4.1부터 봇별 주기). 7.3 `welcome.playerId`·`room_state.targetPlayers`(v4.1 settings가 반영 안 됨). lockout 의사코드의 `alliance_broken`(구현은 `ally_broken`). | GDD 대조 | GDD |

### 재현 불가 / 미검증

- **재현 불가**: `DeltaTracker`는 룸 공용이라 개인 부트스트랩 이후 `playerDeltas`/`flagStats`가 빠질 가능성이 이론상 있다. 늦은 입장을 25 tick마다 흉내 내고(`QA_LATE=1`) 5 tick마다 엄격 비교(`QA_STRICT5=1`)했지만 9600 tick 동안 불일치는 0이었다. 추정 원인만 남긴다(값이 캐시 값으로 정확히 되돌아오는 경우). 실제로 생겨도 1~5초 안에 스스로 복구된다.
- **미검증**: 클라이언트 쪽 항목 전부(프론트 미구현). 공개 룸 30초 자동 시작은 실시간 대기가 필요해 이번에 직접 확인하지 않았다(`rooms.test.ts`가 다룬다). 결정론 해시는 기존 `bot.test.ts`(900 tick)·`flags.test.ts`(400 tick) 통과로 확인했고 별도로 재측정하지 않았다.

## 3. 항목별 결과

### 3.1 메시지 shape (문서 ↔ protocol.ts ↔ 실제 JSON): 통과
- 문서 §4·§5에 정의된 C2S 15종과 S2C 41종을 `qa-schema.ts`로 옮겼다. 여분 필드와 누락 필드를 모두 실패로 잡는다.
- `protocol.ts`의 타입과 문서의 필드명·옵션 여부가 전부 일치했다. 이름 불일치(troops/troopCount 같은 것)는 없었다.
- 단위도 문서와 맞았다: `troops`/`gold` = floor(milli/1000), `progressPct` 0..99, `hpPct` 0..100, `thresholdPct` 실수, `power`·`*Permille`은 permille 정수.
- 의미 검사도 통과했다. `flag_engaged`는 ATTACK이면 `frontTileCount`만, DEFEND면 `guardTileCount`만 온다. 거절 ack에는 reason만 온다. `combat_ended.routedFlagIds`에 중복이 없다(3차-2 수정 확인). `combat_started.groupKey`는 min(flagIds)였다(GDD 7.3, 402/402).

### 3.2 이벤트 커버리지: 통과
- 문서의 S2C 41종이 모두 실제로 발생했다. 헤드리스 판에서 32종, 시나리오에서 동맹 6종·`flag_stalled`·`decayed`, ws에서 welcome/room_state/error/pong/emote/player_reconnected가 나왔다.
- 문서에 없는 type은 0건이었다.
- `flag_idle.reason="unreachable"`은 문서대로 나오지 않았다.
- 세부 사유도 모두 발생했다: `flag_ended` 5종, `flag_progress_lost` 3종, `alliance_lockout` 3 phase, `ally_broken` 3종, `ally_proposal_closed` 4종(invalidated는 탈락·lockout 경로).

### 3.3 거절 코드: 통과(경미 m-1·m-2·m-3)
- `cmd_ack.reason` 30종을 문서의 조건과 우선순위대로 끌어냈다. 예: cap 초과 + 물 + 39병이면 `NO_SLOT`이 먼저 나온다.
- 깃발 이전 검증 순서는 `flagops.ts`와 문서 §4 표가 같았다.
- `error.code`: 문서에 정의된 코드 중 예약 2종(`BAD_TARGET_PLAYERS`, `RATE_LIMITED`)을 뺀 15종을 확인했다.

### 3.4 `match_config.constants` ↔ 부록 A v4.1: 통과
- `constantsTable()`은 `@civwar/shared`의 대문자 export를 전부 보낸다(`FLAG_BIT` 포함).
- 부록 A와 값이 일치했다: `ENEMY_BASE` 11, `NEUTRAL_BASE` 7 / `NEUTRAL_SQRT_COEF_PERMILLE` 750, `THRESHOLD_DECAY_START` 4800 / 1500‰, `ENDGAME_RUSH_TICK` 8400 = `ALLIANCE_CUTOFF_TICK`, `HARD_TIMEOUT_TICK` 9600, `GOLD_RATE_PERMILLE` 2080, `BASE_HP_REGEN_MILLI` 23, `MIL_COMBAT_PERMILLE_BY_TIER` [1000,1025,1050,1075], `PROGRESS_DECAY_MILLI_PER_TICK` 20, `PROGRESS_HOLD_RANGE` 1, `POSTURE_COOLDOWN_TICKS` 25, `MAP_SIZE_PRESETS`, `BOT_DIFFICULTY`.
- v4.1에서 삭제된 상수(`DEFENSE_LEVERAGE`·`UNIT_DEF_PUSH`·`BOT_DECISION_INTERVAL`…)는 없었다.
- 클라이언트가 ETA·tileCost·진척률·유지비·전투 교환비를 계산하는 데 필요한 상수가 빠짐없이 있다. `FLAG_MAX_PROGRESS`는 `FLAG_TILE_RATE_BASE × UNIT_ASSAULT`로 유도한다.
- `flagCap`은 `PlayerDelta`에 없지만 문서 §8 식(`min(7, 3+floor(tiles/300)+MOB_SLOT_BONUS)`)으로 재계산한 값이 매 full과 일치했다.

### 3.5 GDD ↔ 서버 로직: 통과(I-2·m-13·m-14)
- **tick 순서 7.4 v4.1**: `tick.ts` `step()`이 1→2→3→4→4a→4b→5→6→7→7c→8→9→10→11→12→13→14 순서와 일치했다.
- **threshold**: `thresholdScaled`가 GDD 정수식과 같다. `threshold_update`는 4800~7800에 300 간격으로 11회, `endgame_rush`는 8400에 1회, `game_over timeout`은 9600에 나왔다. 판정 순서(6.1)는 `victory.ts`와 일치했다.
- **대표 전투**(`duels.ts`): 113/98/86/78/103/107/103/100/78 tick, 생존 0·225·404·518·148·87·148·194·523. GDD 표와 시간은 모두 같고, 병력은 ±1(floor 표시)이다.
- **진척도 감소 A-40~42**: 20/tick 감소. 5 tick째 `decayed`가 나오고 targetTileId는 유지된다. 비전투 AP 0 깃발은 25 tick째 `flag_stalled`(tileId=target)가 나온다. holdProgress의 presentEnemy 필터(routed·0병 제외, 동맹 제외)가 GDD와 일치했다.
- **ZOC·대치**: 헤드리스 판에서 `flag_blocked` 83, `flag_unblocked` 64건이 나왔다. 재구성한 blocked 비트가 full과 일치했다.
- **이탈 대기**: `untilTick = t+15`, `broke_away`가 정확한 tick에 나왔고, 대기 중 태세 전환은 `DISENGAGING`으로 거절됐다. 단, 귀환 중 재이탈 불가(I-2).
- **태세 쿨타임**: `cooldownUntilTick = t+25`, `POSTURE_COOLDOWN`·`SAME_POSTURE`·`IN_COMBAT` 모두 확인했다.
- **기본 태세는 발령·재지정 때만 정해진다**: 9단계 재파생이 없다(`gauge.ts:245`). `flag_posture_changed auto:true`는 재지정 때만 나왔다.
- **상륙**: duels #6 194/523(GDD 195/524).
- **동맹**: 상호 제안 즉시 성립, 300 tick 전 파기 `MIN_DURATION`, BREAKING 150 tick → `cooldown_elapsed`. 생존자 전원이 동맹이면 lockout countdown(+150) → dissolved, freeze +300 → `ALLY_FROZEN`. BREAKING 해제로 cancelled, t=8400에 `ALLY_CUTOFF`, 동맹 2개를 가진 상태에서 `ALLY_LIMIT`.
- **방 설정**: 2..12 범위. S 최대 7, 생략하면 7로 낮춘다. 명시 초과는 `BAD_ROOM_OPTIONS`. 실수 값, size XL, waterMode 오류, `shallowPermille` 1001, `botCount` 범위 초과, 난이도 오류도 모두 거절된다. 없는 mapId는 `MAP_NOT_FOUND`. 구 `targetPlayers`도 받는다. 프리셋 방은 `match_config.mapSource/mapId`를 보낸다. 사람 1 + 봇 0이면 `NOT_ENOUGH_PLAYERS`. 비공개 방은 ready로 자동 시작하지 않는다. 카운트다운 때 1..N으로 재번호한다. 공개 룸 설정 변경은 `BAD_ROOM_OPTIONS`, pacingNote는 `guaranteed`.
- **토폴로지 추상화**: `server/src/game/*`에 `width`·`%`·맨해튼 직접 계산이 없다(snapshot 직렬화만 예외).

### 3.6 문서 §10·§13 반영 상태
- §10-1·2·12·16·17·19·22·31~45: 코드에 반영된 것을 확인했다(위 항목 참고). §10-21(IDLE 자동 재교전 없음)은 코드 판독으로만 확인했다.
- §10-5와 §13-6은 이미 해소됐으므로 문서를 갱신해야 한다(m-11). GDD에 남은 오래된 주석은 m-15에 정리했다.
- §13-4(cap이 환급을 자르는 문제), §13-5, §13-7, §13-8(봇 페이싱)은 여전히 열려 있다. game-designer 판단이 필요하고, §13-8은 I-3과 같은 문제다.

### 3.7 결정론·견고성: 통과
- 잘못된 입력에도 서버는 죽지 않았다. 확인한 입력: JSON 아님, 모르는 type, `troops` 1e300·−1, tileId 2^33, flagId 4294967295·−1, posture 2, `targetPlayerId` 0, `accept:"yes"`, 남의 깃발, 없는 flagId, `map:"M"`, `timeLimitMin:"x"`, 4 KB 초과. 모두 문서의 코드나 close 1009로 처리됐다.
- rate limit: 25개를 연달아 보내면 25개 모두 ack이 왔고, 일부가 `RATE_LIMITED`였다.
- emote: 1초에 1회만 방송되고, 범위 밖 코드는 조용히 무시된다.
- 재접속: `resumed` true에 같은 sessionId. 순서는 welcome → room_state → match_config → map_init → snapshot_full이고, 그다음 delta tick은 full.tick+1로 이어진다. `player_reconnected`가 방송된다. 같은 토큰으로 새 소켓이 붙으면 기존 소켓은 close 4000이 된다. 인게임 `lobby_leave` 뒤에는 재접속이 되지 않는다.
- 회계 불변식(`ledgerImbalance`)은 헤드리스 4판, 전 tick에서 0이었다.

## 4. 검증 스크립트와 실제 출력 요약

| 스크립트 | 내용 | 결과 |
|---|---|---|
| `server/scripts/qa-schema.ts` | 문서 §4·§5를 손으로 옮긴 런타임 스키마(여분·누락·타입·enum·범위·의미) | — |
| `server/scripts/qa-headless.ts [seed] [S\|M\|L] [N] [diff] [humanIdle]` | 전체 판(9600 tick) 출력을 JSON 왕복한 뒤 스키마·커버리지·순서·재구성 모델·회계·threshold를 검사. 옵션: `QA_DERIVE_TOI=1`(I-1 계산식 검증), `QA_LATE=1`(늦은 입장), `QA_STRICT5=1` | 777/M/10/HARD/끊긴 사람 1명: 메시지 약 1.7만, 스키마 0, 순서 0, 회계 0, 재구성 불일치 `targetOwnerId` 66, `bot_takeover` t450. 1001/S/7/EASY: 불일치 19(`targetOwnerId`). 1009/L/12/NORMAL: `targetOwnerId` 45 + `disengageUntilTick` 1. `QA_DERIVE_TOI=1`이면 0. 4판 모두 timeout 9600. |
| `server/scripts/qa-scenarios.ts` | 실제 명령 경로(`enqueue` → 1단계)로 거절 코드·희귀 이벤트를 유도 | **83/85 통과**. 실패 2건은 I-2(귀환 중 재이탈 불가)와 m-13(GDD #7 수치)이다. 콘솔의 "81/82"는 섹션 6을 덧붙이기 전 집계라서 섹션 6의 3개 항목이 빠져 있다. |
| `server/scripts/qa-ws.ts` | 실제 ws 서버(fixture 프리셋 카탈로그)에서 수신 전체를 스키마로 검사하고, 로비·견고성·재접속·순서를 확인 | **72/73 통과**(실패 = m-1). 수신 스키마 위반 0. |
| 기존 | `npm run typecheck`, `npm test`(119), `npm run smoke`, `npx tsx server/scripts/duels.ts` | 모두 통과 / 표 재현 |
