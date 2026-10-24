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
| `cmd_flag_retarget` | `NO_FLAG`(없음·남의 깃발) → `ROUTED` → `RETURNING`(**v4.2: 귀환 중이면 전투 중이어도 항상 거절** — QA I-2 수락 경로 폐기 [A-62]) → `LOCKED`(재지정 경직 15 tick 중 — **이탈 대기 중이면 허용**) → `BAD_REQUEST` → `WATER` → `ALLIED` → `OUT_OF_RANGE` | 앵커 교체, 기본 태세 재파생 — **v4.4 (§21.2): 태세 = 도착지(내 땅·내 기지 = DEFEND, 적·중립 = ATTACK). **v4.6 (§27): 쿨타임이 안 돌면 즉시 바꾸고(전투 중 포함), 쿨타임 중이면 이동만 하고 태세는 그대로(`postureHeld:true`) — 대기·자동 적용 폐기**. 내 기지 칸도 "그 기지 위로 가서 방어"(회수 아님)**, `postureManual=false`, `state=MARCHING`, `lockUntilTick = t+15`, 진척도·예산 0. **전투 중이면 이탈 대기 15 tick 개시**. → `flag_retargeted` (+태세가 바뀌면 `flag_posture_changed auto:true`, +전투 중이면 `flag_disengage_started`) |
| `cmd_flag_recall` | `NO_FLAG` → `ROUTED` → `RETURNING`(**v4.2: 귀환 중이면 항상 거절**, [A-62]) → (**v4.2** `baseTileId` 지정 시) `NOT_BASE`(기지 칸 아님·범위 밖) → `NOT_OWNED_BASE`(내 기지 아님) | `state=RETURNING`, `returnBaseTileId = baseTileId ?? null`, 귀환지 = recallTarget(지정 기지 우선). 깃발은 **실제로 걸어서** 귀환지까지 간다(속도 ×1.5, ZOC 무시). 도착 시 잔여 × 85% 풀 환급. **전투 중(비귀환)이면 이탈 대기**. → `flag_recalled` (+`flag_disengage_started{auto:false}`) |
| `cmd_set_posture` | `NO_FLAG` → `ROUTED` → `RETURNING`(**v4.2 추가** [A-62]) → `SAME_POSTURE` → `POSTURE_COOLDOWN`(`tick < postureCooldownUntilTick`) (**v4.6 (§27): `DISENGAGING`·`IN_COMBAT` 거절 폐기 — 전투 중에도 수락, 이탈 대기 부과**) | 즉시 적용(같은 tick 4a 가 새 태세로 교전 판정), 쿨타임 `t + 25`, 진척도·예산·정체 리셋, `targetOwnerId` 재계산 = `owners[anchor] == 소유자 ? 254 : owners[anchor]`(1단계 처리 시점), `postureManual=true`. → `flag_posture_changed auto:false`(결과 `targetOwnerId` 포함) |

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
| `pacingNote` | `"guaranteed"`(무작위·M·기본 물·10인·NORMAL) / `"estimate:<분>"` / `"timeout_likely"`(추정 > 32분). 추정 = `29.4 × (P/540)^0.75` (기준 540 = `PACING_P_REF_LAND_PER_PLAYER`, v4.5 [A-110]; 구 390), P = 육지/인원(무작위는 `floor(W×H×TARGET_LAND_RATIO_PERMILLE/1000)` = `floor(W×H×0.9)`, 프리셋은 파일 육지 수) — **GDD 2.8(e) 참고값, 보증 아님**. 클라이언트는 `recommended` 밖이면 경고 표시 |

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
- **v4.4 추가 (§21)**: `bases[].prodPm`(기지 생산력 ‰), ~~`flags[].pendingPosture`(0|1|null)~~ (**v4.6 (§27) 제거**), 최상위 `production: PlayerProduction[]`(플레이어별 생산 지역 내역).

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
    `bits` (`shared` 의 `FLAG_BIT`): `IN_COMBAT 1 | ROUTED 2 | BLOCKED 4 | DISENGAGING 8 | BREAKAWAY 16 | STALLED 32 | HALTED 64`(**v4.2 추가**) | ~~`POSTURE_PENDING 128`~~(v4.4 추가 → **v4.6 (§27) 제거**, 비트 128 은 더 이상 보내지 않는다) — 값 범위 0..127.
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
| `player_eliminated` | `{ "type":"player_eliminated","tick":3000,"playerId":4,"byPlayerId":2,"annexedTiles":312 }` | **v4.4 (§21)**: 기지(수도 포함)를 모두 잃은 tick(12단계 — 그 tick 의 `base_captured` 뒤). `byPlayerId` = 마지막 기지를 점령해 **남은 땅 전부를 합병한** 플레이어(없으면 null → 땅은 중립). `annexedTiles`(추가) = 넘어간 칸 수, 칸 변경은 같은 tick `snapshot_delta.tileChanges`. **§31 (2026-10-23, 추가만)**: `bountyTroops`·`bountyGold` = `byPlayerId` 가 받은 정리 보상(병력·골드, 정수). 서버는 항상 싣는다, `byPlayerId:null` 이면 0 |
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
| `flag_disengaged` | `{"type":"flag_disengaged","tick":17,"flagId":2,"reason":"broke_away"}` | `broke_away`(대기 완료 → breakaway) / `combat_over`(대기 중 무리 소멸) / **`wait_over`(v4.6 §27: 태세 전환 이탈 대기가 끝났으나 제자리 깃발이라 전투에 남음)** |
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
109. **[A-90] 재지정 태세 대기(`pendingPosture`) — v4.6 (§27) 에서 폐기됨**: 사용자 결정 "태세는 도착지로" 를 쿨타임·전투 중에도 지키기 위해, 즉시 못 바꾸면 미뤘다가 자동 적용. 전투 중 즉시 전환을 허용하지 않은 이유: 공격 태세로 싸우다 내 땅으로 재지정하면 방어↔방어가 되어 **이탈 대기(3초, ×0.5) 없이 전투가 끊기는 탈출구**가 생긴다. 직렬화는 full 필드 + 델타 비트 128(대기 태세는 항상 현재의 반대라 1비트로 충분 — `flagFlags` 튜플 모양 유지). 적용 시 ENGAGED·IDLE 깃발은 MARCHING 으로 돌려 같은 tick settle 이 새 태세로 다시 판정(공격 태세로 바뀐 방어 주둔 깃발이 엉뚱한 칸에서 밀지 않게). `postureManual = false`.
110. **[A-91] 멸망·합병 세부**: 합병 대상 = `lastBaseLostTo`(그 플레이어 기지를 마지막으로 가져간 플레이어 — `setTileOwner` 가 기지 칸 소유 변경 때 기록, 없으면 `lastLostTo`). 같은 tick 연쇄는 playerId ASC 처리 + `conqueredBy` 추적(합병 대상이 이미 멸망 → 그를 멸망시킨 쪽, 끝내 없으면 중립). 풀 병력·골드·테크·유지 중 동맹은 넘기지 않는다(소멸 — 회계 `eliminated`). 대량 칸 이전은 `setTileOwner` 경유 → 같은 tick 델타 `tileChanges`(별도 full 강제 송신 없음 — 최악 수천 쌍 × 1회). `player_eliminated` 에 `annexedTiles` 추가.
111. **봇 기지 수비 (§11, 사용자 "적당히")**: `guardBases` — 결정당 1회, `defend`(요격)보다 먼저. 대상 = **마지막 기지**(적대 공격 깃발이 `BOT_LAST_BASE_GUARD_RADIUS` 8 안) **+ 마지막이 아닌 기지는 최근 `BOT_BASE_GUARD_DAMAGE_WINDOW` 25 tick 안에 체력이 깎인 것**(`BOT_BASE_GUARD_RADIUS` 4 안 위협). 우선순위 = 위협 실효력 합 큰 순. 이미 기지 위(또는 가는 중) 수비대 실효력 ≥ 위협 × `BOT_INTERCEPT_RATIO`(1.25) 면 건너뜀. 수단 ① 창병 발령(앵커 = 기지 → 출발도 그 기지라 즉시 자리), 필요 병력 = 위협 × 1.25 ÷ 기지 위 창 방어값(1950), 최소 풀 40% — **마지막 기지는 필요량에 못 미쳐도 가진 만큼** ② 슬롯·병력이 없고 마지막 기지면 가장 가까운 비전투 깃발을 기지로 재지정(→ DEFEND). 수비대는 주둔 반격·제자리 공격 전환을 하지 않고, 위협 없이 `BOT_GARRISON_PATIENCE`(3분)가 지나면 회수, 위협 중엔 슬롯 재활용 대상에서 빠진다. **범위 선택 근거 = 자가대전 비교(§9 v4.4)**: 위협받는 기지 전부를 지키면 기지 함락이 33.0 → 14.4/판으로 반 이하, 마지막 기지만 지키면 26.0 이지만 일반 기지 방어를 전혀 안 쓴다 → 중간("공격받는 기지")을 골랐다(20.5/판, 탈락 1.2/판). 봇 기지 공격 점수(마지막 기지 가산 등)는 **바꾸지 않았다**.
112. **[A-92] 지명**: 풀 120개(고유어풍 80 + 판타지풍 40, 한글 2~3음절)를 서버에 두고, **룸 시드**(무작위 맵 = 맵 시드 / 프리셋 맵 = 룸이 뽑은 시드 — 봇 성향 시드와 같은 값)로 Mulberry32 Fisher–Yates 셔플 → 기지 tileId 순서로 배정. 프리셋 맵에 맵 시드(파일 `origin.seed`, 없으면 0)를 쓰면 공식 맵마다 이름이 늘 같아져서 룸 시드를 골랐다. 풀보다 기지가 많으면(현 상한 24 라 발생 안 함) `"이름 2"` 접미사로 고유성 유지. 전송 = `map_init.baseNames`(bases 와 평행 배열).
113. **`production` 직렬화**: 단위 milli/초(=milli/tick × 5) 정수, 델타는 5 tick 마다 바뀐 플레이어만 통째(지역 수가 적어 부분 갱신보다 단순), full 은 전원. 기지 생산력 델타 `baseProd` 는 `baseHp` 와 같은 5 tick 주기·변경분만. 새 필드는 TS 상 optional(구 클라이언트 리터럴 호환, v4.2 `halted` 와 같은 처리) — 서버는 항상 싣는다.

### v4.5 (사용자 결정 2026-10-15)에서 정한 것 — **에이전트 선택 [A]** (상세·근거는 §22.9)

114. **[A-102]** 호수 생성기(반해상도 CA) · 물 창 8.5~11.5%(생성 단계 기준, 최종 맵은 8.4% 대 가능 — §22.1) · 섬은 물로 메워 육지 한 덩어리
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
| **snapshot_delta 추가** | `flagFlags` 비트 `HALTED = 64`(당시 값 범위 0..127 — v4.4 에서 `POSTURE_PENDING 128` 이 추가돼 현재는 0..255). 새 배열 `flagReturnBase: [flagId, baseTileId \| null][]`(항상 존재, 바뀐 깃발만) |
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
- 클라이언트가 전투·ZOC 를 미리 그리거나 예측한다면 같은 판정(사각 = `|Δrow| ≤ 1 ∧ |Δcol| ≤ 1`)으로 바꿔야 한다. **정정(QA v4.5 m-2)**: 클라이언트는 이미 같은 8방향 판정을 쓴다 — `client/src/render/combatPairs.ts` + `client/src/render/topology.ts` `touching()`(좌표식은 서버와 동일). 당시의 "클라이언트 코드에는 이 판정이 없다"는 서술은 사실이 아니다(전투·차단 상태는 서버 `inCombat`·`blocked` 비트를 그대로 그린다). 교전 연결선·검/방패 아이콘(같은 날 사용자 결정)은 프론트 작업.
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
> **v4.6 (§27) 정정**: 아래 두 불릿(대기 태세 `pendingPosture`·비트 128)은 폐기됐다. 현행 규칙은 §27.
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

> **v4.5 정정(QA m-3)**: 아래 `production` 형식의 `regions` 는 **v4.5 에서 `rows` 로 바뀌었고 행 의미도 달라졌다**(생산 지역 폐기) — 현행 형식은 **§22.5** 를 따를 것. 이 절의 `regions` 예시·"기타" 지역 서술은 v4.4 당시 기록이다. `flagFlags` 비트 값 범위는 `POSTURE_PENDING 128` 포함 **0..255**.

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
| ~~`FLAG_BIT.POSTURE_PENDING`~~ | ~~128~~ | v4.6 (§27) 제거 |

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
- **생성기 [A-102]**: 반해상도(⌈W/2⌉×⌈H/2⌉) 호수 노이즈 460‰ → CA 3회(물 이웃 ≥ 5) → 2배 확대 → 전해상도 다듬기 2회 → 테두리 = 물 → **최대 4-연결 육지 덩어리만 남김**(섬은 물) → 육지 비율이 **885~915‰** 밖이면 p ± 10‰ 로 다시(최대 12회). **이 창은 "생성 단계"의 판정 기준이다** — 창을 재는 시점과 최종 맵(섬을 물로 메운 뒤) 사이에 차이가 있어, 최종 맵의 물 비율은 8.5% 아래로 약간 내려갈 수 있다(무작위 420맵 중 10맵이 8.42~8.47%, 공식 `official-m-01` 8.4%; 반대쪽은 11.49% 까지 정상). 규칙·밸런스 영향은 0.1%p 미만이라 코드·맵은 그대로 둔다(QA v4.5 m-8). "물 8.5~11.5%"는 보장 범위가 아니라 생성 창이다. 결과 = M 기준 물 평균 9.9%(테두리 5.3% 포함), 호수 7~8개(최대 ~100칸). 육지 연결은 생성 불변식 I1·I4 가 보장(실패 시 시드+1).
- 상수: `TARGET_LAND_RATIO_PERMILLE` 650 → **900**, `LAND_RATIO_MIN/MAX_PERMILLE` 600/700 → **885/915**, `CA_INIT_LAND_P_PERMILLE` 550 → 540, `CA_LAND_P_STEP_PERMILLE` 20 → 10, `CA_MAX_ATTEMPTS` 10 → 12, `CA_SMOOTH_STEPS` 4 → 3.
- **육지가 약 38% 늘었다**(M 6000칸: 육지 ≈3900 → ≈5400, 10인 1인당 390 → 540). 판 길이 추정식(`pacingNote`)의 기준 1인당 육지도 390 → 540 으로 옮겼다 [A-110] — 클라이언트 미리보기(`client/src/ui/pacing.ts`)도 같은 상수 `PACING_P_REF_LAND_PER_PLAYER` 를 쓴다.
- **공식 프리셋 9장 재생성**: `export-map.ts --count 40`(시드 1000~1039) × S/M/L → `eval-maps.cjs`(공정성 점수, 목표 육지 0.90 으로 수정) 상위 3개.

| id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| official-s-01 | 1030 | 2700 | 10.7% | | official-m-01 | 1005 | 5495 | 8.4% | | official-l-01 | 1006 | 6363 | 10.7% |
| official-s-02 | 1025 | 2721 | 10.0% | | official-m-02 | 1003 | 5469 | 8.9% | | official-l-02 | 1024 | 6469 | 9.2% |
| official-s-03 | 1002 | 2733 | 9.6% | | official-m-03 | 1026 | 5451 | 9.2% | | official-l-03 | 1022 | 6350 | 10.9% |

  **(2026-10-22 §30.5 에서 노출도 균등 기준으로 다시 선정해 이 표의 시드·육지·물 값은 대체됨.)**
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
| A-102 | 물 ≈ 10% 생성기 | 반해상도 호수 CA + 다듬기, 물 창 8.5~11.5%(테두리 포함, 생성 단계 기준 — 최종 맵은 8.4% 대까지 가능, §22.1), 섬은 물로 메워 육지 한 덩어리, 테두리 DEEP·안쪽 호수 SHALLOW(색 구분만) | 전해상도 CA 는 10% 에서 작은 웅덩이 30개가 생긴다. 반해상도면 큰 호수 7~8개 — 지형 장애물 역할. 섬(통행 불가라 도달 불가)을 남기면 "육지 연결" 보장이 깨진다 |
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
- **참고(QA v4.5 정보 항목)**: `flag_idle.reason` 은 이벤트에만 있고 `snapshot_full.flags[]` 에는 없다. 재접속한 클라이언트는 "막혀서 멈춘 깃발(`unreachable` 등)"과 평범한 IDLE 깃발을 구분할 수 없다(IDLE 상태만 보인다). 필요하면 추후 필드 추가를 검토.
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

**결정 (b): B2 — 깊은 앵커 상한 20 → 6 채택 (사용자 2026-10-18).** 봇만 바뀐다(규칙·프로토콜 변경 없음, 프론트 영향 없음). 추천안 B6 대신 가장 단순한 깊이 축소를 골랐다.
- 코드: `server/src/game/bot.ts` `BOT_DEEP_MAX` 20 → 6. `BOT_DEEP_MIN` 4 는 그대로다(깊이 = clamp(floor(병력 / (3 × cost)), 4, 6) — 하한 4 < 상한 6 이라 clamp 가 성립하고, 노선이 국경 칸에서 최소 4걸음은 들어간다). `scoreAnchor` 의 yield 상한(3 × depth)도 같은 `plowDepth` 를 쓰므로 함께 60 → 18칸으로 줄어든다(측정에도 포함된 동작).
- 테스트: `server/test/bot.test.ts` 에 상수 고정 테스트(4 / 6) 추가. 기존 "노선 끝점이 수도에서 6칸 이상" 테스트는 그대로 통과한다.
- 확인 (시드 1000, M, 10인 NORMAL, 10판 — `npm run selfplay -w @civwar/server -- 10 1000 M 10` + 같은 시드 조각 집계): 덩어리 5.33, `unreachable` IDLE 9.4/판(전부 방어 태세), 고립지 5.0%, 종료 29.72분(25.05~32.0), 점유율 승리 7/10, 1위 @20/@25 24.0/26.2%, 탈락 1.4/판, 기지 함락 12.9/판 — 위 B2 행과 같다. typecheck·`npm test`(415)·smoke 통과.
- 알려진 한계(위 관찰 그대로): 조각남은 기준선의 약 절반(9.7 → 5.3)에 그치고, 판 길이 폭이 25.0~32분으로 넓다(시드 1002 가 25.0분 — §24 "24분 이전 거의 없음" 경계 안).
- GDD 반영 필요(game-designer): GDD 8.3 [A-65] 깊이 clamp 상한 20 → 6.

