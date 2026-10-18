# civwar.io v4.2 → v4.5 통합 QA 보고서 (문서 ↔ 서버 ↔ 클라이언트)

- 대상: 브랜치 `docs/gdd-v3.1-and-v4.0-plan`, 최신 커밋 `04cbc1b`(작업 트리 clean 에서 시작). 직전 QA = 2026-10-09 `04_qa_report_full.md`(커밋 `f3935f4`).
- 신뢰 소스 `_workspace/02_backend_protocol.md` §18~§26, 서버 `server/src`, 공유 `shared/src`, 클라이언트 `client/src`.
- 게임 규칙·밸런스 값·판 길이 상수는 건드리지 않았다. 서버·클라이언트 코드 수정 0. 추가한 것은 QA 스크립트와 회귀 테스트 1개뿐이다(§5). 커밋하지 않았다.
- 작성: integration-qa, 2026-10-18

## 1. 판정: 통과 (치명 0, 주요 0, 경미 9)

| 구분 | 수 |
|---|---|
| 치명 | **0** |
| 주요 | **0** |
| 경미 | **9** (문서 갱신 4, 클라이언트 표시 3, 생성기/맵 1, 정보 1) |

**근거 요약**
- **상태 재구성 불일치 0.** 헤드리스 5판 + 실제 ws 4룸(32분 실시간, 판은 threshold 로 29.6분에 종료)에서 매 `snapshot_full` 직전에 클라이언트 모델과 비교했다.
  - 헤드리스(`qa-recon-full.ts`): store 54개, full 비교 10,842회, 불일치 0.
  - 실제 ws(`qa-e2e-full.ts`, 임시 포트): store 10개, full 비교 약 2,000회, 불일치 0. 끊김 → 봇 인계 → 재접속, 관전 중간 입장, GAME_OVER 룸 관전(`game_over` 재전송), 공개 방 자동 시작, 비공개 재번호, 로비 오류 3종이 모두 정상이었다. 던져진 예외 0, 순서 위반 0, `cmd_ack` 누락 0, 종료 뒤 수신 0.
- **멸망·합병·기지 함락 tick 직후 모델 = 새로 붙은 모델.** 175번의 함락/멸망 tick 에서 소유 칸 전체와 기지 소유자를 새 부트스트랩과 비교했다. 불일치 0.
- **프로토콜 문서 ↔ 서버 전송:** 스키마 검증기(`qa-schema.ts`)가 §21~§26 필드를 모두 검사한다(`production.rows`, `combatLoss`, `baseProd`, `flagReturnBase`, `pendingPosture`, `allyBreaks`, `annexedTiles`, `baseNames`, `thumbnail`, `botDifficulty`, `targetPlayerId`). `qa:ws`·`qa:headless`·`qa:scenarios`·`headless-check`·`qa-recon-full`·`qa-e2e-full` 전부 문서 스키마 위반 0.
- **방어 경로:** 클라이언트 `input/route.ts` 와 서버 `rules.ts`(`nextStep`/`defendDest`)가 8,000건(S/M/L 무작위 + 공식 맵 2장, 소유권·동맹 주입, 막힘 4,203건)에서 걸음 열과 정지 칸까지 같다.
- **알려진 열린 점 4개 모두 결론이 났다**(§3).

## 2. 이슈 표

### 주요 / 치명
없음.

### 경미

