# civwar.io 백엔드 프로토콜 · 구현 문서 (Phase 3 3차-1 — GDD v4.1)

> **프론트엔드의 유일한 신뢰 소스.** 서버가 실제로 보내는 메시지와 이 문서가 다르면 버그다.
> 기준: **GDD v4.1 (사용자 승인 2026-10-09)** — v4.0 부록 A 재조정값 + v4.1 A-40~A-50. 타입 원본: `shared/src/protocol.ts`, 상수 원본: `shared/src/constants.ts`.
> 작성: 2026-10-08, multiplayer-backend-engineer. 프로토콜 버전 `PROTOCOL_VERSION = 1`.
> **2차 갱신(2026-10-08)**: 깃발·게이지·깃발 전투·태세·ZOC·상륙·기지 체력·동맹 구현. 1차 메시지·필드는 **하나도 바꾸지 않고 추가만** 했다(§12 변경 요약).
> **3차-1 갱신(2026-10-09, GDD v4.1 승인본)**: 게이지 되돌리기 폐지 → 진척도 자동 감소(7c), 방 설정(맵 크기 S/M/L·공식 프리셋 맵·최대 인원 2~12·봇 수·봇 난이도), 프리셋 맵 로더·내보내기 스크립트. **제거·의미 변경이 있다 → §14 를 먼저 읽을 것.** 봇 AI 로직 자체는 3차-2.

---

## 0. 범위 요약 (1차 + 2차)

| 구분 | 상태 |
|---|---|
| 골격·빌드·테스트·실행 스크립트 | ✅ |
| `shared/constants.ts` (부록 A 전부, permille 정수) | ✅ |
| 토폴로지 추상화 (`Topology` / `MapGraph` + 사각 구현) | ✅ |
| 맵 생성 (mulberry32, 육지/물 → 지형 → 스폰·기지(v2.1 placeBases) → 물 분할, I1~I4 assert, seed+1 재생성) | ✅ |
| 룸/로비 (방 코드·공개 대기열·8~12인·봇 슬롯·관전·재접속) | ✅ |
| tick 루프 (GDD 7.4 14단계 함수 분리, Phase A/B 타입 분리) | ✅ 골격 |
| 실제 동작: 병력 재생·골드 수입·테크 구매·기지 체력 회복·탈락·승리 판정·하드 타임아웃·종반 러시 신호·threshold_update·`snapshot_full`/`snapshot_delta` | ✅ |
| 깃발 발령·재지정·회수·태세 전환 (4.3/4.3a/4.4) | ✅ 2차 |
| 이동: 가중 Dijkstra 거리장, 얕은 물·기동 테크, 노출 소모, 도착 판정(A-29), ZOC·대치(A-30) | ✅ 2차 |
| 게이지: front/guard, selectTarget sticky, AP 예산, tileCost, 게이지 레이스, STALLED, 주둔 유지비 | ✅ 2차 |
| **v4.1**: 되돌리기·방어 배분·DEFEND 지출 **삭제**, 진척도 자동 감소(7c, `flag_progress_lost cause:"decayed"`), 정체 재정의, `threatened` 재정의(A-43) | ✅ 3차-1 |
| **v4.1 방 설정**: `lobby_create_private` 확장·`lobby_update_settings`·`room_state.settings`·`welcome.officialMaps`·오류 3종, 크기 프리셋 S/M/L, 공식 프리셋 맵 로더(+checksum), `export-map.ts` | ✅ 3차-1 |
| **v4.1 봇 난이도**: `BOT_DIFFICULTY` 값 세트, 플레이어(봇 자리)별 저장, 봇별 결정 주기 | ✅ 3차-1 (로직은 3차-2) |
| 깃발 대 깃발 전투 (4.15 a~i): 무리·편·L·T·실효값·역수 배분·패주·이탈 대기·breakaway·상륙 | ✅ 2차 |
| 기지 체력 전투·함락 (4.12), 탈락 시 깃발·동맹 소멸 (4.14) | ✅ 2차 |
| 동맹 (6.2): 제안·수락·상호 제안·파기·백스탭 쿨다운·cutoff·Lockout | ✅ 2차 |
| 병력 회계 불변식 (4.8) — 서버 장부 `state.ledger` + 매 tick 테스트 | ✅ 2차 |
| 봇 AI (8장) | ⛔ 3차-2 (아무것도 안 하는 `IdleBot`, 난이도 레버는 `decide(…, params)`로 전달됨) |

**`NOT_IMPLEMENTED` 거절은 2차에서 소멸했다**(타입에는 호환용으로 남김, 서버는 송신하지 않음).

---

## 1. 프로젝트 구조와 실행법

### 1.1 선택과 근거

| 항목 | 선택 | 근거 |
|---|---|---|
| 런타임 | Node.js 22 + TypeScript 5 (ESM) | 지정 스택 |
| WebSocket | `ws` 8 | 지정. 의존성 최소 |
| 패키지 매니저 / 모노레포 | **npm workspaces** (`shared`, `server`; 프론트는 `client`로 추가 예정) | 별도 도구(pnpm/turbo) 설치 없이 Windows에서 바로 동작. `@civwar/shared`를 양쪽이 같은 소스로 import |
| shared 배포 방식 | **빌드 없이 TS 소스 직접 export** (`"exports": "./src/index.ts"`) | tsx(서버)·vitest·Vite(클라이언트) 모두 TS를 직접 해석 → 빌드 단계·dist 동기화 문제 제거 |
| 실행기 | `tsx` | 컴파일 없이 TS 실행, watch 지원. 프로덕션 번들링은 추후 |
| 테스트 | **vitest** 2 | TS 무설정, 빠름, Vite와 같은 생태계라 클라이언트도 재사용 가능 |
| 타입체크 | `tsc --noEmit` | 빌드 산출물 불필요 |

### 1.2 디렉터리

```
civwar.io/
  package.json            # workspaces + 루트 스크립트
  tsconfig.base.json
  vitest.config.ts        # server/test, shared/test
  shared/src/
    constants.ts          # 밸런스 상수 단일 소스 (부록 A)
    protocol.ts           # 모든 C→S / S→C 메시지 타입
    terrain.ts            # isClaimable (게임 로직 유일 지형 판정)
    rle.ts                # rleEncode / rleDecode
  server/src/
    index.ts              # 진입점 (PORT, CIVWAR_SEED)
    net/server.ts         # ws 서버, hello/라우팅
    net/validate.ts       # 메시지 형식 검증
    room/lobby.ts         # 세션·룸 인덱스, 공개 대기열, 방 코드
    room/room.ts          # 룸 생명주기, tick 타이머, 송신
    room/session.ts
    topology/topology.ts  # Topology / MapGraph 인터페이스
    topology/square.ts    # 사각 구현 (row*width+col, 맨해튼은 여기만), isPassable, TerrainGraph
    map/rng.ts            # mulberry32
    map/generate.ts       # 맵 생성 + 불변식. v4.1: generateMap(seed, W, H, N, cfg) / generateMapForSize / generateMapForPlayers(테스트용)
    map/presets.ts        # v4.1: 공식 프리셋 맵 스키마 검증·checksum·MapCatalog·mapFromPreset·presetFromMap
    room/settings.ts      # v4.1: 방 설정 검증(applyRoomOptions)·room_state.settings 에코·pacingNote
    game/state.ts         # GameState / PlayerState / Flag(4.2 전 필드) / BaseState, setTileOwner
    game/economy.ts       # troopCap, regen, gold, flagCap, techCost, (upkeep 자리)
    game/victory.ts       # thresholdScaled, judgeVictory
    game/commands.ts      # 1단계 입력 큐 드레인·명령 라우팅
    game/flagops.ts       # 2차: 발령·재지정·회수·태세 전환, applyPosture/beginReturn/removeFlag
    game/rules.ts         # front/guard/threatened(v4.1)/selectTarget/tileCost/속도/거리장(Dijkstra)/recallTarget — 순수 함수
    game/movement.ts      # 2차: 4단계 이동·ZOC·노출 소모·도착·귀환
    game/combat.ts        # 2차: 4a/4b 깃발 대 깃발 전투
    game/gauge.ts         # 5·6·7(게이지·기지)·7c(v4.1 진척도 감소)·9(calmTicks)·10(종료 판정)
    game/alliance.ts      # 2차: 동맹 명령·3단계 외교 타이머·Lockout
    game/tick.ts          # 14단계 함수 + Simulation
    game/snapshot.ts      # match_config / map_init / snapshot_full / DeltaTracker
  server/test/*.test.ts   # vitest
  server/scripts/smoke.ts # 실제 WS 스모크
  server/scripts/duels.ts # 4.15 대표 전투 표 재현 출력 (npx tsx server/scripts/duels.ts)
  server/scripts/mapstats.ts
  server/scripts/export-map.ts  # v4.1: 생성기 → 프리셋 JSON (공식 맵 후보 대량 생성)
  server/scripts/expand8.ts     # v4.1: 8인 5분 확장 체크 (탐욕 확장 봇)
  server/maps/official/         # v4.1: 공식 프리셋 맵 (<id>.json). 지금은 비어 있음(.gitkeep)
  server/maps/candidates/       # export-map.ts 기본 출력 (gitignore)
  server/test/fixtures/maps/sample-m-01.json  # 로더 테스트용 예시 (export-map --size M --seed 20261009)
```

### 1.3 명령 (루트에서, Windows/macOS/Linux 공통)

```
npm install
npm test                 # vitest 전체 (7 파일 / 110 tests)
npm run typecheck        # shared + server tsc --noEmit
npm run start:server     # ws://localhost:8080  (PORT 환경변수로 변경)
npm run dev:server       # tsx watch
npm run smoke            # 임시 포트로 서버 기동 → 클라이언트 3개로 전체 흐름 검증
```

환경변수: `PORT`(기본 8080), `CIVWAR_SEED`(정수 — 지정 시 룸마다 seed, seed+1, … 순으로 맵 시드 고정. 재현·디버그용).
**서버 기동 시 `server/maps/official/*.json` 을 로드한다. 형식 오류·checksum 불일치가 있으면 기동 실패(예외)** — GDD 2.8(f).

공식 맵 후보 만들기 (v4.1):
```
npx tsx server/scripts/export-map.ts --size M --seed 123 --id official-m-01 --name-ko "쌍둥이 만" --name-en "Twin Bays"
npx tsx server/scripts/export-map.ts --size S --seed 1000 --count 50          # → server/maps/candidates/cand-s-1000.json …
   옵션: --water BORDER_ONLY | SHALLOW_QUOTA:<0..1000>, --out DIR (레포 루트 기준)
   출력 한 줄 요약: seed / 실제 사용 seed / 육지 / 기지 / 스폰 최소 간격 / 앞 2개 스폰 간격
채택: 파일을 server/maps/official/<id>.json 으로 옮기고 파일 안 id 를 파일명과 같게(checksum 은 terrain+spawns+bases 만 덮으므로 id·name 수정 무방)
npx tsx server/scripts/expand8.ts [seed] [default|S|M|L]                       # 8인 5분 확장 체크
```

---

## 2. 전송 규칙

