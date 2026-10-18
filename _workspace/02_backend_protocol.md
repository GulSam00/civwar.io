# civwar.io 백엔드 프로토콜 · 구현 문서 (Phase 3 — GDD v4.2)

> **프론트엔드의 유일한 신뢰 소스.** 서버가 실제로 보내는 메시지와 이 문서가 다르면 버그다.
> 기준: **GDD v4.1 (사용자 승인 2026-10-09)** — v4.0 부록 A 재조정값 + v4.1 A-40~A-50. 타입 원본: `shared/src/protocol.ts`, 상수 원본: `shared/src/constants.ts`.
> 작성: 2026-10-08, multiplayer-backend-engineer. 프로토콜 버전 `PROTOCOL_VERSION = 1`.
> **2차 갱신(2026-10-08)**: 깃발·게이지·깃발 전투·태세·ZOC·상륙·기지 체력·동맹 구현. 1차 메시지·필드는 **하나도 바꾸지 않고 추가만** 했다(§12 변경 요약).
> **2026-10-18 갱신(사용자 결정 — `design-decisions.md` 2026-10-18 항목 8·6)**: **봇 이름 = 세력 이름**(`room_state.players[].nickname` 이 `"BOT n"` → 예 `"레이븐홀트 공국"`, 지명과 같은 양식, 매치 안 고유, 지명과 안 겹침), **`allyBreaks`**(플레이어가 시작한 동맹 파기 수 — `snapshot_full.players[]` 에 항상, `playerDeltas[]` 에는 바뀐 때만). **추가만, 형식 변경 없음. 단 `"BOT n"` 이름 패턴에 기대던 코드는 `isBot` 으로 바꿀 것** → §23.
> **v4.5 갱신(2026-10-15, 사용자 결정 — `design-decisions.md` 2026-10-15 + 01c 기동 노드 교체 승인)**: **해상 이동 폐지**(얕은 물도 통행 불가, 물 ≈ 10%, 육지 한 덩어리, 공식 맵 9장 재생성), 중립 점령비용 고정(√칸 항 폐기), 깃발 전투 손실률 1.5% → 0.9%, **기지 피해 상한 300 milli/tick**, **기지 생산 모델 정정**(생산 지역 폐기 → 기지 60칸분·수도 100칸분 + 영토 합산), 기지 ×1.5 태세 무관, 지명 양식(서양식 판타지), MOB-2B 철수 훈련·MOB-3B 급속 귀환, **방어 태세 깃발 적 땅 통과 금지**, **중립 노출 소모 절반**. **형식 변경이 있다(`production.regions` → `rows`) → §22 를 먼저 읽을 것.**
> **v4.4 갱신(2026-10-14, 사용자 결정 — `design-decisions.md` 2026-10-14)**: 기지 방어(깃발이 내 기지 칸 위에 서서 방어, 방어 태세면 지형 대신 ×1.5), 우클릭 = 항상 이동(`cmd_flag_retarget` 태세 = 도착지, 못 바꾸면 `pendingPosture`), **기지를 모두 잃으면 즉시 멸망 + 남은 땅 전부 합병**, 기지 생산력(점령 시 ×0.5, 선형 회복)·생산 지역 내역(`production`), 기지 지명(`map_init.baseNames`). **메시지·필드는 추가만, 규칙 의미 변경이 있다(탈락 조건·내 기지 클릭) → §21 을 먼저 읽을 것.**
> **v4.3 갱신(2026-10-11, 테크 트리 v4.3 — 사용자 승인 A-66~A-84 전부 ①, `01b_tech-tree-v4.3-proposal.md`)**: 테크 4축 × 3단계 → **7갈래 32노드**(노드당 부모 하나·스탯 하나, 효과는 덧셈). `cmd_buy_tech{nodeId}`, 스냅숏 `techMask`(uint32)·`techCount`, 델타 `playerDeltas[].techMask`, `tech_purchased.nodeId/techMask`, 거절 `PREREQ_MISSING`/`ALREADY_OWNED`, `match_config.constants.TECH_NODES`. **제거·의미 변경이 있다(구 `tech[4]`·`axis/tier`·`*_BY_TIER` 테크 상수 삭제) → §19 를 먼저 읽을 것.** 같은 날 **깃발 접촉(전투·ZOC·진척 유지) 8방향**(사용자 결정) — 메시지 변경 없음, 규칙만 → §20.
> **v4.2 갱신(2026-10-10, GDD v4.2 승인본 + 사용자 A-60 변경)**: 공격 = 깃발 옆 칸(쟁기, `halted`), 앵커 원 공격·중립 자동 전환 폐기, 지정 기지 회수(`cmd_flag_recall.baseTileId`), 귀환 취소 불가·ZOC 무시·자동 이탈 대기·귀환 ×1.5, 유지비 = 출전 깃발 전부(패주 제외), `FLAG_SPEED_BASE_MILLI` 140. **메시지·필드는 추가만, 의미 변경이 있다 → §18 을 먼저 읽을 것.**
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
    tech.ts               # v4.3 테크 순수 함수 (스탯 합산·가격·선행) — 서버·클라 공용
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
    map/placeNames.ts     # v4.4 지명 풀 120 + 시드 셔플 배정 (§21.5)
    map/generate.ts       # 맵 생성 + 불변식. v4.1: generateMap(seed, W, H, N, cfg) / generateMapForSize / generateMapForPlayers(테스트용)
    map/presets.ts        # v4.1: 공식 프리셋 맵 스키마 검증·checksum·MapCatalog·mapFromPreset·presetFromMap
    room/settings.ts      # v4.1: 방 설정 검증(applyRoomOptions)·room_state.settings 에코·pacingNote
    game/state.ts         # GameState / PlayerState / Flag(4.2 전 필드) / BaseState, setTileOwner
    game/economy.ts       # troopCap, regen, gold, flagCap, techCost, (upkeep 자리)
    game/production.ts    # v4.4 생산 지역(내 땅 BFS)·기지 생산력 반영 정산·분배 (§21.4)
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
| playerId 배정 | **룸 입장 시** 비어 있는 가장 작은 번호. **v4.1: 비공개 방은 카운트다운 시작 때 사람을 기존 번호 순서대로 1..H 로 다시 매기고**(빈 번호 제거) 봇을 H+1..N 에 붙인다(이름 = **세력 이름**, §23 — 구 `"BOT n"`). 공개 룸은 1..10 빈 번호를 봇으로 채운다 | 백엔드 결정 |
| 스폰 | `spawn[k]` → `playerId k+1`. 무작위 = 생성기 배치 순서, 프리셋 = `spawnSets[N]` 또는 `spawns[0..N-1]` | 백엔드 결정 / GDD 2.8 f |
| 방장 | 첫 입장자. 퇴장 시 남은 인간 중 playerId 최소 | GDD 7.2 |
| 카운트다운 시작 조건 (v4.1) | **비공개: 방장 `lobby_start_now` 만.** 공개: 정원(10) 도달 또는 첫 입장 후 30초(`PUBLIC_LOBBY_AUTOSTART_MS`) **또는 방장(첫 입장자, 퇴장 시 승계)의 `lobby_start_now`**(플레이테스트 후속 2026-10-10 — QA m-6 의 "공개 룸 NOT_HOST" 번복. 비방장은 `NOT_HOST`, 3초 카운트다운 동일). 공개 룸 설정 변경(`lobby_update_settings`)은 여전히 `BAD_ROOM_OPTIONS`. **`ready` 는 표시용**(자동 시작 조건 아님 — v4.0 의 "인간 전원 ready"·비공개 "정원 도달" 자동 시작 폐지) | GDD 2.8 h |
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

### lobby_list_rooms / lobby_join_listed (플레이테스트 후속 2026-10-10 — 메시지 추가)
```json
{ "type": "lobby_list_rooms" }
{ "type": "lobby_join_listed", "roomId": "r12", "spectate": false }
```
- `lobby_list_rooms` → 개인 `room_list`(§5). hello 이후 언제나(룸 안에서도) 가능. **세션당 1초 1회**(`ROOM_LIST_MIN_INTERVAL_MS`), 초과 → `error RATE_LIMITED`(코드 사용 시작).
- 목록은 **공개 룸만**(대기·카운트다운·진행·종료). 비공개 룸은 절대 싣지 않는다(코드로만 입장). 방 코드도 싣지 않는다 — 핸들은 `roomId`.
- `lobby_join_listed`: `roomId` 형식 `^r[0-9]{1,9}$`, `spectate` bool(생략 = false). 형식 위반 → `error BAD_MESSAGE`. 비공개·없는·정리된 룸 → `ROOM_NOT_FOUND`. `spectate:false` = `lobby_join_private` 와 같은 검증(`ROOM_IN_PROGRESS`·`ROOM_FULL`·`ALREADY_IN_ROOM`), `spectate:true` = `lobby_spectate` 와 같은 검증(`NOT_LOBBY` 등). 성공 응답도 각각과 같다(`room_state` / 부트스트랩).

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

### cmd_buy_tech — v4.3 (§19)
```json
{ "type": "cmd_buy_tech", "clientSeq": 12, "nodeId": 15 }
```
`nodeId` = `TECH_NODES[].id` (0..31, 정수). 구 `{ axis, tier }` 형식은 **v4.3 에서 폐기** — `nodeId` 가 없거나 범위 밖이면 `cmd_ack BAD_REQUEST`.
검증 순서: 플레이어 존재(`NOT_IN_GAME`) → 생존(`ELIMINATED`) → `nodeId` 범위(`BAD_REQUEST`) → 이미 보유(**`ALREADY_OWNED`**) → 부모 미보유(**`PREREQ_MISSING`**, T1 은 부모 없음) → `gold ≥ cost`(`INSUFFICIENT` — 기존 코드 재사용). 성공 시 골드 차감·`techMask` 비트 세움·스탯 캐시 재계산(즉시 발효, 되돌릴 수 없음) → `cmd_ack accepted` + 룸 `tech_purchased`.
`cost = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + TECH_PROGRESSIVE_COEF_PERMILLE × n) / 1000)` = `floor([160,360,700][tier-1] × (1000 + 60 × n) / 1000)`, `n` = 그 플레이어가 지금까지 산 노드 수(갈래 무관, = `techCount`).

### 깃발 명령 (2차 — GDD 4.3 / 4.3a / 4.4 / 4.15 g)

스키마는 GDD 7.2 그대로(1차 문서와 동일). 형식 검증(정수·범위: unit 0..2, posture 0|1, troops 정수, tileId uint32, playerId 1..12 — 위반은 `BAD_REQUEST`. 그래서 **아래 표의 `BAD_UNIT` 은 WS 경로에선 나오지 않는 예약 코드**, QA m-2)을 통과하면 다음 tick 1단계에서 아래 순서로 검증한다. **성공 시 `cmd_ack`에 `flagId`와 결과 `posture`가 붙는다.**

```json
{ "type": "cmd_flag_issue", "clientSeq": 1, "unit": 2, "troops": 100, "anchorTileId": 1743, "originBaseTileId": null }
→ { "type": "cmd_ack", "clientSeq": 1, "accepted": true, "flagId": 1, "posture": 0 }
{ "type": "cmd_flag_retarget", "clientSeq": 2, "flagId": 7, "anchorTileId": 2500 }
{ "type": "cmd_flag_recall", "clientSeq": 3, "flagId": 7 }
{ "type": "cmd_flag_recall", "clientSeq": 5, "flagId": 7, "baseTileId": 2316 }   // v4.2: 귀환 기지 지정 (생략·null = 자동)
{ "type": "cmd_set_posture", "clientSeq": 4, "flagId": 7, "posture": 1 }
```

| 명령 | 검증 순서 (먼저 걸린 코드 1개 회신) | 효과 |
|---|---|---|
| `cmd_flag_issue` | `ELIMINATED` → `BAD_REQUEST`(tileId 범위 밖·troops 비정수) → `NO_SLOT`(내 깃발 수 ≥ flagCap — 패주 귀환 중인 깃발도 슬롯 점유) → `BAD_UNIT` → `WATER`(DEEP·SHALLOW) → `OUT_OF_RANGE`(내 타일까지 거리 > 40) → `TOO_SMALL`(< 40) → `ALLIED`(앵커 소유자가 ACTIVE/BREAKING 동맹) → `NOT_BASE` / `NOT_OWNED_BASE`(originBaseTileId 지정 시) → `INSUFFICIENT` | 기본 태세: 내 땅 앵커 = DEFEND(`targetOwnerId = 254 ANY_HOSTILE`), 그 외 ATTACK(`targetOwnerId` = 앵커 소유자, 중립 0). 풀 차감 `ceil(troops × CONVERT_<unit> / 1000)` (**v4.3**: 플레이어 스탯, 무테크 = `UNIT_CONVERT_PERMILLE` 1000/1000/1150, CAV-2A 기병 1070. 구 전 병종 편성 효율 `MOB_CONVERT` 폐기). 슬롯 = 최소 미사용 번호. 출발 = 지정 기지 / 앵커 최근접 내 기지 / (기지 없음) 수도 최근접 내 타일. → `flag_issued` |
| `cmd_flag_retarget` | `NO_FLAG`(없음·남의 깃발) → `ROUTED` → `RETURNING`(**v4.2: 귀환 중이면 전투 중이어도 항상 거절** — QA I-2 수락 경로 폐기 [A-62]) → `LOCKED`(재지정 경직 15 tick 중 — **이탈 대기 중이면 허용**) → `BAD_REQUEST` → `WATER` → `ALLIED` → `OUT_OF_RANGE` | 앵커 교체, 기본 태세 재파생 — **v4.4 (§21.2): 태세 = 도착지(내 땅·내 기지 = DEFEND, 적·중립 = ATTACK). 쿨타임 중·전투 중이면 `pendingPosture` 로 미뤘다가 자동 적용. 내 기지 칸도 "그 기지 위로 가서 방어"(회수 아님)**, `postureManual=false`, `state=MARCHING`, `lockUntilTick = t+15`, 진척도·예산 0. **전투 중이면 이탈 대기 15 tick 개시**. → `flag_retargeted` (+태세가 바뀌면 `flag_posture_changed auto:true`, +전투 중이면 `flag_disengage_started`) |
| `cmd_flag_recall` | `NO_FLAG` → `ROUTED` → `RETURNING`(**v4.2: 귀환 중이면 항상 거절**, [A-62]) → (**v4.2** `baseTileId` 지정 시) `NOT_BASE`(기지 칸 아님·범위 밖) → `NOT_OWNED_BASE`(내 기지 아님) | `state=RETURNING`, `returnBaseTileId = baseTileId ?? null`, 귀환지 = recallTarget(지정 기지 우선). 깃발은 **실제로 걸어서** 귀환지까지 간다(속도 ×1.5, ZOC 무시). 도착 시 잔여 × 85% 풀 환급. **전투 중(비귀환)이면 이탈 대기**. → `flag_recalled` (+`flag_disengage_started{auto:false}`) |
| `cmd_set_posture` | `NO_FLAG` → `ROUTED` → `RETURNING`(**v4.2 추가** [A-62]) → `DISENGAGING` → `IN_COMBAT` → `SAME_POSTURE` → `POSTURE_COOLDOWN`(`tick < postureCooldownUntilTick`) | 즉시 적용(같은 tick 4a 가 새 태세로 교전 판정), 쿨타임 `t + 25`, 진척도·예산·정체 리셋, `targetOwnerId` 재계산 = `owners[anchor] == 소유자 ? 254 : owners[anchor]`(1단계 처리 시점), `postureManual=true`. → `flag_posture_changed auto:false`(결과 `targetOwnerId` 포함) |

`recallTarget`: **v4.2 ⓪ 지정 기지(`returnBaseTileId`, 아직 내 소유일 때)** → ① 출발 타일(아직 내 소유) → ② 내 기지 중 현재 위치 최근접(동률 tileId ASC) → ③ 수도(내 소유면) → ④ 최근접 내 타일. **매 tick 재평가**. 지정 기지를 잃은 tick 에 `returnBaseTileId = null`(델타 `flagReturnBase`로 통지) → ①~④ 폴백. **되찾아도 다시 그 기지로 가지 않는다.** IDLE 2분 자동 회수는 `returnBaseTileId = null`. 패주(`flag_routed`)는 기존 지정을 유지한다(§10-84).

**v4.2 귀환(RETURNING, 패주 포함) 규칙** [A-62][A-63]: ① `cmd_flag_retarget`·`cmd_flag_recall`·`cmd_set_posture` 전부 `RETURNING` 거절(패주는 `ROUTED`가 먼저) ② 이동 속도 × `RETURN_SPEED_PERMILLE`(1500)/1000 ③ ZOC 무시(대치 안 됨) ④ 깃발 전투 간선의 **공격 쪽이 될 수 없다** — 귀환 깃발(태세 무관)은 지나가며 싸움을 걸지 않고, 비귀환 적 공격 태세 깃발이 붙을 때만 전투 ⑤ 전투에 붙잡히면(비패주) 서버가 같은 tick 4b 에 **자동 이탈 대기**(15 tick, 실효값 ×0.5) → `flag_disengage_started{auto:true}` → 만료 `flag_disengaged{broke_away}` → 귀환 계속 ⑥ 공격·정지 점령 없음.

### 동맹 명령 (2차 — GDD 6.2)

```json
{ "type": "cmd_ally_propose", "clientSeq": 5, "targetPlayerId": 3 }
{ "type": "cmd_ally_respond", "clientSeq": 6, "proposalId": 1, "accept": true }
{ "type": "cmd_ally_break", "clientSeq": 7, "allyPlayerId": 3 }
```

| 명령 | 검증 순서 | 효과 |
|---|---|---|
| `cmd_ally_propose` | `BAD_TARGET`(자기·없음·탈락) → `ALLY_CUTOFF`(t ≥ `ALLIANCE_CUTOFF_TICK` = 7800, §24) → `ALLY_FROZEN`(lockout 후 재체결 금지 중) → `ALREADY_ALLIED`(ACTIVE/BREAKING) → `ALLY_LIMIT`(나 또는 상대가 이미 2개 — ACTIVE+BREAKING) → `ALLY_PENDING`(같은 상대에게 유효 제안 있음) | 상대가 나에게 낸 유효 제안이 있으면 **즉시 성립**(`ally_formed`). 아니면 제안 생성(`ally_proposed`, 만료 t+150) |
| `cmd_ally_respond` | `NO_PROPOSAL`(없음·만료·내게 온 것 아님) → (accept=false 면 바로 거절 처리) → `BAD_TARGET`(제안자 탈락) → 위 cutoff/frozen/allied/limit | accept: `ally_formed`. decline: `ally_proposal_closed{reason:"declined"}`. 둘 다 `cmd_ack accepted:true` |
| `cmd_ally_break` | `NOT_ALLIED`(ACTIVE 동맹 아님 — BREAKING 포함) → `MIN_DURATION`(성립 후 300 tick 미만) | `BREAKING`, `breakAtTick = t+150` → `ally_break_started`. 150 tick 뒤 3단계에서 `ally_broken{reason:"cooldown_elapsed"}` |

동맹 성립 시: 상대를 `targetOwnerId`로 둔 **양측 ATTACK 깃발(MARCHING/ENGAGED)** 은 즉시 `IDLE` + 게이지·예산 0 → `flag_idle{reason:"allied"}`. **v4.2**: 동맹 칸은 `marchFront`에서 빠지므로 다시는 공격 대상이 아니다. 단 IDLE 공격 깃발은 옆에 비동맹 칸(중립·제3자)이 있으면 **같은 tick 4단계에서 재점화**(`flag_engaged`)해 그 칸을 민다(A-59 문자 그대로, §10-85).
**동맹 판정 `isAlly(a,b)` = ACTIVE 또는 BREAKING** — front 대상 제외, 깃발 전투 적대 판정·편 구성, ZOC, 노출 소모(동맹 땅 위 소모 없음)에 모두 같은 함수를 쓴다.

### emote / ping
```json
{ "type": "emote", "code": 3 }
{ "type": "emote", "code": 3, "targetPlayerId": 4 }
{ "type": "ping", "clientTime": 1728380000000 }
```
emote: IN_GAME 멤버만, 정수 0..`EMOTE_CODE_MAX`(15), 세션당 1초 1회. 위반은 **조용히 무시**. ping → 즉시 `pong`.
`targetPlayerId?`(§26): 대상 이모트 — 선택. 형식은 1..12 정수(아니면 `error BAD_MESSAGE`). 그 판에 없는 자리·자기 자신이면 이모트 전체를 조용히 무시(1초 제한도 소모 안 함). 탈락한 플레이어도 대상이 될 수 있다.

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
    { "playerId": 3, "sessionId": null, "nickname": "레이븐홀트 공국", "isBot": true, "isHost": false, "ready": true, "status": "LOBBY_WAITING" }
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
  "endgameRush": { "tick": 7800, "costMultPermille": 600 },
  "thresholdCurve": { "startPct": 60, "decayStartTick": 6000, "decayPerMinPermille": 3500, "floorPct": 25, "scale": 200 },
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
**v4.4 `baseNames: string[]`(추가, 항상 존재)** — `bases` 와 같은 순서·같은 길이의 지명(수도 포함, 매치 안 고유). §21.5.

### snapshot_full (룸: t % 25 == 0, 그리고 시작 tick 0 / 개인: 입장·재접속·관전 시)
```json
{
  "type": "snapshot_full", "tick": 25,
  "owners": [0,512,3,2,0,87,"..."],
  "players": [{ "id": 1, "tiles": 9, "troops": 164, "gold": 200, "goldWeight": 2700, "upkeepPm": 0, "techMask": 0, "techCount": 0, "flagCap": 3, "alive": true, "connected": true }],
  "flags": [],
  "bases": [{ "tileId": 431, "ownerId": 0, "hpPct": 100 }],
  "alliances": [],
  "allyProposals": [], "allianceFreezeUntilTick": null, "lockoutDissolveTick": null,
  "thresholdPct": 60, "ticksRemaining": 9575, "endgameRushActive": false
}
```
- `players`는 id 오름차순 전원(탈락자 포함).
- `flags[]` 항목 shape (flagId ASC):
  `{ id, ownerId, slotIndex, unit, posture, troops, posTileId, anchorTileId, targetOwnerId, state:"MARCHING|ENGAGED|RETURNING|IDLE", targetTileId|null, progressPct(0..99), stalled, inCombat, routed, blocked, disengaging, postureCooldownUntilTick, disengageUntilTick|null, breakaway, halted, returnBaseTileId|null }`
  — **2차 추가 필드: `disengageUntilTick`, `breakaway`**. **v4.2 추가 필드(항상 존재)**: `halted`(bool — 행군 중 정지 점령, 아래), `returnBaseTileId`(지정 귀환 기지, `null` = 자동). `targetOwnerId` 254 = ANY_HOSTILE — **v4.2: 규칙에 쓰이지 않는 표시용**(발령·재지정 시 앵커 소유자).
  - **v4.2 깃발 상태 읽는 법 (공격 태세)**: `MARCHING ∧ ¬halted` = 걷는 중(공격 안 함) / `MARCHING ∧ halted` = **가는 길 옆 칸 정지 점령**("진군 중 점령") / `ENGAGED` = **앵커 칸에 서서 옆 칸 점령**("앵커 점령") / `IDLE` = 앵커 칸 옆에 먹을 칸 없음 — **옆 칸이 다시 적·중립이 되면 그 자리에서 재점화**(이동 없음), 2분(600 tick) 뒤 자동 귀환. 공격 대상은 언제나 **깃발 현재 칸의 이웃 중 점령 가능·비동맹(중립 포함) 칸**뿐(`marchFront`) — **앵커 반경 6 원 공격은 폐기**. `targetTileId` 는 그 이웃 중 하나. 방어 태세는 이동만 하고 공격하지 않는다(방어 원 반경 6 = `guard`는 유지).
  ```json
  { "id": 1, "ownerId": 1, "slotIndex": 0, "unit": 2, "posture": 0, "troops": 88, "posTileId": 1923, "anchorTileId": 1743,
    "targetOwnerId": 0, "state": "ENGAGED", "targetTileId": 1833, "progressPct": 37, "stalled": false, "inCombat": false,
    "routed": false, "blocked": false, "disengaging": false, "postureCooldownUntilTick": 0, "disengageUntilTick": null, "breakaway": false }
  ```
- `alliances[]` 항목: `{ a, b, state:"ACTIVE|BREAKING", sinceTick, breakAtTick|null }` (a<b, (a,b) ASC).
- **2차 추가 최상위 필드**: `allyProposals: [{ proposalId, fromPlayerId, toPlayerId, expireTick }]`(proposalId ASC), `allianceFreezeUntilTick: number|null`, `lockoutDissolveTick: number|null`.
- `hpPct = floor(hpMilli × 100 / 15000)`.
- **v4.4 추가 (§21)**: `bases[].prodPm`(기지 생산력 ‰), `flags[].pendingPosture`(0|1|null), 최상위 `production: PlayerProduction[]`(플레이어별 생산 지역 내역).

### snapshot_delta (룸, 매 tick)
```json
{
  "type": "snapshot_delta", "tick": 26,
  "tileChanges": [[2413, 1]],
  "playerDeltas": [],
  "flagMoves": [], "flagStats": [], "flagProgress": [], "flagTargets": [],
  "baseHp": [], "flagsGone": [],
  "thresholdPct": 59.995,
  "flagFlags": [[1, 0, 65, 0]],
  "flagReturnBase": []
}
```
- **모든 배열 필드는 항상 존재**(비어 있을 수 있음). `thresholdPct`만 값이 바뀐 tick에 존재(옵셔널).
- `playerDeltas`: `t % 5 == 0`일 때만, **표시값(`tiles,troops,gold,goldWeight,upkeepPm,techMask`)이 마지막 송신 이후 바뀐 플레이어만**. 항목 `{id,tiles,troops,gold,goldWeight,upkeepPm,techMask}` (**v4.3: `techMask` 추가** — 구매 즉시 반영은 `tech_purchased` 이벤트).
- **골드 수입·유지비 표시 (v4.2 A-60 변경 — "초당 골드 소모")**: `upkeepPm`(0..700) = 이번 tick 골드 정산에 쓴 유지비 비율(그로스 대비 ‰). **v4.2: 출전한 깃발 전부(태세·상태 무관 — 행군·정지 점령·앵커·IDLE·귀환), 패주(`routed`) 깃발만 제외**가 과금 대상이다. 클라이언트 계산(서버와 같은 정수식, 상수는 `match_config.constants`):
  ```
  goldPm    = techStatValues(player.techMask)[TECH_STAT.GOLD]       // v4.3 (§19) — 무테크 1000, ECO-1/2A/3A 합산
  grossMilli = floor(goldWeight × GOLD_RATE_PERMILLE × goldPm / 1e9)   // milli 골드 / tick
  upkeepMilli = floor(grossMilli × upkeepPm / 1000)                 // 유지비 milli / tick
  netMilli    = grossMilli − upkeepMilli                            // 실제 골드 증가 milli / tick (≥ 그로스의 30%)
  골드/초 = milli/tick × (1000 / TICK_MS) / 1000 = milli/tick × 5 / 1000
     소모 골드/초 = upkeepMilli × 0.005,  순수입 골드/초 = netMilli × 0.005,  그로스 골드/초 = grossMilli × 0.005
  ```
  `upkeepPm` 은 `goldWeight`·`techMask` 와 같은 주기(델타 5 tick, 바뀐 때만 / full 5초)로 온다. 발령 전 미리보기("이 깃발을 내면 소모가 얼마")는 `w = Σ UPKEEP_WEIGHT_<unit>`(내 비패주 깃발 전부 + 새 깃발), `upkeepPm' = min(700, floor(max(0, w − 1000) × UPKEEP_COEF / 1000))` 로 같은 식에 넣으면 된다(§8). **v4.3**: 가중치·계수는 플레이어 스탯(무테크 창 600·검 1000·기 1600 / 계수 90, SPE-2A 창 450, CAV-3 기 1300, ECO-2B 계수 72 — §19).
- `flagMoves [flagId,posTileId]`: posTileId가 바뀐 깃발(매 tick). `flagStats [flagId,troops,state]`: `t % 5 == 0`, 바뀐 것만. `flagProgress [flagId,pct]`: **v4.2: `progressPct > 0` 인 깃발 전부 + ATTACK 태세 `ENGAGED`·`halted` 깃발(0 이어도) 매 tick, 그리고 0 이 된 tick 1회** — "목록에 없는 깃발 = 0" 규칙이 그대로 성립한다(v4.1 까지는 ATTACK·ENGAGED 만). `flagTargets [flagId,targetTileId|null]`: 바뀐 것만. `baseHp [tileId,hpPct]`: `t % 5 == 0`, 바뀐 기지만. `flagsGone [flagId]`.
- 같은 tick에 `snapshot_delta` → `snapshot_full` 순으로 온다. full을 받으면 그 상태로 덮어쓰면 된다.
- **2차 변경(추가만)**:
  - `flagStats`는 `t % 5 == 0`의 변경분에 더해 **교전 중(`inCombat`) 깃발은 매 tick**, **새 깃발은 첫 tick 즉시** 실린다(GDD 7.3 "교전 깃발은 매 tick 병력 필드").
  - **`flagFlags: [flagId, posture, bits, postureCooldownUntilTick][]`** — 태세·비트·쿨타임 중 하나라도 바뀐 깃발만, 매 tick. 항상 존재(빈 배열 가능).
    `bits` (`shared` 의 `FLAG_BIT`): `IN_COMBAT 1 | ROUTED 2 | BLOCKED 4 | DISENGAGING 8 | BREAKAWAY 16 | STALLED 32 | HALTED 64`(**v4.2 추가** — 값 범위 0..127).
  - **v4.4 (§21) 추가, 항상 존재**: `baseProd: [tileId, prodPm][]`(5 tick 마다 바뀐 기지만), `production: PlayerProduction[]`(5 tick 마다 내역이 바뀐 플레이어만 — 그 플레이어 내역 전체 교체), `flagFlags` 비트 **`POSTURE_PENDING 128`**(값 범위 0..255).
  - **`flagReturnBase: [flagId, returnBaseTileId|null][]` (v4.2 추가, 항상 존재)** — 지정 귀환 기지가 바뀐 깃발만(지정 회수 수락 tick, 지정 기지 상실로 null 이 된 tick). 새 깃발은 `null` 이 기본이라 싣지 않는다. 귀환 화살표: `returnBaseTileId ?? flag_recalled/flag_routed.returnTileId`.
  - 새 깃발은 `flag_issued` 이벤트 + 같은 tick 델타의 `flagMoves`/`flagStats`/`flagFlags`(첫 등장)로 알 수 있다. 사라진 깃발은 `flagsGone` + `flag_ended`.

