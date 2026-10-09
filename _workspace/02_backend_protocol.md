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
| 룸/로비 (방 코드·공개 대기열·2~12인(v4.1)·봇 슬롯·관전·재접속) | ✅ |
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
| 봇 AI (8장 + 8.6/8.6.0 + v4.1 요격, 2.8 g 난이도) — `server/src/game/bot.ts` `CivBot`, 룸·로비 기본 두뇌 | ✅ 3차-2 (§11) |

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
    game/bot.ts           # 3차-2: 봇 AI CivBot / decideBot (무상태·결정론, 일반 C2S_GameCommand 만 반환)
    game/snapshot.ts      # match_config / map_init / snapshot_full / DeltaTracker
  server/test/*.test.ts   # vitest
  server/scripts/smoke.ts # 실제 WS 스모크
  server/scripts/duels.ts # 4.15 대표 전투 표 재현 출력 (npx tsx server/scripts/duels.ts)
  server/scripts/mapstats.ts
  server/scripts/export-map.ts  # v4.1: 생성기 → 프리셋 JSON (공식 맵 후보 대량 생성)
  server/scripts/expand8.ts     # v4.1: 8인 5분 확장 체크 (탐욕 확장 봇)
  server/scripts/selfplay.ts    # 3차-2: 봇 자가대전 (실시간 대기 없음) — 종료 시각·사유·1위 점유율·APM·거절률·tick ms
  server/maps/official/         # v4.1: 공식 프리셋 맵 (<id>.json). 지금은 비어 있음(.gitkeep)
  server/maps/candidates/       # export-map.ts 기본 출력 (gitignore)
  server/test/fixtures/maps/sample-m-01.json  # 로더 테스트용 예시 (export-map --size M --seed 20261009)
```

### 1.3 명령 (루트에서, Windows/macOS/Linux 공통)

```
npm install
npm test                 # vitest 전체 (8 파일 / 122 tests)
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
npm run selfplay -w @civwar/server -- [games=10] [seed0=1000] [S|M|L] [N=10] [NORMAL | HARD1:NORMAL9 | NORMAL1:EASY9 ...]
   # = npx tsx server/scripts/selfplay.ts ...  (난이도 혼합은 판마다 좌석 회전)
   # 진단 전용: CIVWAR_BOT_RESERVE=<permille> CIVWAR_BOT_MINDEF=<permille> 로 난이도 레버 덮어쓰기, CIVWAR_SELFPLAY_LEDGER=1 매 tick 회계 검사
```

---

## 2. 전송 규칙

- 텍스트 프레임 1개 = JSON 객체 1개. 모든 메시지에 `type` 문자열. 바이너리 프레임은 거절(`error BAD_MESSAGE`). 최대 페이로드 4 KB(C→S) — **넘으면 `error` 없이 소켓이 close 1009 로 끊긴다**(ws `maxPayload`). 클라이언트는 재접속(`hello.playerToken`)으로 복구한다.
- 정수 필드: `tileId`, `playerId`(1..12, 0 = NEUTRAL), `flagId`, `tick`, `clientSeq`. 서버 내부 병력·골드는 milli 정수이며 **전송값 `troops`/`gold`는 `floor(milli/1000)`**.
- `thresholdPct`는 **표시용 실수**(예 `58.5`). 판정은 서버 정수식(§8).
- **RLE**: `[value, runLength, value, runLength, …]` 평탄 배열. tileId 오름차순. 디코드는 `shared`의 `rleDecode(rle, width*height)`.
- **타일 좌표**: `match_config.topology == "square"`일 때 `tileId = row * width + col`. 이 변환은 클라이언트 렌더 모듈 한 곳에만 둘 것(구현 제약).
- 지형 값: `0=DEEP 1=PLAIN 2=FERTILE 3=HILLS 4=DESERT 5=MOUNTAIN 6=SHALLOW`. 점령 가능 = `isClaimable`(0·6 제외).
- 시야 전체 공개: 모든 게임 상태 메시지는 룸 전원(관전자 포함)에게 동일. 개인 메시지는 `welcome`, `cmd_ack`, `error`, `pong`, 그리고 입장·재접속 시 1회 부트스트랩(`room_state` + `match_config` + `map_init` + `snapshot_full` + **GAME_OVER 룸이면 `game_over`** — 프론트 QA J-2)뿐.

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
| 카운트다운 시작 조건 (v4.1) | **비공개: 방장 `lobby_start_now` 만.** 공개: 정원(10) 도달 또는 첫 입장 후 30초(`PUBLIC_LOBBY_AUTOSTART_MS`). **공개 룸의 `lobby_start_now` → `error NOT_HOST`**(공개 룸에는 방장 권한이 없다 — QA m-6). **`ready` 는 표시용**(자동 시작 조건 아님 — v4.0 의 "인간 전원 ready"·비공개 "정원 도달" 자동 시작 폐지) | GDD 2.8 h |
| 카운트다운 | `LOBBY_COUNTDOWN_MS = 3000`. 이 동안 신규 입장 불가(`ROOM_IN_PROGRESS`). 퇴장 시 그 자리는 봇. **맵은 카운트다운 종료 시점(인원 확정 후)에 생성** | 사용자 승인 (GDD 2.8 h, c) |
| 공개 룸 | 무작위·보통(M)·기본 물·10인·NORMAL 봇 충원. 옵션 받지 않음(`lobby_update_settings` → `BAD_ROOM_OPTIONS`) | 사용자 승인 (GDD 2.8 h) |
| 방 코드 | 6자, `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. 대소문자 무시. 공개 룸도 코드를 가진다(관전용) | GDD 7.2 + 결정 |
| 로비에서 소켓 끊김 | 즉시 퇴장 처리 | 결정 |
| 인게임 소켓 끊김 | 자리 유지, `connected=false`. `DISCONNECT_GRACE_TICK = 450`(90초) 초과 시 `bot_takeover` | GDD 7.1 |
| 재접속 | `hello.playerToken`으로 같은 세션 복구 → `welcome.resumed=true` → `room_state` → 부트스트랩(`match_config`·`map_init`·`snapshot_full` — **본인 `connected=true` 반영 후**) → 룸에 `player_reconnected`. **봇 인계 후 복귀해도 조종권을 돌려준다**. `players[].connected` 갱신 경로: `snapshot_full`, `player_reconnected`(→ true), `room_state.players[].status`. `PlayerDelta` 에는 없다(끊김은 `room_state` 로) | 토큰 방식·복귀 규칙 **임의 결정** |
| 관전 | `lobby_spectate` (IN_GAME/GAME_OVER 룸). 탈락자는 같은 룸에서 그대로 수신(`ELIMINATED_SPECTATING`). **관전자 세션은 소켓이 끊기면 즉시 퇴장·폐기된다 → 관전자가 새로고침하면 `welcome.resumed:false` 로 로비에 돌아간다**(코드를 다시 입력해 관전. 플레이어 재접속과 다름 — QA m-2 명시) | GDD 4.14 + 결정 |
| 진행 중 게임의 생존자 | 다른 룸 입장 불가(`ALREADY_IN_ROOM`) — 먼저 `lobby_leave` | 결정 |
| 인게임 `lobby_leave` | 자리는 끊긴 상태로 남음(봇 인계 타이머 진행), 세션은 룸에서 분리 → 재접속 불가. 클라이언트 "나가기"는 저장 토큰도 지운다(새로고침해도 그 판으로 돌아가지 않음). **룸이 종료 60초 뒤 정리된 다음의 `lobby_leave` 는 `error NOT_IN_ROOM`**(정리 통지 없음 — 클라이언트는 무시) | 결정 |
| 계정·DB | 없음. 익명 닉네임 1~16자(제어문자 제거·trim) | 지정 |

---

## 4. Client → Server

공통: `hello` 이전의 모든 메시지 → `error NOT_HELLO`. 형식 오류 → `cmd_*`면 `cmd_ack {accepted:false, reason:"BAD_REQUEST"}`, 그 외 `error BAD_MESSAGE`.
**모든 `cmd_*`는 반드시 `cmd_ack` 1회**(다음 tick 1단계에서 처리 후 송신. 형식 오류·룸 없음·rate limit은 즉시. 게임이 끝난 tick 뒤 큐에 남은 명령은 종료 직후 `NOT_IN_GAME`). **예외: `clientSeq` 가 없거나 uint32 가 아니면 매칭할 수 없으므로 `error BAD_MESSAGE`**(QA m-3).

### hello
```json
{ "type": "hello", "nickname": "alice", "clientVersion": 1, "playerToken": "선택 — 재접속 시" }
```
→ `welcome`. 버전 불일치 `BAD_VERSION`, 닉네임 불량(문자열이지만 정리 후 1~16자가 아님 — 길이 무관) `BAD_NICKNAME`, 닉네임이 문자열이 아니면 `error BAD_MESSAGE`, 같은 소켓 두 번째 `ALREADY_HELLO`. 다른 소켓이 같은 토큰을 쓰고 있으면 기존 소켓을 닫고(close 4000) 새 소켓이 이어받는다.

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

스키마는 GDD 7.2 그대로(1차 문서와 동일). 형식 검증(정수·범위: unit 0..2, posture 0|1, troops 정수, tileId uint32, playerId 1..12 — 위반은 `BAD_REQUEST`. 그래서 **아래 표의 `BAD_UNIT` 은 WS 경로에선 나오지 않는 예약 코드**, QA m-2)을 통과하면 다음 tick 1단계에서 아래 순서로 검증한다. **성공 시 `cmd_ack`에 `flagId`와 결과 `posture`가 붙는다.**

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
| `cmd_flag_retarget` | `NO_FLAG`(없음·남의 깃발) → `ROUTED` → `RETURNING`(**귀환 중이고 전투 중이 아닐 때만** — 귀환 중 교전에 붙잡힌 깃발은 재지정 가능, QA I-2) → `LOCKED`(재지정 경직 15 tick 중 — **이탈 대기 중이면 허용**) → `BAD_REQUEST` → `WATER` → `ALLIED` → `OUT_OF_RANGE` | 앵커 교체, 기본 태세 재파생(쿨타임 중·전투 중이면 현 태세 유지), `postureManual=false`, `state=MARCHING`, `lockUntilTick = t+15`, 진척도·예산 0. **전투 중이면 이탈 대기 15 tick 개시**. → `flag_retargeted` (+태세가 바뀌면 `flag_posture_changed auto:true`, +전투 중이면 `flag_disengage_started`) |
| `cmd_flag_recall` | `NO_FLAG` → `ROUTED` → `RETURNING`(**귀환 중이고 전투 중이 아닐 때만**, QA I-2) | `state=RETURNING`, 귀환지 = recallTarget. 도착 시 잔여 × 85% 풀 환급. **전투 중이면 이탈 대기**(귀환 중 교전도 같음 — GDD 4.15 g 재이탈: 다시 명령하고 3초 × 실효값 0.5 를 또 치른다). → `flag_recalled` (+`flag_disengage_started`) |
| `cmd_set_posture` | `NO_FLAG` → `ROUTED` → `DISENGAGING` → `IN_COMBAT` → `SAME_POSTURE` → `POSTURE_COOLDOWN`(`tick < postureCooldownUntilTick`) | 즉시 적용(같은 tick 4a 가 새 태세로 교전 판정), 쿨타임 `t + 25`, 진척도·예산·정체 리셋, `targetOwnerId` 재계산 = `owners[anchor] == 소유자 ? 254 : owners[anchor]`(1단계 처리 시점), `postureManual=true`. → `flag_posture_changed auto:false`(결과 `targetOwnerId` 포함) |

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
                     "players": { "min": 2, "recommendedMin": 8, "recommendedMax": 10, "max": 12 }, "checksum": "sha256:9f2c…" }] }
```
**v4.1 `officialMaps`**: 공식 프리셋 맵 목록(파일의 메타만, id ASC). 별도 요청 메시지 없음.
**`officialMaps[].checksum` (프론트 QA m-8, 필드 추가)**: 맵 파일의 `checksum`("sha256:…", terrain+spawns+bases — §7.1). 클라이언트는 번들한 미리보기 파일과 대조해 다르면 썸네일·생성 전 판 길이 추정을 숨긴다.
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
  "spectatorCount": 0, "countdownMs": 2998, "autoStartMs": null
}
```
`phase`: `LOBBY|COUNTDOWN|IN_GAME|GAME_OVER`. `status`: `LOBBY_WAITING|PLAYING|ELIMINATED_SPECTATING|DISCONNECTED`. `countdownMs`는 COUNTDOWN일 때만 숫자, 그 외 `null`. players는 playerId 오름차순.
**`autoStartMs` (프론트 2차 추가, 2026-10-09 — 필드 추가만)**: **공개 룸이고 `phase == "LOBBY"`일 때만** 자동 시작(`PUBLIC_LOBBY_AUTOSTART_MS`, 룸 생성 = 첫 입장 시각 기준)까지 남은 ms(정수, 0 이상). 비공개 룸·그 외 phase는 `null`. `countdownMs`와 같이 **송신 시각 기준 값**이고 room_state는 주기적으로 오지 않으므로 클라이언트가 수신 시각부터 로컬로 줄인다. 정원 도달로 먼저 시작하면 다음 room_state(COUNTDOWN)에서 `null`.

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
  "width": 100, "height": 60, "totalLandTiles": 3622, "tickMs": 200, "hardTimeoutTick": 9600,
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
  "allyProposals": [], "allianceFreezeUntilTick": null, "lockoutDissolveTick": null,
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
**순서 (QA m-5)**: 처리 tick 의 `cmd_ack` 은 그 tick 의 방송(이벤트 → `snapshot_delta` → `snapshot_full` → `game_over`)보다 **먼저** 온다. 그래서 내 발령의 `cmd_ack.flagId` 가 같은 tick 의 `flag_issued` 보다 먼저 도착하고, `game_over` 는 그 tick 의 마지막 메시지다. 봇이 낸 명령(봇 자리·인계 중)의 ack 은 어떤 세션에도 보내지 않는다(QA m-10).

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
| `game_over` | 아래 | 승리 판정 tick. **그 tick의 `cmd_ack`·이벤트·`snapshot_delta`(+`snapshot_full`) 뒤 마지막 메시지**(이후 종료 직후 남은 명령의 `NOT_IN_GAME` ack 와 `room_state(GAME_OVER)`). **프론트 QA J-2**: GAME_OVER 룸에 늦게 붙은 세션(관전 입장·토큰 재접속)은 개인 부트스트랩 `room_state → match_config → map_init → snapshot_full` **바로 뒤에 같은 `game_over`(원본 그대로)를 1회 더** 받는다 |

```json
{ "type": "game_over", "finalTick": 9600, "winnerId": 3, "reason": "timeout",
  "standings": [{ "rank": 1, "playerId": 3, "tiles": 9, "troops": 208, "goldEarned": 50, "alive": true }] }
```
`reason`: `last_standing|threshold|timeout`. standings: 생존자(타이브레이커 순) → 탈락자(늦게 탈락한 순). 이후 `room_state(phase:"GAME_OVER")`.

### 이벤트 (룸) — 2차 추가 (전부 실제 송신)

같은 tick 안의 이벤트는 단계 순서(1 명령 → 3 외교 → 4 이동 → 4b 전투 → 7 게이지/기지 → 9 태세 → 10 종료 → 12 탈락)대로 쌓이고, **그 tick 의 `snapshot_delta`보다 먼저** 온다. 클라이언트는 모르는 `type`을 무시할 것(전방 호환). 타입 원본: `shared/src/protocol.ts`의 `S2C_Flag*`/`S2C_Combat*`/`S2C_Ally*`.

| type | 예시 JSON | 시점 |
|---|---|---|
| `flag_issued` | `{"type":"flag_issued","tick":3,"flagId":1,"playerId":1,"slotIndex":0,"unit":2,"posture":0,"troops":100,"originTileId":2103,"anchorTileId":1743,"targetOwnerId":0,"etaTick":32,"engageEtaTick":27}` | 발령 수락. `etaTick` = 현재 속도로 앵커까지 걸었을 때 도착 tick **추정**(ZOC·전투 무시). **`engageEtaTick`(프론트 QA m-4, 필드 추가)** = 같은 경로에서 MARCHING 도착 판정(ATTACK: 거리 1 안 front / DEFEND: `defendArrived` / 앵커 도달)이 처음 서는 tick 추정 — 발령 시점 owners 기준, ZOC·전투·영토 변화 무시. 실측(M10 NORMAL 2500 tick, n=331) 실제 `flag_engaged` 대비 평균 오차 5.2 tick(etaTick 26.7) |
| `flag_retargeted` | `{"type":"flag_retargeted","tick":40,"flagId":1,"anchorTileId":2500,"targetOwnerId":3,"posture":0,"resumeTick":55,"etaTick":88,"engageEtaTick":80,"auto":false}` | 재지정 수락(`auto:false`, `resumeTick` = 경직 해제 tick, `engageEtaTick` = `resumeTick` + 교전 개시 추정) / 4.5 중립 자동 전환(`auto:true`, 앵커 그대로, `resumeTick = etaTick = engageEtaTick = tick`) |
| `flag_recalled` ⟵ **백엔드 추가** | `{"type":"flag_recalled","tick":41,"flagId":1,"returnTileId":2103}` | 회수 수락, IDLE 타임아웃(600 tick) 자동 회수 |
| `flag_engaged` | `{"type":"flag_engaged","tick":10,"flagId":1,"posture":0,"frontTileCount":8}` / `{"type":"flag_engaged","tick":12,"flagId":2,"posture":1,"guardTileCount":34}` | MARCHING → ENGAGED. ATTACK 이면 `frontTileCount`만, DEFEND 이면 `guardTileCount`만 |
| `flag_stalled` | `{"type":"flag_stalled","tick":70,"flagId":1,"tileId":1833}` | **v4.1 의미**: ENGAGED·공격 태세·비전투 깃발이 25 tick 연속 한 칸도 못 민(AP 0·타깃 없음·잠긴 기지) 시점 1회. `tileId`는 `targetTileId`(없으면 `null`). 되돌리기 상쇄는 더 이상 없다 |
| `flag_progress_lost` | `{"type":"flag_progress_lost","tick":15,"flagId":2,"tileId":1833,"cause":"decayed"}` | 게이지 레이스 패배(`captured_by_other`) / 진척 > 0 인데 타깃이 바뀜(`target_lost`) / **v4.1 `decayed`: 자동 감소로 0 도달(1회). 이때 깃발의 `targetTileId`는 유지된다(다시 밀면 같은 칸에서 0부터)** |
| `flag_idle` | `{"type":"flag_idle","tick":21,"flagId":1,"reason":"front_cleared","autoRecallTick":621}` | `front_cleared`(공격 front 소멸 · 앵커 도달했는데 front 없음) / `guard_lost` / `allied`. `unreachable`은 송신하지 않음(가중 거리장에 도달 불가 타일이 없음, GDD 4.4) |
| `flag_ended` | `{"type":"flag_ended","tick":90,"flagId":1,"reason":"recalled","refunded":76}` | `recalled`(85% 환급) / `routed_returned`(0) / `exhausted`(0) / `attrited`(0) / `eliminated`(0). `refunded`는 정수 병력 |
| `combat_started` | `{"type":"combat_started","tick":31,"groupKey":4,"flagIds":[4,7],"sides":[{"sideKey":1,"ownerIds":[1],"troops":1000,"power":1000},{"sideKey":2,"ownerIds":[2],"troops":1000,"power":1300}]}` | 무리가 새로 생기거나 기존 무리에 깃발이 합류. `troops`·`power`는 그 tick 손실 적용 **전** 값. `power` = 편 실효값 W(permille) — 교환비 k = W_방어 / W_공격 |
| `combat_ended` | `{"type":"combat_ended","tick":129,"groupKey":4,"winnerSideKey":2,"routedFlagIds":[4]}` | 살아남은(패주·이탈 완료 제외) 편이 1개 이하가 된 tick. 동시 0 이면 `winnerSideKey:null`. 무리가 그냥 해체(상대 소멸·동맹 성립 등)되면 다음 tick 에 `winnerSideKey:null` |
| `flag_routed` | `{"type":"flag_routed","tick":129,"flagId":4,"returnTileId":2103}` | 병력 0 → 자동 귀환. 이후 모든 명령 `ROUTED`. **이탈 대기 중 패주하면 `disengageUntilTick = null`(별도 `flag_disengaged` 없음, QA m-8)** |
| `flag_posture_changed` | `{"type":"flag_posture_changed","tick":21,"flagId":1,"posture":1,"cooldownUntilTick":46,"auto":true,"targetOwnerId":254}` | 수동 전환(`auto:false`) / 재지정에 따른 기본 태세 재파생(`auto:true`). **QA I-1 추가 필드 `targetOwnerId`** = 전환 후 값(`owners[anchor] == 소유자 ? 254 : owners[anchor]`, 1단계 처리 시점) — 클라이언트는 이 값으로 덮어쓴다 |
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
| 11 봇 — **v4.1: 봇별 `t % bot.decisionInterval == 0`**(EASY 30 / NORMAL 15 / HARD 10), playerId ASC | `stage11_bots` | ✅ 3차-2 `CivBot` (`bot.ts`, §11) |
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

### 3차-2 봇 (2026-10-09, GDD v4.1 8장)
- `npm run typecheck` 통과. `npm test`: **8 파일 / 116 테스트 통과**(이후 aggression 3개 추가 → 119, QA 후속 3개 → 122). `npm run smoke`: `SMOKE PASSED` (룸 기본 두뇌가 이제 `CivBot` — 봇 자리가 실제로 발령·테크·동맹 응답을 한다).
- 신규 `server/test/bot.test.ts` (6): ① 10인 NORMAL 5분 — **거절 명령 비율 < 2%**(실측 0), 매 tick `ledgerImbalance == 0`, 평균 타일 > 80 ② **결정론** — 혼합 난이도 900 tick 상태 해시 동일, `decideBot` 같은 입력 → 같은 명령 ③ 난이도 — 결정 주기 30/15/10 호출 tick, 예비 비율에 따른 발령 시점·크기 (EASY < HARD) ④ EASY 공격 깃발 전부 검병, NORMAL 은 기병 사용 ⑤ **요격** — 내 땅을 미는 적 공격 깃발에 거리 1 인 내 땅 칸으로 방어 깃발 (≥ 적 × 1.25 × v 비) → 실제 명령 경로에서 `accepted, posture DEFEND` ⑥ 외교 수락/거절, 먼저 제안 안 함.
- 자가대전 (`selfplay.ts`, M 100×60, 10인, 전원 NORMAL, 시드 1000~1009, 실시간 대기 없음):

| 시드 | 종료 | 사유 | 1위 점유율 % @5/10/15/20/25/30분/종료 |
|---|---|---|---|
| 1000 | 32.0분 | timeout | 4.8 / 9.4 / 14.6 / 18.2 / 23.1 / 30.5 / 35.9 |
| 1001 | **31.3분** | **threshold** | 4.7 / 10.0 / 16.9 / 25.0 / 33.3 / 39.3 / 45.0 |
| 1002 | 32.0 | timeout | 4.9 / 9.4 / 17.2 / 20.5 / 26.5 / 28.9 / 32.0 |
| 1003 | 32.0 | timeout | 4.8 / 9.2 / 13.5 / 17.6 / 21.2 / 29.8 / 32.8 |
| 1004 | 32.0 | timeout | 4.9 / 11.0 / 17.0 / 25.8 / 28.2 / 31.3 / 32.7 |
| 1005 | 32.0 | timeout | 4.7 / 10.9 / 15.1 / 20.2 / 24.6 / 28.3 / 28.1 |
| 1006 | 32.0 | timeout | 4.5 / 10.0 / 11.2 / 15.3 / 17.8 / 22.9 / 27.5 |
| 1007 | 32.0 | timeout | 4.4 / 9.7 / 13.6 / 19.6 / 22.4 / 21.5 / 24.2 |
| 1008 | 32.0 | timeout | 5.4 / 11.0 / 15.8 / 17.9 / 21.7 / 25.9 / 26.8 |
| 1009 | 32.0 | timeout | 4.5 / 10.3 / 14.6 / 19.1 / 28.9 / 28.1 / 31.7 |
| **요약** | **평균 31.9 / 최소 31.3 / 최대 32.0** | timeout 9, threshold 1 | 평균 4.8 / 10.1 / 14.9 / 19.9 / 24.8 / 28.7 / 31.7 |

  봇 APM (수락 명령 / 분 / 봇) 평균 **7.8**, 거절률 0%. 진단 (레버 덮어쓰기 reserve 0·minDef 0, 같은 시드): 1위 점유율 평균 6.9 / 12.9 / 19.6 / 24.6 / 30.5 / 35.8 — 여전히 대부분 timeout (실행 조건에 따라 0~4/10 threshold, 최소 25.9분).
- 난이도 대결 (각 10판, 좌석 회전, 승자 = threshold 승자 또는 timeout 시 1위):

| 대결 | 강한 쪽 승률 | 최종 점유율 평균 (강 / 약) |
|---|---|---|
| HARD 1 vs NORMAL 9 | 30% (무차이 기대 10%) | 12.7% / 8.3% |
| NORMAL 1 vs EASY 9 | 50% (기대 10%) | 21.9% / 6.5% |
| HARD 1 vs EASY 9 | 70% | 29.0% / 6.0% |

- 성능 (단독 실행, 결정 tick 이 겹치는 최악 포함): M 10인 tick 평균 **0.27~0.31 ms**, 최대 21.6 ms (거리장 신규 생성 tick), 봇 몫 평균 0.02 ms/tick·최대 6.4 ms/tick. **L 108×66 12인 전원 봇**: tick 평균 **0.41 ms**, 최대 21 ms, 봇 몫 평균 0.03 ms·최대 7.1 ms (12 봇이 같은 tick 에 결정). 목표 평균 < 5 ms 충족.
- 버그 수정 (규칙 무관): `combat.ts trackCombatEvents` 가 여러 전투 기록을 합칠 때 `routed` 를 중복 누적 → 긴 다자 전투에서 배열 폭증·`Maximum call stack size exceeded` (자가대전에서 발견). 합집합으로 수정. `combat_ended.routedFlagIds` 에 중복이 더는 없다 (shape 불변).

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

### 3차-2 (봇, GDD 8장)에서 정한 것

46. **방어 = v4.1 요격만**: 8.1 위협 (`threatMilli` = 내 땅을 타깃으로 민 적 ENGAGED 공격 깃발의 `progressMilli + min(floor(initial×15/tileCost), maxProgress) × 25`, + 최근 25 tick 피해 기지) 으로 hotspot 을 고르고, 8.2(1) 의 "h 에 창병 발령" 대신 **위협 깃발에 거리 1 (없으면 2) 인 내 땅 칸**을 앵커로 방어 발령 (8.6 요격). 필요 병력 `ceil(적 병력 × 1.25 × v적 / v내)`, 발령 병력 = max(필요, 풀 × 40%). 병종: 출발지→앵커 거리 > 12 이고 감당되면 기병 (8.6 "가장 빠른 병종"), 아니면 창병 (8.2 "방어는 창병"). EASY 는 창병만. 결정당 방어 행동 1회.
47. **기존 주둔 깃발 재지정 우선** (8.6 표 "또는 기존 주둔 깃발 재지정"): 거리 ≤ 12 에 충분히 강한 비전투 방어 깃발이 있으면 새로 내지 않고 그 깃발을 요격 칸으로 옮긴다. 새 요격 발령은 방어 깃발 수 < 상한 (51) 일 때만, 아니면 8.2 선점 (threat ≥ 3000 × 1.6) — 선점 대상은 **ENGAGED 공격 깃발 중 front 최소** (행군 중 깃발은 front 가 없어 제외).
48. hotspot "같은 구간 중복 방지" = 거리 ≤ 6 에 그 위협 깃발 실효력 이상인 내 방어 깃발이 있을 때만 "덮였다" 로 본다.
49. **kEst = 실효 전투력 비**: 깃발 실효력 = 병력 × `flagValue` (4.15 d — 편 손실이 1/v 비례이므로 버티는 시간 ∝ 병력×v). 반격 (×1.2)·차단 당하기 (×0.5)·후퇴 (×0.8)·요격 (×1.25)·회피 (×0.9) 모두 이 값으로 비교.
50. **후퇴** 잔여 추정: 이탈 15 tick × (L = S×1.5%/n) × 내 몫 (v×0.5 역수 배분). 잔여 ≥ 120 일 때만 회수.
51. **방어 깃발 상한 = max(최소 방어선, floor(슬롯 × maxDefenseRatio))** — GDD 에 없음. 기준 `BOT_MAX_DEFENSE_RATIO_PERMILLE` 500, 성향으로 300~700 (§10-65). 8.6.0 굳히기 (정체·병력 < 40% → DEFEND) 는 앵커 거리 ≤ 7 에 적 플레이어 땅이 있고 상한 미만일 때만, 아니면 8.2 정체 규칙 (점수 ×1.3 이상 앵커로 갈아타기, 없으면 회수). 상한 없이 돌리면 슬롯의 60% 가 영구 주둔으로 묶여 공격이 멈췄다.
52. **최소 방어선** (8.2 3) "인접 적 수 최대 국경 구간" = 적 플레이어 땅과 맞닿은 내 칸 중 거리 ≤ 2 적 칸 수 최대 (동률 tileId 최소), 기존 방어 관할 원 밖. 병력 = 풀 × 40%, 상한 풀 − 예비.
53. **주둔 해제**: `engagedSinceTick` 이 없어 `calmTicks` (주둔 ∧ 비위협 연속 tick) ≥ 900 으로 판정. 제자리 반격 (위협 0, 병력 ≥ 70%, 쿨타임 없음) 은 front (ANY_HOSTILE) 가 있고 반격 후에도 최소 방어선이 유지될 때만.
54. **앵커 중복 방지**: 같은 소유자를 노리는 내 공격 앵커 (계획 포함) 와 거리 ≤ 6 인 국경 칸은 후보에서 뺀다 (GDD 식은 같은 소유자 두 깃발이 같은 앵커를 고름). `tileCost` 비교는 검병 기준. 재지정 점수의 `march` 는 기지가 아닌 **깃발 현재 위치**에서 잰다 (발령은 originFor = 최근접 기지).
55. **경로 위험 (8.6) 은 근사**: 거리장 경로를 만들지 않고 앵커 거리 ≤ 2 의 적 깃발 실효력 합 × 0.9 와 비교. **상륙 후보** (기동 T2+): 내 해안에서 얕은 물만 12칸 BFS 로 닿는, 내 땅과 비인접·적 깃발 거리 > 2 인 육지 — 점수 ×0.8. **차단 쓰기**: 내 땅을 노리는 적 행군 깃발과 그 앵커 사이 맨해튼 최단 경로 위 (깃발에서 2~6칸) 내 언덕·산 칸, 빈 슬롯 ≥ 2, 창병 = max(40, 요격 필요 병력). 결정당 1회.
56. **추격**: 기병 공격 깃발 거리 ≤ 6 에 이탈 대기 적 깃발이 있고 그 칸이 적·중립 육지면 그 칸으로 재지정.
57. **공격 깃발 최소 병력 = 3 × FLAG_MIN_TROOPS** (cap − 예비가 작은 소국은 2× 까지): GDD 식 `clamp(풀×45%, 40, …)` 은 40 근처 깃발을 반복 발령 → 몇 AP 쓰고 소진 (잔여 전액 소멸) → 소국이 영원히 못 자라는 함정이 있었다 (실측 10분에 소진 802회).
58. **소진 직전 회수**: ENGAGED 공격 깃발 병력 < 40 + 쌓인 예산 + 누적률 × 2 tick 이고, 그 경계 × 15% < 20 (회수 손실이 소진 손실 상한의 절반 미만) 일 때만 회수. 큰 깃발은 그냥 소진시키는 편이 손실·슬롯 점유가 적다 (측정).
59. **슬롯 재활용**: 슬롯이 꽉 찼고 새 깃발 예상 병력 (풀 × 35%, 풀 − 예비 이내) ≥ 2 × 최소 공격 병력이면, 병력 × 4 ≤ 그 값인 가장 약한 비전투 깃발 (공격, 또는 위협 없는 방어) 1개를 회수.
60. **테크**: `botIndex = playerId − 1`. 수비형 `[군사T1, 기동T2, …]` 처럼 선행 단계가 빠진 항목은 선행부터 산다 (TECH_ORDER 거절 방지). 결정당 1개, 못 사면 기다린다 (건너뛰지 않음). 목록 6개 소진 후엔 (단계, 축) 오름차순.
61. **외교**: 8.5 그대로 — 제안 수신 시 제안자 타일 ≥ 내 타일 × 1.2 ∧ 내 동맹 < 2 → 수락, 아니면 거절. 먼저 제안 안 함. 파기 = 내 타일 ≥ 동맹 × 2 ∧ t > 7500 ∧ 최소 유지 경과.
62. **기지 위협 가중** `(BASE_HP_MAX_MILLI − hp) × 3` — GDD 식의 `/1000` 은 hpMilli 단위와 맞지 않아 (최대 45, 트리거 3000 대비 무의미) 뺐다.
63. **명령 적용 시점 보정**: 봇 명령은 다음 tick 1단계에 적용되므로 경직 (`lockUntilTick`)·태세 쿨타임을 `t+1` 기준으로 본다. `clientSeq = t × 64 + 순번` (무상태·결정론). 한 결정에서 같은 깃발에 명령 2개를 내지 않는다.
64. **룸·로비 기본 두뇌 `IdleBot` → `CivBot`**. `IdleBot` 은 테스트용으로 남김.
65. **봇 성향 aggression (사용자 결정 2026-10-09)**: `PlayerState.bot.aggressionPermille` ∈ 0..1000 (0 수비적, 1000 공격적). 배정 = `botAggressionPermille(룸 시드, playerId)` 정수 해시 (Math.imul, Math.random 없음). 룸 시드는 무작위 맵이면 `map.seed`, 프리셋 맵이면 룸이 `nextSeed()` 로 따로 뽑아 `createGameState(…, aggressionSeed)` 로 넘긴다. 사람 자리에도 배정 (인계 대비). `PlayerSetup.aggressionPermille` 로 강제 가능 (테스트·진단). **알고리즘 분기 없음 — 값만 보간**: `값 = 기준 + trunc((a − 500) × SPAN / 500)` 후 clamp (`bot.ts botKnobs`, 상수 단일 소스 `shared/constants.ts BOT_AGGRESSION_SPAN`):

| 값 | 기준 | SPAN (a=0 → a=1000) | NORMAL 범위 |
|---|---|---|---|
| reserveRatio | 난이도 (450/300/200) | +100 → −100 | 400 → 200 |
| minDefenseRatio | 난이도 (100/250/300) | +100 → −100 | 350 → 150 |
| maxDefenseRatio (방어 상한) | `BOT_MAX_DEFENSE_RATIO_PERMILLE` 500 | +200 → −200 | 700 → 300 |
| counterMargin (주둔 반격) | `BOT_COUNTER_MARGIN_PERMILLE` 1200 | +200 → −200 | 1400 → 1000 |
| retreatRatio (후퇴) | `BOT_RETREAT_RATIO_PERMILLE` 800 | +200 → −200 | 1000 → 600 |
| blockAttackRatio (차단 당할 때 공격 전환) | `BOT_BLOCK_ATTACK_RATIO_PERMILLE` 500 | −200 → +200 | 300 → 700 |
| enemyAnchorWeight (적 앵커 점수 배율) | `BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE` 1000 | −400 → +400 | 600 → 1400 |

   난이도가 기준을 정하고 성향이 띠 안에서 민다 (EASY reserve 350~550, HARD 100~300). 테크 빌드 가중은 넣지 않음 (빌드는 목록 순서라 "값만 보간" 원칙에 맞지 않음). `aggressionPermille` 은 **서버 전용** (snapshot 미노출). 단 `match_config.constants` 는 shared 상수 전체를 싣으므로 새 상수 4개 (`BOT_AGGRESSION_NEUTRAL_PERMILLE`, `BOT_MAX_DEFENSE_RATIO_PERMILLE`, `BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE`, `BOT_AGGRESSION_SPAN`) 가 추가로 보인다 (추가만).
66. 사용자 확인 (2026-10-09): 공격 깃발 최소 병력 120 (§10-57), 요격 병종 = 출발지 거리 > 12 이면 기병 아니면 창병 (§10-46) 확정. 페이싱은 사람 플레이테스트 후 재검토 (상수 불변).

### QA 후속 (04_qa_report_backend.md, 2026-10-09)에서 정한 것

67. **I-1** `flag_posture_changed.targetOwnerId` 추가(필드 추가만). 값 = 전환 후 `targetOwnerId` — 재지정(`auto:true`)이면 새 앵커 기준, 수동 전환이면 `owners[anchor] == 소유자 ? 254 : owners[anchor]`(1단계 처리 시점 owners = 직전 tick 상태). QA 재구성 모델이 이 필드를 쓰면 `snapshot_full` 과 불일치 0.
68. **I-2** 귀환(RETURNING) 깃발도 **전투 중이면** `cmd_flag_recall`·`cmd_flag_retarget` 수락 → 이탈 대기 15 tick(실효값 ×0.5) 개시(GDD 4.15 g 재이탈 — 사용자 확정 규칙). 전투 중이 아닌 귀환 깃발은 종전대로 `RETURNING` 거절, 패주 깃발은 `ROUTED`.
69. **m-5 / m-10** 룸 배달 순서 = 개인(`cmd_ack`) → 방송(이벤트 → delta → full → game_over). 개인 메시지는 1단계 산출이라 앞당겨도 상태 의미가 바뀌지 않는다. 봇 명령(connId 0)의 ack 은 `Outbox.personal[].fromBot` 으로 표시하고 룸이 버린다(헤드리스·테스트에서는 그대로 보인다).
70. **m-6** 공개 룸 `lobby_start_now` → `error NOT_HOST`(새 코드 없이 기존 코드 재사용). **m-7** 재접속 시 `connected`/`botControlled` 를 부트스트랩 **전에** 바꾼다. **m-9** 게임 종료 tick 뒤 큐에 남은 사람 명령은 `Simulation.flushPending()` 으로 `NOT_IN_GAME` ack(봇 명령은 버림). **m-1** `hello.nickname` 형식 검사는 문자열 여부만 — 길이 위반은 전부 `BAD_NICKNAME`.
71. **m-12** GDD 와 다른 세부: `botCount` 범위는 GDD `0..maxPlayers − 사람`, 서버는 `0..maxPlayers − 1` 을 받고 시작 시 `min(botCount, maxPlayers − H)` 로 클램프(로비 중 사람 수가 바뀌므로). 상수 이름: GDD `PUBLIC_AUTOSTART_MS` = 코드 `PUBLIC_LOBBY_AUTOSTART_MS`, GDD `PUBLIC_ROOM_MAP` = 코드 `PUBLIC_ROOM_SIZE`(+ `PUBLIC_ROOM_PLAYERS`).
72. **프론트 2차 — `room_state.autoStartMs` 추가**(오케스트레이터 승인, 필드 추가만): 공개 대기실의 "자동 시작까지 n초" 표시용. 기존 필드·의미 불변. 타입 `S2C_RoomState.autoStartMs: number | null`, QA 스키마(`qa-schema.ts`) 반영, `rooms.test.ts` 테스트 1개 추가.
73. **프론트 QA J-2 — GAME_OVER 부트스트랩에 `game_over` 재송신**: 룸이 마지막 `game_over` 를 보관하고, GAME_OVER 단계의 `spectate`·`onResume` 개인 부트스트랩 뒤에 보낸다(`room.ts sendGameBootstrap`). 메시지 shape 불변, 개인 메시지 1개 추가. `rooms.test.ts` 테스트.
74. **프론트 QA m-4 — `flag_issued`/`flag_retargeted.engageEtaTick` 추가**(필드 추가만, `etaTick` 의미 불변): `rules.ts engageEtaTicks` — movement.ts MARCHING 도착 판정과 같은 조건을 경로 위에서 검사하는 표시용 추정.
75. **프론트 QA m-8 — `welcome.officialMaps[].checksum` 추가**(필드 추가만): `presetInfo` 가 파일 checksum 을 싣는다.
76. **문서화(QA m-2)**: 관전자 새로고침 → 로비 복귀(관전 세션은 끊김 즉시 폐기). 서버 동작 변경 없음.

---

## 11. 봇 (3차-2 완료 — 중간 보고)

**구현 위치**: `server/src/game/bot.ts` — `CivBot: BotBrain`, `decideBot(state, playerId, t, params)`. 룸 (`room.ts`)·로비 (`lobby.ts`) 기본 두뇌. 무상태 (봇 메모리 없음 → 여러 룸 공유 가능)·결정론 (Math.random·부동소수 누적 없음, 순회 ASC). 일반 `C2S_GameCommand` 만 반환 → 다음 tick 1단계에서 사람과 같은 검증. 거리장 (`getField`/`stepToward`/`etaTicks`) 미사용.

**결정 순서** (봇별 `t % params.decisionInterval == 0`, playerId ASC — 11단계):
1. 외교 응답·파기 (8.5)
2. 테크 1개 (8.5 빌드 4종, botIndex % 4)
3. 방어 (8.1 위협 → v4.1 요격: 주둔 재지정 > 새 요격 발령 > 공격 깃발 선점) — 결정당 1회 (§10-46~48)
4. 깃발 정비 flagId ASC (8.2 2 + 8.6.0): 후퇴 → 기병 추격 → 차단 당하기 (약하면 ATTACK, 아니면 우회/회수) → IDLE 재지정/회수 → 공격 깃발 (제자리 반격 복귀·소진 직전 회수·굳히기/정체·front < 2 재지정) → 방어 깃발 (주둔 반격 재지정·3분 무위협 회수·제자리 반격)
5. 차단 쓰기 (8.6.0 2) — 결정당 1회
6. 슬롯 재활용 (§10-59)
7. 빈 슬롯 채우기 (8.2 3): 최소 방어선 → bestAnchor (8.3, 중립 ×1.6 bias, 상륙 ×0.8, 회피) → chooseUnit (8.4, EASY = 검 고정) → 병력 clamp

**난이도 레버 (2.8 g, 로직 동일)**: `decisionInterval` 30/15/10, `reserveRatioPermille` 450/300/200, `minDefenseRatioPermille` 100/250/300, `fixedUnit` SWORD/null/null.

**성향 aggression (§10-65)**: 봇마다 (룸 시드, playerId) 해시로 0..1000. 난이도 값을 기준으로 예비·최소 방어·방어 상한·반격 여유·후퇴·차단 공격·적 앵커 선호 7개 값을 띠 안에서 보간 (분기 없음). 측정 (자가대전 10판, NORMAL, 시드 1000~1009): 종료 평균 32.0분 (timeout 10/10), 방어 슬롯 비중 평균 48.3%, 최종 점유율 평균 — 성향 0~333: 6.5% (31석, 1위 2회) / 334~666: 8.1% (34석, 4회) / 667~1000: 11.3% (35석, 4회). 짧은 판 테스트 (4500 tick, 전원 0 vs 전원 1000): 방어 비중 차 > 5%p, 공격 발령 수 1000 쪽이 더 많음.

**테스트·측정**: §9 "3차-2". **프로토콜 변경 없음** (메시지·필드 동일). 프론트 영향: 봇 자리가 이제 실제로 깃발·테크·동맹 응답 이벤트를 만든다 — 기존 이벤트 처리 그대로.

**페이싱 관찰 (상수 불변, 원인 분석)** — 자가대전 10판 중 9판이 32분 하드 타임아웃, 1위 점유율 30분 평균 28.7% (GDD: 29.4분에 임계 45% 도달 기대):
1. **로지스틱 이용률**: 5.2 모델은 `u = 0.7` (풀/상한 평균 0.30) 을 가정하지만 봇 예비 `BOT_RESERVE_RATIO = 0.30` 자체가 풀의 하한이라 평균 풀/상한은 실측 **0.43~0.49**. 재생이 모델보다 20~25% 적다. reserve 를 0 으로 덮어쓰면 5분 1위 점유율 4.8 → 6.9%.
2. **슬롯 병목**: 중반 (15~20분) 결정 시점의 약 73% 가 "슬롯 꽉 참 + 풀 여유" 상태. 슬롯 시간의 약 40% 가 방어 주둔 (최소 방어선 25% 가 슬롯 4~5개에서 올림으로 1~2개), 공격 깃발은 행군 23%·귀환 13%·실제 교전 7%. 5.1 의 "깃발 메커니즘은 병목이 아니다 (처리량 3.4배)" 가 봇 실측에선 성립하지 않는다 — 행군 거리 (기지 커버율) 와 주둔 점유가 모델보다 크다. 중반 풀이 2,000~4,600 까지 쌓여 재생이 0 에 가깝다.
3. **효율 손실**: 장부 기준 노출 소모 ~10%, 깃발 전투 ~17%, 변환 (기병 1.15) 4~12%, 회수 3% — 5.1 의 1단계 효율 0.734 보다 낮다.
4. **대칭 봇은 스노볼이 약하다**: 1위가 45% 에 닿으려면 다른 봇의 붕괴가 필요하나 NORMAL 끼리는 균형. 레버 진단 (reserve 0·minDef 0) 에서도 30분 1위 평균 35.8%.
5. **난이도**: 중반이 슬롯 병목이라 reserve 레버가 거의 안 먹고, minDef 25%/30% 는 슬롯 4~5개에서 같은 개수로 올림 → **HARD ≈ NORMAL** (HARD 1 vs NORMAL 9 승률 30%). B-19 목표 (사람 승률 HARD ≤ 15%) 를 4 레버만으로 만들기 어렵다.

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
6. ~~1차 §10-5 (본문 구값 37/42분)~~ → **해소**: GDD 3.1 표가 28/32분으로 정리됨 (QA m-11).
7. **(봇, 3차-2)** 8.1 기지 위협 식 `/1000` 단위 오류 (§10-62). 8.2 "방어는 항상 창병" vs 8.6 요격 "가장 빠른 병종 (기병 우선)" 충돌 (§10-46). 8.2 정체 (갈아타기/회수) vs 8.6.0 굳히기 (→ DEFEND) 충돌 — 8.6.0 우선 + 방어 상한 (§10-51). `engagedSinceTick` 미정의 (§10-53). 같은 소유자 다중 깃발이 같은 앵커를 고르는 문제 (§10-54). 수비형 빌드의 `기동T2` 선행 누락 (§10-60). 공격 깃발 하한 40 의 소진 함정 (§10-57). 8.6.0 차단 쓰기의 "적 재배치 경로" 정의 없음 (§10-55 근사).
8. **(봇 페이싱)** 5.2 `u = 0.7` 가정과 `BOT_RESERVE_RATIO 0.30` 의 모순, 5.1 "깃발 메커니즘 비병목" 가정이 봇 실측과 다름, 2.8 g 레버만으로 HARD/NORMAL 차등이 작음 — §11 페이싱 관찰. **자가대전 9/10 판 하드 타임아웃**. 게임 상수는 바꾸지 않았다 (game-designer 판단 필요).

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

## 15. 3차-2 변경 요약 (프론트 영향)

| 구분 | 내용 |
|---|---|
| 메시지·필드 | **변경 없음** |
| 동작 | 봇 자리 (처음부터 봇 + `bot_takeover`) 가 실제로 명령을 낸다 — `flag_issued`/`flag_retargeted`/`flag_recalled`/`flag_posture_changed`/`tech_purchased`/`ally_proposal_closed` (봇 거절)/`ally_formed` (봇 수락)/`ally_break_started` 가 봇 발로도 나온다 |
| 수정 | `combat_ended.routedFlagIds` 중복 제거 (원래 의미대로) |

## 16. QA 후속 변경 요약 (프론트 영향)

| 구분 | 내용 |
|---|---|
| 필드 추가 | `flag_posture_changed.targetOwnerId` (I-1) — 받으면 깃발의 `targetOwnerId` 를 덮어쓴다 |
| 규칙 | 귀환 중 교전에 붙잡힌 깃발에 회수·재지정 가능 → `flag_disengage_started` (I-2). 패주 깃발은 그대로 불가 |
| 순서 | `cmd_ack` 이 그 tick 방송보다 먼저 온다 → `flag_issued` 전에 `cmd_ack.flagId` 를 알 수 있고 `game_over` 가 그 tick 마지막 (m-5) |
| 기타 | 공개 룸 `lobby_start_now` → `NOT_HOST` (m-6). 재접속 부트스트랩의 본인 `connected=true` (m-7). 봇 명령 ack 미배달 (m-10). 종료 후 남은 명령 `NOT_IN_GAME` ack (m-9). 65자 이상 닉네임도 `BAD_NICKNAME` (m-1) |
| QA 스크립트 | `npm run qa:headless|qa:scenarios|qa:ws -w @civwar/server` (`qa-schema.ts` 는 모듈) |
| 필드 추가 (프론트 2차) | `room_state.autoStartMs: number \| null` — 공개 룸 LOBBY 에서 자동 시작까지 남은 ms(수신 시각 기준), 그 외 null. §5·§10-72·§17 |
| 프론트 QA 후속 | `flag_issued`/`flag_retargeted.engageEtaTick`, `welcome.officialMaps[].checksum` 필드 추가, GAME_OVER 부트스트랩 뒤 `game_over` 재송신 — §17 |

## 17. 프론트 2차 변경 요약 (2026-10-09, frontend-game-client-engineer — 오케스트레이터 지시)

| 구분 | 내용 |
|---|---|
| 필드 추가 | `room_state.autoStartMs: number \| null` — 공개 룸 LOBBY 에서 자동 시작까지 남은 ms, 그 외 null (§5, §10-72) |
| 제거·의미 변경 | 없음 |
| 서버 코드 | `server/src/room/room.ts` (`autoStartAt` 기록·에코), `shared/src/protocol.ts` 타입, `server/scripts/qa-schema.ts`, `server/test/rooms.test.ts` |
| 필드 추가 (프론트 QA) | `flag_issued.engageEtaTick`, `flag_retargeted.engageEtaTick` (§5, §10-74), `welcome.officialMaps[].checksum` (§5, §10-75) |
| 개인 메시지 추가 (프론트 QA J-2) | GAME_OVER 룸 부트스트랩 뒤 `game_over` 재송신 (§2, §5, §10-73) |
| 문서화 | 관전자 새로고침 → 로비 (§3, §10-76), 정리된 룸에 `lobby_leave` → `NOT_IN_ROOM` (§3) |
