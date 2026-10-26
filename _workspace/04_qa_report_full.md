# civwar.io Phase 6: 전체 경계면 교차 검증 보고서 (문서 ↔ 서버 ↔ 클라이언트)

- 대상: 커밋 `f3935f4` (브랜치 `docs/gdd-v3.1-and-v4.0-plan`). 신뢰 소스 `_workspace/02_backend_protocol.md`, 참고 `03_frontend_integration-notes.md`, 직전 `04_qa_report_backend.md`
- 범위: 서버가 보내는 S2C 전부의 클라이언트 소비, 클라이언트가 보내는 C2S 전부의 서버 검증, 리듀서 상태 재구성, 이벤트 커버리지, 클라이언트 자체 계산, 로비·방 설정·대기실, 공식 맵 썸네일, 게임 종료, 시각 확인, 기존 검사 회귀
- 코드는 고치지 않았다. QA 스크립트 4개를 `client/scripts/qa-*.ts`에 새로 만들었고 커밋하지 않았다(§4).
- 작성: integration-qa, 2026-10-09

## 1. 판정: 조건부 통과

| 구분 | 수 |
|---|---|
| 치명 | **0** |
| 주요 | **2** (둘 다 "화면에서 빠져나갈 수 없음" 계열. 상태 불일치나 크래시는 아니다) |
| 경미 | **12** |

**근거 요약**
- **상태 재구성 불일치 0.** 아래 두 경로에서 클라이언트 `ClientStore`/`GameModel`을 매 `snapshot_full` 직전에 full과 비교했다.
  - 헤드리스 전체 판 5판(S/M/L, 무작위와 공식 맵, 난이도 혼합, 끝까지 진행): store 56개, full 비교 11,222회, 불일치 0
  - 실제 ws 실시간 판 3개(32분, 동시 진행): store 10개, full 비교 약 2,100회, 불일치 0
  - 두 경로 모두 중간 입장(관전), 끊김 → 봇 인계 → 재접속, 탈락, 게임 종료를 포함한다.
- **명령이 조용히 무시된 경우 0.** 실제 ws에서 사람 명령 1,339건을 보냈고, 모두 `cmd_ack`을 정확히 1회 받았다. 거절 사유는 모두 한국어 토스트로 표시됐다.
- **이벤트 커버리지.** 문서 §5의 S2C 41종 모두 클라이언트에 처리 경로가 있다. `GameModel.applyEvent`가 모르는 이벤트는 0종이었다.
- **피드 처리 중 예외 0.** 송신 순서 위반도 0이었다.
- **클라이언트 자체 계산 ↔ 서버 함수 불일치 0.** 확인한 항목은 troopCap, 골드 수입, 테크 비용, flagCap, 커서 예고의 대상·보호 타일 수와 사거리, 판 길이 추정(무작위·공식 맵 전 조합)이다.
- **기존 검사 전부 통과.**
  - typecheck
  - `npm test`: 12 파일, 152 테스트
  - smoke: `SMOKE PASSED`
  - qa:ws: 73/73, 스키마 위반 0
  - qa:headless 777/M/10/HARD: 스키마·순서·재구성 위반 0
  - headless-check 75초: full 14회 불일치 0, ack 수락 23 / 거절 1(NO_SLOT)
  - qa:scenarios: 84/85(실패 1 = 기존 GDD 예시 수치 m-13)

**재작업이 필요한 쪽**
- **프론트**: 주요 J-1, J-2(클라이언트 쪽), 경미 m-1·m-3~m-10
- **백엔드**: J-2(GAME_OVER 부트스트랩에 `game_over` 포함), m-2(선택)
- **문서**: J-2, m-2, m-11, m-12
- **GDD**: 없음. 직전 백엔드 QA의 I-3(페이싱)은 그대로 열려 있다. 이번 판 결과는 timeout 6판, threshold 3판이다(§3.7).

## 2. 이슈 표

### 주요