| ID | 위치 | 증상 | 재현 / 근거 | 담당 |
|---|---|---|---|---|
| m-1 | 문서 `02_backend_protocol.md` §5 `settings` 표(pacingNote 행) | 추정식이 v4.4 이전 값이다. 문서: `P = 육지/인원(무작위는 floor(W×H×0.65))`, 기준 390. 코드: `TARGET_LAND_RATIO_PERMILLE 900`, `PACING_P_REF_LAND_PER_PLAYER 540`(`shared/src/constants.ts`, `server/src/room/settings.ts:40-47,165-168`). 클라이언트 `ui/pacing.ts` 는 서버와 같은 값이라 **코드끼리는 일치**(`qa-pacing-preset.ts` 252조합 불일치 0). | 문서만 읽고 구현하면 판 길이 추정이 달라진다 | 백엔드(문서) |
| m-2 | 문서 §20 3번째 줄 "현재 클라이언트 코드에는 이 판정이 없어 수정하지 않았다" | 사실과 다르다. `client/src/render/combatPairs.ts` + `render/topology.ts:118` `touching()` 이 8방향 판정을 이미 쓴다(좌표식은 서버와 같다). | 코드 대조 | 백엔드(문서) |
| m-3 | 문서 §21 본문(21.4 `regions`, 21.2 "0..127") | §22 가 이름을 `rows` 로 바꿨지만 §21 본문과 §5 snapshot_delta 비트 범위("값 범위 0..127", "0..255" 혼재)가 그대로 남아 읽는 순서에 따라 혼동한다. 코드·타입은 `rows`, 비트 0..255 로 일치. | `grep regions 02_backend_protocol.md` | 백엔드(문서) |
| m-4 | GDD `01_game-designer_gdd.md` 6.1·3.1·6.2·5.4 본문 | 판 길이 B+C 값(§24)이 본문에 반영되지 않았다(헤더 14·42행에 "반영 예정"만 있음). 서버 상수는 §24 값(20분 60% → 30분 25%, 러시 26분 ×0.6)이고 문서 §24 와 코드는 일치한다. | `thresholdScaled` 계산 = 문서 곡선 | game-designer |
| m-5 | `client/src/state/gameModel.ts:325-334` 주석 + `applyEvent` 의 `flag_idle`/`flag_recalled`/`flag_engaged` | 주석은 "상태 필드는 같은 tick 의 snapshot_delta(flagStats)가 싣는다"지만 `flagStats` 는 1초 주기(`t%5==0`, 교전 중만 매 tick; `snapshot.ts:306-316`)다. 그래서 이벤트 직후 최대 4 tick(0.8초) 동안 모델 `state` 가 이전 값이다. 영향: ① IDLE "막힘/대기" 태그, "귀환" 태그가 최대 1초 늦게 뜬다 ② 회수 직후 1초 안에 우클릭하면 클라이언트 가드(`controller.ts:600`)를 지나 서버가 `RETURNING` 으로 거절해 토스트가 뜬다. 상태 불일치로 남지는 않는다(5의 배수 tick 에 맞는다). | `qa-v45-integration.ts` S2: 이벤트 tick 모델 `MARCHING` → 5의 배수 tick `IDLE` | 프론트(선택: 이벤트에서 state 를 즉시 갱신) |
| m-6 | `client/src/ui/techTree.ts:217-219`, `TechWindow.tsx:423` | 테크 상세의 "골드 수입 (지금 영토 기준)" 이 `goldPerSecond(goldWeight…)` 라 **기지 골드(v4.5 기지 60칸분·수도 100칸분)가 빠진다.** HUD·hover(`incomeOf` = `production.rows` 합)와 숫자가 다르다. 라벨이 "영토 기준" 이라 의도된 근사일 수 있다. | 기지를 가진 플레이어에서 HUD 수입 vs 상세 패널 "+n/초" 비교 | 프론트 |
| m-7 | `client/src/render/combatPairs.ts:36-37` | 교전 연결선 후보를 "양쪽 `inCombat` + 다른 주인 + 비동맹 + 접촉" 으로만 만든다. 서버 전투 간선은 `hostile ∧ (한쪽이 공격 태세이고 귀환 중 아님)`(`combat.ts:79-81`)이다. 그래서 같은 무리 안의 **귀환 중 공격 태세 깃발 ↔ 적 방어 깃발** 쌍에 서버에 없는 선이 그려진다. 봇 판 3,600 샘플(5 tick 간격)에서 연결선 3,964개 중 3개(0.1%). 순수 장식. | `client/scripts/qa-v45-pairs.ts` | 프론트(선택) |
| m-8 | `server/src/map/generate.ts` 호수 생성 창(885~915‰) | 최종 맵의 물 비율이 8.5% 아래로 내려가는 경우가 있다. 무작위 420맵 중 10맵(2.4%)이 8.42~8.47%, **공식 `official-m-01` 이 8.4%**(육지 5495/6000 = 915.8‰). 반대편은 11.49% 까지 정상. 육지 한 덩어리·물 이동 그래프 제외·스폰/기지 육지는 420맵·공식 9장 모두 통과. 문서 §22.1 표도 m-01 을 8.4% 로 적었다. 창 측정 시점(섬 메우기 전)과 최종 맵 비율의 차이로 보인다. 규칙·밸런스 영향은 0.1%p 미만이라 고치지 않았다. | `server/scripts/qa-v45-maps.ts`, `qa-official-maps.ts` | 백엔드(문서의 "8.5~11.5%" 를 "생성 창 기준" 으로 정정하거나 창 판정을 최종 맵 기준으로) |
| m-9 | `flag_idle.reason` 이 `snapshot_full` 에 없음 + 클라이언트 `flagIdleReason` | 방어 깃발 "막힘" 사유는 이벤트로만 전달된다. 재접속·중간 입장·새로고침한 클라이언트는 이미 막힌 깃발을 "대기" 로 본다(`renderer.ts:1166`). 문서에는 이 한계가 적혀 있지 않다. 정보성. | 설계 | 문서/백엔드(선택) |