- 텍스트 프레임 1개 = JSON 객체 1개. 모든 메시지에 `type` 문자열. 바이너리 프레임은 거절(`error BAD_MESSAGE`). 최대 페이로드 4 KB(C→S).
- 정수 필드: `tileId`, `playerId`(1..12, 0 = NEUTRAL), `flagId`, `tick`, `clientSeq`. 서버 내부 병력·골드는 milli 정수이며 **전송값 `troops`/`gold`는 `floor(milli/1000)`**.
- `thresholdPct`는 **표시용 실수**(예 `58.5`). 판정은 서버 정수식(§8).
- **RLE**: `[value, runLength, value, runLength, …]` 평탄 배열. tileId 오름차순. 디코드는 `shared`의 `rleDecode(rle, width*height)`.
- **타일 좌표**: `match_config.topology == "square"`일 때 `tileId = row * width + col`. 이 변환은 클라이언트 렌더 모듈 한 곳에만 둘 것(구현 제약).
- 지형 값: `0=DEEP 1=PLAIN 2=FERTILE 3=HILLS 4=DESERT 5=MOUNTAIN 6=SHALLOW`. 점령 가능 = `isClaimable`(0·6 제외).
- 시야 전체 공개: 모든 게임 상태 메시지는 룸 전원(관전자 포함)에게 동일. 개인 메시지는 `welcome`, `cmd_ack`, `error`, `pong`, 그리고 입장·재접속 시 1회 부트스트랩(`room_state` + `match_config` + `map_init` + `snapshot_full`)뿐.

---

## 3. 연결·룸 생명주기

```
연결 → hello → welcome → (lobby_join_public | lobby_create_private | lobby_join_private | lobby_spectate)
룸: LOBBY → COUNTDOWN(3초) → IN_GAME → GAME_OVER(60초 후 룸 정리)
```

| 규칙 | 값 / 동작 | 출처 |
|---|---|---|
| 인원 (v4.1) | 방 설정 `maxPlayers` 2..min(12, 맵 최대 인원). 정원 = `maxPlayers`(사람). 맵 격자는 크기 프리셋(S 72×42 / M 100×60 / L 108×66) 또는 프리셋 파일이 정한다 — 인원 lookup 없음 | GDD 2.8 |
| 시작 인원 N (v4.1) | 공개 룸: `maxPlayers`(빈자리 봇). 비공개: 사람 H + `min(botCount, maxPlayers − H)`. N < 2(프리셋은 `max(2, players.min)`) → `error NOT_ENOUGH_PLAYERS`, LOBBY 유지 | GDD 2.8 a·d |
| playerId 배정 | **룸 입장 시** 비어 있는 가장 작은 번호. **v4.1: 비공개 방은 카운트다운 시작 때 사람을 기존 번호 순서대로 1..H 로 다시 매기고**(빈 번호 제거) 봇을 H+1..N 에 붙인다(`"BOT n"`). 공개 룸은 1..10 빈 번호를 봇으로 채운다 | 백엔드 결정 |
| 스폰 | `spawn[k]` → `playerId k+1`. 무작위 = 생성기 배치 순서, 프리셋 = `spawnSets[N]` 또는 `spawns[0..N-1]` | 백엔드 결정 / GDD 2.8 f |
| 방장 | 첫 입장자. 퇴장 시 남은 인간 중 playerId 최소 | GDD 7.2 |
| 카운트다운 시작 조건 (v4.1) | **비공개: 방장 `lobby_start_now` 만.** 공개: 정원(10) 도달 또는 첫 입장 후 30초(`PUBLIC_LOBBY_AUTOSTART_MS`). **`ready` 는 표시용**(자동 시작 조건 아님 — v4.0 의 "인간 전원 ready"·비공개 "정원 도달" 자동 시작 폐지) | GDD 2.8 h |
| 카운트다운 | `LOBBY_COUNTDOWN_MS = 3000`. 이 동안 신규 입장 불가(`ROOM_IN_PROGRESS`). 퇴장 시 그 자리는 봇. **맵은 카운트다운 종료 시점(인원 확정 후)에 생성** | 사용자 승인 (GDD 2.8 h, c) |
| 공개 룸 | 무작위·보통(M)·기본 물·10인·NORMAL 봇 충원. 옵션 받지 않음(`lobby_update_settings` → `BAD_ROOM_OPTIONS`) | 사용자 승인 (GDD 2.8 h) |
| 방 코드 | 6자, `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. 대소문자 무시. 공개 룸도 코드를 가진다(관전용) | GDD 7.2 + 결정 |
| 로비에서 소켓 끊김 | 즉시 퇴장 처리 | 결정 |
| 인게임 소켓 끊김 | 자리 유지, `connected=false`. `DISCONNECT_GRACE_TICK = 450`(90초) 초과 시 `bot_takeover` | GDD 7.1 |
| 재접속 | `hello.playerToken`으로 같은 세션 복구 → `welcome.resumed=true` + 부트스트랩 + 룸에 `player_reconnected`. **봇 인계 후 복귀해도 조종권을 돌려준다** | 토큰 방식·복귀 규칙 **임의 결정** |
| 관전 | `lobby_spectate` (IN_GAME/GAME_OVER 룸). 탈락자는 같은 룸에서 그대로 수신(`ELIMINATED_SPECTATING`) | GDD 4.14 + 결정 |
| 진행 중 게임의 생존자 | 다른 룸 입장 불가(`ALREADY_IN_ROOM`) — 먼저 `lobby_leave` | 결정 |
| 인게임 `lobby_leave` | 자리는 끊긴 상태로 남음(봇 인계 타이머 진행), 세션은 룸에서 분리 → 재접속 불가 | 결정 |
| 계정·DB | 없음. 익명 닉네임 1~16자(제어문자 제거·trim) | 지정 |

---

## 4. Client → Server

공통: `hello` 이전의 모든 메시지 → `error NOT_HELLO`. 형식 오류 → `cmd_*`면 `cmd_ack {accepted:false, reason:"BAD_REQUEST"}`, 그 외 `error BAD_MESSAGE`.
**모든 `cmd_*`는 반드시 `cmd_ack` 1회**(다음 tick 1단계에서 처리 후 송신. 형식 오류·룸 없음·rate limit은 즉시).

### hello
```json
{ "type": "hello", "nickname": "alice", "clientVersion": 1, "playerToken": "선택 — 재접속 시" }
```
→ `welcome`. 버전 불일치 `BAD_VERSION`, 닉네임 불량 `BAD_NICKNAME`, 같은 소켓 두 번째 `ALREADY_HELLO`. 다른 소켓이 같은 토큰을 쓰고 있으면 기존 소켓을 닫고(close 4000) 새 소켓이 이어받는다.

### lobby_join_public
```json
{ "type": "lobby_join_public" }
```
→ 가장 오래된 LOBBY 상태 공개 룸(빈자리 있음), 없으면 생성 → `room_state` 브로드캐스트.

### lobby_create_private (v4.1 확장 — GDD 7.2a)
```jsonc
{ "type": "lobby_create_private",
  "map": { "kind": "random", "size": "M", "water": { "waterMode": "BORDER_ONLY", "shallowPermille": 1000 } },
         // 또는 { "kind": "preset", "mapId": "official-m-01" }   (preset 이면 water 없음 — 지형이 파일에 고정)
  "maxPlayers": 10,            // 2 .. min(12, 맵 최대 인원)
  "botCount": 0,               // 0 .. maxPlayers − 1. 시작 시 maxPlayers − 사람 수로 다시 클램프
  "botDifficulty": "NORMAL",   // EASY | NORMAL | HARD
  "timeLimitMin": 30 }         // 수신·무시 (정수가 아니면 error BAD_MESSAGE)
