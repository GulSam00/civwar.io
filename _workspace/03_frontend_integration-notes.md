# civwar.io 프론트엔드 통합 노트 — Phase 5 1차

> 작성 2026-10-09, frontend-game-client-engineer. 기준: `_workspace/02_backend_protocol.md`(3차-1 + 3차-2 + QA 후속, 커밋 `99581b9`), `PROTOCOL_VERSION = 1`.
> 범위: 클라이언트 골격 · 연결/재접속 · 로비/대기실 · 맵·영토 Canvas · 깃발 표시 · 깃발 발령/재지정/회수/태세 전환 · 최소 HUD · 게임 종료 화면.

## 1. 구조

```
client/                       # npm workspace @civwar/client (React 18 + TS + Vite 5, UI 프레임워크 없음)
  index.html, vite.config.ts  # dev 5173, /ws → ws://localhost:8080 프록시 (CIVWAR_SERVER 로 변경)
  src/
    main.tsx                  # ClientStore 생성(localStorage 토큰), dev 에서 reconCheck=true, window.__civwar
    App.tsx                   # 화면 전환: room_state.phase + match_config 로만 (Lobby / WaitingRoom / GameScreen)
    net/socket.ts             # GameSocket: 연결·지수 백오프 재접속(최대 8s)·JSON. close 4000 이면 재접속 안 함
    state/gameModel.ts        # ★ 상태 리듀서 (부트스트랩 → 이벤트 → delta → full 덮어쓰기). qa-headless 재구성 모델 기반
    state/store.ts            # 세션·hello 큐·룸·게임 모델·clientSeq/cmd_ack·토스트. React 엔 lobby 수준 변경만 알림
    render/topology.ts        # ★ TopologyView — tileId↔좌표, pixel→tile, 타일 그리기, 거리/disk/거리장, 경계선. 사각 전제 식은 여기만
    render/camera.ts          # 월드(타일 단위)↔화면, 팬·줌
    render/renderer.ts        # rAF 렌더러 (모델 읽기 전용): 타일 레이어 → 경계 → 게이지 칸 → 예고 원 → 기지 → 앵커 선 → 깃발
    render/flagInterp.ts      # 깃발 위치 단조 이징 보간 (스냅 금지)
    render/palette.ts         # 지형 7색, 플레이어 12색
    input/controller.ts       # 마우스·키보드 → 카메라/명령
    input/preview.ts          # 커서 예고(GDD 4.3 표), 비율→병력 변환
    ui/*.tsx, ui/text.ts      # 로비·대기실·인게임 HUD·깃발 패널·게임 종료, 거절 코드 한국어
  test/                       # vitest: gameModel / render / store (23 tests)
  scripts/headless-check.ts   # 실제 서버 ws 에 리듀서를 붙여 full 불일치 검사
scripts/dev.mjs               # 서버 + 클라이언트 동시 실행
.claude/launch.json           # 미리보기용 (civwar-server 8080 / civwar-client 5173)
```

`@civwar/shared` 는 빌드 없이 TS 소스 그대로 import(프로토콜 §1). 타입·상수·`rleDecode`·`isClaimable`·`FLAG_BIT` 재사용, 클라이언트에 프로토콜 타입 재정의 없음.

## 2. 실행

```
npm install
npm run dev              # 서버(tsx watch, 8080) + Vite(5173) 동시. 브라우저 http://localhost:5173
# 또는 따로: npm run start:server / npm run dev:client
npm run build:client     # client/dist (gitignore)
npm run typecheck        # shared + server + client
npm test                 # 서버 + 클라이언트 vitest (11 파일 / 145)
npx tsx client/scripts/headless-check.ts 75 ws://localhost:8080   # 서버 기동 후
```
WS URL: `?ws=` 쿼리 → `VITE_WS_URL` → `ws(s)://<host>/ws`(Vite 프록시). 서버는 경로를 보지 않으므로 직결(`?ws=ws://localhost:8080`)도 된다.

## 3. 프로토콜 사용 방식