### 직전 QA(2026-10-09) 항목의 현재 상태
- J-1(인게임 퇴장 버튼), J-2(GAME_OVER 룸 `game_over` 재전송): **해소.** e2e ivan 이 GAME_OVER 룸 관전으로 `game_over` 를 받고 `modelGameOver=true`.
- m-1(`NOT_IN_ROOM` 토스트): **해소**(`store.ts:495` 무시 창). 원시 서버 오류는 남지만 화면에 안 뜬다.
- m-2(관전자 새로고침하면 로비): **그대로 열려 있다.** e2e `A_carolRefresh` = `room:null, game:false` (welcome 만 수신). 설계 결정 필요.
- m-12(이모트 UI 없음): **해소**(§26 대상 이모트 포함).

### 재현 불가 / 문제 아님으로 판단한 관찰
- e2e 클라이언트 예측기의 `cmd_flag_issue 예측 NO_SLOT / 실제 OK` 3건(store 3개에서 각 1건): 클라이언트 `flagCap` 이 `playerDeltas` 주기(5 tick)에 맞춰 갱신되고 서버는 타일 수가 늘어난 즉시 슬롯을 늘리기 때문이다. 서버가 더 관대한 방향이라 사용자 영향 없음.
- 문서 대비 `threshold_update` 횟수: 문서 11회(6000~9000), 헤드리스 판은 8836 tick 에 끝나 10회였다. 코드는 문서 곡선과 같다(`thresholdScaled`).

## 3. 알려진 열린 점 4개 + 추가 지시 검증

### 3.1 "쿨타임 중 내 기지 우클릭이 태세를 바꿨다" → **서버 설계대로, 버그 아님** (재현 정리)
- 서버 `flagops.ts:240-251` `retargetFlag`: 도착지 태세 `def`; `def === 현재` 면 `pendingPosture = null`; `t >= postureCooldownUntilTick && !inCombat` 면 즉시 전환(`flag_posture_changed auto:true`); 그 외 **`pendingPosture = def` 로 미룬다.** `applyPendingPosture`(`flagops.ts:73-97`)가 쿨타임이 끝난 첫 tick 의 4단계 첫머리에 자동 적용한다.
- 실제 명령 경로(`Simulation.enqueue`) + 실제 `ClientStore` 로 확인(`qa-v45-integration.ts` S1, 회귀 테스트 `client/test/qaV45.test.ts` 첫 항목):
  1. DEFEND 로 바꾼 직후(쿨타임) 중립 칸 우클릭 → `cmd_ack{accepted, posture: DEFEND}`(현재 태세), 서버 `posture` DEFEND 유지 + `pendingPosture` ATTACK, `flag_posture_changed` 없음, 델타 비트 128, 클라이언트 모델 `posture DEFEND / pendingPosture ATTACK`.
  2. 쿨타임이 끝난 tick(= `cooldownUntilTick`)에 `flag_posture_changed{auto:true}` 가 오고 대기가 지워진다.
  3. ATTACK + 쿨타임 중 **내 수도 우클릭** → `ack.posture ATTACK`, 대기 DEFEND, `flag_retargeted.posture ATTACK`, 쿨타임이 끝난 tick 에 DEFEND 로 자동 전환.