| ID | 심각도 | 위치 | 증상 | 재현 | 기대값 | 담당 |
|---|---|---|---|---|---|---|
| **J-1** | 주요 | `client/src/ui/GameScreen.tsx:142-159`(인게임 화면에 퇴장 버튼 없음). `store.leaveRoom()`은 `ui/WaitingRoom.tsx:110`과 게임 종료 오버레이(`GameScreen.tsx:406`)에서만 호출된다. / 서버 `server/src/room/room.ts:234-242`(인게임 소켓 끊김 = 자리 유지), `net/server.ts:45-52`(토큰 재접속) | **게임 도중에 로비로 나갈 방법이 없다.** 탈락한 플레이어(관전 모드)와 진행 중인 판을 관전하는 사람도 마찬가지다. 새로고침해도 저장된 토큰으로 **같은 판에 다시 들어간다**(관전자만 예외, m-2). 그래서 10분에 탈락한 플레이어는 판이 끝날 때까지(최대 약 22분) 갇힌다. 서버는 탈락자의 다른 방 입장을 허용하고(`lobby.ts:144` `blockedByActiveGame`은 생존자만 막는다), `lobby_leave`도 받는다. 막힌 곳은 UI뿐이다. | 코드 판독. e2e에서 bob은 봇 인계 뒤 탈락했고(토스트 "탈락했습니다 — 관전 모드"), 판이 끝날 때까지 store에서 나갈 경로가 없었다. | HUD(또는 Esc 메뉴)에 "나가기"를 둔다 → `store.leaveRoom()`. 생존 중이면 확인 대화상자를 띄운다("자리는 끊긴 상태로 남고 90초 뒤 봇이 맡습니다 — 재접속 불가", 문서 §3 "인게임 `lobby_leave`"). 탈락자·관전자는 바로 나간다. | 프론트 |
| **J-2** | 주요 | 서버 `room.ts:189-199`(`spectate`는 GAME_OVER 룸도 허용), `room.ts:253-271`(`onResume`은 GAME_OVER에도 부트스트랩을 보낸다). 둘 다 `game_over`는 다시 보내지 않는다. / 클라이언트 `GameScreen.tsx:156`(종료 오버레이는 `game.gameOver`가 있을 때만), `input/controller.ts:61`(`canCommand`는 `room.phase`를 보지 않는다) / 문서 §3 "관전 (IN_GAME/GAME_OVER 룸)", §5 `game_over` | **GAME_OVER 단계에서 들어온 클라이언트는 멈춘 게임 화면에 갇힌다.** 해당하는 경우는 판이 끝난 뒤 60초 안에 관전으로 들어온 경우, 그리고 판 끝 무렵 연결이 끊겼다가 재접속한 경우다. 종료 오버레이도, 결과도, "로비로" 버튼도 나오지 않는다. 재접속한 생존자는 `canCommand()`가 true여서 명령을 계속 보낼 수 있고, 매번 `NOT_IN_GAME` 토스트를 받는다. 60초 뒤 룸이 조용히 정리되면 화면에 아무 설명도 없다. 새로고침해야 빠져나온다. | `qa-e2e-full.ts`의 ivan: 룸 A가 끝난 직후 `lobby_spectate` → `phase GAME_OVER`, 모델 ready, **`gotGameOver:false`, `modelGameOver:false`** | (권장) **백엔드**: GAME_OVER 룸의 개인 부트스트랩 뒤에 마지막 `game_over`를 다시 보낸다(룸이 보관). 문서 §3·§5에 "GAME_OVER 부트스트랩 = … + `game_over`"를 명시한다. **프론트**: 방어 코드를 둔다. `room.phase === 'GAME_OVER'`이면 `canCommand=false`로 하고, `game_over`가 없어도 "게임 종료" 오버레이와 "로비로" 버튼을 표시한다. | 백엔드 + 프론트 + 문서 |

### 경미