### room_list (개인 — 플레이테스트 후속)
```json
{ "type": "room_list", "serverTime": 1760000000000, "rooms": [
  { "roomId": "r12", "phase": "LOBBY", "map": { "kind": "random", "size": "M", "water": { "waterMode": "BORDER_ONLY", "shallowPermille": 1000 } },
    "mapName": null, "width": 100, "height": 60, "humans": 2, "bots": 8, "maxPlayers": 10, "spectatorCount": 0,
    "elapsedMs": 4200, "autoStartMs": 25800, "joinable": true, "spectatable": false, "botDifficulty": "NORMAL", "thumbnail": null },
  { "roomId": "r9", "phase": "IN_GAME", "map": { "kind": "preset", "mapId": "official-m-01" }, "mapName": { "ko": "보통 맵 1", "en": "Medium 1" },
    "width": 100, "height": 60, "humans": 1, "bots": 9, "maxPlayers": 10, "spectatorCount": 3, "elapsedMs": 412000, "autoStartMs": null, "joinable": false, "spectatable": true,
    "botDifficulty": "HARD", "thumbnail": null },
  { "roomId": "r7", "phase": "IN_GAME", "map": { "kind": "random", "size": "M", "water": { "waterMode": "BORDER_ONLY", "shallowPermille": 1000 } }, "mapName": null,
    "width": 100, "height": 60, "humans": 1, "bots": 9, "maxPlayers": 10, "spectatorCount": 0, "elapsedMs": 98000, "autoStartMs": null, "joinable": false, "spectatable": true,
    "botDifficulty": "NORMAL", "thumbnail": { "width": 50, "height": 30, "scale": 2, "terrain": [0, 52, 1, 3, "…"], "bases": [212, 340, "…"] } } ] }
```
| 필드 | 의미 |
|---|---|
| `map` | `room_state.settings.map` 과 같은 에코 |
| `humans` / `bots` | 사람 자리 수(인게임은 끊긴 자리 포함) / LOBBY: 지금 시작하면 채울 봇 수(`maxPlayers − 사람`), 그 외 실제 봇 자리 수 |
| `elapsedMs` | LOBBY·COUNTDOWN: 룸 생성 후 경과, IN_GAME·GAME_OVER: `tick × TICK_MS` |
| `autoStartMs` | `room_state.autoStartMs` 와 같은 값 |
| `joinable` / `spectatable` | `LOBBY ∧ 빈자리` / `IN_GAME ∨ GAME_OVER` |
| `botDifficulty` (§26) | 방 설정 봇 난이도 `EASY` · `NORMAL` · `HARD` — 항상 |
| `thumbnail` (§26) | 무작위 맵 방이고 맵이 만들어진 뒤(IN_GAME·GAME_OVER)만 축소 지형 `MapThumbnail`, 그 외 `null` — 항상 실린다. 형식 §26.2 |
정렬 = 입장 가능 → 대기(가득·카운트다운) → 진행 중(경과 짧은 순) → 종료, 최대 50개(`ROOM_LIST_MAX`). 구독·자동 갱신 없음 — 클라이언트가 다시 요청한다(로비 UI 는 열려 있는 동안 5초마다).

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
| `tech_purchased` | `{ "type":"tech_purchased","tick":120,"playerId":1,"nodeId":15,"cost":160,"newFlagCap":3,"techMask":32768 }` | 구매 성공 tick. **v4.3**: `axis`/`tier` 삭제 → `nodeId`, `techMask`(구매 후 보유 마스크) 추가 |
| `threshold_update` | `{ "type":"threshold_update","tick":6000,"thresholdPct":60 }` | t ≥ 6000 이고 (t−6000) % 300 == 0, 바닥(25%) 도달 tick(9000)까지 = 총 11회 (§24) |
| `endgame_rush` | `{ "type":"endgame_rush","tick":7800,"costMultPermille":600 }` | t == 7800 (§24), 1회. 이후 `snapshot_full.endgameRushActive = true` |
| `player_eliminated` | `{ "type":"player_eliminated","tick":3000,"playerId":4,"byPlayerId":2,"annexedTiles":312 }` | **v4.4 (§21)**: 기지(수도 포함)를 모두 잃은 tick(12단계 — 그 tick 의 `base_captured` 뒤). `byPlayerId` = 마지막 기지를 점령해 **남은 땅 전부를 합병한** 플레이어(없으면 null → 땅은 중립). `annexedTiles`(추가) = 넘어간 칸 수, 칸 변경은 같은 tick `snapshot_delta.tileChanges` |
| `bot_takeover` | `{ "type":"bot_takeover","tick":900,"playerId":2 }` | 끊긴 지 450 tick |
| `player_reconnected` | `{ "type":"player_reconnected","tick":910,"playerId":2 }` | 끊긴 플레이어가 토큰으로 복귀 |
| `emote_broadcast` | `{ "type":"emote_broadcast","tick":77,"playerId":1,"code":3 }` · 대상 이모트 `{ …,"code":3,"targetPlayerId":4 }` (§26 — 대상 있을 때만) | 수신 즉시(현재 tick 표기) |
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
| `flag_issued` | `{"type":"flag_issued","tick":3,"flagId":1,"playerId":1,"slotIndex":0,"unit":2,"posture":0,"troops":100,"originTileId":2103,"anchorTileId":1743,"targetOwnerId":0,"etaTick":32,"engageEtaTick":27}` | 발령 수락. `etaTick` = 현재 속도로 앵커까지 걸었을 때 도착 tick **추정**(ZOC·전투 무시 — **v4.2: 정지 점령 시간도 뺀 순수 이동 ETA. 공격 태세는 실제 도착이 훨씬 늦다**). **`engageEtaTick`(프론트 QA m-4, 필드 추가)** = 같은 경로에서 MARCHING 정지 판정(**v4.2 ATTACK: 그 칸의 옆 칸에 적·중립 칸이 생김 = 정지 점령 시작** / DEFEND: `defendArrived` / 앵커 도달)이 처음 서는 tick 추정 — 발령 시점 owners 기준, ZOC·전투·영토 변화 무시. 실측(M10 NORMAL 2500 tick, n=331) 실제 `flag_engaged` 대비 평균 오차 5.2 tick(etaTick 26.7) |
| `flag_retargeted` | `{"type":"flag_retargeted","tick":40,"flagId":1,"anchorTileId":2500,"targetOwnerId":3,"posture":0,"resumeTick":55,"etaTick":88,"engageEtaTick":80,"auto":false}` | 재지정 수락(`auto:false`, `resumeTick` = 경직 해제 tick, `engageEtaTick` = `resumeTick` + 정지 점령 시작 추정). **v4.2: `auto:true`(4.5 중립 자동 전환)는 더 이상 송신하지 않는다**(필드는 유지) |
| `flag_recalled` ⟵ **백엔드 추가** | `{"type":"flag_recalled","tick":41,"flagId":1,"returnTileId":2103}` | 회수 수락, IDLE 타임아웃(600 tick) 자동 회수. `returnTileId` = 그 시점 귀환지(v4.2: 지정 기지면 그 기지). 귀환지는 매 tick 재평가되므로 지정 기지 상실 시 `flagReturnBase [id, null]` 뒤로는 recallTarget 폴백 |
| `flag_engaged` | `{"type":"flag_engaged","tick":10,"flagId":1,"posture":0,"frontTileCount":8}` / `{"type":"flag_engaged","tick":12,"flagId":2,"posture":1,"guardTileCount":34}` | MARCHING(또는 v4.2 IDLE 재점화) → ENGAGED. ATTACK 이면 `frontTileCount`만, DEFEND 이면 `guardTileCount`만. **v4.2: `frontTileCount` = 그 순간 깃발 옆 칸 수(`|marchFront|`, 사각 ≤ 4)**. 공격 깃발은 **앵커 칸에 섰을 때만** ENGAGED 가 된다 — 가는 길 정지 점령은 `halted` 비트(이벤트 없음). IDLE 공격 깃발이 옆 칸이 다시 생겨 재점화할 때도 이 이벤트(이동 없음) |
| `flag_stalled` | `{"type":"flag_stalled","tick":70,"flagId":1,"tileId":1833}` | **v4.1 의미**: ENGAGED(**v4.2: 또는 halted**)·공격 태세·비전투 깃발이 25 tick 연속 한 칸도 못 민(AP 0·타깃 없음·잠긴 기지) 시점 1회. `tileId`는 `targetTileId`(없으면 `null`). 되돌리기 상쇄는 더 이상 없다 |
| `flag_progress_lost` | `{"type":"flag_progress_lost","tick":15,"flagId":2,"tileId":1833,"cause":"decayed"}` | 게이지 레이스 패배(`captured_by_other`) / 진척 > 0 인데 타깃이 바뀜(`target_lost`) / **v4.1 `decayed`: 자동 감소로 0 도달(1회). 이때 깃발의 `targetTileId`는 유지된다(다시 밀면 같은 칸에서 0부터)** |
| `flag_idle` | `{"type":"flag_idle","tick":21,"flagId":1,"reason":"front_cleared","autoRecallTick":621}` | `front_cleared`(**v4.2: 공격 깃발이 앵커 칸에서 옆 칸을 다 먹음 · 앵커 칸에 닿았는데 옆에 먹을 칸 없음**) / `guard_lost` / `allied` / **`unreachable`(v4.5 §22.12: 방어 태세 깃발이 적 땅 때문에 앵커에 못 가 "적 땅 바로 앞"에서 멈춤)** |
| `flag_ended` | `{"type":"flag_ended","tick":90,"flagId":1,"reason":"recalled","refunded":76}` | `recalled`(85% 환급) / `routed_returned`(0) / `exhausted`(0) / `attrited`(0) / `eliminated`(0). `refunded`는 정수 병력 |
| `combat_started` | `{"type":"combat_started","tick":31,"groupKey":4,"flagIds":[4,7],"sides":[{"sideKey":1,"ownerIds":[1],"troops":1000,"power":1000},{"sideKey":2,"ownerIds":[2],"troops":1000,"power":1300}]}` | 무리가 새로 생기거나 기존 무리에 깃발이 합류. `troops`·`power`는 그 tick 손실 적용 **전** 값. `power` = 편 실효값 W(permille) — 교환비 k = W_방어 / W_공격 |
| `combat_ended` | `{"type":"combat_ended","tick":129,"groupKey":4,"winnerSideKey":2,"routedFlagIds":[4]}` | 살아남은(패주·이탈 완료 제외) 편이 1개 이하가 된 tick. 동시 0 이면 `winnerSideKey:null`. 무리가 그냥 해체(상대 소멸·동맹 성립 등)되면 다음 tick 에 `winnerSideKey:null` |
| `flag_routed` | `{"type":"flag_routed","tick":129,"flagId":4,"returnTileId":2103}` | 병력 0 → 자동 귀환. 이후 모든 명령 `ROUTED`. **이탈 대기 중 패주하면 `disengageUntilTick = null`(별도 `flag_disengaged` 없음, QA m-8)** |
| `flag_posture_changed` | `{"type":"flag_posture_changed","tick":21,"flagId":1,"posture":1,"cooldownUntilTick":46,"auto":true,"targetOwnerId":254}` | 수동 전환(`auto:false`) / 재지정에 따른 기본 태세 재파생(`auto:true`). **QA I-1 추가 필드 `targetOwnerId`** = 전환 후 값(`owners[anchor] == 소유자 ? 254 : owners[anchor]`, 1단계 처리 시점) — 클라이언트는 이 값으로 덮어쓴다 |
| `flag_blocked` / `flag_unblocked` | `{"type":"flag_blocked","tick":5,"flagId":2,"byFlagIds":[1]}` / `{"type":"flag_unblocked","tick":31,"flagId":2}` | 대치(ZOC 정지) 비트가 바뀐 tick (4b 끝). `byFlagIds` = 다음 칸에 ZOC 를 거는 적 방어 태세 깃발 |
| `flag_disengage_started` | `{"type":"flag_disengage_started","tick":2,"flagId":2,"untilTick":17,"auto":false}` | 전투 중 재지정·회수 수락(`auto:false`) / **v4.2 `auto:true`(필드 추가, 항상 존재)**: 귀환(RETURNING·비패주) 깃발이 전투에 붙잡혀 서버가 자동 개시 — "귀환 중 붙잡힘, 3초 뒤 이탈" 표시 |
| `flag_disengaged` | `{"type":"flag_disengaged","tick":17,"flagId":2,"reason":"broke_away"}` | `broke_away`(대기 완료 → breakaway) / `combat_over`(대기 중 무리 소멸) |
| `base_captured` | `{"type":"base_captured","tick":3,"tileId":1290,"fromPlayerId":0,"toPlayerId":1,"newHpPct":50,"newProdPm":500}` | 기지 체력 0 → 함락. **v4.4 `newProdPm`(추가)** = 함락 직후 생산력 ‰(직전 값 × 0.5, §21) |
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
| `INSUFFICIENT` | 골드/병력 부족 (**v4.3 테크 골드 부족도 이 코드** — 별도 `NOT_ENOUGH_GOLD` 를 만들지 않았다) | ✅(테크) |
| `BAD_REQUEST` | 형식 오류 (**백엔드 추가**) | ✅ |
| `NOT_IN_GAME` | 인게임 멤버가 아님 (**추가**) | ✅ |
| `TECH_ORDER` | ~~선행 단계 미구매 또는 이미 구매~~ — **v4.3 부터 송신하지 않음**(아래 둘로 분리, 타입만 호환용으로 유지) | ✗ |
| `PREREQ_MISSING` | **v4.3** `cmd_buy_tech`: 부모 노드(`TECH_NODES[nodeId].parent`) 미보유 | ✅ |
| `ALREADY_OWNED` | **v4.3** `cmd_buy_tech`: 이미 보유한 노드 | ✅ |
| `RATE_LIMITED` | tick당 명령 초과 (**추가**) | ✅ |
| `NOT_IMPLEMENTED` | 1차 미구현 명령 — **2차 소멸(송신 안 함)** | ✗ |
| `NO_SLOT` `BAD_UNIT` `WATER` `ALLIED` `OUT_OF_RANGE` `TOO_SMALL` `NO_FLAG` `RETURNING` `LOCKED` `NOT_BASE` `NOT_OWNED_BASE` `ROUTED` `IN_COMBAT` `DISENGAGING` `POSTURE_COOLDOWN` `SAME_POSTURE` | GDD 7.2/7.3 (§4 표). **v4.2**: `RETURNING` = 귀환 중 깃발에 대한 재지정·회수·태세 전환 전부(전투 중 포함). `NOT_BASE`/`NOT_OWNED_BASE` = `cmd_flag_recall.baseTileId` 에도 사용 | ✅ 2차 |
| `BAD_TARGET` `ALLY_LIMIT` `ALLY_CUTOFF` `ALLY_FROZEN` `ALREADY_ALLIED` `ALLY_PENDING` `NO_PROPOSAL` `NOT_ALLIED` `MIN_DURATION` | 동맹 거절 (**백엔드 추가** — GDD 6.2 에 코드 없음) | ✅ 2차 |

### 6.2 `error.code`

`BAD_MESSAGE` `BAD_VERSION` `NOT_HELLO` `ALREADY_HELLO` `BAD_NICKNAME` `BAD_TARGET_PLAYERS`(예약, 미사용) `ROOM_NOT_FOUND` `ROOM_FULL` `ROOM_IN_PROGRESS` `ALREADY_IN_ROOM` `NOT_IN_ROOM` `NOT_HOST` `NOT_LOBBY` `RATE_LIMITED`(플레이테스트 후속부터 `lobby_list_rooms` 1초 제한에 사용). 전부 백엔드 정의(GDD는 `{code,message}` shape만 규정).
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
| 2 자원 생산 playerId ASC | `stage2_produce` | ✅ 병력·골드·**유지비**(v4.2: 패주 제외 출전 깃발 전부 — 1단계 명령 적용 후, 4단계 이전의 깃발 목록) |
| 3 외교·시간 타이머 | `stage3_timers` → `allianceTimers` | ✅ 제안 만료·BREAKING→해제·freeze·Lockout + 종반 러시·봇 인계·threshold_update |
| 4 깃발 이동 flagId ASC | `movement.ts` | ✅ **v4.2 (GDD 4.4a b)**: 경직 → inCombat·ENGAGED(`halted=false`, 노출 소모) → IDLE(공격 태세면 옆 칸 생길 때 재점화) → MARCHING `settle`(방어 도착 > 옆 칸 있음: 앵커면 ENGAGED·아니면 `halted` > 앵커면 IDLE) → 이동(ZOC — **RETURNING 은 무시**, 속도 **RETURNING ×1.5**) → 새 칸에서 `settle`(남은 이동 진행도 버림) / RETURNING 귀환지 재평가·환급 |
| 4a 깃발 전투 Phase A (읽기 전용 → `FlagCombatPlan`) | `combat.ts` | ✅ |
| 4b 깃발 전투 Phase B flagId ASC | `combat.ts` | ✅ 손실·inCombat(**v4.2: inCombat 이면 `halted=false`**)·패주·**v4.2 귀환 깃발 자동 이탈 대기**·이탈 대기 만료·blocked·combat 이벤트. 간선 = 적대·거리 ≤ 1·**RETURNING 이 아닌** 공격 태세 깃발이 한쪽 이상 |
| 5 AP 예산 누적 — **v4.2: `pushing(f)` = ¬inCombat ∧ ATTACK ∧ (ENGAGED ∨ halted)**. 걷는 MARCHING 은 누적 없음, 정지가 풀려도 예산 리셋 없음 [A-54] | `gauge.ts` | ✅ |
| 6 전투 Phase A (읽기 전용 → `PushPlan`: pushes/baseHits). **v4.1: 방어 배분·`defSpend`·`undo` 삭제, `adv == 0` 은 push 아님. v4.2: 대상 `pushing(f)`, 타깃 = `selectAttackTargetRO`(아래)** | `gauge.ts` | ✅ |
| 7 전투 Phase B (tileId ASC, flagId ASC). **v4.1: net = adv, DEFEND 지출 삭제, `pushedSet`(tick 로컬) 반환, 안 민 `pushing` 깃발 `updateStall(f,0)`(flagId ASC)**. halted 와 ENGAGED 사이 우선권 없음(같은 레이스) | `gauge.ts` | ✅ 게이지·레이스·기지 피해/함락 |
| **7c 진척도 자동 감소 (v4.1)** flagId ASC — `progressMilli > 0 ∧ ∉ pushedSet ∧ ¬holdProgress` 이면 −20(0 클램프), 0 도달 시 `flag_progress_lost{cause:"decayed"}`. `holdProgress` = inCombat ∨ 4a 스냅숏 위치 거리 ≤ 1 에 적대(비동맹) presentEnemy 깃발(¬routed ∧ troops > 0, 상태·태세 무관) | `gauge.ts stage7c_progressDecay` (+ `combat.ts snapshotPresence`, 4a 산출물 `FlagCombatPlan.presence`) | ✅ |
| 8 기지 체력 회복 tileId ASC | `stage8_baseRegen` | ✅ |
| 9 파생 상태 | `gauge.ts stage9_derived` | ✅ calmTicks — `threatened`(inCombat ∨ 관할 원 안 칸을 `targetTileId`로 둔 적 **`pushing`** 공격 깃발 — v4.2) 사용. `GARRISON_ESCALATE_MAX = 1` 이라 규칙 영향 없음 |
| 10 깃발 종료 판정 | `gauge.ts stage10_flagEnd` | ✅ **v4.2**: ENGAGED·ATTACK 은 옆 칸(`marchFront`) 비면 IDLE(`front_cleared`), 아니면 < 40 소진 / ENGAGED·DEFEND guard 소멸 → IDLE·소진 / **MARCHING·halted < 40 → 소진** / IDLE 600 tick → 자동 귀환(`returnBaseTileId = null`). **중립 자동 전환 삭제** |
| 11 봇 — **v4.1: 봇별 `t % bot.decisionInterval == 0`**(EASY 30 / NORMAL 15 / HARD 10), playerId ASC | `stage11_bots` | ✅ 3차-2 `CivBot` (`bot.ts`, §11) |
| 12 탈락 | `stage12_elimination` | ✅ |
| 13 승리 | `stage13_victory` | ✅ |
| 14 브로드캐스트 | `stage14_broadcast` | ✅ |

정수식:
- **v4.3**: 아래 `capPm`·`regenPm`·`goldPm` 과 모든 테크 배율은 플레이어 스탯 `statPm = techStatValues(techMask)`(§19) 에서 읽는다 — 각각 `TROOP_CAP`·`REGEN`·`GOLD`
- `troopCap = floor((100 + 12·tiles) × capPm / 1000)`
- `regenMilli = round_half_up( (800 + floor(500 × isqrt(tiles·10⁶) / 1000)) × regenPm × (capMilli − troopsMilli) / (1000 × capMilli) )`, 이후 `troopsMilli = min(troopsMilli + regen, capMilli)`
- `goldMilli/tick = floor(goldWeight × 2080 × goldPm / 10⁹)`, `net = gross − floor(gross × upkeepPm / 1000)`
- `flagCap = min(7, 3 + floor(tiles/300) + SLOT_BONUS)` — **v4.3**: `SLOT_BONUS` = MOB-3A 보유 시 1, 아니면 0 (최대 +1)
- `thresholdScaled(t) = clamp(12000 − floor(max(0, t−4800) × 1500 × 200 / (1000 × 300)), 9000, 12000)`; 승리 ⇔ `tiles × 100 × 200 ≥ thresholdScaled × totalLandTiles`

2차 정수식 (클라이언트 예측용 — 서버와 같은 값을 내려면 이 순서 그대로):
- `tileCost`: micro(1e-6) 고정소수점 `v`. 중립 `v = (7000 + floor(750 × isqrt(tiles·10⁶) / 1000)) × 1000 → ×NEUTRAL_COST(공격자)`, 적 `v = 11·10⁶ → ×DEF_COST(소유자) → ×ATK_COST(공격자) → ×(1000 + 150·n)`; 공통 `→ ×TERRAIN_COST → ×CAPTURE_MULT_<unit>(공격자) → ×supply → (러시 중이면 ×750)` (**v4.3**: 배율 이름은 `TECH_STAT`, 값은 각 플레이어 스탯 — 무테크면 v4.2 와 같은 값). 각 `×pm` 은 `v = floor(v × pm / 1000)`. 결과 `max(4, ceil(v / 10⁶))`. `n` = 이동 그래프 이웃 중 그 타일 소유자와 같은 수. supply = `min(1600, 1000 + SUPPLY_COEF × max(0, d − 10))`, d = 공격자 기지까지 최소 거리(기지 없으면 40). **v4.3**: `SUPPLY_COEF` = 공격자 스탯(무테크 20, TER-3A 15)
- ~~`defRefCost`~~, ~~`undoPerAP`~~ — **v4.1 삭제**
- 진척도 감소: 밀지 않는 tick 마다 `progressMilli = max(0, progressMilli − 20)` (유지 조건 위 7c). `progressPct = floor(progressMilli / 10)` 그대로
- `availAP = floor(min(spendBudgetMilli, troopsMilli) / 1000)`, 예산 `+initialTroops × 15`/tick, 상한 `initialTroops × 15 × 25`
- `adv = min(floor(AP × 1000 / cost), 2 × UNIT_ASSAULT)`, 지출 `ceil(adv × cost / 1000)`
- `speedMilli = max(1, floor(140 × UNIT_SPEED × speedPm × RET / (moveCost(pos) × 10⁶)))`, **v4.3** `speedPm = SPEED + SPEED_<unit>`(무테크 1000, MOB-1/2A 각 +150, CAV-1·SPE-2B 해당 병종 +100) — **v4.2: `FLAG_SPEED_BASE_MILLI` 120 → 140 [A-64]**, `RET` = RETURNING(패주 포함)이면 `RETURN_SPEED_PERMILLE`(1500) 아니면 1000 (같은 floor 안). 예: 검병·평원·무테크 행군 140, 귀환 210 milli/tick. moveCost = 얕은 물이면 `max(2000, SHALLOW_MOVE)`(**v4.3** 스탯: 무테크 5000, MOB-2B 3500), 아니면 `TERRAIN_MOVE`
- **v4.2 공격 대상 `marchFront(f)`** = 깃발 현재 칸 `neighbors`(이동 그래프 이웃) 중 `isClaimable ∧ owner ≠ 나 ∧ ¬isAlly(나, owner)`(중립 포함). `selectAttackTargetRO`: 현 `targetTileId` 가 `marchFront` 안이면 유지(sticky), 아니면 `(MARCHING 이고 경로 다음 칸이면 0 아니면 1, distance(t, anchor), tileCost, tileId)` 최소. 쟁기 미리보기: 직선 경로면 걸음당 새 칸 3개(앞·좌·우) = 폭 3 회랑, 출발 칸에서는 뒤 칸까지 4개
- **깃발 접촉 (2026-10-11 사용자 결정, §20)**: 깃발 대 깃발 전투 후보·편 묶기, ZOC, 진척도 유지 판정은 `touching(a, b)` / `contactNeighbors(t)` — 사각 = 체비셰프 거리 ≤ 1(8방향, 대각선 포함). 땅 점령(`marchFront`)·guard·이동 경로·발령 사거리는 4방향/맨해튼 그대로
- 거리장: 목적지에서 역방향 Dijkstra, 간선 가중치 = 들어가는 칸의 moveCost, 키 `(dist, tileId)`. 다음 칸 = 이웃 중 `(dist, tileId)` 최소. 캐시 키 `(목적지, 얕은 물 이동배율 SHALLOW_MOVE)` (**v4.3**)
- 노출 소모: 내 땅·동맹 땅이 아니면 `max(1000, floor(troopsMilli × 5 / 10000))` — **v4.3 [A-75]**: 물 위 감소 테크 폐기, 땅·물 같은 식
- 깃발 전투값 `v(f)` (**v4.3**): 공격 태세 `v = floor(UNIT_ATK[u] × (COMBAT_ATK + COMBAT_ATK_<u>) / 1000)`, 방어 태세 `v = floor(floor(UNIT_DEF[u] × terrainDef / 1000) × (COMBAT_DEF + COMBAT_DEF_<u>) / 1000)`. 물 위 깃발이 땅 위 적과 같은 무리면 `× LANDING_COMBAT / 1000`(무테크 800, MOB-3B 950), 물 대 물 ×1000. 이탈 대기 ×500. 최소 1
- 깃발 전투: GDD 4.15 c·d 그대로 (`L`, `T = N_sides × L`, `inv = floor(10⁹ / W)`, 잔여 milli 는 sideKey ASC 로 1씩, 편 내부는 병력 비례 floor + 잔여를 (troopsMilli DESC, flagId ASC) 로 1씩)
- 유지비: **v4.2 [A-60 변경]** `w = Σ UPKEEP_WEIGHT_<unit>` (**내 깃발 중 `routed` 가 아닌 것 전부** — 태세·상태 무관. 무테크 창 600 / 검 1000 / 기병 1600, **v4.3** SPE-2A 창 450·CAV-3 기병 1300), `drainPm = min(700, floor(max(0, w − 1000) × UPKEEP_COEF / 1000))` (무테크 90, **v4.3** ECO-2B 72) → `players[].upkeepPm`. 순증 = 그로스 − floor(그로스 × drainPm / 1000) ≥ 그로스의 30% (상한 700 유지). 예: 검 1 = 0‰, 검 2 = 90‰, 검 3 = 180‰, 기병 7 = 700‰(상한). 골드/초 계산은 §5 snapshot_delta

---

## 9. 테스트·스모크 결과

### v4.5 (2026-10-15, 해상 이동 폐지·중립 비용 고정·손실률·기지 피해 상한·기지 생산·×1.5·지명·기동 노드 교체 — §22)

- `npm run typecheck` 통과 · `npm test` **24 파일 329 테스트 통과**(신규 `server/test/v45.test.ts` 21개 + tech 2개) · `npm run smoke` PASSED · `qa:headless` 스키마 위반 0 / 순서 위반 0 / 재구성 불일치 0 · `qa:scenarios` 87/87 · `qa:ws` 78/78.
- 자가대전 비교는 §22.8.