```
- **모든 필드 생략 가능** → 기본값: `map = random/M/기본 물(BORDER_ONLY, 1000)`, `maxPlayers 10`, `botCount 0`, `botDifficulty NORMAL`. `map.kind:"random"`에서 `size` 생략 = `"M"`, `water` 생략 = 기본 물, `water.shallowPermille` 생략 = 1000.
- `maxPlayers` 생략 + 고른 맵 최대가 10 미만(작음 7) → 맵 최대로 낮춘다. **명시한 값이 맵 최대를 넘으면 거절.**
- **구 `targetPlayers`(v4.0)**: `maxPlayers`가 없을 때만 `maxPlayers`로 읽는다(범위 2..12, 이번 버전 한정 호환 — 다음 버전에서 제거). `lobby_update_settings`에서는 받지 않는다.
- 검증 실패 → `error` (방을 만들지 않음, 기존 방 유지): 타입·범위 위반·`size ∉ {S,M,L}`·`maxPlayers > 맵 최대` → `BAD_ROOM_OPTIONS`, 없는 `mapId` → `MAP_NOT_FOUND`. `message`에 사유 문자열.
- 성공 → `room_state`(설정 에코 `settings` 포함).

### lobby_update_settings (v4.1 신설 — 방장, LOBBY 중)
```json
{ "type": "lobby_update_settings", "botCount": 3, "botDifficulty": "HARD" }
```
`lobby_create_private`와 같은 필드의 **부분집합**(생략 = 현재값 유지). 검증 규칙 동일 + `maxPlayers < 현재 사람 수` → `BAD_ROOM_OPTIONS`. `botCount` 생략인데 새 `maxPlayers − 1`보다 크면 낮춘다.
오류: `NOT_IN_ROOM` / `NOT_HOST` / `NOT_LOBBY` / 공개 룸 → `BAD_ROOM_OPTIONS` / `MAP_NOT_FOUND`. 성공 → 룸 전원에 `room_state`.

### lobby_join_private / lobby_spectate
```json
{ "type": "lobby_join_private", "roomCode": "DFV7MV" }
{ "type": "lobby_spectate", "roomCode": "DFV7MV" }
```
오류: `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_IN_PROGRESS`(join), `NOT_LOBBY`(spectate인데 게임 전), `ALREADY_IN_ROOM`. `lobby_spectate`는 **백엔드 추가 메시지**.

### lobby_leave / lobby_set_ready / lobby_start_now
```json
{ "type": "lobby_leave" }
{ "type": "lobby_set_ready", "ready": true }
{ "type": "lobby_start_now" }
```
오류: `NOT_IN_ROOM`, `NOT_LOBBY`, `NOT_HOST`(start_now), **`NOT_ENOUGH_PLAYERS`**(v4.1, start_now — 사람 + 클램프된 봇 < 2). `ready`는 v4.1부터 표시용.

### cmd_buy_tech — 1차 동작
```json
{ "type": "cmd_buy_tech", "clientSeq": 12, "axis": 1, "tier": 1 }
```
axis `0=MILITARY 1=ECONOMY 2=TERRITORY 3=MOBILITY`, tier 1..3.
검증 순서: 플레이어 존재(`NOT_IN_GAME`) → 생존(`ELIMINATED`) → `tech[axis] == tier-1`(아니면 **`TECH_ORDER`**) → `gold ≥ cost`(`INSUFFICIENT`). 성공 시 골드 차감·즉시 발효 → `cmd_ack accepted` + 룸 `tech_purchased`.
`cost = floor(TECH_BASE_COST[tier-1] × (1000 + 250 × 총구매수) / 1000)`.

### 깃발 명령 (2차 — GDD 4.3 / 4.3a / 4.4 / 4.15 g)

스키마는 GDD 7.2 그대로(1차 문서와 동일). 형식 검증(정수·범위: unit 0..2, posture 0|1, troops 정수, tileId uint32, playerId 1..12)을 통과하면 다음 tick 1단계에서 아래 순서로 검증한다. **성공 시 `cmd_ack`에 `flagId`와 결과 `posture`가 붙는다.**

```json
{ "type": "cmd_flag_issue", "clientSeq": 1, "unit": 2, "troops": 100, "anchorTileId": 1743, "originBaseTileId": null }
→ { "type": "cmd_ack", "clientSeq": 1, "accepted": true, "flagId": 1, "posture": 0 }
{ "type": "cmd_flag_retarget", "clientSeq": 2, "flagId": 7, "anchorTileId": 2500 }
{ "type": "cmd_flag_recall", "clientSeq": 3, "flagId": 7 }
{ "type": "cmd_set_posture", "clientSeq": 4, "flagId": 7, "posture": 1 }
```

| 명령 | 검증 순서 (먼저 걸린 코드 1개 회신) | 효과 |
|---|---|---|
| `cmd_flag_issue` | `ELIMINATED` → `BAD_REQUEST`(tileId 범위 밖·troops 비정수) → `NO_SLOT`(내 깃발 수 ≥ flagCap — 패주 귀환 중인 깃발도 슬롯 점유) → `BAD_UNIT` → `WATER`(DEEP·SHALLOW) → `OUT_OF_RANGE`(내 타일까지 거리 > 40) → `TOO_SMALL`(< 40) → `ALLIED`(앵커 소유자가 ACTIVE/BREAKING 동맹) → `NOT_BASE` / `NOT_OWNED_BASE`(originBaseTileId 지정 시) → `INSUFFICIENT` | 기본 태세: 내 땅 앵커 = DEFEND(`targetOwnerId = 254 ANY_HOSTILE`), 그 외 ATTACK(`targetOwnerId` = 앵커 소유자, 중립 0). 풀 차감 `ceil(troops × UNIT_CONVERT[unit] / MOB_CONVERT[기동 단계])`. 슬롯 = 최소 미사용 번호. 출발 = 지정 기지 / 앵커 최근접 내 기지 / (기지 없음) 수도 최근접 내 타일. → `flag_issued` |
| `cmd_flag_retarget` | `NO_FLAG`(없음·남의 깃발) → `ROUTED` → `RETURNING` → `LOCKED`(재지정 경직 15 tick 중 — **이탈 대기 중이면 허용**) → `BAD_REQUEST` → `WATER` → `ALLIED` → `OUT_OF_RANGE` | 앵커 교체, 기본 태세 재파생(쿨타임 중·전투 중이면 현 태세 유지), `postureManual=false`, `state=MARCHING`, `lockUntilTick = t+15`, 진척도·예산 0. **전투 중이면 이탈 대기 15 tick 개시**. → `flag_retargeted` (+태세가 바뀌면 `flag_posture_changed auto:true`, +전투 중이면 `flag_disengage_started`) |
| `cmd_flag_recall` | `NO_FLAG` → `ROUTED` → `RETURNING` | `state=RETURNING`, 귀환지 = recallTarget. 도착 시 잔여 × 85% 풀 환급. **전투 중이면 이탈 대기**. → `flag_recalled` (+`flag_disengage_started`) |
| `cmd_set_posture` | `NO_FLAG` → `ROUTED` → `DISENGAGING` → `IN_COMBAT` → `SAME_POSTURE` → `POSTURE_COOLDOWN`(`tick < postureCooldownUntilTick`) | 즉시 적용(같은 tick 4a 가 새 태세로 교전 판정), 쿨타임 `t + 25`, 진척도·예산·정체 리셋, `targetOwnerId` 재계산, `postureManual=true`. → `flag_posture_changed auto:false` |

`recallTarget`: ① 출발 타일(아직 내 소유) → ② 내 기지 중 현재 위치 최근접(동률 tileId ASC) → ③ 수도(내 소유면) → ④ 최근접 내 타일. **매 tick 재평가**.

### 동맹 명령 (2차 — GDD 6.2)

```json
{ "type": "cmd_ally_propose", "clientSeq": 5, "targetPlayerId": 3 }
{ "type": "cmd_ally_respond", "clientSeq": 6, "proposalId": 1, "accept": true }
{ "type": "cmd_ally_break", "clientSeq": 7, "allyPlayerId": 3 }
```

| 명령 | 검증 순서 | 효과 |
|---|---|---|
| `cmd_ally_propose` | `BAD_TARGET`(자기·없음·탈락) → `ALLY_CUTOFF`(t ≥ 8400) → `ALLY_FROZEN`(lockout 후 재체결 금지 중) → `ALREADY_ALLIED`(ACTIVE/BREAKING) → `ALLY_LIMIT`(나 또는 상대가 이미 2개 — ACTIVE+BREAKING) → `ALLY_PENDING`(같은 상대에게 유효 제안 있음) | 상대가 나에게 낸 유효 제안이 있으면 **즉시 성립**(`ally_formed`). 아니면 제안 생성(`ally_proposed`, 만료 t+150) |
| `cmd_ally_respond` | `NO_PROPOSAL`(없음·만료·내게 온 것 아님) → (accept=false 면 바로 거절 처리) → `BAD_TARGET`(제안자 탈락) → 위 cutoff/frozen/allied/limit | accept: `ally_formed`. decline: `ally_proposal_closed{reason:"declined"}`. 둘 다 `cmd_ack accepted:true` |
| `cmd_ally_break` | `NOT_ALLIED`(ACTIVE 동맹 아님 — BREAKING 포함) → `MIN_DURATION`(성립 후 300 tick 미만) | `BREAKING`, `breakAtTick = t+150` → `ally_break_started`. 150 tick 뒤 3단계에서 `ally_broken{reason:"cooldown_elapsed"}` |

동맹 성립 시: 상대를 `targetOwnerId`로 둔 **양측 ATTACK 깃발(MARCHING/ENGAGED)** 은 즉시 `IDLE` + 게이지·예산 0 → `flag_idle{reason:"allied"}`. `ANY_HOSTILE` 깃발은 다음 tick selectTarget 이 동맹 타일을 건너뛴다.
**동맹 판정 `isAlly(a,b)` = ACTIVE 또는 BREAKING** — front 대상 제외, 깃발 전투 적대 판정·편 구성, ZOC, 노출 소모(동맹 땅 위 소모 없음)에 모두 같은 함수를 쓴다.

### emote / ping
```json
{ "type": "emote", "code": 3 }
{ "type": "ping", "clientTime": 1728380000000 }
```
emote: IN_GAME 멤버만, 정수 0..`EMOTE_CODE_MAX`(15), 세션당 1초 1회. 위반은 **조용히 무시**. ping → 즉시 `pong`.

### Rate limit
세션당 tick당 `cmd_*` 최대 `MAX_COMMANDS_PER_TICK = 10`. 초과분 즉시 `cmd_ack RATE_LIMITED`.

---

## 5. Server → Client

### welcome (개인)
```json
{ "type": "welcome", "sessionId": "s_3f2a9c1b7e01", "playerToken": "q8...", "serverTick": 0, "protocolVersion": 1, "tickMs": 200, "resumed": false,
  "officialMaps": [{ "id": "official-m-01", "name": { "ko": "쌍둥이 만", "en": "Twin Bays" }, "sizeClass": "M",
                     "players": { "min": 2, "recommendedMin": 8, "recommendedMax": 10, "max": 12 } }] }