| ID | 위치 | 증상 | 재현 / 근거 | 담당 |
|---|---|---|---|---|
| m-1 | `client/src/state/store.ts:202-206`, 서버 `room.ts:430-443`(`dispose`는 통지 없음) | 게임 종료 60초 뒤 룸이 정리된다. 그 후 "로비로"를 누르면 `lobby_leave` → `error NOT_IN_ROOM` → 빨간 토스트 "방에 있지 않습니다"가 뜬다. 로비 복귀 자체는 된다(로컬 상태를 먼저 비우기 때문). | e2e: dave(1931초), alice·carol2(1994초) 모두 `NOT_IN_ROOM`. 직후 alice 빠른 시작은 정상(LOBBY, autoStartMs 30000). | 프론트(`GAME_OVER`이고 일정 시간이 지났으면 보내지 않거나, 이때의 `NOT_IN_ROOM`은 무시). 또는 백엔드(dispose 시 `room_state` 등 통지) |
| m-2 | 서버 `net/server.ts:72-78`(룸이 없는 세션은 소켓 close 시 drop), `room.ts:235`(관전자 끊김 = leave) / 문서 §3 | **관전자가 새로고침하면 로비로 돌아간다.** 토큰 세션이 이미 없어서 `welcome.resumed:false` → 클라이언트가 룸을 비운다. 플레이어는 같은 판으로 복귀하는데 관전자만 동작이 다르고, 문서에 없다. | e2e: carol 새로고침 → `room null`, 수신 `welcome` 1개. 코드를 다시 입력하면 관전된다. | 문서(명시). 원하면 백엔드(관전 세션 유지) |
| m-3 | `client/src/render/renderer.ts:268` | 감소 표시(회색, 흰 테두리 깜빡임, ▼)의 판정이 "진척 감소 ∧ > 0"이다. 그래서 **대상 칸이 바뀐 tick**에 오탐이 난다. 점령 직후 다음 칸을 같은 tick에 밀어 57→36이 되는 경우 등이다. 실제 7c 감소가 아닌데 450ms 동안 "줄어드는 중"으로 보인다. | `qa-decay-flash.ts`(M10 4000 tick): 렌더러 판정 12회 전부 오탐이었다(같은 칸 감소는 0회). 예: t1608 f207 57→36, tgt 1792→1892. | 프론트(`targetTileId`가 같을 때만 감소로 판정) |
| m-4 | `GameScreen.tsx:341`, 렌더러 행군 라벨 "병력 · n초" / 문서 §5 `etaTick`("앵커까지" 추정) | 표시한 ETA는 앵커까지의 시간이다. 그런데 깃발은 front가 사거리에 들어오는 순간 교전을 시작한다. 그래서 실제 교전 개시는 **평균 18~30 tick(4~6초) 빠르고**, 오차 범위는 −210~+135 tick이다. 5 tick 이내로 맞은 경우는 6~16%다. | `qa-recon-full.ts` 5판의 `flag_issued.etaTick` 대비 `flag_engaged.tick` 오차: n=438~1237, mean −18.2~−29.6 | 프론트(문구를 "앵커 도착 약 n초"로 바꾸거나 "약"을 강조). 또는 백엔드(교전 개시 추정치) |
| m-5 | `client/src/state/feed.ts` `who()`(base_captured, ally_break_started 등) | 주어가 나일 때 "**나이(가)** 동맹 파기 …"처럼 조사가 깨진다. | `qa-recon-full.ts` 동맹 시나리오 피드 | 프론트 |
| m-6 | `feed.ts`의 `ally_proposal_closed → null` | 내가 보낸 동맹 제안이 **거절되거나 만료되어도** 알림이 없다. 외교 패널의 "제안함"만 사라진다. | 동맹 시나리오 t1125 decline: 피드·토스트 없음 | 프론트 |
| m-7 | `client/src/render/mapPreview.ts:46-55` vs 서버 `map/presets.ts mapFromPreset` | 썸네일은 항상 `spawns.slice(0,N)`을 쓴다. 서버는 `spawnSets[N]`이 있으면 그것을 쓴다. 현재 공식 맵 9장에는 `spawnSets`가 없어서 영향은 0이지만, spawnSets가 있는 맵이 추가되면 스폰 위치가 다르게 그려진다. 또 방 만들기 패널(`ui/Lobby.tsx:206`)은 `maxPlayers`명 스폰을 그리는데, 실제 시작 인원은 `1+봇`이다(대기실은 `expectedPlayers`로 맞게 그린다). | 코드 대조, 9장 `spawnSets` 없음 확인 | 프론트 |
| m-8 | (설계 리스크) `client/src/ui/officialMaps.ts`(`import.meta.glob('../../../server/maps/official/*.json')`) | 썸네일과 육지 수(판 길이 추정)를 빌드 시점에 번들한 파일에서 얻는다. 서버를 다른 맵 세트로 배포하거나 같은 id의 파일을 갱신하면, 클라이언트는 **옛 지형 썸네일과 옛 판 길이 추정**을 조용히 보여준다. 이를 감지할 수단(`officialMaps[].checksum`)이 프로토콜에 없다. 번들에 없는 id는 "미리보기 없음"으로 처리해 크래시는 없다. 방이 생긴 뒤의 판 길이는 서버 `pacingNote`라서 정확하다. | 현재 커밋 기준 번들과 서버는 같은 파일이다. 서버 카탈로그 9장 = 번들 9장, 판 길이 추정 252조합 불일치 0(`qa-pacing-preset.ts`). | 백엔드(`welcome.officialMaps[]`에 `checksum` 추가, 필드 추가만) + 프론트(불일치 시 썸네일 숨김). 또는 미리보기 데이터를 프로토콜로 보내기 |
| m-9 | `client/src/ui/WaitingRoom.tsx:136-146`(HostSettings `<input type=number onChange>`) | 숫자를 입력하는 키 하나하나마다 `lobby_update_settings`를 보낸다. 칸을 비우면 `Number('')=0`이 되고, "12"를 입력하는 중간값 "1"도 그대로 간다. 그때마다 `BAD_ROOM_OPTIONS` 빨간 토스트가 뜬다. | 코드 판독 | 프론트(blur·Enter 시 송신, 또는 범위 밖 값은 보내지 않기) |
| m-10 | `store.ts:384` | `error` 토스트에 `ERROR_TEXT`를 먼저 쓴다. 그래서 `BAD_ROOM_OPTIONS`/`NOT_ENOUGH_PLAYERS`의 사람이 읽는 사유(`message`, 문서 §6.2)가 버려진다. 예: "maxPlayers 8 > map max 7"이 "방 설정이 올바르지 않습니다"로만 나온다. | e2e zed 토스트 | 프론트 |
| m-11 | 문서 `03_frontend_integration-notes.md` §4-4, §4-5 | "감소 시각 구분 1차에 없음", "자동 시작 남은 시간은 서버가 주지 않으므로"는 2차에서 이미 해소된 오래된 서술이다. 지금은 `autoStartMs`와 감소 플래시가 구현돼 있다. | 문서 대조 | 문서 |
| m-12 | 문서 §4 `emote` / 클라이언트 | C2S `emote`를 보내는 UI가 없다(`03` §7 "남은 일"에 기재). 수신 `emote_broadcast`는 무시된다(모델은 no-op, 피드 없음). 문서에 "클라이언트 미구현"이 표시돼 있지 않다. | grep: `client/src`에 `type: 'emote'` 송신 없음 | 문서(현황 표기) / 프론트(차기) |