- 프론트가 본 "태세가 방어로 바뀜" 은 (a) 쿨타임이 막 끝난 시점이거나 (b) 대기 → 자동 전환이다(프론트 노트가 스스로 "쿨타임이 막 끝났을 수도 있어 확정은 못 함"이라고 적었다). 프로토콜 §4 표·§21.2 와 서버가 일치한다. 즉시 전환으로 바꾸자는 안은 `_workspace/BACKLOG.md` 에 이미 있고 사용자 결정 대기다.

### 3.2 방어 깃발 "unreachable" IDLE → **실제 서버 시나리오로 확인됨**
- 실제 판(봇 2600 tick) 소유 지도에서 서버 `defendDest` 가 앵커와 다른 칸을 주는 (기지, 앵커) 를 찾아 `cmd_flag_issue` 로 발령(시드 41):
  - 클라이언트 미리보기 `computeRoute` = `blocked:true`, `stopTile` = 서버 `defendDest`(1777).
  - 서버 깃발이 그 칸에서 `flag_idle{reason:"unreachable", autoRecallTick = tick+600}` 후 `IDLE`, 600 tick 뒤 `RETURNING`.
  - 클라이언트 모델: 5의 배수 tick 에 `state IDLE`, 위치 일치, `flagIdleReason = unreachable`(m-5 로 이벤트 tick 에는 `MARCHING`).
- 봇 전체 판 5판(9,600 tick 상한)에서 실제로 나온 `unreachable` 이벤트 50건 모두 클라이언트 `flagIdleReason` 에 반영됐고 5의 배수 tick 에 모델 `IDLE` 이었다.

### 3.3 멸망·합병 · 합병 번쩍임
- `player_eliminated.annexedTiles` ↔ 같은 tick `snapshot_delta.tileChanges`: 멸망 5건(전체 판 5판) 모두 멸망자 잔여 칸 0, `tileChanges` 중 "멸망자 → 합병자" 로 넘어간 쌍 수 = `annexedTiles + 1`. +1 은 같은 tick 앞 단계(7단계)에서 마지막 기지를 함락한 합병자가 이미 가져간 칸이다(문서 §21.3 순서와 같다). 회귀 테스트 `qaV45.test.ts` 4번째 항목(허용 0..5).
- 클라이언트 `annexFlashes[].tiles` 는 `annexedTiles + 1`(같은 이유로 마지막 기지 칸이 번쩍임에 포함). 순수 장식이고 동작상 문제 없음(설계 판단 불필요).
- 이벤트 순서: `base_captured` → `flag_ended` → `ally_broken` → `player_eliminated` → `snapshot_delta`(tileChanges 포함) → (full) 이 맞다. 순서 위반 0.
- 기지 함락/멸망 tick 직후 새 부트스트랩(`buildSnapshotFull`)을 붙인 모델과 이어 받은 모델이 소유 칸 전체·기지 소유자·`baseNames` 에서 같다(175회). 5의 배수 tick 에서는 `diffAgainstFull` 전체 비교도 0.