### 25.4 (a)+(b) 함께 — 참고

A2(10초) + B4 + B3, 봇만:

| 시드 | 무리 중간값 / p90 | 패주/판 | 덩어리 / 둘레 / 고립지 % / 구멍 | unreachable | 종료 (최소~최대) | 점유율 승리 | 1위 @20 / @25 / @30 | 탈락 |
|---|---|---|---|---|---|---|---|---|
| 1000 | 11.4 / 19.6 | 206 | 1.73 / 0.159 / 0.6 / 10 | 4.6 | 29.3 (28.1~30.5) | 10/10 | 23.8 / 26.2 / 24.6 (n=1) | 0.8 |
| 2000 | 11.4 / 20.8 | 205 | 1.76 / 0.154 / 0.6 / 9 | 5.1 | 30.0 (27.8~32.0) | 7/10 | 22.8 / 25.0 / 22.7 (n=3) | 1.0 |

두 대책은 서로 간섭하지 않는다(각자 단독 효과가 거의 그대로 합쳐진다). 시드 2000 의 점유율 승리 7/10 은 A2 단독의 7/10 과 같다. A3(규칙)을 더하면 A5 처럼 9/10 이 될 것으로 보이지만 이 조합은 측정하지 않았다.

### 25.5 코드 상태

- 2026-10-18 (b) B2 채택으로 `BOT_DEEP_MAX` 20 → 6 만 정식 반영(25.3 결정 참고).
- (측정 당시) 변경 없음. 측정용 훅(`bot.ts`: 후퇴 기준·최소 교전 시간·깊은 앵커 상한·국경 정리·노선 벌점 / `combat.ts`: 이탈 대기 접촉 유지·작은 편 L)과 측정 스크립트는 모두 제거했다. 고르면 그 후보만 정식 상수·테스트와 함께 넣는다.
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

---

## 27. 태세 전환 즉시 적용 (프론트 영향 있음, 호환 깨짐 — 2026-10-19, 사용자 결정)

근거: `_workspace/BACKLOG.md` 「결정 완료」 2번, `_workspace/00_input/design-decisions.md`. `PROTOCOL_VERSION` 은 1 그대로(클라이언트·서버를 함께 배포).

### 27.1 규칙

태세 쿨타임(`POSTURE_COOLDOWN_TICKS` 25 tick = 5초)의 뜻은 **"같은 깃발이 다시 태세를 바꿀 수 있기까지의 시간"** 이다. "제자리에서 기다리는 시간"이 아니다.

1. **쿨타임이 안 돌면 어떤 상태에서든 즉시 적용**한다. 전투 중도 포함. 적용 직후 쿨타임(5초)이 시작되고, 막는 것은 **다음 전환뿐**이다.
2. **쿨타임 중 새 전환 요청은 거절**한다: `cmd_ack{accepted:false, reason:"POSTURE_COOLDOWN"}`. 대기열·예약 상태는 없다.
3. `cmd_set_posture` 검증 순서: `NO_FLAG` → `ROUTED` → `RETURNING` → `SAME_POSTURE` → `POSTURE_COOLDOWN`. **`DISENGAGING`·`IN_COMBAT` 은 이 명령에서 더 이상 보내지 않는다**(코드 값은 `CmdRejectReason` 에 남아 있으나 쓰임 없음).
4. **전투 중 전환**은 즉시 적용하되 **회수와 같은 이탈 대기**(`DISENGAGE_TICKS` 15 = 3초, 실효값 ×0.5 — MOB-2B 철수 훈련 시 10)를 부과한다. `flag_posture_changed{auto:false}` 와 `flag_disengage_started{auto:false, untilTick}` 가 같은 tick 에 온다(순서: posture_changed → disengage_started). 이미 이탈 대기 중이면 타이머는 그대로다.

### 27.2 제거된 것 (호환 깨짐)

| 제거 | 대체 |
|---|---|
| `snapshot_full.flags[].pendingPosture` | 없음 (대기 상태 자체가 없다) |
| `snapshot_delta.flagFlags` 비트 `POSTURE_PENDING` (128) | 없음. 비트 값 범위는 0..127 로 돌아간다 |
| `FLAG_BIT.POSTURE_PENDING` (shared) | — |
| 서버의 4단계 첫머리 "대기 태세 자동 적용"과 그때의 `flag_posture_changed{auto:true}` | 재지정 순간의 즉시 전환만 `auto:true` |
| `cmd_set_posture` 의 `DISENGAGING`·`IN_COMBAT` 거절 | 전투 중 전환 수락 + 이탈 대기 |

`flag_posture_changed.auto` 는 **유지**한다. `auto:true` = 우클릭 이동(`cmd_flag_retarget`)이 도착지 기본 태세로 자동 전환한 경우, `auto:false` = `cmd_set_posture` 수동 전환.

### 27.3 우클릭 이동(`cmd_flag_retarget`)의 자동 태세

도착지 기본 태세 = 내 땅(내 기지 포함) `DEFEND`, 적·중립 `ATTACK`.

- **쿨타임이 안 돌면** 이동과 함께 즉시 전환(전투 중도). `flag_posture_changed{auto:true}`.
- **쿨타임 중이면 이동은 그대로 수락하고 태세는 바꾸지 않는다.** 대기·나중 적용 없음. 쿨타임이 끝나도 자동 전환되지 않는다.
- 응답에 **실제 태세**가 실린다: `cmd_ack.posture`, `flag_retargeted.posture`. 새 필드 **`postureHeld: boolean`** (`cmd_ack` 는 선택 필드로 `cmd_flag_retarget` 응답에만, `flag_retargeted` 는 항상): `true` = 도착지 기본 태세와 현재 태세가 달라서 적용하고 싶었으나 쿨타임 때문에 못 함. 현재 태세가 이미 도착지 기본값이면 `false`.
- **클라이언트는 `postureHeld === true` 일 때 "태세 전환 쿨타임 중" 안내를 띄워야 한다**(남은 시간 = `postureCooldownUntilTick - tick`). 도착지 표시·미리보기는 서버 태세(`posture`)를 따른다.
- 전투 중 재지정은 종전처럼 이탈 대기를 부과하고(3초 ×0.5), 태세가 바뀌면 아래 27.4 의 간선 유지가 함께 걸린다. 대기가 끝나면 `broke_away`.

### 27.4 [A] 에이전트 결정 (사용자 확인 필요)

- **[A-119] 전환 이탈 대기 동안 전투 간선 유지(`disengageHold`, 서버 내부 상태·직렬화 안 함).** 전투 중 전환(또는 태세가 바뀌는 재지정)이 이탈 대기를 열면, 대기가 끝날 때까지 상대 태세와 무관하게 두 깃발의 전투 간선을 유지한다. 이유: 공격→방어 전환으로 방어↔방어가 되면 간선이 사라져 다음 tick 에 이탈 비용 없이 싸움이 끊긴다(A-90 이 막으려던 탈출구). 간선 유지 덕분에 3초 ×0.5 를 실제로 치르고, 대기가 끝난 뒤에야 끊긴다. 적용 범위는 **태세 전환·태세가 바뀌는 재지정뿐**이다 — §25 A3(귀환 깃발이 방어 깃발과 싸우다 공짜로 빠지는 빈틈)은 **그대로 두었다**.
- **[A-120] 이탈 대기 만료 처리.** (a) 제자리 깃발(`state` ENGAGED·IDLE)의 태세 전환 대기는 만료되어도 **전투에 남는다**(breakaway 없음). 이동하지 않는 깃발이 breakaway 가 되면 영구히 전투 대상에서 빠져 면역이 되기 때문이다. 대신 ×0.5 가 끝나고 새 이벤트 `flag_disengaged{reason:"wait_over"}` 가 온다. (b) 행군 중 깃발·재지정 깃발은 종전처럼 만료 시 `broke_away`. 방어↔방어가 되어 간선이 유지되던 경우는 대기 만료 다음 tick 에 전투가 끝난다(`combat_ended`).
- **[A-121] `flag_disengaged.reason` 에 `"wait_over"` 추가**(`broke_away`·`combat_over` 와 함께 3종). 클라이언트의 이탈 호는 `wait_over` 에서 "빠져나감" 연출 없이 그냥 끝내야 한다.
- **[A-122] `postureHeld` 추가**(`cmd_ack`·`flag_retargeted`) — 클라이언트가 도착지 기본 태세와 비교하지 않고 안내를 띄울 수 있게 한다.
- **[A-123] 전환 요청이 같은 tick 의 `cmd_flag_retarget` 뒤에 오면**(둘 다 같은 tick 1단계) 재지정이 쿨타임을 시작했으므로 거절된다(`POSTURE_COOLDOWN`). 명령 처리 순서는 `recvSeq` 오름차순 그대로.
- **[A-124] 이탈 대기 중이어도 전환 수락**(`DISENGAGING` 거절 폐기). 이미 열린 대기의 타이머는 연장하지 않는다. 귀환(`RETURNING`)·패주(`ROUTED`)는 종전처럼 거절한다.
- **[A-125] 봇.** (a) `isBaseGuard` 에서 `pendingPosture` 참조 제거. (b) 봇 재지정은 "도착지 기본 태세가 지금과 다르고 쿨타임 중"이면 보내지 않고 쿨타임이 끝날 때까지 미룬다(서버가 태세를 못 바꾼 채 이동만 하는 어중간한 깃발을 만들지 않으려는 것). (c) 봇의 `cmd_set_posture` 는 종전처럼 **전투 중에 보내지 않는다**(`canPosture` = 비전투·이탈 대기 아님·쿨타임 경과; 후퇴 규칙이 전투 중 판단을 맡는다). 그래서 봇이 전투 중 전환의 이탈 비용을 치르는 경우는 없고, 반격·굳히기 규칙의 왕복 전환도 늘지 않는다.
- **[A-126] 클라이언트 빌드 유지용 최소 수정**(프론트 에이전트가 정리): `gameModel.ts`·`unitChips.ts` 의 `pendingPosture` 참조 제거(`unitChips` 는 항상 null), 폐기된 클라이언트 테스트(`qaV45.test.ts` 대기 태세, `uiOct14b.test.ts` §21.2) 삭제, `qa-v45-integration.ts` 는 `as any` 캐스트(실행 시 S1 검사는 실패하므로 재작성 필요).

### 27.5 프론트 필요 변경

1. `pendingPosture`·`POSTURE_PENDING` 사용 제거: `GameScreen.tsx`(패널 "태세 전환 대기" 줄, 버튼 보조 문구), `unitChips.ts`(`FlagActionState.pendingPosture`), `store.ts` 주석, `gameModel.ts`.
2. `flagActionState`: 태세 버튼 차단 사유에서 `f.disengaging`("이탈 대기 중")·`f.inCombat`("전투 중")을 **제거**. 남는 것: 패주·귀환·쿨타임("전환 대기 n초"). 전투 중 눌렀을 때 "이탈 대기 3초, 방어력 ×0.5" 경고(툴팁 또는 확인)를 보여주는 것을 권장.
3. 우클릭 이동: `cmd_ack.postureHeld`(또는 `flag_retargeted.postureHeld`)가 `true` 면 "태세 전환 쿨타임 중" 메시지를 띄운다. 이동 미리보기·도착 후 표시 태세는 `posture`(실제) 기준.
4. `flag_disengaged.reason === "wait_over"` 처리: 이탈 호를 조용히 끝낸다(`broke_away` 연출 금지). `flag_disengage_started{auto:false}` 가 `flag_posture_changed` 직후 오면 호의 색·문구는 "태세 전환 중".
5. 델타 `flagFlags` 비트 마스크에서 128 을 쓰던 곳이 있다면 제거.

### 27.6 검증

- `typecheck` 통과, `npm test` 33 파일 454 테스트 통과(신규 `server/test/v48.test.ts` 12: 즉시 전환·쿨타임 거절·쿨타임 시작·전투 중 이탈 대기·간선 유지·wait_over·재지정 postureHeld 2종·전투 중 재지정·스냅숏에 대기 필드 없음·결정론).
- `smoke` PASSED, `qa:ws` 82/82, `qa:scenarios` 87/87(전투 중 전환 시나리오를 SAME_POSTURE 로 변경), `qa:headless` 스키마·순서·재구성 불일치 0.
- 자가대전 10판(`selfplay 10 1000 M 10`) 변경 전 → 후: 평균 종료 29.72 → 29.37분(범위 25.05~32.00 → 26.47~32.00), 종료 사유 임계 7·타임아웃 3 → 8·2, 판당 멸망 1.4 → 0.9, 전투 비중(병력 소모) 31.0% → 30.5%, 교전 시간 비율 10.6% → 10.8%, 거절 0 → 0. 시드별 경로가 갈라지므로(봇 재지정 지연이 영향) 10판 표본의 차이는 노이즈 범위로 본다. 튜닝 없음.


---

## 28. 시작 위치(스폰) 불균형 측정 · 개선안 (프론트 영향 없음 — 2026-10-22, **측정·제안만, 코드·상수·맵 변경 없음**)

BACKLOG 3번(시작 위치 밸런스)의 선행 작업. 현재 편차를 자가대전으로 수치화하고 개선 후보를 비교한다. 코드 기준은 커밋 28e1557 (보류 중인 페이싱 값 포함, A5 미반영).

### 28.1 현재 스폰·기지 배치 알고리즘

- **스폰(`placeSpawns`, `server/src/map/generate.ts`)**: 첫 스폰 = 물에서 가장 먼 육지 칸(`waterDist` 최대, 동률 tileId 최소). 이후 k번째 = 지금까지 스폰들과의 맨해튼 거리 최솟값이 최대인 육지 칸(최원점 순차 배치). 공정성 조건은 **간격 최대화 하나뿐**이다. 면적·비옥지·지형·노출도 검사는 없다.
- **기지(`placeBases`)**: 수도(=스폰) N개 + 수도 셀(육지 BFS 보로노이)당 중립 기지 1개. 조건: 수도와 12~24, 기지 간 12, 물에서 2 이상, 산 제외. 후보가 없으면 `BASE_RELAX_*` 사다리(간격 8 → 수도거리 9 → 상한 해제 → 물거리 1)로 완화. 점수 = 기지 간 거리 ÷ (10 + 3×경합도).
- **공식 맵 9종**: 위 생성기로 후보를 뽑고 `eval-maps.cjs` 점수(보로노이 칸수·골드·비옥지·기지거리 변동계수 + 육지 비율)가 낮은 것을 채택. 즉 **공식 맵의 선정 기준도 "면적 균등"** 이다.
- 결과적 구조: 스폰 0번 = 맵 한가운데, 1~4번 = 네 모서리 해안, 5번 이후 = 그 사이. **스폰 번호가 곧 위치 유형**이다(공식 맵의 `spawns[]` 앞쪽도 같은 구조).

### 28.2 측정 방법

- 하네스: `selfplay.ts` 와 같은 루프(`Simulation` + `CivBot`, NORMAL 전원)의 임시 스크립트. 매 판 **플레이어↔스폰 배정을 무작위 순열**로 섞어 봇 id 편향을 제거.
- 모드 A: 전원 성향 500‰ 고정(성향 영향 제거). 모드 B: 기본 성향(시드·id 해시) + 무작위 배정(성향이 스폰과 독립).
- 랜덤 맵 M 100×60, N=10: 시드 5000~5099, **모드 A 100판 + 모드 B 100판 = 200판(2000좌석)**. 공식 맵 9종(S 6인, M 10인, L 12인) × 12회 × 모드 2 = **216판**.
- 스폰 특징(게임 전 계산): 보로노이 육지·비옥지·골드가중, 반경 12/20 맨해튼 내 육지·비옥지·산, 최근접 라이벌 거리(`nnR`), 가장 가까운 라이벌 3명 평균 거리(`nR3`), 40 이내 라이벌 수(`nR40`), 최근접 중립 기지 거리(`nnB`), 가장자리 거리·모서리도(`cornerness`)·중심도(`cn`), 물 거리(`coast`), 8방향 20칸 내 물 차단 수(`blocked`).
- 상관은 **판 안에서 평균을 뺀 값(within-game)** 으로 계산(맵 간 차이 제거).
- 참고: 중립 기지는 규칙상 수도에서 12 이상 떨어져 있어 "반경 12 안 중립 기지 수"는 항상 0이다(변별력 없음). 반경 20 안 수(`nb20`)와 최근접 거리(`nnB`)로 대체했다.

### 28.3 결과 — 편차의 크기

랜덤 맵(M, N=10), 스폰 번호별 평균(좌석당 200판, 모드 A+B):

| 스폰 | 5분 점유 % | 10분 | 20분 | 최종 % | 승률 % | 멸망 % |
|---|---|---|---|---|---|---|
| 0 (중앙) | 5.2 | 6.0 | 4.2 | **2.5** | 0.0 | **18.0** |
| 1 (모서리 해안) | 4.9 | 8.9 | 14.7 | 17.9 | 25.5 | 0.5 |
| 2 | 4.5 | 7.8 | 11.1 | 11.8 | 8.0 | 2.5 |
| 3 (모서리 해안) | 5.3 | 10.1 | 16.1 | **18.7** | **30.0** | 1.0 |
| 4 | 5.5 | 9.8 | 14.7 | 16.2 | 19.0 | 1.5 |
| 5 | 5.1 | 8.0 | 9.3 | 8.5 | 6.5 | 6.0 |
| 6 | 5.5 | 8.4 | 9.1 | 7.7 | 6.0 | 8.5 |
| 7 | 4.6 | 6.3 | 6.7 | 5.9 | 1.5 | 9.0 |
| 8 | 4.8 | 6.7 | 7.0 | 6.7 | 2.5 | 12.0 |
| 9 | 4.6 | 5.8 | 5.2 | 3.9 | 1.0 | 13.5 |

(공정하면 최종 10%, 승률 10%, 멸망 약 7% 균등.) 요약:

- **스폰 번호별 평균 최종 점유율의 변동계수 CV = 0.57**(모드 A 0.568 / 모드 B 0.550 — 성향 통제 여부와 거의 무관). 범위 2.5% ~ 18.7%, **약 7.5배**.
- **초반은 균등**: 5분 점유율 4.5~5.5%(차이 1%p), 5분 확장 칸수도 스폰 번호와 거의 무관(약 240~300칸). 10분부터 벌어지고 20분 이후 굳는다. 면적·초기 자원이 아니라 **교전이 시작된 뒤의 위치(노출도)** 효과다.
- 위치 유형(모드 A+B 2000좌석): 모서리 최종 17.1%·승률 22.7%·멸망 1.3% / 가장자리 6.4%·2.6%·9.3% / 중앙 3.9%·0.6%·13.6%. 승자의 약 75%가 1·3·4번(모서리 해안) 스폰에서 나온다.
- 물 거리: 해안(≤2) 최종 13.2%·승률 15.0% / 3~5 6.2% / 6 이상 3.9%·승률 0.9%.
- 한 판 안의 격차: 10분 점유율 범위 평균 11.3%p, 판 내 표준편차 3.5%p(최종은 승자 독식이라 9.8%p).
- 봇 성향(모드 B)의 효과: 판 내 상관 r = 0.30(10분), 0.16(종료). **스폰 효과(r 0.4~0.6)보다 작다.**

공식 맵 9종(스폰 배정 무작위, 모드 A / 모드 B, 각 12판): 스폰 번호별 평균 최종 점유율의 CV —
l-01 0.94/0.94, l-02 0.80/0.81, l-03 0.78/0.77, m-01 0.83/0.83, m-02 0.77/0.79, m-03 0.72/0.71, s-01 0.64/0.68, s-02 0.68/0.71, s-03 0.81/0.88. 모든 공식 맵에서 **0번 스폰이 최하위권(0.4~7.6%)**, 1·2·4번(모서리)이 15~43%. 합산 CV = 0.80(모드 A). 즉 **공식 맵이 랜덤 맵보다 더 불균형**하다(s-03 은 2번 스폰이 평균 41~43%, 12판 중 10판 승리). 표본이 맵당 스폰 번호당 12판이라 개별 수치는 ±3%p 정도 흔들린다.

### 28.4 결과 — 어떤 특징이 설명하는가

판 내 상관, 랜덤 맵 모드 A+B(2000좌석):

| 특징 | r(종료) | r(10분) | 비고 |
|---|---|---|---|
| `nR3` 가까운 라이벌 3명 평균 거리 | **+0.60** | +0.44 | 멀수록 유리 |
| `cornerness` 모서리도 | **+0.59** | +0.29 | |
| `l20` 반경 20 육지 칸 | **-0.57** | -0.28 | 사방이 열려 있을수록 불리 |
| `l12` 반경 12 육지 칸 | -0.55 | -0.26 | |
| `nR40` 40 이내 라이벌 수 | -0.44 | -0.39 | |
| `nnB` 최근접 중립 기지 거리 | +0.41 | +0.34 | 멀수록 유리(모서리와 교락 추정) |
| `nnR` 최근접 라이벌 거리 | +0.33 | +0.28 | |
| `vor` 보로노이 육지 칸 | **-0.40** | -0.13 | 부호가 반대 — 면적이 클수록 오히려 불리 |
| `vFert`/`f12`/`f20` 비옥지 | +0.1~0.2 | 약 0 | 거의 무관 |

- 다중회귀(판 내, 종료 점유율): `nR3+l20+nnB+cornerness` R² = 0.45. 보로노이 칸수 단독 0.15~0.18(부호 반대), 반경 12 비옥지 단독 0.04, `vor+f12+nnR+nnB` 0.33~0.36. 10분 점유율 R² 는 0.12~0.20.
- **결론: 밸런스를 좌우하는 것은 "자원·면적"이 아니라 "방어 지형(노출도)"** — 라이벌에게 둘러싸이지 않는 모서리·해안 위치. 현재 공식 맵 선정 지표(보로노이 칸수·골드·비옥지 변동계수)는 결과를 거의 설명하지 못하거나 부호가 반대여서, 그 기준을 더 엄격히 해도 불균형은 줄지 않는다.

### 28.5 기존 지표 (`eval-maps.cjs`, 공식 맵 9종, 권장 인원 평균)

| 맵 | 보로노이 칸수 CV | 골드 CV | 비옥지 CV | 기지거리 CV | 칸수 min-max (권장 인원별) |
|---|---|---|---|---|---|
| official-s-01 | 0.563 | 0.294 | 0.178 | 0.167 | 348-1160 / 275-991 |
| official-s-02 | 0.519 | 0.306 | 0.324 | 0.178 | 289-1112 / 279-908 |
| official-s-03 | 0.580 | 0.356 | 0.166 | 0.206 | 341-1165 / 128-995 |
| official-m-01 | 0.441 | 0.260 | 0.348 | 0.089 | 241-1032 / 241-1007 |
| official-m-02 | 0.457 | 0.295 | 0.292 | 0.098 | 253-1078 / 184-1057 |
| official-m-03 | 0.419 | 0.302 | 0.364 | 0.093 | 297-1017 / 246-918 |
| official-l-01 | 0.320 | 0.215 | 0.387 | 0.107 | 325-947 / 315-934 |
| official-l-02 | 0.423 | 0.245 | 0.306 | 0.126 | 327-1164 / 171-920 |
| official-l-03 | 0.411 | 0.271 | 0.340 | 0.099 | 277-1072 / 274-928 |

스폰별 육지 칸수 CV 는 0.32~0.58(M 맵 0.42~0.46, 이전 기록 0.36~0.41 과 같은 범위). 랜덤 맵 N=10 의 판 내 보로노이 CV 평균은 0.50. 영역이 가장 큰 스폰이 가장 작은 스폰의 3~8배인데도 **큰 영역이 불리**하다는 점이 28.4 의 핵심이다.

### 28.6 시제품 (적용 안 함)

모두 `server/scripts/_tmp_*.ts` 임시 스크립트로 수행했고 생성기·상수·맵은 건드리지 않았다(임시 파일은 삭제).

**(1) 안 (a) "엄격한 맵 거르기" 시험** — 랜덤 1000맵(시드 30000~)의 노출도 회귀 점수 판 내 표준편차(`sdScore`) 분포는 5%~95% = 5.4~7.6 로 좁다(맵마다 구조가 같다). 시뮬레이션한 200판을 `sdScore` 사분위로 나눠 비교하면 판 내 종료 점유율 표준편차 9.95 / 9.88 / 9.60 / 9.65, 10분 표준편차 3.46 / 3.44 / 3.46 / 3.57 로 **거의 차이가 없다**(맵 단위 지표와 판 불균형의 상관 |r| ≤ 0.11). **불균형은 맵마다 다른 운이 아니라 생성기의 구조(0번 = 중앙, 1~4번 = 모서리)이므로, 후보를 거르는 방식으로는 줄지 않는다.** 보로노이·비옥지 기준으로 거르는 안도 28.4 이유로 효과가 없을 것으로 본다(직접 시험은 하지 않음).

**(2) 스폰 선택 규칙 교체 시험**(같은 시드 5000~5059, 모드 A, 60판씩, 좌석 배정 무작위; 스폰당 표준오차 약 1.2%p):

| 방식 | 스폰별 평균 최종 점유율 (번호 순) | CV(스폰별) | 멸망/판 | 위치유형별 최종 |
|---|---|---|---|---|
| 현행 (최원점, 첫 스폰 = 중앙) | 2.5 16.4 12.5 19.5 16.2 8.3 8.1 6.4 5.3 4.6 | 0.55 | 0.63 | 모서리 17.2 / 가장자리 6.7 / 중앙 3.4 |
| shore: 후보 = 물 거리 정확히 2 인 칸, 그중 최원점 | 11.6 21.5 8.2 15.4 7.6 7.3 8.1 8.3 8.7 3.4 | 0.48 | 0.40 | 모서리 15.0 / 가장자리 7.7 / 중앙 4.3 |
| ring: 바깥 바다에서 2칸 떨어진 고리를 둘레 길이로 등분 | 3.6 7.6 8.0 10.7 11.8 2.1 17.5 12.5 8.7 17.6 | 0.49 | 0.58 | 모서리 13.6 / 가장자리 7.6 |

- 중앙 스폰을 없애면 멸망이 줄고(0.63 → 0.40, shore) CV 가 약간 낮아지지만(0.55 → 0.48~0.49) **모서리 효과는 남는다.** ring 에서도 변 한가운데 스폰(번호 0·5)이 2~4%로 최하위, 모서리 스폰(6·9)이 17.5%로 최상위다. 직사각형 맵에서는 모서리가 두 방향이 막혀 있어 **위치를 균등하게 배치해도 모서리가 구조적으로 유리**하다.
- 노출도를 맞추는 제약(`l20`, `blocked`, `nR3` 동일)을 넣은 선택은 **미시험**이다.

### 28.7 개선안 비교