### 재현 불가 / 문제 아님으로 판단한 관찰
- e2e 예측 불일치 83건은 모두 **QA 예측기의 순서 가정**에서 나왔다. 서버 검증 순서는 `OUT_OF_RANGE → TOO_SMALL → ALLIED`인데, 예측기는 예고(`computePreview`)가 동맹·물을 먼저 본다고 가정했다. 그 밖에는 1 tick 지연 사이에 슬롯이 비어 `NO_SLOT` 예측이 `OK`가 된 3건이다. 예고는 표시 전용이고, 어느 경우든 서버 거절 토스트가 나오므로 결함이 아니다.
- 직전 QA의 "DeltaTracker 공용 캐시 → 중간 입장자의 delta 누락 가능성"은 이번에도 재현되지 않았다. 임의 tick 중간 입장 store 41개 + 실제 ws 관전·재접속 4개에서 불일치 0이었다.

## 3. 항목별 결과

### 3.1 생산자-소비자 shape(S2C): 통과
- `client/src/state/gameModel.ts`, `store.ts`가 읽는 필드를 문서 §5와 `shared/src/protocol.ts`에 맞춰 대조했다. 클라이언트에 프로토콜 타입을 다시 정의한 곳은 없다(`@civwar/shared` import).
- **단위**
  - `troops`/`gold`: 정수 표시
  - `hpPct`: 바
  - `progressPct`: 0..99. 목록에 없으면 0(§5 "ATTACK·ENGAGED 전부")
  - `thresholdPct`: 실수 `toFixed(1)`
  - `upkeepPm/10`: %
  - `*Permille`·상수: `match_config.constants`를 우선하고, 없으면 shared 값
  - tick→시간: `config.tickMs`