### 3.4 클라이언트 방어 경로(`route.ts`) ↔ 서버
- `client/scripts/qa-v45-route-parity.ts`: 5개 구성(S/M/L 무작위, 공식 m-01·l-02), 각 구성 4단계 × 400건 = **8,000건**, 방어 걸음 열 + 막힘 여부 + 정지 칸 일치율 100%. 막힘 4,203건 포함. 동맹 주입 단계 15회(ACTIVE/BREAKING 혼합).
- 회귀 테스트로 축소판(S 8인, 450건)을 `qaV45.test.ts` 에 넣었다.

### 3.5 공식 맵 9장
- checksum 재계산 일치 9/9, 문서 §22.1 표(시드·육지·물 %)와 일치 9/9, `origin.generator = "v4.5"` 9/9.
- 이동 그래프에 물 칸 없음 9/9, 육지 4방향 한 덩어리 9/9, 스폰·기지 모두 육지 9/9, 최소·추천 최대·최대 인원으로 게임 상태 생성 후 스폰 간 도달 가능 27/27, `totalLandTiles` = 육지 칸 수 일치(공식 9 + 무작위 90).
- 예외: `official-m-01` 물 8.4% 가 생성 창 아래(m-8).

## 4. 항목별 결과 (근거 포함)

### 4.1 문서 ↔ 서버 전송: 통과 (경미 m-1·m-3)
- `shared/src/protocol.ts` 의 메시지 type 약 60종: 문서에 모두 있고, S2C 는 서버 전송 지점이 모두 있다. `ping` 은 클라이언트가 보내지 않는다(서버는 `pong` 응답 구현; 클라이언트 keepalive 없음, 서버 하트비트도 없음 — 정보).
- 필드 단위 검증: `qa-schema.ts` 의 해당 줄 — `production.rows`(kind enum·`baseTileId int|null`·`prodPm 0..1000`·milli/초 정수) :92, `pendingPosture 0|1|null` :87, `halted`·`returnBaseTileId` :86, `bases[].prodPm` :142, `baseProd` :156, `flagReturnBase` :155, `combatLoss` :158, `player_eliminated.annexedTiles` :166, `allyBreaks` full 필수 :140 / delta 선택 :151, `baseNames` :137, `room_list.thumbnail` :119, `emote_broadcast.targetPlayerId?` :169.
- 상수: `match_config.constants` 에 §22.10 상수 전부, `TECH_NODES` 32개(17·19 가 스탯 11·13, `icon` 필드), `NEUTRAL_SQRT_COEF_PERMILLE` 없음. 무작위 24맵 + 공식 3장에서 `baseNames` 길이·고유·수도 지명 확인(`qa-v45-misc.ts`).
- 단위: `combatLoss` milli(`lossFloaters.ts` /1000, 소수 1자리), `production.rows` milli/초(`production.ts` /1000), `prodPm` ‰(표시 `floor(/10)`%, 보간 `+167/300 ‰/tick` 문서 일치), `hpPct` 정수 %.
- `combatLoss`: 매 tick 합 = `state.ledger.combat` 증가분, flagId 오름차순, 모든 값 > 0 — 5판 약 4만 tick 위반 0(`qa-v45-integration.ts` S4).
- `production.rows`: 델타에 실린 8.6만 건에서 기지 행 = 내 기지 tileId 오름차순(탈락자 `[]`), 영토 행 ≤ 1개이고 맨 끝. 단 `tiles`/기지 행은 "직전 2단계 정산" 값이라 같은 tick 에 기지를 함락하거나 칸을 먹으면 다음 5 tick 주기까지 한 번 늦다(문서대로).