| 단계 | 처리 |
|---|---|
| 연결 | 로드 시 소켓 연결. 저장된 `playerToken`+닉네임이 있으면 즉시 `hello`(재접속 시도). 없으면 사용자가 빠른 시작/방 만들기 등을 누를 때 `hello` → `welcome` 후 큐에 쌓인 로비 메시지 송신 |
| 내 playerId | `room_state.players[].sessionId == welcome.sessionId` 를 **매번** 찾는다(비공개 방 카운트다운 재번호 §3) |
| 부트스트랩 | `match_config` → `new GameModel` / `map_init` → 지형·스폰·기지 / `snapshot_full` → `ready`. ready 전 delta·이벤트 무시 |
| 매 tick | 이벤트(상태 필드 있는 것만 반영) → `snapshot_delta` → (`t%25==0`) `snapshot_full` 로 통째로 덮어쓰기 |
| delta 규칙 | `tileChanges`(+기지 ownerId), `playerDeltas`(+flagCap 문서식 §8), `flagMoves`, `flagStats`, **`flagProgress` 목록에 없는 깃발 = 0**, `flagTargets`, `baseHp`, `flagsGone`, `thresholdPct?`, `flagFlags` 비트(FLAG_BIT) |
| 이벤트 반영 | `flag_issued`(새 깃발, state MARCHING, pos=origin) · `flag_retargeted` · `flag_posture_changed`(**targetOwnerId 덮어쓰기** I-1) · `flag_disengage_started` · `flag_routed`/`flag_disengaged`(disengageUntilTick=null) · `flag_ended` · `tech_purchased`(tech, newFlagCap) · `player_eliminated` · `player_reconnected` · `endgame_rush` · `threshold_update` · `base_captured` · `ally_*` · `alliance_lockout`. 나머지 이벤트는 표시 전용, 모르는 type 무시 |
| `connected` | full / `player_reconnected` / `room_state.status == DISCONNECTED` |
| 명령 | `cmd_flag_issue`(originBaseTileId null), `cmd_flag_retarget`, `cmd_flag_recall`, `cmd_set_posture`. clientSeq 단조 증가, `cmd_ack` 거절 → 한국어 토스트. 낙관적 예측 없음 |
| 로비 | `lobby_join_public`, `lobby_create_private`(map random S/M/L 또는 preset, maxPlayers, botCount, botDifficulty), `lobby_join_private`, `lobby_spectate`, `lobby_set_ready`, `lobby_start_now`, `lobby_update_settings`(방장: 인원·봇·난이도), `lobby_leave`. `error` → 토스트 |
| 화면 전환 | LOBBY/COUNTDOWN → 대기실, IN_GAME/GAME_OVER + 모델 → 게임. `game_over` 수신 시에만 종료 오버레이 |

**렌더/상태 분리**: WS 수신은 모델만 바꾼다(React 렌더 없음). Canvas 는 마운트 시 1회 시작한 rAF 루프가 매 프레임 모델을 읽고, 타일 레이어는 `dirtyTiles`/`ownersVersion` 으로 증분 갱신(1 타일 = 1 픽셀 오프스크린 + 확대), 경계선 Path2D 는 최대 5Hz 재생성. HUD 는 100~150ms 폴링으로 `model.version` 이 바뀔 때만 다시 그린다.

**깃발 보간(GDD 미결정 9)**: 칸이 바뀌면 "현재 그려진 위치"에서 새 칸 중심까지 easeOutQuad, 구간 시간 = 그 깃발의 칸 변경 간격 EMA(150~2500ms). 목표를 지나치거나 튀지 않는다(테스트).

**화면 표시**: 공격 = 마름모 + 붉은 테두리, 방어 = 원 + 푸른 테두리(색 + 모양 이중 신호), 병종 글자(창/검/기), 병력 수, 공격·교전 진척도 바 + 대상 칸 채움(진척도 비례), 교전 = 붉은 맥동 링, 패주 = 회색·점선·반투명, 태그(패주/이탈/대치/정체/귀환/대기), 이탈 대기 = 노란 감소 호, 선택 깃발 = 흰 링 + 태세 쿨타임 링, 내 깃발·선택 깃발 → 앵커 점선. 기지 = 소유자 색 사각(수도는 이중 테두리) + 체력 바 + 수도에 닉네임.

**조작**: `1/2/3` 병종(창/검/기) → 커서 예고(붉은/푸른/회색 반경 6 disk + 툴팁 "공격 태세 · 대상 n타일" 등) → 좌클릭 발령(Shift 유지). `Q/E`(`[ ]`) 비율 ±10%(병력 = floor(풀×비율×MOB_CONVERT/UNIT_CONVERT), 풀 차감이 비율 몫을 넘지 않음). 깃발 좌클릭 선택 → 우클릭 재지정, `F` 태세, `R` 회수, `Tab` 내 깃발 순환, `Esc`, `H` 수도, `0` 전체, 드래그/WASD 팬, 휠 줌.

## 4. 문서와 다르게 해석하거나 문서에 없어 정한 것