- **옵션 처리**
  - `snapshot_delta.thresholdPct?`
  - `flagTargets [id, null]`
  - `disengageUntilTick|null`
  - `room_state.countdownMs/autoStartMs|null`
  - `welcome.officialMaps ?? []`
  - `match_config.mapId?`
- **enum·비트**: `FLAG_BIT` 6비트, `state` 4종, `posture` 0/1, `ANY_HOSTILE 254`, `alliance_lockout.phase` 3종(cancelled → `lockoutDissolveTick=null`, dissolved → freeze)
- **RLE**: 클라이언트 `rleDecode(owners|terrain, W×H)`는 서버 `rleEncode`와 같은 shared 함수다. full 11,222회의 owners 비교 불일치 0.
- **좌표계**: 클라이언트 `render/topology.ts` `SquareTopologyView`(tileId=row·W+col, 이웃 상·좌·우·하, 맨해튼 disk)는 서버 `server/src/topology/square.ts`와 같은 식이다. 사거리 BFS는 서버 `minDistFromTerritory`(맨해튼 최소)와 샘플 3,279건에서 일치했다.
- **`connected` 경로**(§3): full / `player_reconnected` / `room_state.status==DISCONNECTED`. e2e에서 bob 끊김 → 봇 인계 → 재접속까지 alice 모델 `connected`가 맞았다.

### 3.2 C2S shape·거절 처리: 통과(경미 m-9·m-10·m-12)
- 송신 명령 9종을 서버에서 모두 검증했다: `cmd_flag_issue`(originBaseTileId 포함), retarget, recall, set_posture, buy_tech, ally_propose, ally_respond, ally_break, lobby_*. 결과는 `BAD_REQUEST`·`BAD_MESSAGE` 0건이었다(e2e 1,339건, headless-check 24건).
- **clientSeq**: 1부터 단조 증가한다. 새로고침한 store는 1부터 다시 시작하지만 서버는 유일성을 요구하지 않는다. 봇 ack은 배달되지 않는다(m-10, 백엔드 수정 확인).
- **거절 코드 UI**: `REJECT_TEXT`는 `Record<CmdRejectReason,…>`라서 31종 전부에 문구가 있다(타입으로 강제). e2e에서 실제로 나온 거절 13종이 모두 토스트로 표시됐다. `ERROR_TEXT`는 12종이고, 없는 코드는 `message`로 대체한다.
- **ack 누락**: 0. e2e 모든 store의 `pendingNoAck = 0`, `store.pending.size = 0`.

### 3.3 상태 재구성 정확성: 통과

**헤드리스(`qa-recon-full.ts`)**
- 서버 `Simulation` 방송을 JSON 왕복해 **`ClientStore.onMessage` 전체 경로**(피드·room_state 포함)에 넣었다.
- 플레이어 1은 사람 자리다. 시작부터 끊김 → 봇 인계(t450) → t3000 재접속(새 store 부트스트랩) → t5000 다시 끊김.
- 977 tick마다 임의 tick에 관전 store를 추가했다.

| 판 | 크기 | 종료 | store | full 비교 | 불일치 |
|---|---|---|---|---|---|
| S7 무작위 얕은 물 40% 혼합 | 72×42 | t7165 threshold | 10 | 1,551 | 0 |
| M10 무작위 혼합 | 100×60 | t7897 threshold | 10 | 1,841 | 0 |
| L12 official-l-01 혼합 | 108×66 | t9600 timeout | 12 | 2,610 | 0 |
| M9 official-m-02 HARD | 100×60 | t9600 timeout | 12 | 2,610 | 0 |
| L11 무작위 EASY | 108×66 | t9600 timeout | 12 | 2,610 | 0 |
| 동맹·Lockout 시나리오(사람 3, 1500 tick) | 72×42 | — | 1 | 60 | 0 |

**실제 ws(`qa-e2e-full.ts`, 인프로세스 서버, 32분 실시간, 동시 4룸)**