### v4.4 (2026-10-14, 기지 방어·우클릭 이동·멸망·합병·기지 생산력·지명 — 사용자 결정, §21)
- `npm run typecheck` 통과(shared·server·client). `npm test`: **22 파일 297 테스트 전부 통과**. 신규 `server/test/v44.test.ts` **16**: 내 수도 앵커 발령 → 그 칸에서 ENGAGED·소멸 안 함 / **×1.5 가 지형을 대체**(언덕 수도 위 창 = 1950, 남의 기지가 되면 지형, 공격 태세 무관) / 기지 위 수비 깃발이 있으면 체력 피해 0 + 기병 공격 패주 / 재지정 태세 = 도착지(내 기지 → DEFEND·기지 위로 이동·회수 아님, 중립 → ATTACK) / 쿨타임 중 재지정 → `pendingPosture`·비트 128·full 필드 → 쿨타임 끝 tick 자동 적용(`flag_posture_changed auto`) / 회수가 대기 태세 삭제 / **유일 기지(수도) 함락 → 같은 tick `player_eliminated{byPlayerId, annexedTiles}` + 고립 칸 포함 전 영토 이전 + 깃발 소멸 + 델타 `tileChanges`** / 수도를 잃어도 기지가 남으면 생존·같은 tick 연쇄 합병(멸망한 합병 대상 → 그를 멸망시킨 쪽) / **생산력 1000 → 500 → 250 → 1분 뒤 417 → 1000 상한**, `base_captured.newProdPm`·full `prodPm` / **지역 합 = 총 생산**(봇 1500 tick, 50 tick 마다 전원: 칸·병력·그로스·순골드, 생산력 전부 1000 이면 기존 `regenMilliPerTick`·`grossGoldMilliPerTick` 과 같음, full `production` = 직전 정산 × 5) / 생산력 50% 지역만 감소 / `distribute` / **지명 풀 ≥ 100·중복 없음·한글 2~3음절, 시드 결정론·고유·`baseNames` 길이** / 봇: 마지막 기지 위협 → 그 기지 앵커 창병 발령, 마지막 아닌 기지는 체력이 깎일 때만. 모든 시뮬레이션 테스트 매 tick `ledgerImbalance == 0`.
- 기존 테스트 수정: `economy.test.ts` PlayerState 리터럴에 새 필드 2개(값 null). 클라이언트 `gameModel.test.ts`(재구성 불일치 0)는 `client/src/state/gameModel.ts` 에 `pendingPosture` 비트 해석 2줄을 넣어 통과 유지.
- `smoke` **SMOKE PASSED**. `qa:ws` **78/78**, 스키마 위반 0. `qa:headless`: **재구성 불일치 0종(`bases[].prodPm`·`production` 비교 추가), 회계 위반 0, 스키마 위반 0, 순서 위반 0**. `qa:scenarios` **86/87**(남은 1건은 기존 m-13 — GDD #7 예시 수치, 744/772 그대로). `qa-schema.ts`: `map_init.baseNames`, `bases[].prodPm`, `flags[].pendingPosture`, full·델타 `production`, 델타 `baseProd`, `flagFlags` 비트 0..255, `player_eliminated.annexedTiles`, `base_captured.newProdPm`.
- **자가대전** (`npm run selfplay -w @civwar/server -- 10 1000 M 10`, 전원 NORMAL, 시드 1000~1009, 최종본은 `CIVWAR_SELFPLAY_LEDGER=1` 매 tick 회계 위반 0). 직전 = 15dc6aa 를 같은 스크립트(기지 함락 전체 수 지표 추가본)로 다시 돌린 값(오케스트레이터 제공 수치와 같음 — 30분 22.1%, 탈락 1.0). 봇 수비 범위만 바꾼 비교 실행 3개를 함께 적는다(규칙은 전부 같다).

| 지표 | 직전 15dc6aa | 규칙만 (봇 수비 없음) | 봇: 마지막 기지만 | **최종: 마지막 기지 + 공격받는 기지** | 봇: 위협받는 기지 전부 |
|---|---|---|---|---|---|
| 종료 / 사유 | 32.0분 timeout 10/10 | 32.0 timeout 10 | 32.0 timeout 10 | **32.0분 timeout 10/10** | 32.0 timeout 10 |
| 1위 점유율 @30분 | 22.1% | 26.1% | 22.7% | **22.9%** | 22.4% |
| 1위 점유율 @5/10/15/20/25/30·종료 | 4.9/9.8/13.6/15.6/18.7/22.1·23.7 | 4.9/9.9/14.3/19.5/22.7/26.1·27.9 | 4.9/9.8/13.4/16.8/19.6/22.7·23.4 | **4.9/9.8/13.5/17.2/21.2/22.9·25.0** | 4.9/10.0/12.8/16.2/19.2/22.4·23.4 |
| 탈락/판 | 1.0 | **3.8** | 0.9 | **1.2** | 1.1 |
| 기지 함락/판 (전체, 중립 포함) | 33.0 | 27.7 | 26.0 | **20.5** | 14.4 |
| 플레이어 기지 함락/판 (수도) | 26.3 (14.9) | 19.9 (10.0) | 18.4 (6.4) | **12.6 (4.2)** | 6.9 (3.2) |
| 방어 슬롯 비중 | 45.0% | 42.6% | 51.4% | 51.9% | 52.5% |
| 공격 깃발 교전 시간 % | 18.3 | 14.6 | 11.4 | 10.8 | 10.2 |
| 병력 소멸 노출/전투/공격 지출 % | 3.4/39.6/57.1 | 3.2/36.8/60.0 | 2.9/32.4/64.6 | 2.9/32.6/64.5 | 2.8/32.5/64.7 |
| tick ms 평균/최대 | 0.28/28.3 | — | — | 0.38/33.8 | 0.33/21.8 |

  - 다른 시드(2000~2009)로 "마지막 기지만" / "전부" 를 다시 돌려도 같은 경향(기지 함락 26.7 / 17.8, 탈락 0.8 / 1.0, 30분 1위 23.6 / 21.2%).
  - **L 108×66 · 12인** (시드 3000·3001, 최종본): 둘 다 timeout, tick 평균 0.44~0.53ms / 최대 24.9ms(예산 200ms), 봇 ms/tick 평균 0.05~0.08.
  - **해석 (상수 불변)**: ① 판 길이는 그대로(10/10 하드 타임아웃). ② **규칙만**(봇이 기지를 지키지 않으면) 탈락이 1.0 → 3.8/판으로 늘고 30분 1위가 26.1% 로 오른다 — 합병이 눈덩이를 만든다. ③ 봇이 **마지막 기지를 지키면** 탈락이 ~1/판으로 돌아온다(최종 1.2). ④ **기지 함락 빈도는 줄었다**(전체 33.0 → 20.5/판, 플레이어 기지 26.3 → 12.6) — 기지 위 창 방어 ×1.5(실효 1950 vs 기병 공격 1180) + 수비 깃발이 있는 동안 체력 피해 0 이라, 공격받는 기지에 수비대를 세우면 거의 함락되지 않는다. 봇 수비 범위가 넓을수록 함락이 준다(전부 지키면 14.4). 최종본은 "마지막 기지 + 체력이 깎이는 기지" 로 중간을 골랐다(§10-111). 생산력 ×0.5 가 "점령의 득" 을 줄이는 몫도 있다. **수치는 바꾸지 않았다** — 기지 함락을 더 자주 원하면 레버는 `COMBAT_BASE_DEF_PERMILLE`(사용자 확정값)·봇 수비 범위(`BOT_BASE_GUARD_*`)·봇 기지 공격 병력(`BOT_COMMIT_BASE_PERMILLE`) — game-designer·사용자 판단(§13).

### v4.3 (2026-10-11, 테크 트리 v4.3 — 사용자 승인 A-66~A-84 ① + 깃발 접촉 8방향)
- `npm run typecheck` 통과(shared·server·client). `npm test`: **18 파일 232 테스트 전부 통과**(서버 9 파일 167 — 신규 `tech.test.ts` 21, `flags.test.ts` 8방향 묶음 5, 클라이언트 9 파일 65). 클라이언트는 빌드 유지용 최소 수정(§19 "클라이언트").
- **교체한 기존 테스트**: economy(상한 TER-2B/3B·골드 ECO-1/3A·누진 160/169/403/868·슬롯 MOB-3A) / tick(구매 수락·`PREREQ_MISSING`·`ALREADY_OWNED`·`INSUFFICIENT`, 입력 큐 정렬) / flags(m-10 봇 ack — nodeId) / protocol(nodeId 범위·구 axis/tier 형식 거절) / bot(상태 해시에 techMask, **요격 칸 기대값 "맨해튼 ≤ 1" → `touching`** — 8방향 규칙으로 대각선 칸이 요격 칸이 될 수 있다).
- **신규 8방향 테스트 (flags.test.ts `깃발 접촉 = 8방향` 5)**: 토폴로지(`contactNeighbors` 8개·`touching` 체비셰프·이동 이웃 4방향 그대로) / **대각선 접촉 → 전투 개시** / **대각선 ZOC 로 행군 정지**(방어↔방어, 현재 칸이 대각선 접촉) / 대각선 적 깃발 → 진척도 유지 / **marchFront 는 4방향 그대로**(대각선 적 칸으로는 재점화 안 함, 4방향 적 칸이 생기면 재점화).
- **신규 `server/test/tech.test.ts` (21)**: 노드 표 불변식(32·7갈래·부모 = 같은 갈래 한 티어 아래·uint32 비트 31) / 스탯 매핑 / 전부 보유 시 최대치(01b 2.4) / **가격식 n = 0·8·14** (`[160,360,700]`·`[236,532,1036]`·`[294,662,1288]`) + 서버 구매 경로 15회 가격열 / **선행 거절**(T2·T3, 형제 불필요) / **이미 보유 거절**(골드 차감 없음) / 골드 부족·범위 밖 / **구매 순서 3가지 → statPm·techMask 동일** / 노드 하나 = 스탯 하나 / **유지비 노드 실제 적용**(ECO-2B 342→273‰, CAV-3 261‰, 둘 다 208‰, SPE-2A 126→72‰, 골드 정산 tick 의 `upkeepPm`) / **속도 노드 실제 적용**(검·기·창 140/203/105 → MOB-1 161/233/120 → MOB-1+2A+CAV-1+SPE-2B 182/284/147) / 얕은 물 5000→3500 / **슬롯 MOB-3A +1, 전부 사도 +1** / 상한·재생 / 점령비용(MIL-1·3A·2B·TER·SWO-2B·TER-3A 보급선) / 전투값 태세 분리(검 공격 1000→1140, 창 방어 1300→1482) / 편성비 CAV-2A 115→107 / 스냅숏·델타 `techMask`·`match_config.constants.TECH_NODES` / 봇 목록 4×16 부모 순서·EASY 기병 노드 없음.
- `smoke`: v4.3 테크 단계로 교체 — 시작 골드 200 으로 MIL-1(160) 수락 → `tech_purchased{nodeId 0, cost 160, techMask 1}` → 재구매 `ALREADY_OWNED` → MIL-3A `PREREQ_MISSING` → ECO-1 `INSUFFICIENT` → nodeId 32 `BAD_REQUEST` → `snapshot_full.players[].techMask/techCount`. `SMOKE PASSED`.
- 위 smoke·qa 결과는 8방향 적용 후 재실행해도 같다(smoke PASSED, qa:ws 78/78, qa:scenarios 86/87, qa:headless 불일치 0).
- `qa:ws` **78/78**, 스키마 위반 0. `qa:headless`: **재구성 불일치 0종, 회계 위반 0, 스키마 위반 0, 순서 위반 0**(모델이 `tech_purchased.nodeId` 로 마스크를 재구성해 full 과 비교). `qa:scenarios` **86/87** — 남은 1건은 기존 m-13(GDD #7 예시 수치, 서버 결함 아님 — 744/772 그대로). 테크 시나리오는 nodeId·새 거절 코드·가격 160→169 로 교체. `qa-schema.ts`: `players[].techMask/techCount`, `playerDeltas[].techMask`, `tech_purchased{nodeId, techMask}`, 거절 코드 `PREREQ_MISSING`/`ALREADY_OWNED` (`TECH_ORDER` 제거).
- **자가대전** (`npm run selfplay -w @civwar/server -- 10 1000 M 10`, 전원 NORMAL, 시드 1000~1009, `CIVWAR_SELFPLAY_LEDGER=1` 매 tick 회계 검사 — 두 실행 모두 위반 0). **A** = 테크 v4.3 만, **B** = 테크 v4.3 + 깃발 접촉 8방향(최종 코드).

| 지표 | 직전 (081dc6d, 오케스트레이터 제공) | A: 테크만 | **B: 테크 + 8방향 (최종)** | 제안서 추정 |
|---|---|---|---|---|
| 종료 평균 / 분포 | 32.0분 (전부 32.0) | 32.0 (전부 32.0) | **32.0분 (전부 32.0)** | 표준 29.5~29.6분 (봇 판 재현 불가 — 01b 3.4) |
| 종료 사유 | timeout 10 | timeout 10 | **timeout 10** | — |
| 1위 점유율 @30분 | 22.4% | 19.0% | **22.1%** | — |
| 1위 점유율 @5/10/15/20/25/30분·종료 | — | 4.9/10.0/13.8/15.2/17.4/19.0·20.3 | 4.9/9.8/13.6/15.6/18.7/22.1·23.7 | — |
| 공격 깃발 시간 — 걷기/정지 점령/앵커/**교전**/귀환/IDLE % | — (v4.2 문서 40.3/22.8/0.7/17.6/16.7/1.9) | 41.8/22.6/0.6/**15.9**/17.3/1.7 | 40.6/20.9/0.6/**18.3**/17.9/1.7 | — |
| 병력 소멸 노출/전투/공격 지출 % | — | 3.3/35.4/61.2 | 3.4/**39.6**/57.1 | — |
| 테크 구매/플레이어 (종료) | 3.3 | 8.8 (@15분 4.6) | **8.6** (@15분 4.6) | 중위 8~10 |
| 종료 시 테크 수 — 1위(타일) / 생존 중앙 / 탈락자 | — | 11.2 / 8.5 / 3.0 (4판) | **12.2 / 9.7 / 3.5** (9판) | 선두 14 / 중위 9 / 조기 탈락 5 |
| 구매 티어 분포 T1 / T2 / T3 | — | 48.6 / 39.1 / 12.3% | **48.8 / 39.2 / 12.0%** (플레이어당 4.22 / 3.39 / 1.04) | 선두는 T3 3~4개 |
| 평균 유지비 upkeepPm | — (v4.2 문서 265‰) | 238‰ | 232‰ | — |
| 방어 슬롯 비중 | — (v4.2 문서 47%대) | 47.2% | 45.0% | — |
| 공격 발령 병종 창/검/기 | — | 0/4.5/95.5 | 0/4.0/96.0 | — |
| 탈락/판 · 플레이어 기지 함락/판(수도) | — | 0.4 · 27.9 (18.0) | **1.0** · 26.3 (14.9) | — |
| 종료 시 고립지 칸 비율 | — | 17.3% | 12.4% | — |
| 봇 거절률 / APM | — | 0% / 7.0 | 0% / 7.3 | — |
| tick ms 평균/최대 · 봇 ms/tick 평균/최대 | — | 0.27/21.4 · 0.05/10.4 | 0.29/22.6 · 0.05/13.0 | — |

  - **노드별 구매율 (B, 플레이어-판 %)**: MIL-1 54 · MIL-2A 13 · MIL-2B 19 · MIL-3A **0** · MIL-3B 7 · ECO-1 92 · ECO-2A 30 · ECO-2B 60 · ECO-3A 24 · ECO-3B 15 · TER-1 65 · TER-2A 25 · TER-2B 33 · TER-3A **0** · TER-3B 13 · MOB-1 79 · MOB-2A 54 · MOB-2B 9 · MOB-3A 17 · MOB-3B **0** · SPE-1 35 · SPE-2A 21 · SPE-2B **0** · SPE-3 10 · SWO-1~3 **0** (NORMAL 봇 목록엔 SWO-1 하나뿐, 16번째) · CAV-1 97 · CAV-2A 56 · CAV-2B 19 · CAV-3 18. 0% 노드는 봇 목록 후반(12~16번째)이거나 목록에 없는 노드 — 봇이 판당 8~12개에서 멈추기 때문(B-24 관측 대상).
  - **해석 (상수 불변)**: 테크 구매는 3.3 → 8.6 으로 제안서 방향대로 늘었지만 **추정치보다 적다**(1위 12.2 vs 14, 탈락자 3.5 vs 5 — 중앙 9.7 은 추정 9 와 비슷). 테크만 바꾼 A 에서는 30분 1위 점유율이 22.4% → 19.0% 로 내려갔다(이동속도 천장 하향 — 구 기동 T1 ×1.45 → MOB-1 ×1.15, 기병 MOB-1+CAV-1 ×1.25 — 이 쟁기 점령 속도를 늦춘 몫으로 보인다). **8방향 접촉(B)** 은 교전 시간 비중 15.9 → 18.3%, 전투 소멸 35.4 → 39.6%, 탈락 0.4 → 1.0/판으로 교전을 늘렸고 30분 1위 점유율을 22.1% 로 되돌렸다(직전 22.4% 와 비슷). 하드 타임아웃 10/10 은 세 실행 모두 같아 **판 길이는 바뀌지 않았다**. **수치는 바꾸지 않았다** — game-designer 판단 필요(§13-9).

### v4.2 (2026-10-10, GDD v4.2 + A-60 변경 + 봇 기지 공격)
- `npm run typecheck` 통과(shared·server·client). `npm test`: **서버 8 파일 전부 통과**(flags 42·bot 12 포함). 루트 `npm test` 의 실패 1건은 **클라이언트** `m-4 engageEtaTick` 테스트(표본 수 > 100 요구, `flag_engaged` 를 실측 기준으로 씀) — v4.2 에서 공격 깃발의 `flag_engaged` 는 앵커 칸 도착 때만 나오므로 표본이 줄었다. 서버 동작은 의도대로이며 클라이언트 테스트의 기준 이벤트를 "첫 `HALTED` 비트 또는 `flag_engaged`" 로 바꿔야 한다(§18).
- **v4.2 로 의미가 바뀌어 교체한 기존 테스트 (사유는 테스트 주석에도)**: ① 진척도 감소 시나리오 — IDLE 공격 깃발이 옆 칸 생기면 재점화(A-59)하므로 옆 칸을 내 땅으로 둠 ② "발령 → 행군 → 교전" — `flag_engaged` 대신 `halted` 관측 ③ "앵커를 먹어도 front 가 빌 때까지 계속 민다" → **직선 쟁기 폭 3** ④ 동맹 IDLE(allied) — 같은 tick 재점화, 동맹 칸 비대상 ⑤ QA I-2(귀환 중 재회수 수락) → **A-62 전부 RETURNING 거절 + 자동 이탈** ⑥ 유지비 9% 테스트 이름(내용 동일).
- **신규 테스트 (flags.test.ts `v4.2` 묶음 13 + bot 3)**: 직선 쟁기 폭 3(회랑 밖 점령 0)·앵커 ENGAGED(frontTileCount 3)·IDLE·600 tick 자동 귀환(`returnBaseTileId null`) / IDLE 재점화(이동 없음) / 동맹 비대상·중립·제3자 대상·동맹 땅 위에서 점령 / **고립지 생성** / 물 위 해안 정지 점령 / 방어 태세 행군은 공격 안 함·걷는 중 예산 누적 0 / breakaway 한 칸 이동 전 정지 없음 / 전투 우선(halted 해제·예산·진척 동결) / **유지비 = 출전 깃발 전부(패주 제외)·상한 700** / 지정 기지 회수(`NOT_BASE`·`NOT_OWNED_BASE`·실제 이동·상실 폴백·되찾아도 복귀 안 함·`flagReturnBase` 델타) / 귀환 ×1.5(패주 포함, 140 → 210)·ZOC 무시(같은 배치 행군은 대치) / 귀환 깃발은 공격 쪽 아님 / 자동 이탈 대기 → broke_away → 귀환 계속 / 봇: 약한 적 기지 → 기병·풀 50%, 관할 원 안 기지 → 검병, 깊은 앵커. 모든 시뮬레이션 테스트는 매 tick `ledgerImbalance == 0`.
- `smoke`: v4.2 항목 추가(정지 점령 `HALTED` 비트 → 진척 → 중립 점령, `snapshot_full.flags[].halted/returnBaseTileId`, `cmd_flag_recall{baseTileId}` → `flagReturnBase`, 귀환 중 재회수 `RETURNING`). `SMOKE PASSED`.
- `qa:ws` 78/78, 스키마 위반 0. `qa:headless`: **재구성 불일치 0종, 회계 위반 0, 스키마 위반 0, 순서 위반 0**. `qa:scenarios` 84/85 — 남은 1건은 기존 m-13(GDD #7 예시 수치, 서버 결함 아님 — 744/772 그대로). 섹션 6(I-2)은 A-62 로 기대값 교체.
- 대표 전투 `duels.ts` **불변**(113/98/86/78/103/107/103/100/78 tick, 225/404/518/148/87/148/194/523).
- **자가대전** (`npm run selfplay -w @civwar/server -- 10 1000 M 10`, 전원 NORMAL, 시드 1000~1009, 매 tick 회계 검사):

| 지표 | v4.1 실측 | v4.2 (봇 기지 공격 전) | **v4.2 최종** |
|---|---|---|---|
| 종료 평균 / 분포 | 31.9분 (31.3~32.0) | 32.0 (전부 32.0) | **32.0 (전부 32.0)** |
| 종료 사유 | timeout 9 · threshold 1 | timeout 10 | **timeout 10** |
| 1위 점유율 @5/10/15/20/25/30분 | 4.8/10.1/14.9/19.9/24.8/**28.7** | 4.8/10.0/13.6/15.9/18.6/**21.0** | 4.8/9.9/13.7/17.7/22.5/**25.5** |
| 봇 APM / 거절률 | 7.8 / 0% | 7.6 / 0% | **7.1 / 0%** |
| 공격 깃발 시간 (걷기/정지 점령/앵커 점령/교전/귀환/IDLE) | 행군 23 · 교전 7 · 귀환 13 (§11) | 42.5/21.9/0.7/11.6/21.4/1.9 | **40.3/22.8/0.7/17.6/16.7/1.9** |
| 점령 귀속 (정지 점령/앵커) | — | 96.1% / 1.7% | 95.5% / 1.8% |
| 공격 발령 병종 (창/검/기) | — | 0/1.8/98.2 | 0/3.2/96.8 |
| 평균 유지비 upkeepPm | — (주둔만) | 284‰ | **265‰** |
| 테크 구매/플레이어 @15분 / 종료 | — | 1.5 / 3.4 | **1.6 / 3.2** |
| 종료 시 고립지 칸 비율 (B-21) | — | 16.6% | 16.1% |
| 병력 소멸 (노출/전투/공격 지출) | 노출 ~10% · 전투 ~17% | 4.4/28.9/66.7 | 3.8/36.6/59.6 |
| 플레이어 기지 함락/판 (그중 수도) · 탈락/판 | — | — | **44.6 (28.1) · 1.1** |

  - **A-60 분리 측정** (같은 코드·같은 시드 1000~1003, 30분, 유지비만 옛 "방어 주둔만" 으로 임시 교체 후 원복): 30분 1위 22.3% vs 새 규칙 22.1% — **점유율 영향 거의 없음**. 평균 유지비 73‰ → 302‰, 테크 구매/플레이어 3.9 → 3.2 (**약 −18%, 테크가 늦어진다**). 봇은 슬롯을 항상 채우므로(방어 비중 47%) 깃발 4~6개 × 가중치로 상시 20~35% 둔화.
  - 쟁기 점령 = 깃발이 실제로 먹는 칸의 96%. 앵커 ENGAGED 는 1% 미만 — 봇 깃발은 깊은 앵커 전에 병력이 다 탄다(깊이 식 = 병력 소진 깊이, 의도대로).
  - 수도 함락 28회/판은 같은 수도가 여러 번 주인이 바뀐 횟수 포함. 탈락 1.1/판, 조기 종료 0 — 판이 일찍 끝나지는 않는다.
  - 성능: tick 평균 0.29 ms, 최대 23.6 ms(거리장 생성), 봇 평균 0.05 ms/tick·최대 10.4 ms.
  - **게임 상수는 A-64(속도 140)·A-63(귀환 ×1.5) 외 바꾸지 않았다.** 하드 타임아웃 10/10 은 v4.1(9/10)과 같은 원인(§11 페이싱 관찰 1·4 — 봇 예비 병력·대칭 봇) + 쟁기로 깃발당 점령 시간이 늘어난 몫. GDD 5.4 v4.2 의 표준 29.4분은 봇 자가대전에서 재현되지 않는다.

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
21. ~~IDLE 공격 깃발은 자동 재교전하지 않는다~~ → **v4.2 A-59: 옆 칸이 다시 적·중립이면 그 자리에서 재점화**(§18).
22. 소진 판정(< 40)은 GDD 4.11b 대로 **ENGAGED 깃발 + v4.2 정지 점령(halted) 깃발**. 걷는 MARCHING/IDLE/RETURNING 깃발은 40 미만이어도 유지.
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
55. **경로 위험 (8.6) 은 근사**: 거리장 경로를 만들지 않고 앵커 거리 ≤ 2 의 적 깃발 실효력 합 × 0.9 와 비교. **상륙 후보** (기동 T2+ → **v4.3: MOB-2B 조선술 보유**, §10-99): 내 해안에서 얕은 물만 12칸 BFS 로 닿는, 내 땅과 비인접·적 깃발 거리 > 2 인 육지 — 점수 ×0.8. **차단 쓰기**: 내 땅을 노리는 적 행군 깃발과 그 앵커 사이 맨해튼 최단 경로 위 (깃발에서 2~6칸) 내 언덕·산 칸, 빈 슬롯 ≥ 2, 창병 = max(40, 요격 필요 병력). 결정당 1회.
56. **추격**: 기병 공격 깃발 거리 ≤ 6 에 이탈 대기 적 깃발이 있고 그 칸이 적·중립 육지면 그 칸으로 재지정.
57. **공격 깃발 최소 병력 = 3 × FLAG_MIN_TROOPS** (cap − 예비가 작은 소국은 2× 까지): GDD 식 `clamp(풀×45%, 40, …)` 은 40 근처 깃발을 반복 발령 → 몇 AP 쓰고 소진 (잔여 전액 소멸) → 소국이 영원히 못 자라는 함정이 있었다 (실측 10분에 소진 802회).
58. **소진 직전 회수**: ENGAGED 공격 깃발 병력 < 40 + 쌓인 예산 + 누적률 × 2 tick 이고, 그 경계 × 15% < 20 (회수 손실이 소진 손실 상한의 절반 미만) 일 때만 회수. 큰 깃발은 그냥 소진시키는 편이 손실·슬롯 점유가 적다 (측정).
59. **슬롯 재활용**: 슬롯이 꽉 찼고 새 깃발 예상 병력 (풀 × 35%, 풀 − 예비 이내) ≥ 2 × 최소 공격 병력이면, 병력 × 4 ≤ 그 값인 가장 약한 비전투 깃발 (공격, 또는 위협 없는 방어) 1개를 회수.
60. ~~**테크**~~ (**v4.3 에서 대체 — §10-99**): `botIndex = playerId − 1`. 수비형 `[군사T1, 기동T2, …]` 처럼 선행 단계가 빠진 항목은 선행부터 산다 (TECH_ORDER 거절 방지). 결정당 1개, 못 사면 기다린다 (건너뛰지 않음). 목록 6개 소진 후엔 (단계, 축) 오름차순.
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
77. **플레이테스트 — 공개 룸 방장 즉시 시작**(사용자 결정 2026-10-10, QA m-6 번복): `room.ts startNow` 가 `isPublic` 을 보지 않는다. 방장 = 첫 입장자(퇴장 시 남은 사람 중 playerId 최소). 공개 룸 설정 변경 금지는 유지. `rooms.test.ts`·`qa-ws.ts` 갱신.
78. **플레이테스트 — 방 찾기**: C2S `lobby_list_rooms`·`lobby_join_listed`, S2C `room_list` 추가(§4·§5). 공개 룸만·코드 비노출·`roomId` 핸들·세션당 1초 1회(`RATE_LIMITED`)·최대 50개는 백엔드 결정. `lobby.ts listRooms/joinListed`, `room.ts listing`.
79. **플레이테스트 — 모든 깃발 이동 방향 표시**는 프로토콜 변경 없이 기존 값(`anchorTileId`·`targetTileId`·`flag_recalled/flag_routed.returnTileId`)만 사용. 늦게 입장한 클라이언트는 이미 귀환 중인 깃발의 귀환지를 모른다(스냅샷에 없음 — 그 깃발은 화살표 생략). **v4.2: 지정 귀환이면 `snapshot_full.flags[].returnBaseTileId` 로 알 수 있다.**

### v4.2 (GDD v4.2 + 사용자 A-60 변경 + 봇 기지 공격)에서 정한 것

80. **`halted` 직렬화**: `snapshot_full.flags[].halted` + 델타 `flagFlags` 비트 `HALTED 64`(별도 이벤트 없음 — GDD 7.3). `returnBaseTileId` 는 full 필드 + **새 델타 배열 `flagReturnBase`**(바뀐 깃발만). TS 타입은 두 필드를 optional 로 둠(구 클라이언트 리터럴 호환) — 서버는 항상 싣는다.
81. **`flagProgress` 송신 조건 확대**: `progressPct > 0` 인 깃발 전부 + ATTACK·(ENGAGED ∨ halted) 매 tick + 0 이 된 tick. 정지 점령이 풀리거나 전투로 멈춘 MARCHING 깃발도 진척을 유지하므로(A-54·A-22) "없으면 0" 규칙을 지키려면 필요(프론트 지적 `progressPct` 불일치 해결).
82. **4단계 `settle` ③ 은 실제로 칸을 옮긴 tick 에만** 판정(GDD 는 무조건) — 이동 안 한 tick 은 ① 과 입력이 같아 결과가 같다. `settle` 이 ENGAGED/IDLE 로 바꿀 때는 ①에서도 `moveProgMilli = 0`.
83. **귀환 속도 ×1.5 는 `speedMilli` 의 같은 floor 안에서 곱한다**(`floor(140×UNIT×MOB×1500 / (move×10⁶))`) — 별도 floor 보다 정확. 검병 평원 210 milli/tick.
84. **패주 시 `returnBaseTileId` 유지**(GDD 는 회수 명령·IDLE 자동 회수만 규정). 지정 귀환 중 붙잡혀 패주해도 같은 기지로 간다.
85. **동맹 성립 IDLE(allied)** 은 GDD 6.2 그대로 두되, A-59 재점화가 같은 tick 4단계에서 적용된다(옆에 비동맹 칸이 있으면 즉시 ENGAGED). 동맹 칸 자체는 `marchFront` 에서 빠지므로 다시 공격하지 않는다.
86. **`attackReady` 에 `state ≠ RETURNING`** 명시(GDD 는 RETURNING 이 settle 을 안 탄다는 구조로만 보장).
87. **유지비 [A-60 사용자 변경 2026-10-10]**: GDD v4.2 본문(방어 주둔만)과 다르게 **패주 아닌 출전 깃발 전부** 과금(`economy.ts paysUpkeep`). 공식·면제 1000·상한 700 은 그대로. `isGarrison`(방어 주둔)은 9단계 calmTicks(비활성 누진)에만 남는다.
88. **봇 깊은 앵커 후보 = 국경 칸에서 "점령 가능·비내·비동맹 칸만 밟는" 그래프 BFS `depth` 걸음 안**(GDD 는 기하 `distance ≤ depth`) — 물 건너 칸을 "내 땅에서 멀다"고 고르지 않게. "내 땅까지 거리" 는 토폴로지 인접 다중 출발 BFS(= `minDistFromTerritory`). 점수의 `mass → yield = min(병력/cost, 3×depth)`(최소 1), `march` 는 국경 칸 기준.
89. **봇 v4.2 기타**: 모든 봇 회수에 가장 가까운 내 기지를 `baseTileId` 로 지정(GDD 는 IDLE 약한 깃발만 명시). IDLE 깃발(공격·방어) 병력 ≥ 200 → 깊은 앵커 재지정, 아니면 지정 회수(`BOT_IDLE_REDEPLOY_MIN_TROOPS`). "ENGAGED 인데 front < 2 → 재지정" 규칙 삭제(앵커 칸 ENGAGED 는 옆 칸만 밀고 IDLE). 새 공격 후보 국경 칸이 내 공격 깃발 위치 거리 ≤ 2 면 제외(`BOT_PLOW_SPACING`, 회랑 중복 방지). 공격 병종: 국경 칸이 적 방어 관할 원 안이면 검, 아니면 기병(8.7 3a "기병 비중 상향" — NORMAL·HARD, EASY 는 검 고정). 제자리 반격은 지금 칸 옆에 적 플레이어 칸이 있을 때만. 슬롯 재활용 대상에서 쟁기 중·노선으로 가는 공격 깃발 제외(IDLE 공격·위협 없는 방어만). 위협·선점 후보 = `pushing`.
90. **봇 기지 공격 (사용자 확정 2026-10-10)**: `bestAnchor` 에 내 땅에서 `BOT_BASE_ATTACK_RANGE`(6) 안의 **적(비동맹 플레이어) 기지마다 별도 후보** — 앵커 = 기지 칸(깊은 앵커 없음). 점수 = 8.3 식 × `BOT_BASE_ATTACK_WEIGHT_PERMILLE`(2500) × 관할 원 밖이면 `BOT_BASE_UNGUARDED_PERMILLE`(1500, **에이전트 선택**) × 수도면 `BOT_BASE_CAPITAL_PERMILLE`(1500, **에이전트 선택**) × 체력 절반 미만 1.4(기존 8.3 항, 합침). 같은 소유자 2깃발 제한·이미 그 기지를 노리는 깃발 있으면 제외·회피(8.6) 그대로. 병종: 관할 원 안 = 검, 아니면 기병. 병력 = 풀 × `BOT_COMMIT_BASE_PERMILLE`(500), 최소 공격·예비 규칙 그대로. 중립 기지는 후보 아님(기존 국경 후보로만). 상수는 `shared/constants.ts`(→ `match_config.constants` 에도 보임, 추가만).
91. **로비(체크리스트 10)**: 26b357c 구현분 확인 — 공개 방 방장 `lobby_start_now` 허용, 방 찾기는 GDD 7.3 의 `lobby_join_public{roomId}`/`lobby_spectate{roomId}` 대신 기존 **`lobby_join_listed{roomId, spectate?}`** 하나로 구현돼 있다(§4). `room_list` 필드도 §5 가 정본(GDD 7.3 의 `players`·`mapLabel`·`elapsedTick` 이름과 다름). 이번에 바꾸지 않았다.

### v4.3 (테크 트리, 사용자 승인 2026-10-11)에서 정한 것 — **에이전트 선택**

92. **거절 코드**: 새 코드는 `PREREQ_MISSING`·`ALREADY_OWNED` 둘. 골드 부족은 기존 **`INSUFFICIENT` 재사용**(`NOT_ENOUGH_GOLD` 신설 안 함 — 오케스트레이터 지시 "기존 코드가 있으면 재사용"). `TECH_ORDER` 는 송신 중단, `CmdRejectReason` 타입에만 호환용으로 남김(`NOT_IMPLEMENTED` 와 같은 처리). 검사 순서 `BAD_REQUEST → ALREADY_OWNED → PREREQ_MISSING → INSUFFICIENT` (이미 산 노드는 선행 여부와 무관하게 "이미 보유"가 더 정확한 안내).
93. **스탯 표현**: `TECH_STAT` 32칸(`shared/constants.ts`). 제안서가 "그 플레이어의 상수 값"으로 적은 효과(ECO-2B 유지비 계수 90→72, TER-3A 보급선 계수 20→15, MOB-2B 얕은 물 5000→3500, MOB-3B 상륙, SPE-2A/CAV-3 유지비 가중치, CAV-2A 편성비, SWO-2B 점령 배율)는 **'set'(덮어쓰기)** 노드로, 나머지는 **'add'(permille 증분)** 로 표현. ECO-2B 는 "−20%" 를 곱하지 않고 값 72 로 덮어쓴다(같은 값, 상수 변경 시 노드 값도 같이 봐야 함). 한 스탯에 set 노드 하나·set/add 혼용 금지는 `shared/tech.ts` 가 로드 시 검사.
94. **병종 전투 노드 = 공통 1000 에 더하는 증분**: `combatPm = COMBAT_ATK + COMBAT_ATK_<unit>`(방어는 DEF). SPE-1 "UNIT_DEF 1300 → 1365" 는 `1300 × 1050 / 1000` 으로 구현 — MIL-3B 와 같은 배율 안에서 더해진다(01b 2.2 "permille 증분을 더한다"). **MIL-2A·병종 ATK 노드는 공격 태세에만, MIL-3B·병종 DEF 노드는 방어 태세에만** 적용(구 `MIL_COMBAT` 은 공·방 동시였다 — 01b 4.1 "둘로 나눈다").
95. **상륙 (MOB-3B)**: 제안서 "상륙 교전 손실 배율 1.25 → 1.05" 를 기존 식의 **물 위 전투값 배율 800 → 950** 으로 구현(1000/800 = 1.25, 1000/950 ≈ 1.053 — 구 기동 T2 값). `COMBAT_WATER_VS_LAND_PERMILLE` 은 배열 → 스칼라 800(무테크 값). 물 대 물은 1000 고정(`COMBAT_WATER_VS_WATER_PERMILLE` 삭제).
96. **노출 소모**: 물 위 감소 단계(`WATER_EXPOSURE_PERMILLE_BY_TIER`) 삭제 — 무테크 값이 1000 이었으므로 식에서 항 자체를 뺐다.
97. **거리장 캐시 키** `(목적지, 기동 단계)` → `(목적지, 얕은 물 이동배율)`. 같은 배율 플레이어끼리 거리장을 공유.
98. **직렬화**: `snapshot_full.players[]` 에 `techMask` + `techCount`(= popcount, 누진 가격의 n), `playerDeltas[]` 에 `techMask`(5 tick 주기 변경분 키에 포함), `tech_purchased` 에 `nodeId`·`techMask`. `techMask` 는 JSON 숫자(0..4294967295, 비트 31 = CAV-3 도 양수 — 서버는 `>>> 0`).
99. **봇 테크**(01b 6.1·6.2 그대로 + 정한 것): 목록은 노드 코드 16개 × 4(`bot.ts TECH_PRIORITY_CODES`), 서버 시작 시 "부모가 앞" assert. 성향 = `(playerId − 1) % 4`(구 규칙 유지). EASY 치환은 난이도 이름이 아니라 **`fixedUnit === SWORD`** 로 판정(`TECH_PRIORITY_SWORD`). 16개 소진 후엔 (티어, id) 오름차순으로 선행 충족 노드(구 규칙과 같은 꼴). **상륙 후보 탐색 조건 "기동 T2+" → "MOB-2B 조선술 보유"**(구 T2 = 얕은 물 3000, 새 MOB-2B = 3500 이 대응). 봇 판단의 전투값 비교는 전부 `flagValue` 경유라 별도 수정 없이 새 태세별 배율을 쓴다. 발령 가능 병력·풀 비용은 `CONVERT_<unit>/1000`.
100. **스탯 캐시 갱신**: 구매 시 `statPm = techStatValues(techMask)` 를 처음부터 다시 계산(증분 갱신 아님) — 마스크만의 함수라 순서·재접속·봇 인계와 무관하게 같다.
101. **`TECH_NODES[].tier` = 가격 티어**(별도 `costTier` 필드 없음). 노드 항목 = `{ id, code, branch, tier, parent, stat, op: 'add'|'set', value, name, desc }` — `desc` 는 짧은 한국어 효과 문구(UI 한 줄). 아이콘은 프론트 몫(01b 2.3 아이콘 열 참고).
102. **구 상수 처리**: `TECH_AXIS`·`TECH_AXIS_COUNT`·`TECH_MAX_TIER`·`TECH_BASE_COST`·`MIL_*`·`ECO_*`·`TER_*`·`MOB_*`·`SHALLOW_MOVE_PERMILLE_BY_TIER`·`WATER_EXPOSURE_PERMILLE_BY_TIER`·`COMBAT_WATER_VS_WATER_PERMILLE` **export 삭제**(값은 `constants.ts` 주석에 "폐기" 로 기록). `match_config.constants` 에서도 빠진다. `SHALLOW_MOVE_PERMILLE_MIN`(2000) 은 유지.
103. **깃발 접촉 8방향 (사용자 결정 2026-10-11) — 구현에서 정한 것**: 토폴로지 인터페이스에 `contactNeighbors(t)`(자기 제외, tileId 오름차순)·`touching(a, b)`(a = b 포함) 추가, 사각 = 체비셰프 ≤ 1. **지형 무시**(깃발은 깊은 물에 서지 않으므로 v4.2 의 "이동 그래프 이웃" 과 차이는 대각선뿐 — 깊은 물 모서리를 사이에 둔 대각선도 접촉). `PROGRESS_HOLD_RANGE`(1)·`FLAG_ENGAGE_RANGE`(1) 값은 그대로 두고 "1 = 접촉" 으로 해석(`gauge.ts` 는 1 이 아니면 예외). 봇: `combatFoes`·차단 당하기 실효력 합·주둔 반격 칸(적 깃발 접촉 칸)·**요격 칸 = 적 깃발과 접촉하는 내 땅(대각선 포함, tileId 최소)**, 없으면 접촉 밖 맨해튼 2 칸. 차단 쓰기 칸 후보에서 이미 접촉(대각선) 칸 제외. 위협·관할 원·`FRONT_RADIUS`·앵커 거리 계산은 맨해튼 그대로.

### v4.4 (사용자 결정 2026-10-14 — 기지 방어·우클릭·멸망·합병·생산력·지명)에서 정한 것 — **에이전트 선택 [A]**

104. **[A-85] 생산력 회복 = 선형, 분당 +167‰**(`BASE_PROD_RECOVER_PER_MIN_PERMILLE`) — 50% → 100% 약 3.0분, 25% → 100% 약 4.5분. 사용자 예시("약 3분에 100%")에 맞춘 값. 비례(지수) 회복 대신 선형을 고른 이유: 바가 일정한 속도로 차올라 읽기 쉽고 정수 누적이 단순하다(`‰ × 300` 정수에 tick 당 +167). **항상 회복**(공격받는 중·중립 기지 포함 — 회복 정지 조건은 두지 않았다). 점령 시 `floor(‰ × 500 / 1000)` 은 사용자 확정.
105. **[A-86] 생산 지역 = 내 땅만 밟는 4방향 그래프 거리로 가장 가까운 내 기지**(수도 포함), 동률 = 기지 tileId 작은 쪽. 맨해튼(지형 무시) 대신 "내 땅 경로" 를 고른 이유: 사용자 표현 "graph distance" + **"기타" 지역이 의미를 갖게**(기지가 하나라도 있으면 맨해튼 기준으로는 모든 칸에 최근접 기지가 있어 "기타" 가 늘 비게 된다). 내 기지와 내 땅으로 이어지지 않은 칸(고립지·월경지) = "기타", 생산력 1000. 다중 출발 BFS 1회(기지 tileId ASC 투입 → 같은 층은 출발 순서로 묶여 동률이 작은 tileId 로 간다), **소유권이 바뀐 뒤 첫 2단계에서만 재계산**(`regionsDirty` — 칸 점령이 거의 매 tick 있으니 사실상 매 tick, 비용은 타일 수 비례: M 10인 tick 평균 0.28 → 0.38ms, L 12인 0.44~0.53ms).
106. **[A-87] 생산 적용** = "지역 몫 × 생산력" (§21.4 식). 병력: 기존 재생 R(√tiles·로지스틱)을 그대로 두고 `R × Σ(tiles_r × pm_r) / (tiles × 1000)` — √ 안에 유효 칸 수를 넣는 방식(감소가 √ 로 약해짐) 대신 선형을 골랐다(사용자 "지역 생산에 그 기지 배율"). 병력 **상한은 생산력과 무관**(전체 칸 수). 골드: 지역 골드 가중치(지형 가중) × 생산력. 유지비는 총 그로스에 한 번(기존 정수식 그대로). 지역별 몫은 floor 분배 + 잔여는 가중치 최대 지역 → **지역 합 = 총합 정확히**, 생산력이 전부 1000 이면 기존 값과 비트 단위로 같다. 플레이어 `goldWeight` 필드는 원값 유지(의미 변경 없음).
107. **[A-88] 기지 위 수비 깃발이 있는 동안 기지 체력 피해 0** — "공격자는 먼저 깃발 전투를 이겨야 한다". 현 전투 모델에서 이미 성립(기지를 미는 공격 깃발은 기지 칸과 4방향 인접 ⇒ 8방향 접촉 ⇒ 4a 전투 ⇒ `pushing` 아님)하므로 새 규칙이 아니라 귀결이다. 6단계에 같은 조건(`baseOccupiedByHostile`: 기지 칸 위에 공격자와 적대인 `combatEligible` 깃발)을 명시 검사로 추가해 불변식으로 고정했다. 기지 주인의 **동맹** 깃발이 서 있어도 막는다(공격자와 적대이므로 어차피 전투). 패주한 수비 깃발은 막지 못한다.
108. **×1.5 적용 범위**: 방어 태세 + **내** 기지 칸(수도 포함)만. 동맹 기지 위는 지형 보정(사용자 문구 "its own base"). 서 있는 동안 기지가 넘어가면 그 tick 부터 지형 보정. 공격 태세는 기지 위라도 기존 값.
109. **[A-90] 재지정 태세 대기(`pendingPosture`)**: 사용자 결정 "태세는 도착지로" 를 쿨타임·전투 중에도 지키기 위해, 즉시 못 바꾸면 미뤘다가 자동 적용. 전투 중 즉시 전환을 허용하지 않은 이유: 공격 태세로 싸우다 내 땅으로 재지정하면 방어↔방어가 되어 **이탈 대기(3초, ×0.5) 없이 전투가 끊기는 탈출구**가 생긴다. 직렬화는 full 필드 + 델타 비트 128(대기 태세는 항상 현재의 반대라 1비트로 충분 — `flagFlags` 튜플 모양 유지). 적용 시 ENGAGED·IDLE 깃발은 MARCHING 으로 돌려 같은 tick settle 이 새 태세로 다시 판정(공격 태세로 바뀐 방어 주둔 깃발이 엉뚱한 칸에서 밀지 않게). `postureManual = false`.
110. **[A-91] 멸망·합병 세부**: 합병 대상 = `lastBaseLostTo`(그 플레이어 기지를 마지막으로 가져간 플레이어 — `setTileOwner` 가 기지 칸 소유 변경 때 기록, 없으면 `lastLostTo`). 같은 tick 연쇄는 playerId ASC 처리 + `conqueredBy` 추적(합병 대상이 이미 멸망 → 그를 멸망시킨 쪽, 끝내 없으면 중립). 풀 병력·골드·테크·유지 중 동맹은 넘기지 않는다(소멸 — 회계 `eliminated`). 대량 칸 이전은 `setTileOwner` 경유 → 같은 tick 델타 `tileChanges`(별도 full 강제 송신 없음 — 최악 수천 쌍 × 1회). `player_eliminated` 에 `annexedTiles` 추가.
111. **봇 기지 수비 (§11, 사용자 "적당히")**: `guardBases` — 결정당 1회, `defend`(요격)보다 먼저. 대상 = **마지막 기지**(적대 공격 깃발이 `BOT_LAST_BASE_GUARD_RADIUS` 8 안) **+ 마지막이 아닌 기지는 최근 `BOT_BASE_GUARD_DAMAGE_WINDOW` 25 tick 안에 체력이 깎인 것**(`BOT_BASE_GUARD_RADIUS` 4 안 위협). 우선순위 = 위협 실효력 합 큰 순. 이미 기지 위(또는 가는 중) 수비대 실효력 ≥ 위협 × `BOT_INTERCEPT_RATIO`(1.25) 면 건너뜀. 수단 ① 창병 발령(앵커 = 기지 → 출발도 그 기지라 즉시 자리), 필요 병력 = 위협 × 1.25 ÷ 기지 위 창 방어값(1950), 최소 풀 40% — **마지막 기지는 필요량에 못 미쳐도 가진 만큼** ② 슬롯·병력이 없고 마지막 기지면 가장 가까운 비전투 깃발을 기지로 재지정(→ DEFEND). 수비대는 주둔 반격·제자리 공격 전환을 하지 않고, 위협 없이 `BOT_GARRISON_PATIENCE`(3분)가 지나면 회수, 위협 중엔 슬롯 재활용 대상에서 빠진다. **범위 선택 근거 = 자가대전 비교(§9 v4.4)**: 위협받는 기지 전부를 지키면 기지 함락이 33.0 → 14.4/판으로 반 이하, 마지막 기지만 지키면 26.0 이지만 일반 기지 방어를 전혀 안 쓴다 → 중간("공격받는 기지")을 골랐다(20.5/판, 탈락 1.2/판). 봇 기지 공격 점수(마지막 기지 가산 등)는 **바꾸지 않았다**.
112. **[A-92] 지명**: 풀 120개(고유어풍 80 + 판타지풍 40, 한글 2~3음절)를 서버에 두고, **룸 시드**(무작위 맵 = 맵 시드 / 프리셋 맵 = 룸이 뽑은 시드 — 봇 성향 시드와 같은 값)로 Mulberry32 Fisher–Yates 셔플 → 기지 tileId 순서로 배정. 프리셋 맵에 맵 시드(파일 `origin.seed`, 없으면 0)를 쓰면 공식 맵마다 이름이 늘 같아져서 룸 시드를 골랐다. 풀보다 기지가 많으면(현 상한 24 라 발생 안 함) `"이름 2"` 접미사로 고유성 유지. 전송 = `map_init.baseNames`(bases 와 평행 배열).
113. **`production` 직렬화**: 단위 milli/초(=milli/tick × 5) 정수, 델타는 5 tick 마다 바뀐 플레이어만 통째(지역 수가 적어 부분 갱신보다 단순), full 은 전원. 기지 생산력 델타 `baseProd` 는 `baseHp` 와 같은 5 tick 주기·변경분만. 새 필드는 TS 상 optional(구 클라이언트 리터럴 호환, v4.2 `halted` 와 같은 처리) — 서버는 항상 싣는다.

### v4.5 (사용자 결정 2026-10-15)에서 정한 것 — **에이전트 선택 [A]** (상세·근거는 §22.9)

114. **[A-102]** 호수 생성기(반해상도 CA) · 물 창 8.5~11.5% · 섬은 물로 메워 육지 한 덩어리
115. **[A-103]** 기지 병력 생산 = 기준 390칸 평균 재생 × 환산 칸(60/100) × 생산력 — 선형 별도 항, 로지스틱·테크는 합에 한 번
116. **[A-104]** 기지 피해 상한 분배 = 원래 피해 비례(잔여 → 큰 피해·앞 순서), 총량 ≤ min(300, 남은 체력), 지출 = 적용 피해분만
117. **[A-105]** `COMBAT_LOSS_FLOOR_BP` 75 → 45 (손실률과 같은 비율 ×0.6)
118. **[A-106]** 기지 ×1.5: 방어 = 지형 항 대체(v4.4 그대로), 공격 = 공격값 × 1.5 (테크 배율 앞)
119. **[A-107]** 수도 100칸분 = 시작 수도였던 칸이면 소유자 무관
120. **[A-108]** 서양식 지명 = 한국어 음차 135개
121. **[A-109]** 봇: 중립 기지도 기지 후보(×2.0, 풀 45%)
122. **[A-110]** 판 길이 추정식 기준 1인당 육지 390 → 540 (`PACING_P_REF_LAND_PER_PLAYER`)
123. **[A-111]** `production` = `rows`(기지 행 + 영토 행), 델타 `combatLoss` 추가
124. **[A-112]** 방어 태세 경로가 적 땅 때문에 막히면 "적 땅 바로 앞"(지형 거리로 앵커에 가장 가까운 도달 칸)에서 IDLE(unreachable)
125. **[A-113]** 중립 노출 소모 = 적 땅의 절반(25/100000, 최소 500 milli/tick)
126. 01c 노드 교체 구현 세부 — MOB-3B 봇 우선순위 13번째(②안이라 제안의 11번째보다 뒤), 이탈 대기 tick 은 명령 수락 시점의 소유자 스탯, 귀환 속도는 매 tick 소유자 스탯

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

**v4.2 봇 (8.7, §10-88~90)**: 결정 순서 동일. 4번 깃발 정비에서 IDLE → (병력 ≥ 200) 깊은 앵커 재지정 / 지정 기지 회수, 7번 채우기의 앵커 = 깊은 앵커 또는 **적 기지**(풀 50%). RETURNING 깃발에는 명령을 내지 않는다(거절률 0% 유지). 측정은 §9 v4.2.

**v4.4 봇 (사용자 2026-10-14, §10-111)**: 결정 순서 3번 앞에 **기지 수비 `guardBases`**(결정당 1회) — 마지막 기지(반경 8 안 적 공격 깃발) + 마지막이 아닌 기지는 최근 25 tick 안에 체력이 깎일 때(반경 4) 그 기지를 앵커로 창병 발령(기지 위 방어 ×1.5), 마지막 기지는 병력이 모자라도 가진 만큼·슬롯이 없으면 가장 가까운 비전투 깃발을 기지로 재지정. 기지 수비대는 주둔 반격·제자리 공격 전환·위협 중 재활용·요격 재배치 대상에서 빠진다. 공격 쪽(기지 후보 점수)은 바꾸지 않았다.

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
9. **(v4.3 테크, game-designer 확인 요청)** 자가대전 테크 구매 수가 제안서 추정보다 적다(최종: 1위 12.2 / 중앙 9.7 / 탈락 3.5 vs 14 / 9 / 5). 테크만 바꾸면 30분 1위 점유율 22.4% → 19.0%, 8방향 접촉까지 넣으면 22.1%. NORMAL 봇은 검병 노드를 거의 안 사고(SWO 0%), 목록 후반 노드(MIL-3A·TER-3A·MOB-3B·SPE-2B) 구매율 0% (§9 v4.3). 수치는 바꾸지 않았다.

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
| 규칙 | ~~귀환 중 교전에 붙잡힌 깃발에 회수·재지정 가능 (I-2)~~ → **v4.2 [A-62] 폐기**: 귀환 중 명령은 전부 `RETURNING`, 대신 자동 이탈 대기(`flag_disengage_started{auto:true}`) — §18 |
| 순서 | `cmd_ack` 이 그 tick 방송보다 먼저 온다 → `flag_issued` 전에 `cmd_ack.flagId` 를 알 수 있고 `game_over` 가 그 tick 마지막 (m-5) |
| 기타 | 공개 룸 `lobby_start_now` → `NOT_HOST` (m-6). 재접속 부트스트랩의 본인 `connected=true` (m-7). 봇 명령 ack 미배달 (m-10). 종료 후 남은 명령 `NOT_IN_GAME` ack (m-9). 65자 이상 닉네임도 `BAD_NICKNAME` (m-1) |
| QA 스크립트 | `npm run qa:headless|qa:scenarios|qa:ws -w @civwar/server` (`qa-schema.ts` 는 모듈) |
| 필드 추가 (프론트 2차) | `room_state.autoStartMs: number \| null` — 공개 룸 LOBBY 에서 자동 시작까지 남은 ms(수신 시각 기준), 그 외 null. §5·§10-72·§17 |
| 프론트 QA 후속 | `flag_issued`/`flag_retargeted.engageEtaTick`, `welcome.officialMaps[].checksum` 필드 추가, GAME_OVER 부트스트랩 뒤 `game_over` 재송신 — §17 |
| 플레이테스트 후속 | 공개 룸 방장 `lobby_start_now` 허용(의미 변경 — 이전 `NOT_HOST`), `lobby_list_rooms`/`lobby_join_listed`/`room_list` 추가, `RATE_LIMITED` 사용 시작 — §3·§4·§5·§10-77~79 |

## 17. 프론트 2차 변경 요약 (2026-10-09, frontend-game-client-engineer — 오케스트레이터 지시)

| 구분 | 내용 |
|---|---|
| 필드 추가 | `room_state.autoStartMs: number \| null` — 공개 룸 LOBBY 에서 자동 시작까지 남은 ms, 그 외 null (§5, §10-72) |
| 제거·의미 변경 | 없음 |
| 서버 코드 | `server/src/room/room.ts` (`autoStartAt` 기록·에코), `shared/src/protocol.ts` 타입, `server/scripts/qa-schema.ts`, `server/test/rooms.test.ts` |
| 필드 추가 (프론트 QA) | `flag_issued.engageEtaTick`, `flag_retargeted.engageEtaTick` (§5, §10-74), `welcome.officialMaps[].checksum` (§5, §10-75) |
| 개인 메시지 추가 (프론트 QA J-2) | GAME_OVER 룸 부트스트랩 뒤 `game_over` 재송신 (§2, §5, §10-73) |
| 문서화 | 관전자 새로고침 → 로비 (§3, §10-76), 정리된 룸에 `lobby_leave` → `NOT_IN_ROOM` (§3) |
| 플레이테스트 후속 (2026-10-10) | 공개 룸 방장 즉시 시작(§3, §10-77 — 공개 룸 `lobby_start_now` 가 방장이면 수락으로 **의미 변경**), 방 찾기 메시지 3종(§4·§5, §10-78), 이동 방향 표시는 프로토콜 변경 없음(§10-79) |

## 18. v4.2 변경 요약 (프론트 영향 — 2026-10-10, GDD v4.2 + A-60 변경)

**이 절만 보고 클라이언트를 맞출 수 있게 썼다. 메시지·필드는 전부 추가만이고, 아래 "의미 변경"이 기존 구현을 깨뜨릴 수 있다.**

| 구분 | 내용 |
|---|---|
| **C→S 추가** | `cmd_flag_recall.baseTileId?: number \| null` — 깃발 선택 후 **내 기지 클릭 = 지정 회수**. 거절 `NOT_BASE`(기지 칸 아님) / `NOT_OWNED_BASE`(내 것 아님). 생략·null = 자동 귀환지 |
| **snapshot_full 추가** | `flags[].halted: bool`, `flags[].returnBaseTileId: number \| null` (항상 존재) |
| **snapshot_delta 추가** | `flagFlags` 비트 `HALTED = 64`(값 범위 0..127). 새 배열 `flagReturnBase: [flagId, baseTileId \| null][]`(항상 존재, 바뀐 깃발만) |
| **이벤트 필드 추가** | `flag_disengage_started.auto: bool` — `true` = 귀환 깃발이 붙잡혀 서버가 자동 개시("귀환 중 — 붙잡힘, 3초 뒤 이탈") |
| **상수 추가/변경** | `RETURN_SPEED_PERMILLE = 1500`(신규), **`FLAG_SPEED_BASE_MILLI` 120 → 140**, 봇 상수 `BOT_COMMIT_BASE_PERMILLE`·`BOT_BASE_ATTACK_RANGE`·`BOT_BASE_ATTACK_WEIGHT_PERMILLE`·`BOT_BASE_UNGUARDED_PERMILLE`·`BOT_BASE_CAPITAL_PERMILLE`(표시 불필요). 모두 `match_config.constants` 로 온다 — ETA·속도 예측은 서버 값을 쓸 것 |
| **의미 변경 — 공격** | 공격 태세 깃발의 대상 = **깃발 현재 칸의 이웃 중 점령 가능·비동맹(중립·제3자 포함) 칸뿐**. **앵커 반경 6 원 공격 폐기**(붉은 원 UI 제거 → 경로선 + 폭 3 회랑 미리보기). 내 땅에 닿지 않아도 됨 → **고립 영토** 생긴다(렌더는 칸 단위라 영향 없음). 깃발은 먹을 옆 칸이 있으면 **멈춰서**(`MARCHING` + `halted`) 점령, 없어지면 다시 걷는다. 앵커 칸에서는 `ENGAGED`(옆 칸 점령) → 다 먹으면 `IDLE` → 옆 칸이 다시 적·중립이 되면 **그 자리에서 재점화**(`flag_engaged`, 이동 없음) → IDLE 600 tick 뒤 자동 귀환. 방어 태세는 이동만(방어 원 반경 6 = guard 유지) |
| **의미 변경 — `flag_engaged`** | 공격 깃발은 **앵커 칸에 섰을 때(또는 IDLE 재점화)만** 나온다. 가는 길의 정지 점령은 이벤트 없이 `HALTED` 비트로만 알 수 있다. `frontTileCount` = 그 순간 옆 칸 수(≤ 4). **클라이언트 m-4 테스트("engageEtaTick 오차")는 실측 기준을 "그 깃발의 첫 `HALTED` 비트 tick 또는 `flag_engaged` 중 먼저"로 바꿀 것** — `engageEtaTick` 의 정의(ATTACK = 정지 점령이 처음 시작되는 칸)가 그 시점이다 |
| **의미 변경 — ETA** | `etaTick` = 정지 점령 시간을 뺀 이동 ETA(공격 태세는 실제 도착이 훨씬 늦다). 귀환 ETA = 귀환 속도 ×1.5 반영(`speedMilli` 식 §8) |
| **의미 변경 — `flagProgress`** | `progressPct > 0` 인 깃발은 상태와 무관하게 매 tick 실린다(+ ATTACK·ENGAGED/halted 는 0 이어도, + 0 이 된 tick 1회). **"목록에 없으면 0" 규칙 그대로 유효**. v4.1 까지는 ATTACK·ENGAGED 만이었다 |
| **의미 변경 — 귀환** | RETURNING(회수·IDLE 자동·패주) 깃발: `cmd_flag_retarget`·`cmd_flag_recall`·`cmd_set_posture` **전부 `RETURNING` 거절, 전투 중이어도**(QA I-2 수락 경로 폐기) → 명령 버튼 비활성 + "귀환 중 — 취소 불가". 실제로 걸어서 귀환(×1.5), ZOC 무시, 지나가며 싸움을 걸지 않음, 붙잡히면 자동 이탈 대기 후 계속. 지정 기지를 잃으면 `flagReturnBase [id, null]` → 자동 귀환지(되찾아도 안 돌아감). 화살표 = `returnBaseTileId ?? (flag_recalled/flag_routed).returnTileId` |
| **의미 변경 — 유지비 (A-60 사용자 변경)** | `upkeepPm` 이 이제 **출전 깃발 전부(패주 제외, 태세·상태 무관)** 기준 — 깃발을 내면 바로 골드 수입이 준다. 상한 700‰ 유지(순수입 ≥ 그로스의 30%). **하단 바 "초당 골드 소모"**: `gross = floor(goldWeight × GOLD_RATE_PERMILLE × ECO_GOLD_PERMILLE_BY_TIER[tech[1]] / 1e9)`(milli/tick), `upkeep = floor(gross × upkeepPm / 1000)`, `net = gross − upkeep`; 골드/초 = 값 × 5 / 1000(`TICK_MS` 200). 발령 미리보기는 §8 유지비 식에 새 깃발 가중치(창 600·검 1000·기 1600)를 더해 계산 |
| **송신 중단** | `flag_retargeted{auto:true}`(4.5 중립 자동 전환 폐기 — 필드는 유지). `targetOwnerId` 는 표시용(규칙 미사용) |
| **동맹** | 동맹 칸은 공격 대상 아님. 동맹 성립으로 IDLE(allied)된 깃발도 옆에 비동맹 칸이 있으면 같은 tick 재점화 |
| 불변 | 깃발 전투 수치(대표 전투 표 그대로), 방어 태세·ZOC(귀환 제외)·게이지 레이스·기지 체력, 로비·방 찾기 메시지 |

## 19. v4.3 테크 트리 변경 요약 (프론트 영향 — 2026-10-11, A-66~A-84 승인본)

**이 절만 보고 새 테크 화면을 만들 수 있게 썼다. 구 테크 필드·메시지·상수는 삭제됐다 — 기존 클라이언트 테크 UI 는 그대로는 동작하지 않는다(빌드 유지용 임시 수정만 해 두었다, 아래 "클라이언트").**

### 19.1 메시지

| 구분 | 내용 |
|---|---|
| **C→S 변경** | `cmd_buy_tech { clientSeq, nodeId }` — `nodeId` = `TECH_NODES[].id` (0..31). **구 `{ axis, tier }` 삭제**(보내면 `BAD_REQUEST`) |
| **거절** | `BAD_REQUEST`(nodeId 없음·범위 밖) → `ALREADY_OWNED`(이미 보유) → `PREREQ_MISSING`(부모 미보유) → `INSUFFICIENT`(골드 < 가격). `TECH_ORDER` 는 더 이상 오지 않는다 |
| **snapshot_full 변경** | `players[].tech: [n,n,n,n]` **삭제** → `players[].techMask: number`(uint32, 비트 i = 노드 i 보유) + `players[].techCount: number`(보유 수 = 누진 가격의 n) |
| **snapshot_delta 추가** | `playerDeltas[].techMask` (5 tick 주기, 다른 표시값과 함께 바뀐 플레이어만) |
| **tech_purchased 변경** | `{ tick, playerId, nodeId, cost, newFlagCap, techMask }` — **`axis`·`tier` 삭제**, `nodeId`·`techMask`(구매 후) 추가. 받으면 `techMask` 로 덮어쓰고 `techCount = popcount` |
| **match_config.constants 추가** | `TECH_NODES`(32 항목), `TECH_STAT`, `TECH_STAT_COUNT`, `TECH_STAT_BASE`, `TECH_NODE_BASE_COST` [160,360,700], `TECH_PROGRESSIVE_COEF_PERMILLE` 60(구 250), `TECH_NODE_COUNT` 32, `TECH_BRANCH`, `TECH_BRANCH_COUNT`, `TECH_BRANCH_NAME` |
| **match_config.constants 삭제** | `TECH_AXIS`, `TECH_AXIS_COUNT`, `TECH_MAX_TIER`, `TECH_BASE_COST`, `MIL_ATK_COST_PERMILLE_BY_TIER`, `MIL_DEF_COST_PERMILLE_BY_TIER`, `MIL_COMBAT_PERMILLE_BY_TIER`, `ECO_GOLD_PERMILLE_BY_TIER`, `ECO_REGEN_PERMILLE_BY_TIER`, `TER_NEUTRAL_COST_PERMILLE_BY_TIER`, `TER_CAP_PERMILLE_BY_TIER`, `MOB_SPEED_PERMILLE_BY_TIER`, `MOB_SLOT_BONUS_BY_TIER`, `MOB_CONVERT_PERMILLE_BY_TIER`, `SHALLOW_MOVE_PERMILLE_BY_TIER`, `WATER_EXPOSURE_PERMILLE_BY_TIER`, `COMBAT_WATER_VS_WATER_PERMILLE` |
| **match_config.constants 의미 변경** | `COMBAT_WATER_VS_LAND_PERMILLE` 배열 → **스칼라 800**(무테크 상륙 전투값 배율) |

예시:
```json
{ "type": "cmd_buy_tech", "clientSeq": 7, "nodeId": 16 }
{ "type": "cmd_ack", "clientSeq": 7, "accepted": false, "reason": "PREREQ_MISSING" }
{ "type": "tech_purchased", "tick": 410, "playerId": 3, "nodeId": 15, "cost": 169, "newFlagCap": 4, "techMask": 32800 }
{ "id": 3, "tiles": 210, "troops": 900, "gold": 41, "goldWeight": 190000, "upkeepPm": 90, "techMask": 32800, "techCount": 2, "flagCap": 3, "alive": true, "connected": true }
```

### 19.2 노드 표 `TECH_NODES` (원본 `shared/src/constants.ts`, 서버가 `match_config.constants` 로 보냄)

항목: `{ id, code, branch, tier, parent, stat, op, value, name, desc }`. `branch` 0 군사 MIL · 1 경제 ECO · 2 영토 TER · 3 기동 MOB · 4 창병 SPE · 5 검병 SWO · 6 기병 CAV. `parent` = 선행 노드 id(T1 = null, 부모는 같은 갈래 한 티어 아래). `op` 'add' = 스탯에 더함 / 'set' = 스탯을 그 값으로.

| id | code | 이름 | T | 부모 | stat | op · value | 효과 |
|---|---|---|---|---|---|---|---|
| 0 | MIL-1 | 훈련장 | 1 | — | ATK_COST | add −40 | 적 땅 점령비용 −4% |
| 1 | MIL-2A | 공격 교리 | 2 | 0 | COMBAT_ATK | add +30 | 공격 태세 전투 공격력 +3% |
| 2 | MIL-2B | 성벽 보강 | 2 | 0 | DEF_COST | add +60 | 내 땅 피점령비용 +6% |
| 3 | MIL-3A | 공성 전술 | 3 | 1 | ATK_COST | add −50 | 적 땅 점령비용 −5% 추가 |
| 4 | MIL-3B | 방어 교리 | 3 | 2 | COMBAT_DEF | add +40 | 방어 태세 전투 방어력 +4% |
| 5 | ECO-1 | 세금 징수 | 1 | — | GOLD | add +80 | 골드 +8% |
| 6 | ECO-2A | 시장 | 2 | 5 | GOLD | add +100 | 골드 +10% |
| 7 | ECO-2B | 병참 | 2 | 5 | UPKEEP_COEF | set 72 | 유지비 계수 90 → 72 (−20%) |
| 8 | ECO-3A | 조폐국 | 3 | 6 | GOLD | add +120 | 골드 +12% |
| 9 | ECO-3B | 곡창 | 3 | 7 | REGEN | add +60 | 병력 재생 +6% |
| 10 | TER-1 | 개척민 | 1 | — | NEUTRAL_COST | add −60 | 중립 점령비용 −6% |
| 11 | TER-2A | 측량 | 2 | 10 | NEUTRAL_COST | add −80 | 중립 점령비용 −8% |
| 12 | TER-2B | 징병소 | 2 | 10 | TROOP_CAP | add +60 | 병력 상한 +6% |
| 13 | TER-3A | 도로망 | 3 | 11 | SUPPLY_COEF | set 15 | 보급선 계수 20 → 15 |
| 14 | TER-3B | 상비군 | 3 | 12 | TROOP_CAP | add +80 | 병력 상한 +8% |
| 15 | MOB-1 | 행군로 | 1 | — | SPEED | add +150 | 이동속도 +15% (전 병종) |
| 16 | MOB-2A | 강행군 | 2 | 15 | SPEED | add +150 | 이동속도 +15% (전 병종) |
| 17 | MOB-2B | 조선술 | 2 | 15 | SHALLOW_MOVE | set 3500 | 얕은 물 이동배율 5.00 → 3.50 |
| 18 | MOB-3A | 참모부 | 3 | 16 | SLOT_BONUS | add +1 | 깃발 슬롯 +1 (최대 +1) |
| 19 | MOB-3B | 상륙정 | 3 | 17 | LANDING_COMBAT | set 950 | 상륙 전투값 ×0.80 → ×0.95 (손실 1.25 → 1.05) |
| 20 | SPE-1 | 장창 대열 | 1 | — | COMBAT_DEF_SPEAR | add +50 | 창병 방어력 +5% |
| 21 | SPE-2A | 주둔 진지 | 2 | 20 | UPKEEP_WEIGHT_SPEAR | set 450 | 창병 유지비 가중치 600 → 450 |
| 22 | SPE-2B | 행군 장화 | 2 | 20 | SPEED_SPEAR | add +100 | 창병 이동속도 +10% |
| 23 | SPE-3 | 고슴도치 진 | 3 | 21 | COMBAT_DEF_SPEAR | add +50 | 창병 방어력 +5% 추가 |
| 24 | SWO-1 | 검술 | 1 | — | COMBAT_ATK_SWORD | add +50 | 검병 공격력 +5% |
| 25 | SWO-2A | 사슬 갑옷 | 2 | 24 | COMBAT_DEF_SWORD | add +50 | 검병 방어력 +5% |
| 26 | SWO-2B | 돌격 보병 | 2 | 24 | CAPTURE_MULT_SWORD | set 950 | 검병 점령비용 배율 1000 → 950 |
| 27 | SWO-3 | 정예 보병 | 3 | 26 | COMBAT_ATK_SWORD | add +60 | 검병 공격력 +6% 추가 |
| 28 | CAV-1 | 군마 | 1 | — | SPEED_CAVALRY | add +100 | 기병 이동속도 +10% |
| 29 | CAV-2A | 마구간 | 2 | 28 | CONVERT_CAVALRY | set 1070 | 기병 편성비 1150 → 1070 |
| 30 | CAV-2B | 기병창 | 2 | 28 | COMBAT_ATK_CAVALRY | add +50 | 기병 공격력 +5% |
| 31 | CAV-3 | 역참 | 3 | 29 | UPKEEP_WEIGHT_CAVALRY | set 1300 | 기병 유지비 가중치 1600 → 1300 |

### 19.3 클라이언트 계산식 (서버와 같은 정수식 — `@civwar/shared` 의 함수를 그대로 써도 된다)

```
owned(mask, i)      = ((mask >>> i) & 1) == 1
canBuy(mask, i)     = !owned(mask, i) && (parent(i) == null || owned(mask, parent(i)))       // techPrereqMet
cost(i, n)          = floor(TECH_NODE_BASE_COST[tier(i)-1] × (1000 + 60 × n) / 1000)          // techNodeCost, n = techCount
stat = techStatValues(mask):  v = TECH_STAT_BASE.slice()
                               for 보유 'set' 노드: v[stat] = value
                               for 보유 'add' 노드: v[stat] += value                        // 순서 무관
```
| 쓰는 곳 | 식 (`v` = 위 스탯) | 무테크 |
|---|---|---|
| 골드 그로스 | `floor(goldWeight × 2080 × v[GOLD] / 1e9)` milli/tick | 1000 |
| 병력 상한 / 재생 | `v[TROOP_CAP]` / `v[REGEN]` (§8) | 1000 / 1000 |
| 슬롯 | `flagCap = min(7, 3 + floor(tiles/300) + v[SLOT_BONUS])` | 0 |
| 이동속도 | `floor(140 × UNIT_SPEED[u] × (v[SPEED] + v[SPEED_SPEAR+u]) × RET / (moveCost × 1e6))` | 1000 + 0 |
| 얕은 물 | `moveCost = max(2000, v[SHALLOW_MOVE])`, 경로 거리장도 이 값 | 5000 |
| 유지비 (발령 미리보기) | `w = Σ v[UPKEEP_WEIGHT_SPEAR+u]`, `min(700, floor(max(0, w − 1000) × v[UPKEEP_COEF] / 1000))` | 600/1000/1600, 90 |
| 풀 차감 (발령) | `ceil(troops × v[CONVERT_SPEAR+u] / 1000)` | 1000/1000/1150 |
| 점령비용 | §8 `tileCost` — 중립 × `v[NEUTRAL_COST]`, 적 × 방어자 `v[DEF_COST]` × 공격자 `v[ATK_COST]`, 병종 × `v[CAPTURE_MULT_SPEAR+u]`, 보급선 계수 `v[SUPPLY_COEF]` | 1000, 1150/1000/850, 20 |
| 깃발 전투값 | 공격 태세 `UNIT_ATK[u] × (v[COMBAT_ATK] + v[COMBAT_ATK_SPEAR+u]) / 1000`, 방어 태세 `… × (v[COMBAT_DEF] + v[COMBAT_DEF_SPEAR+u]) / 1000`, 상륙 `× v[LANDING_COMBAT] / 1000` | 1000 + 0, 800 |

`TECH_STAT` 인덱스: 0 ATK_COST · 1 DEF_COST · 2 COMBAT_ATK · 3 COMBAT_DEF · 4 GOLD · 5 UPKEEP_COEF · 6 REGEN · 7 NEUTRAL_COST · 8 TROOP_CAP · 9 SUPPLY_COEF · 10 SPEED · 11 SHALLOW_MOVE · 12 SLOT_BONUS · 13 LANDING_COMBAT · 14–16 COMBAT_ATK_(창·검·기) · 17–19 COMBAT_DEF_* · 20–22 SPEED_* · 23–25 UPKEEP_WEIGHT_* · 26–28 CONVERT_* · 29–31 CAPTURE_MULT_*.
상세 패널의 "지금 / 구매 후" 값(01b 5.1)은 `techStatValues(mask)` 와 `techStatValues(mask | 1<<i)` 를 비교하면 된다.

### 19.4 의미 변경 (규칙)

| 항목 | v4.2 | v4.3 |
|---|---|---|
| 군사 전투 보너스 | `MIL_COMBAT` 공·방 동시 ×1.025/1.05/1.075 | MIL-2A 공격 태세만 +3%, MIL-3B 방어 태세만 +4%, 병종 노드는 그 병종 깃발만 |
| 물 위 노출 소모 | 기동 T2+ ×0.5 | 감소 없음 (항상 ×1.0) |
| 물 대 물 교전 | 기동 단계별 ×1.0~1.1 | 항상 ×1.0 |
| 전 병종 편성 효율 | 기동 단계별 ÷1.08~1.22 | 없음 — 기병만 CAV-2A |
| 슬롯 보너스 | 최대 +2 | 최대 +1 (MOB-3A) |
| 테크 가격 | 450/1100/2600, +25%/구매 | 160/360/700, +6%/구매 |
| 유지비·보급선 | 전역 상수 | 플레이어별 스탯(ECO-2B·SPE-2A·CAV-3·TER-3A) |

### 19.5 서버 코드

`shared/src/constants.ts`(노드 표·스탯), **신규 `shared/src/tech.ts`**(`techStatValues`, `techNodeCost`, `techPrereqMet`, `techOwned`, `techMaskWith`, `techCount`, `techCombatPm`, `techSpeedPm`, `techShallowPm`, `techUpkeepWeight`, `techConvertPm`, `techCaptureMultPm` — 클라이언트도 import 가능), `shared/src/protocol.ts`, `server/src/game/{state,commands,economy,rules,combat,movement,flagops,tick,snapshot,bot}.ts`, `server/src/net/validate.ts`. 플레이어 상태 `techMask`·`techPurchased`·`statPm`(구매 시 갱신). 정수 연산만, 결정론 유지(봇 결정론 테스트·자가대전 매 tick 회계 통과).

### 19.6 클라이언트 (빌드 유지용 최소 수정 — 프론트가 다시 만들 것)

`npm run typecheck`·클라이언트 테스트를 통과시키려고 다음만 고쳤다: `ui/techInfo.ts`(4축 문구 삭제 → `techStatsOf`/`techCost(tier, techCount)`/`goldPerSecond(goldWeight, techMask, …)`/`techNodes`), `ui/panels.tsx` 테크 패널(갈래별 노드 버튼 목록 — **임시**, 01b 5장 격자·아이콘·상세 패널 아님), `state/store.ts buyTech(nodeId)`, `state/gameModel.ts`(`techMask`·`tech_purchased`·상한/슬롯 식), `state/feed.ts`(노드 이름), `input/controller.ts`·`input/route.ts`·`ui/terrainInfo.ts`·`ui/GameScreen.tsx`(구 "기동 단계" 인자 → 얕은 물 이동배율 ‰, 편성비 스탯), `ui/text.ts`(새 거절 문구 2개), `scripts/qa-e2e-full.ts`·`scripts/qa-recon-full.ts`, 테스트 5개(`gameModel`·`panels`·`hoverUpkeep`·`issueFlow`·`options` — 리터럴 `tech` → `techMask/techCount`, 테크 기대값을 v4.3 식으로). **`moveField`·`terrainInfo` 의 넷째 인자는 이제 "얕은 물 이동배율 ‰"(무테크 5000)** 이다.

## 20. 깃발 접촉 8방향 (프론트 영향 — 2026-10-11, 사용자 결정)

**메시지·필드·상수 값 변경 없음. 규칙(판정 범위)만 바뀐다.**

| 판정 | v4.2 / v4.3 이전 | 지금 |
|---|---|---|
| 깃발 대 깃발 전투 개시·편 묶기 (`combat_started`, `inCombat`) | 같은 칸 + 상하좌우 이웃 | 같은 칸 + **8방향(대각선 포함)** |
| ZOC (`flag_blocked`, `blocked` 비트) — 다음 칸과 현재 칸이 모두 적대 방어 태세 깃발과 접촉 | 맨해튼 ≤ 1 | **체비셰프 ≤ 1** |
| 진척도 유지 (적 깃발이 붙어 있으면 `progressPct` 감소 정지) | 맨해튼 ≤ 1 | **체비셰프 ≤ 1** |
| 귀환 깃발 붙잡힘 → 자동 이탈 대기 (`flag_disengage_started{auto:true}`) | 전투 판정 따름 | 전투 판정 따름 (= 8방향) |
| 땅 점령 `marchFront`(정지 점령·앵커 점령·재점화)·방어 관할 원·이동 경로·발령 사거리 | 4방향/맨해튼 | **변경 없음** (4방향/맨해튼) |

- 서버 구현: `server/src/topology/topology.ts`(`contactNeighbors`·`touching` 인터페이스), `square.ts`(체비셰프 1), `combat.ts`(4a 후보), `movement.ts`(`zocBy`), `gauge.ts`(`holdProgress`), `bot.ts`(전투 판단·요격·차단). 육각 토폴로지로 바꾸면 `contactNeighbors` = 일반 이웃.
- 클라이언트가 전투·ZOC 를 미리 그리거나 예측한다면 같은 판정(사각 = `|Δrow| ≤ 1 ∧ |Δcol| ≤ 1`)으로 바꿔야 한다. 현재 클라이언트 코드에는 이 판정이 없어 수정하지 않았다(전투·차단 상태는 서버 `inCombat`·`blocked` 비트를 그대로 그린다). 교전 연결선·검/방패 아이콘(같은 날 사용자 결정)은 프론트 작업.
- 대표 전투 표(4.15)·`duels.ts` 수치는 불변(1:1 교전의 손실식은 그대로, 붙는 범위만 넓어짐).

## 21. v4.4 기지 방어 · 우클릭 이동 · 멸망·합병 · 기지 생산력 · 지명 (프론트 영향 — 2026-10-14, 사용자 결정)

근거: `_workspace/00_input/design-decisions.md` 2026-10-14 항목. **메시지·필드는 추가만**(제거·이름 변경 없음). **규칙 의미가 바뀐 곳**: ① 탈락 조건(타일 0 → **기지 0**) + 합병 ② 내 기지 칸으로의 재지정 = 그 기지 위에서 방어(지금까지 UI 는 "내 기지 클릭 = 회수"였다 — A-61 UI 매핑 대체) ③ 재지정 태세가 쿨타임·전투 때문에 미뤄질 수 있다(`pendingPosture`).
**프론트 재작업 필요**: 내 기지 클릭 동작, 대기 태세 표시, 멸망 시 대량 칸 이전, 생산력 바·생산 내역 hover, 지명 표시. 아래 21.1~21.5 가 전부다.

### 21.1 기지 방어 — 깃발이 내 기지 칸 위에 선다

- 깃발은 **내 기지(수도 포함) 칸으로 발령·재지정**할 수 있고, 도착하면 그 칸 위에서 `ENGAGED`(방어 태세)로 선다. 서버는 원래 막지 않았다(막혀 있던 것은 UI 매핑 "내 기지 클릭 = 회수" 하나) — 발령 앵커 검증·도착 판정(`defendArrived`: 앵커 칸 도달)·경로(거리장)·settle 모두 기지 칸을 일반 칸으로 다룬다. 발령 앵커가 내 기지면 출발지도 그 기지(앵커 최근접 내 기지)라 **발령 직후 4단계에서 바로 그 칸에 선다**.
- **방어 태세 깃발이 내 기지 칸 위에 있으면 실효 전투값의 지형 항 = `COMBAT_BASE_DEF_PERMILLE` 1500**(지형 보정을 **대체** — 곱하지 않는다. 기지가 언덕이어도 1300 × 1500 이 아니라 1500). 공격 태세·남의 기지 칸(서 있는 동안 함락된 경우 포함)은 기존 지형 보정.
  `v(방어) = floor(UNIT_DEF[unit] × (내 기지 칸 ? 1500 : COMBAT_TERRAIN_DEF_POSTURE[지형]) / 1000)` → 이후 테크·상륙·이탈 배율은 기존과 같다. 예: 창 방어 1300 → **1950**, 검 1500, 기병 1050.
- **기지 체력 전투와의 관계 [A-88]**: 기지 칸 위에 **공격자와 적대(동맹 아님)인 전투 가능 깃발**(패주·breakaway 아님, 병력 > 0)이 서 있으면 공격 깃발은 **기지 체력을 깎지 못한다 — 먼저 그 깃발을 이겨야 한다**. 기지를 미는 공격 깃발은 기지 칸에 4방향으로 붙어 있으므로 기지 위 깃발과 항상 접촉(8방향 ⊃ 4방향) → 4a 에서 이미 전투 중이라 밀지 않는다(현 전투 모델의 귀결). 서버는 6단계에 같은 조건을 명시 검사로도 둔다(`gauge.ts baseOccupiedByHostile`). 수비 깃발이 패주하면 그 다음 tick 부터 체력 피해가 다시 들어간다. 기지 주인의 동맹 깃발이 기지 위에 서 있어도 같다.
- 새 메시지·필드 없음. 부대 정보의 공격력·방어력("지형 보정 제외" — 사용자 결정)을 계산한다면 기지 ×1.5 도 지형 보정의 일부로 보고 빼면 된다.

### 21.2 우클릭 = 항상 이동 — 태세는 도착지로

**프론트 호출법 (사용자 결정 2026-10-14 UI)**

| 조작 | 보낼 명령 |
|---|---|
| 내 부대 선택 + **우클릭(아무 칸)** | `{ "type":"cmd_flag_retarget", "clientSeq":n, "flagId":f, "anchorTileId":t }` — **내 기지 칸도 이것**(회수 아님) |
| 선택 부대 위 **귀환 버튼** | `{ "type":"cmd_flag_recall", "clientSeq":n, "flagId":f }` (자동 귀환지) — 특정 기지로 보내려면 `baseTileId` (v4.2 그대로) |
| 선택 부대 위 **태세 버튼** | `{ "type":"cmd_set_posture", "clientSeq":n, "flagId":f, "posture":p }` (v4.1 그대로) |

- 재지정 태세 = **도착지 소유자로 결정**: 내 땅(내 기지 포함) = `DEFEND`, 적·중립 = `ATTACK`. 물(`WATER`)·동맹 땅(`ALLIED`)·사거리 밖(`OUT_OF_RANGE`)·경직(`LOCKED`)·귀환 중(`RETURNING`) 등 거절은 기존과 같다(§4 표).
- 지금 태세를 바꿀 수 있으면(쿨타임 경과 ∧ 비전투) 같은 tick 에 바꾸고 `flag_posture_changed{auto:true}`. **바꿀 수 없으면**(태세 쿨타임 중이거나 **전투 중** — 전투 중 재지정은 이탈 대기로 빠져나가는 중이라, 그 사이 태세를 바꾸면 방어↔방어가 되어 이탈 비용 없이 싸움이 끊긴다) **`pendingPosture` 에 도착지 태세를 두고**, 조건이 풀리는 첫 tick 4단계 첫머리에서 서버가 자동 적용 → `flag_posture_changed{auto:true}` [A-90]. 이미 멈춰 있던(ENGAGED·IDLE) 깃발은 그 tick MARCHING 으로 되돌려 새 태세로 다시 도착 판정한다(`flag_engaged`/`flag_idle` 이 다시 올 수 있다).
- `cmd_ack.posture` 는 **처리 직후의 현재 태세**(대기 중이면 아직 이전 태세). 대기 태세는 `snapshot_full.flags[].pendingPosture`(0|1|null) / 델타 `flagFlags` 비트 **`POSTURE_PENDING 128`**(대기 태세 = 현재 태세의 반대 — 같으면 대기가 없다).
- `pendingPosture` 를 지우는 것: 적용됨 / 수동 `cmd_set_posture` 수락 / 회수·IDLE 자동 귀환·패주(귀환 시작) / 현재와 같은 태세가 되는 재지정.

```json
{ "type":"cmd_flag_retarget","clientSeq":7,"flagId":3,"anchorTileId":2316 }
{ "type":"cmd_ack","clientSeq":7,"accepted":true,"flagId":3,"posture":0 }
{ "type":"snapshot_delta","tick":131,"flagFlags":[[3,0,128,140]],"…":"…" }
{ "type":"flag_posture_changed","tick":140,"flagId":3,"posture":1,"cooldownUntilTick":165,"auto":true,"targetOwnerId":254 }
```
(2316 = 내 기지, 태세 쿨타임이 140 까지 → 그동안 ATTACK + 대기 비트, 140 에 DEFEND 로 자동 전환)

### 21.3 멸망·합병 — 기지를 모두 잃으면 즉시 멸망

- **탈락 조건 변경**: 기지(수도 포함)를 **모두** 잃은 tick 의 12단계에서 즉시 멸망(구 조건 "타일 0" 은 여기에 포함된다 — 타일 0 ⇒ 기지 0). 수도를 잃어도 다른 기지가 하나라도 있으면 산다.
- **합병**: 멸망한 플레이어의 남은 칸 **전부** → 멸망시킨 플레이어(= 그의 **마지막 기지를 점령한** 플레이어). 깃발은 전부 소멸(`flag_ended{reason:"eliminated"}`, 환불 없음), 동맹·제안 즉시 해제(기존). 풀 병력·골드·테크는 넘어가지 않는다(소멸 — 회계는 기존 `eliminated` 항목).
- **같은 tick 연쇄 [A-91]**: playerId ASC 로 처리. 합병 받을 플레이어가 이미(같은 tick 앞 순번에서) 멸망했으면 그를 멸망시킨 플레이어로 거슬러 올라간다. 생존자를 못 찾으면 남은 칸은 중립(`byPlayerId:null`, `annexedTiles:0`). 마지막 기지를 잃은 기록이 없는 경우(이론상)는 마지막으로 칸을 가져간 플레이어.
- **이벤트·스냅숏 정합**: 한 tick 안에서 `base_captured`(마지막 기지, 7단계) → `flag_ended`×n → `ally_broken`… → **`player_eliminated{playerId, byPlayerId, annexedTiles}`**(12단계) → **같은 tick `snapshot_delta.tileChanges` 에 넘어간 칸 전부 `[tileId, byPlayerId]`**(대량 — 큰 나라는 수백~천여 쌍. full 강제 송신 없음) → 이후 `playerDeltas`(5 tick 주기)·`production`. 늦게 붙는 클라이언트는 `snapshot_full.owners` 에 이미 반영돼 있다. `room_state` 의 `ELIMINATED_SPECTATING` 전환은 기존과 같다.
- `last_standing`(생존자 1) · `threshold`(합병으로 넘는 경우 포함, 같은 tick 13단계 판정) · `timeout` 판정은 기존과 같다.

```json
{ "type":"base_captured","tick":4012,"tileId":2412,"fromPlayerId":4,"toPlayerId":2,"newHpPct":50,"newProdPm":500 }
{ "type":"flag_ended","tick":4012,"flagId":88,"reason":"eliminated","refunded":0 }
{ "type":"player_eliminated","tick":4012,"playerId":4,"byPlayerId":2,"annexedTiles":311 }
{ "type":"snapshot_delta","tick":4012,"tileChanges":[[2412,2],[2301,2],[2302,2]],"…":"(311 + 1 쌍)" }
```

### 21.4 기지 생산력 · 생산 지역

**생산력** (기지마다 정수 ‰, 0..1000):
- 시작 1000(중립 기지 포함). **점령될 때마다 `floor(현재 ‰ × 500 / 1000)`**(중립 → 플레이어 포함): 1000 → 500 → 250.
- **회복 [A-85]**: 매 tick 선형, **분당 +`BASE_PROD_RECOVER_PER_MIN_PERMILLE` 167‰**, 상한 1000 — 50% → 100% 약 3.0분, 25% → 100% 약 4.5분. 소유·피해와 무관하게 항상 회복(중립 기지도). 서버 내부는 `‰ × 300` 정수로 누적하고 표시·계산은 `floor(÷ 300)`.
- 송신: `snapshot_full.bases[].prodPm`, 델타 `baseProd: [tileId, prodPm][]`(5 tick 마다 바뀐 기지만 — 회복 중이면 거의 매번), `base_captured.newProdPm`. **바 그리기**: `prodPm / 1000`. 사이 값을 보간하려면 `+167/300 ‰ / tick`.

**생산 지역 [A-86]**: 플레이어의 각 칸은 **내 땅만 밟는 4방향 그래프 거리**로 가장 가까운 내 기지(수도 포함)에 속한다. 동률은 기지 tileId 가 작은 쪽. 내 기지와 내 땅으로 이어지지 않은 칸(고립지·월경지) = **"기타" 지역**(생산력 1000 고정). 기지 칸 자체는 항상 자기 지역이다. 소유권이 바뀐 뒤 처음 정산할 때만 다시 계산(전 맵 다중 출발 BFS 1회 — 타일 수 비례).

**생산 적용 [A-87]** — "지역 r 의 생산 = 기존 공식의 그 지역 몫 × prodPm_r / 1000" (정수·결정론):
```
R        = 기존 병력 재생 milli/tick (0.8 + 0.5·√tiles, 로지스틱, 테크 — 생산력 무관. 병력 상한도 그대로 전체 칸 수)
R'       = floor(R × Σ_r(tiles_r × pm_r) / (tiles × 1000))      // 실제 재생
troops_r = R' 를 가중치 tiles_r × pm_r 로 분배
effGW_r  = floor(goldWeight_r × pm_r / 1000)                     // 지역 골드 가중치(지형 가중 합) × 생산력
gross    = floor(Σ effGW_r × GOLD_RATE_PERMILLE × goldPm / 1e9)   // 기존 식에 effGW 합을 넣은 것
gross_r  = gross 를 effGW_r 로 분배
net      = gross − floor(gross × upkeepPm / 1000)                  // 유지비는 총액에 한 번 (기존과 같다)
net_r    = net 를 gross_r 로 분배
분배     = 각 몫 floor(total × w / Σw), 잔여는 가중치가 가장 큰 지역(동률 = 앞)에 → 지역 합 = 총합 (정확히)
```
생산력이 전부 1000 이면 기존 값과 정확히 같다. 플레이어 `goldWeight`(델타·full)는 **생산력 반영 전** 원값 그대로 — §5 의 "그로스 = goldWeight × …" 클라이언트 계산은 이제 생산력이 깎인 기지가 있으면 과대 추정이므로 **수입 표시는 `production` 합을 쓸 것**.

**`production` 형식** — `snapshot_full.production` = id ASC 전원(탈락자 `regions: []`) / 델타 `production` = 5 tick 마다 바뀐 플레이어만(그 플레이어 내역 통째 교체):
```json
{ "playerId": 2, "regions": [
  { "baseTileId": 1290, "tiles": 214, "prodPm": 1000, "troopsPerSecMilli": 4120, "goldGrossPerSecMilli": 2950, "goldNetPerSecMilli": 2270 },
  { "baseTileId": 2412, "tiles": 88,  "prodPm": 500,  "troopsPerSecMilli": 845,  "goldGrossPerSecMilli": 610,  "goldNetPerSecMilli": 470 },
  { "baseTileId": null, "tiles": 6,   "prodPm": 1000, "troopsPerSecMilli": 115,  "goldGrossPerSecMilli": 80,   "goldNetPerSecMilli": 61 } ] }
```
- `regions` 순서 = 내 기지 tileId ASC, "기타"(`baseTileId: null`)는 칸이 있을 때만 맨 끝. 단위 = **milli / 초**(서버 milli/tick × 1000 / `TICK_MS`) — 병력/초 = `troopsPerSecMilli / 1000`, 순골드/초 = `goldNetPerSecMilli / 1000`.
- 값 = **그 tick 2단계가 실제로 적용한 정산**(병력 상한에서 잘리는 양은 반영 전). hover "병력·골드 출처(기지별 + 기타)" 는 이 표를 그대로 쓰면 된다. 유지비 줄 = `Σ gross − Σ net`.

### 21.5 지명

- `map_init.baseNames: string[]` — `bases`(tileId ASC, 수도 포함 2N개)와 같은 순서·같은 길이. 매치 안 고유.
- 이름 풀: `server/src/map/placeNames.ts` 120개(한국 고유어풍 80 + 판타지풍 40, 한글 2~3음절, 중복 없음). 매치 시작 시 **룸 시드**(무작위 맵 = 맵 시드, 프리셋 맵 = 룸이 뽑은 시드 — 봇 성향 시드와 같은 값)로 결정론 셔플 후 기지 순서대로 배정 [A-92]. 같은 시드면 같은 이름.
- 수도 지명 = `baseNames[bases.indexOf(spawns[i].homeTileId)]`.

### 21.6 상수 (`match_config.constants` 에 자동 포함)

| 상수 | 값 | |
|---|---|---|
| `COMBAT_BASE_DEF_PERMILLE` | 1500 | 사용자 확정 |
| `BASE_PROD_MAX_PERMILLE` | 1000 | 사용자 확정 (시작값·상한) |
| `BASE_PROD_CAPTURE_PERMILLE` | 500 | 사용자 확정 (점령 시 ×0.5) |
| `BASE_PROD_RECOVER_PER_MIN_PERMILLE` | 167 | **[A-85] 에이전트 선택** |
| `PRODUCTION_DELTA_INTERVAL` | 5 | 델타 `production` 주기 |
| `FLAG_BIT.POSTURE_PENDING` | 128 | 델타 비트 |

### 21.7 서버 코드

`shared/src/constants.ts`·`protocol.ts`(타입 `ProductionRegion`·`PlayerProduction`. 새 필드는 TS 상 optional — 구 클라이언트 리터럴 호환, 서버는 항상 싣는다), `server/src/game/production.ts`(신규 — 생산 지역·분배), `state.ts`(`BaseState.prodScaled`, `PlayerState.lastBaseLostTo/conqueredBy`, `Flag.pendingPosture`, `GameState.baseNames/regions/yields`), `tick.ts`(2단계 생산·8단계 생산력 회복·12단계 멸망·합병), `gauge.ts`(기지 점령 생산력 ×0.5, `baseOccupiedByHostile`), `combat.ts`(`flagValue` 기지 ×1.5), `flagops.ts`(재지정 태세·`applyPendingPosture`), `movement.ts`(4단계 첫머리 대기 태세), `snapshot.ts`(직렬화), `server/src/map/placeNames.ts`(신규), `bot.ts`(기지 수비 — §10-111). 클라이언트는 `client/src/state/gameModel.ts` 에 `pendingPosture` 비트 해석 2줄만 넣었다(재구성 모델 테스트 유지용 — 나머지 UI 는 프론트 몫).

## 22. v4.5 해상 이동 폐지 · 중립 비용 고정 · 손실률 · 기지 피해 상한 · 기지 생산 정정 · 기지 ×1.5 · 지명 양식 · 기동 노드 교체 · 방어 경로 · 중립 노출 소모 (프론트 영향 — 2026-10-15, 사용자 결정)

근거: `_workspace/00_input/design-decisions.md` 2026-10-15 항목, `_workspace/01c_tech-water-replacement-proposal.md`(MOB-2B ①, MOB-3B ② 승인).
**형식 변경(깨지는 것)**: ① `production[].regions` → **`production[].rows`**(행 의미도 바뀜, 22.5) ② `TECH_STAT.SHALLOW_MOVE`(11)·`LANDING_COMBAT`(13) 이름이 **`DISENGAGE_TICKS`·`RETURN_SPEED`** 로 바뀜(같은 번호 재사용, 22.7) ③ `NEUTRAL_SQRT_COEF_PERMILLE` 상수 삭제.
**추가만**: 델타 `combatLoss`(22.3), `flag_idle.reason = "unreachable"` 실제 송신 시작(22.12), 상수 `FLAG_EXPOSED_ATTRITION_NEUTRAL_PCM`·`FLAG_EXPOSED_MIN_MILLI`·`FLAG_EXPOSED_NEUTRAL_MIN_MILLI`(22.13), 상수 `COMBAT_BASE_ATK_PERMILLE`·`BASE_HP_DMG_CAP_MILLI_PER_TICK`·`BASE_PROD_TILES`·`CAPITAL_PROD_TILES`·`PROD_REF_TILES`·`PACING_P_REF_LAND_PER_PLAYER`, `TECH_NODES[].icon`(선택).
**프론트 재작업 필요**: 물 이동 경로 표시(얕은 물 통과 경로·이동배율 표시 제거), 생산 hover(기지 행 + 영토 행), 깃발 전투 −n/틱 표시, 테크 17·19 이름·아이콘·설명, 이탈 대기 호(소유자 스탯 기준 길이), 지명 글꼴 폭(서양식 음차는 최대 7음절), 방어 깃발 경로 미리보기(적 땅 회피 — 22.12), 노출 소모 표시가 있다면 중립 절반(22.13).

### 22.1 해상 이동 폐지 · 물 ≈ 10%

- **물(DEEP·SHALLOW)은 전부 통행 불가**. 이동 그래프(`TerrainGraph.neighbors`)에 물 칸이 없다 — 경로·앵커·도착지·귀환지 어디에도 물이 오지 않는다. 물 앵커 발령·재지정은 기존처럼 `WATER` 거절.
- 지형 enum 은 그대로(0 DEEP / 6 SHALLOW). 기본 생성기는 **테두리 = DEEP, 안쪽 호수 = SHALLOW**(색 구분용). 커스텀 `waterMode`·`shallowPermille` 설정은 그대로 받지만 둘 다 통행 불가.
- 상륙 규칙 삭제: 물 위 깃발 전투 배율(구 `LANDING_COMBAT`), 봇 상륙 후보 탐색(`scanLanding`), 플레이어별 물 이동배율 거리장 캐시(키 `${dest}:${shallowPm}` → **목적지만**)를 지웠다. 노출 소모(남의 땅 위 깃발)는 땅 규칙이라 그대로.
- **생성기 [A-102]**: 반해상도(⌈W/2⌉×⌈H/2⌉) 호수 노이즈 460‰ → CA 3회(물 이웃 ≥ 5) → 2배 확대 → 전해상도 다듬기 2회 → 테두리 = 물 → **최대 4-연결 육지 덩어리만 남김**(섬은 물) → 육지 비율이 **885~915‰** 밖이면 p ± 10‰ 로 다시(최대 12회). 결과 = M 기준 물 평균 9.9%(테두리 5.3% 포함), 호수 7~8개(최대 ~100칸). 육지 연결은 생성 불변식 I1·I4 가 보장(실패 시 시드+1).
- 상수: `TARGET_LAND_RATIO_PERMILLE` 650 → **900**, `LAND_RATIO_MIN/MAX_PERMILLE` 600/700 → **885/915**, `CA_INIT_LAND_P_PERMILLE` 550 → 540, `CA_LAND_P_STEP_PERMILLE` 20 → 10, `CA_MAX_ATTEMPTS` 10 → 12, `CA_SMOOTH_STEPS` 4 → 3.
- **육지가 약 38% 늘었다**(M 6000칸: 육지 ≈3900 → ≈5400, 10인 1인당 390 → 540). 판 길이 추정식(`pacingNote`)의 기준 1인당 육지도 390 → 540 으로 옮겼다 [A-110] — 클라이언트 미리보기(`client/src/ui/pacing.ts`)도 같은 상수 `PACING_P_REF_LAND_PER_PLAYER` 를 쓴다.
- **공식 프리셋 9장 재생성**: `export-map.ts --count 40`(시드 1000~1039) × S/M/L → `eval-maps.cjs`(공정성 점수, 목표 육지 0.90 으로 수정) 상위 3개.

| id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| official-s-01 | 1030 | 2700 | 10.7% | | official-m-01 | 1005 | 5495 | 8.4% | | official-l-01 | 1006 | 6363 | 10.7% |
| official-s-02 | 1025 | 2721 | 10.0% | | official-m-02 | 1003 | 5469 | 8.9% | | official-l-02 | 1024 | 6469 | 9.2% |
| official-s-03 | 1002 | 2733 | 9.6% | | official-m-03 | 1026 | 5451 | 9.2% | | official-l-03 | 1022 | 6350 | 10.9% |

  이름·id 는 그대로(작은/보통/큰 맵 1~3), `origin.generator = "v4.5"`. 테스트 픽스처 `server/test/fixtures/maps/sample-m-01.json` 도 같은 생성기로 다시 뽑았다.

### 22.2 중립 점령비용 고정

`tileCost(중립) = NEUTRAL_BASE(7) × 중립 테크(NEUTRAL_COST) × 지형 × 병종 × 보급선 × (종반 러시)` — **나라 크기 √칸 항 삭제**(구 `7 + 0.75√칸`). 곱하는 순서·floor 위치·최소 4 는 그대로. 봇 점수도 같은 `tileCost` 를 쓴다. 상수 `NEUTRAL_SQRT_COEF_PERMILLE` 삭제.

### 22.3 깃발 전투 손실률 0.9% · 틱당 손실 표시

- `COMBAT_LOSS_BP` 150 → **90**, `COMBAT_LOSS_FLOOR_BP` 75 → **45** [A-105]. 식은 그대로: `L = max(S × 0.9% / n, R × 0.45% / n, 1000 milli)`, 편 손실 = 1/v 비례. 교환비(누가 이기나)는 같고 시간만 ×5/3 (검↔검 평원 1000:1000 양쪽 패주 22.6초 → **37.6초**).
- **틱당 손실은 기존 델타로 정확히 구할 수 없다**: `flagStats` 병력은 정수 floor(±1 오차)이고 같은 tick 의 노출 소모(남의 땅 위 ≥ 1/tick)·이탈 등이 섞인다. 그래서 **추가**:

`snapshot_delta.combatLoss: [flagId, lossMilli][]` — 이번 tick 4b(깃발 대 깃발 전투)에서 잃은 병력(milli), **> 0 인 깃발만, flagId ASC, 매 tick**(빈 배열 가능, 서버는 항상 싣는다). 노출 소모·AP 지출은 포함하지 않는다. 화면 "−n" = `lossMilli / 1000`(소수 1자리 권장 — 1000:1000 검 평원 첫 tick 은 4.5).

```json
{ "type":"snapshot_delta","tick":812,"combatLoss":[[14,4500],[22,4500]],"flagStats":[[14,991,"ENGAGED"],[22,991,"ENGAGED"]],"…":"…" }
```

### 22.4 기지 피해 상한 300 / tick

- 한 tick 에 기지 하나가 잃는 체력 합 ≤ **`BASE_HP_DMG_CAP_MILLI_PER_TICK` = 300 milli** — 깃발 수와 무관. 빈 기지(22500)도 최소 **75 tick = 15초**.
- **분배 [A-104]** (`gauge.ts splitBaseDamage`, 7단계 그 기지의 타격 목록 = flagId ASC): `want_i` = 각 깃발의 원래 피해(기존 식 `min(AP×1000/cost, 최대 진척)`), 총 적용량 `T = min(Σwant, 300, 남은 체력)`. `Σwant ≤ T` 면 그대로, 아니면 `floor(T × want_i / Σwant)` 후 잔여 milli 를 (want DESC, 순서 ASC) 로 1씩. 합 = T (정확히).
- **지출 = 적용된 피해분만**: `ceil(적용 피해 × cost / 1000)` AP. 상한·남은 체력에 잘린 피해에는 병력을 쓰지 않는다(쓰지 못한 예산은 기존처럼 누적 상한까지 남는다). 진척 0 이 된 깃발은 정체(stall) 판정 대상(기존 `updateStall(f, 0)`).
- **함락자**: 체력 ≤ 0 인 tick 에 **적용 피해가 가장 큰 깃발**(동률 = flagId 작은 쪽) — 기존 규칙 그대로. 남은 체력 이상은 깎지 않으므로 함락 tick 의 체력은 정확히 0.
- 이벤트·필드 변경 없음(`baseHp` 델타 1초 주기 그대로 — 1초에 최대 −1500 milli = −6.7%p).

### 22.5 기지 생산 모델 정정 — 생산 지역 폐기

**규칙**: 플레이어 생산 = **영토 생산**(내 땅 전부 — 기지 칸 포함, 생산력 페널티 없음) + **기지 생산**(내 기지 칸마다). 기지 한 칸 = 영토(평원) **`BASE_PROD_TILES` 60칸분**, 수도 칸 = **`CAPITAL_PROD_TILES` 100칸분** — 시작 수도였던 칸이면 지금 누가 갖고 있든 100 [A-107]. 점령 페널티(×0.5, 분당 +167‰ 회복 — 그대로)는 **그 기지 생산에만** 곱한다. §21.4 의 생산 지역(최근접 기지·"기타")·`production.ts` 지역 BFS 는 삭제.

**정수식 [A-103]** (milli / tick, `server/src/game/production.ts`·`economy.ts`):
```
병력  terr   = 800 + floor(500 × isqrt(T × 10⁶) / 1000)                       // 기존 영토 식 0.8 + 0.5√T (T = 내 칸 수)
      REF    = 800 + floor(500 × isqrt(390 × 10⁶) / 1000) = 10674              // PROD_REF_TILES 390 칸의 기본 재생
      base_b = floor(eq_b × pm_b × REF / (390 × 1000))                          // eq = 60 | 100, pm = 생산력 ‰ → 기지 1642, 수도 2736 (pm 1000)
      R      = round((terr + Σ base_b) × 재생테크‰ × (cap − troops) / (1000 × cap))   // 로지스틱·테크는 합에 한 번 (BigInt — 2^53 초과 방지). cap 은 그대로 (100 + 12·T) × 상한테크
      행     = R 을 가중치 [base_b…, terr] 로 분배
골드  GW_b   = floor(eq_b × 1000 × pm_b / 1000)                                 // 평원 가중치 1000 × 칸 수 × 생산력
      GW_terr = goldWeight (지형 가중 합, 기존)
      gross  = floor(ΣGW × 2080 × 골드테크‰ / 1e9)  → 행 = GW 비례 분배
      net    = gross − floor(gross × 유지비‰ / 1000) → 행 = gross 행 비례 분배 (유지비는 총액에 한 번 — 기존과 같다)
분배     = 각 몫 floor, 잔여는 가중치 최대(동률 = 앞) 행에 → 행 합 = 총합 (정확히)
```
- 칸당 기준 = "기준 영토 390칸(`LAND_TILES_PER_PLAYER`)일 때의 평균 재생" — 내 영토 크기와 무관한 **선형** 값이라 기지 하나의 가치가 판 내내 같다(내 영토 평균을 쓰면 시작 9칸에서 수도가 영토의 11배가 되고, 한계 재생을 쓰면 큰 나라에서 거의 0이 된다).
- 크기 감(무테크, 생산력 100%, 로지스틱 전): 수도 13.7 병력/초 · 1.04 골드/초, 기지 8.2 병력/초 · 0.62 골드/초. 영토 400칸이면 10.8/틱 = 54 병력/초 → 수도 + 기지 1개가 +40%.
- 플레이어 `goldWeight`(델타·full)는 **영토만**의 원값 — 수입 표시는 `production` 합을 쓸 것(§21.4 와 같은 안내).

**`production` 형식 (변경)** — `snapshot_full.production` = id ASC 전원(탈락자 `rows: []`) / 델타 `production` = 5 tick 마다 바뀐 플레이어만(통째 교체). 타입 `ProductionRow` / `PlayerProduction` (`shared/src/protocol.ts`):
```json
{ "playerId": 2, "rows": [
  { "kind":"base", "baseTileId":1290, "tiles":100, "prodPm":1000, "troopsPerSecMilli":11850, "goldGrossPerSecMilli":1040, "goldNetPerSecMilli":780 },
  { "kind":"base", "baseTileId":2412, "tiles":60,  "prodPm":500,  "troopsPerSecMilli":3550,  "goldGrossPerSecMilli":310,  "goldNetPerSecMilli":232 },
  { "kind":"territory", "baseTileId":null, "tiles":412, "prodPm":1000, "troopsPerSecMilli":47100, "goldGrossPerSecMilli":4120, "goldNetPerSecMilli":3090 } ] }
```
- 행 순서 = 기지 행(내 기지 tileId ASC — 수도 포함) → **영토 행 1개(항상 맨 끝, 칸이 있으면)**. 기지 행 `tiles` = 환산 칸 수(60/100, 생산력 반영 전), 영토 행 `tiles` = 실제 소유 칸 수, `prodPm` = 1000 고정.
- 값 = 그 tick 2단계가 실제로 적용한 정산(병력 상한에서 잘리는 양은 반영 전). 단위 milli/초. hover = 기지 행(지명 + 생산력 바) + 영토 합산 행. 유지비 줄 = `Σ gross − Σ net`.
- **클라이언트 영향**: 지금 `client/src/ui/production.ts` 는 `baseTileId === null` 행을 "기타" 로 그린다 → **"영토" 로 바꿔야 한다**(빌드 유지용으로 타입·필드명만 `rows` 로 고쳐 두었다).

### 22.6 기지 ×1.5 — 태세 무관 [A-106]

깃발이 **자기(소유자) 기지 칸**(수도 포함) 위에 있으면:
- **방어 태세**: `v = floor(UNIT_DEF × 1500 / 1000)` — 지형 보정을 **대체**(v4.4 그대로, 기지가 언덕이어도 1500).
- **공격 태세**: `v = floor(UNIT_ATK × COMBAT_BASE_ATK_PERMILLE(1500) / 1000)` — 공격 태세엔 원래 지형 항이 없으므로 공격값에 곱한다.
- 그 뒤 테크(`techCombatPm`)·이탈 대기 ×0.5 는 기존과 같다. 남의 기지(동맹 기지 포함)·기지 밖은 해당 없음. 예: 창 1305/1950, 검 1500/1500, 기병 1770/1050 (공격/방어).
- 기지 체력 전투 규칙(기지 위 적대 깃발이 있으면 체력 피해 0 — A-88)은 그대로.

### 22.7 테크 MOB-2B · MOB-3B 교체 (01c 승인: 2B ①, 3B ②)

| id | code | 이름 | 스탯 칸 | op | 값 (무테크 → 보유) | 설명 | 아이콘 콘셉트 |
|---|---|---|---|---|---|---|---|
| 17 | MOB-2B | **철수 훈련** | 11 `DISENGAGE_TICKS` | set | 15 → **10** tick (3.0 → 2.0초) | 이탈 대기 3.0초 → 2.0초 | 방패 뒤로 꺾여 돌아가는 화살표 |
| 19 | MOB-3B | **급속 귀환** | 13 `RETURN_SPEED` | set | 1500 → **2200** ‰ | 귀환 속도 ×1.5 → ×2.2 (회수·자동 귀환·패주) | 기지 지붕 + 안으로 들어가는 화살표 |

- 노드 id·부모(17 ← 15, 19 ← 17)·티어·`techMask` 비트 그대로. 스탯 칸 11·13 재사용(01c A-95 ①) — `TECH_STAT_COUNT` 32 그대로. `TECH_STAT.SHALLOW_MOVE` / `LANDING_COMBAT` 이름은 사라졌다. `TECH_NODES[].icon`(선택 필드)에 콘셉트 문구.
- **이탈 대기**: `disengageUntilTick = 명령 수락 tick + 소유자 스탯 DISENGAGE_TICKS`(전투 중 회수·재지정, 그리고 전투에 붙잡힌 귀환 깃발의 자동 이탈 대기). `flag_disengage_started.untilTick` 이 이미 실제 값을 싣는다 → 클라이언트 이탈 호는 상수 `DISENGAGE_TICKS` 대신 `untilTick − tick`(또는 소유자 스탯)으로 길이를 정할 것.
- **귀환 속도**: RETURNING(회수·IDLE 자동 귀환·패주) 이동 = `speedMilli × 소유자 스탯 RETURN_SPEED / 1000` (매 tick 그 시점 스탯). 행군·재지정 이동엔 적용 안 함(v4.2 A-63 그대로).
- `shared/tech.ts`: `techDisengageTicks(stat)`, `techReturnSpeedPm(stat)` 추가. `techShallowPm` 은 **deprecated**(항상 5000 — 구 클라이언트 호출 호환용).
- 봇 우선순위(01c A-96 ①, 3B 는 ② 채택에 맞춰 조정): 수비형 `… MIL-3B, MOB-1, MOB-2B, TER-1, TER-2B, MOB-2A, MOB-3A, SPE-2B`(TER-3B 제거), 기동형 `MOB-1, CAV-1, MOB-2A, CAV-2B, ECO-1, CAV-2A, MOB-3A, MOB-2B, MIL-1, MIL-2A, CAV-3, MIL-3A, MOB-3B, ECO-2B, TER-1, SWO-1` — MOB-3B 는 제안의 11번째(①질서 있는 회수 기준) 대신 **13번째**(②귀환 속도는 골드당 효과가 약하다 — 01c 1.2). 자가대전 구매율: MOB-2B 8% → 48%, MOB-3B 0% → 10%.

### 22.8 자가대전 비교 (M 10인 NORMAL, 시드 1000~1009, `npm run selfplay -w @civwar/server -- 10 1000 M 10`)

기준선 = 39757b8 서버(= 24d3ad5, 서버 코드 동일)를 같은 기계에서 다시 돌렸다(중립 잔여 지표를 새로 넣어서 — 기준선 숫자는 의뢰서 값과 같다). 기여 분리 = **v4.5 최종(22.12 방어 경로·22.13 중립 노출 포함)에서 하나만 되돌린** 판.

| | 기준선 (39757b8) | **v4.5 최종** | 중립 √항 복원 | 손실률 1.5% 복원 | 물 35% 복원 (통행 불가 호수) |
|---|---|---|---|---|---|
| 종료 (분) · 사유 | 32.0 · timeout 10/10 | **32.0 · timeout 10/10** | 32.0 · timeout 10/10 | 32.0 · timeout 10/10 | 32.0 · timeout 10/10 (중간 측정에선 threshold 4판, 평균 30.9분) |
| 1위 점유 @10 / 20 / 30분 | 9.8 / 17.2 / **22.9%** | 14.5 / 23.0 / **28.1%** | 9.7 / 16.7 / 21.5% | 14.2 / 21.5 / 26.2% | 16.1 / 27.8 / 35.7% |
| 남은 중립 육지 @10 / 20 / 끝 | 37.1 / 20.3 / **11.7%** | 30.5 / 12.9 / **3.8%** | 40.1 / 24.4 / 15.0% | 30.4 / 11.6 / 2.4% | 25.8 / 10.3 / 2.6% |
| 탈락 / 판 | 1.2 | **0.5** | 0.3 | 0.9 | 1.2 |
| 기지 함락 / 판 (중립 포함 · 플레이어 기지 · 수도) | 20.5 · 12.6 · 4.2 | **19.9 · 9.9 · 4.3** | 18.2 · 9.0 · 3.9 | 20.4 · 10.4 · 4.2 | 20.8 · 10.8 · 5.3 |
| 병력 소멸 (노출 / 전투 / 지출) | 2.9 / 32.6 / 64.5% | 0.7 / 29.9 / 69.4% | 0.7 / 26.5 / 72.9% | 0.6 / 33.4 / 66.0% | 0.5 / 37.8 / 61.7% |
| tick ms 평균 / 최대 | 0.44 / ~14 | 0.83 / 26 | | | |

중간 측정(22.12·22.13 넣기 전, 같은 시드): 1위 @30 28.3%, 끝 중립 4.3%, 탈락 0.0, 기지 함락 19.6 · 9.6 · 3.8 — 방어 경로 규칙이 들어가며 탈락이 0.0 → 0.5 로 돌아왔다(수비 깃발이 적 땅을 가로질러 소모되지 않는다).

읽는 법:
- **물 축소가 판을 가장 길게 만든다.** 같은 규칙에서 물만 35% 로 두면(1인당 육지 390) 1위가 30분에 35.7%, 중간 측정에선 10판 중 4판이 threshold 로 끝났다(threshold 문턱 근처라 판마다 흔들린다). 물 10% 로는 1인당 육지 540 이라 1위 28% 로 전부 timeout.
- **중립 비용 고정이 확장을 크게 당긴다.** √항을 복원하면 1위 −6.6%p, 끝 중립 잔여 +11.2%p. "중립 땅이 끝까지 남는" 현상은 v4.5 에서 사실상 사라졌다(끝 3.8%).
- **손실률 0.9% 는 탈락을 줄이고**(1.5% 복원 0.9 → 0.5) 전투 소멸 비중을 33 → 30% 로 낮춘다. 1위 점유는 +1.9%p(병력이 확장으로 더 간다).
- **노출 소모 비중이 2.9% → 0.7%**: 방어 깃발이 적 땅을 지나지 않고(22.12), 중립 위 소모가 절반(22.13)이라.
- **세션 길이 목표(25~32분, 표준 30분)와의 차이는 그대로** — 기준선도 v4.5 도 전부 32분 timeout, 1위가 30분에 28% 로 threshold(45~60%)에 못 미친다. 레버 후보(디자이너 판단 필요): 격자 축소(M 100×60 → 약 86×52 면 1인당 육지 390 복원), threshold 곡선, 종반 러시.
- 테크 구매율(최종): MOB-2B 철수 훈련 43%, MOB-3B 급속 귀환 8% (기준선 조선술 8%·상륙정 0%).

### 22.9 [A] — GDD·사용자 결정에 없어 에이전트가 정한 것

| ID | 항목 | 결정 | 근거 |
|---|---|---|---|
| A-102 | 물 ≈ 10% 생성기 | 반해상도 호수 CA + 다듬기, 물 창 8.5~11.5%(테두리 포함), 섬은 물로 메워 육지 한 덩어리, 테두리 DEEP·안쪽 호수 SHALLOW(색 구분만) | 전해상도 CA 는 10% 에서 작은 웅덩이 30개가 생긴다. 반해상도면 큰 호수 7~8개 — 지형 장애물 역할. 섬(통행 불가라 도달 불가)을 남기면 "육지 연결" 보장이 깨진다 |
| A-103 | 기지 병력 생산 식 | 칸당 = 기준 390칸 평균 재생(10674/390 milli), 기지 = 60·수도 100칸 × 생산력, 선형 별도 항. 로지스틱(1 − troops/cap)·재생 테크는 (영토 + Σ기지) 합에 한 번. 골드 = 평원 가중치 × 칸 × 생산력. 병력 상한 그대로 | 내 영토 평균은 초반에 폭주(9칸 → 수도 = 영토의 11배), 한계 재생은 큰 나라에서 0 에 수렴. 고정 기준이면 기지 가치가 판 내내 같고 hover 숫자가 안정된다 |
| A-104 | 기지 피해 상한 분배 | 원래 피해 비례 floor + 잔여(피해 DESC, flagId ASC), 총량 ≤ min(300, 남은 체력), **지출 = 적용 피해분만**, 함락자 = 적용 피해 최대 | 결정론 + 버려지는 피해에 병력을 쓰지 않음(사용자 제안과 같은 자연스러운 선택) |
| A-105 | 손실 바닥 | `COMBAT_LOSS_FLOOR_BP` 75 → 45 | 손실률과 같은 비율(×0.6) — 바닥이 상대적으로 세지면 소규모 교전만 따로 빨라진다 |
| A-106 | ×1.5 적용 | 방어 = 지형 항 대체(1500), 공격 = UNIT_ATK × 1.5 (테크 배율 앞) | 공격 태세엔 지형 항이 없어 "공격값 ×1.5" 가 유일한 자연스러운 자리 |
| A-107 | 수도 100칸분 | 시작 수도였던 칸이면 소유자 무관(빼앗은 수도도 100) | 칸의 성질로 정의 — 수도 함락의 가치가 커진다(사용자 "기지 가치 상승" 방향) |
| A-108 | 지명 표기 | 서양식 판타지 = **한국어 음차** 135개(예: 알더미어, 레이븐홀트), 동양식 120개 보관. 매치마다 양식 1개(시드 결정론, 현재 활성 = 서양식뿐) | UI·사용자 텍스트가 한국어 전용. 저작권 있는 고유 지명(작품 지명)은 피했다 |
| A-109 | 봇: 중립 기지 | 국경 6칸 안 **중립 기지도 기지 후보**, 점수 ×2.0(적 기지 ×2.5 보다 낮게), 발령 = 풀 45%(중립 비율), 병종 = 기병 | 기지 = 영토 60칸분이 되어 중립 기지가 가장 값싼 큰 이득. 적 기지 가중(사용자 확정 ×2.5)은 그대로 |
| A-110 | 판 길이 추정 기준 | `PACING_P_REF_LAND_PER_PLAYER` = M 10인 육지/인 = 540 (구 390) | 추정식의 상대 눈금 유지(물 축소로 모든 맵의 육지가 늘었다). 절대 시간은 22.8 측정이 우선 |
| A-111 | 프로토콜 형식 | `production.rows`(kind base/territory) — 이름까지 바꿨다(지역 의미가 사라져 `regions` 를 남기면 오해). 틱당 손실 = 델타 `combatLoss` 추가 | 22.3 — 기존 델타로는 정확히 못 구한다 |
| A-112 | 방어 경로가 막힐 때 | 목적지 = from 에서 적 땅 없이 닿는 칸 중 **지형 거리장(적 땅 무시) 기준 앵커에 가장 가까운 칸**(동률 tileId) → 거기 닿으면 `IDLE(reason "unreachable")`, 이후 기존 IDLE 규칙(600 tick 뒤 자동 귀환). 방어 도착(`defendArrived`)이 먼저. 길이 다시 열려도 자동으로 다시 가지 않는다(재지정 필요) | 결정론·기존 상태 기계 재사용. 계속 MARCHING 으로 버티면 "멈춘 행군"이 화면에서 구분되지 않는다 |
| A-113 | 중립 노출 소모 | 적 땅의 절반: tick 당 `floor(병력milli × 25 / 100000)`, 최소 **500 milli**(적 땅 최소 1000 의 절반), 남은 병력 이하 | 사용자 "절반" 기본값. 최소도 절반이라 작은 깃발에서도 비율이 그대로 반 |

봇 조정 요약(사용자 "적당히"): 상륙 탐색 삭제 · 중립 기지 후보(A-109) · 기동 노드 우선순위(22.7) · **방어 발령·재지정 전에 적 땅 없이 닿는지 확인**(`defendReachable` BFS — 못 닿으면 그 명령을 내지 않고 다른 후보·전환으로 넘어간다: 기지 수비·요격·차단·최소 방어선·반격 재지정 전부) · 막혀 IDLE(unreachable) 이 된 깃발은 기존 IDLE 규칙(재배치 또는 가까운 기지로 회수) · 그 밖(중립 바이어스 ×1.6, 기지 수비 `guardBases`, ×1.5 는 `flagValue` 경유로 자동 반영, 기지 공격은 이미 기지당 깃발 1개라 피해 상한에 맞음)은 그대로. 이탈 손실 추정은 소유자 이탈 tick 스탯을 쓴다.

### 22.10 상수 (`match_config.constants` 에 자동 포함)

| 상수 | 값 | |
|---|---|---|
| `TARGET_LAND_RATIO_PERMILLE` / `LAND_RATIO_MIN·MAX_PERMILLE` | 900 / 885·915 | 사용자 "약 10%" · [A-102] |
| `COMBAT_LOSS_BP` / `COMBAT_LOSS_FLOOR_BP` | 90 / 45 | 사용자 / [A-105] |
| `BASE_HP_DMG_CAP_MILLI_PER_TICK` | 300 | 사용자 |
| `COMBAT_BASE_ATK_PERMILLE` (`COMBAT_BASE_DEF_PERMILLE`) | 1500 (1500) | 사용자 |
| `BASE_PROD_TILES` / `CAPITAL_PROD_TILES` / `PROD_REF_TILES` | 60 / 100 / 390 | 사용자 / 사용자 / [A-103] |
| `PACING_P_REF_LAND_PER_PLAYER` | 540 | [A-110] |
| `DISENGAGE_TICKS` / `RETURN_SPEED_PERMILLE` | 15 / 1500 (무테크 — 플레이어 스탯이 덮어쓴다) | 기존 |
| `FLAG_EXPOSED_ATTRITION_BP` / `FLAG_EXPOSED_MIN_MILLI` | 5 / 1000 (적 땅 — 기존 값, 주석 정정 ≈14%/분) | 기존 |
| `FLAG_EXPOSED_ATTRITION_NEUTRAL_PCM` / `FLAG_EXPOSED_NEUTRAL_MIN_MILLI` | 25 / 500 (중립 땅) | 사용자 "절반" · [A-113] |
| ~~`NEUTRAL_SQRT_COEF_PERMILLE`~~ | 삭제 | 사용자 |

### 22.11 서버 코드

`shared/src/constants.ts`(상수·노드 17/19·`TECH_STAT` 11/13·`TechNodeDef.icon`), `shared/src/protocol.ts`(`ProductionRow`·`PlayerProduction.rows`·델타 `combatLoss`), `shared/src/tech.ts`(`techDisengageTicks`·`techReturnSpeedPm`, `techShallowPm` deprecated), `shared/src/terrain.ts`, `server/src/topology/square.ts`(`isPassable` = 육지), `server/src/map/generate.ts`(1단계 호수 생성기), `server/src/map/placeNames.ts`(양식별 풀), `server/src/map/presets.ts`(generator 표기 v4.5), `server/src/game/rules.ts`(중립 비용, 거리장 키 = 목적지, 귀환 속도 스탯), `combat.ts`(×1.5 태세 무관, 상륙 배율 삭제, `combatLoss` 기록, 자동 이탈 tick 스탯), `flagops.ts`(이탈 tick 스탯), `gauge.ts`(`splitBaseDamage`·피해 상한), `economy.ts`(`terrRegenBaseMilli`·`baseRegenBaseMilli`·`baseGoldWeight`·`applyRegenMult`), `production.ts`(전면 교체 — 기지 행 + 영토 행), `state.ts`(`capitalTiles`·`ProductionYield`·`TickChanges.combatLoss`, 지역 캐시 삭제), `snapshot.ts`, `tick.ts`, `bot.ts`(상륙 삭제·중립 기지 후보·우선순위·`chooseUnitFor` 테스트 훅), `server/src/room/settings.ts`(추정 기준), `server/maps/official/*.json` 9장, 스크립트 `eval-maps.cjs`(목표 육지 0.90)·`selfplay.ts`(중립 잔여 지표)·`qa-schema.ts`·`qa-scenarios.ts`·`duels.ts`. 테스트 `server/test/v45.test.ts`(신규) 외 갱신.
방어 경로·노출: `rules.ts`(`hostileLand`·`defendPathing`·`defendDest`·`nextStep`, 거리장 금지 칸 인자), `state.ts`(`pathVersion`·`defFields`), `movement.ts`(settle 의 unreachable IDLE, `exposureLossMilli`), `flagops.ts`(첫 걸음 `nextStep`), `bot.ts`(`defendReachable`).
클라이언트는 빌드·기존 테스트 유지용 최소 수정만: `client/src/state/gameModel.ts`·`ui/production.ts`(`regions` → `rows` 타입), `ui/techTree.ts`(스탯 11·13 라벨), `ui/pacing.ts`(공유 기준 상수), 테스트 픽스처 2개. 나머지 UI(영토 행 라벨, −n/틱, 노드 아이콘 17·19, 이탈 호 길이, 물 경로 표시 제거)는 프론트 몫.

### 22.12 방어 태세 깃발은 적 땅을 지나지 못한다 (사용자 2026-10-15)

- **적 땅** = 적대(동맹 아님) 플레이어 소유 칸. 중립·내 땅·동맹 땅은 지나간다.
- 대상 = **현재 태세가 DEFEND 이고 귀환(RETURNING)·패주가 아닌 깃발**의 모든 이동: 발령 행군, 재지정 행군, 태세 전환 뒤 이동. 매 tick 그 시점 태세로 경로를 고르므로 **행군 중 공격 → 방어 전환(수동·대기 태세 자동 적용)이면 다음 걸음부터 새 규칙**, 방어 → 공격이면 기존 경로. 공격 태세·귀환·패주 경로는 바뀌지 않는다.
- 경로 = 적 땅을 뺀 그래프의 거리장(지형 이동배율 가중, 동률 tileId — 기존 `stepToward` 와 같은 결정론). 깃발이 적 땅 위에 있으면 출발은 허용(빠져나오는 걸음).
- **못 가면 [A-112]**: 실제 목적지 = 지금 칸에서 적 땅 없이 닿는 칸 중 **적 땅을 무시한 지형 거리로 앵커에 가장 가까운 칸**(동률 tileId 작은 쪽) = "적 땅 바로 앞". 그 칸에 서면(처음부터 그 칸이면 바로) `flag_idle{reason:"unreachable", autoRecallTick}` → `IDLE`. 우선순위: 방어 도착(`defendArrived` — 앵커가 남의 땅이면 내 땅 관할 원 안 도착 포함) > unreachable 정지. IDLE 이후는 기존과 같다(600 tick 뒤 자동 귀환, 전투·ZOC 그대로). 길이 나중에 열려도 다시 가지 않는다 — 재지정하면 그 시점 지도로 다시 계산.
- 표시용 `etaTick`·`engageEtaTick`(flag_issued·flag_retargeted)도 같은 경로로 추정한다(막히면 정지 칸까지).
- 메시지: `flag_idle.reason` 의 기존 enum 값 `"unreachable"`(그동안 "송신하지 않음")이 **이제 실제로 온다** — 형식 변경 없음.

```json
{ "type":"flag_retargeted","tick":2210,"flagId":31,"anchorTileId":2405,"targetOwnerId":254,"posture":1,"resumeTick":2225,"etaTick":2290,"engageEtaTick":2290,"auto":false }
{ "type":"flag_idle","tick":2290,"flagId":31,"reason":"unreachable","autoRecallTick":2890 }
```
- 비용: 방어 경로 거리장은 (목적지, 소유자) × `pathVersion`(소유권·동맹이 바뀔 때마다 +1) 캐시 — 땅이 바뀐 tick 엔 행군 중인 방어 깃발마다 다시 계산. 자가대전 tick 평균 0.44 → 0.83 ms(최대 26 ms) — 200 ms 예산 안.

### 22.13 노출 소모 — 중립 땅은 절반 (사용자 2026-10-15)

| 깃발이 선 칸 | tick 당 소모 (milli) | 분당 (복리) |
|---|---|---|
| 적 땅(적대 플레이어) | `max(1000, floor(병력 × 5 / 10000))` — 기존 그대로 | ≈ 14% |
| **중립 땅** | **`max(500, floor(병력 × 25 / 100000))`** [A-113] | ≈ 7% |
| 내 땅 · 동맹 땅 | 0 (기존) | 0 |

- 남은 병력보다 많이 깎지 않는다, 병력 0 이면 `flag_ended{reason:"attrited"}`(기존). 적용 대상 깃발 상태는 바뀌지 않았다 — 4단계에서 노출을 보던 모든 상태(행군·정지 점령·ENGAGED·IDLE·전투 중·**귀환 중**·발밑 칸이 점령된 깃발)에 그대로. **패주 깃발은 기존처럼 면제**(코드상 노출 대상이 아니었다 — 바꾸지 않았다).
- 구 상수 주석 "≈3%/분" 은 틀린 값이었다(0.05% × 300 tick ≈ 14%/분) — `shared/src/constants.ts` 주석을 고쳤다. GDD 부록 A(`01_game-designer_gdd.md` 4754행)의 같은 주석은 디자이너 문서라 손대지 않았다 — 갱신 필요.


---

## 23. 봇 세력 이름 · 동맹 파기 수 `allyBreaks` (프론트 영향 — 2026-10-18, 사용자 결정)

근거: `_workspace/00_input/design-decisions.md` 2026-10-18 항목 8(봇 이름을 세력 이름 테마로, 지명 양식과 일관)·항목 6(플레이어 정보 카드 — 동맹 파기 이력).
**추가만 — 메시지·필드 형식 변경 없음.** `PROTOCOL_VERSION` 1 그대로.
**프론트 영향**: ① 봇 표시명이 더 이상 `"BOT n"` 이 아니다 — 봇 여부는 반드시 `room_state.players[].isBot` 으로 판단할 것(이름 패턴 금지). 이름은 최대 16자(`NICKNAME_MAX_LEN`)이고 공백을 포함한다. ② 정보 카드의 파기 이력은 `allyBreaks` 를 쓴다 — `ally_break_started` 를 직접 세지 않아도 되고, 중간 입장·재접속에서도 값이 맞다.

### 23.1 봇 세력 이름

- **어디에**: `room_state.players[].nickname`(봇 자리). 카운트다운 시작 `room_state` 부터 이 이름이고, 게임 시작부터 끝까지 바뀌지 않는다(예외는 아래 "지명과 안 겹침"의 드문 경우 하나).
- **꼴**: `"{핵심어} {꼴}"`. 서양식 예: `"레이븐홀트 공국"`, `"알더미어 동맹"`, `"북부 변경백령"`, `"에스테르 자유도시"`.
  - 서양식 핵심어 = 세력 전용 46개(방위어 북부·남부·동부·서부·고지·해안·내륙·변방 포함) ∪ 서양식 지명 풀 135개. 꼴 14개: 공국·왕국·동맹·연합·변경백령·자유도시·기사단·백작령·대공국·후국·공화국·연방·상업동맹·제국.
  - 동양식(지명처럼 보관만, 현재 미사용): 핵심어 30개 ∪ 동양식 지명 풀, 꼴 12개(왕조·왕국·연맹·도호부·후국·부족연합·상단·군벌·대국·맹·문파·성국). 예: `"해동 왕조"`.
- **양식**: 매치 지명 양식과 같은 규칙(`pickPlaceNameStyle(시드)`, 활성 양식 = 서양식만). 한 판 안의 지명과 세력 이름은 같은 양식이다.
- **결정론·고유**: 카운트다운 시작 때 뽑는 **매치 시드**로 핵심어를 셔플하고 꼴을 고른다. 핵심어 하나당 이름 하나라 매치 안에서 고유하다. 시드와 사람 닉네임이 같으면 이름도 같다. 봇 자리는 playerId 오름차순으로, 후보 목록 앞에서부터 **아직 어떤 멤버도 쓰지 않은 이름**을 받는다(사람 닉네임과 같은 이름도 건너뛴다).
- **지명과 안 겹침**: 그 매치 지명과 같은 핵심어는 쓰지 않는다. 카운트다운 때는 맵이 아직 없으므로 같은 시드의 지명 셔플 앞 32개를 미리 뺀다(총 기지 ≤ 24 보다 크다. 지명 배정은 셔플 앞부분을 쓰므로 기지 수와 상관없이 실제 지명이 이 안에 들어간다). 랜덤 맵이 불변식 실패로 시드+k 를 써서 지명이 달라진 드문 경우에만, 시작 때 실제 지명으로 다시 확인해 겹친 봇 이름을 바꾼다. 그 경우 IN_GAME `room_state` 의 이름이 카운트다운 때와 다를 수 있다 **[GDD에 없어 임의 결정함]**.
- **길이**: ≤ 16자 보장(현재 데이터 최장 11자). 후보가 바닥나면 구 형식 `"BOT n"` 을 쓴다(실제로는 안 생긴다 — 서양식 후보 ≈180개 ≫ 최대 12인).
- **인계**:
  - 카운트다운 중 사람이 나가 자리가 봇이 되면(`isBot` true) 세력 이름을 받는다(구 `"BOT n"`).
  - **인게임 접속 끊김 → `bot_takeover` 로 봇이 조종해도 사람 닉네임은 그대로**다(`isBot` false 유지, 기존과 같음).
- **시드 흐름(서버 내부)**: 매치 시드를 카운트다운 시작 때 한 번 뽑아 랜덤 맵 시드 / 프리셋 맵의 룸 시드(봇 성향·지명) / 세력 이름에 함께 쓴다. 판당 시드 추첨 수(1)와 용도는 같다 — `match_config.seed` 의미는 바뀌지 않는다.

```json
{ "type": "room_state", "phase": "COUNTDOWN", "players": [
  { "playerId": 1, "sessionId": "s_3f2a…", "nickname": "alice", "isBot": false, "isHost": true, "ready": false, "status": "LOBBY_WAITING" },
  { "playerId": 2, "sessionId": null, "nickname": "레이븐홀트 공국", "isBot": true, "isHost": false, "ready": true, "status": "LOBBY_WAITING" },
  { "playerId": 3, "sessionId": null, "nickname": "북부 변경백령", "isBot": true, "isHost": false, "ready": true, "status": "LOBBY_WAITING" }
], "…": "…" }
```

### 23.2 `allyBreaks` — 플레이어가 시작한 동맹 파기 수

- 정의: 판 시작부터 그 플레이어가 `cmd_ally_break` 로 **파기를 시작한 횟수**(= `ally_break_started.byPlayerId` 가 그 플레이어인 이벤트 수). 파기당한 쪽, Lockout 강제 해제, 탈락으로 인한 해제는 세지 않는다. 거절된 파기(`NOT_ALLIED`·`MIN_DURATION`)도 세지 않는다. 값은 줄지 않는다.
- `snapshot_full.players[].allyBreaks: int` — **항상** 실린다(초기 0).
- `snapshot_delta.playerDeltas[].allyBreaks?: int` — **값이 바뀐 델타에만** 실린다. 주기는 `playerDeltas` 와 같은 `PLAYER_DELTA_INTERVAL`(5 tick)이라 파기 시작 tick 보다 최대 1초 늦을 수 있다(즉시 반영이 필요하면 `ally_break_started` 이벤트). 다른 필드가 그대로여도 allyBreaks 가 바뀌면 그 플레이어 행이 실리고, 행의 다른 필드는 기존처럼 전부 현재값이다. 필드가 없으면 이전 값을 유지한다.
- 전체 공개(시야 공개 원칙과 같다 — 플레이어별 분기 없음).

```json
{ "type":"ally_break_started","tick":2400,"a":1,"b":2,"byPlayerId":2,"breakAtTick":2550 }
{ "type":"snapshot_delta","tick":2400,"playerDeltas":[ { "id":2,"tiles":410,"troops":380,"gold":95,"goldWeight":41000,"upkeepPm":120,"techMask":5,"allyBreaks":1 } ], "…":"…" }
{ "type":"snapshot_full","tick":2600,"players":[ { "id":2,"tiles":412,"troops":385,"gold":101,"goldWeight":41200,"upkeepPm":120,"techMask":5,"techCount":2,"flagCap":4,"alive":true,"connected":true,"allyBreaks":1 } ], "…":"…" }
```

- 타입: `shared/src/protocol.ts` `PlayerSnapshot.allyBreaks?`(서버는 항상 싣는다 — 옵셔널은 기존 클라이언트 테스트 픽스처 호환용), `PlayerDelta.allyBreaks?`.

### 23.3 서버 코드 · 검증

- `server/src/map/placeNames.ts` — `FACTION_CORE_POOLS`·`FACTION_FORMS`(양식별), `assignFactionNames(seed, count, {style, exclude})`, `factionCore(name)`, `FACTION_NAME_MAX_LEN`.
- `server/src/room/room.ts` — 매치 시드 `seed()`, `prepareFactionNames`(카운트다운), `takeFactionName`(봇 자리·카운트다운 이탈), `reconcileFactionNames`(시작 때 실제 지명 확인), `giveFactionName`(스크립트용 공개 메서드).
- `server/src/game/state.ts`(`PlayerState.allyBreaks`), `alliance.ts`(파기 시작 때 +1), `snapshot.ts`(full 은 항상, `DeltaTracker` 는 바뀐 때만).
- 스크립트: `watch-game.ts`(AI 전용 판의 방장 자리도 세력 이름 → 로그 머리 표), `selfplay.ts`(우승자 세력 이름 표시 — 그 판 지명을 뺀 같은 함수), `qa-schema.ts`(full `allyBreaks` 필수, 델타 `allyBreaks?`), `qa-headless.ts`(재구성 비교에 allyBreaks 추가).
- 테스트: `server/test/v46.test.ts`(신규 — 풀 무겹침·길이·고유·결정론·한 양식·지명 회피 시드 200개, allyBreaks 증가·full·델타 바뀐 때만), `server/test/rooms.test.ts`(카운트다운~시작 이름 불변·지명 비충돌·같은 시드 같은 이름, 프리셋 맵, 인게임 인계 뒤 사람 닉네임 유지, 카운트다운 이탈 자리 세력 이름. 기존 `'BOT 3'` 기대값 갱신).
- 결과(2026-10-18): `npm run typecheck` 통과, `npm test` 26 파일 362 테스트 통과, `npm run smoke` PASSED, `qa:headless` 스키마 위반·순서 위반·재구성 불일치 0, `qa:ws` 78/78.

## 24. 판 길이 레버 재조정 — 승리 기준 곡선(B) · 종반 러시(C) (프론트 영향 없음 — 2026-10-18, 사용자 선택 B+C)

근거: 사용자가 2026-10-18에 **B(승리 기준 낮추기) + C(종반 러시 강화)** 를 골랐다. A(맵 축소)는 채택하지 않았다.
문제(실측): 봇 판이 전부 32분 하드 타임아웃으로 끝났다(자가대전 20판 + 관전 1판). 30분 1위 점유율 ≈ 22~28%, 종료 시 25~28%라 기존 바닥 45%에 아무도 닿지 못했다.
목표: 25~32분(표준 30분), 대부분 **점유율 승리**로 종료, 24분 이전 종료는 거의 없게.
**메시지·필드 형식 변경 없음, `PROTOCOL_VERSION` 1 그대로.** 값만 바뀐다. 클라이언트는 `match_config.constants`·`match_config.endgameRush`·`match_config.thresholdCurve`·`threshold_update`·`endgame_rush` 를 읽으므로 코드 수정이 필요 없다.

### 24.1 새 값 (전부 [A] — 사용자 확인 필요)

| 상수 (`shared/src/constants.ts`) | 구값 | 새 값 | 항목 |
|---|---|---|---|
| `THRESHOLD_START_PCT` | 60 | 60 (그대로) | — |
| `THRESHOLD_DECAY_START` | 4800 (16분) | **6000 (20분)** | [A-114] |
| `THRESHOLD_DECAY_PER_MIN_PERMILLE` | 1500 (1.5 %p/분) | **3500 (3.5 %p/분)** | [A-115] |
| `THRESHOLD_FLOOR_PCT` | 45 (26분 도달) | **25 (30분 = tick 9000 도달)** | [A-116] |
| `ENDGAME_RUSH_TICK` | 8400 (28분) | **7800 (26분)** | [A-117] |
| `ENDGAME_RUSH_COST_MULT_PERMILLE` | 750 (×0.75) | **600 (×0.6)** — 깃발 전투에는 여전히 미적용(점령 비용 `tileCost` 만) | [A-118] |
| `ALLIANCE_CUTOFF_TICK` | 8400 | **= `ENDGAME_RUSH_TICK` (7800)** — 리터럴 대신 상수 참조로 묶음 | [A-117] 연동 |
| `HARD_TIMEOUT_TICK` | 9600 (32분) | 9600 (그대로) | — |

승리 기준 곡선(분 경계값): 20분 60% → 21분 56.5 → 22분 53 → 23분 49.5 → 24분 46 → 25분 42.5 → **26분 39(러시)** → 27분 35.5 → 28분 32 → 29분 28.5 → **30분 25(바닥)**.
- 정수성: 분당 감쇠 = 3500 × 200 / 1000 = 700 단위(정수)라 분 경계값은 정확하다. tick 사이 값은 `floor` (2.33 단위/tick). 판정은 기존처럼 `thresholdScaled(t)` 정수 비교.
- `threshold_update`: 20분~30분 분당 1회 = **총 11회** (구: 16~26분 11회, 개수 동일). 30분(9000)에 25% 를 보낸 뒤 멈춘다.
- 실측 근거: 1위 점유율이 20분 ≈ 23%, 25분 ≈ 25% 다. "20분까지 60% 유지 → 이후 가파르게 하락" 곡선은 24분 기준이 46%라 24분 이전 조기 종료를 막고, 27~30분에 1위의 실제 점유율(28~33%)과 만난다. 바닥 25% 는 교착 판(1위 22~26%)도 일부 30~32분에 끝내기 위한 값이다.

### 24.2 스윕 (selfplay, NORMAL 전원 — 같은 시드는 같은 맵·같은 초반)

명령: `npm run selfplay -w @civwar/server -- <판> <시드> <크기> <인원>`. 스윕 동안에만 상수를 환경 변수로 덮어쓰는 임시 코드를 넣어 돌렸다(제거 완료, 커밋 대상 아님). 최종 값을 상수에 적용한 뒤 같은 시드(1000~1004)로 다시 돌려 스윕 결과와 판별로 똑같음을 확인했다.
표기: `s`=감쇠 시작(분) `r`=감쇠 %p/분 `f`=바닥 % / `rush`=러시 분·배율 / `cap2x`=러시 중 기지 피해 상한 ×2 (실험, 미채택).
"1위 @25/@30" 은 그 시각까지 간 판만 평균한다(일찍 끝난 판 제외 → n 표기). 그래서 남은 교착 판 위주라 값이 낮게 나온다.

M 10인, 시드 1000~ :

| 구성 | 판 | 평균 종료(분) | 최소 / 최대 | 점유율 / 시간 종료 | 1위 @20 / @25 / @30 (%) | 탈락/판 |
|---|---|---|---|---|---|---|
| 기존 (s16 r1.5 f45, rush 28 ×0.75) | 10 | 32.0 | 32.0 / 32.0 | 0 / 10 | 23.0 / 26.1 / 28.1 | 0.5 |
| B: s12 r2.5 f30 | 10 | 27.9 | 23.3 / 32.0 | 6 / 4 | 23.0 / 21.3 (n=5) / 23.5 (n=5) | 0.4 |
| B: s12 r2.5 f28 | 10 | 27.5 | 23.3 / 32.0 | 6 / 4 | 23.0 / 21.3 (n=5) / 21.9 (n=4) | 0.3 |
| B: s14 r3.0 f27 | 10 | 27.4 | 23.4 / 32.0 | 7 / 3 | 23.0 / 21.3 (n=5) / 21.9 (n=4) | 0.3 |
| B: s12 r3.0 f25 | 10 | 26.5 | 21.6 / 32.0 | 7 / 3 | 23.0 / 21.3 (n=5) / 21.9 (n=4) | 0.3 |
| C: rush 26 ×0.6 | 10 | 32.0 | 32.0 / 32.0 | 0 / 10 | 23.0 / 26.1 / 29.2 | 0.6 |
| C: rush 24 ×0.5 | 10 | 32.0 | 32.0 / 32.0 | 0 / 10 | 23.0 / 26.5 / 28.9 | 0.8 |
| B+C: s12 r2.5 f30 + rush 26 ×0.6 | 10 | 27.7 | 23.3 / 32.0 | 6 / 4 | 23.0 / 21.3 (n=5) / 24.0 (n=5) | 0.3 |
| B: s16 r3.0 f28 | 10 | 28.9 | 25.0 / 32.0 | 6 / 4 | 23.0 / 26.1 / 21.9 (n=4) | 0.4 |
| B: s18 r3.5 f28 | 10 | 29.1 | 25.4 / 32.0 | 6 / 4 | 23.0 / 26.1 / 21.9 (n=4) | 0.4 |
| B: s20 r4.0 f27 | 10 | 29.3 | 26.8 / 32.0 | 7 / 3 | 23.0 / 26.1 / 21.9 (n=4) | 0.4 |
| B: s18 r3.5 f26 | 10 | 28.7 | 25.4 / 32.0 | 7 / 3 | 23.0 / 26.1 / 21.9 (n=4) | 0.4 |
| B+C: s18 r3.5 f28 + rush 26 ×0.6 | 10 | 29.0 | 25.4 / 32.0 | 6 / 4 | 23.0 / 26.1 / 22.6 (n=4) | 0.4 |
| B+C: s18 r3.5 f28 + rush 26 ×0.5 | 10 | 29.4 | 25.4 / 32.0 | 6 / 4 | 23.0 / 26.1 / 23.6 (n=5) | 0.4 |
| B+C: s18 r3.5 f28 + rush 26 ×0.6 + cap2x | 10 | 29.0 | 25.4 / 32.0 | 6 / 4 | 23.0 / 26.1 / 23.1 (n=4) | 0.7 |
| B+C: s20 r4.0 f27 + rush 26 ×0.6 + cap2x | 10 | 29.3 | 26.7 / 32.0 | 7 / 3 | 23.0 / 26.1 / 23.1 (n=4) | 0.8 |
| B: s20 r4.0 f25 | 20 | 29.1 | 24.7 / 32.0 | 16 / 4 | 22.8 / 24.8 (n=19) / 22.3 (n=7) | 0.5 |
| B+C: s20 r4.0 f25 + rush 26 ×0.6 | 20 | 28.8 | 24.7 / 32.0 | 16 / 4 | 22.8 / 24.8 (n=19) / 22.3 (n=5) | 0.6 |
| B+C: s20 r4.0 f25 + rush 26 ×0.6 + cap2x | 20 | 28.9 | 24.7 / 32.0 | 15 / 5 | 22.8 / 24.8 (n=19) / 22.7 (n=6) | 0.7 |
| **B+C: s20 r3.5 f25 + rush 26 ×0.6 (채택)** | 20 | **29.4** | **25.3** / 32.0 | **16 / 4** | 22.8 / 25.7 / 22.8 (n=7) | 0.7 |
| B+C: s18 r3.0 f25 + rush 26 ×0.6 | 20 | 29.1 | 24.4 / 32.0 | 16 / 4 | 22.8 / 24.8 (n=19) / 22.6 (n=6) | 0.6 |
| B+C: s20 r4.0 f27 + rush 26 ×0.6 | 20 | 29.4 | 24.7 / 32.0 | 12 / 8 | 22.8 / 24.8 (n=19) / 23.6 (n=9) | 0.6 |
| B+C: s20 r4.0 f25 + rush 24 ×0.5 | 20 | 28.5 | 24.9 / 32.0 | 16 / 4 | 22.8 / 25.2 (n=19) / 22.6 (n=4) | 0.7 |
| B+C: s20 r4.0 f24 + rush 26 ×0.6 | 20 | 28.5 | 24.7 / 32.0 | 17 / 3 | 22.8 / 24.8 (n=19) / 22.1 (n=4) | 0.6 |
| 채택 곡선만 (러시 기존 28 ×0.75) | 20 | 29.7 | 25.3 / 32.0 | 15 / 5 | 22.8 / 25.7 / 22.8 (n=9) | 0.5 |
| 채택 곡선 + rush 26 ×0.5 | 20 | 29.6 | 25.3 / 32.0 | 16 / 4 | 22.8 / 25.7 / 22.4 (n=5) | 0.6 |

M 10인, 다른 시드(2000~, 과적합 확인):

| 구성 | 판 | 평균 종료 | 최소 / 최대 | 점유율 / 시간 종료 | 1위 @20 / @25 / @30 | 탈락/판 |
|---|---|---|---|---|---|---|
| 기존 | 20 | 32.0 | 32.0 / 32.0 | 0 / 20 | 20.5 / 24.9 / 26.7 | 0.5 |
| **채택** | 20 | **29.4** | **27.7** / 32.0 | **19 / 1** | 20.5 / 24.9 / 23.0 (n=5) | 0.5 |

채택 값 M 10인 합계 40판: 평균 29.4분, 점유율 종료 35 / 시간 종료 5, 최소 25.3분(24분 이전 0판).

관찰:
1. **C 단독은 효과가 없다.** 러시 26분 ×0.6, 24분 ×0.5 모두 10/10 시간 종료. 러시는 모두에게 똑같이 싸지므로 30분 1위 점유율을 +1%p 정도만 올린다. 판을 끝내는 주 레버는 **B(곡선)** 다.
2. **감쇠를 일찍 시작하면 24분 이전 종료가 생긴다.** 12~14분 시작(s12/s14)에서는 일찍 독주한 판(20분 26~29%)이 23~24분에 끝나 최소 21.6~23.4분이 나왔다. 20분 시작 + 가파른 하락이 "24분 이전 거의 없음"과 "30분 전후 종료"를 같이 맞춘다.
3. **바닥이 27~28% 면 교착 판(1위 20~24%)이 남는다.** f27 은 12/20 만 점유율 종료, f25 는 16/20, f24 는 17/20. 25%(육지 1/4)를 채택했다. 24% 는 이득이 1판뿐이라 승리 의미를 더 깎을 이유가 약하다.
4. 같은 곡선에서 러시 26 ×0.6 은 러시 기존값 대비 평균 −0.3분, 시간 종료 5 → 4, 탈락 0.5 → 0.7/판. 작지만 같은 방향이다. ×0.5 는 ×0.6 보다 나아진 게 없어 ×0.6 을 채택했다.
5. 남는 시간 종료(M 40판 중 5판)는 1위 22~25% 의 완전 교착 판이다. 바닥을 더 낮추지 않는 한 남는다.

### 24.3 S 7인 · L 12인 확인 (채택 값, 10판씩)

| 크기·인원 | 구성 | 평균 종료 | 최소 / 최대 | 점유율 / 시간 종료 | 1위 @20 / @25 / @30 | 탈락/판 |
|---|---|---|---|---|---|---|
| S 7인 (시드 3000~) | 기존 | 29.5 | 25.1 / 32.0 | 5 / 5 | 35.3 / 37.1 / 37.8 (n=6) | 0.5 |
| S 7인 | **채택** | **26.0** | 23.4 / 28.4 | 10 / 0 | 35.3 / 33.0 (n=6) / - | 0.5 |
| L 12인 (시드 4000~) | 기존 | 32.0 | 32.0 / 32.0 | 0 / 10 | 19.6 / 21.9 / 23.2 | 0.4 |
| L 12인 | **채택** | **31.0** | 29.2 / 32.0 | 5 / 5 | 19.6 / 21.9 / 20.6 (n=7) | 0.3 |

- S 7인: 1인당 육지가 적어 1위가 20분에 이미 35% 라, 기준이 내려오는 24~26분에 끝난다(평균 26.0, 최소 23.4). 목표 대역 하단이지만 S 는 표준이 아니다(권장 5~6인, 7인은 최대). 방 설정 `pacingNote` 도 S 7인에 `estimate:23` 을 보여주므로(24.5) 짧은 판이 예상되는 설정으로 이미 안내된다.
- L 12인: 1위가 20~23% 에 머물러 절반은 여전히 시간 종료(평균 31.0). 기존(10/10 시간 종료)보다는 낫다. 더 줄이려면 바닥을 더 낮추거나(승리 의미 약화) 맵·인원 레버가 필요한데, 이번 범위(A 미채택) 밖이다.

### 24.4 시도했으나 채택하지 않은 것 — 러시 중 기지 피해 상한 ×2 [A — 미적용]

- 아이디어: 종반 러시 동안 `BASE_HP_DMG_CAP_MILLI_PER_TICK`(300) 을 ×2(600) 로 올려 기지 함락 → 멸망·합병(§21)으로 큰 점유율 이동을 만든다.
- 결과: 탈락/판은 0.4 → 0.7~0.8 로 늘었지만 종료 시각·점유율 종료 비율은 나아지지 않았다(29.0 vs 29.0, 15/20 vs 16/20). 깃발 하나의 원래 피해가 상한보다 작은 경우가 대부분이라 상한을 올려도 잘 걸리지 않는다. **적용하지 않았고, 코드에도 남기지 않았다.**
- 러시 중 기지 체력 회복 차단 같은 다른 변형은, 상한 ×2 도 효과가 미미했던 결과로 보아 기대 효과가 작아 돌리지 않았다.

### 24.5 클라이언트·방 설정 확인 (코드 수정 없음)

- `client/src/ui/pacing.ts` `estimatePacing`/`pacingText` 와 서버 `server/src/room/settings.ts` `pacingNote` 는 `HARD_TIMEOUT_TICK`(그대로 9600)·`PACING_P_REF_LAND_PER_PLAYER`·`TARGET_LAND_RATIO_PERMILLE`·`MAP_SIZE_PRESETS` 만 읽는다. 승리 기준·러시 상수에 의존하지 않으므로 그대로 맞다. 추정식 기준값 `T_BASE 29.4분`은 채택 값의 M 10인 실측 평균(29.4분, 40판)과 일치한다. 참고: S 7인 추정 23분(실측 26.0), L 12인 추정 29분(실측 31.0).
- `client/src/ui/Help.tsx` 승리 기준·종반 러시 문구는 `THRESHOLD_START_PCT`/`THRESHOLD_DECAY_START`/`THRESHOLD_FLOOR_PCT`/`ENDGAME_RUSH_TICK`/`ALLIANCE_CUTOFF_TICK`/`HARD_TIMEOUT_TICK` 을 import 해 표시한다. 그래서 자동으로 "20분부터 … 25%에서 멈춥니다", "26분부터 종반 러시", "26분부터 새 동맹 불가"가 된다.
- `GameScreen.tsx` 러시 카운트다운은 `match_config.endgameRush.tick` 을, 피드 문구는 `endgame_rush.costMultPermille`(→ "×0.6")을, `playerInfo.ts` 는 `constants.ALLIANCE_CUTOFF_TICK` 을 읽는다.
- 클라이언트 테스트 픽스처(`client/test/*.test.ts` 의 `endgameRush: { tick: 8400, … }` 등)는 상수와 무관한 자체 완결 가짜 `match_config` 라 손대지 않았다.

### 24.6 서버 코드 · 테스트 · 검증

- 코드: `shared/src/constants.ts` 상수 5개 값 변경 + `ALLIANCE_CUTOFF_TICK = ENDGAME_RUSH_TICK` 참조. 로직 변경은 없다(`victory.ts` `thresholdScaled`, `tick.ts` 러시·threshold_update, `rules.ts` `tileCost` 는 상수만 읽는다).
- 테스트: `server/test/economy.test.ts` threshold 곡선·정수 판정 기대값을 새 곡선으로 갱신했다(20분 60, 21분 56.5, 24분 46, 26분 39, 29분 28.5, 30분 25, tick 사이 floor, 39%·25% 경계). `server/test/tick.test.ts` 는 threshold_update 11회 주석만 갱신(개수 동일). `qa-scenarios.ts` 동맹 마감 시나리오는 `ALLIANCE_CUTOFF_TICK` 을 import 하므로 수정이 필요 없다.
- 결과(2026-10-18): `npm run typecheck` 통과, `npm test` 28 파일 408 테스트 통과, `npm run smoke` PASSED, `qa:scenarios` 87/87, `qa:headless` 스키마 위반·순서 위반·재구성 불일치 0.
- 본문 예시 갱신: §5 `ALLY_CUTOFF` 조건, `match_config` 예시의 `endgameRush`·`thresholdCurve`, 이벤트 표의 `threshold_update`·`endgame_rush` 행. §10 항목 5 의 `[A-38]` 값은 당시 기록이라 그대로 둔다.
- **GDD 반영 필요(game-designer)**: GDD 6.1 승리 기준 곡선, 3.1 종반 러시, 6.2 동맹 마감 시각, 5.4 페이싱 결론을 위 값으로.

## 25. 교전 길이 · 띠 모양 영토 — 후보 비교 (프론트 영향 없음 — 2026-10-18, 측정만, **코드에 적용한 후보 없음**)

근거: `_workspace/ai-match/2026-10-18/review.md` 문제 3(교전 짧음)·5(띠 모양 영토), GDD v4.5 B-24 「v4.5 관측 지표」(b)(d). 사용자가 조사를 승인했고, 최종 값은 선택지로 다시 묻는다.
**판 길이 수치(§24 — 바닥 25%, 러시 26분 ×0.6)는 보류 상태 그대로 두었다.** 아래 기준선은 그 값이다.

### 25.0 측정 방법

- selfplay 와 같은 루프(실시간 대기 없이 tick 연속, M 100×60, 10인 NORMAL 전원)를 임시 측정 스크립트로 돌렸다. 후보마다 10판 × 시드 묶음 2개(**1000~1009**, **2000~2009** — 과적합 확인용). 같은 시드는 같은 맵·같은 초반이다.
- 후보는 측정하는 동안에만 `bot.ts`·`combat.ts` 에 환경 변수 훅을 넣어 켰다. 측정 후 `git checkout` 으로 되돌렸고 측정 스크립트도 지웠다. **어느 후보도 코드에 남아 있지 않다.** 영토 자동 편입(B5)은 서버 코드를 건드리지 않고 측정 스크립트 안에서만 돌렸다.
- **교전 길이**는 두 가지로 쟀다.
  - 무리: `combat_started` ↔ `combat_ended` 를 `groupKey` 로 짝지은 시간. watch-game 이 쓰는 방식이고 리뷰의 "중간값 3초"가 이것이다.
  - 깃발: 깃발 하나가 `inCombat` 으로 이어서 있었던 시간. 빠져나온 원인도 함께 분류했다.
- **조각남(fragmentation)** 지표 4개. 모두 낮을수록 좋다.
  - `덩어리`: 플레이어별로 자기 땅이 몇 조각인지(4방향 연결 성분 수), 생존자 평균. 1 = 한 덩어리.
  - `둘레/칸`: 자기 칸과 주인이 다른 육지 칸이 맞닿은 변의 수 ÷ 자기 칸 수. 물과 지도 끝은 세지 않는다. 띠 모양일수록 크다.
  - `고립지 %`: 자기 기지와 자기 땅으로 이어지지 않은 칸의 비율.
  - `구멍 칸`: 한 플레이어 땅(+ 물·지도 끝)에 완전히 둘러싸인 남의 땅·중립 칸 수(덩어리 ≤ 400칸, 기지가 든 덩어리 제외), 판당 합계.
- 그 밖: 패주/판(`flag_routed`), 전투 중 회수/판(전투 중인 깃발의 `flag_recalled`), 탈락/판, 플레이어 기지 함락/판, 방어 깃발 `flag_idle(unreachable)`/판, 종료 시각, 점유율 승리 판 수(나머지는 32분 시간 종료), 1위 점유율 @20/@25/@30분.
- "@30" 은 30분까지 간 판만 평균한다(n 표기). 일찍 끝난 판이 빠지므로 남은 교착 판 위주라 값이 낮게 나온다(§24 와 같은 주의).

### 25.1 (a) 교전이 짧은 이유 — 진단 (기준선, 시드 1000~1009)

| 깃발이 전투에서 빠진 원인 | 비율 | 중간값 / p90 (초) |
|---|---|---|
| 상대가 회수했다 — 나는 방어 태세 → 회수한 깃발(귀환)은 "공격 쪽"이 아니라 간선이 **그 tick 에 바로 끊긴다** | 31.3% | 3.2 / 6.4 |
| 내가 회수 → 이탈 대기 3초 → 이탈 | 24.9% | 3.8 / 6.6 |
| 내가 회수했다 — 상대는 방어 태세 → 바로 끊김(이탈 대기 없음) | 13.6% | 2.2 / 5.2 |
| 내가 패주 | 13.3% | 8.2 / 23.2 |
| 직접 닿은 상대 없이 무리로만 이어짐(간접 접촉) | 14.4% | 7.0 / 22.4 |
| 상대가 사라짐·이탈 완료·기타 | 2.5% | — |

| 시작 때 병력 비(큰 쪽 ÷ 작은 쪽) | 비율 | 중간값 (초) |
|---|---|---|
| < 1.5 | 25.9% | 3.2 |
| 1.5 ~ 3 | 33.3% | 3.2 |
| 3 ~ 10 | 29.5% | 4.0 |
| ≥ 10 | 11.3% | 3.0 |

결론:
1. **교전을 끝내는 것은 회수다(깃발 퇴장의 약 70%)**. 크기 차이가 아니다. 병력이 비슷한 교전(< 1.5배)도 중간값이 3.2초다. 패주로 끝나는 교전은 13%뿐이고, 그 중간값도 8.2초다.
2. 회수 572회/판 중 **전투 중 회수가 약 300회/판**이다(기준선 308 / 229). 전투 시작 뒤 **중간값 2.2초** 만에 회수한다. 전부 봇 `maintain` 의 8.6.0 후퇴 규칙이다. 봇 코드에서 전투 중 깃발을 회수하는 경로는 이것 하나다.
3. 후퇴 판정은 `내 병력 × v < 적 병력 × v × 0.8` 이다. 방어 깃발의 실효값이 공격 깃발보다 높다(언덕 창병 1300 × 1.3 = 1690, 기지 위 × 1.5, 기병 공격 1180). 그래서 비슷한 병력의 공격 깃발이 첫 접촉에서 바로 후퇴 조건에 걸린다. 발령 때의 회피 검사(`anchorDanger`)는 앵커 거리 ≤ 2 만 본다. 깊은 앵커(최대 20칸) 노선 중간에서 만나는 방어 깃발은 거르지 못한다.
4. **규칙의 빈틈: 방어 깃발과 싸우다 회수하면 공짜로 빠진다.** 귀환 깃발은 공격 쪽이 아니다([A-62]). 그래서 상대가 방어 태세면 간선이 사라져 다음 tick 에 전투가 끝나고, 이탈 대기(3초, ×0.5)를 치르지 않는다. 사람 플레이어도 똑같이 쓸 수 있다.
5. 손실 공식 L(평균 병력 × 0.9%, 편 사이는 1/v 비례 — 크기와 무관하게 같은 양)상 크기 차이가 크면 작은 쪽이 빨리 녹는다. 하지만 지금은 회수가 먼저 일어나 이 효과가 드러나지 않는다. L 후보(A4)가 중간값을 바꾸지 못한 것도 같은 이유다.
6. 설계 추정 37초는 "검 1000 : 검 1000, 평원, 양쪽 패주" 기준이다. 실제 교전은 대부분 크기·태세가 어긋나 있어, 끝까지 싸워도 패주 중간값은 8~13초다(아래 표). 37초를 그대로 목표로 삼기는 어렵다.

### 25.2 (a) 후보 비교 — 교전 길이

종류: **봇** = 봇 결정만 바뀜(규칙·프로토콜 그대로). **규칙 변경** = 사람에게도 적용되는 전투 규칙(GDD 4.15 수정 필요).

| 후보 | 종류 | 시드 | 무리 중간값 / p90 (초) | 깃발 중간값 / p90 | 패주/판 | 전투 중 회수/판 (시작 후 중간값) | 탈락/판 | 종료 평균 (최소~최대) | 점유율 승리 | 1위 @20 / @25 / @30 (%) |
|---|---|---|---|---|---|---|---|---|---|---|
| 기준선 | — | 1000 | 3.0 / 14.2 | 3.2 / 14.4 | 145 | 308 (2.2초) | 0.5 | 29.6 (27.6~32.0) | 7/10 | 23.0 / 26.1 / 22.6 (n=4) |
| 기준선 | — | 2000 | 3.0 / 14.2 | 3.2 / 14.4 | 124 | 229 (2.2초) | 0.6 | 29.2 (27.7~30.5) | 10/10 | 20.6 / 25.8 / 24.2 (n=2) |
| A1 후퇴 기준 완화 `BOT_RETREAT_RATIO` 0.8 → 0.5 | 봇 | 1000 | 4.6 / 24.0 | 4.8 / 23.8 | 159 | 220 (3.0초) | 0.4 | 29.4 (27.5~32.0) | 8/10 | 22.1 / 25.6 / 22.5 (n=2) |
| 〃 | 봇 | 2000 | 4.2 / 25.0 | 4.6 / 24.8 | 161 | 193 | 0.6 | 29.7 (26.0~32.0) | 6/10 | 22.7 / 26.0 / 21.2 (n=5) |
| A2 최소 교전 시간 — 전투 시작 10초 안에는 봇이 후퇴(회수)하지 않음 | 봇 | 1000 | **11.6 / 22.6** | 11.8 / 21.6 | 180 | 154 (12.0초) | 0.6 | 29.4 (26.4~32.0) | 9/10 | 23.6 / 26.7 / 23.0 (n=3) |
| 〃 | 봇 | 2000 | **11.6 / 21.8** | 11.8 / 22.4 | 212 | 149 | 0.5 | 30.2 (27.5~32.0) | 7/10 | 21.0 / 23.3 / 20.4 (n=4) |
| A2′ 최소 5초 | 봇 | 1000 | 7.8 / 18.4 | 7.6 / 17.6 | 165 | 232 (6.4초) | 0.5 | 30.4 (27.5~32.0) | 7/10 | 22.3 / 24.6 / 22.8 (n=5) |
| A2″ 최소 15초 | 봇 | 1000 | 14.0 / 25.6 | 15.2 / 25.6 | 196 | 123 (17.2초) | 0.2 | 29.8 (25.6~32.0) | 6/10 | 22.8 / 26.0 / 21.3 (n=4) |
| A3 **이탈 대기 중엔 접촉 유지** — 이탈 대기 깃발은 상대 태세와 무관하게 간선 유지(방어 상대 회수도 3초 ×0.5 를 치른다) | **규칙 변경** | 1000 | 4.4 / 14.2 | 4.4 / 15.6 | 151 | 280 (2.2초) | 0.5 | 29.7 (27.0~32.0) | 7/10 | 21.8 / 25.2 / 22.8 (n=4) |
| 〃 | **규칙 변경** | 2000 | 4.4 / 14.2 | 4.6 / 14.8 | 132 | 265 | 0.3 | 29.2 (26.9~32.0) | 8/10 | 23.1 / 26.8 / 21.6 (n=2) |
| A4 **작은 편 기준 L** — L 의 평균 병력 S/n 을 (편 수 × 작은 편 병력)/n 으로 바꿈(1:1 동수면 같다, 큰 쪽이 작은 쪽을 순식간에 녹이지 않음) | **규칙 변경** | 1000 | 3.0 / 21.2 | 3.2 / 22.4 | **92** | 286 (2.4초) | 0.4 | 29.4 (26.4~32.0) | 8/10 | 23.1 / 26.8 / 21.5 (n=3) |
| 〃 | **규칙 변경** | 2000 | 3.0 / 19.6 | 3.2 / 20.2 | **91** | 290 | 0.1 | 30.5 (27.8~32.0) | 6/10 | 20.3 / 22.9 / 23.1 (n=6) |
| A5 = A3 + A2 (10초) | 규칙 변경 + 봇 | 1000 | **12.4 / 21.0** | 12.8 / 20.8 | 181 | 168 (12.0초) | 0.5 | 29.7 (27.8~32.0) | 9/10 | 22.6 / 26.6 / 22.4 (n=5) |
| 〃 | 규칙 변경 + 봇 | 2000 | **12.2 / 22.2** | 12.6 / 21.8 | 174 | 150 | 0.8 | 29.3 (28.0~32.0) | 9/10 | 22.6 / 25.5 / 23.1 (n=2) |
| A6 = A1 + A2 (0.5 + 10초) | 봇 | 1000 | 12.0 / **29.0** | 12.4 / 30.0 | 199 | 115 (12.2초) | 0.4 | 28.9 (**24.5**~32.0) | 9/10 | 25.0 / 26.8 (n=9) / 22.8 (n=2) |
| 〃 | 봇 | 2000 | 11.8 / 28.4 | 12.2 / 28.4 | 194 | 99 | 0.2 | 29.4 (27.8~32.0) | 9/10 | 21.4 / 23.8 / 23.1 (n=2) |

관찰:
- 기준선 대비 중간값을 늘린 것은 **"후퇴 전 최소 교전 시간"(A2·A5·A6)뿐이다.** 두 시드 묶음 모두 3.0 → 11.6~12.4초가 됐고, 패주도 +24~70% 늘었다. 판 길이(29.3~30.2분)는 기준선 대역 안이다.
- A1(기준 완화)은 p90 만 늘린다(14 → 24초). 중간값은 4~5초다. 0.5 배보다 약해도 첫 접촉에서 빠지는 경우가 여전히 많다.
- A3(빈틈 막기) 단독 효과는 +1.4초다. 회수 자체가 줄지 않기 때문이다. 대신 "방어 깃발과 싸우다 공짜로 빠지기"가 사라진다. 이 효과는 봇보다 **사람 플레이**에서 중요하다.
- A4(작은 편 기준 L)는 중간값을 바꾸지 못하고 패주만 −37% 줄인다(작은 깃발이 덜 죽는다). 크기 차이는 원인이 아니라는 25.1 진단을 확인해 준다.
- A2″(15초)는 시드 1000 에서 점유율 승리 6/10, 탈락 0.2 로 나빠졌다. 10초가 경계다. A6 은 p90 이 가장 길지만 24.5분 종료가 한 판 나왔다(§24 목표 "24분 이전 거의 없음"의 경계).

**추천 (a)**: **A5 — A3(규칙: 이탈 대기 중 접촉 유지) + A2(봇: 전투 시작 10초 안 후퇴 금지)**. 두 시드 묶음 모두 중간값 ≈ 12초·p90 ≈ 21초, 점유율 승리 9/10·9/10, 종료 29.3~29.7분으로 가장 고르다. A3 은 규칙 변경이므로 사용자 확인이 필요하다. 규칙 변경을 원하지 않으면 **A2 단독(봇만)** 이 차선이다(중간값 11.6초, 다만 시드 2000 에서 점유율 승리 10 → 7).
수치 후보(사용자 선택): 최소 교전 시간 5 / **10** / 15초, A3 적용 여부.

### 25.3 (b) 띠 모양 영토 — 후보 비교

| 후보 | 종류 | 시드 | 덩어리 (끝) | 둘레/칸 (끝) | 고립지 % (끝) | 구멍 칸 (끝) | unreachable/판 | 종료 평균 (최소~최대) | 점유율 승리 | 1위 @20 / @25 / @30 | 탈락/판 | 기지 함락/판 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 기준선 (깊은 앵커 4~20칸) | — | 1000 | 9.69 | 0.557 | 15.3 | 290 | 31.2 | 29.6 (27.6~32.0) | 7/10 | 23.0 / 26.1 / 22.6 (n=4) | 0.5 | 9.7 |
| 기준선 | — | 2000 | 10.40 | 0.563 | 15.6 | 330 | 33.4 | 29.2 (27.7~30.5) | 10/10 | 20.6 / 25.8 / 24.2 (n=2) | 0.6 | 11.9 |
| B1 깊은 앵커 상한 20 → **10** (`BOT_DEEP_MAX`) | 봇 | 1000 | 6.79 | 0.381 | 7.3 | 176 | 12.6 | 29.8 (26.5~32.0) | 9/10 | 22.7 / 24.7 / 23.0 (n=2) | 0.8 | 13.8 |
| 〃 | 봇 | 2000 | 7.09 | 0.396 | 8.5 | 217 | 16.8 | 30.0 (26.4~32.0) | 6/10 | 20.8 / 24.4 / 21.9 (n=4) | 0.5 | 13.3 |
| B2 깊은 앵커 상한 20 → **6** | 봇 | 1000 | 5.33 | 0.312 | 5.0 | 137 | 9.4 | 29.7 (25.0~32.0) | 7/10 | 24.0 / 26.2 / 23.4 (n=5) | 1.4 | 12.9 |
| 〃 | 봇 | 2000 | 4.97 | 0.316 | 5.1 | 103 | 10.4 | 28.5 (26.6~30.0) | 10/10 | 23.9 / 28.1 / - (n=0) | 0.8 | 11.5 |
| B3 **국경 정리** — 내 땅에 완전히 둘러싸인 남의 땅·중립 덩어리(≤ 60칸)의 국경 칸을 공격 후보로 따로 넣고 점수 ×3 | 봇 | 1000 | 6.63 | 0.391 | 9.5 | 91 | 29.9 | 28.8 (26.4~31.1) | 10/10 | 25.7 / 28.0 / 23.7 (n=2) | 0.3 | 6.9 |
| 〃 | 봇 | 2000 | 7.20 | 0.421 | 10.7 | 117 | 32.8 | 29.0 (26.7~32.0) | 8/10 | 24.0 / 27.0 / 20.7 (n=2) | 0.4 | 6.0 |
| B4 **노선 옆 적 땅 벌점** — 깊은 앵커 끝점 점수 = 2 × min(내 땅까지 거리, 깊이) − (노선 칸마다 적 플레이어 땅 이웃 수의 합) | 봇 | 1000 | 2.62 | 0.205 | 2.5 | 87 | 5.9 | 28.7 (27.1~30.3) | 10/10 | 24.5 / 27.8 / 24.9 (n=1) | 1.4 | 16.5 |
| 〃 | 봇 | 2000 | 2.83 | 0.228 | 3.2 | 72 | 6.0 | 29.4 (27.2~32.0) | 9/10 | 23.2 / 26.1 / 23.5 (n=3) | 1.2 | 13.5 |
| B5 **둘러싸인 칸 자동 편입 (territorial.io 식)** — 5초마다, 한 플레이어 땅(+ 물·지도 끝)에 완전히 둘러싸인 덩어리(≤ 400칸, 기지 없음)를 그 플레이어 땅으로 | **규칙 변경** | 1000 | 5.86 | 0.405 | 12.4 | 3 | 23.3 | 28.5 (26.9~30.3) | 10/10 | 26.5 / 28.7 / 23.5 (n=1) | 0.4 | 10.8 |
| 〃 | **규칙 변경** | 2000 | 4.05 | 0.350 | 8.5 | 1 | 31.5 | **27.9** (25.9~30.6) | 10/10 | 25.4 / **30.1** / 24.7 (n=1) | 0.3 | 8.3 |
| B6 = B4 + B3 | 봇 | 1000 | **1.58** | **0.143** | **0.8** | 12 | **3.2** | 29.0 (26.9~32.0) | 9/10 | 24.3 / 28.0 / 22.6 (n=2) | 0.9 | 12.5 |
| 〃 | 봇 | 2000 | **1.75** | **0.158** | **1.0** | 16 | **4.5** | 29.7 (27.2~32.0) | 8/10 | 23.2 / 25.8 / 23.3 (n=4) | 1.1 | 13.2 |
| B7 = B4 + B1 | 봇 | 1000 | 2.99 | 0.225 | 2.6 | 90 | 4.9 | 29.9 (25.2~32.0) | 6/10 | 20.9 / 25.0 / 23.5 (n=5) | 0.7 | 17.3 |

- B5 는 판당 약 2,600칸(육지의 ≈ 48%에 해당하는 누적 이동)을 자동 편입한다. 1위 점유율 @25 가 +2.6~4.3%p 오르고 판이 1.1~1.3분 짧아진다. **§24 판 길이 보정과 겹치는 규칙 변경**이며 사람 플레이의 감각(포위하면 먹힌다)도 바뀐다. 구멍은 없어지지만 띠 자체(덩어리 4~6, 둘레 0.35~0.41)는 남는다. 띠를 만드는 쪽은 봇 노선이기 때문이다.
- 깊이만 줄이는 안(B1·B2)은 단순하지만 조각남이 기준선의 절반~1/3 에 그친다. B2(6칸)는 탈락 1.4·판 길이 25.0~32 로 판마다 차이가 커졌다.
- B3(국경 정리) 단독은 구멍 칸을 −65% 줄이지만 띠(덩어리·둘레)와 `unreachable` 은 거의 그대로다. 띠는 새로 생기는 노선 때문이다.
- **B4(노선 벌점)가 핵심 레버다.** 덩어리 9.7 → 2.6~2.8, 둘레 0.56 → 0.21~0.23, `unreachable` 31 → 6. 판 길이·승리 비율은 기준선 대역이고, 전선이 단단해진 만큼 탈락(0.5 → 1.2~1.4)·기지 함락이 늘었다. 탈락 0 문제(review 2)에는 좋은 방향이다. B3 을 더하면(B6) 남은 구멍까지 정리돼 거의 한 덩어리가 된다.

**추천 (b)**: **B6 — B4(노선 옆 적 땅 벌점) + B3(국경 정리), 둘 다 봇만**. 조각남 지표 4개가 모두 기준선의 1/4 이하이고(덩어리 1.6~1.75, 고립지 ≈ 1%), `unreachable` IDLE 이 31 → 3~4.5/판으로 줄어 review 문제 7 도 함께 풀린다. 종료 29.0~29.7분, 점유율 승리 9/10·8/10 으로 판 길이는 그대로다. 규칙 변경(B5)은 권하지 않는다. 판 길이·승리 감각을 함께 바꾸고, 봇 수정만으로 조각남이 더 많이 줄기 때문이다. 사람 플레이에서 포위 편입을 원한다면 별도 디자인 결정으로 묻는다.
수치 후보(사용자 선택): 벌점 가중(이웃 1칸당 −1, 기본), 국경 정리 덩어리 상한 60칸·점수 ×3, 깊은 앵커 상한 20 유지(B4 와 같이 쓰면 상한 축소 B7 은 이득이 없다 — 점유율 승리 6/10).

### 25.4 (a)+(b) 함께 — 참고

A2(10초) + B4 + B3, 봇만:

| 시드 | 무리 중간값 / p90 | 패주/판 | 덩어리 / 둘레 / 고립지 % / 구멍 | unreachable | 종료 (최소~최대) | 점유율 승리 | 1위 @20 / @25 / @30 | 탈락 |
|---|---|---|---|---|---|---|---|---|
| 1000 | 11.4 / 19.6 | 206 | 1.73 / 0.159 / 0.6 / 10 | 4.6 | 29.3 (28.1~30.5) | 10/10 | 23.8 / 26.2 / 24.6 (n=1) | 0.8 |
| 2000 | 11.4 / 20.8 | 205 | 1.76 / 0.154 / 0.6 / 9 | 5.1 | 30.0 (27.8~32.0) | 7/10 | 22.8 / 25.0 / 22.7 (n=3) | 1.0 |

두 대책은 서로 간섭하지 않는다(각자 단독 효과가 거의 그대로 합쳐진다). 시드 2000 의 점유율 승리 7/10 은 A2 단독의 7/10 과 같다. A3(규칙)을 더하면 A5 처럼 9/10 이 될 것으로 보이지만 이 조합은 측정하지 않았다.

### 25.5 코드 상태

- 변경 없음. 측정용 훅(`bot.ts`: 후퇴 기준·최소 교전 시간·깊은 앵커 상한·국경 정리·노선 벌점 / `combat.ts`: 이탈 대기 접촉 유지·작은 편 L)과 측정 스크립트는 모두 제거했다. 고르면 그 후보만 정식 상수·테스트와 함께 넣는다.
- **GDD 반영 필요(game-designer, 사용자 선택 후)**: A3·A4·B5 를 고르면 GDD 4.15(전투)·2.5(영토) 규칙 변경이다. A2·B3·B4 는 GDD 8.6.0(후퇴)·8.3/8.7(앵커) 봇 절이다. B-24 관측 (b)(d) 에 25.1 진단을 기록한다.

## 26. 방 카드 · 대상 이모트 데이터 (프론트 영향 — 2026-10-18, 사용자 승인)

근거: GDD v4.5 UI 2026-10-18 ⑦ 로비 공개 방 = 맵 썸네일 카드(인원·남은 시간·크기·난이도), ⑥ 플레이어 정보 카드 이모지. 「추가로 진행할 작업」의 방 카드·이모지 데이터.
**추가만 — 기존 필드 의미 변경 없음.** `PROTOCOL_VERSION` 1 그대로.

### 26.1 `room_list.rooms[].botDifficulty`

- `"EASY" | "NORMAL" | "HARD"` — 그 방 설정(`room_state.settings.botDifficulty`)과 같다. 모든 방, 모든 단계에 **항상** 싣는다. 공개 방은 `NORMAL` 이다.
- 타입 `RoomListing.botDifficulty?`. 옵셔널은 기존 클라이언트 테스트 픽스처 호환용이다(§23 `allyBreaks` 와 같은 관례).

### 26.2 `room_list.rooms[].thumbnail` — 무작위 맵 축소 지형

결정: **서버가 작은 지형 썸네일을 보낸다**(시드 + 크기·물 설정을 보내 클라이언트가 재생성하는 방식은 쓰지 않는다). 이유:
1. 맵 생성기는 `server/src/map/generate.ts`(약 550줄)에 있고 `shared` 에 없다. `client/src/render/mapPreview.ts` 가 재사용할 수 없다.
2. 무작위 맵은 인원 N 과 불변식 재시도(시드+k)에 따라 달라진다.
3. 매치 시드는 카운트다운 시작 때에야 뽑힌다(§23). 대기 중 방에는 아직 맵이 없다.

- **언제 실리나**: 무작위 맵 방이고 맵이 만들어진 뒤(`IN_GAME`·`GAME_OVER`)에만 객체가 실린다. 이때는 실제 그 판의 맵이다.
  - `LOBBY`·`COUNTDOWN`(맵 생성 전)과 **공식 맵 방**(이미 `map_catalog`/`welcome.officialMaps` 미리보기가 있다)은 `null` 이다.
  - 필드는 항상 실린다(`null` 포함). 클라이언트는 `null` 이면 지금처럼 공식 맵 미리보기나 "무작위" 분위기 그림(`drawRandomPreview`)을 쓴다.
- 형식 `MapThumbnail`:

| 필드 | 의미 |
|---|---|
| `scale` | 블록 한 변(원본 칸 수) = `ceil(max(width / 50, height / 30))`. S 72×42 → 2, M 100×60 → 2, L 108×66 → 3 |
| `width` / `height` | 축소 격자 = `ceil(원본 / scale)`. S 36×21, M 50×30, L 36×22 (항상 ≤ 50×30) |
| `terrain` | 축소 지형 RLE `[값, 길이, …]`(map_init.terrain 과 같은 shared `rleDecode`, 길이 합 = width × height). 값 = TERRAIN 코드, **블록 안 최빈값(동률은 작은 코드)**. 행 우선(y × width + x) |
| `bases` | 기지(수도 포함)가 들어 있는 축소 칸 index, 오름차순·중복 없음. 소유자·수도 구분은 싣지 않는다(정적 그림) |

- 크기: JSON 기준 S ≈ 1.1KB, M ≈ 2.2KB, L ≈ 1.6KB(시드 20개 평균). 진행 중인 무작위 맵 방에만 붙는다. 최악(50개 전부 M 진행 중)이어도 `room_list` 한 번에 ≈ 110KB 다. 방마다 판당 1회 계산해 캐시한다.
- 그리기: 축소 칸 하나 = 원본 `scale × scale` 칸. 클라이언트는 `createTopologyView('square', width, height)` + 기존 `drawTerrain` 경로에 `rleDecode(terrain, width*height)` 를 넘기면 된다.

```json
{ "roomId": "r7", "phase": "IN_GAME", "map": { "kind": "random", "size": "M", "water": { "waterMode": "BORDER_ONLY", "shallowPermille": 1000 } }, "mapName": null,
  "width": 100, "height": 60, "humans": 1, "bots": 9, "maxPlayers": 10, "spectatorCount": 0, "elapsedMs": 98000, "autoStartMs": null,
  "joinable": false, "spectatable": true, "botDifficulty": "NORMAL",
  "thumbnail": { "width": 50, "height": 30, "scale": 2, "terrain": [0, 52, 1, 3, 2, 1, "…"], "bases": [212, 340, 615, "…"] } }
```

### 26.3 대상 이모트 — `emote.targetPlayerId?` → `emote_broadcast.targetPlayerId?`

- C2S `emote` 에 선택 필드 `targetPlayerId`.
  - 형식: 1..12 정수. 그 밖의 값은 `error BAD_MESSAGE` 다. `null`·생략은 대상 없음.
  - 서버 판정:
    - 그 판의 플레이어(탈락자 포함)이고 보낸 사람 자신이 아니면 유효하다.
    - 판에 없는 자리, 자기 자신은 **이모트 전체를 조용히 무시**한다(기존 코드 범위 위반과 같은 처리). 이때 1초 제한도 소모하지 않는다.
- 제한: 기존 그대로 **세션당 1초 1회**다. 대상 유무와 상관없이 하나의 제한을 공유한다. `IN_GAME` 멤버만 가능하고 관전자는 보낼 수 없다.
- S2C `emote_broadcast` 는 기존처럼 **전원**에게 간다(관전자 포함). 대상이 있을 때만 `targetPlayerId` 가 실리고, 대상 없는 이모트에는 필드가 없다. 클라이언트는 이 필드로 "P1 → P4: 👍" 처럼 그 플레이어를 향한 표시를 한다.

```json
{ "type": "emote", "code": 7, "targetPlayerId": 3 }
{ "type": "emote_broadcast", "tick": 812, "playerId": 1, "code": 7, "targetPlayerId": 3 }
{ "type": "emote_broadcast", "tick": 830, "playerId": 2, "code": 4 }
```

### 26.4 프론트 할 일 (frontend-game-client-engineer)

1. `client/src/ui/roomCards.ts`: `botDifficulty` 를 캐스트 없이 `r.botDifficulty` 로 읽는다. 주석 "RoomListing 에 없어" 갱신. 난이도 표시는 이제 항상 나온다.
2. `client/src/ui/Lobby.tsx` + `render/mapPreview.ts`: `r.thumbnail` 이 있으면 실제 축소 지형(+ `bases` 점)을 그린다. `null` 이면 지금처럼 공식 맵 미리보기 / `drawRandomPreview` 를 쓴다(대기 중 무작위 맵 = "무작위" 표시 유지).
3. 이모트 송신(`store.ts` emote, 원형 메뉴·플레이어 정보 카드): 상대를 고른 맥락이면 `targetPlayerId` 를 싣는다.
4. 수신(`gameModel.ts`·`feed.ts`·`renderer.ts` 이모트 표시): `targetPlayerId` 가 있으면 대상 표시("→ 대상 이름", 대상 영토 위 표시 등)를 한다. 없으면 기존 표시다.
- 지금 클라이언트는 새 필드를 무시하므로 **깨지는 것은 없다**(typecheck 통과, 클라이언트 코드 수정 없음).

### 26.5 서버 코드 · 검증

- `shared/src/protocol.ts`: `RoomListing.botDifficulty?`·`thumbnail?`, `MapThumbnail`(신규), `C2S_Emote.targetPlayerId?`, `S2C_EmoteBroadcast.targetPlayerId?`.
- `server/src/map/thumbnail.ts`(신규): `buildThumbnail(map, maxW = 50, maxH = 30)`.
- `server/src/room/room.ts`:
  - `listing()` 에 `botDifficulty`·`thumbnail` 추가.
  - `thumbnail()` 은 무작위 맵 + `sim` 이 있을 때만 만든다(맵 객체 기준 캐시).
  - `emote(session, code, targetPlayerId?)`.
- `server/src/net/validate.ts`: emote `targetPlayerId` 형식(1..`MAX_PLAYERS`). `server/src/net/server.ts`: 전달.
- 스크립트:
  - `qa-schema.ts`: `room_list` 에 `botDifficulty` enum 필수, `thumbnail` 은 `null` 또는 객체(크기 ≤ 50×30, RLE 길이 합, bases 범위·오름차순). `emote_broadcast` 에 `targetPlayerId?`.
  - `qa-ws.ts`: 대기 방 `botDifficulty`/`thumbnail null`, 대상 없는 브로드캐스트에 필드 없음, 자기·없는 자리 무시 + 유효 대상 1회 + 1초 제한, `targetPlayerId: 0` → `BAD_MESSAGE`.
- 테스트 `server/test/v47.test.ts`(신규, 6건): 크기 등급별 축소 격자·RLE 길이, 최빈값 동률·기지 index·결정론, 대기/카운트다운 null → 진행 중 실제 맵 썸네일(캐시 동일), 공식 맵 null·공개 방 NORMAL, emote 형식 검증, 대상 이모트 브로드캐스트·무시·rate limit·필드 없음.
- 결과(2026-10-18):
  - `npm run typecheck` 통과
  - `npm test` 29 파일 414 테스트 통과
  - `npm run smoke` PASSED
  - `qa:ws` 82/82
  - `qa:headless` 스키마 위반·순서 위반·재구성 불일치 0
