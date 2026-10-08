# civwar.io 백엔드 프로토콜 · 구현 문서 (Phase 3 1차)

> **프론트엔드의 유일한 신뢰 소스.** 서버가 실제로 보내는 메시지와 이 문서가 다르면 버그다.
> 기준: GDD v4.0 (사용자 승인 2026-10-08, 부록 A 3단계 2차 재조정값). 타입 원본: `shared/src/protocol.ts`, 상수 원본: `shared/src/constants.ts`.
> 작성: 2026-10-08, multiplayer-backend-engineer. 프로토콜 버전 `PROTOCOL_VERSION = 1`.

---

## 0. 1차 범위 요약

| 구분 | 상태 |
|---|---|
| 골격·빌드·테스트·실행 스크립트 | ✅ |
| `shared/constants.ts` (부록 A 전부, permille 정수) | ✅ |
| 토폴로지 추상화 (`Topology` / `MapGraph` + 사각 구현) | ✅ |
| 맵 생성 (mulberry32, 육지/물 → 지형 → 스폰·기지(v2.1 placeBases) → 물 분할, I1~I4 assert, seed+1 재생성) | ✅ |
| 룸/로비 (방 코드·공개 대기열·8~12인·봇 슬롯·관전·재접속) | ✅ |
| tick 루프 (GDD 7.4 14단계 함수 분리, Phase A/B 타입 분리) | ✅ 골격 |
| 실제 동작: 병력 재생·골드 수입·테크 구매·기지 체력 회복·탈락·승리 판정·하드 타임아웃·종반 러시 신호·threshold_update·`snapshot_full`/`snapshot_delta` | ✅ |
| 깃발 이동·게이지·전투(4장)·ZOC·태세·상륙·주둔 유지비·동맹 | ⛔ 2차 (자리·타입만) |
| 봇 AI (8장) | ⛔ 3차 (아무것도 안 하는 `IdleBot`) |