| store | 경로 | full 비교 / 불일치 | 비고 |
|---|---|---|---|
| alice | 비공개 M NORMAL 방장, 능동 플레이 | 384 / 0 | timeout 9600, ack 411 수락 + 거절 1,374 |
| bob → bob(새 store) | 40초에 끊김 → 150초에 같은 토큰으로 복귀 | 8/0 → 354/0 | playerId 2 유지, `bot_takeover` 1·`player_reconnected` 1, 이후 탈락 |
| carol → carol | 30초 관전 → 200초 새로고침 → 재관전 | 34/0 → 344/0 | 새로고침 시 로비로(m-2) |
| dave / frank | 비공개 S 얕은 물 EASY, 재번호 | 290/0, 290/0 | threshold t7252 |
| gina | 공식 L-01 HARD 12인, 무행동 | 384/0 | timeout |
| harry | 공개 빠른 시작 | 5/0 | autoStartMs 30000 → 30초 뒤 COUNTDOWN, 60초 인게임 퇴장 뒤 delta 0 |
| ivan | GAME_OVER 룸 관전 | 0 | **J-2** |

### 3.4 이벤트 커버리지: 통과(경미 m-5·m-6·m-12)

| 이벤트 | 상태 반영 | 피드·패널·렌더 |
|---|---|---|
| `flag_issued` | 새 깃발, ETA | 렌더, 라벨 |
| `flag_retargeted` | anchor·targetOwner·posture, ETA(auto:false) | 앵커선 |
| `flag_posture_changed` | posture·쿨타임·**targetOwnerId**(I-1) | 패널 |
| `flag_disengage_started` / `flag_routed` / `flag_disengaged` | disengageUntilTick | 호·태그 |
| `flag_ended` / `flagsGone` | 삭제 | 피드(내 것) |
| `flag_engaged` / `flag_idle` / `flag_recalled` | ETA 삭제 | 피드(idle) |
| `flag_stalled` / `flag_progress_lost` / `flag_blocked` / `flag_unblocked` / `combat_*` | 없음(같은 tick delta가 싣는다 — 문서와 일치) | 피드, 비트 태그 |
| `tech_purchased` | tech, flagCap | 피드 |
| `player_eliminated` | alive | 피드, 토스트, 관전 HUD |
| `player_reconnected` | connected | 피드 |
| `bot_takeover` | 없음(room_state가 DISCONNECTED) | 피드 |
| `threshold_update` / `endgame_rush` | thresholdPct / rush | HUD, 피드, 토스트 |
| `base_captured` | 기지 owner·hp | 피드 |
| `ally_*` / `alliance_lockout` | alliances·proposals·freeze·lockout | 외교 패널, HUD 카운트다운, 카드 |
| `emote_broadcast` | 무시 | 없음(m-12) |
| `game_over` | gameOver | 오버레이(J-2) |

- 헤드리스 판에서 실제로 나온 type은 23~24종, 동맹 시나리오에서 10종(phase·reason 포함)이었다. 모델이 처리하지 못한 type은 0종이었다.

### 3.5 클라이언트 계산 ↔ 서버 계산: 통과(경미 m-4)

| 값 | 클라이언트 | 서버 | 샘플 | 불일치 |
|---|---|---|---|---|
| flagCap(delta 수신 시 재계산) | `gameModel.ts:353` | `economy.ts flagCap` | full 11,222회 diff | 0 |
| troopCap | `gameModel.ts:362` | `economy.ts troopCap` | 17,440 | 0 |
| 골드 수입(gross/초) | `techInfo.ts goldPerSecond` | `grossGoldMilliPerTick × 5` | 17,440 | 0 |
| 테크 비용(Σtech = 구매 수) | `techInfo.ts techCost` | `economy.ts techCost(tier, techPurchased)` | 52,320 | 0 |
| 테크 구매 가능(gold ≥ cost) | `panels.tsx:61` | `commands.ts:86` | e2e에서 "살 수 있음" 판정 후 송신한 구매가 `INSUFFICIENT`로 거절된 사례 0 | 0 |
| 예고 대상 타일 수(공격) / 보호 수(방어) | `preview.ts` | `rules.ts frontCount / guardCount`(해안 교두보 제외 — 예고 앵커는 육지) | 3,279 | 0 |
| 사거리 밖 판정 | BFS 거리 > 40 | `minDistFromTerritory` | 3,279 | 0 |
| 판 길이 추정 | `ui/pacing.ts` | `settings.ts pacingNote` | 무작위(기존 테스트) + 공식 9장 × 인원 × 난이도 252 | 0 |
| threshold·남은 시간 | 서버 값 / `hardTimeoutTick − tick` | full | diff | 0 |
| ETA | 서버 `etaTick` 그대로 | — | — | m-4(의미 차이) |