| 안 | 바꾸는 것 | 비용 | 예상 효과 | 위험 |
|---|---|---|---|---|
| (a) 스폰 선택 기준 강화 — 보로노이/비옥지/기지거리 균등 + 부적합 후보 거부 | 맵 생성 | 낮음(후보 재생성 반복) | **거의 없음.** 28.6(1)·28.4: 이 지표는 결과와 상관이 약하거나 반대이고, 거르기로는 구조가 바뀌지 않는다 | 효과 없이 생성 시간만 증가 |
| (a') 노출도 기준 스폰 선택 — 중앙 후보 제외, `l20`/`blocked`/`nR3` 가 비슷한 칸으로 한정한 뒤 최원점 | 맵 생성 | 중간(선택 함수 교체, 기지 배치 재검증, 테스트 수정, 결정론 유지) | 중앙 제거만으로 멸망/판 -37%, CV 0.55 → 약 0.48(시험치). 노출도 동일 제약을 넣으면 추가 감소 기대(미시험, 모서리 우위 잔존) | 사각 맵의 모서리 우위는 남음. 스폰이 해안 고리로 쏠려 중앙이 빈 지형이 됨(전략 성격 변화), 기지 배치 재조정 필요 |
| (b) 기지 배치 균등화(스폰당 중립 기지 수·거리 동일) | 맵 생성 | 낮음~중간 | 작음. `nnB` r = +0.41 이지만 모서리와 교락 가능성이 크고 기지거리 CV 는 이미 0.09~0.2 | 기지를 모서리에 더 가깝게 두면 모서리 우위를 키울 수 있음 |
| (c) 위치 보정 — 노출도 회귀 점수로 약한 스폰에 소폭 보정 | **규칙**(서버 전용) | 중간(보정 함수 + 값 노출 여부 결정) | **시작 병력/골드 보너스는 효과가 작을 것**(5분 점유율은 이미 균등, 격차는 10분 이후 교전에서 생김). 효과를 내려면 지속 보정(생산 배율 또는 방어 보정)이 필요. 미시험 | 대칭 원칙(GDD)에 어긋남, 방어 보정은 전투 규칙(A5)과 상호작용, 사용자에게 보정 표시 필요 |
| (d) 새 기준으로 공식 맵 재선정 | 맵 데이터 | 낮음(스크립트 + 채택 작업) | 후보를 거르는 것이라 (a)와 같은 한계. 단 공식 맵이 랜덤 맵보다 불균형(CV 0.8 vs 0.57)하므로 선정 지표를 노출도로 바꾸면 랜덤 수준까지는 개선 가능 | 프리셋 checksum·방 설정 변경, 썸네일 재생성. 구조 문제는 그대로 |

### 28.8 권고

1. **우선 (a') + (d)**: "물에서 가장 먼 칸을 첫 스폰으로" 규칙을 폐기하고 중앙을 후보에서 제외한다. 선택 지표를 보로노이/비옥지에서 **노출도(`l20`, `nR3`, 모서리도)** 로 바꾸고, 공식 맵도 같은 지표로 재선정한다. 검증 기준 = 이 §28 하네스(판 수 ≥ 100)에서 스폰별 평균 최종 점유율 CV 0.55 → 0.3 이하를 목표로 하되, 목표 달성 여부는 시험 후 판단한다(미시험).
2. **병행 검토 (c) 지속 보정**: (a') 후에도 남는 모서리 우위(사각 맵의 구조적 한계)는 시작 자원이 아닌 지속 보정으로만 줄일 수 있다. 사용자 결정 후 별도 시험. 시작 병력/골드 보너스는 권하지 않는다.
3. (a) 단독·(b) 단독은 권하지 않는다.
4. 대안 구조(GDD 변경 범위, 사용자 결정 필요): 맵 윤곽을 비사각으로 하거나 모서리를 물로 메워 모서리 이점을 제거.

### 28.9 한계

- NORMAL 봇 전용 결과다. 사람은 모서리 선호 등 다를 수 있다. 변형 시험은 60판이라 스폰당 표준오차 약 1.2%p. 결과는 승리 임계 곡선(§24)과 보류 중 페이싱 값에 의존한다.
- 임시 스크립트와 원자료는 보관하지 않는다. 재현: `selfplay.ts` 루프에 스폰 순열과 성향 고정(`aggressionPermille: 500`)을 추가.

---

## 29. 교전 길이 대책 A5 — 봇 최소 교전 시간 · 교전 중 회수의 이탈 대기 (프론트 영향 없음 — 2026-10-22, 사용자 결정)

§25 후보 비교에서 사용자가 A5 를 채택했다. 구성은 두 가지다: (1) 봇 전용 규칙 — 전투 시작 후 10초 동안 후퇴·회수·재지정을 하지 않는다. (2) 시스템 규칙 A3 — 교전 중 회수도 이탈 대기(3초, 방어력 ×0.5, MOB-2B 철수 훈련 시 2초)를 똑같이 치르고 그동안 접촉 간선을 유지한다. 수적 우위 반영은 하지 않는다(현행 유지).

**프로토콜 변경 없음.** 메시지·필드·enum 추가/삭제 없음. 클라이언트 재작업 불필요. 다만 동작이 하나 바뀐다: 교전 중 `cmd_flag_recall` 을 수락하면, 상대가 방어 태세여도 `flag_disengage_started{auto:false}` 후 최대 `untilTick` 까지 `inCombat` 이 유지되고(이전엔 상대가 방어 태세면 다음 tick 에 `combat_ended` + `flag_disengaged{combat_over}` 로 공짜 이탈), 만료 시 `flag_disengaged{reason:"broke_away"}` 로 끝난다. 이벤트 종류는 기존 그대로이므로 클라이언트의 이탈 호 표시는 그대로 맞는다.

### 29.1 시스템 규칙 A3 (사람·봇 공통)

- `recallFlag` 가 전투 중(`f.inCombat`)에 수락되면 종전처럼 `disengageUntilTick = t + techDisengageTicks`(15 tick, MOB-2B 11) 를 세우고, 추가로 `disengageHold = true` 를 켠다. `disengageHold` 는 §27 에서 태세 전환 때 도입한 플래그로, 켜져 있으면 상대 태세와 무관하게 접촉 간선이 유지된다(`combat.ts engagedPair`).
- `beginReturn` 은 여전히 `disengageHold = false` 로 시작하므로(귀환·패주·IDLE 자동 회수 경로 공통), 회수 명령 쪽에서만 `beginReturn` 뒤에 hold 를 켠다.
- 대기 중 깃발은 `inCombat` 이므로 이동하지 않는다(4단계). 만료 시 상태가 `RETURNING` 이라 `broke_away`(breakaway 면역, 이동하면 해제) 로 끝난다. 상대가 사라져 전투가 끝나면 종전대로 `combat_over`.
- 이중 부과 없음: 이미 `RETURNING` 인 깃발의 회수는 `RETURNING` 거절, 전투에 붙잡힌 귀환 깃발의 자동 이탈 대기(`auto:true`)는 `disengageUntilTick === null` 일 때만 건다(기존). 패주(`routed`) 깃발은 회수 `ROUTED` 거절이라 영향 없음.
- 재지정(`cmd_flag_retarget`)·태세 전환의 이탈 대기 규칙은 변경 없음(§27).

### 29.2 봇 최소 교전 시간

- 상수 `BOT_MIN_ENGAGE_TICKS = 50` (`shared/src/constants.ts`, 봇 전용).
- `bot.ts` 의 `retarget()`·`recall()` 도우미가 `f.inCombat && ctx.t - f.combatSinceTick < 50` 이면 명령을 내지 않는다(retarget 은 false 반환 → 호출부의 "다른 방법" 분기를 그대로 탄다). 후퇴 규칙(8.6.0 3)·차단 후퇴·정체 회수·재활용(recycle, 이미 비전투만)·IDLE 회수 등 모든 회수/재지정이 이 두 도우미를 거치므로 한곳에서 막힌다.
- `combatSinceTick` 은 그 깃발이 현재 전투 무리에 들어온 tick(무리에서 빠지면 null 로 리셋)이다. 전투가 한 번 끊겼다 다시 붙으면 새 10초가 시작된다.

### 29.3 측정 (자가대전 20판, M 10인 NORMAL 봇, 시드 1000~1019)

| 지표 | 수정 전 | 수정 후 |
|---|---|---|
| 교전 무리 길이 중간값 / 상위10% (초) | 3.0 / 9.2 | 8.2 / 16.8 |
| 깃발별 교전 길이 중간값 / 상위10% (초) | 3.4 / 15.8 | 12.4 / 21.6 |
| 교전 중 회수 (판당) | 237.9 | 123.8 |
| 시작 50 tick 안 이탈 명령 (20판 합) | 4314 | 0 |
| 패주 (판당) | 168.2 | 225.4 |
| 멸망 (판당) | 1.05 | 0.55 |
| broke_away (판당) | 241.9 | 182.7 |
| 판 길이 평균 / 최소 / 최대 (분) | 29.24 / 26.47 / 32.00 | 29.55 / 26.75 / 32.00 |
| 종료 사유 | threshold 17, timeout 3 | threshold 17, timeout 3 |

판 길이는 25~32분 목표 안에서 거의 그대로다(평균 +0.3분). 패주가 늘어난 것은 교전이 길어져 끝까지 싸우는 비중이 커진 결과로 보인다. 멸망 감소는 후퇴가 줄었는데도 판 구도가 달라진 것으로 해석되며, 20판 표본이라 단정하지 않는다.

### 29.4 [A] 항목 (사용자 지시 외에 추측으로 정한 것)

- **[A-127] 억제 범위와 기준 tick.** 후퇴·회수·재지정을 `retarget()`/`recall()` 도우미에서 일괄 억제하고, 기준은 `f.combatSinceTick`(현재 무리에 들어온 tick)이다. 억제 중 봇 결정은 명령을 내지 않고 다음 결정 주기에 다시 평가한다(대안 큐잉 없음). 태세 전환(`cmd_set_posture`)은 원래 봇이 전투 중 보내지 않는다(A-125c)라 추가 조치 없음. 이미 이탈 대기 중이거나 `RETURNING` 인 깃발은 어차피 새 회수/재지정이 불가해 영향 없음.
- **[A-128] A3 의 간선 유지 방식.** 신규 플래그를 만들지 않고 §27 의 `disengageHold` 를 회수에도 재사용한다. 만료 시 처리는 `RETURNING` 이므로 §27 의 `wait_over`(제자리 깃발) 분기를 타지 않고 `broke_away` 로 끝난다.
- **[A-129] 상대가 먼저 공격 태세로 붙어 있을 때.** 이 경우 간선은 원래 유지됐으므로 A3 의 효과는 "이탈 대기(×0.5) 부과"뿐이며 이는 종전과 같다. 달라지는 경우는 상대가 방어 태세(또는 공격 태세가 아닌 상태)일 때의 공짜 이탈 차단이다.

### 29.6 테스트·남은 이슈

- `server/test/v49.test.ts` 6건(A3: 공격 깃발 회수 시 3초 간선 유지·broke_away, 방어 깃발 회수, 비전투 회수 무변화, 귀환·패주 중복 거절 / A5: 50틱 억제와 50틱 뒤 후퇴 복귀, 상수). `npm run typecheck`(shared·server) 통과, 전체 vitest 478건 통과(client 포함).
- 남은 이슈: (1) 억제로 봇이 불리한 교전에서도 10초는 버티므로 약한 깃발의 소멸(패주) 비중이 늘었다(패주 +34%). 필요하면 후퇴 허용 조건(예: 병력비 극단값에서는 예외)을 후속 조정. (2) `scripts/qa-*` 류와 `selfplay` 의 기준 수치(후퇴 관련)는 재측정하지 않았다. (3) 측정은 M 10인 NORMAL 단일 구성이다. S/L, HARD 혼합은 미측정.


### 29.5 후속 — 극단적 병력비 예외 (봇 전용, 프론트 영향 없음, 2026-10-22, 사용자 결정)

A5 억제(§29.2)로 불리한 교전에서도 10초를 버텨 패주가 +34% 늘었다(§29.3). 그래서 **내 실효력이 교전 상대 합의 일정 비 미만이면 억제를 풀고** 10초 전에도 후퇴·회수를 허용한다. 프로토콜·메시지 변경 없음(봇 판단만 바뀜), 시스템 규칙 A3 도 그대로.

- 상수 `BOT_ENGAGE_BREAK_RATIO_PERMILLE = 200` (`shared/src/constants.ts`, 1:5).
- `bot.ts engageLocked()`: 50틱 안이어도 `내 실효력 × 1000 < 상대 실효력 합 × 200` 이면 잠그지 않는다. 실효력은 8.6.0 후퇴 판정과 같은 눈금(`floor(병력) × flagValue(무리)`, 상대는 `combatFoes` 의 합). 예외는 `retarget()`·`recall()` 공통 경로에 걸려 있어 후퇴·차단 후퇴·정체 회수·재지정 모두 풀린다.
- 억제가 풀려도 회수는 기존 후퇴 규칙(실효력비 < 0.8, 이탈 대기 3초 손실 추정 후 잔여 ≥ 120)을 통과해야 나간다. 즉 예외는 "10초 기다림"만 없애며, 어차피 죽을 병력(손실 추정 > 잔여)은 여전히 회수하지 않는다.

**측정** (자가대전 20판, M 10인 NORMAL, 시드 1000~1019, `server/scripts/engage-stats.ts`). 임계 0 = §29 현행(예외 없음, §29.3 수치와 일치하게 재현), 1000000 = 억제가 사실상 없는 상태(참고).

| 임계 (내/상대 실효력) | 교전 무리 중간 / 상위10% (초) | 깃발별 중간 / 상위10% (초) | 교전 중 이탈 명령 (판당) | 패주 (판당) | 멸망 (판당) | broke_away (판당) | 판 길이 평균 (최소~최대, 분) | 종료 |
|---|---|---|---|---|---|---|---|---|
| 1000000‰ (억제 없음) | 3.6 / 9.6 | 4.4 / 15.2 | 234.1 | 143.0 | 0.75 | 326.3 | 28.8 (27.4~32.0) | threshold 19, timeout 1 |
| 500‰ (1:2) | 4.0 / 14.4 | 5.0 / 18.0 | 201.3 | 165.7 | 0.95 | 297.3 | 29.1 (27.3~32.0) | 18 / 2 |
| 333‰ (1:3) | 4.8 / 15.0 | 6.2 / 18.6 | 189.1 | 173.6 | 0.65 | 270.1 | 29.8 (27.3~32.0) | 14 / 6 |
| 250‰ (1:4) | 5.8 / 15.8 | 8.6 / 19.6 | 149.1 | 169.2 | 0.70 | 209.6 | 28.8 (25.2~32.0) | 17 / 3 |
| **200‰ (1:5, 채택)** | **6.4 / 16.4** | **10.2 / 20.8** | 153.9 | **189.8** | 0.65 | 220.8 | 29.4 (26.8~32.0) | 16 / 4 |
| 150‰ (1:6.7) | 7.6 / 16.2 | 11.4 / 20.8 | 137.6 | 205.7 | 0.85 | 197.4 | 29.5 (27.5~32.0) | 17 / 3 |
| 100‰ (1:10) | 8.0 / 17.0 | 12.4 / 21.8 | 125.8 | 225.9 | 0.60 | 177.9 | 29.6 (26.9~32.0) | 14 / 6 |
| 0 (§29 현행) | 8.2 / 16.8 | 12.4 / 21.8 | 123.8 | 225.4 | 0.55 | 182.7 | 29.5 (26.7~32.0) | 17 / 3 |

"교전 중 이탈 명령" 은 `flag_disengage_started{auto:false}` 개수다(§29.3 의 "교전 중 회수" 와 0 임계에서 같은 값 123.8). 종료 열은 threshold / timeout 판 수.

판독: 임계를 높일수록 교전은 짧아지고 패주는 줄지만 거의 교환 관계다. 200‰ 는 패주 225.4 → 189.8(-16%)이면서 깃발별 교전 중간값 10.2초, 무리 중간값 6.4초로 사용자가 말한 7초 근처를 지킨다. 150‰ 는 7.6초지만 패주 감소가 -9% 에 그친다. 250‰ 이상은 무리 중간값이 6초 아래이고 (250‰) 판 길이 최소가 25.2분까지 내려 목표 대역 하한에 닿는다. 나머지 판 길이는 25~32분 안이다. 표본이 20판이라 패주·멸망의 ±10% 차이는 잡음일 수 있다(멸망은 판당 0.5~1 건이라 특히 그렇다).

**[A] 항목**
- **[A-135] 비교 지표.** "병력비" 는 병력 단순비가 아니라 8.6.0 후퇴 판정과 같은 실효력(병력 × 무리 내 flagValue)으로 정했다. 상대는 그 깃발의 `combatFoes` 합(상대 연합 전체).
- **[A-136] 임계 200‰(1:5) 채택.** 8개 임계 시험에서 교전 길이(무리 중간 ≥ 7초)와 패주 감소의 절충. 무리 중간값이 6.4초로 7초에 약간 못 미친다(깃발별로는 10.2초). 7초를 우선하면 150‰ 로 내리면 된다(상수 한 줄).
- **[A-137] 예외 범위.** `retarget()`/`recall()` 둘 다 같은 예외를 쓴다(후퇴 전용으로 좁히지 않음).

**테스트**: `server/test/v49.test.ts` 에 2건 추가(총 8건): 1:2.5 는 5틱째에도 회수 없음 / 1:6.7 은 5틱째에 회수 발령, 상수 = 200. 정상 후퇴는 이탈 손실 추정(잔여 ≥ 120)을 통과해야 하므로 시험 병력을 크게(3000 대 20000) 잡았다. 측정 도구는 `server/scripts/engage-stats.ts`(`npx tsx server/scripts/engage-stats.ts [판수] [시드0]`).

---

## 30. 스폰 불균형 개선 "a′ + d" — 노출도 균등 스폰 · 공식 맵 재선정 (프론트 영향 없음 — 2026-10-22, 사용자 결정)

§28.8 권고 1번을 구현했다: "물에서 가장 먼 칸을 첫 스폰으로" 규칙 폐기, 중앙을 스폰 후보에서 제외, 선택 지표를 노출도(`l20`, `blocked`, `nR3`, 모서리도)로 교체, 공식 맵 9장을 같은 지표로 재선정. **(c) 지속 보정은 채택하지 않았고 시작 자원 보너스도 넣지 않았다.** 게임 규칙·메시지·필드·enum 은 바뀐 것이 없다.

**프로토콜 변경 없음.** 클라이언트가 받는 `map_init.spawns`·`bases`·`terrain` 의 형태는 그대로이고, 값(스폰 위치)만 달라진다. 공식 맵 9장은 지형·스폰·기지·`checksum` 이 모두 바뀌었다(id·이름은 그대로) — `welcome.officialMaps[].checksum` 은 새 값이 나간다. 클라이언트는 `server/maps/official/*.json` 을 번들로 가져오므로 빌드만 다시 하면 checksum 이 서버와 맞는다(`loadOfficialMapChecked`). **클라이언트 테스트 한 건이 맵 배치에 의존해 깨진다**(30.7).

### 30.1 새 스폰 선택 (`server/src/map/spawnSelect.ts`, `generate.ts` 3단계)

옛 `placeSpawns`(물 거리 최대 칸 + 최원점)는 삭제했다. 새 `selectSpawns(topo, land, landTiles, waterDist, count)`:

1. **노출도 계산**(육지 칸마다): `l20` = 맨해튼 반경 20 안 육지 칸 수, `blocked` = 8방향 중 20칸 안에 물·맵 밖이 나오는 방향 수, `edge` = 가장자리까지 거리 합(작을수록 모서리; 선택 비용에는 쓰지 않고 분석·QA 용).
2. **후보 고리**: 물 거리 ≥ 2 인 육지 칸 중 `l20` 이 "적격 칸 `l20` 의 30 백분위 값 ± (범위 × 4%)" 안인 칸. 후보가 인원×6 보다 적으면 허용 폭을 ×1.5 씩 넓힌다(최대 16회, 그래도 부족하면 적격 칸 전체). `l20` 이 최대인 중앙은 고리 밖이라 후보에서 빠진다. 고리는 맵 둘레를 따라 도는 "같은 정도로 열려 있는" 칸들의 띠다.
3. **최원점 순차 배치**: 첫 스폰 = 후보 중 tileId 최소, 이후 기존 스폰들과의 최소 거리가 최대인 후보.
4. **균형 스왑**(N ≥ 3): 스폰 하나씩 후보 중 집합 비용이 가장 낮아지는 칸으로 바꾼다(최대 6패스, 개선 없으면 중단, 스폰 간 거리 ≥ 6 유지). 비용 = CV²(`nR3`) + CV²(`nnR`) + CV²(`l20`) + 0.5·CV²(`blocked`+1) − 0.002·최소 간격. (`nR3` = 가까운 라이벌 3명 평균 거리, `nnR` = 최근접 라이벌 거리.)
5. 결정론: rng 를 쓰지 않고 후보를 tileId 오름차순으로 순회, 부동소수는 + − × ÷ 만 쓴다. 기지 배치(`placeBases`)는 코드 변경 없음.

생성 시간(맵 1장, 유휴 상태, 옛 → 새): S6 6 → 16 ms, M10 11 → 65 ms, M12 12 → 93 ms, L12 14 → 115 ms. 매치 시작 시 1회라 영향 없음.

**기지 배치 재검증**: 랜덤 맵 S6/M10/M12/L12/M2 각 60장(시드 7000~)에서 중립 기지의 (수도와 12~24, 기지 간 ≥ 12, 물 거리 ≥ 2) 위반 0건, 스폰 간 최소 거리 < 12 인 맵 0장, 시드 재시도 0건 — 옛 규칙과 같다(완화 사다리가 쓰이지 않았다).

### 30.2 공식 맵 (프리셋) 쪽 변경

- `server/src/map/spawnSelect.ts arrangePresetSpawns`: max 인원으로 고른 스폰 집합을 **최원점 순서**로 다시 늘어놓고(기본 규칙 "앞 N개" 가 쓸 만하도록), **권장 인원 N(< max) 마다 비용이 가장 낮은 N-부분집합을 `spawnSets[N]` 으로 전수 탐색**해 파일에 싣는다(C(12,N) ≤ 924). `presetFromMap(map, meta{arrangement})` 와 `export-map.ts` 가 이를 쓴다. `origin.generator = "v4.9"`.
- `spawnSets` 는 `checksum` 에 들어가지 않는다(terrain+spawns+bases 만) — `spawns` 순서는 들어간다. 로더 규칙(2.8 f)은 그대로.
- 공식 맵 선정 지표(`server/scripts/eval-maps.cjs`): 면적 균등(보로노이 칸수·골드·비옥지 CV)에서 **노출도 균등** `expo = CV²(nR3) + CV²(nnR) + CV²(l20) + 0.5·CV²(blocked+1)`(사용 스폰 N개 사이, 권장 인원 평균)으로 바꿨다. 점수 = `20·expo + 0.3·cvTiles + 0.3·cvGold + 0.15·cvFert + 0.5·cvBaseDist + 0.15·기지 없는 스폰 수 + 2·|육지비 − 0.90|`. 면적 항은 참고용으로 낮춰 남겼다. 인자 `[상위 N]` 추가.
- 재선정 절차: 크기별 후보 60장(시드 2000~2059, max 인원) → `eval-maps.cjs` 점수 상위 8 → 후보마다 자가대전 30판(권장 인원, 모드 A) → 스폰별 최종 점유율 CV 가 낮은 3장 채택(CV 순으로 01~03). 선택 편향을 피하려고 표에 적은 최종 수치는 **채택 뒤 새 배정 시드(7000~)로 다시 잰 값**이다.

### 30.3 측정 방법 (§28 하네스 재구성)

임시 스크립트(삭제함): `selfplay.ts` 와 같은 루프(`Simulation` + `CivBot`, NORMAL 전원). 매 판 **플레이어 ↔ 스폰 배정을 무작위 순열**(시드 결정)로 섞고 스폰 번호별 점유율을 기록. 모드 A = 전원 성향 500‰, 모드 B = 기본 성향. 시드 5000~5099 × 100판(랜덤 맵), 지표 = **스폰 번호별 평균 최종 점유율의 변동계수(CV, 모집단 표준편차/평균)**. 판마다 스폰 라벨을 무작위로 섞어 같은 CV 를 구한 값을 **잡음 바닥**으로 함께 적는다(공정하더라도 100판이면 CV ≈ 0.09 가 나온다). 비교 기준은 같은 날 **현재 봇 코드**로 옛 규칙을 다시 잰 값이다(§28 의 0.55 와 봇 개정 때문에 약간 다르다).

### 30.4 결과 — 랜덤 맵

**전후 (모드 A, 시드 5000~, 판 수 100/60/60):**

| 맵·인원 | 판 | 옛 규칙 CV (잡음 바닥) | 새 규칙 CV (잡음 바닥) | 새 규칙 최대 점유 스폰 | 멸망/판 옛 → 새 |
|---|---|---|---|---|---|
| M 100×60, 10인 | 100 | **0.599** (0.095) | **0.135** (0.087) | 12.7% (최저 7.6%) | 0.60 → 0.28 |
| S 72×42, 6인 | 60 | 0.619 (0.118) | 0.245 (0.113) | 22.4% (최저 12.4%) | 0.25 → 0.18 |
| L 108×66, 12인 | 60 | 0.575 (0.124) | 0.208 (0.120) | 12.4% (최저 6.0%) | 0.58 → 0.50 |

추가 확인(새 규칙): M10 모드 B(기본 성향) 100판 CV 0.141 (잡음 0.091), M10 모드 A 시드 6000~ 100판 CV 0.157 (잡음 0.088). 모두 목표 0.3 이하.

M10 스폰 번호별 평균 최종 점유율(%) / 승률(%) / 멸망(%), 모드 A 100판:

| 스폰 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| 옛 점유 | 2.0 | 18.8 | 12.3 | 19.1 | 16.7 | 8.2 | 7.4 | 4.8 | 5.6 | 4.8 |
| 새 점유 | 7.6 | 12.7 | 10.9 | 8.9 | 9.3 | 9.3 | 9.8 | 9.5 | 11.0 | 10.9 |
| 옛 승률 | 0 | 29 | 14 | 21 | 22 | 7 | 3 | 2 | 0 | 2 |
| 새 승률 | 7 | 20 | 12 | 3 | 6 | 10 | 11 | 11 | 11 | 9 |
| 옛 멸망 | 15 | 0 | 3 | 2 | 1 | 7 | 8 | 4 | 11 | 9 |
| 새 멸망 | 3 | 2 | 6 | 2 | 4 | 2 | 2 | 2 | 2 | 3 |

노출도 상관(판 내, 종료 점유율): 옛 `l20` −0.59 / `blocked` +0.42 / `edge` −0.56 / `nR3` +0.60 → 새 +0.10 / +0.09 / −0.06 / +0.17. 중반 격차도 줄었다(10분 점유율 스폰별 CV 0.19 → 0.07).

**변형 비교** (M10, 모드 A, 시드 5000~5099, 100판씩; 변형 시험은 작업 초반에 돌려, 사이에 `bot.ts` 가 개정되어 행마다 봇 코드가 섞여 있을 수 있다 — 옛 규칙은 개정 전 0.550 / 현재 0.599 둘 다 적었고, 채택안은 현재 봇으로 다시 쟀다):

| 변형 | CV | 비고 |
|---|---|---|
| 옛 규칙 | 0.550 (현재 봇 0.599) | 중앙 + 모서리 |
| 고리 15 백분위, 최원점만 | 0.304 | 중앙 제외만으로도 큰 폭 감소 |
| 고리 30 백분위, 최원점만 | 0.267 | |
| 고리 45 백분위, 최원점만 | 0.296 | 안쪽일수록 노출 상관이 다시 커짐(`l20` r −0.15) |
| 고리 30 + `blocked` 가중 혼합 지표 | 0.381 | 고리가 모서리 쪽으로 치우쳐 악화 |
| 고리 30 + 균형 스왑 (간격 항 가중 3) | 0.170 | 간격 항을 키우면 오히려 악화 |
| 고리 20 + 균형 스왑 | 0.191 | |
| **고리 30 + 균형 스왑 (채택)** | **0.135** | 첫 스폰을 "고리 중앙 칸"으로 바꿔도 0.135 로 같음 |

### 30.5 결과 — 공식 맵 9장

채택 맵(시드는 `origin.seed`, 후보는 export-map `--seed 2000 --count 60`):

| id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 | | id | 시드 | 육지 | 물 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| official-s-01 | 2028 | 2765 | 8.6% | | official-m-01 | 2040 | 5429 | 9.5% | | official-l-01 | 2036 | 6478 | 9.1% |
| official-s-02 | 2001 | 2695 | 10.9% | | official-m-02 | 2029 | 5485 | 8.6% | | official-l-02 | 2021 | 6432 | 9.8% |
| official-s-03 | 2059 | 2692 | 11.0% | | official-m-03 | 2022 | 5366 | 10.6% | | official-l-03 | 2012 | 6368 | 10.7% |

(§22.1 표는 대체됨. `qa-official-maps.ts` 의 대조표도 이 값으로 갱신. 물 비율은 모두 8.5~11.5% 창 안.)

노출도 점수 `expo`(낮을수록 균등): 옛 공식 맵 0.23~0.36 → 새 0.008~0.015. 면적 CV(참고)도 0.32~0.58 → 0.16~0.25 로 같이 줄었다(스폰이 둘레 고리에 있어 보로노이 영역이 비슷해진다).

자가대전 CV (모드 A, 권장 인원 S6/M10/L12, **스폰 번호별 평균 최종 점유율 CV**, 새 값은 채택 뒤 시드 7000~ 40판, 옛 값은 시드 5000~ 20판):

| 맵 | 옛 CV (20판) | 새 CV (40판) | | 맵 | 옛 CV | 새 CV | | 맵 | 옛 CV | 새 CV |
|---|---|---|---|---|---|---|---|---|---|---|
| s-01 | 0.70 | 0.41 | | m-01 | 0.86 | 0.41 | | l-01 | 0.96 | 0.52 |
| s-02 | 0.69 | 0.47 | | m-02 | 0.86 | 0.58 | | l-02 | 0.80 | 0.57 |
| s-03 | 0.79 | 0.44 | | m-03 | 0.76 | 0.51 | | l-03 | 0.77 | 0.47 |
| 크기별 합산(3장, 스폰 번호 기준) | 0.67 | **0.190** (잡음 0.073) | | | 0.69 | **0.302** (잡음 0.080) | | | 0.77 | **0.358** (잡음 0.084) |

모드 B 20판(새 맵): 합산 CV S 0.144 / M 0.284 / L 0.332, 장별 0.32~0.57. 잡음 바닥은 장별 40판에서 약 0.13, 20판에서 약 0.2 이므로 옛 수치는 잡음 몫을 조금 포함한다.

**정직한 판정**: 랜덤 맵은 세 크기 모두 CV 0.3 이하(0.135 / 0.245 / 0.208)로 목표를 달성했다. **공식 맵은 장별 CV 가 0.41~0.58 로 옛 0.69~0.96 보다 크게 낮아졌지만 0.3 이하는 아니다.** 크기별 합산 CV 는 S 0.19 / M 0.30 / L 0.36. 고정된 한 장은 스폰 주변의 지형·중립 기지 배치가 번호마다 달라, 랜덤 맵처럼 판마다 지형이 바뀌며 상쇄되지 않는다.

### 30.6 [A] 항목 (사용자 지시 외에 추측으로 정한 것)

번호는 지시대로 [A-130] 부터. [A-130]~[A-134] 는 §29.5 가 건너뛴 번호를 쓰고, 이어지는 항목은 [A-138] 부터다.

- **[A-130] 지표 정의와 모서리도.** `l20` = 맨해튼 반경 20 안 육지 칸, `blocked` = 8방향 20칸 안 물 차단 수. 모서리도(`edge`)는 비용에 넣지 않았다 — `l20` 고리가 이미 모서리도를 균등하게 만든다(새 규칙에서 `edge` 상관 −0.06). `edge` 는 분석·QA 용으로만 계산한다.
- **[A-131] 중앙 제외는 명시 규칙이 아니라 고리의 결과.** 후보를 "`l20` 이 30 백분위 ± 4%" 로 한정하면 `l20` 이 최대인 중앙은 자동으로 빠진다. 별도 "중앙 금지 영역" 은 없다. 30 백분위·±4% 는 15/30/45 시험(30.4)에서 고른 값이다.
- **[A-132] 비용 함수 가중치.** `nR3`·`nnR`·`l20` 은 1, `blocked` 는 0.5, 최소 간격은 −0.002, 스왑 6패스, 최소 스폰 간격 6. 시험한 변형 중 가장 낮은 CV 가 나온 값이며 이론적 근거는 없다(간격 항 가중 3 은 악화).
- **[A-133] 스폰 번호는 더 이상 위치 유형이 아니다.** 균형 스왑 뒤의 슬롯 순서에는 의미가 없다(playerId i → 슬롯 i). 룸이 플레이어를 슬롯에 무작위 배정하지는 않는다. 새 규칙에서도 **슬롯 0 이 약간 낮고(7~8%) 슬롯 1 이 약간 높다(11~13%)** — 시드 5000/6000, 모드 A/B, 첫 스폰 변경 시험에서 반복되며 노출 지표로는 설명되지 않는다(원인 미상, 30.8). 사람 대전에서 슬롯 배정을 섞을지는 사용자 결정 사항으로 남긴다.
- **[A-134] 프리셋 `spawns` 순서와 `spawnSets`.** `spawns` = 최원점 순(권장 구간 밖 N 은 앞 N개 규칙), 권장 인원 구간의 N(< max)은 `spawnSets` 로 최적 부분집합. 권장 구간이라도 N = max 면 전체.
- **[A-138] 공식 맵 재선정에 자가대전 CV 를 썼다.** 지시는 "같은 지표(노출도)로 재선정"이었다. 노출도 점수 상위 8장만 남기고 그 안에서 자가대전(30판) 스폰별 CV 가 낮은 3장을 골랐다(8장의 30판 CV 는 0.20~0.94, 선택 편향이 있으므로 최종 수치는 새 시드로 다시 잼). id·이름은 그대로, 시드는 2000대.
- **[A-139] 테스트 픽스처 `sample-m-01.json` 재생성.** 같은 시드(20261009)로 다시 뽑았다. 이 픽스처는 "N = max 로 읽으면 생성기 출력과 같다" 시험용이라 `arrangement` 없이 생성기 슬롯 순서 그대로 둔다.
- **[A-140] 임시 하네스는 삭제.** 재현은 30.3 의 설명대로 `selfplay.ts` 루프에 "플레이어 ↔ 스폰 무작위 순열 + 성향 고정" 을 넣으면 된다. 프리셋은 `MapCatalog.loadDir(dir)` + `mapFromPreset(p, N)` 으로 읽는다.

### 30.7 클라이언트 영향

- 프로토콜·타입 변경 없음. `client/` 소스 수정 불필요. 공식 맵 JSON 이 바뀌었으므로 **클라이언트를 다시 빌드**해야 번들 미리보기와 서버 checksum 이 맞는다(안 맞으면 미리보기를 숨기는 기존 안전장치가 동작).
- **테스트 1건 수정 필요**(`client/` 를 건드리지 않았다): `client/test/postureV46.test.ts` 의 `generateMapForPlayers(4242, 8)` 는 맵 배치에 의존한다 — `openArea` 가 처음 찾은 중립 빈터가 새 맵에서는 플레이어 1 의 영토에서 멀어 `cmd_flag_retarget` 이 `OUT_OF_RANGE` 로 거절된다. 시드를 **4244**(또는 4245·4247·4249·3)로 바꾸면 통과한다(4244 로 전체 19건 통과 확인).

### 30.8 남은 이슈

1. **공식 맵 장별 CV 0.41~0.58 (목표 0.3 미달).** 원인은 고정 지형·스폰 주변 중립 기지 배치로 추정(§28.4 의 `nnB` 최근접 중립 기지 거리 r = +0.41). 개선안: 선택 비용에 `nnB`·스폰 주변 비옥지/산 균등을 넣고 후보 수를 늘려 자가대전 CV 로 재선정, 또는 판마다 슬롯 배정을 섞어 맵 고유 편향이 상쇄되게 하는 방법(룸 규칙 변경).
2. **슬롯 0 약세·슬롯 1 강세(30.6 A-133).** 원인 미상. 사람 대전에서는 방장이 슬롯 0 을 받으므로 영향이 있다.
3. **봇 플레이어 id 편향(내 범위 밖, `bot.ts` 는 다른 에이전트 담당).** 성향을 500‰ 로 고정한 모드 A 에서도 플레이어 id 별 평균 점유율이 6.5~14.5% 로 갈렸다(100판, 스폰은 무작위 배정이라 위치와 무관; id 4·8 이 14%대, id 2 가 6.5%). 스폰 CV 측정은 배정을 섞어 상쇄하지만, 봇 코드 안에 id 순서에 의존하는 동률 처리가 있을 가능성이 있다.
4. 사각 맵의 모서리 구조는 그대로다(고리가 둘레를 도는 한 모서리 근처 스폰은 방향 하나가 더 막혀 있다). `blocked` 를 비용에 넣어 균형을 맞췄지만 완전히 같지는 않다.
5. NORMAL 봇 전용 결과다. 사람은 다를 수 있다(28.9 와 같음). 측정 중 `bot.ts` 가 다른 에이전트에 의해 수정되어, 변형표(30.4) 일부는 개정 전후 봇이 섞여 있다. 전후 표(옛 규칙 재측정과 새 규칙)는 같은 봇 코드(파일 해시 동일)로 연달아 쟀다.

### 30.9 테스트

- `server/test/spawn.test.ts`(신규 17건): 5개 (크기, 인원) 조합 × 시드 6개에서 스폰 `l20` 변동계수 ≤ 0.06 · 최소 간격 ≥ 6 · 물 거리 ≥ 2 · 옛 첫 스폰(물 거리 최대 칸) 제외 · `l20` < 최대의 90%, 기지 배치 제약(12~24 / 12 / 2) 위반 없음, 결정론, `arrangePresetSpawns`(순열·부분집합 비용 ≤ 앞 N개), 공식 맵 9장 권장 인원 전 구간 `l20` CV ≤ 0.06 · `spawnSets` 존재 · N = 2 의 두 스폰 거리 ≥ 40.
- `server/test/fixtures/maps/sample-m-01.json` 재생성(A-139), `server/scripts/qa-official-maps.ts` 대조표 갱신(전부 통과).
- 타입체크 통과, 전체 vitest: 497건 중 496건 통과, 1건 실패 = 위 `client/test/postureV46.test.ts`(30.7).

변경 파일: `server/src/map/spawnSelect.ts`(신규), `server/src/map/generate.ts`, `server/src/map/presets.ts`, `server/scripts/export-map.ts`, `server/scripts/eval-maps.cjs`, `server/scripts/qa-official-maps.ts`, `server/maps/official/*.json` 9장, `server/test/spawn.test.ts`(신규), `server/test/fixtures/maps/sample-m-01.json`.

## 31. 약소국 정리 보상 — 마지막 기지를 점령해 멸망시키면 보상 (프로토콜 추가만 · 2026-10-23, 사용자 결정)

**사용자 결정**: "마지막 기지를 가진 약소국을 정리(멸망)시키는 쪽에 보상을 추가해 정리할 유인을 만든다." (관전 2026-10-23: 27분 판 끝에 P4 24칸·P9 5칸이 기지 1개로 살아 있었고 누구도 치지 않았다. 하위 4개국 합 3.1%.)

### 31.1 규칙 (12단계 멸망 판정 `stage12_elimination`, 합병과 같은 tick)

보상 받는 쪽 = 합병 받는 `byPlayerId`(같은 tick 연쇄로 거슬러 올라간 최종 생존자 포함). 생존 합병자가 없어 땅이 중립이 되면 보상 없음. 보상은 합병자 한 명에게만 간다.

| 항목 | 값 | 설명 |
|---|---|---|
| 병력 인계 | 멸망자 풀 병력 + 깃발 병력의 **50%** | 나머지 50% 는 종전처럼 소멸(회계 `eliminated`). 합병자 병력 상한(합병 칸 반영)까지만 받고 넘치는 몫은 소멸 |
| 정액 병력 현상금 | **+100** | 새로 생긴 병력 → 회계 `regen` 에 계상. 인계분과 합쳐 상한 안에서만 |
| 골드 인계 | 멸망자 골드의 **100%** | 누적 획득 골드(`goldEarned`, 순위 타이브레이커)에는 넣지 않는다 |
| 정액 골드 현상금 | **+100** | |
| 생산력 면제 | 마지막 기지를 점령하면 점령 시 생산력 ×0.5 를 **면제**(100% 유지) | 마지막 기지가 아닌 기지 점령은 종전대로 ×0.5 (`base_captured.newProdPm` 이 1000 으로 온다) |

상수: `shared/src/constants.ts` `ANNEX_ASSET_PERMILLE 500 / ANNEX_GOLD_PERMILLE 1000 / ANNEX_BOUNTY_TROOPS 100 / ANNEX_BOUNTY_GOLD 100 / ANNEX_FULL_PROD 1`. 서버는 `server/src/game/annex.ts` 의 `ANNEX` 객체로 읽는다(진단용 환경변수 `CIVWAR_ANNEX="asset=500,gold=1000,troops=100,bgold=100,prod=1"` 로 덮어쓸 수 있다 — 게임 상수 아님, 자가대전 시험 전용).

**눈덩이 방지 설계**: 보상 대부분이 정액이다(병력 100·골드 100·기지 1개분 생산). 병력 상한이 낮은 약한 합병자에게는 상대적으로 크고 이미 큰 1위에게는 작다. 인계 몫은 멸망자 자산에 비례하는데 약소국 자산은 작다. 보상 대상은 "기지 하나만 남은" 나라를 마지막 기지까지 쳐서 멸망시킨 경우뿐이라, 강한 2위를 보상으로 먹을 길은 없다.

### 31.2 프로토콜 변경 (추가만, 하위 호환)

`S2C player_eliminated` 에 두 필드를 추가한다. 서버는 **항상 싣는다**.

```json
{ "type":"player_eliminated","tick":4012,"playerId":4,"byPlayerId":2,"annexedTiles":311,"bountyTroops":113,"bountyGold":142 }
```

- `bountyTroops`: `byPlayerId` 풀에 실제로 더해진 병력(상한에 잘린 뒤의 값, 정수). `bountyGold`: 실제로 더해진 골드(정수). `byPlayerId:null` 이면 둘 다 0.
- 타입: `shared/src/protocol.ts` `S2C_PlayerEliminated.bountyTroops?: number; bountyGold?: number` (옵셔널 선언 — 구버전 서버 호환. 현 서버는 항상 보냄).
- 같은 tick 의 병력·골드 델타(`playerDeltas`, 5 tick 주기)에 보상이 반영돼 온다. 별도 이벤트는 없다.
- QA 스키마(`server/scripts/qa-schema.ts`)에 두 필드를 필수로 추가했다.

### 31.3 클라이언트 영향 (`client/` 는 건드리지 않음)

- **기존 클라이언트는 그대로 동작한다**(추가 필드는 무시된다. `client/src/state/feed.ts`·`gameModel.ts` 는 `annexedTiles`·`byPlayerId` 만 읽는다).
- 권장 후속(선택): 피드의 합병 문구에 보상을 덧붙이면 눈에 보인다 — 예: `— P2 남은 311칸 합병 (+113 병력, +142 골드)`. `m.bountyTroops ?? 0` 으로 읽고 0 이면 생략.
- 마지막 기지 점령 때 오는 `base_captured.newProdPm` 이 1000 이다(이전엔 항상 ≤ 500). 값을 그대로 표시하면 문제 없다.

### 31.4 왜 정리 유인이 작았나 (확인) — 자가대전 계측

M 맵 10인 NORMAL 봇, 시드 1000~1039 (40판), 12분 이후만 계측.

- 마지막 기지만 남은 나라는 판당 평균 약 4개국이 12분 이후 합계 약 4,400 나라-초에 걸쳐 존재했다. 그런데 **그 기지의 체력이 깎이는 표본은 0.7%** 뿐이다.
- 봇은 마지막 기지를 이미 후보에 올린다(내 땅에서 거리 ≤ 6 이면 후보, 점수 ×2.5). 그 기지를 앵커로 둔 공격 깃발은 4판 표본에서 판당 약 900~2,000 깃발-초 존재하지만 **기지 칸에 도착한 표본은 거의 0**이고 대부분 행군 중이거나 수비 깃발과 교전 중이다. 멸망 직전 나라의 병력은 전부 기지 수비 깃발에 들어가 있고 수비 태세(방어력 ×1.5)가 공격 기병을 이긴다(관전 2026-10-23: P4 833명 전력 1.59 vs P7 591명 0.59).
- 즉 **병목은 가치 평가(유인)보다 방어 돌파력**이다. 봇의 마지막 기지 점수에 합병될 영토 칸 수를 20배까지 가산해도(진단 시험) 멸망/판은 유의하게 바뀌지 않았다(24판: 기준 0.63 → 0.46 / 0.71, 마지막 기지를 앵커로 둔 깃발 수만 2~3배, 기지 칸 도착은 여전히 거의 0).

### 31.5 보상 안 비교 (40판, 시드 1000~1039, 같은 시드) — 모두 봇이 보상을 점수에 반영(`bot.ts lastBaseBountyScore`)

| 안 | 구성 | 멸망/판 | 종료 분 | 종료 시 생존 최약소국 점유율 | 종료 시 기지 1개 생존국 수 | 1위 | 상위 2개국 합 | 점유율 승리 | 합병자 영토 순위 평균 (1위 합병 수 / 합병 수) |
|---|---|---|---|---|---|---|---|---|---|
| 기준(보상 없음) | — | 0.45 | 29.4 | 0.47% | 4.58 | 27.8% | 49.9% | 36/40 | 2.06 (8/18) |
| A 자산 인수 | 병력 50% + 골드 100% | 0.33 | 29.5 | 0.31% | 4.90 | 27.6% | 49.2% | 34/40 | 2.23 (6/13) |
| B 정액 | 병력 200 + 골드 200 + 생산 면제 | 0.63 | 29.4 | 0.53% | 4.58 | 27.8% | 49.1% | 34/40 | 2.36 (8/25) |
| **F1 채택** | A 일부 + 정액 + 생산 면제 | **0.60** | 30.0 | 0.38% | 4.45 | 26.5% | 47.4% | 31/40 | **2.00 (10/24)** |

(앞서 24판으로 잰 값은 기준 0.63 / F1 유사 구성(D) 0.83 / A 0.63 / B 0.67 — 표본마다 변동이 크다. 이 표가 최종 비교.)

**정직한 판정**: 채택안(F1)은 멸망/판이 기준보다 높은 쪽이지만 40판 표준오차(약 0.12) 이내의 차이다. 최약소국 점유율·기지 1개 생존국 수는 개선되지 않았다. 판 길이는 29.4 → 30.0분(표준 30분, 상한 32분 안), 상위 2개국 합은 49.9% → 47.4%로 줄어드는 쪽이라 **눈덩이는 커지지 않았다**(합병자는 멸망 순간 평균 2위권, 6위 이하 합병자는 모든 안에서 0명). 보상은 사용자 결정대로 구현했고, 봇 행동은 위 병목 때문에 크게 바뀌지 않는다.

### 31.6 [A] 항목 (사용자 지시 외에 추측으로 정한 것)

- **[A-141] 보상 구성과 값.** 안 A(자산 인수) / B(정액) / F1(혼합) 중 F1(병력 인계 50% + 골드 100% + 정액 병력 100 + 정액 골드 100 + 마지막 기지 생산력 면제)을 채택. 값(500‰, 100, 100)에는 이론적 근거가 없다 — 시험한 변형 중 눈덩이 지표를 악화시키지 않으면서 멸망/판이 높은 쪽. 정액(100)은 시작 병력 150 / 시작 골드 200 / 테크 1티어 160 에 견준 눈금.
- **[A-142] 연쇄 멸망.** 같은 tick 연쇄에서 보상은 `resolveConqueror` 가 찾은 최종 생존 합병자에게만 간다. 그 합병자가 같은 tick 뒤 순번에서 자기도 멸망하면, 받은 보상은 그의 멸망 처리(인계/소멸)를 따른다.
- **[A-143] 병력 상한.** 인계·현상금은 합병자 병력 상한(합병 칸 반영, `troopCap`)까지만 더하고 넘치는 몫은 사라진다(인계분은 `eliminated` 소멸, 정액분은 애초에 생기지 않음). `capClamp` 로 깎이지 않게 미리 자른다.
- **[A-144] 누적 획득 골드 제외.** 보상 골드는 `goldEarned`(순위 타이브레이커)에 넣지 않는다 — 정리 보상으로 동률 순위가 뒤집히지 않게.
- **[A-145] 정액 병력의 회계.** 현상금 병력은 새로 생기는 병력이라 `ledger.regen` 에 계상(불변식 `Σ풀 + Σ깃발 + Σ소멸 == 시작 + regen` 유지).
- **[A-146] 봇 반영.** 봇은 상대 마지막 기지 후보의 점수에 `(mass + 보상/칸당비용) / mass` 를 곱한다(골드 1 = 병력 1 환산). 보상이 0 이면 점수 불변. `bot.ts` 의 `bestAnchor` 기지 후보 블록 한 줄 + 도우미 함수 `lastBaseBountyScore` 이며, 다른 에이전트가 보는 id 편향 영역과 겹치지 않는다.
- **[A-147] 진단 시험 레버 제거.** 합병될 영토 칸 수를 봇 점수에 20배까지 가산하는 레버는 효과가 없어 코드에서 뺐다(31.4).

### 31.7 남은 이슈

1. **실제 병목은 방어 돌파력**이다(31.4). 보상만으로는 약소국 방치 현상이 거의 풀리지 않는다. 후보(사용자 결정 필요): 기지 1개만 남은 나라의 수비 보정 완화(예: 마지막 기지 피해 상한 300 → 450, 또는 기지 방어력 ×1.5 → ×1.3), 마지막 기지 공격 시 봇 병력 투입 비율 상향(현재 풀 50%), 판 말미 러시와의 연동.
2. 40판 표준오차(멸망/판 약 0.12) 이내의 차이는 구분하지 못한다. 정밀 비교는 100판 이상 필요.
3. 사람 대전에서는 보상이 가치 판단에 더 크게 작용할 수 있다(봇은 점수식에 반영된 만큼만).

### 31.8 테스트

- `server/test/annex.test.ts`(신규 7건): 레버 0 이면 기존 동작 / 병력·골드 인계 비율(보상 없는 같은 장면과의 차이) / 정액 현상금의 병력 상한 클램프와 이벤트 값 = 실제 받은 양 / 상한이 꽉 차면 병력 보상 0·골드는 수령 / 합병자 없음(중립)이면 이벤트 보상 0 / 마지막 기지 점령만 생산력 면제 / 비마지막 기지는 ×0.5. 매 tick `ledgerImbalance == 0`.
- 타입체크 통과. 전체 vitest 513건 중 512건 통과, 1건 실패 = `server/test/rooms.test.ts` "프리셋 맵 방: ... spawns 앞 N개"(다른 에이전트의 `room.ts` 슬롯 배정 수정 중 상태와 관련, 이 작업과 무관). `qa-headless` 스키마 위반 0 · 순서 위반 0 · 재구성 불일치 0.
- 평가 도구(신규): `server/scripts/annex-eval.ts`(판별 JSON 한 줄: 멸망·종료 분·최약소국·마지막 기지 계측), `server/scripts/annex-agg.cjs`(집계). 사용: `CIVWAR_ANNEX="asset=500,gold=1000,troops=100,bgold=100,prod=1" npx tsx server/scripts/annex-eval.ts <판수> <시드0>`.

변경 파일: `server/src/game/annex.ts`(신규), `server/src/game/tick.ts`(stage12), `server/src/game/gauge.ts`(마지막 기지 생산력), `server/src/game/bot.ts`(`lastBaseBountyScore`), `shared/src/constants.ts`, `shared/src/protocol.ts`, `server/scripts/qa-schema.ts`, `server/scripts/annex-eval.ts`·`annex-agg.cjs`(신규), `server/test/annex.test.ts`(신규).

## 32. 슬롯 배정 섞기 · 플레이어 id 편향(봇 테크 목록) · 위쪽 편향(봇 앵커 동률) (프론트 영향 없음 — 2026-10-23, 사용자 결정)

§30 남은 이슈 2·3("슬롯 0 약세·슬롯 1 강세", "봇 플레이어 id 편향")을 조사하고 고쳤다. **프로토콜·메시지·필드 변경 없음.** 달라지는 것은 값(어느 플레이어가 어느 스폰을 받는가)과 봇 행동뿐이다.

### 32.1 결론 (원인)

| 현상 | 원인 | 조치 |
|---|---|---|
| 봇 id 별 편향 (id 4·8 높음, id 2·3 낮음, 14% ↔ 6.5%) | **`bot.ts buyTech` 가 테크 우선순위 목록을 `(playerId-1) % 4` 로 골랐다.** 목록 3(기동형)을 받는 id 4·8 이 강하고 목록 1·2(경제·수비형)를 받는 id 2·3·6·7 이 약했다. 처리 순서(playerId ASC)는 원인이 아니다. | 목록을 playerId 가 아니라 **시드 기반 균형 배정**으로 (A-151) |
| 슬롯 0 약세 | ① 슬롯 번호는 위치와 묶여 있다(생성기 순서상 슬롯 0 = 둘레 고리의 맨 위 쪽, 슬롯 1 = 가장 먼 우하단 쪽). ② **봇이 앵커 후보 동률을 "tileId 최소 칸"으로 풀어 늘 위쪽(그다음 왼쪽) 국경부터 확장**했다 → 위쪽 스폰이 가장자리로 밀린다. 위치와 점유율의 상관 `r(y) = +0.14~0.21`, 위쪽(y<30) 8.4% vs 아래쪽 11.6%. ③ 룸이 플레이어를 슬롯에 섞지 않아 방장(playerId 1)이 늘 슬롯 0. | ① 시작 때 플레이어→슬롯 무작위 배정 (A-150) ② 봇 동률을 해시 순으로 (A-152) |

**배제한 가설** (모드 A = 전원 성향 500‰, M 100×60 10인, 판당 플레이어↔슬롯 무작위 배정으로 id 와 슬롯을 분리해 측정):

- **틱 처리 순서·명령 큐 순서·flagId 순서 등 playerId 의존**: 테크 목록을 전원 같은 목록(0번)으로 고정하고 id 와 슬롯을 섞으면 id 별 점유율 CV 0.103 / 0.101 / 0.091 / 0.110 / 0.103 / 0.101 (100판 × 6, 잡음 바닥 0.07~0.11), 600판 합산 0.045 (잡음 0.040). 처리 순서에 의한 id 편향은 잡음 이하다.
- **슬롯 번호(생성기 안 인덱스) 의존**: 생성기에서 스폰 순서를 뒤집어(진단 훅, 제거함) 300판을 돌리니 약세가 **번호가 아니라 위치를 따라갔다**(새 슬롯 0 = 옛 슬롯 9 위치 → 11.1%, 옛 슬롯 0 위치 = 새 슬롯 9 → 6.8%; 위/아래 8.2% vs 11.7%).
- **지형 쿼터 동률 절단**: 쿼터(산·언덕·비옥지·사막)를 자를 때 동률을 tileId 오름차순으로 두어 **언덕이 위쪽에 몰린다**(맵 y 0~19 구간 18~19%, y 50+ 구간 12%)는 것은 확인했다. 동률을 타일 해시로 바꿔 보았으나 위치-점유율 상관이 줄지 않아(600판 합산 r(y) 0.16 → 0.21, 위 8.6% / 아래 11.4% → 8.2% / 11.7%) 원인이 아님을 확인하고 **되돌렸다**(랜덤 맵 지형이 전부 바뀌는 파급이 커서 미적용, 32.6).
- **스폰 주변 지형 구성**(비옥지·언덕·산·사막·물 반경 6/10/15): 점유율과의 상관 |r| ≤ 0.09.
- **맵 뒤집기 진단**(세로/가로, 100판씩): 가로 뒤집기는 슬롯별 값이 크게 바뀌고 세로 뒤집기는 거의 안 바뀌었으나 단일 100판이라 결론에 쓰지 않았다(원인은 위 봇 동률로 확인).

**검증 (봇 앵커 동률)**: 같은 코드·같은 시드 6000~6299 300판, 해시 동률 vs 옛 동률 — `r(y)` 0.187 → 0.066, 위쪽(y<30) 8.35% → 9.30% / 아래쪽 11.61% → 10.67%.

### 32.2 구현

- **`server/src/map/slots.ts`(신규)**: `shuffledSlots(seed, n)` = mulberry32(`seed ^ 0x5107a551`) Fisher-Yates 순열, `relabelSpawns(map, slotOf)` = `slotOf[p-1]` 번째 스폰을 playerId p 에게 주도록 `spawns`·`initialOwners` 를 다시 라벨링(항등이면 같은 객체). 결과 맵에서도 **`spawns[p-1].playerId === p`** 이고 `map_init.spawns[]` 의 형태·의미(playerId → 홈 타일)는 그대로다.
- **`createGameState`**: `PlayerSetup.spawnSlot`(생략 시 playerId-1 = 옛 동작, 같은 map 객체)·`PlayerSetup.techStyle`(진단용 강제). 기본 `techStyle` = `shuffledSlots(aggressionSeed ^ 0x7ec4, N)[playerId-1] % 4`.
- **`room.beginGame`**: `slotOf = shuffledSlots(aggressionSeed, members.size)`(랜덤 맵 = 실제 맵 시드, 프리셋 맵 = 룸 시드)를 `setup[].spawnSlot` 으로 넘긴다. 사람·봇·방장 구분 없음.
- **`bot.ts`**: `buyTech` 가 `ctx.params.techStyle ?? (me-1)%4` 사용, 앵커 동률(`bestAnchor.pick`, `deepAnchor`)을 `tileTieHash` 순으로. `rng.ts` 에 `tileTieHash(salt, tileId)` 추가(정수 해시, `Math.imul`).
- **`shared BotDifficultyParams.techStyle?`**: 서버 전용 선택 필드(`PlayerState.bot` 에만 채워짐, 프로토콜로 나가지 않음).
- **진단**: `bot.ts botDiag.legacyTie`(true 면 옛 tileId 최소 동률 — `slot-bias.ts LEGACY_TIE=1` 만 사용), `server/scripts/slot-bias.ts`(신규, 아래 32.3).

### 32.3 측정 — 자가대전 `server/scripts/slot-bias.ts`

`npx tsx server/scripts/slot-bias.ts [games=100] [seed0=5000] [size=M] [N=10]`, 환경 변수 `MODE=A|B`(A = 전원 성향 500‰), `SHUFFLE=0|1`, `TECH=default|legacy|fixedK`, `LEGACY_TIE=1`, `FLIP=v|h`, `DUMP=파일`. 지표 = 슬롯별 / playerId별 평균 최종 점유율의 변동계수(CV = 모집단 표준편차/평균) + **잡음 바닥**(판마다 점유율을 무작위 라벨에 놓은 CV; 100~200판이면 0.04~0.09).

**M 10인, 모드 A, 시드 5000~5199 (200판):**

| 구성 | 슬롯 CV | id CV | 잡음 바닥 | 슬롯 0 / 슬롯 1 점유(%) | id 별 최소~최대(%) | r(y) | 위 / 아래(%) |
|---|---|---|---|---|---|---|---|
| 옛 (슬롯 = id, 옛 테크·동률) | 0.184 | **0.184** | 0.056 | 6.7 / 11.1 | 6.7 ~ 12.9 | 0.137 | 8.9 / 11.1 |
| 섞기만 | 0.148 | **0.192** | 0.066 | 7.1 / 12.9 | 8.0 ~ 14.0 | 0.177 | 8.5 / 11.5 |
| 섞기 + 테크 목록 | 0.158 | **0.066** | 0.065 | 6.7 / 12.9 | 8.7 ~ 10.9 | 0.177 | 8.5 / 11.4 |
| 섞기 + 앵커 동률 | **0.117** | 0.177 | 0.067 | 8.4 / 12.5 | 7.6 ~ 13.0 | 0.070 | 9.4 / 10.5 |
| **전부 (현재)** | **0.120** | **0.060** | 0.057 | 9.6 / 13.3 | 9.1 ~ 11.1 | 0.055 | 9.5 / 10.5 |

**모드 B (기본 성향), 시드 5000~5099 (100판):** 옛 슬롯=id CV 0.160(잡음 0.088, r(y) 0.158) → 현재 슬롯 CV 0.119, id CV 0.112(잡음 0.089), r(y) 0.055.

읽는 법: 섞기만 하면 "방장이 늘 슬롯 0" 문제는 없어지지만 id 편향(0.192)과 슬롯 편향(0.148)이 따로 남는다(편향이 사라지는 것이 아니라 분리될 뿐). 테크 목록 수정이 id 편향을, 앵커 동률 수정이 위쪽 편향을 줄인다. **id(= 사람 자리) 기준 편향은 잡음 수준(0.060 vs 0.057)** 이 되었다. 슬롯(위치) 기준 CV 는 0.184 → 0.120 으로 줄었지만 잡음 바닥(0.057)보다는 크다(32.6).

### 32.4 [A] 항목 (사용자 지시 외에 추측으로 정한 것)

- **[A-150] 슬롯 배정.** 시드 = `aggressionSeed`(랜덤 맵 실제 시드 / 프리셋 룸 시드), 순열은 인원 전체(사람+봇) 대상 Fisher-Yates, 방장 포함. 로비 단계에는 슬롯이 정해져 있지 않다(카운트다운 종료 `beginGame` 에서 정함). `playerId` 는 불변(방 번호·색·재접속 키)이고 슬롯만 섞이므로 "내 위치"는 `map_init.spawns` 를 playerId 로 조회해 알 수 있다(클라이언트가 이미 그렇게 한다).
- **[A-151] 테크 목록 균형 배정.** `techStyle` = 시드 셔플 순위 % 4 → N = 10 이면 4개 목록이 3·3·2·2 로 나뉘고 누가 어느 목록을 받는지는 시드가 정한다(§19 의 "목록 = botIndex % 4" 규칙을 이 값으로 대체; 목록 내용·EASY 검병 치환은 그대로). 인계(`bot_takeover`)된 사람 자리도 같은 값.
- **[A-152] 봇 앵커 동률은 해시 순.** 동률이 있는 상태에서 "가장 싼 국경 칸"·"깊은 앵커"를 고를 때 `tileTieHash(0x2f6b9a1d, tileId)` 가 작은 쪽(전 봇 공통 소금 — playerId 비의존). 같은 비용 칸 사이에서의 선택만 바뀌어 규칙·점수식은 그대로. 결정론 유지(같은 시드 → 같은 판).
- **[A-153] 규칙 쪽 동률은 건드리지 않았다.** `rules.ts stepToward`(`n < best`)·`selectAttackTargetRO`(tileId)·`stepTowardDefend`·방어 최소선 후보(`bot.ts`)는 여전히 tileId 최소로 푼다. 깃발 걸음/타깃 선택에 방향 편향이 남을 수 있으나 게임 규칙 변경이라 이번 범위에서 제외(다른 에이전트가 `game/` 수정 중이기도 함).
- **[A-154] 지형 쿼터 동률 미수정.** 32.1 의 언덕 y 기울기는 확인했지만 점유율 편향의 원인이 아니고 모든 랜덤 맵 지형이 바뀌므로 고치지 않았다.
- **[A-155] 슬롯 CV 의 잡음 바닥은 라벨 무작위화로 정의**(32.3). 서로 다른 시드 묶음(100판)에서 개별 슬롯 값은 ±1%p 정도 흔들린다(슬롯 0 은 7.3~8.8%, 슬롯 1 은 10.7~14.7%).

### 32.5 클라이언트·하위 호환 영향

- **프로토콜·타입 변경 없음, `client/` 수정 불필요.** `map_init.spawns[]` 는 여전히 `playerId` 오름차순(index = playerId-1)이고 각 항목은 그 플레이어의 홈 타일을 가리킨다. 클라이언트는 `spawns.find(s => s.playerId === me)` 로 조회한다(`controller.ts:595`, `renderer.ts:123/341`, `GameScreen.tsx:50`, `gameModel.ts` — 인덱스 가정 없음, 코드로 확인). 로비의 맵 미리보기는 슬롯 위치만 보여 주고 플레이어별 위치는 시작 후에 정해지므로 로비 표시 변경 불필요.
- 공식 맵 파일(`spawns` 순서·`checksum`)은 그대로다. 섞기는 시작 때 메모리에서만 한다.
- 같은 방 시드로도 이제 플레이어별 시작 위치가 이전과 달라지고 봇 테크 목록·동률이 바뀌었으므로 **옛 시드로 판을 재현하거나 `_workspace/ai-match/` 의 이전 녹화와 수치를 비교할 수 없다.**
- `PlayerSetup.spawnSlot` 을 쓰지 않는 호출(테스트·옛 스크립트)은 옛 동작(playerId p → 슬롯 p-1)이다. 테크 목록만은 기본값이 바뀌었다(`techStyle` 기본 = 균형 배정, 옛 `(id-1)%4` 는 `techStyle` 강제 또는 `slot-bias.ts TECH=legacy`).

### 32.6 남은 이슈

1. **슬롯(위치) 별 편차가 잡음 바닥보다 크다**(CV 0.120 vs 0.057). 슬롯 1(우하단 쪽, 평균 위치 x≈79, y≈44)이 13.3%로 강하고 슬롯 2·4 가 8.7~8.9%. 위치와의 상관이 큰 것은 **맵 가장자리까지 거리 r = +0.14, 가장 가까운 중립 기지까지 거리 r = +0.11**(지형 구성은 |r| ≤ 0.09). 가장자리에 가까운 스폰이 약하다 — 스폰 선택(§30)에 가장자리 거리·중립 기지 거리를 비용으로 넣거나 후보 범위를 안쪽으로 모으는 개선이 다음 후보다. 섞기 덕에 **플레이어 개인의 기대 점유율은 균등**하지만 한 판 안에서는 위치 운이 남는다.
2. **규칙 쪽 tileId 최소 동률**(A-153)이 남은 방향 편향의 후보. 앵커 동률 수정 후에도 `r(y)` 가 0.055 남아 있다.
3. 지형 쿼터 동률(언덕이 위쪽에 몰림, A-154) — 맵 생성기 수정은 랜덤 맵 전체가 바뀌므로 사용자 결정 필요. 공식 맵 9장에는 이미 이 기울기가 구워져 있다(재선정은 별도 작업).
4. NORMAL 봇 전용 결과이며 사람은 다를 수 있다(§28.9 와 같음). 모드 B 의 id CV 0.112 는 잡음 바닥(0.089)보다 약간 높으나 100판이라 구분이 안 된다(성향이 id 해시로 판마다 달라지는 효과 포함).

### 32.7 테스트

- `server/test/slots.test.ts`(신규 11건): `shuffledSlots` 순열·결정론·시드별 차이, 방장이 받는 슬롯이 균등 분포(2000시드), `relabelSpawns`(playerId 불변식·위치 집합 보존·initialOwners 일치·항등은 같은 객체·비순열 거절), `createGameState` spawnSlot(홈 타일·소유·회계 불변식 60tick)·생략 시 옛 동작·결정론(600tick 봇 판 2회 동일), 테크 목록 균형(6명 2·2·1·1, playerId 1 이 4개 목록을 모두 받음)·강제값 존중, 룸(12시드 — 방장 슬롯이 3종 이상, `map_init.spawns` 의 playerId 불변식과 위치 집합), 동률 해시(결정론·창 안 최소 칸이 위 행에 몰리지 않음).
- `server/test/rooms.test.ts` 1건 수정: 프리셋 맵 방의 `map_init.spawns` 가 앞 N개 "순서"가 아니라 "집합"과 같은지 본다.
- 타입체크(shared·server·client) 통과, 전체 vitest 515건 통과.

변경 파일: `server/src/map/slots.ts`(신규), `server/src/map/rng.ts`(`tileTieHash`), `server/src/game/state.ts`(spawnSlot·techStyle), `server/src/game/bot.ts`(buyTech·동률 해시·botDiag), `server/src/room/room.ts`(beginGame 슬롯 배정), `shared/src/constants.ts`(`BotDifficultyParams.techStyle?`), `server/scripts/slot-bias.ts`(신규), `server/test/slots.test.ts`(신규), `server/test/rooms.test.ts`.


---

## 33. 전투 모델 2 (`COMBAT_MODEL` 병존 플래그) — 채널 비교 + 사기 (추가만, 기본값 = 현행 — 2026-10-23, 사용자 결정)

설계 원본: `_workspace/05_combat_redesign_draft.md` rev.4. **기본값은 모델 1(현행)이고 모델 1 경로는 변경 전과 비트 단위로 같다.** 모델 2는 켜는 방법이 아래 하나뿐이다. 적용 여부(기본값 변경)는 사용자가 결정한다.

### 33.1 켜는 법
- 서버 프로세스 환경변수 `COMBAT_MODEL=2` (예: `COMBAT_MODEL=2 npm run dev:server`). `1` 또는 미설정 = 현행. 방 설정(`lobby_update_settings`)에는 노출하지 않는다 (프로토콜 변경 없음).
- 코드: `createGameState(map, setup, botDifficulty, seed, combatModel?)` 5번째 인자(테스트·스크립트용). 기본값 `defaultCombatModel()` = 환경변수 → `shared COMBAT_MODEL`(1).
- `GameState.combatModel: 1 | 2`, `Flag.morale`(‰ 0..1000, 시작 1000; 모델 1에서는 1000 고정이고 아무도 읽지 않는다).

### 33.2 규칙 (설계 2·5절 그대로)
- 채널값 `a_c(f)` (ATK/DEF) = 병종 기본 × 지형표/기지(×1300 양 채널, 지형 항 대체) × 테크 채널 × 사기 곱 × 이탈(×0.7), 단계마다 floor, 최소 1. 편 채널값 V_c = 병력 가중 평균(하한 100), λ_c = 정수 역제곱(γ=2) 비율, 합성 `raw = ωA·λ_ATK + ωD·λ_DEF` (ω 600/400), 편 손실 = floor(T·raw/Σraw), 잔여는 편 key ASC 로 1 milli 씩, 편 병력 상한. **T = 편 수 × L (현행 식, 불변).**
- 사기: 교전(`inCombat`) tick 마다 창 −3 / 검 −6 / 기 −10 ‰, 비전투 +3, 자기 기지 칸 위 비전투 +10. 곱 `min(1500, 600 + floor((1100+테크가산−600)·m/1000))` (m=1000→1100, 800→1000, 0→600). 패주 시 0.
- tick 순서: 4a(읽기, `sideLossDetail`) → 4b(손실·inCombat·패주·이탈) → **4b 끝에서 `stage4c_updateMorale` (flagId ASC)** → 이후 단계. 이번 tick 패주한 깃발은 갱신을 건너뛴다(0 유지).
- 순수 함수: `shared/src/combatMath.ts` (`channelValues`, `moraleMultiplier`, `flagScalar`, `sideLossDetail`, `sideLossShares`, `groupTotalLoss`). 서버·봇·클라이언트가 같은 함수를 쓴다.
- 신규 상수(`shared/constants.ts`, 모두 `match_config.constants` 에 실림): `COMBAT_MODEL`, `CHANNEL`, `CHANNEL_COUNT`, `UNIT_STAT`, `TERRAIN_BUFF`, `BASE_BUFF`, `POSTURE_W`, `COMBAT_GAMMA`, `COMBAT_VMIN`, `DISENGAGE_VALUE_PERMILLE_V2`, `MORALE_MAX/FLOOR/FULL/MULT_CAP`, `MORALE_DROP_PER_TICK`, `MORALE_RECOVER`, `MORALE_RECOVER_BASE`, `MORALE_DELTA_INTERVAL`. 현행 상수는 삭제하지 않았다.
- 테크 예약 스탯 12칸: `TECH_STAT` 32..43 (`MORALE_FULL_BONUS`, `MORALE_DROP`, `MORALE_RECOVER` 각 공통 1 + 병종별 3). `TECH_STAT_COUNT` 32 → **44**, `TECH_STAT_BASE` 길이 44(앞 32칸 불변, 새 칸 기본값은 효과 없음). 노드는 만들지 않았다. 도우미 `techChannelPm`, `techMoraleDropPm`, `techMoraleRecoverPm`, `techMoraleFullBonus` (칸이 없는 구 설정이면 기본값으로 대체).

### 33.3 프로토콜 변경 (추가만 · 모델 2에서만 전송)
| 위치 | 변경 |
|---|---|
| `match_config` | `combatModel: 2` (모델 1 에서는 키 없음). `constants` 에 33.2 상수와 확장된 `TECH_STAT`/`TECH_STAT_BASE`(길이 44)·`TECH_STAT_COUNT`(44) — **이 상수 변경은 모델 1 서버에서도 나간다**(추가만) |
| `snapshot_full.flags[]` | `morale: 0..1000` |
| `snapshot_delta` | `moraleChanged: [flagId, morale][]` — `t % 5 == 0` 인 tick 에만(빈 배열 가능), 마지막으로 보낸 값과 다른 깃발만. 한 번도 안 보낸 깃발은 1000. 기준점은 `snapshot_full` |
| `combat_started.sides[]` | `power`(유지, 의미: ω 평균 스칼라·사기·이탈 반영) + `atk`, `def`(편 채널값 ‰), `lossPermille`(첫 tick 편 손실 비율 ‰, Σ≈1000), `morale`(병력 가중 평균 ‰). 넷 다 함께 |
`server/scripts/qa-schema.ts` 갱신 완료(위 필드 모두 옵셔널로 등록, 모델 1 메시지에는 없음을 테스트가 단언).

### 33.4 클라이언트 영향 (`client/` 는 수정하지 않음)
- 모델 1 서버 + 현 클라이언트: **영향 없음** (새 필드 없음, `TECH_STAT_BASE` 길이만 44. 클라이언트는 `match_config` 값으로 `techStatValues` 를 계산하므로 문제 없음 — 타입체크·클라이언트 테스트 통과).
- 모델 2 서버 + 현 클라이언트: 동작은 하나 **표시가 틀린다** — 교전 예상/툴팁이 현행 식(`flagValue` 계열)을 쓰면 승패 방향이 다르고, 사기·`lossPermille` 은 표시되지 않는다. 필요한 작업: 사기 막대(1.0 경계 m=800), 교전 막대(`lossPermille`), 타일 툴팁(지형표 4절), 예상 UI 는 `shared/combatMath` 사용, 테크 문구(`COMBAT_ATK/DEF` = 공격력/방어력 채널), `moraleChanged` 보간(`inCombat` + 병종 감소율 상수, 1초마다 서버 값으로 정정).

### 33.5 봇 (`bot.ts`, 모델 2에서만 분기)
- `valueAs`(가상 깃발)는 사기 1000 가정, `flagValue` 는 호환 스칼라 → 요격·배치 계산은 그대로.
- 후퇴 판단(`maintain` 3번)과 `extremelyOutmatched` 는 스칼라 대신 `combat.engageLossPerTick`(정확 손실, 편 2개) 으로 "버티는 시간 비"(병력/tick 손실)를 비교. 이탈 3초 손실 추정도 정확 함수(이탈 ×0.7 반영). 사기 < 400 이고 지는 중이면 교대(회수) [A-163].
- `BOT_ENGAGE_BREAK_RATIO_PERMILLE`, `BOT_INTERCEPT_RATIO_PERMILLE`, `retreatRatioPermille` 은 **재튜닝하지 않았다**(값 그대로).

### 33.6 이탈·패주·재출전·병합
- 이탈 대기: `inCombat` 이므로 사기 계속 감소, ×0.7. 이탈 완료·교전 종료 후 회복. 대치(blocked)는 비전투 → 회복. 패주 시 사기 0.
- **재출전·병합·분할은 코드에 존재하지 않는다**(귀환 도착 시 깃발은 삭제되고 병력은 풀로 돌아가며, 새로 발령하면 새 깃발=사기 1000). 따라서 설계 5.7 의 "재출전 이어받음 / 병합 가중 평균"은 **구현 대상이 없어 비활성**이다. 재지정(retarget)·태세 전환은 같은 깃발 객체라 사기가 자연히 유지된다.

### 33.7 검증

**모델 1 비트 동일 증명**: 변경 전 코드에서 `server/scripts/_golden.ts` 로 (방송 메시지 + 개인 메시지 전 tick JSON 연쇄 sha256, 최종 owners·flags·players·ledger sha256)를 뽑아 `server/test/combatModel2.test.ts` 에 고정. 변경 후 코드가 세 시나리오(G1 10인 NORMAL 시드 1000 4500 tick / G2 혼합 난이도 8인 시드 77 3000 tick / G3 10인 시드 1003 한 판 끝(9700 tick, 전투 591회))에서 **전부 같은 해시**. 기존 515건 테스트는 수정 없이 통과(전체 543건 = 515 + 신규 28).

**테스트 (신규 `server/test/combatModel2.test.ts` 28건)**: 문서 시나리오 숫자 재현(2.7 두 3×3 표, 지형 4종, 이탈 67.1, 기지 68.0/62.8/37.2, 사기 곱 경계·5.2 표·5.5 시계열), 총량 보존·편 순서·병력 상한·혼합 ω·정수 범위, 테크 예약 칸 무효과, 모델 1 골든 3종 + 새 필드 부재, 모델 2 결정론, 매 tick 회계 불변식 0·사기 범위·교전 감소/비전투 증가·스키마 통과(`validateMessage`), `match_config`, 4a 손실 == `sideLossShares`, 사기 −3/−6/−10·+3·+10·패주 0, `flagValue` 호환.

### 33.8 자가대전 비교 (M 10인 NORMAL, 시드 1000~1019, 같은 시드·설정, 20판)

| 지표 | 모델 1 (현행) | 모델 2 |
|---|---|---|
| 교전 길이 중간값 / p90 (그룹, 초) | 6.0 / 16.6 | 6.0 / 15.8 |
| (첫 시작 기준) | 10.2 / 21.6 | 9.8 / 18.2 |
| 병종 발령 비율 % 창/검/기 (개수) | 23.8 / 6.9 / 69.3 | 17.4 / 9.4 / 73.2 |
| (병력 가중) | 15.7 / 13.7 / 70.7 | 13.2 / 17.3 / 69.5 |
| 패주/판 (창/검/기) | 245.3 (110.0/11.9/123.5) | 185.5 (54.9/12.2/118.5) |
| **멸망/판** | **0.85** | **0.10** |
| 멸망 시각 중간값 (분) | 26.9 | 20.0 |
| 판 길이 평균 (최소~최대, 분) | 30.20 (27.2~32.0) | 29.78 (28.2~32.0) |
| 종료 사유 | threshold 13 / timeout 7 | threshold 16 / timeout 4 |
| 플레이어 기지 점령/판 | 12.7 | 11.3 |
| 약소국(기지 1개·≤60칸, 기지 2개 이상이었다가 줄어든 경우) 플레이어/판 · 접촉률 · 멸망률 | 1.60 · 100% · **25%** | 1.25 · 100% · **0%** |
| 전투 손실 병력/판 | 248,587 | 240,083 |

레버 탐색(모델 2, `BASE_BUFF` 1300 → 1200 / 1100): 멸망/판 0.10 → 0.25 / 0.30 (현행 0.85 에는 못 미침), 기지 점령/판 12.0 / 10.4, 판 길이 30.26 / 29.76분.

**지표 정의 [A-162]**: "마지막 기지 공격 도달률"의 기존 리뷰 정의가 없어 *약소국 기지(생존자 중 기지 1개·≤60칸, 그 전에 기지 2개 이상이었던 경우)의 칸 또는 이웃(거리≤1)에 적대 공격 태세 깃발이 접촉한 비율*로 정의했다. 이 정의로는 **양 모델 모두 100% 도달**(16/16, 18/18판)이라 도달률 자체는 병목이 아니다. 병목은 **도달 후 함락**이다.

### 33.9 [A] 항목
- **[A-160]** 모델 선택은 환경변수/인자뿐(방 설정·프로토콜 노출 없음). `constantsTable()` 은 자동 노출이라 새 상수·확장 `TECH_STAT` 이 모델 1 `match_config` 에도 실린다(추가만).
- **[A-161]** 사기 갱신은 `stage4b` 끝에서 호출(별도 tick 단계 아님), 이번 tick 패주 깃발은 건너뜀.
- **[A-162]** 마지막 기지 지표 정의(위).
- **[A-163]** 봇 교대 규칙: `BOT_MORALE_SHAKEN=400` 미만이고 버티는 시간 비 < 1 이면 회수. 편 2개(나 대 합산 적)로 근사.
- **[A-164]** 델타 `moraleChanged` 는 모델 2 의 `t%5==0` tick 에 항상 존재(빈 배열 포함), 다른 tick 에는 키 없음.
- **[A-165]** `combatInput` 은 가상 깃발(병력·사기 없음)을 받아 사기 1000, 병력 0 으로 처리.

### 33.10 남은 이슈·관찰
1. **모델 2 는 멸망을 거의 없앤다**(0.85 → 0.10/판, 약소국 멸망 25% → 0%). 설계 2.9 가 예측한 "약소국 정리 병목"이 실제로 확인됐다. 기지 ×1.3 양 채널 + 사기가 기병 위주 봇의 기지 돌파를 막는다. `BASE_BUFF` 하향은 일부만 회복(1200: 0.25). 판 길이는 유지(29.8분, 25~32 안).
2. 병종 쏠림: 기병 발령 비율이 69%(현행) → 73%(모델 2)로 약간 늘어 "한 병종 60% 초과 금지" 판정 기준은 현행에서도 이미 넘고 모델 2가 해결하지 못한다(설계는 기병 감소 압력을 예상했으나 반대). 창병 패주는 크게 줄었다(110 → 55/판).
3. 봇 상수 재튜닝·사기 감소율 레버(`MORALE_DROP_PER_TICK`)는 탐색하지 않았다. 기병 기세 테크 노드는 없다(설계대로).
4. 클라이언트는 모델 2 표시를 지원하지 않는다(33.4).

---

## §34 테크 개편 — 4티어 42노드 · 절대 점수 · 양자택일 · 기지 효과 (2026-10-24)

설계 원천: `06_tech_overhaul_draft.md` §10(노드 표 단일 소스). 모든 수치는 [A] 자리표시이고 밸런스는 계산하지 않았다.

### 34.1 프로토콜 변화
- `techMask`는 **53비트 안전 정수 한 필드**(JSON 정수 ≤ 2^53)다. 노드 id i = 비트 i, 노드 42개(0..41). 모양 불변, 비트 연산 대신 산술(`techOwned`·`techMaskWith`·`techMaskWithout`·`techCount`).
- `cmd_buy_tech.nodeId` 범위 0..41. 새 거절 사유 **`EXCLUSIVE_BLOCKED`**(양자택일 상대 노드를 이미 보유). 거절 순서: BAD_REQUEST → ALREADY_OWNED → PREREQ_MISSING → EXCLUSIVE_BLOCKED → INSUFFICIENT.
- `match_config.constants`: `TECH_NODES`(42개, `parentAlt?`·`exclusive?` 추가, tier 1..4), `TECH_NODE_BASE_COST` [160, 360, 700, 1200], `TECH_STAT_BASE` 47칸.
- `TECH_STAT_COUNT` 44 → 47: `BASE_DMG`(44, 기지 체력 피해 ‰), `BASE_RECOVER`(45, 생산력 회복 속도 ‰), `CAPITAL_PROD`(46, 수도 생산 ‰). 기본 1000.

### 34.2 규칙
- **선행**: 부모를 보유하거나(T1은 없음), T4는 `parent` 또는 `parentAlt` 중 하나를 보유하면 열린다. **양자택일**은 재정·행정 T2(ECO-2A↔2B, TER-2A↔2B)만이고, 한쪽을 사면 다른 쪽은 살 수 없다.
- **절대 점수**: `COMBAT_ATK`·`COMBAT_DEF`·`SPEED` 및 병종별 `*_SPEAR/SWORD/CAVALRY` 스탯은 **점수**다(1점 = 10‰, 기본 0). 모델 1 `flagValue`: 공격 = `UNIT_ATK_PERMILLE[unit] + 10 × 점수` 다음에 기지 ×1.5, 방어 = `(UNIT_DEF_PERMILLE[unit] + 10 × 점수) × 지형·기지 배율`. 모델 2 `channelValues`도 같은 방식으로 병종 기본에 점수를 더한 뒤 지형·기지 배율과 사기 곱을 곱한다. 이동 = `floor(140 × (UNIT_SPEED_PERMILLE + 10 × 점수) × 귀환 배율 / (지형 이동 × 1000))`. 점령비용·유지비·편성비·골드·재생·보급선은 ‰ 비율 그대로.
- **기지 효과**
  - 요새화(TER-2B, `BASE_DMG` −200): 기지 소유자 기준으로 깃발별 기지 체력 피해와 **tick 당 피해 상한(300)** 에 같은 배율을 곱한다.
  - 기지 재건(TER-3B, `BASE_RECOVER` +500): 매 tick 생산력 회복량(167/분 기준)에 배율. 기지 소유자 기준.
  - 수도 승격(TER-4, `CAPITAL_PROD` +300): 시작 수도 칸의 환산 칸 수(100)에 배율 → 130. 그 칸을 지금 소유한 플레이어 기준.
- 병력 상한(`TROOP_CAP`) 노드는 이번에 없다(스탯 칸은 남김). 전시 경제(새 효과)는 넣지 않았다.

### 34.3 봇
- 테크 우선순위 목록 4종(확장·재정·수비·기동)을 새 노드 코드로 다시 짰다. 로드 시 부모가 앞에 있는지, 양자택일 상대가 같은 목록에 없는지 검사한다. 검병 고정 봇은 `TECH_SWORD_SWAP`(CAV-1·2A·2B·3A·3B·4 → SWO-1·2B·2A·3B·3A·4).
- 목록 소진 뒤 대체 구매는 (티어 1..4, id) 순서로 선행 충족·택일 미충돌 노드.

### 34.4 시험
- 서버 `tech.test.ts` 전면 재작성(29건), `qa-schema` 범위(nodeId 0..41, techMask 안전 정수·`EXCLUSIVE_BLOCKED`), 골든 해시 3개 재고정(봇 목록 교체로 모델 1 행동이 바뀜). 전체 554건 통과.
- 전투 모델 2 적용(기본값 전환)은 별도(BACKLOG: 테크 개편과 함께 적용, 클라이언트 사기 UI 필요).

### 34.5 병종 정체성 반영 (2026-10-24 추가)
- 상수: `UNIT_ATK_MULT_PERMILLE` 1150/1000/850 → **1000/850/1500**(점령·기지 공격 병력 소모, 기병 ≫ 창 > 검), `UNIT_CONVERT_PERMILLE` 1000/1000/1150 → **900/1000/1300**(최초 동원비).
- 노드 변경: SPE-3B 버티는 대열 → 행군 장화(이동 +10), SWO-2B `set 950` → `add −100`, SWO-3A 방어 +20 → +10, SWO-3B 정예 보병 → 병참 보병(점령 소모 −100), SWO-4 백전노장 → 검병 사기 감소 −20%, CAV-2A 편성비 set 1200, CAV-4 철기 → 기병 공격 +30.
- 골든 해시·시험 값 재고정(전체 554건 통과). 사기 소모·기지 내구도 규칙은 전투 모델 2 적용 때 구현한다.

### 34.6 병종 수치 재조정 (2026-10-24)
- 기본값: `UNIT_ATK_PERMILLE` 900/1000/1200, `UNIT_DEF_PERMILLE` 1100/1000/900, `UNIT_SPEED_PERMILLE` 900/1000/1200, `UNIT_ATK_MULT_PERMILLE`(점령 소모) 1000/850/1400.
- 노드 변경: 설계 초안 §10·§12 참고 (SPE-1 이동, SPE-2A·3B 점령 소모, SWO-3B 공격, SWO-4 기세 +100, CAV-2A 유지비, CAV-3A 점령 소모 −200, CAV-3B 기세 +100 등). 골든 해시·시험 값 재고정(554건 통과).

### 34.7 재정·행정·기동 개편 (2026-10-24)
- `TECH_STAT_COUNT` 47 → 50: `GOLD_PLAIN`(47)·`GOLD_POOR`(48)·`CONVERT`(49) 추가, `CAPITAL_PROD`(46) → `BASE_PROD`(모든 기지). 노드 표는 설계 초안 §10·§13.
- 영토 골드 가중치 = 소유자 스탯의 지형 보너스 반영(`tileGoldWeight`), 테크 구매 시 재합산. 편성비 = 병종 기본 × `CONVERT`/1000(내림).
- 시험 555건 통과, 골든 해시 재고정.

### 34.8 군사 개편 (2026-10-24)
- MIL-1 REGEN +50, MIL-2B TROOP_CAP +60, MIL-3A ATK_COST −60, MIL-3B TROOP_CAP +60, MIL-4 SLOT_BONUS +1. 슬롯 보너스는 MOB-4 와 합산(최대 +2). 시험 554건 통과, 골든 해시 재고정.

### 34.9 공성 스탯 (2026-10-24)
- `TECH_STAT_COUNT` 50 → 51: `SIEGE`(50) 추가. MIL-2A +100, MIL-3A +150. `gauge.ts` applyBaseHits: 깃발별 피해 = dmg × (방어측 BASE_DMG × 공격측 SIEGE) / 10⁶, tick 당 상한도 방어측 × 공격측 최대 SIEGE 배율. 시험 555건 통과.

## 35. 전투 모델 2 기본값 전환 (2026-10-24)

- `COMBAT_MODEL` 기본값 1 → **2**. 환경변수 `COMBAT_MODEL=1` 또는 `createGameState(..., 1)` 로 모델 1 을 고를 수 있다(모델 1 경로·시험은 그대로 유지). `match_config.combatModel = 2` 가 기본으로 실린다.
- 기지 방어 배율은 문서(§33)의 1300 이 아니라 **`BASE_BUFF` 1200**(양 채널, A-166 레버 조정)이 현행값이다.

### 35.1 새 규칙 (모델 2 전용, 수치는 전부 [A])
- **기지 위 교전 → 기지 체력 소모** (`stage4d_baseCombatWear`, 4b 끝): 자기 기지 칸 위에서 교전 중(`inCombat`·비패주)인 깃발이 있으면 그 기지 체력이 tick 마다 `BASE_COMBAT_DMG_MILLI_PER_TICK`(40) 줄어든다. 기지당 1회(깃발·적 수 무관, 승패 무관). 체력 1 밑으로는 내려가지 않는다 — 함락은 여전히 기지 공격(게이지)으로만. `lastDamageTick`·`damagedThisTick` 을 남겨 체력 회복 지연과 봇 기지 위협 판단이 그대로 작동한다.
- **점령·기지 공격 → 사기 소모** (`stage7_combatPhaseB` 끝, flagId ASC): 그 tick 에 게이지를 민 깃발은 사기 −`floor(CAPTURE_MORALE_DROP(6) × 실효 점령 배율 / 1000)` (최소 1; 창 6 / 검 5 / 기 8, 테크 점령 소모 노드 반영). 비전투 회복(+3, 기지 위 +10)과는 별도로 겹쳐 계산된다.

### 35.2 클라이언트
- 사기 표시: 부대 칩 미니 막대, 부대 정보 패널 「사기 ▮▮▯ 92% 전투력 +7%」(80% 눈금 = 전투력 ×1.00 경계)과 「지금 공격/방어」(지형·기지·사기·이탈 반영, `shared/channelValues`), 캔버스 깃발 아래 막대. 색 + 수치 병행.
- `GameModel`: `moraleChanged` 델타 반영, `flag_issued` 새 깃발은 1000. 서버가 1초마다 보내는 값을 그대로 보인다(추정 보간 없음).
- 기지 위 문구는 모델 2 에서 `BASE_BUFF`(×1.2 공격·방어), 모델 1 에서 ×1.5.
- 교전 예상(2026-10-24): 교전 중인 깃발의 부대 정보에 「교전 예상 내 쪽 손실 N% · 상대 M% — 유리/접전/불리」. `client/src/ui/engagePreview.ts` 가 `render/combatPairs`(서버 전투 간선과 같은 규칙)로 교전 그룹을 찾고, 서버 4a 와 같은 입력으로 `sideLossDetail` 을 불러 편 손실 비중(`lossPermille`)을 낸다. 유리 ≤40%, 불리 ≥60%(표시용 구분선, 규칙 아님). 총 손실 바닥항은 시작 병력을 몰라 현재 병력으로 근사하므로 절대 손실량은 보이지 않는다. 프로토콜 변경 없음.

### 35.3 시험·측정
- 서버 모델 1 전제 시험(flags·v44·v45·tech 일부)은 `createGameState(..., 1)` 로 고정. `combatModel2.test.ts` 에 기지 소모·점령 사기 시험 추가, 사기 불변식은 공격 태세 깃발의 점령 소모를 허용. 클라이언트 `morale.test.ts` 신규. 전체 통과.
- 자가대전(M 10인 NORMAL, 시드 1000~1005, 6판): 모델 1 평균 종료 30.4분(28.9~32.0) / 모델 2 평균 30.5분(28.95~32.0), 멸망/판 0.7 → 1.7. 병종 출전 기병 93.8% → 92.4%. 밸런스 일괄 패치 때 다시 본다.

## 36. 밸런스 패치 1차 — 기병 쏠림 완화 · 신중형 봇 (2026-10-24, 사용자 결정, 모두 [A])

프로토콜 변경 없음. 수치·봇 행동만 바뀐다.

### 36.1 수치
| 항목 | 이전 | 이후 |
|---|---|---|
| 기병 편성비 `UNIT_CONVERT_PERMILLE[기병]` (병력 풀에서만 빠짐, 골드 아님) | 1300 | 1600 |
| 기병 유지비 가중 `UNIT_GARRISON_PERMILLE[기병]` (골드 수입에서 차감) | 1600 | 2000 |
| 마구간 CAV-2A (기병 유지비 가중 set) | 1300 | 1600 |

### 36.2 봇
- **중립지 확장은 검병**: `chooseUnit` 이 중립 앵커(kind 0)에 검병을 고른다(구 기병). 적 영토·기지 공격은 종전 규칙. EASY 는 원래 검병 고정.
- **신중형(구 수비형)**: 성향 ≤ `BOT_CAUTIOUS_MAX_AGGRESSION_PERMILLE`(333)인 봇은 `botKnobs().cautious`. 적 공격 후보(국경 칸·적 기지)는 상대 총병력(풀+깃발) < 내 총병력의 `BOT_WEAK_RATIO_PERMILLE`(50%)일 때만 고려하고(`mayAttackFoe`), 적 공격 발령 병력 비율은 `BOT_CAUTIOUS_COMMIT_ENEMY_PERMILLE`(70%, 그 외 35%). 중립지 확장·방어·요격은 그대로. 관전 라벨 '수비형' → '신중형'.

### 36.3 수정: 사기 전체 스냅숏이 델타와 어긋나던 문제
중간 입장·재접속이 받는 `snapshot_full` 의 사기는 정확한 현재값이었고 `moraleChanged` 델타는 "마지막으로 보낸 값"과 비교해 보냈다. 델타 사이에 흔들렸다 제자리로 돌아온 사기는 입장자에게 다음 전체 스냅숏까지 어긋난 채 남았다. `GameState.moraleShown`(표시 전용, 규칙 무관)에 델타로 보낸 값을 두고 전체 스냅숏도 그 값을 싣는다.

### 36.4 측정 (M 10인 NORMAL, 시드 1000~1007, 8판, 모델 2)
| 지표 | 패치 전 | 패치 후 |
|---|---|---|
| 기병 공격 발령 비중 | 92.7% | 28.8% (검병 71.2%) |
| 평균 종료 | 30.6분 | 30.4분 (임계 5 / 시간초과 3) |
| 판당 탈락 / 수도 점령 | 1.9 / 6.8 | 2.0 / 7.3 |
| 성향 구간별 평균 점유율 (하위·중간·상위) | 5.4 · 9.4 · 14.0% | 5.0 · 9.4 · 14.2% |
| 5분 시점 중립지 잔여 | 30.5% | 29.1% |

신중형은 우승 0회로 더 약해졌다(약한 적이 드물어 후반 공격 기회가 적다). 다음 패치 후보: 신중형 약한 적 기준(50%) 완화, 탈락·수도 점령 증가 억제(기지 방어 수치).

### 36.5 패치 2차 — 방어 사기 절반 · 기지 소모 절반 · 함락 퇴각 (2026-10-24, 사용자 결정, 모델 2 전용, 모두 [A])
- **방어 태세 사기 감소 절반**: `stage4c_updateMorale` — 교전 중 방어 태세 깃발의 감소량 = `ceil(감소 × MORALE_DROP_DEFEND_PERMILLE(500) / 1000)`(최소 1). 창 3→2 / 검 6→3 / 기병 10→5. 공격 태세는 그대로.
- **교전 기지 소모 절반**: `BASE_COMBAT_DMG_MILLI_PER_TICK` 40 → 20.
- **함락 시 퇴각**: `stage7` 기지 점령 직후, 그 칸(`posTileId == B`) 위의 이전 주인·동맹 깃발(패주·이미 귀환 중 제외)을 `beginReturn` 으로 귀환시키고 `flag_recalled` 를 낸다. 교전 중이면 `disengageHold`(이탈 대기 동안 접촉 유지). 마지막 기지(멸망)는 12단계에서 깃발이 모두 사라지므로 건너뛴다. **현행 규칙상 교전 가능한 적대 깃발이 서 있는 기지는 밀 수 없으므로(§21), 실제로 이 퇴각이 일어나는 것은 이탈을 마친(`breakaway`) 깃발이 기지 칸에 남아 있는 경우다.**
- 측정(M 10인 NORMAL, 시드 1000~1015, 16판): 평균 종료 30.3분(임계 10 / 시간초과 6), 기병 공격 발령 28.6%, 판당 탈락 2.0 → 1.2, 판당 수도 점령 7.3 → 5.2(패치 1차는 8판), 성향 구간 평균 점유율 하위 5.6 · 중간 9.5 · 상위 14.2%(우승 2 · 4 · 10).

### 36.6 패치 3차 — 깃발이 서 있어도 기지 체력이 0 이면 함락 (2026-10-24, 사용자 결정, 모델 2 전용)
- **교전 소모로 함락**: `stage4d_baseCombatWear` 에서 체력의 하한 1 을 없앴다. 소모(tick 당 −20, 기지당 1회)로 0 이 되면 기지가 함락된다. 차지하는 쪽 = 그 칸과 접촉(같은 칸 포함, 8방향)한 **교전 중 적대 깃발 가운데 병력이 가장 큰 깃발의 주인**(동률 flagId 작은 쪽). 그런 깃발이 없으면 체력은 1 에서 멈춘다.
- **함락 처리 통합**: `server/src/game/basecapture.ts` 의 `captureBase` 를 게이지 경로(`gauge.applyBaseHits`)와 교전 소모 경로가 함께 쓴다 — 소유권 이전, 체력 50%·5초 무적, 생산력 ×0.5(마지막 기지는 면제), 이전 주인(·동맹) 깃발 퇴각(§36.5), `base_captured`. 멸망·합병은 종전대로 12단계.
- 기지 칸 위에 교전 가능한 적대 깃발이 있으면 공격자가 기지를 직접 밀지 못하는 규칙(§21)은 그대로다. 서 있는 깃발 아래서 기지가 무너지는 길은 이 교전 소모 하나다.
- 소모 속도는 −20 유지(교전이 3분 45초 지속돼야 함락). 측정(16판, 시드 1000~1015): 평균 종료 30.5분, 판당 플레이어 기지 점령 11.4 → 12.8, 수도 점령 5.2 → 6.2, 탈락 1.2 → 1.3, 성향 구간 점유율 5.9 · 9.4 · 14.0%(우승 2 · 5 · 9).