```
**v4.1 `officialMaps`**: 공식 프리셋 맵 목록(파일의 메타만, id ASC). 별도 요청 메시지 없음. 지금은 공식 맵 파일이 없어 `[]`.
⚠ GDD의 `playerId` 대신 **`sessionId`**(§10-1). 게임 내 숫자 playerId는 `room_state.players[].playerId`에서 `sessionId`가 일치하는 항목으로 찾는다. `playerToken`은 재접속용으로 보관(localStorage 권장).

### room_state (룸) — 입장·퇴장·준비·카운트다운·게임 시작/종료·접속 변화·탈락·봇 인계 때
```json
{
  "type": "room_state", "roomId": "r1", "roomCode": "DFV7MV", "isPublic": false,
  "phase": "COUNTDOWN", "hostId": 1,
  "settings": { "map": { "kind": "random", "size": "M", "water": { "waterMode": "BORDER_ONLY", "shallowPermille": 1000 } },
                "maxPlayers": 8, "botCount": 6, "botDifficulty": "NORMAL", "mapMaxPlayers": 12, "recommended": [9, 11],
                "pacingNote": "timeout_likely", "expectedPlayers": 8 },
  "players": [
    { "playerId": 1, "sessionId": "s_3f2a…", "nickname": "alice", "isBot": false, "isHost": true, "ready": false, "status": "LOBBY_WAITING" },
    { "playerId": 3, "sessionId": null, "nickname": "BOT 3", "isBot": true, "isHost": false, "ready": true, "status": "LOBBY_WAITING" }
  ],
  "spectatorCount": 0, "countdownMs": 2998
}
```
`phase`: `LOBBY|COUNTDOWN|IN_GAME|GAME_OVER`. `status`: `LOBBY_WAITING|PLAYING|ELIMINATED_SPECTATING|DISCONNECTED`. `countdownMs`는 COUNTDOWN일 때만 숫자, 그 외 `null`. players는 playerId 오름차순.

**v4.1: `targetPlayers` 제거 → `settings.maxPlayers`.** `settings` (항상 존재):
| 필드 | 의미 |
|---|---|
| `map` | 설정 에코. random 이면 `water`를 항상 채워 보낸다(`waterMode` 문자열) |
| `maxPlayers` / `botDifficulty` | 설정값 |
| `botCount` | 비공개 = 설정값(클램프 전). 공개 = 지금 시작하면 넣을 봇 수(`maxPlayers − 사람`) |
| `mapMaxPlayers` | 맵 최대 인원(슬라이더 상한): S 7 / M 12 / L 12 / 프리셋 `players.max` |
| `recommended` | 추천 인원 `[하한, 상한]`: S [5,6] / M [9,11] / L [11,12] / 프리셋 `[recommendedMin, recommendedMax]` |
| `expectedPlayers` | 지금 시작하면 될 인원(공개 = 정원, 비공개 = 사람 + `min(botCount, maxPlayers − 사람)`) |
| `pacingNote` | `"guaranteed"`(무작위·M·기본 물·10인·NORMAL) / `"estimate:<분>"` / `"timeout_likely"`(추정 > 32분). 추정 = `29.4 × (P/390)^0.75`, P = 육지/인원(무작위는 `floor(W×H×0.65)`, 프리셋은 파일 육지 수) — **GDD 2.8(e) 참고값, 보증 아님**. 클라이언트는 `recommended` 밖이면 경고 표시 |

### match_config (룸, 시작 시 1회 / 개인 부트스트랩)
```json
{
  "type": "match_config", "seed": 20261008, "topology": "square",
  "width": 90, "height": 54, "totalLandTiles": 3201, "tickMs": 200, "hardTimeoutTick": 9600,
  "endgameRush": { "tick": 8400, "costMultPermille": 750 },
  "thresholdCurve": { "startPct": 60, "decayStartTick": 4800, "decayPerMinPermille": 1500, "floorPct": 45, "scale": 200 },
  "mapSource": "random", "botDifficulty": "NORMAL",
  "constants": { "TICK_MS": 200, "ENEMY_BASE": 11, "TERRAIN_COST_PERMILLE": [0,1000,1150,1300,800,1700,0], "...": "shared/constants.ts 의 대문자 상수 전부" }
}
```
**v4.1 추가**: `mapSource: "random"|"preset"`, `mapId`(preset 일 때만 존재), `botDifficulty`(방 단위). `seed`는 프리셋이면 파일 `origin.seed`(없으면 0). 크기는 `width`/`height` 그대로 — 클라이언트는 인원으로 격자를 추정하지 말 것.
**v4.1 `constants` 변경**: `DEFENSE_LEVERAGE_PERMILLE`·`UNIT_DEF_PUSH_PERMILLE`·`BOT_DECISION_INTERVAL`·`BOT_RESERVE_RATIO_PERMILLE`·`BOT_MIN_DEFENSE_RATIO_PERMILLE` **삭제**. `PROGRESS_DECAY_MILLI_PER_TICK`(20)·`PROGRESS_HOLD_RANGE`(1)·`MAP_SIZE_PRESETS`·`BOT_DIFFICULTY`·`BOT_DIFFICULTY_DEFAULT`·`ROOM_MAX_PLAYERS_RANGE`·`PUBLIC_ROOM_PLAYERS`·`PUBLIC_ROOM_SIZE` 추가. `MIN_PLAYERS` 8 → **2**. `UNIT_DEF_PERMILLE`(전투 DEF 1300/1000/700)은 그대로.
`constants`는 `shared/constants.ts`의 대문자 export 전부(값 그대로, permille 정수). GDD의 `techTable/costConstants/terrainTable/...` 그룹 분할 대신 **한 객체**로 보낸다(§10-2). 클라이언트는 `@civwar/shared`를 직접 import해도 같은 값이다 — 단, 서버가 보낸 값을 우선한다.

### map_init (룸, 시작 시 1회 / 개인 부트스트랩)
```json
{ "type": "map_init", "terrain": [0,91,6,3,1,2, "..."], "spawns": [{ "playerId": 1, "tileId": 2412, "homeTileId": 2412 }], "bases": [431, 980, "... tileId 오름차순, 2N개"] }
```
`spawns[].tileId == homeTileId`(수도). 기지·지형은 매치 동안 불변.

### snapshot_full (룸: t % 25 == 0, 그리고 시작 tick 0 / 개인: 입장·재접속·관전 시)
```json
{
  "type": "snapshot_full", "tick": 25,
  "owners": [0,512,3,2,0,87,"..."],
  "players": [{ "id": 1, "tiles": 9, "troops": 164, "gold": 200, "goldWeight": 2700, "upkeepPm": 0, "tech": [0,0,0,0], "flagCap": 3, "alive": true, "connected": true }],
  "flags": [],
  "bases": [{ "tileId": 431, "ownerId": 0, "hpPct": 100 }],
  "alliances": [],
  "thresholdPct": 60, "ticksRemaining": 9575, "endgameRushActive": false
}
```
- `players`는 id 오름차순 전원(탈락자 포함).
- `flags[]` 항목 shape (flagId ASC):
  `{ id, ownerId, slotIndex, unit, posture, troops, posTileId, anchorTileId, targetOwnerId, state:"MARCHING|ENGAGED|RETURNING|IDLE", targetTileId|null, progressPct(0..99), stalled, inCombat, routed, blocked, disengaging, postureCooldownUntilTick, disengageUntilTick|null, breakaway }`
  — **2차 추가 필드: `disengageUntilTick`, `breakaway`**. `targetOwnerId` 254 = ANY_HOSTILE(내 땅 앵커 + 공격 태세 = 제자리 반격).
  ```json
  { "id": 1, "ownerId": 1, "slotIndex": 0, "unit": 2, "posture": 0, "troops": 88, "posTileId": 1923, "anchorTileId": 1743,
    "targetOwnerId": 0, "state": "ENGAGED", "targetTileId": 1833, "progressPct": 37, "stalled": false, "inCombat": false,
    "routed": false, "blocked": false, "disengaging": false, "postureCooldownUntilTick": 0, "disengageUntilTick": null, "breakaway": false }
  ```
- `alliances[]` 항목: `{ a, b, state:"ACTIVE|BREAKING", sinceTick, breakAtTick|null }` (a<b, (a,b) ASC).
- **2차 추가 최상위 필드**: `allyProposals: [{ proposalId, fromPlayerId, toPlayerId, expireTick }]`(proposalId ASC), `allianceFreezeUntilTick: number|null`, `lockoutDissolveTick: number|null`.
- `hpPct = floor(hpMilli × 100 / 15000)`.

### snapshot_delta (룸, 매 tick)
```json
{
  "type": "snapshot_delta", "tick": 26,
  "tileChanges": [[2413, 1]],
  "playerDeltas": [],
  "flagMoves": [], "flagStats": [], "flagProgress": [], "flagTargets": [],
  "baseHp": [], "flagsGone": [],
  "thresholdPct": 59.995,
  "flagFlags": [[1, 0, 1, 0]]
}
```
- **모든 배열 필드는 항상 존재**(비어 있을 수 있음). `thresholdPct`만 값이 바뀐 tick에 존재(옵셔널).
- `playerDeltas`: `t % 5 == 0`일 때만, **표시값(`tiles,troops,gold,goldWeight,upkeepPm`)이 마지막 송신 이후 바뀐 플레이어만**. 항목 `{id,tiles,troops,gold,goldWeight,upkeepPm}`.
- `flagMoves [flagId,posTileId]`: posTileId가 바뀐 깃발(매 tick). `flagStats [flagId,troops,state]`: `t % 5 == 0`, 바뀐 것만. `flagProgress [flagId,pct]`: ATTACK 태세 ENGAGED 깃발 전부(매 tick). `flagTargets [flagId,targetTileId|null]`: 바뀐 것만. `baseHp [tileId,hpPct]`: `t % 5 == 0`, 바뀐 기지만. `flagsGone [flagId]`.
- 같은 tick에 `snapshot_delta` → `snapshot_full` 순으로 온다. full을 받으면 그 상태로 덮어쓰면 된다.
- **2차 변경(추가만)**:
  - `flagStats`는 `t % 5 == 0`의 변경분에 더해 **교전 중(`inCombat`) 깃발은 매 tick**, **새 깃발은 첫 tick 즉시** 실린다(GDD 7.3 "교전 깃발은 매 tick 병력 필드").
  - **`flagFlags: [flagId, posture, bits, postureCooldownUntilTick][]`** — 태세·비트·쿨타임 중 하나라도 바뀐 깃발만, 매 tick. 항상 존재(빈 배열 가능).
    `bits` (`shared` 의 `FLAG_BIT`): `IN_COMBAT 1 | ROUTED 2 | BLOCKED 4 | DISENGAGING 8 | BREAKAWAY 16 | STALLED 32`.
  - 새 깃발은 `flag_issued` 이벤트 + 같은 tick 델타의 `flagMoves`/`flagStats`/`flagFlags`(첫 등장)로 알 수 있다. 사라진 깃발은 `flagsGone` + `flag_ended`.

### cmd_ack (개인)
```json
{ "type": "cmd_ack", "clientSeq": 12, "accepted": false, "reason": "INSUFFICIENT" }
{ "type": "cmd_ack", "clientSeq": 13, "accepted": true }
```
`flagId`, `posture`는 깃발 명령(발령·재지정·회수·태세 전환) 성공 시 포함. 동맹 명령 성공은 `{accepted:true}`만.

### error (개인)
```json
{ "type": "error", "code": "ROOM_NOT_FOUND", "message": "ROOM_NOT_FOUND" }
```

### pong (개인)
```json
{ "type": "pong", "clientTime": 1728380000000, "serverTime": 1728380000012, "tick": 3 }
```
`tick`은 소속 룸의 현재 tick(룸 없음·게임 전 0).

### 이벤트 (룸) — 1차에서 실제 송신

| type | 예시 | 시점 |
|---|---|---|
| `tech_purchased` | `{ "type":"tech_purchased","tick":120,"playerId":1,"axis":1,"tier":1,"cost":450,"newFlagCap":3 }` | 구매 성공 tick |
| `threshold_update` | `{ "type":"threshold_update","tick":4800,"thresholdPct":60 }` | t ≥ 4800 이고 (t−4800) % 300 == 0, 바닥(45%) 도달 tick(7800)까지 = 총 11회 |
| `endgame_rush` | `{ "type":"endgame_rush","tick":8400,"costMultPermille":750 }` | t == 8400, 1회. 이후 `snapshot_full.endgameRushActive = true` |
| `player_eliminated` | `{ "type":"player_eliminated","tick":3000,"playerId":4,"byPlayerId":2 }` | tiles == 0. `byPlayerId` = 마지막으로 타일을 가져간 플레이어(없으면 null) |
| `bot_takeover` | `{ "type":"bot_takeover","tick":900,"playerId":2 }` | 끊긴 지 450 tick |
| `player_reconnected` | `{ "type":"player_reconnected","tick":910,"playerId":2 }` | 끊긴 플레이어가 토큰으로 복귀 |
| `emote_broadcast` | `{ "type":"emote_broadcast","tick":77,"playerId":1,"code":3 }` | 수신 즉시(현재 tick 표기) |
| `game_over` | 아래 | 승리 판정 tick. **그 tick의 `snapshot_delta`(+`snapshot_full`) 뒤 마지막 메시지** |

```json
{ "type": "game_over", "finalTick": 9600, "winnerId": 3, "reason": "timeout",
  "standings": [{ "rank": 1, "playerId": 3, "tiles": 9, "troops": 208, "goldEarned": 50, "alive": true }] }