**1차에서 깃발·동맹 명령은 형식 검증 후 `cmd_ack { accepted:false, reason:"NOT_IMPLEMENTED" }`로 회신한다.** 프론트는 UI를 만들어 두되 이 코드를 "준비 중"으로 표시하면 된다.

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
    map/generate.ts       # 맵 생성 + 불변식
    game/state.ts         # GameState / PlayerState / Flag(4.2 전 필드) / BaseState, setTileOwner
    game/economy.ts       # troopCap, regen, gold, flagCap, techCost, (upkeep 자리)
    game/victory.ts       # thresholdScaled, judgeVictory
    game/commands.ts      # 1단계 입력 큐 드레인·명령 적용
    game/tick.ts          # 14단계 함수 + Simulation
    game/snapshot.ts      # match_config / map_init / snapshot_full / DeltaTracker
  server/test/*.test.ts   # vitest
  server/scripts/smoke.ts # 실제 WS 스모크
  server/scripts/mapstats.ts
```

### 1.3 명령 (루트에서, Windows/macOS/Linux 공통)

```
npm install
npm test                 # vitest 전체 (49 tests)
npm run typecheck        # shared + server tsc --noEmit
npm run start:server     # ws://localhost:8080  (PORT 환경변수로 변경)
npm run dev:server       # tsx watch
npm run smoke            # 임시 포트로 서버 기동 → 클라이언트 3개로 전체 흐름 검증
```

환경변수: `PORT`(기본 8080), `CIVWAR_SEED`(정수 — 지정 시 룸마다 seed, seed+1, … 순으로 맵 시드 고정. 재현·디버그용).

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
| 인원 | 8~12 (`targetPlayers`). 맵 크기는 `MAP_SIZE[targetPlayers]` | GDD 2.3 |
| playerId 배정 | **룸 입장 시** 비어 있는 가장 작은 번호(1..N). 시작 시 빈 번호는 봇 `"BOT n"` | 백엔드 결정 |
| 스폰 | `spawn[k]` → `playerId k+1` (스폰 배치 순서 그대로) | 백엔드 결정 |
| 방장 | 첫 입장자. 퇴장 시 남은 인간 중 playerId 최소 | GDD 7.2 |
| 카운트다운 시작 조건 | (a) 방이 인간으로 가득 참 (b) 방장 `lobby_start_now` (c) 인간 전원 `ready=true` (d) **공개 룸**: 생성 후 `PUBLIC_LOBBY_AUTOSTART_MS = 30000` 경과. 시작 시 빈자리는 봇 | (b) GDD, 나머지 **GDD에 없어 임의 결정** |
| 카운트다운 | `LOBBY_COUNTDOWN_MS = 3000`. 이 동안 신규 입장 불가(`ROOM_IN_PROGRESS`). 퇴장 시 그 자리는 봇 | 임의 결정 |
| 공개 룸 인원 | 10 (기본 맵) | 임의 결정 |
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

### lobby_create_private
```json
{ "type": "lobby_create_private", "targetPlayers": 8, "timeLimitMin": 30 }
```
`targetPlayers` 8..12 정수(아니면 `error BAD_MESSAGE`). `timeLimitMin`은 **수신하되 무시**(§10-4).

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
오류: `NOT_IN_ROOM`, `NOT_LOBBY`, `NOT_HOST`(start_now).

### cmd_buy_tech — 1차 동작
```json
{ "type": "cmd_buy_tech", "clientSeq": 12, "axis": 1, "tier": 1 }
```
axis `0=MILITARY 1=ECONOMY 2=TERRITORY 3=MOBILITY`, tier 1..3.
검증 순서: 플레이어 존재(`NOT_IN_GAME`) → 생존(`ELIMINATED`) → `tech[axis] == tier-1`(아니면 **`TECH_ORDER`**) → `gold ≥ cost`(`INSUFFICIENT`). 성공 시 골드 차감·즉시 발효 → `cmd_ack accepted` + 룸 `tech_purchased`.
`cost = floor(TECH_BASE_COST[tier-1] × (1000 + 250 × 총구매수) / 1000)`.

### 깃발·동맹 명령 — 1차는 `NOT_IMPLEMENTED`
```json
{ "type": "cmd_flag_issue", "clientSeq": 1, "unit": 1, "troops": 300, "anchorTileId": 2412, "originBaseTileId": null }
{ "type": "cmd_flag_retarget", "clientSeq": 2, "flagId": 7, "anchorTileId": 2500 }
{ "type": "cmd_flag_recall", "clientSeq": 3, "flagId": 7 }
{ "type": "cmd_set_posture", "clientSeq": 4, "flagId": 7, "posture": 1 }
{ "type": "cmd_ally_propose", "clientSeq": 5, "targetPlayerId": 3 }
{ "type": "cmd_ally_respond", "clientSeq": 6, "proposalId": 1, "accept": true }
{ "type": "cmd_ally_break", "clientSeq": 7, "allyPlayerId": 3 }
```
형식 검증(정수·범위: unit 0..2, posture 0|1, troops 정수 ≥0, tileId uint32, playerId 1..12)은 1차부터 적용. 스키마는 GDD 7.2 그대로이며 2차에서 바뀌지 않을 예정.

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
{ "type": "welcome", "sessionId": "s_3f2a9c1b7e01", "playerToken": "q8...", "serverTick": 0, "protocolVersion": 1, "tickMs": 200, "resumed": false }
```
⚠ GDD의 `playerId` 대신 **`sessionId`**(§10-1). 게임 내 숫자 playerId는 `room_state.players[].playerId`에서 `sessionId`가 일치하는 항목으로 찾는다. `playerToken`은 재접속용으로 보관(localStorage 권장).

### room_state (룸) — 입장·퇴장·준비·카운트다운·게임 시작/종료·접속 변화·탈락·봇 인계 때
```json
{
  "type": "room_state", "roomId": "r1", "roomCode": "DFV7MV", "isPublic": false,
  "phase": "COUNTDOWN", "hostId": 1, "targetPlayers": 8,
  "players": [
    { "playerId": 1, "sessionId": "s_3f2a…", "nickname": "alice", "isBot": false, "isHost": true, "ready": false, "status": "LOBBY_WAITING" },
    { "playerId": 3, "sessionId": null, "nickname": "BOT 3", "isBot": true, "isHost": false, "ready": true, "status": "LOBBY_WAITING" }
  ],
  "spectatorCount": 0, "countdownMs": 2998
}
```
`phase`: `LOBBY|COUNTDOWN|IN_GAME|GAME_OVER`. `status`: `LOBBY_WAITING|PLAYING|ELIMINATED_SPECTATING|DISCONNECTED`. `countdownMs`는 COUNTDOWN일 때만 숫자, 그 외 `null`. players는 playerId 오름차순.

### match_config (룸, 시작 시 1회 / 개인 부트스트랩)
```json
{
  "type": "match_config", "seed": 20261008, "topology": "square",
  "width": 90, "height": 54, "totalLandTiles": 3201, "tickMs": 200, "hardTimeoutTick": 9600,
  "endgameRush": { "tick": 8400, "costMultPermille": 750 },
  "thresholdCurve": { "startPct": 60, "decayStartTick": 4800, "decayPerMinPermille": 1500, "floorPct": 45, "scale": 200 },
  "constants": { "TICK_MS": 200, "ENEMY_BASE": 11, "TERRAIN_COST_PERMILLE": [0,1000,1150,1300,800,1700,0], "...": "shared/constants.ts 의 대문자 상수 전부" }
}
```
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
- `flags[]` 항목 shape (1차에선 항상 빈 배열, 2차부터 채움):
  `{ id, ownerId, slotIndex, unit, posture, troops, posTileId, anchorTileId, targetOwnerId, state:"MARCHING|ENGAGED|RETURNING|IDLE", targetTileId|null, progressPct(0..99), stalled, inCombat, routed, blocked, disengaging, postureCooldownUntilTick }`
  — GDD 7.3 필드 + v4.0 비트(`inCombat, routed, blocked, disengaging, postureCooldownUntilTick`)를 미리 포함(§10-3).
- `alliances[]` 항목: `{ a, b, state:"ACTIVE|BREAKING", sinceTick, breakAtTick|null }` (a<b). 1차 빈 배열.
- `hpPct = floor(hpMilli × 100 / 15000)`.

### snapshot_delta (룸, 매 tick)
```json
{
  "type": "snapshot_delta", "tick": 26,
  "tileChanges": [[2413, 1]],
  "playerDeltas": [],
  "flagMoves": [], "flagStats": [], "flagProgress": [], "flagTargets": [],
  "baseHp": [], "flagsGone": [],
  "thresholdPct": 59.995
}
```
- **모든 배열 필드는 항상 존재**(비어 있을 수 있음). `thresholdPct`만 값이 바뀐 tick에 존재(옵셔널).
- `playerDeltas`: `t % 5 == 0`일 때만, **표시값(`tiles,troops,gold,goldWeight,upkeepPm`)이 마지막 송신 이후 바뀐 플레이어만**. 항목 `{id,tiles,troops,gold,goldWeight,upkeepPm}`.
- `flagMoves [flagId,posTileId]`: posTileId가 바뀐 깃발(매 tick). `flagStats [flagId,troops,state]`: `t % 5 == 0`, 바뀐 것만. `flagProgress [flagId,pct]`: ATTACK 태세 ENGAGED 깃발 전부(매 tick). `flagTargets [flagId,targetTileId|null]`: 바뀐 것만. `baseHp [tileId,hpPct]`: `t % 5 == 0`, 바뀐 기지만. `flagsGone [flagId]`.
- 같은 tick에 `snapshot_delta` → `snapshot_full` 순으로 온다. full을 받으면 그 상태로 덮어쓰면 된다.
- 1차에서는 깃발·전투가 없으므로 `tileChanges`·`flag*`·`baseHp`는 사실상 비어 있다.

### cmd_ack (개인)
```json
{ "type": "cmd_ack", "clientSeq": 12, "accepted": false, "reason": "INSUFFICIENT" }
{ "type": "cmd_ack", "clientSeq": 13, "accepted": true }
```
`flagId?`, `posture?`는 2차에서 발령·재지정·태세 전환 성공 시 포함.

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

### 예약 이벤트 — 2차·3차 (1차 서버는 **송신하지 않음**)

`flag_issued, flag_retargeted, flag_engaged, flag_stalled, flag_progress_lost, flag_idle, flag_ended, combat_started, combat_ended, flag_routed, flag_posture_changed, flag_blocked, flag_unblocked, flag_disengage_started, flag_disengaged, base_captured, ally_proposed, ally_formed, ally_break_started, ally_broken, alliance_lockout`.
페이로드는 GDD 7.3 표를 따를 예정이며, 2차 구현 시 이 문서에 예시 JSON과 함께 확정한다. 클라이언트는 **모르는 `type`을 무시**하도록 구현할 것(전방 호환).

---

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
| `NOT_IMPLEMENTED` | 1차 미구현 명령 (**추가, 2차에서 소멸 예정**) | ✅ |
| `NO_SLOT` `BAD_UNIT` `WATER` `ALLIED` `OUT_OF_RANGE` `TOO_SMALL` `NO_FLAG` `RETURNING` `LOCKED` `NOT_BASE` `NOT_OWNED_BASE` `ROUTED` `IN_COMBAT` `DISENGAGING` `POSTURE_COOLDOWN` `SAME_POSTURE` | GDD 7.2/7.3 | 2차 |

### 6.2 `error.code`

`BAD_MESSAGE` `BAD_VERSION` `NOT_HELLO` `ALREADY_HELLO` `BAD_NICKNAME` `BAD_TARGET_PLAYERS`(예약) `ROOM_NOT_FOUND` `ROOM_FULL` `ROOM_IN_PROGRESS` `ALREADY_IN_ROOM` `NOT_IN_ROOM` `NOT_HOST` `NOT_LOBBY` `RATE_LIMITED`(예약). 전부 백엔드 정의(GDD는 `{code,message}` shape만 규정).

---

## 7. 맵 생성 (GDD 2.3·2.4 + v2.1 2.6)

- `generateMap(seed, N, cfg = MAP_GEN_DEFAULT)` — mulberry32만, 확률 비교는 정수(`u32 < floor(pm × 2^32 / 1000)`).
- rng 소비 순서: 육지/물 시도들 → 산 blob → 비옥지 blob → 사막 blob → (SHALLOW_QUOTA 모드만) 얕은 물 blob. **물 분할이 맨 뒤라 같은 시드면 BORDER_ONLY/SHALLOW_QUOTA의 육지·스폰·기지가 비트 단위로 같다**(테스트로 확인).
- 불변식 I1(육지 연결) · I2(얕은 물 고립 없음) · I3(BORDER_ONLY: DEEP == 2W+2H−4, 테두리 전부 DEEP / SHALLOW_QUOTA: |SHALLOW| == quotaS) · I4(이동 그래프에서 육지 전부 도달) + 기지 2N·수도 소유 검사. 실패 시 seed+1, 최대 16회(`MAPGEN_MAX_SEED_RETRIES`, 임의). `match_config.seed`는 **실제 사용된 시드**.
- 측정: 8/10/12인 × 시드 40개 = 120맵 재생성 0회, 평균 16 ms/맵.

---

## 8. tick 루프 (GDD 7.4)

`TICK_MS = 200`. 룸마다 드리프트 보정 타이머(`loopStart + t × 200ms`). 첫 처리 tick은 `t = 1`(tick 0 = 시작 상태, 시작 시 `snapshot_full tick:0`).

| 단계 | 함수 (`server/src/game/tick.ts`) | 1차 |
|---|---|---|
| 1 입력 큐 드레인 `(recvSeq, connId, clientSeq)` | `stage1_drainInput` | ✅ 테크, 나머지 NOT_IMPLEMENTED |
| 2 자원 생산 playerId ASC | `stage2_produce` | ✅ 병력·골드(유지비 0) |
| 3 외교·시간 타이머 | `stage3_timers` | ✅ 종반 러시·봇 인계·threshold_update / 동맹 2차 |
| 4 깃발 이동 flagId ASC | `stage4_moveFlags` | 빈 함수 |
| 4a 깃발 전투 Phase A (읽기 전용 → `FlagCombatPlan`) | `stage4a_flagCombatPhaseA` | 빈 결과 |
| 4b 깃발 전투 Phase B flagId ASC | `stage4b_flagCombatPhaseB` | 빈 함수 |
| 5 AP 예산 누적 | `stage5_accumulateBudget` | 빈 함수 |
| 6 전투 Phase A (읽기 전용 → `PushPlan`) | `stage6_combatPhaseA` | 빈 결과 |
| 7 전투 Phase B tileId ASC | `stage7_combatPhaseB` | 빈 함수 |
| 8 기지 체력 회복 tileId ASC | `stage8_baseRegen` | ✅ |
| 9 파생 상태 | `stage9_derived` | 빈 함수(calmTicks 2차) |
| 10 깃발 종료 판정 | `stage10_flagEnd` | 빈 함수 |
| 11 봇 (t % 15 == 0, playerId ASC) | `stage11_bots` | ✅ 호출 구조, `IdleBot` |
| 12 탈락 | `stage12_elimination` | ✅ |
| 13 승리 | `stage13_victory` | ✅ |
| 14 브로드캐스트 | `stage14_broadcast` | ✅ |

정수식:
- `troopCap = floor((100 + 12·tiles) × capPm / 1000)`
- `regenMilli = round_half_up( (800 + floor(500 × isqrt(tiles·10⁶) / 1000)) × regenPm × (capMilli − troopsMilli) / (1000 × capMilli) )`, 이후 `troopsMilli = min(troopsMilli + regen, capMilli)`
- `goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹)`, `net = gross − floor(gross × upkeepPm / 1000)`
- `flagCap = min(7, 3 + floor(tiles/300) + MOB_SLOT_BONUS[tier])`
- `thresholdScaled(t) = clamp(12000 − floor(max(0, t−4800) × 1500 × 200 / (1000 × 300)), 9000, 12000)`; 승리 ⇔ `tiles × 100 × 200 ≥ thresholdScaled × totalLandTiles`

---

## 9. 테스트·스모크 결과 (2026-10-08)

- `npm test`: 5 파일 / 49 테스트 통과 — 맵 결정론·불변식·지형 쿼터(8~12인 × 시드 3), SHALLOW_QUOTA 동일성, 토폴로지, 경제 공식, threshold 곡선·정수 판정, tick 결정론(동일 입력 → 동일 출력 JSON), 입력 큐 정렬, 테크 수락/거절, threshold·last_standing·timeout 종료, threshold_update 11회·endgame_rush 1회.
- `npm run smoke`: 실제 ws 서버에서 hello → 방 생성 → 2번째 입장 → 권한 거절 → 시작(봇 6) → match_config/map_init/snapshot_full(0) → delta(1) → cmd_ack 3종 → pong → playerDeltas(5) → snapshot_full(25) → 관전자 부트스트랩 → 끊김 DISCONNECTED → 토큰 재접속·player_reconnected → 2초 동안 10 tick 확인. `SMOKE PASSED`.

---

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

## 11. 2차 호출 인계

- 채울 함수: `stage4/4a/4b/5/6/7/9/10`(tick.ts), `stage1`의 깃발·태세·동맹 분기(commands.ts), `garrisonUpkeepPermille`(economy.ts, 9단계 결과 1 tick 지연), 3단계 동맹 타이머.
- 이미 있는 것: `Flag` 전 필드(GDD 4.2, `makeFlag` 기본값), `BaseState{hpMilli,lastDamageTick,lockUntilTick,damagedThisTick}`(7단계가 `damagedThisTick=true`·`lastDamageTick=t`를 써야 8단계 회복이 멈춤), `setTileOwner`(유일 소유권 경로, tileChanges·baseTiles·lastLostTo 자동), `MapGraph.neighbors`/`distance`, `isClaimable`, Phase A 결과 타입 `FlagCombatPlan`/`PushPlan`, `DeltaTracker`의 flag* 필드, 상수 전부.
- 필요 시 추가: 경로 거리장(MapGraph 위), `front()/guard()`, `tileCost/defRefCost`(별도 함수), 예약 이벤트 송신과 이 문서 §5 확정.
- 프론트 영향: 1차 shape는 2차에서 **필드 추가만** 예정(제거·의미 변경 없음). `NOT_IMPLEMENTED`는 2차에서 소멸.