### 4.2 문서 ↔ 클라이언트 파싱: 통과 (경미 m-5·m-6·m-7·m-9)
- `GameModel.applyEvent` 미처리 type 0(헤드리스 5판 전체, `unhandledEvents {}`), 피드 예외 0.
- `ClientStore` 가 보내는 C2S: `emote{code, targetPlayerId?}`(자기·0 이하 제외, 1초 제한 클라이언트 선차단), `cmd_flag_retarget`(우클릭), `cmd_flag_recall{baseTileId?}`, 나머지 기존. e2e 에서 사람 명령 거절 코드는 전부 문서 §6.1 에 있고 `BAD_REQUEST` 0.
- `Record<CmdRejectReason, string>` 타입으로 모든 거절 코드에 한국어 문구가 강제된다.
- 방 카드: `botDifficulty` 와 `thumbnail`(null 이면 공식 맵 번들 / "무작위" 분위기 그림)을 형식 검사 후 사용(`mapPreview.ts decodeThumbnail`), 형식 오류면 폴백.

### 4.3 GDD ↔ 서버 로직: 통과 (경미 m-4 는 GDD 쪽 갱신 누락)
- v4.5 규칙은 `server/test/v45.test.ts`(21건)가 직접 검증하고 `qa:scenarios` 87/87 이 대표 전투 #7 의 v4.5 손실률(수비 ≈840 / 공격 ≈858)을 확인한다. 이번에 독립 재계산한 항목: 중립 노출 소모 `max(500, floor(troops×25/100000))`·적 땅 `max(1000, floor(×5/10000))`(`movement.ts:34-41`), 방어 경로 `defendDest`, 판 길이 곡선(`victory.ts thresholdScaled` ↔ 문서 §24.1 분 경계값), 승리 판정 정수 비교.
- 규칙·수치는 변경하지 않았다.

### 4.4 좌표/단위계: 통과
- 서버 `square.ts touching()` 와 클라이언트 `topology.ts touching()` 는 같은 식(`tileId = row×width + col`, 체비셰프 ≤ 1). 썸네일 `bases` index = `floor(row/scale)×w + floor(col/scale)` 를 클라이언트 `tileCenter` 로 그린다.

### 4.5 엣지 케이스: 통과 (m-2 만 열림)
- 재접속: `welcome.resumed`, 부트스트랩 순서 `welcome → room_state → match_config → map_init → snapshot_full`, 다음 delta = full+1(`qa:ws`).
- 늦은 입장 + 종료: `match_config.constants`(TECH_NODES 포함)와 `game_over` 재전송이 e2e ivan 에서 확인됨.
- 마지막 1명 남았을 때·최대 인원 초과: 기존 서버 테스트가 계속 통과(`npm test` 432).

## 5. 검증 스크립트와 결과

| 스크립트(커밋 안 함) | 내용 | 결과 |
|---|---|---|
| `server`: `qa:headless` (777 M 10 HARD) | 8,836 tick, 회계 위반 0, 스키마 위반 0종, 순서 위반 0, 재구성 불일치 0 | 통과 |
| `server`: `qa:scenarios` | 거절 코드·희귀 이벤트 | **87/87** |
| `server`: `qa:ws` | 실제 ws 형식 견고성·재접속·이모트(§26)·rate limit | **82/82**, 스키마 위반 0 |
| `server`: `qa-schema.ts` | 라이브러리(독립 실행 출력 없음). npm 스크립트 `qa:schema` 는 없고 `qa:ws`·`qa:headless`·`qa:scenarios` 가 호출 | 해당 없음 |
| `npm run smoke` | | SMOKE PASSED |
| `client/scripts/headless-check.ts 90 ws://localhost:18431` | 실제 서버(`PORT=18431`) + `ClientStore`, 90초 | full 17회 불일치 0, ack 수락 24 / 거절 NO_SLOT 16 |
| `client/scripts/qa-recon-full.ts` | 헤드리스 5판(S/M/L, 공식, 난이도 혼합) | 불일치 0 / 5판 |
| `client/scripts/qa-e2e-full.ts` | 실제 ws 4룸 32분 실시간 | 재구성 불일치 0, 예외 0 (결과 JSON 은 scratchpad) |
| `client/scripts/qa-decay-flash.ts`, `qa-pacing-preset.ts` | 감소 판정 / 공식 맵 판 길이 추정 | 오탐 0 / 252조합 불일치 0 |
| **신규** `client/scripts/qa-v45-integration.ts` | S1 태세 쿨타임, S2 unreachable 실서버, S3 멸망·합병·함락 직후 부트스트랩, S4 combatLoss·production 불변식 | **28/28** |
| **신규** `client/scripts/qa-v45-route-parity.ts` | 방어 경로 클라이언트 ↔ 서버 | 8,000건 불일치 0 |
| **신규** `client/scripts/qa-v45-pairs.ts` | 교전 연결선 후보 vs 서버 전투 간선 | 3,964쌍 중 3 (m-7) |
| **신규** `server/scripts/qa-official-maps.ts` | 공식 맵 9장 | 1건(m-8, m-01 물 8.4%) |
| **신규** `server/scripts/qa-v45-maps.ts` | 무작위 420맵 불변식 | 10건 모두 물 8.42~8.47% (m-8), 나머지 불변식 위반 0 |
| **신규** `server/scripts/qa-v45-misc.ts`, `qa-v45-misc2.ts` | `baseNames`·상수·`TECH_NODES`, `totalLandTiles` | 통과 |
| **신규 회귀 테스트** `client/test/qaV45.test.ts` | 위 S1·S2·경로 대조·멸망 합병을 vitest 로 | 4건 통과(약 20초) |
| `npm run typecheck` | | 통과 |
| `npm test` | 31 파일 | **432 통과**(기존 428 + 신규 4) |