### 3.6 로비·방 설정·대기실: 통과(경미 m-9·m-10, 공개 방 "방장" 태그는 기존 미세 이슈)
- **방 만들기 오류 경로**(e2e zed): S + `maxPlayers 8` → `BAD_ROOM_OPTIONS`, 없는 mapId → `MAP_NOT_FOUND`, 사람 1 + 봇 0 시작 → `NOT_ENOUGH_PLAYERS`. 세 경우 모두 토스트가 뜨고 기존 방이 유지된다. `lobby_update_settings`(봇 2, HARD) 에코는 `expectedPlayers 3`, `pacingNote timeout_likely`였다.
- **설정 송신**: 무작위 M/S + 물(기본 / `SHALLOW_QUOTA 400`)과 공식 L-01 모두 `match_config.mapSource/mapId/botDifficulty`, 격자 108×66으로 서버와 일치했다.
- **비공개 재번호**: dave(1)·erin(2)·frank(3) → erin 퇴장 → frank 3 → 카운트다운 때 **frank가 2로 재번호**되고 봇이 3..7에 붙었다. 클라이언트 `myPlayerId`가 매 room_state에서 2로 갱신됐고, 인게임 스폰 2 = frank였다. 방장(dave) 유지.
- **공개 방**: `autoStartMs 30000`을 수신했고 30.0초 뒤 COUNTDOWN에 들어갔다. `store.isHost=false`(시작 버튼 없음). 단 `players[].isHost` 태그는 표시된다(기존 미세 이슈).
- **인원-크기 경고**: 방 만들기 패널은 `MAP_SIZE_PRESETS` / `officialMaps.players`로, 대기실은 서버 `recommended`·`expectedPlayers`로 표시한다(브라우저에서 S 7인 "추천 5~6 벗어남, 예상 22분" 확인).
- **관전·재접속**: §3.3. 인게임 관전 입장, 플레이어 재접속, 탈락 후 관전 모두 정상이다. GAME_OVER 입장은 J-2, 관전자 새로고침은 m-2.

### 3.7 게임 종료: 조건부(J-1·J-2·m-1)
- 실제 ws 3판의 결과는 A(M10 NORMAL) timeout t9600, B(S7 EASY) **threshold t7252**, C(L12 HARD) timeout t9600이었다. 헤드리스 5판은 threshold 2, timeout 3이었다.
- 순서를 확인했다. `game_over.finalTick`은 마지막 delta tick과 같았고, `game_over` 뒤에는 `room_state(GAME_OVER)`만 왔다(`afterGameOver` 0, 순서 위반 0).
- 종료 오버레이 → "로비로" → 빠른 시작이 정상 동작했다. 단, 60초가 지나면 `NOT_IN_ROOM` 토스트가 뜬다(m-1).

### 3.8 공식 맵 썸네일: 통과(설계 리스크 m-7·m-8)
- 번들 데이터는 `server/maps/official/*.json` 그 자체다(빌드 시 glob). 현재 커밋에서 서버 카탈로그 9장과 id·지형·육지 수가 같다.
- 서버 목록에 있는데 번들에 없는 id는 "미리보기 없음"으로 처리한다(`Lobby.tsx:118-129`). 반대 경우(번들에만 있는 id)는 목록이 서버 `officialMaps`에서 오므로 보이지 않는다.

### 3.9 시각 확인(Claude 내장 브라우저)
- 패널이 숨겨진 상태였지만 스크린샷은 동작했다. 서버 8080과 클라이언트 5173을 `.claude/launch.json`으로 띄웠고, 1280×800 에뮬레이션은 800×500으로 축소돼 캡처됐다.
- **눈으로 확인한 것**
  - 로비 방 만들기 패널(공식 S-01 썸네일: 지형·스폰·기지)
  - 비공개 대기실(설정 요약, 추천 경고 + 예상 22분, 썸네일, 방장 설정)
  - 인게임 HUD 배치(병력/상한, 골드 `+n/초`, 타일·점유율·깃발 n/3·승리 기준·남은 시간, 테크·외교·색각·도움말 버튼). 800×500에서 겹침 없음.
  - 순위표, 미니맵, 커맨드 바(비율 70%·100% 반영)
  - 커서 예고(붉은 점선 원 + 툴팁 "검병 121 · 공격 태세 · 중립 방향으로 밀어붙임 · 대상 5타일")
  - 행군 깃발 라벨 "202 · 25초"(ETA)와 앵커 점선, 이벤트 피드("깃발 종료: 병력 소진")
  - **색각 보조**(C): 플레이어별 무늬(빗금·격자·점), 깃발과 순위표의 번호 배지
  - 전체 보기(0)에서 남의 깃발 축소 라벨(LOD)
  - 콘솔 오류 0, 개발 모드 reconStats full 11회 불일치 0