1. **flagCap 은 `playerDeltas` 수신 시 문서 §8 식으로 다시 계산**(delta 에 flagCap 이 없음). 테크는 `tech_purchased.newFlagCap`. full 과 불일치 0 확인.
2. **troopCap(HUD) 은 §8 식을 클라이언트에서 계산**(서버 미전송). 표시 전용.
3. **커서 예고의 "대상 n타일"은 front 근사**(원 안 · 앵커 소유자 · 내 땅 인접) — 서버 front 와 같은 정의지만 `targetOwnerId`·동맹 세부까지 재현하지 않음. 사거리 밖(>40)·물·동맹은 회색. 예고는 표시용이고 서버 거절을 대신하지 않는다 — 회색이어도 클릭하면 명령을 보내고, 서버 `cmd_ack` 거절을 토스트로 보여준다.
4. **진척도 감소(되돌리기 대체) 시각 구분은 1차에 없음** — 대상 칸 채움·진척 바가 그대로 줄어든다(GDD 7.6 "후퇴는 플래시" → 2차).
5. 공개 룸 대기실의 자동 시작 남은 시간은 서버가 주지 않으므로 "30초 후 자동 시작" 안내 문구만(카운트다운은 `countdownMs` 로 표시).
6. 로비/대기실 중 소켓이 끊기면 서버가 즉시 퇴장시키므로(§3) 클라이언트도 룸 상태를 비운다. 인게임은 토큰 재접속으로 복구(새로고침 포함 — 확인함).
7. `lobby_leave` 에는 서버 응답이 없어서 송신 즉시 로컬 룸 상태를 비운다.

## 5. 검증

- `npm run typecheck` 통과(client 포함), `npm test` 11 파일 / 145 통과(클라이언트 23), `npm run smoke` `SMOKE PASSED`, `npm run build:client` 성공.
- **리듀서 vs 서버 시뮬레이션**(`client/test/gameModel.test.ts`): 실제 `Simulation`+`CivBot` 메시지를 JSON 왕복해 적용 — M 10인 HARD 2000 tick 80회 full 불일치 0, S 6인 중간 입장 모델(25 tick 마다 새 부트스트랩) 불일치 0.
- **실제 서버 ws 헤드리스**(`headless-check.ts 75`): 비공개 방 봇 9 HARD, 359 tick, full 비교 14회 불일치 0, cmd_ack 수락 24 / 거절 0, 수신 flag_issued 54·flag_engaged 48·flag_recalled 13·flag_ended 40·flag_posture_changed 6.
- **브라우저(Claude 내장 브라우저, 800×600)**: 닉네임 → 빠른 시작 → 공개 방 대기실 → 30초 자동 시작 → 맵·영토·기지·봇 깃발 렌더 → `3` 기병 + 클릭 발령(중립 3칸 점령 후 소진) → `2` 검병 100% 발령 → Tab 선택 → `F` 방어 전환(쿨타임 링) → 즉시 `F` 재시도 = `POSTURE_COOLDOWN` 토스트 → 우클릭 재지정(공격 자동 재파생) → `R` 회수(귀환 태그). 새로고침 → 토큰 재접속으로 같은 게임 복귀. 개발 모드 reconStats full 15회 불일치 0, 콘솔 오류 0. 게임 종료 오버레이는 store 에 `game_over` 를 주입해 렌더·"로비로" 복귀만 확인(실제 32분 판은 미실행). 방 만들기 패널에 공식 맵 9장 표시 확인.

## 6. 2차로 넘길 것

- HUD 완성: 테크 구매 UI(`cmd_buy_tech`), 골드 수입·유지비(`upkeepPm`) 표시, threshold 곡선·내 점유율 대비, 미니맵, 이벤트 피드(전투·함락·탈락), 이모트.
- 동맹 UI(제안·수락·파기·Lockout 카운트다운·동맹 영토 표시), 관전 UI(플레이어 따라가기·관전자 HUD), 도움말(규칙) 페이지.
- 방 설정 UI 세부: 물 설정(SHALLOW_QUOTA), 공식 맵 미리보기, 추천 인원 경고·pacingNote 세분, 방장 위임 표시.
- 깃발: 출발 기지 지정(`originBaseTileId`), 진척도 감소/전진 시각 구분(GDD 7.6), 공격 방향 그라데이션, 전투 무리(`combat_*`) 연결선, ETA 표시(`etaTick`), 다중 선택, 사거리(40칸) 경계 표시, 색각 보조 패턴.
- 성능: 큰 줌아웃에서 깃발 다수일 때 라벨 생략(LOD), 경계선 증분 갱신.
- 모바일 관전 레이아웃(현재 PC 우선 — 좁은 화면에서는 커맨드 바가 좌하단으로만 이동).