```
`reason`: `last_standing|threshold|timeout`. standings: 생존자(타이브레이커 순) → 탈락자(늦게 탈락한 순). 이후 `room_state(phase:"GAME_OVER")`.

### 이벤트 (룸) — 2차 추가 (전부 실제 송신)

같은 tick 안의 이벤트는 단계 순서(1 명령 → 3 외교 → 4 이동 → 4b 전투 → 7 게이지/기지 → 9 태세 → 10 종료 → 12 탈락)대로 쌓이고, **그 tick 의 `snapshot_delta`보다 먼저** 온다. 클라이언트는 모르는 `type`을 무시할 것(전방 호환). 타입 원본: `shared/src/protocol.ts`의 `S2C_Flag*`/`S2C_Combat*`/`S2C_Ally*`.

| type | 예시 JSON | 시점 |
|---|---|---|
| `flag_issued` | `{"type":"flag_issued","tick":3,"flagId":1,"playerId":1,"slotIndex":0,"unit":2,"posture":0,"troops":100,"originTileId":2103,"anchorTileId":1743,"targetOwnerId":0,"etaTick":32}` | 발령 수락. `etaTick` = 현재 속도로 앵커까지 걸었을 때 도착 tick **추정**(ZOC·전투 무시) |
| `flag_retargeted` | `{"type":"flag_retargeted","tick":40,"flagId":1,"anchorTileId":2500,"targetOwnerId":3,"posture":0,"resumeTick":55,"etaTick":88,"auto":false}` | 재지정 수락(`auto:false`, `resumeTick` = 경직 해제 tick) / 4.5 중립 자동 전환(`auto:true`, 앵커 그대로, `resumeTick = etaTick = tick`) |
| `flag_recalled` ⟵ **백엔드 추가** | `{"type":"flag_recalled","tick":41,"flagId":1,"returnTileId":2103}` | 회수 수락, IDLE 타임아웃(600 tick) 자동 회수 |
| `flag_engaged` | `{"type":"flag_engaged","tick":10,"flagId":1,"posture":0,"frontTileCount":8}` / `{"type":"flag_engaged","tick":12,"flagId":2,"posture":1,"guardTileCount":34}` | MARCHING → ENGAGED. ATTACK 이면 `frontTileCount`만, DEFEND 이면 `guardTileCount`만 |
| `flag_stalled` | `{"type":"flag_stalled","tick":70,"flagId":1,"tileId":1833}` | **v4.1 의미**: ENGAGED·공격 태세·비전투 깃발이 25 tick 연속 한 칸도 못 민(AP 0·타깃 없음·잠긴 기지) 시점 1회. `tileId`는 `targetTileId`(없으면 `null`). 되돌리기 상쇄는 더 이상 없다 |
| `flag_progress_lost` | `{"type":"flag_progress_lost","tick":15,"flagId":2,"tileId":1833,"cause":"decayed"}` | 게이지 레이스 패배(`captured_by_other`) / 진척 > 0 인데 타깃이 바뀜(`target_lost`) / **v4.1 `decayed`: 자동 감소로 0 도달(1회). 이때 깃발의 `targetTileId`는 유지된다(다시 밀면 같은 칸에서 0부터)** |
| `flag_idle` | `{"type":"flag_idle","tick":21,"flagId":1,"reason":"front_cleared","autoRecallTick":621}` | `front_cleared`(공격 front 소멸 · 앵커 도달했는데 front 없음) / `guard_lost` / `allied`. `unreachable`은 송신하지 않음(가중 거리장에 도달 불가 타일이 없음, GDD 4.4) |
| `flag_ended` | `{"type":"flag_ended","tick":90,"flagId":1,"reason":"recalled","refunded":76}` | `recalled`(85% 환급) / `routed_returned`(0) / `exhausted`(0) / `attrited`(0) / `eliminated`(0). `refunded`는 정수 병력 |
| `combat_started` | `{"type":"combat_started","tick":31,"groupKey":4,"flagIds":[4,7],"sides":[{"sideKey":1,"ownerIds":[1],"troops":1000,"power":1000},{"sideKey":2,"ownerIds":[2],"troops":1000,"power":1300}]}` | 무리가 새로 생기거나 기존 무리에 깃발이 합류. `troops`·`power`는 그 tick 손실 적용 **전** 값. `power` = 편 실효값 W(permille) — 교환비 k = W_방어 / W_공격 |
| `combat_ended` | `{"type":"combat_ended","tick":129,"groupKey":4,"winnerSideKey":2,"routedFlagIds":[4]}` | 살아남은(패주·이탈 완료 제외) 편이 1개 이하가 된 tick. 동시 0 이면 `winnerSideKey:null`. 무리가 그냥 해체(상대 소멸·동맹 성립 등)되면 다음 tick 에 `winnerSideKey:null` |
| `flag_routed` | `{"type":"flag_routed","tick":129,"flagId":4,"returnTileId":2103}` | 병력 0 → 자동 귀환. 이후 모든 명령 `ROUTED` |
| `flag_posture_changed` | `{"type":"flag_posture_changed","tick":21,"flagId":1,"posture":1,"cooldownUntilTick":46,"auto":true}` | 수동 전환(`auto:false`) / 재지정에 따른 기본 태세 재파생(`auto:true`) |
| `flag_blocked` / `flag_unblocked` | `{"type":"flag_blocked","tick":5,"flagId":2,"byFlagIds":[1]}` / `{"type":"flag_unblocked","tick":31,"flagId":2}` | 대치(ZOC 정지) 비트가 바뀐 tick (4b 끝). `byFlagIds` = 다음 칸에 ZOC 를 거는 적 방어 태세 깃발 |
| `flag_disengage_started` | `{"type":"flag_disengage_started","tick":2,"flagId":2,"untilTick":17}` | 전투 중 재지정·회수 수락 |
| `flag_disengaged` | `{"type":"flag_disengaged","tick":17,"flagId":2,"reason":"broke_away"}` | `broke_away`(대기 완료 → breakaway) / `combat_over`(대기 중 무리 소멸) |
| `base_captured` | `{"type":"base_captured","tick":3,"tileId":1290,"fromPlayerId":0,"toPlayerId":1,"newHpPct":50}` | 기지 체력 0 → 함락 |
| `ally_proposed` | `{"type":"ally_proposed","tick":1,"proposalId":1,"fromPlayerId":1,"toPlayerId":2,"expireTick":151}` | 제안 생성 |
| `ally_proposal_closed` ⟵ **백엔드 추가** | `{"type":"ally_proposal_closed","tick":2,"proposalId":1,"reason":"formed"}` | `declined` / `expired` / `formed` / `invalidated`(탈락·lockout) |
| `ally_formed` | `{"type":"ally_formed","tick":2,"a":1,"b":2}` | 성립 (a<b) |
| `ally_break_started` | `{"type":"ally_break_started","tick":305,"a":1,"b":2,"byPlayerId":1,"breakAtTick":455}` | 파기 요청 → BREAKING |
| `ally_broken` | `{"type":"ally_broken","tick":455,"a":1,"b":2,"reason":"cooldown_elapsed"}` | `cooldown_elapsed` / `lockout` / `eliminated` |
| `alliance_lockout` | `{"type":"alliance_lockout","tick":3,"phase":"countdown","reason":"all_allied","forceDissolveTick":153,"freezeUntilTick":null}` | `countdown`(조건 성립) / `cancelled`(조건 해소) / `dissolved`(강제 해제, `freezeUntilTick` = 재체결 금지 끝) |

`player_eliminated` 직전에 그 플레이어의 깃발마다 `flag_ended{reason:"eliminated"}`, 동맹마다 `ally_broken{reason:"eliminated"}`가 온다.

## 6. 코드 표

### 6.1 `cmd_ack.reason`

| 코드 | 의미 | 1차 발생 |
|---|---|---|
| `ELIMINATED` | 탈락자 명령 | ✅ |
| `INSUFFICIENT` | 골드/병력 부족 | ✅(테크) |
| `BAD_REQUEST` | 형식 오류 (**백엔드 추가**) | ✅ |
| `NOT_IN_GAME` | 인게임 멤버가 아님 (**추가**) | ✅ |
| `TECH_ORDER` | 선행 단계 미구매 또는 이미 구매 (**추가** — GDD 거절 코드 목록에 테크용이 없음) | ✅ |
| `RATE_LIMITED` | tick당 명령 초과 (**추가**) | ✅ |
| `NOT_IMPLEMENTED` | 1차 미구현 명령 — **2차 소멸(송신 안 함)** | ✗ |
| `NO_SLOT` `BAD_UNIT` `WATER` `ALLIED` `OUT_OF_RANGE` `TOO_SMALL` `NO_FLAG` `RETURNING` `LOCKED` `NOT_BASE` `NOT_OWNED_BASE` `ROUTED` `IN_COMBAT` `DISENGAGING` `POSTURE_COOLDOWN` `SAME_POSTURE` | GDD 7.2/7.3 (§4 표) | ✅ 2차 |
| `BAD_TARGET` `ALLY_LIMIT` `ALLY_CUTOFF` `ALLY_FROZEN` `ALREADY_ALLIED` `ALLY_PENDING` `NO_PROPOSAL` `NOT_ALLIED` `MIN_DURATION` | 동맹 거절 (**백엔드 추가** — GDD 6.2 에 코드 없음) | ✅ 2차 |

### 6.2 `error.code`

`BAD_MESSAGE` `BAD_VERSION` `NOT_HELLO` `ALREADY_HELLO` `BAD_NICKNAME` `BAD_TARGET_PLAYERS`(예약, 미사용) `ROOM_NOT_FOUND` `ROOM_FULL` `ROOM_IN_PROGRESS` `ALREADY_IN_ROOM` `NOT_IN_ROOM` `NOT_HOST` `NOT_LOBBY` `RATE_LIMITED`(예약). 전부 백엔드 정의(GDD는 `{code,message}` shape만 규정).
**v4.1 추가 (GDD 7.2a)**: `BAD_ROOM_OPTIONS`(방 설정 타입·범위 위반, 맵 최대 초과, 사람 수 미만, 공개 룸 설정 변경), `MAP_NOT_FOUND`(공식 맵 목록에 없는 mapId), `NOT_ENOUGH_PLAYERS`(시작 인원 < 2). 이 세 코드의 `message`는 사람이 읽는 사유 문자열이다(코드 문자열과 다를 수 있음).

---

## 7. 맵 생성 (GDD 2.3·2.4 + v2.1 2.6)

- **v4.1** `generateMap(seed, W, H, N, cfg = MAP_GEN_DEFAULT)` — 격자를 인자로 받는다(GDD 2.8 c). 룸은 `generateMapForSize(seed, S|M|L, N, water)`(= `MAP_SIZE_PRESETS`), 테스트·스크립트는 `generateMapForPlayers(seed, N)`(2.3 "인원별 기본 크기" 표, 8~12인). 같은 (seed, W, H, N, cfg)면 v4.0 맵과 비트 단위로 같다(테스트).
- **인원 의존 파라미터 확인(코드)**: 스폰 = 최원점 순차 배치(`placeSpawns(count)` — 간격 상수 없음, 첫 스폰 = 물에서 가장 먼 칸), 기지 = 수도 N + 보로노이 셀당 1개 = 2N(간격·거리 상수는 고정값 + 완화 사다리). 둘 다 N 만 받고 격자 lookup 이 없다 → 격자 직접 입력으로 **수정 없이 동작**. 측정: S×{2,5,7}·M×{2,12}·L×{2,11,12} × 시드 2개 전부 불변식 통과, 재생성 0회.
- mulberry32만, 확률 비교는 정수(`u32 < floor(pm × 2^32 / 1000)`).
- rng 소비 순서: 육지/물 시도들 → 산 blob → 비옥지 blob → 사막 blob → (SHALLOW_QUOTA 모드만) 얕은 물 blob. **물 분할이 맨 뒤라 같은 시드면 BORDER_ONLY/SHALLOW_QUOTA의 육지·스폰·기지가 비트 단위로 같다**(테스트로 확인).
- 불변식 I1(육지 연결) · I2(얕은 물 고립 없음) · I3(BORDER_ONLY: DEEP == 2W+2H−4, 테두리 전부 DEEP / SHALLOW_QUOTA: |SHALLOW| == quotaS) · I4(이동 그래프에서 육지 전부 도달) + 기지 2N·수도 소유 검사. 실패 시 seed+1, 최대 16회(`MAPGEN_MAX_SEED_RETRIES`, 임의). `match_config.seed`는 **실제 사용된 시드**.
- 측정: 8/10/12인 × 시드 40개 = 120맵 재생성 0회, 평균 16 ms/맵.

### 7.1 공식 프리셋 맵 (v4.1 — GDD 2.8 f, A-48)
- 파일: `server/maps/official/<id>.json`, 1맵 1파일, 서버 기동 시 1회 로드(`MapCatalog.loadDir`). 형식은 GDD 2.8(f) 그대로(`schemaVersion 1`, `id`, `name{ko,en}`, `topology "square"`, `width/height`, `sizeClass`, `players{min,recommendedMin,recommendedMax,max}`, `terrain` RLE, `spawns`(길이 = max, 순서 = 우선순위), 선택 `spawnSets`, `bases`, 선택 `origin{generator,seed,genConfig{waterMode:"BORDER_ONLY"|"SHALLOW_QUOTA",shallowPermille}}`, `checksum`).
- **checksum** = `"sha256:" + hex(sha256(UTF-8(JSON.stringify({ terrain, spawns, bases }))))` — 파일 배열 그대로, 키 순서 고정. `spawnSets`·메타는 덮지 않는다.
- 로더 검사 = **형식만**(타입, 2 ≤ min ≤ recMin ≤ recMax ≤ max ≤ 12, RLE 길이 = W×H·값 0..6·run > 0, spawns 길이 = max·서로 다름·육지, bases 서로 다름·육지, spawnSets 키 범위·길이 = N·인덱스 범위, id = 파일명, checksum). 게임 규칙(연결성 등) 검사 없음. 하나라도 틀리면 서버 기동 실패.
- 게임 맵 만들기(`mapFromPreset(file, N)`): N ∈ [max(2, min), max]. 스폰 = `spawnSets[N]` → 없으면 `spawns[0..N-1]`. **기지 = `bases` ∪ 사용 스폰 칸**(쓰지 않는 스폰 칸이 `bases`에 있으면 중립 기지로 남는다 — export 출력은 수도 max 개를 모두 `bases`에 넣는다). 초기 영토 = 사용 스폰마다 3×3 블록의 육지. 지형은 파일 그대로(스폰 블록 산 → 평원 강등은 제작 시 이미 반영).
- 제작: `server/scripts/export-map.ts`(§1.3). 크기 프리셋의 최대 인원으로 생성 → spawns 순서 = 생성기 최원점 순서.

---

## 8. tick 루프 (GDD 7.4)

`TICK_MS = 200`. 룸마다 드리프트 보정 타이머(`loopStart + t × 200ms`). 첫 처리 tick은 `t = 1`(tick 0 = 시작 상태, 시작 시 `snapshot_full tick:0`).

| 단계 | 함수 (`server/src/game/tick.ts`) | 1차 |
|---|---|---|
| 1 입력 큐 드레인 `(recvSeq, connId, clientSeq)` | `stage1_drainInput` | ✅ 테크·깃발·태세·동맹 |
| 2 자원 생산 playerId ASC | `stage2_produce` | ✅ 병력·골드·**주둔 유지비**(직전 tick 상태, 1 tick 지연) |
| 3 외교·시간 타이머 | `stage3_timers` → `allianceTimers` | ✅ 제안 만료·BREAKING→해제·freeze·Lockout + 종반 러시·봇 인계·threshold_update |
| 4 깃발 이동 flagId ASC | `movement.ts` | ✅ 경직·전투 정지·ZOC(tick 시작 위치 스냅숏)·전진·노출 소모·도착·귀환 환급 |
| 4a 깃발 전투 Phase A (읽기 전용 → `FlagCombatPlan`) | `combat.ts` | ✅ |
| 4b 깃발 전투 Phase B flagId ASC | `combat.ts` | ✅ 손실·inCombat·패주·이탈 대기·blocked·combat 이벤트 |
| 5 AP 예산 누적 (ENGAGED ∧ ¬inCombat) | `gauge.ts` | ✅ |
| 6 전투 Phase A (읽기 전용 → `PushPlan`: pushes/baseHits). **v4.1: 방어 배분·`defSpend`·`undo` 삭제, `adv == 0` 은 push 아님** | `gauge.ts` | ✅ |
| 7 전투 Phase B (tileId ASC, flagId ASC). **v4.1: net = adv, DEFEND 지출 삭제, `pushedSet`(tick 로컬) 반환, 안 민 ENGAGED·ATTACK·비전투 깃발 `updateStall(f,0)`(flagId ASC)** | `gauge.ts` | ✅ 게이지·레이스·기지 피해/함락 |
| **7c 진척도 자동 감소 (v4.1)** flagId ASC — `progressMilli > 0 ∧ ∉ pushedSet ∧ ¬holdProgress` 이면 −20(0 클램프), 0 도달 시 `flag_progress_lost{cause:"decayed"}`. `holdProgress` = inCombat ∨ 4a 스냅숏 위치 거리 ≤ 1 에 적대(비동맹) presentEnemy 깃발(¬routed ∧ troops > 0, 상태·태세 무관) | `gauge.ts stage7c_progressDecay` (+ `combat.ts snapshotPresence`, 4a 산출물 `FlagCombatPlan.presence`) | ✅ |
| 8 기지 체력 회복 tileId ASC | `stage8_baseRegen` | ✅ |
| 9 파생 상태 | `gauge.ts stage9_derived` | ✅ calmTicks — v4.1 `threatened`(A-43: inCombat ∨ 관할 원 안 칸을 `targetTileId`로 둔 적 ENGAGED 공격 깃발) 사용. `GARRISON_ESCALATE_MAX = 1` 이라 규칙 영향 없음 |
| 10 깃발 종료 판정 | `gauge.ts stage10_flagEnd` | ✅ front/guard 소멸 → IDLE, 중립 자동 전환, 소진, IDLE 타임아웃 |
| 11 봇 — **v4.1: 봇별 `t % bot.decisionInterval == 0`**(EASY 30 / NORMAL 15 / HARD 10), playerId ASC | `stage11_bots` | ✅ 호출 구조, `IdleBot` |
| 12 탈락 | `stage12_elimination` | ✅ |
| 13 승리 | `stage13_victory` | ✅ |
| 14 브로드캐스트 | `stage14_broadcast` | ✅ |

정수식:
- `troopCap = floor((100 + 12·tiles) × capPm / 1000)`
- `regenMilli = round_half_up( (800 + floor(500 × isqrt(tiles·10⁶) / 1000)) × regenPm × (capMilli − troopsMilli) / (1000 × capMilli) )`, 이후 `troopsMilli = min(troopsMilli + regen, capMilli)`
- `goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹)`, `net = gross − floor(gross × upkeepPm / 1000)`
- `flagCap = min(7, 3 + floor(tiles/300) + MOB_SLOT_BONUS[tier])`
- `thresholdScaled(t) = clamp(12000 − floor(max(0, t−4800) × 1500 × 200 / (1000 × 300)), 9000, 12000)`; 승리 ⇔ `tiles × 100 × 200 ≥ thresholdScaled × totalLandTiles`

2차 정수식 (클라이언트 예측용 — 서버와 같은 값을 내려면 이 순서 그대로):
- `tileCost`: micro(1e-6) 고정소수점 `v`. 중립 `v = (7000 + floor(750 × isqrt(tiles·10⁶) / 1000)) × 1000 → ×TER_NEUTRAL`, 적 `v = 11·10⁶ → ×MIL_DEF(소유자) → ×MIL_ATK(공격자) → ×(1000 + 150·n)`; 공통 `→ ×TERRAIN_COST → ×UNIT_ATK_MULT → ×supply → (러시 중이면 ×750)`. 각 `×pm` 은 `v = floor(v × pm / 1000)`. 결과 `max(4, ceil(v / 10⁶))`. `n` = 이동 그래프 이웃 중 그 타일 소유자와 같은 수. supply = `min(1600, 1000 + 20 × max(0, d − 10))`, d = 공격자 기지까지 최소 거리(기지 없으면 40)
- ~~`defRefCost`~~, ~~`undoPerAP`~~ — **v4.1 삭제**
- 진척도 감소: 밀지 않는 tick 마다 `progressMilli = max(0, progressMilli − 20)` (유지 조건 위 7c). `progressPct = floor(progressMilli / 10)` 그대로
- `availAP = floor(min(spendBudgetMilli, troopsMilli) / 1000)`, 예산 `+initialTroops × 15`/tick, 상한 `initialTroops × 15 × 25`
- `adv = min(floor(AP × 1000 / cost), 2 × UNIT_ASSAULT)`, 지출 `ceil(adv × cost / 1000)`
- `speedMilli = max(1, floor(120 × UNIT_SPEED × MOB_SPEED / (moveCost(pos) × 1000)))`, moveCost = 얕은 물이면 `max(2000, SHALLOW_MOVE_BY_TIER[기동])`, 아니면 `TERRAIN_MOVE`
- 거리장: 목적지에서 역방향 Dijkstra, 간선 가중치 = 들어가는 칸의 moveCost, 키 `(dist, tileId)`. 다음 칸 = 이웃 중 `(dist, tileId)` 최소. 캐시 키 `(목적지, 기동 단계)`
- 노출 소모: 내 땅·동맹 땅이 아니면 `max(1000, floor(troopsMilli × 5 / 10000))`, 물 위면 `max(1000, floor(a × WATER_EXPOSURE[기동] / 1000))`
- 깃발 전투: GDD 4.15 c·d 그대로 (`L`, `T = N_sides × L`, `inv = floor(10⁹ / W)`, 잔여 milli 는 sideKey ASC 로 1씩, 편 내부는 병력 비례 floor + 잔여를 (troopsMilli DESC, flagId ASC) 로 1씩)
- 주둔 유지비: `w = Σ UNIT_GARRISON[unit]` (ENGAGED ∧ 앵커가 내 땅), `drainPm = min(700, floor(max(0, w − 1000) × 90 / 1000))` → `snapshot.players[].upkeepPm`

---

## 9. 테스트·스모크 결과

### 3차-1 (2026-10-09, GDD v4.1)
- `npm run typecheck` 통과. `npm test`: **7 파일 / 110 테스트 통과**.
  - 되돌리기 테스트 → 교체: "거리 2 방어 깃발은 공격 게이지를 막지 못한다 → 점령, 방어 병력 지출 0".
  - 신규 `flags.test.ts` (v4.1 진척도 감소 7종): tick 당 20 감소·0 도달 `decayed` 1회(tick 25)·타깃 유지 / 경계 거리 1 유지·거리 2 감소(방어↔방어 대치) / 동맹 깃발은 유지 근거 아님·패주 깃발은 presentEnemy 아님 / 전투 중 유지 → 상대 패주 tick 도 유지(4a 스냅숏) → 다음 tick 부터 감소 / 패주한 공격 깃발 진척 즉시 0 / AP 0 ENGAGED 깃발 `updateStall(f,0)` → `flag_stalled` + 감소 / `threatened` A-43. 모든 시뮬레이션 테스트는 매 tick 회계 불변식 0 단언 유지. 결정론 해시(400 tick) 통과.
  - 신규 `rooms.test.ts` (17): 프리셋 로더(메타·checksum/id/스키마 위반 거절·없는 디렉터리·N=max 생성기와 비트 동일·N<max 진행+회계·spawnSets) / 방 설정 검증·거절 코드 / 구 targetPlayers 호환 / pacingNote 추정표 / 룸 흐름(에코·방장 전용·재번호·봇 클램프·HARD 봇 결정 주기 10·NOT_ENOUGH_PLAYERS·비공개 자동 시작 없음·프리셋 방 match_config·공개 방 30초 자동 시작 10인).
  - `map.test.ts`: S/M/L × 인원 경계 × 시드 2 불변식(16), v4.0 격자 비트 보존.
- `npm run smoke`: v4.1 로비(`BAD_ROOM_OPTIONS`·`MAP_NOT_FOUND`·settings 에코·`lobby_update_settings`·방장 아닌 변경 거절·botCount 6 → 8인 100×60·`match_config.mapSource/botDifficulty`·v4.1 상수표) + 기존 전 흐름. `SMOKE PASSED`.
- 대표 전투(`duels.ts`) **불변**: 아래 표와 같은 값(113/98/86/78/103/107/103/100/78 tick, 225/404/518/148/87/148/194/523).
- 8인 5분 확장(`expand8.ts`, 90×54, 탐욕 확장 봇 — 풀 ≥ 120 이면 80% 검병 발령): seed 4242 **84~243 타일(평균 163)**, seed 7 105~258(168), seed 99 57~205(144), M 100×60 seed 4242 69~195(150). `decayed` 0회(정상 공격엔 감소 없음). 0.4~0.6 ms/tick.

### 2차 (2026-10-08)

- `npm run typecheck` 통과. `npm test`: **6 파일 / 69 테스트 통과** (1차 49 + 2차 `server/test/flags.test.ts` 20 — 앵커 점령 후 계속 공격 테스트 포함. 1차의 `NOT_IMPLEMENTED` 테스트는 `WATER` 거절로 교체).
- 2차 테스트: 대표 전투 표 6종 재현 · 방어↔방어 무전투 · combat 이벤트 · ZOC 대치 → 공격 전환 다음 tick 전투 · 태세 SAME/쿨타임 25 tick/IN_COMBAT · 이탈 대기(×0.5 손실, broke_away, breakaway 중 재교전 없음) · 패주 깃발 명령 `ROUTED` · 게이지 레이스 flagId 낙찰 · 되돌리기 → 정체 · 실제 명령 경로 발령 → 점령 · 주둔 유지비 90‰ · 기지 함락 · 동맹 제안/수락/IDLE(allied)/MIN_DURATION/ALLIED/BREAKING 해제 · Lockout · **결정론 해시(400 tick, 전투·게이지·점령 포함)**. 깃발이 있는 모든 풀 시뮬레이션 테스트는 **매 tick `ledgerImbalance(state) === 0`** (4.8 회계 불변식: Σ풀 + Σ깃발 + Σ소멸 = 시작 + regen) 을 단언한다.
- 대표 전투 (`npx tsx server/scripts/duels.ts`, 1000 대 1000):

| # | 상황 | 서버 결과 | GDD 4.15 표 |
|---|---|---|---|
| 1 | 검→검 평원 | 113 tick(22.6초) 양쪽 0 | 22.6초 0/0 |
| 2 | 검→창 평원 | 방어 225, 19.6초 | 225, 19.6초 |
| 3 | 검→창 언덕 / 산 | 404 / 518, 17.2 / 15.6초 | 405 / 519 |
| 4 | 기병→검 평원 | 공격 148, 20.6초 | 148 |
| 4' | 기병→창 평원 | 방어 87, 21.4초 | 88 |
| 5 | 조우전 기병↔검 | 기병 148 | 148 |
| 6 | 상륙 검→검 평원 / 검→창 언덕 | 194 / 523 | 195 / 524 |

  ±1 차이는 표시값 `floor(milli/1000)` 절사(GDD 표는 반올림으로 추정). 시간은 전부 일치.
- `npm run smoke`: 1차 흐름 + **물 앵커 `WATER` → 기병 100 발령 수락(flagId 1, ATTACK) → `flag_issued` → `flagMoves` → `flag_engaged`(tick 10) → `flagProgress` 상승 → 중립 점령 `tileChanges [[1923,1]]`(tick 15) → `snapshot_full.flags` 2차 필드 → `SAME_POSTURE` → 동맹 제안·수락 `ally_formed`** → 관전·재접속·tick 속도. `SMOKE PASSED`.
- 성능: 12인 맵, 깃발 ~24개 상시, 3000 tick → 평균 0.36 ms/tick (최대 31 ms — 거리장 신규 생성 tick).

## 10. GDD와 다르게 / GDD에 없어 정한 것

1. **`welcome.playerId` → `welcome.sessionId`(문자열)**. 게임 내 playerId(1..N, owners RLE 값)는 룸 입장 시 배정되므로 hello 시점엔 없다. `room_state.players[].sessionId`로 매칭.
2. **`match_config`의 상수 그룹(`techTable, costConstants, terrainTable, flagConstants, unitTable, defenseConstants, baseHpConstants, supplyConstants, upkeepConstants`) → `constants` 단일 객체**(상수명 = `shared/constants.ts` 이름). 그룹 분류를 서버·클라 양쪽에서 유지할 필요를 없앰. `endgameRush`, `thresholdCurve`, `hardTimeoutTick`은 별도 필드로도 제공.
3. `snapshot_full.flags[]`에 v4.0 비트(`inCombat, routed, blocked, disengaging, postureCooldownUntilTick`)를 1차부터 포함. delta 쪽 비트 전송 방식은 2차에서 확정(필드 추가, 기존 필드 불변).
4. `lobby_create_private.timeLimitMin` **무시**. 페이싱 보증은 `HARD_TIMEOUT_TICK`(9600) 단일 소스에만 있으므로 방별 가변 시간은 GDD 승인 없이 열지 않음.
5. GDD 3.1 표의 "종반 러시 37분 / 하드 타임아웃 42분"과 6.2 "42분"은 **구값**. 부록 A(3단계 2차, [A-38]) `ENDGAME_RUSH_TICK 8400`, `HARD_TIMEOUT_TICK 9600`, `ALLIANCE_CUTOFF_TICK 8400`을 따름. 7.3의 "threshold_update 22분 이후"도 `THRESHOLD_DECAY_START`(16분)로 읽음. → **game-designer에게 본문 정리 요청 필요**.
6. 3.2 병력 재생 `round()` → 정수 half-up 반올림. `√tiles`는 milli 정밀도 `isqrt(tiles × 10⁶)`(Math.sqrt + 정수 보정).
7. 1단계 CA 평활화 중 **테두리를 매 단계 물로 재강제**(경계 밖 이웃 = 물로 세면 테두리 칸도 땅이 될 수 있어 I3 위반 가능).
8. `ringDist`(언덕)는 육지 위 BFS, `waterDist`는 전체 격자 BFS로 해석. 비옥지 후보가 `waterDist 3`까지 확장해도 부족하면 계속 확장(이론상 케이스).
9. 1단계 10회 시도 후에도 육지 비율이 0.60~0.70 밖이면 마지막 결과를 사용(GDD 미규정; 120맵 측정에서 미발생).
10. 종반 러시 발동·봇 인계·threshold_update는 **3단계(타이머)**에서 처리(GDD는 단계 미지정).
11. 봇(11단계)이 낸 명령은 **다음 tick 1단계** 입력 큐로 들어간다(recvSeq 순서, connId 0).
12. `game_over`는 판정 tick의 스냅샷 뒤에 송신(GDD 13→14 순서를 송신 순서로는 뒤집음 — 클라이언트가 최종 상태를 먼저 받도록).
13. 로비 규칙 전부(§3 "임의 결정" 행), 방 코드 알파벳, rate limit, emote 코드 범위 0..15, 닉네임 1..16자.

---

### 2차에서 추가로 정한 것

14. **`undoPerAP` 식 정정**: GDD 4.7(a) `floor(1000·LEV·PUSH / (1000·c))` 는 permille 나눗셈이 하나 빠져 1000배 크다. 손익분기표(λ = 0.9 × 1.3 = 1.17)와 맞도록 `floor(LEV·PUSH / (1000·c))` 사용. → **game-designer 확인 요청**.
15. **tileCost/defRefCost 정수화**: micro 고정소수점, 곱셈마다 floor, 마지막 ceil(§8). 실수 곱과의 차이는 1e-6 미만 절사.
16. **`isAlly` = ACTIVE ∪ BREAKING** 하나로 통일(GDD 는 `isAlly`/`isAllyOrBreaking`을 섞어 씀. 6.2 "쿨다운 동안 서로 공격 불가"에 따라 BREAKING 도 비적대). front 는 `targetOwnerId`가 고정된 경우에도 내 땅·동맹 타일을 항상 제외.
17. **`LOCKED`**: GDD 거절 코드엔 있으나 쓰임이 없어, 재지정 경직(`t < lockUntilTick`) 중 재재지정 거절로 사용. 단 이탈 대기 중엔 허용(4.15 g "대기 중 추가 재지정 허용").
18. **recallTarget ①** "출발 기지"를 "출발 타일(아직 내 소유)"로 읽음(기지 없이 발령한 깃발의 출발지는 기지가 아님). **④ 최근접 내 타일** 폴백 추가(수도 상실 시).
19. ~~기본 태세 자동 재파생~~ → **폐지(사용자 결정, GDD 4.3a 개정)**. 기본 태세는 발령·재지정 때만 정해진다. 공격 깃발은 앵커를 점령한 뒤에도 front 가 빌 때까지 계속 밀고, 비면 기존 IDLE/중립 자동 전환 규칙을 따른다. 9단계는 calmTicks 만 갱신. (`flag_posture_changed auto:true`는 이제 재지정 때만 나온다.)
20. **되돌리기 배분은 GDD 의사코드 그대로**: `pending = adv − undo`(기지는 `dmg − undo`) → 방어는 그 tick 전진량만 상쇄하고(ceil 잔여만큼 소폭 음수 가능) 이미 쌓인 진척도·깎인 기지 체력을 되돌리지는 않는다. 산문("역방향으로 민다")과 다를 수 있어 **확인 요청**.
21. IDLE 공격 깃발은 front 가 다시 생겨도 자동 재교전하지 않는다(4.4 의사코드 그대로: ENGAGED/IDLE 은 이동·도착 판정 없음). 재지정·IDLE 타임아웃(600 tick) 자동 회수로만 빠진다.
22. 소진 판정(< 40)은 GDD 4.11b 대로 **ENGAGED 깃발만**. MARCHING/IDLE/RETURNING 깃발은 40 미만이어도 유지.
23. **3.2 `min(troops + regen, cap)` 그대로** — 회수 환급·영토 상실로 풀이 cap 을 넘으면 다음 tick 잘린다. 장부 `capClamp` 로 기록. GDD 빈칸(환급이 cap 에 잘리는 것이 의도인지) → **확인 요청**.
24. ZOC 는 tick 당 1회, 전진 전에 판정(최고 속도도 tick 당 1칸 미만이라 루프 중 재판정 불필요). 대치 중엔 `moveProgMilli`가 늘지 않는다. `lockUntilTick` 중인 깃발은 노출 소모도 건너뛴다(4.4 `continue` 그대로).
25. 기지가 함락 락(25 tick) 중이면 그 기지를 고른 공격 깃발은 그 tick 아무것도 하지 않는다(지출 0).
26. 편 구성: 동맹 union-find 결과 한 편 안에 적대 쌍이 있으면(비이행 동맹) 그 편 전체를 ownerId 별로 쪼갬 [A-12].
27. 전투 이벤트 추적(`combat_started/ended`)은 무리의 깃발 집합이 겹치면 같은 전투로 본다(규칙에는 영향 없음, 표시 전용).
28. `flag_recalled`, `ally_proposal_closed` **이벤트 추가**, `alliance_lockout.phase`(`countdown|cancelled|dissolved`) 추가, 동맹 거절 코드 9종 추가. GDD 7.3 "v2.1과 동일"인 동맹 이벤트 페이로드는 v2.1 문서가 없어 §5 표대로 확정.
29. 상호 제안 = 즉시 성립, 같은 상대 중복 제안 `ALLY_PENDING`, 동맹 상한은 ACTIVE+BREAKING 합산, 제안은 탈락·lockout 해제 시 `invalidated`.
30. `etaTick` 은 표시용 추정(현재 속도·거리장 따라 앵커까지, ZOC·전투 무시).

> §10-14(undoPerAP 식 정정)·§10-20(되돌리기 배분)은 **v4.1 에서 대상 삭제로 소멸**.

### 3차-1 (GDD v4.1)에서 정한 것

31. **`holdProgress`의 4a 스냅숏 = `stage4a`가 산출하는 `FlagCombatPlan.presence`**(4단계 이동 직후·4b 손실 전 위치/병력). 4b 에서 패주한 적도 그 tick 엔 "주변 적"이다. 대상 깃발 자신의 위치도 스냅숏 값(4a 이후 이동 없음이라 현재와 같음).
32. **기지를 미는 깃발도 `dmg == 0`이면 push 가 아니다**(GDD 의사코드는 `adv == 0` 거름을 일반 push 에만 씀). 또 함락 락(25 tick) 중인 기지를 고른 깃발은 push 없음 → `updateStall(f,0)` 대상이 된다(v4.0 은 아무것도 안 함). 둘 다 "미는 중 아님"의 일관 해석.
33. 7c 는 **모든 깃발**(상태·태세 무관)에 적용 — GDD 표의 IDLE·MARCHING·STALLED 포함. 방어 태세 깃발은 진척도를 가지지 않으므로(태세 전환 시 0) 실질 영향 없음.
34. `flag_stalled.tileId` 는 `targetTileId`(없으면 `null`) — 타입은 v4.0 과 같음.
35. **비공개 방 시작 = 방장 `lobby_start_now` 만**(GDD 2.8 h). v4.0 의 "인간 전원 ready"·"정원 도달" 자동 시작은 비공개 방에서 폐지(`ready` 는 표시용). 공개 방은 정원 도달 또는 30초.
36. **비공개 방 playerId 재번호**: 카운트다운 시작 시 사람을 기존 번호 순서대로 1..H, 봇 H+1..N. 게임 state 가 1..N 연속을 요구하기 때문(스폰 k → playerId k+1). 방장 번호도 따라간다. 로비 중 번호는 임시 값이다.
37. **`maxPlayers` 생략 시 맵 최대로 자동 낮춤**(작음 = 7). 명시 값 초과만 `BAD_ROOM_OPTIONS`(GDD A-47 "맵 최대 초과는 거절").
38. 구 `targetPlayers`: GDD "1회 호환 수신 후 제거"를 **이번 프로토콜 버전 동안 `lobby_create_private`에서만 `maxPlayers` 별칭으로 수용**으로 해석. 범위는 v4.1 기준 2..12.
39. **`room_state.settings` 에 `expectedPlayers` 추가**(GDD 7.2a 에 없음) — pacingNote 가 어떤 인원 기준인지 알리기 위해. `pacingNote` 는 2.8(e) 식, 무작위 크기는 육지 = `floor(W×H×650/1000)`(2.8 b "목표 육지"), 프리셋은 파일 육지 실측. 반올림 = 가장 가까운 정수 분. 부동소수 사용(표시 전용, 시뮬레이션 무관).
40. 공개 룸에서 `lobby_update_settings` → `BAD_ROOM_OPTIONS`(GDD 는 "옵션을 받지 않는다"만 규정, 코드 미정).
41. **프리셋 기지 = `bases` ∪ 사용 스폰**, 사용하지 않는 스폰 칸은 `bases`에 있으면 중립 기지(export 는 수도 max 개를 모두 `bases`에 넣음). 2.8(f) "bases = 중립 기지 칸, 플레이어 수와 무관하게 전부 생성"의 해석.
42. **프리셋 checksum 직렬화 정의**: `JSON.stringify({terrain, spawns, bases})` sha256 hex (GDD "terrain+spawns+bases 직렬화 해시" 의 구체화). spawnSets·메타 미포함 → id·name 수정은 checksum 을 깨지 않는다.
43. 로더는 스폰·기지 칸이 **육지인지**와 RLE 값 범위는 본다(형식 검사로 분류 — 위반 시 게임 루프가 깨지므로). 연결성·기지 간격 등 규칙 검사는 하지 않는다.
44. **봇 난이도 저장 위치**: `PlayerState.botDifficulty` + `PlayerState.bot`(`BOT_DIFFICULTY[난이도]`) — 사람 자리에도 방 난이도를 넣어 `bot_takeover` 가 그대로 쓴다(2.8 g). `BotBrain.decide(state, playerId, t, params)` 4번째 인자로 전달. 값은 permille 정수(`reserveRatioPermille 450/300/200`, `minDefenseRatioPermille 100/250/300`), `fixedUnit` = EASY `1`(SWORD) / 그 외 `null`.
45. `MIN_PLAYERS` 상수 8 → 2 (`ROOM_MAX_PLAYERS_RANGE[0]`). `MAP_SIZE`(8~12인 표)는 "인원별 기본 크기"로 남겨 테스트·스크립트만 쓴다.

---

## 11. 3차(봇) 인계

- 봇은 `BotBrain.decide(state, playerId, t, params)`에서 **일반 `C2S_GameCommand`** 를 돌려주면 된다(다음 tick 1단계, 인간과 같은 검증). `params` = 그 봇의 난이도 레버(`decisionInterval`·`reserveRatioPermille`·`minDefenseRatioPermille`·`fixedUnit`) — 결정 주기 필터는 `stage11_bots`가 이미 한다. 읽기 전용 헬퍼: `rules.ts`(`frontFirst`, `frontCount`, `tileCost`, `guardContains`, `guardCount`, `threatened`, `availAP`, `minDistFromTerritory`, `recallTarget`), `gauge.ts`(`holdProgress`), `combat.ts`(`flagValue`, `combatEligible`, `hostile`), `economy.ts`(`flagCap`, `techCost`), `state.isAlly`. ~~`defRefCost`~~ 삭제.
- **v4.1 8.6.0**: "되돌리기 유지" 분기는 만들 필요 없음 — 위협 시 항상 요격(인접 배치). 전역 `BOT_DECISION_INTERVAL`/`BOT_RESERVE_RATIO_PERMILLE`/`BOT_MIN_DEFENSE_RATIO_PERMILLE` 은 삭제됐으니 `params` 를 쓸 것. 나머지 `BOT_*` 상수는 전역 그대로.
- 테스트 시나리오 참고: `server/scripts/expand8.ts` 의 `Greedy` 가 `BotBrain` 구현 예.
- 8.6.0 규칙(태세·차단·후퇴)이 필요로 하는 상태는 전부 깃발 필드에 있다: `inCombat`, `blocked`, `disengageUntilTick`, `breakaway`, `routed`, `postureCooldownUntilTick`, `stalled`.
- 주의: `etaTicks`/`stepToward`/`getField`는 거리장 캐시(`state.fields`)를 채운다(결과 불변·결정론 무관). 봇에서 써도 되지만 Phase A 코드에선 쓰지 말 것.
- 공격 깃발은 앵커 점령 후에도 front(앵커 반경 6) 가 빌 때까지 계속 민다(§10-19) — 앵커 깊이 제약 없음.

## 12. 2차 프로토콜 변경 요약 (프론트 영향)

| 구분 | 내용 |
|---|---|
| 제거·의미 변경 | **없음** (1차 필드·메시지 그대로) |
| 소멸 | `cmd_ack.reason = NOT_IMPLEMENTED` 송신 중단 |
| C→S | 없음 (스키마 동일, 처리만 구현) |
| `snapshot_full` 추가 | `flags[].disengageUntilTick`, `flags[].breakaway`, `allyProposals[]`, `allianceFreezeUntilTick`, `lockoutDissolveTick` |
| `snapshot_delta` 추가 | `flagFlags[]` (항상 존재). `flagStats` 송신 조건 확대(교전 중 매 tick, 새 깃발 즉시) |
| 새 이벤트 | §5 2차 표 23종(GDD 예약 21종 + `flag_recalled` + `ally_proposal_closed`) |
| `cmd_ack.reason` 추가 | 동맹 9종 (§6.1) |
| 상수 | `match_config.constants`에 `FLAG_BIT` 추가(객체) |

## 13. GDD 모순·빈칸 (game-designer 확인 요청)

1. ~~4.7(a) `undoPerAP` 단위 오류(§10-14).~~ → v4.1 삭제로 소멸.
2. ~~4.7(b) 되돌리기 상쇄 범위(§10-20).~~ → v4.1 삭제로 소멸.
3. ~~페이싱: 앵커 점령 시 자동 방어 전환으로 확장 정체~~ → **해결**(사용자 결정: 재파생 폐지, §10-19). 재측정: 검 1,200 단일 깃발이 중립 앵커(국경 7칸 앞)를 tick 7에 먹고도 계속 밀어 **44타일** 점령 후 소진(GDD 4.6(d) 적 타일 기준 57 — 이 테스트는 보급선 배율이 붙은 중립 비용이라 직접 비교는 근사). 8인 5분 스크립트: 플레이어당 **83~251 타일**(이전 10~19).
4. 3.2 cap 클램프가 회수 환급을 자를 수 있음(§10-23).
5. 동맹 거절 코드·이벤트 페이로드 미정의(§10-28), `isAlly` vs `isAllyOrBreaking` 혼용(§10-16), `LOCKED` 용도 미정의(§10-17).
6. 1차 §10-5 (본문 구값 37/42분) 미해결 유지.

## 14. 3차-1 프로토콜 변경 요약 (GDD v4.1 — 프론트 영향, **제거 포함**)

| 구분 | 내용 |
|---|---|
| **제거** | `room_state.targetPlayers` (→ `settings.maxPlayers`). `match_config.constants` 의 `DEFENSE_LEVERAGE_PERMILLE`, `UNIT_DEF_PUSH_PERMILLE`, `BOT_DECISION_INTERVAL`, `BOT_RESERVE_RATIO_PERMILLE`, `BOT_MIN_DEFENSE_RATIO_PERMILLE`. 게이지 되돌리기 동작 전체(방어 태세 깃발이 범위 안 공격 게이지를 깎던 것, DEFEND 깃발 AP·병력 지출) |
| **의미 변경** | `flag_stalled` = 비전투 공격 깃발이 25 tick 못 민 상태(상쇄 아님). `flagProgress` 값이 **밀지 않는 동안 tick 당 2%p씩 줄어들 수 있다**(주변 거리 ≤ 1 적 깃발·전투 중이면 유지). 비공개 방은 `ready`·정원으로 자동 시작하지 않음(방장 `lobby_start_now` 만). 비공개 방 playerId 는 카운트다운 시작 때 1..N 으로 재번호. `MIN_PLAYERS` 8 → 2 |
| C→S 변경 | `lobby_create_private`: `map`/`maxPlayers`/`botCount`/`botDifficulty` 추가, `targetPlayers` 는 호환 별칭(다음 버전 제거). **신규 `lobby_update_settings`** |
| S→C 추가 | `welcome.officialMaps[]`, `room_state.settings{…}`, `match_config.mapSource`/`mapId?`/`botDifficulty`, `flag_progress_lost.cause = "decayed"` |
| `error.code` 추가 | `BAD_ROOM_OPTIONS`, `MAP_NOT_FOUND`, `NOT_ENOUGH_PLAYERS` |
| 상수 추가 | `PROGRESS_DECAY_MILLI_PER_TICK`, `PROGRESS_HOLD_RANGE`, `MAP_SIZE_PRESETS`, `BOT_DIFFICULTY`, `BOT_DIFFICULTY_DEFAULT`, `ROOM_MAX_PLAYERS_RANGE`, `PUBLIC_ROOM_PLAYERS`, `PUBLIC_ROOM_SIZE` |
| 불변 | 깃발 명령·전투·동맹 메시지, `snapshot_full`/`snapshot_delta` shape, `map_init` shape(격자 크기만 프리셋 따라 72×42 / 100×60 / 108×66 / 파일) |