- **확인하지 못한 것**
  - **진척도 방향 그라데이션이 차오르는 중간 상태.** 내 깃발은 중립 칸을 매우 빨리 먹고 소진돼서 캡처하지 못했다. 대상 칸 테두리만 확인했다.
  - **감소 회색 깜빡임과 ▼.** 실제 감소가 일어난 장면을 만들지 못했다. 오탐은 m-3에서 수치로만 확인했다.
  - 교전 맥동 링, 패주 회색 점선, 이탈 대기 호, 기지 체력 바의 감소
  - 모바일 375×812 레이아웃(이번에 재확인하지 않음 — `03` §6 2차 검증 기록만 있음)
  - 실제 32분 판의 종료 오버레이 화면(헤드리스로 상태와 순서만 확인)
  - 800×500에서 이벤트 피드가 좌하단 맵(수도 라벨)과 미니맵 바로 위를 덮는 점(기능 문제 아님, 배치 판단 필요)

## 4. 검증 스크립트와 실제 출력 요약

| 스크립트(커밋 안 함) | 내용 | 결과 |
|---|---|---|
| `client/scripts/qa-recon-full.ts [i\|all]` / `QA_ALLY=1` | 헤드리스 전체 판 5개 → JSON 왕복 → `ClientStore.onMessage`. 재접속·중간 입장·room_state를 흉내 내고, 클라이언트 계산과 서버 함수를 비교하고, ETA 오차를 잰다. 동맹·Lockout 시나리오 포함. | 5판 17초, store 56, full 11,222, 불일치 0, 미처리 이벤트 0, 계산 불일치 0, 순서 0, 피드 예외 0. 동맹: lockout countdown/dissolved, broken lockout/cooldown, closed declined/expired/formed, ack MIN_DURATION·ALLY_FROZEN. |
| `client/scripts/qa-e2e-full.ts` (`QA_OUT=…`) | 인프로세스 ws 서버 + 실제 `ClientStore` 10개, 4룸을 32분 실시간으로 진행. 로비 오류, 재번호, 공개 자동 시작, 끊김 → 인계 → 재접속, 관전·새로고침, 종료 후 관전·퇴장·재입장. | 1,995초. 예외 0, 전 store 불일치 0, ack 누락 0, 순서·종료 후 메시지 0. ivan `gotGameOver:false`(J-2), `NOT_IN_ROOM` 3건(m-1), carol 새로고침 → 로비(m-2). |
| `client/scripts/qa-decay-flash.ts` | 렌더러 감소 판정 규칙을 실제 진척 변화와 비교 | 판정 12 / 오탐 12(m-3) |
| `client/scripts/qa-pacing-preset.ts` | 공식 맵 판 길이 추정, 클라이언트(번들) == 서버 | 252조합 불일치 0 |
| 기존 | typecheck / `npm test` / smoke / qa:ws / qa:headless 777 M 10 HARD 1 / headless-check 75 | 통과 / 152 통과 / PASSED / 73/73 / 위반 0 / full 14 불일치 0 |

- GDD ↔ 서버 규칙은 직전 백엔드 QA(§3.5, tick 순서·threshold·대표 전투·진척 감소·동맹)를 그대로 인용한다.
- 그 뒤 서버 변경(`cf1f438..f3935f4`: 7 파일 +56/−16)은 QA 후속 수정(I-1·I-2·m-1·m-5~m-10)과 `autoStartMs` 추가다.
  - `qa:scenarios`를 다시 돌렸다: **84/85 통과**. I-2(귀환 중 교전 깃발의 회수·재지정)는 이제 통과한다. 남은 실패 1건은 GDD 예시 수치 문제 m-13(GDD 담당, 서버 결함 아님)이다.
  - I-1(`flag_posture_changed.targetOwnerId`)은 재구성 불일치 0으로 확인했다.