실행 방법: `npx tsx client/scripts/qa-v45-integration.ts`, `npx tsx client/scripts/qa-v45-route-parity.ts`, `npx tsx server/scripts/qa-official-maps.ts` 등. e2e 는 포트 0(임시)이라 8092/5182 를 쓰지 않는다. headless-check 용 서버는 18431 에 띄웠다가 내렸다.

## 6. 수정한 것
- 서버·클라이언트·공유 코드 수정 없음(치명·주요 0).
- 새 파일(전부 미커밋): `client/test/qaV45.test.ts`, `client/scripts/qa-v45-{integration,route-parity,pairs}.ts`, `server/scripts/qa-official-maps.ts`, `qa-v45-{maps,misc,misc2}.ts`.
- 옛 스크립트는 고칠 것이 없었다. `qa-recon-full.ts` 의 가짜 `room_state` 가 닉네임을 `BOT n` 으로 만들지만 클라이언트가 봇 판단을 `isBot` 으로 하므로 결과에 영향이 없다.

## 7. 남은 이슈 · 결정이 필요한 것
1. **m-2(이전 QA): 관전자 새로고침 시 로비로 복귀** — 서버가 룸 없는 세션을 소켓 close 에 즉시 버린다. 설계 결정(관전자 재접속 지원 여부) 필요.
2. **m-8: 물 비율 창** — 공식 m-01(8.4%)과 무작위 2.4%가 문서의 8.5~11.5% 밖. 창 정의를 문서에서 고칠지 생성기 판정을 최종 맵 기준으로 옮길지 결정. 맵을 바꾸면 checksum 과 §22.1 표가 바뀐다(규칙 변경은 아니지만 공식 맵 재생성이라 결정 사항).
3. **m-4: GDD 6.1/3.1/6.2/5.4 를 §24 값으로 갱신**(game-designer). 판 길이 상수는 보류 중이라 건드리지 않았다.
4. **m-1·m-2·m-3: 프로토콜 문서 정정**(백엔드): §5 pacingNote 식, §20 클라이언트 서술, §21 `regions`/비트 범위 표기.
5. **프론트 선택 사항:** m-5(이벤트에서 상태 즉시 갱신), m-6(테크 상세 수입 행에 기지 반영), m-7(교전 연결선에서 귀환 공격 깃발 제외), m-9(문서에 한계 명시).
6. 보류 중인 사용자 결정(태세 즉시 전환, `BACKLOG.md`)은 이번 범위 밖이며 §3.1 의 현재 동작이 그 결정 전 기준선이다.
