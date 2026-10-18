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
4. ~~진척도 감소 시각 구분 없음~~ → 2차에서 구현, QA 후속에서 판정 정정(같은 대상 칸에서 줄 때만 — `render/progressRule.ts`, §8).
5. ~~자동 시작 남은 시간 없음~~ → 2차에서 서버 `room_state.autoStartMs` 추가로 해소.
6. 로비/대기실 중 소켓이 끊기면 서버가 즉시 퇴장시키므로(§3) 클라이언트도 룸 상태를 비운다. 인게임 **플레이어**는 토큰 재접속으로 복구(새로고침 포함). **관전자는 새로고침하면 로비로 돌아간다**(관전 세션은 끊김 즉시 폐기 — 프로토콜 §3, 코드를 다시 입력).
7. `lobby_leave` 에는 서버 응답이 없어서 송신 즉시 로컬 룸 상태를 비운다. 룸이 이미 정리됐으면 서버가 `NOT_IN_ROOM` 을 보내는데, 나가기 직후 5초 동안은 무시한다.

## 5. 검증

- `npm run typecheck` 통과(client 포함), `npm test` 11 파일 / 145 통과(클라이언트 23), `npm run smoke` `SMOKE PASSED`, `npm run build:client` 성공.
- **리듀서 vs 서버 시뮬레이션**(`client/test/gameModel.test.ts`): 실제 `Simulation`+`CivBot` 메시지를 JSON 왕복해 적용 — M 10인 HARD 2000 tick 80회 full 불일치 0, S 6인 중간 입장 모델(25 tick 마다 새 부트스트랩) 불일치 0.
- **실제 서버 ws 헤드리스**(`headless-check.ts 75`): 비공개 방 봇 9 HARD, 359 tick, full 비교 14회 불일치 0, cmd_ack 수락 24 / 거절 0, 수신 flag_issued 54·flag_engaged 48·flag_recalled 13·flag_ended 40·flag_posture_changed 6.
- **브라우저(Claude 내장 브라우저, 800×600)**: 닉네임 → 빠른 시작 → 공개 방 대기실 → 30초 자동 시작 → 맵·영토·기지·봇 깃발 렌더 → `3` 기병 + 클릭 발령(중립 3칸 점령 후 소진) → `2` 검병 100% 발령 → Tab 선택 → `F` 방어 전환(쿨타임 링) → 즉시 `F` 재시도 = `POSTURE_COOLDOWN` 토스트 → 우클릭 재지정(공격 자동 재파생) → `R` 회수(귀환 태그). 새로고침 → 토큰 재접속으로 같은 게임 복귀. 개발 모드 reconStats full 15회 불일치 0, 콘솔 오류 0. 게임 종료 오버레이는 store 에 `game_over` 를 주입해 렌더·"로비로" 복귀만 확인(실제 32분 판은 미실행). 방 만들기 패널에 공식 맵 9장 표시 확인.

## 6. 2차 (2026-10-09) — 추가 구현

| 영역 | 내용 | 파일 |
|---|---|---|
| 테크 | `T` 패널: 4축 × T1~T3, 가격(§4 식, 총구매수 누진), 살 수 있음/골드 부족/잠김 표시, 효과 문구는 **상수에서 생성**(군사 깃발 전투 ×1.025~1.075, 기동 물 위 이동·노출 소모·상륙/물 대 물 전투 포함). `cmd_buy_tech` → ack | `ui/panels.tsx`, `ui/techInfo.ts` |
| 골드·유지비 | HUD 골드 `+n/초`(§8 식: goldWeight·경제 테크·upkeepPm), 유지비 −% 표시(30% 이상 경고) | `ui/GameScreen.tsx` |
| 미니맵 | 좌하단. 타일 레이어 축소 + 깃발 점 + 카메라 사각형, 클릭·드래그로 이동(월드 경계 비율 — 토폴로지 무관) | `render/renderer.ts` |
| 이벤트 피드 | 전원 공지(기지 함락·탈락·동맹 체결/파기/봉쇄·종반 러시·승리 기준 하락·봇 인계/재접속) + 나(관전 시 따라가는 플레이어) 관련(전투 개시·패배/패주·깃발 종료·정체·진척도 감소로 0·IDLE·테크 구매). 중요 항목은 토스트 | `state/feed.ts`, `ui/panels.tsx` |
| 외교 | `P` 패널: 제안/수락/거절/파기, 제안 만료, 최소 유지(파기 가능까지), BREAKING 해제까지(백스탭 쿨다운), 신규 마감까지, 재체결 금지, Lockout 카운트다운(HUD 에도), 동맹 수 한도. 받은 제안은 패널을 닫아도 상단 카드 | `ui/panels.tsx` |
| 관전 | HUD "관전 · 닉네임", 순위표 이름 클릭 = 따라가기(수도, 잃으면 영토 무게중심), 드래그·키·미니맵 = 자유 카메라, 전원 순위표, 명령 UI 숨김. 탈락자도 동일 | `ui/GameScreen.tsx`, `ui/panels.tsx` |
| 도움말 | 로비 「규칙 도움말」·인게임 `?` — 목표/승리·기준·타임아웃, 깃발, 태세, 게이지·감소, 깃발 전투·지형, 대치(ZOC)·후퇴 페널티, 물·상륙, 기지, 테크·골드, 동맹, 종반, 조작. 수치는 shared 상수에서. 튜토리얼 없음 | `ui/Help.tsx` |
| 방 설정 | 무작위 맵 물 구성(기본 / 얕은 물 비율 → SHALLOW_QUOTA), 공식 맵 썸네일(지형·스폰·기지), 추천 인원 이탈 경고 + 예상 판 길이(생성 전 = 서버 pacingNote 와 같은 식, 생성 후 = 서버 값). 대기실에도 썸네일·물 설정 | `ui/Lobby.tsx`, `ui/pacing.ts`, `ui/officialMaps.ts`, `render/mapPreview.ts` |
| 출발 기지 | 병종 선택 중 내 기지 `Alt+클릭` / 기지 위 `B` → `originBaseTileId`(노란 링 + 점선, 커맨드 바 표시·해제). 기지를 잃으면 자동 해제 | `input/controller.ts` |
| 진척도 표시 | 대상 칸을 공격자 땅 쪽에서 진척도만큼 채우는 **방향 그라데이션**. 전진은 부드럽게, **감소 중이면 회색 + 흰 테두리 깜빡임 + ▼**(GDD 7.6) | `render/renderer.ts` |
| ETA | `flag_issued`/`flag_retargeted(auto:false).etaTick` → 모델 `flagEta`(engaged·idle·recalled·ended 에 삭제) → 내 행군 깃발 라벨 "병력 · n초", 깃발 패널 | `state/gameModel.ts` |
| 색각 보조 | `C`(저장됨): 플레이어별 12종 무늬를 영토에 겹침(화면 크기 고정) + 깃발 플레이어 번호 배지 + 수도 이름·순위표 번호 | `render/patterns.ts` |
| 라벨 LOD | 화면 안 깃발 > 36 또는 줌 < 7 → 남의 깃발 작게·라벨 생략(내·선택 깃발은 항상 전체) | `render/renderer.ts` |
| 모바일 | `(max-width:760px), (pointer:coarse)` → 관전·간단 보기: 축약 HUD, 상위 4 순위표, 작은 미니맵, 커맨드 바·테크·외교·피드 숨김, 한 손가락 이동·핀치 확대·탭 선택(명령은 PC) | `ui/GameScreen.tsx`, `input/controller.ts` |
| 공개방 자동 시작 | **서버 필드 추가** `room_state.autoStartMs`(프로토콜 §5·§10-72·§16·§17) → 대기실 "n초 후 자동 시작" + 진행 바 | `server/src/room/room.ts`, `shared/src/protocol.ts`, `ui/WaitingRoom.tsx` |

### 2차에서 문서와 다르게/문서에 없어 정한 것
8. **공식 맵 썸네일 데이터는 번들에서**: `welcome.officialMaps` 는 메타만 주므로 `server/maps/official/*.json` 을 Vite `import.meta.glob`(지연 로드)으로 번들. 번들에 없는 id 는 "미리보기 없음". 서버가 다른 맵 세트로 배포되면 어긋날 수 있다 → 필요 시 `officialMaps[]` 에 미리보기 필드 추가를 백엔드에 제안.
9. **방 생성 전 판 길이 추정**은 서버 pacingNote 식 복제(`ui/pacing.ts`) — 무작위 S/M/L × 인원 × 난이도 전 조합에서 서버 함수와 같은 결과(테스트). 시작 인원 = 방장 + 봇.
10. 골드 초당 수입·테크 가격·효과 문구는 §4/§8 식 + `match_config.constants` 로 계산(표시 전용).
11. 피드의 "나 관련" 판정은 이벤트 적용 **전** 깃발 소유자 기준.
12. 공개 룸에서도 서버 `isHost` 대로 "방장" 태그가 보인다(권한은 없음 — 미세 이슈).

### 2차 검증
- typecheck 통과, `npm test` 12 파일 / 152 통과(클라이언트 29: `panels.test.ts` 6 추가, 서버 `rooms.test.ts` +1 autoStartMs), smoke PASSED, `qa:ws` 73/73(스키마 위반 0, `qa-schema.ts` 에 autoStartMs 반영), build:client 성공(공식 맵 9 청크).
- `headless-check.ts 75`: full 14회 불일치 0, ack 수락 23 / 거절 0.
- 브라우저: **패널이 숨겨져 스크린샷·rAF 불가** → 페이지에서 rAF 를 setTimeout 으로 대체하고 DOM·캔버스 픽셀로 확인(눈으로 본 것 아님). 썸네일 렌더, S + 얕은 물 40% 방 → 대기실 표시·예상 26분(서버와 동일) → 게임 캔버스·미니맵 렌더, HUD 골드 수입, 검병 발령(ETA 기록), Alt+클릭 출발 기지 → `accepted`, `flag_issued.originTileId == 수도`, 테크·외교 패널, 봇에 동맹 제안·피드, 색각 보조 픽셀 변화, 도움말 열기/Esc, 관전 따라가기 → 자유 카메라, 공개방 "28→25초 후 자동 시작", 모바일 375×812 narrow 레이아웃·가로 넘침 0·토큰 재접속. reconStats full 18회 불일치 0, JS 오류 0.

## 7. 남은 일
- 감소 플래시·방향 그라데이션 중간 상태·교전 링 등 **실제 장면 스크린샷 확인**(Phase 6 QA 에서도 장면을 못 만듦).
- 모바일 명령(현재 보기 전용), 전투 무리 연결선, 다중 선택, 사거리 경계 표시.
- 공개 룸 "방장" 태그 정리(서버 `isHost` 의미), 이벤트 피드가 800×500 에서 좌하단 맵을 덮는 배치 판단.

## 8. Phase 6 통합 QA 후속 (04_qa_report_full.md §2)

| ID | 처리 | 위치 |
|---|---|---|
| J-1 | HUD "나가기"(좁은 화면 포함). 진행 중 판의 생존자는 확인 대화상자("90초 뒤 봇이 대신 조종 · 다시 돌아올 수 없음"), 탈락자·관전자·종료 후는 바로 나감 → `lobby_leave` + **저장 토큰 삭제**(새로고침해도 그 판으로 안 돌아감, 다음 룸 입장 때 다시 저장) | `ui/GameScreen.tsx requestLeave/LeaveDialog`, `state/store.ts leaveRoom` |
| J-2 | 서버: GAME_OVER 룸 개인 부트스트랩 뒤 `game_over` 재송신(§2·§5·§10-73). 클라이언트: `room.phase === 'GAME_OVER'` 이면 명령 금지, `game_over` 가 없어도 종료 오버레이(마지막 상태로 순위 표시, "결과를 받지 못해…" 문구) + "로비로" | `server/src/room/room.ts`, `input/controller.ts canCommand`, `GameOverOverlay` |
| m-1 | 나가기 직후 5초 `NOT_IN_ROOM` 무시 | `store.ts` |
| m-2 | 관전자 새로고침 → 로비: 문서화(§4-6, 프로토콜 §3·§10-76) | 문서 |
| m-3 | 감소 판정 = 같은 `targetTileId` 에서 진척 하락만 (`isDecayTick`), 대상 바뀌면 표시값 즉시 리셋. `qa-decay-flash.ts` 가 이 함수를 그대로 쓰게 수정 | `render/progressRule.ts`, `render/renderer.ts` |
| m-4 | 서버 `engageEtaTick` 추가(§10-74 — movement 도착 판정과 같은 조건으로 경로 위 추정). 클라이언트 ETA = `engageEtaTick`(없으면 `etaTick`), 문구 "교전 개시 예상". 실측 오차 평균 5.2 tick(기존 26.7) | `server/src/game/rules.ts engageEtaTicks`, `state/gameModel.ts` |
| m-5 | 조사: 나 → "내가", 그 외 받침 판정(한글 종성·숫자 읽기, 영문은 "이(가)") | `state/feed.ts josa` |
| m-6 | 내 제안 거절(토스트)·만료, 받은 제안 만료를 피드에 (제안 당사자는 적용 전 모델에서) | `state/feed.ts` |
| m-7 | 썸네일 스폰 = 서버 `presetSpawnIndices` 규칙(spawnSets[N] → 앞 N). 방 만들기 패널은 시작 인원(방장 + 봇)으로 그림 | `render/mapPreview.ts previewSpawns`, `ui/Lobby.tsx` |
| m-8 | 서버 `welcome.officialMaps[].checksum`(§10-75). 번들 파일 checksum 과 다르면 썸네일 숨김("서버 맵 버전이 다름")·생성 전 판 길이 추정 숨김 | `ui/officialMaps.ts loadOfficialMapChecked` |
| m-9 | 방장 숫자 입력은 blur/Enter 에 범위 안 값만 송신, Esc·범위 밖은 서버 값으로 복귀 | `ui/WaitingRoom.tsx CommitNumber` |
| m-10 | `BAD_ROOM_OPTIONS`/`NOT_ENOUGH_PLAYERS`/`MAP_NOT_FOUND` 토스트에 서버 `message` 를 붙임 | `store.ts` |
| m-11 | 이 문서 §4-4·§4-5 갱신 | 문서 |
| m-12 | **이모트 구현**(프로토콜 §4 `emote` 이미 정의): HUD "말풍선" 메뉴 16문구(코드 0..15 의미는 클라이언트 정의 — `ui/text.ts EMOTE_TEXT`), 수신 `emote_broadcast` → 수도 위 말풍선 4초 + 피드 | `ui/GameScreen.tsx EmoteMenu`, `render/renderer.ts drawEmotes` |


### QA 후속 검증 (2026-10-09)
- typecheck 통과, `npm test` **13 파일 / 161 통과**(+`client/test/qaFollowups.test.ts` 8, 서버 `rooms.test.ts` +1 J-2), smoke PASSED, build:client 성공, `qa:ws` 73/73(스키마 위반 0 — `engageEtaTick`·`checksum` 반영), `qa:headless 777 M 10 HARD` 스키마 위반 0·순서 위반 0·재구성 불일치 0·회계 0, `headless-check 75` full 14회 불일치 0.
- `qa-e2e-full.ts`(1,925초): 예외 0, 전 store 재구성 불일치 0, ack 누락 0, 순서·종료 후 메시지 0. **ivan(GAME_OVER 후 관전) `gotGameOver:true`, `modelGameOver:true`**(J-2 해소). `NOT_IN_ROOM` 은 서버가 여전히 보내지만(관찰자 기록) 나가기 직후라 토스트로 뜨지 않음(carol2 토스트에 없음 — m-1). carol 새로고침 → 로비(m-2, 문서화된 동작).
- `qa-decay-flash.ts`(렌더러 판정 함수 사용으로 수정): 4000 tick 오탐 0(이번 시드에서는 실제 같은 칸 감소도 0 — 판정 단위 테스트로 보완).
- 브라우저(스크린샷 동작): 이모트 말풍선("testerqa: GG")·피드, HUD "나가기" → 확인 대화상자 → 나가기 → 로비·저장 토큰 삭제·토스트 없음 확인.

## 9. 플레이테스트 후속 (2026-10-10)

| 항목 | 처리 | 위치 |
|---|---|---|
| 공개 방 방장 즉시 시작 | 서버: 공개 룸도 방장(첫 입장자·승계)의 `lobby_start_now` 수락(3초 카운트다운 동일, 비방장 `NOT_HOST`, 설정 변경은 여전히 금지 — QA m-6 번복, 프로토콜 §3·§10-77). 클라이언트: `isHost` 가 공개 방에서도 참 → 대기실에 "게임 시작" 버튼, 자동 시작 안내에 "방장은 지금 바로 시작할 수 있습니다". 방장 설정 패널은 비공개 방만 | `server/src/room/room.ts`, `state/store.ts`, `ui/WaitingRoom.tsx` |
| 방 찾기 | 서버: `lobby_list_rooms` → `room_list`(공개 방만, 코드 비노출, `roomId` 핸들, 세션당 1초 1회 `RATE_LIMITED`, 최대 50), `lobby_join_listed {roomId, spectate}`(프로토콜 §4·§5·§10-78). 클라이언트: 로비 「방 찾기」 패널 — 맵 이름/크기, 사람·봇/최대, 관전자 수, 상태(대기 n초 후 시작 / 곧 시작 / 진행 m:ss / 종료), 입장·관전 버튼, 새로고침 + 열려 있는 동안 5초 자동 갱신, 진행 시간은 수신 시각 기준 로컬 증가. 연타는 클라이언트가 1.1초로 막고 `RATE_LIMITED` 는 토스트 없이 무시 | `server/src/room/lobby.ts`, `net/{validate,server}.ts`, `ui/Lobby.tsx RoomBrowser` |
| 모든 깃발 이동 방향 | 적 포함 모든 깃발에 짧은 화살표: 행군 → 앵커, 귀환 → 귀환지(`flag_recalled`/`flag_routed.returnTileId` 를 모델 `flagReturn` 에 보관, 점선), 공격 교전 → 대상 칸. 소유자 어두운 색 + 흰 외곽(색각 보조와 무관하게 모양으로 읽힘), LOD 에선 남의 깃발 화살표를 더 짧고 옅게. `V`/HUD 버튼으로 끄고 켬(저장). 프로토콜 변경 없음(§10-79) — 늦게 입장하면 이미 귀환 중인 깃발은 귀환지를 몰라 화살표 생략 | `render/renderer.ts drawDirections`, `state/gameModel.ts`, `input/controller.ts` |

### 검증
- typecheck 통과, `npm test` **14 파일 / 166 통과**(서버 `rooms.test.ts` +2: 공개 방 방장 시작·방 찾기 / 클라이언트 `playtest.test.ts` 3), smoke PASSED, build:client 성공, `qa:ws` **78/78**(+5: 공개 비방장 `NOT_HOST`, `room_list` 공개만·코드 없음, 1초 내 재요청 `RATE_LIMITED`, `lobby_join_listed` 형식 오류 `BAD_MESSAGE`, 공개 방장 start → COUNTDOWN; 스키마 위반 0 — `qa-schema.ts` 에 `room_list` 추가), `headless-check 75` full 14회 불일치 0.
- 브라우저(8080·5173 은 다른 프로세스가 쓰고 있어 서버 8090 + Vite 5180 으로 별도 기동): 공개 방 방장 즉시 시작 → IN_GAME, 로비 「방 찾기」에 대기 방(입장)·진행 방(관전 0:11) 2개 표시 → 관전 입장, 따라가기 상태에서 행군 깃발(내 깃발·BOT 10·BOT 8·BOT 4)의 방향 화살표 스크린샷 확인. 로비 보조 링크 4개가 800px 에서 줄바꿈되던 것을 CSS 로 수정.

## 10. v4.2 출전 UI 개편 + 지형 툴팁 · 반투명 영토 · 하단 바 유지비 (2026-10-10)

원천: design-decisions「GDD v4.2 2차 검토 결정」 깃발 출전 UI 변경, GDD v4.2 프론트 체크리스트 1·4·5, 코디네이터 추가 요청(유지비 표시, 지형 툴팁, 반투명 영토).

### 입력 흐름 (`input/controller.ts` — `Interaction.issue` 상태기계)
| 상태 | 동작 |
|---|---|
| 없음 + 지점 클릭 | 가장 가까운 내 기지(서버와 같은 가중 이동 거리, 동률 tileId 작은 쪽) 하이라이트 → `pick` (삼각 메뉴) |
| 없음 + 내 기지 클릭 | `aim`: 기지 → 커서 경로 화살표가 따라옴. 기지 위에 깃발이 겹치면 일반 클릭 = 깃발 선택, **Alt+클릭 = 기지에서 출전** |
| `aim` + 지점 클릭 | `pick` (그 기지 고정). 같은 기지 재클릭 = 취소, Alt+다른 내 기지 = 출발 기지 변경 |
| `pick` | 창(위)·검(왼쪽 아래)·기(오른쪽 아래) DOM 라디얼 버튼 또는 `1/2/3` → `cmd_flag_issue{unit, troops(비율), anchorTileId, originBaseTileId = 하이라이트 기지}`. 캔버스 클릭(바깥)·우클릭·Esc = 취소 |
| 내 깃발 선택 + 내 기지 클릭 | `cmd_flag_recall{flagId, baseTileId}` (A-61). 적·중립 기지 클릭 = `cmd_flag_retarget`(체크리스트 4). 다른 곳 클릭 = 선택 해제만. RETURNING 이면 보내지 않고 "귀환 중 — 취소할 수 없습니다" |
| 유지 | 우클릭 재지정, F/R(R = 자동 귀환지, baseTileId 없음)/Tab/T/P/C/V/?/H/0, Q/E 비율 |
| 폐기 | 병종 키 → 클릭 2액션, Shift 유지, `B`·Alt+클릭 출발 기지 지정(`originBase`) — 기지 클릭 흐름이 대신함 |

기본 태세 예고: 클릭 지점이 내 땅 = 방어(푸른 경로·메뉴 + 보호 원 반경 6 유지), 적·중립 = 공격(붉은 경로 + 쟁기 회랑 음영), 물·동맹 = 회색(그래도 보내면 서버 ack 가 판정). 사거리 밖 판정은 기존 `computePreview` 그대로(커서 툴팁).

### 진격 경로 미리보기 (`input/route.ts`)
- 서버 `rules.ts buildField/stepToward` **그대로 복제**: 앵커에서 거꾸로 Dijkstra, 가중치 = 들어가는 칸 `TERRAIN_MOVE_PERMILLE`(얕은 물 = 기동 단계별 `SHALLOW_MOVE_PERMILLE_BY_TIER`, 최소값), 깊은 물 제외, 한 걸음 = 이웃 중 (거리, tileId) 최소. 경로는 소유권과 무관하므로 **같은 지형·기동 단계면 서버 경로와 칸 단위로 같다**.
- 오차: 행군 중 기동 테크가 오르면 서버가 새 거리장으로 다시 걷는다 / 정지 점령(halted)·대치·전투는 경로가 아니라 시간을 바꾼다 / 서버가 이동 규칙을 바꾸면 이 파일도 바꿔야 한다.
- 쟁기 회랑 = 경로 칸들의 이웃 중 점령 가능·비동맹·내 것이 아닌 칸(현재 소유 기준, `marchFront` 합집합). "경로 n칸 · 옆 칸 m개 공격" 표시. GDD 체크리스트의 `min(병력/c, 3×경로)` 예상 점령 칸 수는 `tileCost` 를 클라이언트가 재현하지 않아 **넣지 않았다**(회랑 칸 수만).
- 거리장 캐시 키 = (앵커, 기동 단계, seed). 맵 200×120 에서도 커서가 칸을 바꿀 때 1회 계산.

### 렌더 (`render/renderer.ts`)
- 공격 원(붉은 반경 6) 제거 — `computePreview` 의 공격 `disk = []`, 방어 보호 원만 남김.
- `drawRoute`(월드: 회랑 음영) + `drawRouteArrow`(화면: 기지 노란 맥동 링, 칸 중심 꺾은선 점선 + 화살촉, 도달 불가면 회색).
- **반투명 영토**: `palette.OWNER_FILL_ALPHA = 0.42` — 1타일 1픽셀 레이어라 지형 색과 미리 섞는다. 소유 구분 보강으로 `drawOwnerBands`(경계선을 플레이어 색 굵게 긋고 그 영토 안으로 clip 한 안쪽 띠, 화면 ~5px, α 0.55) + 기존 어두운 경계선·내 영토 흰 경계. 색각 보조 무늬는 그대로 위에 겹친다(스크린샷 확인). 흰색(12번) 플레이어는 평원 위에서 채우기 대비가 약해 경계·띠에 의존 — 플레이테스트 확인 필요.

### UI (`ui/GameScreen.tsx`)
- 하단 바 = 병력 비율 슬라이더 + **골드 수지**: 순수입/초, 총수입, 깃발 유지비 −n/초(%) — 서버 `upkeepPm` 만으로 계산(`goldPerSecond`, 정확). "다음 깃발 유지비 창/검/기 −n/초" 미리보기는 `ui/upkeep.ts` 가 서버 식(`drainPm`)을 두 대상 규칙(종전 주둔만 / 변경 예정 패주 제외 전부)으로 계산해 **서버 `upkeepPm` 과 하나만 맞을 때 그 규칙을 기억**하고, `all` 규칙일 때만 보인다(구분 불가·불일치면 숨김). 백엔드가 유지비 식·필드를 바꾸면 `upkeep.ts` 만 고치면 된다.
- 지형 정보 툴팁(`ui/terrainInfo.ts`): 맵 캔버스 위에서만(`ix.overMap` = 이벤트 대상이 캔버스), 커서 왼쪽 위. 지형 이름, 방어 ×(`COMBAT_TERRAIN_DEF_POSTURE_PERMILLE`), 이동 속도 ×(1000/이동 배율, 얕은 물은 내 기동 단계), 점령 비용 ×, 골드 ×, 소유자(색 점 + 이름 / 중립, (나)/(동맹)), 기지·수도 체력. 삼각 메뉴가 떠 있으면 숨김. 출전 안내 툴팁은 커서 오른쪽 아래(겹치지 않음).
- 깃발 패널: RETURNING 이면 F/R 비활성 + "귀환 중 — 취소 불가"(체크리스트 5).
- 도움말·로비 조작 문구 갱신.

### 모델 (`state/gameModel.ts`) — shared 타입에 백엔드가 추가한 필드
- `flag_issued` 시 `halted:false, returnBaseTileId:null`, `flagFlags` 비트 `FLAG_BIT.HALTED`, delta `flagReturnBase`. **이 시점 `02_backend_protocol.md` 에는 아직 없음** — shared/protocol.ts 주석을 근거로 했다. 문서 갱신 후 대조 필요.

### 서버 의존 / 불일치 우려
1. `cmd_flag_recall.baseTileId` — 클라이언트는 GDD 7.2 대로 보낸다. 서버 검증기가 모르면 필드를 버리고 자동 귀환지로 회수(호환).
2. **리듀서 재구성 불일치(백엔드 작업 중 서버 기준)**: `gameModel.test` M 10인 2000 tick 에서 `progressPct 모델 0 / full 38` 1건 — delta `flagProgress` 는 "목록에 없으면 0" 규칙인데, v4.2 A-54(halt 해제 시 진척 리셋 없음)로 MARCHING·비halted 깃발이 진척을 들고 있으면 delta 에 안 실려 클라이언트가 0 으로 만든다. 서버 `snapshot.ts` delta 조건 또는 문서 규칙 정리 필요(백엔드/QA 판단).
3. `qaFollowups` m-4(engage ETA 오차 표본 > 100) 실패 — v4.2 로 `flag_engaged` 가 앵커 칸 점령 때만 나와 표본이 86 으로 줄었다(서버 의미 변경). ETA 기준 재정의는 백엔드 `engageEtaTicks` 갱신 후 다시 본다.
4. 유지비 규칙 변경(패주 제외 전 깃발 과금, 순수입 ≥ 0 상한) — 프로토콜 문서 미반영. 현재 표시는 `upkeepPm` 만 쓰므로 필드가 그대로면 자동으로 맞는다.

### 검증
- `npm run typecheck` 통과. 클라이언트 vitest 54 중 52 통과(+`issueFlow.test.ts` 10: 경로 복제·지점→하이라이트→삼각→발령·기지→화살표→지점→삼각→발령·취소 3종·Alt 기지·선택 깃발+기지 귀환/재지정/해제·RETURNING·탈락; +`hoverUpkeep.test.ts` 4: 지형 툴팁·반투명·유지비 규칙). 실패 2 는 위 2·3(서버 쪽). `build:client` 성공. `headless-check 75`(서버 8092): full 14회 불일치 0, ack 수락 24 / NO_SLOT 1.
- 브라우저(내장, 1280×800, 서버 8092 + Vite 5182 — 8080/5173 사용 중): 지점 클릭 → 수도 하이라이트·붉은 경로·회랑·삼각 메뉴 → 기병 클릭 = `cmd_flag_issue{originBaseTileId: 수도}` 송신·MARCHING 확인, `2` 키 발령 확인, 수도 클릭 → 커서 따라오는 경로, 지형 툴팁, 반투명 영토·색각 보조. 스크린샷 `_workspace/screenshots/` 4장. 실제 지정 귀환(서버 수락)은 브라우저에서 확인 못 함(단위 테스트로 와이어 shape 만 확인).

## 11. 종료 후 둘러보기 (2026-10-10)
- 결과 오버레이 「맵 보기」 → 하단 가운데 알약(「게임 종료 · 승자」 + 「결과 보기」 + 「로비로」, `ui/GameScreen.tsx GameOverOverlay`). HUD 「나가기」도 그대로.
- 맵: 팬·줌·미니맵·지형 툴팁·깃발 선택(정보만). 순위표는 종료 후 모든 사람(플레이어·탈락자·관전자)에게 따라가기 모드(`ui/panels.tsx Scoreboard`), 따라가는 플레이어의 HUD 를 보여 준다(`store.viewerId` — 종료 후에만 follow 우선).
- 명령 차단: 기존 `canCommand()`(gameOver / room GAME_OVER) — 출전 메뉴·화살표·귀환·재지정·F/R·숫자키 모두 무동작, 하단 바·테크·외교·이모트 숨김. 테스트 `issueFlow.test.ts` 「게임 종료 후 둘러보기」.
- 브라우저 확인은 진행 중 판에 `game_over` 를 store 에 주입해 했다(실제 종료 판 아님 — 서버가 계속 tick 을 보내 맵이 움직임). 스크린샷 `_workspace/screenshots/post-game-map-view.jpg`.

## 12. 병종 아이콘 · 지형 툴팁 세로 배치 · 옵션 창 (2026-10-11)
프로토콜 변경 없음(메시지 shape·필드 사용 동일). 클라이언트 표시 전용.

- **병종 아이콘**: 그림 데이터는 `render/unitGlyphs.ts`(24×24 path, 창 = 대각 자루+촉, 검 = 세로 칼날+코등이, 기병 = 말굽) 한 곳. 캔버스는 `drawUnitGlyph()`(Path2D, 어두운 외곽선 위 흰색 — 플레이어 색·색각 보조 무관하게 모양으로 구분), DOM 은 `ui/unitIcons.tsx <UnitIcon>`(inline SVG, currentColor, role=img + aria-label/title = 한국어 이름, `withName` 이면 아이콘+이름). 적용: 깃발 마커(r ≥ 6 = LOD 포함, 크기 max(10, 1.5r); Path2D 없는 환경은 기존 글자 대체), 삼각 메뉴 버튼(title/aria-label = 병종·병력·단축키), 깃발 패널(아이콘+이름), 하단 바 "다음 깃발 유지비", 도움말(아이콘+이름). 이벤트 피드에는 병종 문구가 없어 변경 없음. README 는 Markdown 이라 글자 유지(아이콘 설명 추가).
- **지형 툴팁**: `terrainInfo().rows`(field·label·value, 순서 지형→방어→이동 속도→점령 비용→골드→소유자→기지 체력) 추가, `visibleTipRows()` 로 옵션 필터. `.terrain-tip` = flex column, 한 줄에 한 항목(라벨 왼쪽 muted / 값 오른쪽 tabular). 기존 `mods` 는 테스트 호환으로 유지.
- **옵션 창**(`ui/OptionsPanel.tsx`, 상태 `ui/options.ts`): HUD 톱니 버튼(좁은 화면 포함) / `O`. 색각 보조(`C` 유지), 깃발 이동 방향 화살표 모두/내 깃발만/숨김(`V` 순환, `RenderView.directions`), 지형 툴팁 켜기 + 항목 7개. localStorage `civwar.options.v1` JSON, 읽기·쓰기 try/catch → 실패 시 기본값/이번 세션만, 깨진 필드는 필드 단위로 기본값(`sanitizeOptions`). 이전 키 `civwar.colorblind`/`civwar.directions` 는 새 키가 없을 때 이전. Esc(컨트롤러 + 창 자체 리스너 — 체크박스 포커스 시) · 바깥 클릭으로 닫힘. HUD 의 C/V 버튼은 옵션 창으로 옮겨 제거.
- 테스트 `client/test/options.test.ts`(10): 기본값·저장/복원·저장소 예외/깨진 JSON·필드 단위 sanitize·이전 키 이전·V 순환·툴팁 행 순서/필터/툴팁 끔·깊은 물·아이콘 3종 상이.
- 브라우저(내장, 1280×800, 서버 8092 + Vite 5182): 삼각 메뉴 아이콘, 맵 깃발 3종, 작은 줌 + 색각 보조(3배 픽셀 확대 크롭), 툴팁 7행/골드 끔, 옵션 창 변경 → localStorage 저장 → 새로고침 후 복원, `O` 열기·Esc·바깥 클릭 닫기, 내 깃발만 = 봇 깃발 화살표 없음, 도움말·깃발 패널. 스크린샷 `_workspace/screenshots/unit-icons-*.{png,jpg}`, `terrain-tooltip-column.jpg`, `options-window.jpg`.

## 13. 테크 창 v4.3 (갈래 열 격자) · 교전 시각화 (2026-10-11)

근거: 프로토콜 §19(테크 v4.3)·§20(8방향 접촉), GDD §3.4, `01b_tech-tree-v4.3-proposal.md` §5(안 A 격자, 폰은 안 B 탭), design-decisions 2026-10-11. `server/`·`shared/` 변경 없음.

### 테크 창 (`ui/TechWindow.tsx`, 계산 `ui/techTree.ts`, 아이콘 `ui/techIcons.tsx`)
- 백엔드 임시 노드 버튼 목록(`panels.tsx TechPanel`)을 삭제하고 교체. 열기 = HUD `테크` 버튼 / `T`, 닫기 = `Esc`(상세 → 창 순서) / 창 바깥 클릭(캡처 단계에서 받아 맵 클릭으로 이어지지 않게 막음) / ×.
- HUD 버튼 배지 = 지금 살 수 있는 노드 수(내가 명령 가능할 때만). 좁은 화면 HUD 에도 `테크` 버튼 추가.
- 격자: 열 = 갈래 7개(MIL ECO TER MOB | SPE SWO CAV, 공통/병종 사이 점선), 줄 = 티어 I·II·III. T2 는 좌/우 반 칸, T3 는 부모 아래(`techLayout`). 연결선: 부모 보유 = 갈래 색 실선 2px, 미보유 = 회색 점선 1px, hover 노드의 루트까지 경로 굵게.
- 노드 상태 5종(`techNodeState`, 우선순위 보유 → 요청 중 → 잠김 → 구매 가능 → 골드 부족) — 색 + 테두리 모양 + 기호: 잠김 = 회색 점선 + 자물쇠 + 아이콘 40%, 가격 숨김 / 골드 부족 = 얇은 실선 + 진행 링(gold/price) / 구매 가능 = 굵은 실선, 한 번만 깜빡 / 요청 중 = 이중 테두리 + 시계 / 보유 = 갈래 색 채움 + 체크. 창 아래 범례.
- "요청 중" = `store.pendingTechNodes()`: `cmd_buy_tech` 를 보내고 `cmd_ack` 전, 그리고 수락 ack 뒤 `tech_purchased`(techMask) 반영 전 짧은 틈(최대 5초). 거절 토스트는 테크 전용 문구(`TECH_REJECT_TEXT`: PREREQ_MISSING / ALREADY_OWNED / INSUFFICIENT → "골드가 부족합니다" / BAD_REQUEST).
- 상세 패널(노드 클릭, 같은 노드 다시 클릭 또는 Esc 로 닫힘): 아이콘·이름·갈래·티어·코드·상태, desc, **지금 → 구매 후**(보유 노드는 **없을 때 → 보유**) 수치 = `techStatValues(mask)` 대 `techStatValues(mask | bit)`(다른 보유 노드 합산). 공통 전투 노드는 병종별 실제 전투값 행, ECO 골드 노드는 초당 골드 수입, TER 상한 노드는 실제 병력 상한(`GameModel.troopCapOf`), MOB-3A 는 실제 슬롯(`flagCapOf`). 적용 범위 한 줄, 선행(✓/✗), 가격(기본·구매 n회 반영 +6n%, 다음 구매 시 가격), 대기 시간(순수입 기준, 15분 넘으면 "15분 넘게 걸림"), 구매 버튼(`cmd_buy_tech{nodeId}` — 구매 가능 + 명령 가능일 때만 활성).
- 보는 플레이어 = `store.viewerId`. 관전·탈락·종료 후에는 따라가는 플레이어의 트리를 보기 전용으로(버튼 비활성, 머리글에 "보기 전용"). 아무도 안 따라가면 안내 문구.
- 좁은 화면(`useNarrow`): 아래에서 올라오는 시트, 갈래 탭 7개(살 수 있는 노드가 있으면 점), 선택 갈래의 세로 트리, 상세는 트리 아래.
- 아이콘: 32노드 단색 선 SVG(viewBox 24, stroke 2, currentColor, 면 없음) — 01b 2.3 "아이콘" 열. 병종 갈래 머리글·노드 왼쪽 위 미니 기호는 `UnitIcon`(unitGlyphs) 재사용.
- **01b 와 다르게 한 것**: 보유 노드의 아이콘을 "흰색 반전" 대신 **먹색(#0d141c)** 으로 — 갈래 색(황금·녹색 등 밝은 색) 채움 위에서 흰색은 대비가 모자라서. 상세 패널을 노드 더블클릭 구매 없이 버튼만(A-80 ①).

### 교전 시각화 (`render/combatPairs.ts`, `renderer.ts drawCombatLinks/drawCombatBadges`)
- 쌍 추출(클라이언트 계산): 두 깃발 모두 서버 `inCombat` 비트 + 주인 다름 + 동맹 아님 + `TopologyView.touching(posTileId)` (사각 = 체비셰프 1, 대각선 포함 — §20). `touching` 은 `topology.ts` 에만(육각 전환 시 같은 칸 또는 이웃). `combat_started` 메시지는 쓰지 않는다(재접속·늦은 입장에도 비트만으로 복원).
- 그림: 깃발 아래 연결선(어두운 외곽 + 밝은 선), 깃발 위 아이콘. 보통 보기 = 중점에서 선에 수직으로 비켜 난 자리에 배지 둘(각 깃발 쪽에 그 깃발 태세: 공격 = 기울인 검, 방어 = 방패, 배지 테두리 = 공격 붉음/방어 푸름), 깃발 크기에 비례. 축소 보기(LOD 또는 화면 쌍 > 16) = 쌍마다 배지 하나(검 둘 / 방패 위 검 / 방패). 가까운 배지는 버림(`declutter`). 배지 둘레 맥동 + 새 쌍은 0.7초 섬광. 기존 깃발 붉은 맥동 링은 그대로.
- 검 아이콘은 병종 "검병" 아이콘(세로 칼날)과 헷갈리지 않게 기울인 모양. 색각 보조 모드에서도 모양으로 구분(색 무관).

### 기타
- `Help.tsx`: 테크(7갈래·상세·구매·상태 표시·+6%·관전 보기), 전투·ZOC 8방향, 교전 아이콘, 기동 테크 문구(물 위 소모 감소 삭제 반영). README 조작 표 갱신.
- 테스트: `client/test/techTree.test.ts`(상태 5종·배지 수·가격·대기 시간·상세 수치 01b 예시 1365→1430 포함·격자 배치·아이콘 32개), `client/test/combatPairs.test.ts`(체비셰프 접촉·대각선 쌍·동맹/같은 주인/비전투 제외·2대1·같은 칸·아이콘 종류·겹침 제거).
- 스크린샷: `_workspace/screenshots/v43-tech-tree-grid.jpg`, `v43-tech-detail-panel.jpg`, `v43-tech-phone-tabs.jpg`, `v43-combat-diagonal-sword-shield.jpg`, `v43-combat-zoomed-out-colorblind.jpg` (서버 8092 / Vite 5182, 봇 9 공개 방).
- 프로토콜 불일치 의심 없음. 참고: 교전은 1~3초 안에 끝나는 경우가 많아 실제 화면에서 아이콘이 잠깐만 보인다(스크린샷은 클라이언트 수신을 잠시 멈춰 찍음).

## 14. 2026-10-14 UI 요청 — 드래그 창 · 부대 공격력/방어력 · 내 부대 칩 · 우클릭 = 이동 · 큰 기지 · 영토 이름

server/·shared/ 는 손대지 않았다 (백엔드 §21 병행 작업 중). 새 메시지·필드 없음.

### 구현
- **창 드래그** (`ui/draggable.ts` `useDraggableWindow(id, enabled)`): 테크·외교·옵션·도움말 창의 제목 줄(`data-drag-handle`)을 끌면 `translate(dx,dy)` 오프셋만 더한다(원래 CSS 배치 유지). `clampOffset` 으로 부모(.game / 오버레이) 안에 가둔다 — 창이 더 크면 왼쪽·위쪽 정렬. 렌더마다·창 크기 변경 시 다시 자른다. 위치는 `localStorage['civwar.windowPos.v1']`(try/catch, 실패 = 이번 세션만). 드래그를 바깥에서 놓아도 "바깥 클릭 = 닫기"가 안 되게 이어지는 click 한 번을 삼킨다. 좁은 화면(모바일)은 비활성 — 테크 시트·도움말 배치 그대로. 도움말은 창 안에서 스크롤하도록 바꿨다(`.help` max-height 100%, 오버레이 스크롤 제거 — 자르기 계산이 성립하게).
- **부대 공격력·방어력** (`ui/techInfo.ts` `unitCombatStats`): 서버 `flagValue` 와 같은 단계별 floor — `floor(UNIT_ATK_PERMILLE[u] × techCombatPm(stat,u,공격)/1000)`, 방어는 `UNIT_DEF_PERMILLE` + `techCombatPm(…,방어)`. 지형·상륙·이탈 대기 배율 제외. 상수는 match_config.constants 우선. 우측 아래 정보 패널(FlagPanel)에 내·적·동맹 모든 깃발에 대해 "공격력 ×0.87 / 방어력 ×1.30 (기본 · 테크)" + 설명 한 줄, 지금 태세 값은 굵게. 테크는 **그 깃발 주인**의 techMask.
- **내 부대 칩** (`ui/unitChips.ts` `myUnitChips`, GameScreen `UnitChips`): 병력 바 위(`.bottom-dock` = 칩 줄 + 기존 `.command-bar`), 슬롯 순, 병종 아이콘 + 병력 + 태세 아이콘(공격 = 검, 방어 = 방패 — `PostureIcon`). 선택 = 노란 테두리, 전투 중 = 붉은 테두리, 귀환·패주 = 점선. 클릭 = `ctl.focusFlag(id)`(선택 + 카메라 이동 + 관전 따라가기 해제 + 출전 메뉴 닫기).
- **선택 강조**: 맵 깃발 선택 고리를 흰 고리 → 검은 바탕 + 노란 고리 + 퍼지는 바깥 고리로.
- **우클릭 = 항상 이동** (`controller.rightClickTile` → `store.moveFlag`): 내 깃발 선택 중 우클릭은 어디든 `cmd_flag_retarget{flagId, anchorTileId}` — 내 기지도 귀환이 아니라 기지 위로 이동(태세는 서버가 앵커로 재파생: 내 땅 = 방어). 귀환 중이면 토스트만. 출전 메뉴가 떠 있으면 우클릭 = 출전 취소(기존). **이동 명령은 `ClientStore.moveFlag()` 한 함수에 격리** — §21 에서 호출 방식이 정해지면 그 함수만 바꾼다.
- **예전 "깃발 선택 + 기지 좌클릭 = 귀환(cmd_flag_recall.baseTileId) / 재지정" 폐기** — 이제 선택 중 맵 좌클릭은 선택 해제만(Alt+내 기지 = 출전 기지 고르기는 유지). `store.recall(flagId, baseTileId?)` 함수는 남겨 둠(지금 호출부는 `baseTileId` 없이만 씀).
- **떠 있는 버튼** (GameScreen `FlagActions`, 위치는 rAF 에서 `positionFlagActions` — 깃발 보간 위치 오른쪽): [귀환] = `cmd_flag_recall{flagId}`(자동 귀환지, R), [태세 변경] = `cmd_set_posture`(F, 바꿀 태세 아이콘 + 쿨타임 n초). 비활성 조건은 `flagActionState` — 서버 거절 순서(패주 > 귀환 > 이탈 대기 > 전투 중 > 쿨타임)와 같다. z-index 2 (테크·외교 창 아래). 좁은 화면·출전 메뉴 중·남의 깃발이면 숨김.
- **큰 기지** (`renderer.drawBases`, `baseIconSize(zoom)` = 줌 px, 최소 10 최대 64): 칸을 꽉 채운다. 일반 = 소유자 색 + 검은 테두리 + 십자, 수도 = 금색 바깥 테두리 + 안쪽 사각 + 별(14px 이상). 체력 바는 칸 위. 예전 수도 아래 닉네임 라벨은 영토 이름으로 대체해 뺐다.
- **영토 이름** (`render/territoryLabels.ts`): `territoryAnchors` = 소유 칸 무게중심에 가장 가까운 자기 칸(오목·섬 영토도 자기 땅 위). 영토가 바뀌었을 때만, 최대 1초에 한 번 다시 계산(`LABEL_REFRESH_MS`). `layoutTerritoryLabels` = 매 프레임 화면 배치: 글자 = √칸 수 × 0.32 × 줌, 화면 11~30px, 큰 영토부터, 겹치면 11px 로 줄여 보고 그래도 겹치면 생략, 화면 밖 생략. 기준점이 기지 칸(대개 수도)이거나 그 옆이면 아이콘 아래로 내린다. 탈락자 제외, 색각 보조면 "번호. 이름".
- 툴팁 문구: 선택 중 내 기지 = "우클릭 = 이 기지로 이동해 방어", 적 기지 = "…이동해 공격", 그 외 "우클릭 = 이동 → …". 도움말·컨트롤러 머리 주석 갱신.

### §21 연결 대기 (구조만 — 데이터 없으면 그리지 않음)
- 기지 생산력 바·지명: `RenderView.baseExtra?(tile) → { productivityPct?, name? }`. 생산력 바 = 기지 칸 **아래**(체력 바와 같은 폭, 금색), 지명 = 그 아래 라벨(줌 9 이상, 수도는 연금색). GameScreen 이 아직 `baseExtra` 를 넘기지 않는다 — §21 필드가 오면 GameModel 에 저장하고 여기서 넘기면 된다.
- 병력·골드 hover 출처: `Stat` 의 `breakdown` prop + `SourceTip`(제목 줄 → 기지 행(수도 ★, 많은 순) → 구분선 → 기타) + `sourceBreakdown(total, perBase)`(기타 = 합계 − Σ기지, 음수면 0). HUD 병력·골드 Stat 에 아직 연결 안 함.
- 우클릭 이동: `store.moveFlag` 교체.

### 검증
- `npm run typecheck` 통과, `npm test` 22 파일 295개 통과, `npm run build:client` 통과.
- 테스트: `client/test/uiOct14.test.ts`(드래그 자르기 6, 공격력/방어력 = 서버 식·상수 우선 3, 칩 2, 버튼 상태 3, 영토 이름 위치·크기·배치 6, 기지 크기 1, 출처 내역 2), `client/test/issueFlow.test.ts`(기존 "선택 + 기지 클릭 = 귀환" 테스트를 폐기 동작으로 교체, 우클릭 라우팅 — 내 기지·적 기지·중립·내 땅 모두 `cmd_flag_retarget` + `store.moveFlag` 경유·남의 깃발/선택 없음/맵 밖/출전 중 = 명령 없음, 귀환 중 우클릭 무시, 칩 focusFlag).
- 브라우저(서버 8092 / Vite 5182, 봇 9 비공개 방, 1400×860): 칩 클릭 → 선택 + 카메라 이동 + 노란 고리 + 떠 있는 버튼 + 공격력/방어력 패널, [태세 변경] → 공격으로 바뀌고 "5초" 쿨타임 표시, 내 수도 우클릭 → 툴팁 "이 기지로 이동해 방어" → 서버 수락(행군·방어, 귀환 아님), 테크·외교·옵션·도움말 창 드래그 + 좌상단·우하단 자르기 + 새로고침 후 위치 유지, 모바일(375×812) = 테크 시트 그대로·드래그 손잡이/칩/떠 있는 버튼 없음. 콘솔 오류 없음.
- 스크린샷 `_workspace/screenshots/2026-10-14_*`: `drag-tech-window`, `drag-tech-window_clamped-top-left`, `drag-diplomacy_clamped-bottom-right`, `drag-options-window`, `drag-help-window`, `unit-select_stats-panel_floating-buttons_chip`, `unit-stats-panel_zoom`, `floating-buttons_posture-cooldown`, `rightclick-own-base_move-defend`, `big-base-icons_territory-name`, `territory-names_full-map`.

### 메모 / 확인 필요
- 쿨타임 중 내 기지로 우클릭 이동했을 때 서버가 태세를 방어로 바꿨다(프로토콜 §4 표는 "쿨타임 중·전투 중이면 현 태세 유지"). 그 시점 쿨타임이 막 끝났을 수도 있어 확정은 못 함 — integration-qa 확인 요망.
- 개발 중 HMR 로 GameScreen 이 다시 마운트되면 `usePolled` 가 첫 렌더의 클로저(옛 컨트롤러)를 계속 읽어 옵션 창 등이 안 뜰 수 있다(새로고침하면 정상). 기존 동작이며 배포 빌드와 무관.

## 15. 프로토콜 §21 연결 (2026-10-14 2차 — 백엔드 39757b8 이후)

§14 의 "§21 연결 대기" 항목을 전부 연결했다. server/·shared/ 는 손대지 않았다.

### 사용하는 §21 필드
| 필드 | 쓰는 곳 |
|---|---|
| `map_init.baseNames` (bases 와 같은 순서) | `GameModel.baseNames` (`baseNameMap`) → 기지 위 지명, 지형 툴팁, 피드, 생산 내역 행 이름 |
| `snapshot_full.bases[].prodPm` · 델타 `baseProd` · `base_captured.newProdPm` | `GameModel.baseProd` = {마지막 서버 값, 그 tick} → `baseProdPm(tile, tickFloat)` 보간 |
| `snapshot_full.production` · 델타 `production` (바뀐 플레이어만 통째 교체) | `GameModel.production` → `ui/production.ts` `incomeOf` · `productionRows` |
| `flagFlags` 비트 `POSTURE_PENDING 128` · `snapshot_full.flags[].pendingPosture` | (백엔드가 넣은 모델 해석 그대로) → `flagActionState.pendingPosture` |
| `player_eliminated.byPlayerId` · `annexedTiles` + 같은 tick `tileChanges` | 피드 문구, `GameModel.annexFlashes` → 렌더러 번쩍임 |

### 구현
- **생산력 바**: 기지 칸 아래 금색 바, **회복 중(< 100%)일 때만** 그린다(가득 찬 기지마다 바가 있으면 맵이 어지럽다 — 100% 는 툴팁·내역에서 확인). 표시값 = 마지막 서버 값 + 경과 tick × (분당 `BASE_PROD_RECOVER_PER_MIN_PERMILLE` × tickMs / 60000), 상한 `BASE_PROD_MAX_PERMILLE`. 경과 tick 은 `GameModel.renderTick()`(마지막 tick + 수신 후 경과/tickMs, 최대 +1)이라 매 프레임 부드럽게 차오른다. 서버 값이 오면 그 값으로 다시 맞춘다(권위). 줌 14 이상이면 바 옆에 "생산 n%".
- **지명**: 체력 바 위 라벨 — 수도(연금색, 12px) 줌 7 이상, 기지 줌 9 이상. 지형 툴팁에 "기지/수도 · 지명", "생산력 n% (회복 중)" 행(기지 체력 항목과 함께 켜고 끔). 피드: "고요담 함락 — 내가 중립 기지를 점령", "누리 함락 — 내가 BOT 2의 수도를 점령".
- **수입 = production 합** (§21.4): HUD 골드, 하단 바 골드 흐름(총·유지비 = Σgross − Σnet), 테크 창 머리·구매 대기 시간 모두 `incomeOf`. 표가 아직 없으면(부트스트랩 직후 등) 예전 `goldPerSecond` 식으로 대신. (테크 상세의 "구매 후 수입 변화"는 상대값이라 예전 식 유지)
- **hover 출처**: HUD 병력·골드에 마우스/포커스 → 제목(총합) + 기지 행(수도 ★, 지명, 칸 수, 생산력 %, 초당 양 — 많은 순) + 기타(고립지, 생산력 —). 병력 = `troopsPerSecMilli`, 골드 = `goldNetPerSecMilli`(유지비 차감 후) → 행 합 = HUD 총합. 값이 10 미만이면 소수 둘째 자리.
- **우클릭 이동**: `store.moveFlag` = §21.2 표 그대로 `cmd_flag_retarget{flagId, anchorTileId}`(내 기지 포함) — 변경 없음, 주석만 갱신. **대기 태세**: 떠 있는 버튼 아래 "태세 전환 대기 → (방어/공격)" 배지, 정보 패널에 "태세 전환 대기 → 방어 (쿨타임·전투가 끝나면 자동)". 귀환·패주 중이거나 현재와 같으면 표시 안 함.
- **멸망·합병**: 피드 "BOT 2 멸망 — BOT 7이 남은 311칸을 합병"(나면 "내가"), 합병 대상 없으면 "— 남은 땅은 중립으로". 합병한 사람이 나면 토스트. 넘어간 칸을 합병자 색 + 흰 테두리로 1.6초 깜빡이며 사라지게(`drawAnnexFlash`, 칸 경로는 flash 당 한 번). 멸망자의 production 은 빈 배열.
- `GameModel.diffAgainstFull` 에 기지 생산력·production 비교 추가 → 기존 서버 재구성 테스트(M 10인 HARD 2000 tick 등)가 §21 필드도 불일치 0 으로 확인한다.
- 도움말: 기지 위 방어 ×1.5, 생산력(×0.5·회복·금색 바·hover 출처), 기지 전부 상실 = 멸망·합병.

### 검증
- `npm run typecheck` 통과 · `npm test` 23 파일 310개 통과 · `npm run build:client` 통과.
- 새 테스트 `client/test/uiOct14b.test.ts` (15): 생산력 보간(속도·상한·tick 사이 소수·서버 값 재동기화·점령 50→25%·renderTick·바는 회복 중만), 지명 매핑(map_init → tileId, 길이 불일치)·툴팁 행·피드 문구, 출처 행 합 = 총합(병력·순골드)·정렬·생산력 %, 수입 = production 합·델타 교체·없으면 예전 식, 대기 태세(비트 128 → 버튼 상태 → 자동 적용 후 해제, full 필드, 귀환·패주·같은 태세 제외), 멸망·합병 피드·번쩍임 칸 수집·중립 처리.
- 브라우저(서버 8092 / Vite 5182, S 맵 HARD 봇 6): 지명(전체·확대), 중립 기지 우클릭 이동 → 함락 → 피드 + 바 53% → 60% → 62% → 69% 차오름, 기지 툴팁(지명·체력·생산력 회복 중), HUD 병력·골드 hover(테드반 100% / 고요담 62%), 대기 태세 표시 → 몇 초 뒤 자동 방어 전환·배지 사라짐. 스크린샷 `_workspace/screenshots/2026-10-14b_*` 9장.

### 확인 못 한 것
- **멸망 번쩍임은 브라우저에서 못 봤다**(봇 멸망까지 기다리지 않음) — 단위 테스트로 칸 수집·피드만 확인.
- 바 보간은 서버보다 최대 1‰ 앞설 수 있다(서버는 ‰×300 정수 누적 후 floor) — 다음 `baseProd` 가 덮어써 눈에 띄지 않는다.

## 16. v4.5 규칙 반영 (프로토콜 §22, 2026-10-15 — 백엔드 014317b 이후)

server/·shared/ 는 손대지 않았다. 백엔드가 빌드 유지용으로 고친 클라이언트 4파일(`gameModel.ts`·`production.ts`·`techTree.ts`·`pacing.ts`) 위에 이어서 작업했다.

### 사용하는 §22 필드
| 필드 | 쓰는 곳 |
|---|---|
| 델타 `combatLoss: [flagId, lossMilli][]` (매 tick) | `GameModel.combatLossQueue` → `render/lossFloaters.ts` → 렌더러 "−n" 숫자 |
| `production[].rows` (`kind` base/territory) | `ui/production.ts productionRows` → HUD 병력·골드 hover |
| `flag_idle.reason = "unreachable"` | 피드·토스트, `GameModel.flagIdleReason` → 지도 "막힘" 태그 |
| `flag_disengage_started.untilTick` + 소유자 스탯 `DISENGAGE_TICKS`(11) | 이탈 대기 호 길이 = (until − tick) / `techDisengageTicks(소유자 스탯)` |
| 스탯 11 `DISENGAGE_TICKS` · 13 `RETURN_SPEED`, 노드 17·19 이름·설명(shared) | 테크 상세 행·아이콘 |

### 구현
1. **틱당 전투 손실 −n** (`render/lossFloaters.ts` + `renderer.drawLossNumbers`): 깃발 바로 위에서 떠올라 1초에 사라진다(화면 px 고정 12~13px, 어두운 외곽선 + 밝은 글자 — 색각 보조면 흰 글자). **합산**: 같은 깃발의 숫자가 0.38초 안이면 거기에 더한다 → 보통 2 tick(0.4초)마다 새 숫자. **스로틀**: 교전 깃발이 12개를 넘으면 합산 창 ×2.5. **상한**: 깃발당 2개(오래된 것 버림), 전체 36개(넘치면 내·선택 깃발 → 손실 큰 순). 축소 보기(LOD)에선 내·선택 깃발만. 표시 = `lossMilli/1000` 소수 1자리(100 이상 정수).
   - 처음엔 0.2초마다 새 숫자 + 좌우 교대 배치였는데, 브라우저에서 한 깃발 위로 숫자가 기둥처럼 쌓이고 붙어 싸우는 상대 숫자와 겹쳐 지금 방식으로 바꿨다(`2026-10-15_combat-loss-numbers_before-throttle-tuning.jpg` vs `..._combat-loss-numbers.jpg`).
2. **생산 hover**: 기지 행(★수도, 지명, 환산 "100칸분/60칸분", 생산력 %, 초당 양 — 많은 순) + **영토 행 1개**(실제 칸 수, 생산력 —). "기타"·생산 지역 개념 삭제(`sumRegions` → `sumRows`, 변수명 정리). 행 합 = 총합.
3. **테크 17·19**: 아이콘 교체(17 철수 훈련 = 방패 + 뒤로 꺾인 화살표, 19 급속 귀환 = 기지 지붕 + 들어가는 화살표·속도선). 상세 행 "이탈 대기 시간 3.0초 → 2.0초"(tick × TICK_MS, 상수 우선), "귀환 속도 배율 (회수·자동 귀환·패주) ×1.50 → ×2.20". 이름·설명은 shared `TECH_NODES`.
4. **이탈 대기 호**: 상수 `DISENGAGE_TICKS` 대신 소유자 스탯(`techDisengageTicks`, match_config 노드 표 우선) — 철수 훈련 보유자는 10 tick 기준.
5. **물 이동 제거**: `input/route.ts` 거리장·걸음에서 물 전부 제외(통행 = `isClaimable`, 서버 `isPassable` 과 같다), 플레이어별 물 배율 인자·캐시 키 삭제(`moveField(topo, terrain, dest, constants?, allowed?)`). 지형 툴팁: 바다·호수 = "통행 불가 · 점령 불가"(이동 속도 행 없음), `terrainInfo` 의 얕은 물 배율 인자 삭제, 지형 이름 깊은 물/얕은 물 → **바다/호수**. `techShallowPm` 사용처 0. 로비 "얕은 물 비율" 선택지 숨김(색 구분뿐 — 서버에는 기본 BORDER_ONLY), 대기실 표시 생략. 도움말 "물과 상륙" → "물".
6. **방어 태세 경로 미리보기** (`route.ts computeRoute` 방어 분기): 서버 `defendField`·`defendDest`·`stepTowardDefend` 를 그대로 옮겼다 — 적(비동맹 플레이어) 땅 제외 거리장, 못 가면 적 땅 없이 닿는 칸 중 지형 거리(적 땅 무시)로 앵커에 가장 가까운 칸(동률 tileId)에서 멈춤. `RoutePreview.blocked / stopTile` 추가. 렌더: 멈춤 칸까지 점선 화살표 + **주황 원·흰 막대 멈춤 표식** + 멈춤 칸 → 앵커 옅은 점선. 문구 "적 땅에 막혀 n칸 가서 멈춤"(커서 툴팁·삼각 메뉴). 방어 경로 키에 소유 변경·tick·동맹 수 포함. `flag_idle unreachable` → 피드 + 토스트 "적 땅에 막혀 방어 깃발이 멈췄습니다 (공격 태세로 바꾸거나 다른 곳으로 이동)", 지도 태그 "막힘"(재지정·종료 시 해제).
7. **기지 ×1.5 태세 무관**: 부대 정보 패널 — 깃발이 자기 기지 칸 위면 "기지 위 ×1.5 (공격·방어 모두)" 줄, 설명 "지형·기지 보정 제외". 도움말 전투·기지 절.
8. **도움말·README**: 물 통행 불가·호수, 중립 비용 고정(NEUTRAL_BASE), 손실 0.2초마다 약 0.9%(COMBAT_LOSS_BP)·−n 숫자, 기지 피해 상한(초당 약 6.7%, 최소 15초 — 상수에서 계산), 생산 = 영토 + 기지 60/수도 100칸분 × 생산력, 방어 경로 제한·노출 소모(적 14%/분, 중립 절반), 서양식 지명, 철수 훈련·급속 귀환. README 에 규칙 요약 + 조작 표(우클릭 이동·칩·버튼·창 드래그·hover 출처) 갱신.

### 검증
- `npm run typecheck` 통과 · `npm test` 25 파일 353개 통과 · `npm run build:client` 통과.
- 새 테스트 `client/test/uiOct15.test.ts` (24): 손실 숫자(깃발별·2 tick 합산·같은 tick 중복 무시·busy 스로틀·깃발당 2개·전체 상한 우선순위·수명·문자열), 생산 hover(§22.5 예시 — 기지 행 + 영토 행, "기타" 없음, 행 합 = 총합), 물 통행 불가(호수 열 = 도달 불가, 틈으로 우회·경로에 물 없음, 물 앵커), 방어 경로(적 땅 벽 → 멈춤 칸 = 지형 거리 최소·경로에 적 땅 없음, 공격 태세는 통과, 틈 우회, 동맹 땅 통과), unreachable 피드·태그, 테크 17·19 상세 행. 기존 테스트 갱신: `hoverUpkeep`(호수 = 통행 불가), `issueFlow`·`options`·`uiOct14b`(시그니처·rows).
- 브라우저(서버 8092 / Vite 5182, S 맵 봇 6): 호수형 맵·서양식 지명, HUD hover "★ 호크리지 100칸분 100% / 영토 9칸", 봇끼리 교전에서 −n 숫자, 테크 17·19 상세. 스크린샷 `_workspace/screenshots/2026-10-15_*` 10장.

### 확인 못 한 것 / 주의
- **방어 막힘 미리보기 스크린샷은 연출(STAGED)**: 초반엔 적 땅 너머 내 땅(월경지)이 생기지 않아, 개발용 `window.__civwar` 로 BOT 4 땅 안 한 칸을 클라이언트에서만 내 땅으로 바꾸고(서버 full 덮어쓰기를 잠시 막음) 미리보기를 찍었다. 찍은 뒤 새로고침으로 되돌렸다. 경로 계산 자체는 단위 테스트로 서버 식과 같은 결과를 확인했지만 **실제 서버가 보낸 `flag_idle unreachable` 을 브라우저에서 받아 본 적은 없다**.
- 내 깃발이 직접 싸우는 장면(강조색 −n)은 브라우저에서 못 봤다 — 봇끼리 교전만 확인.
- 클라이언트 방어 경로는 서버 코드를 옮긴 것이라 서버 쪽 규칙이 바뀌면 같이 고쳐야 한다(서버·클라이언트 교차 테스트는 없다).

## 17. 2026-10-18 UI 개선 (OpenFront.io 참고 — 사용자 채택 1·2·3·4·6·7·9, 5 원형 메뉴 보류) + 프로토콜 §23

server/·shared/ 는 손대지 않았다. 백엔드 f292640(§23 봇 세력 이름·`allyBreaks`) 위에서 typecheck·test 를 다시 돌렸다.

### 사용하는 필드
| 필드 | 쓰는 곳 |
|---|---|
| `room_state.players[].isBot` | `ClientStore.isBotPlayer` / `store.names` → 순위표·대상 바·정보 카드의 "봇/플레이어" 구분 (이름 패턴 판정 없음 — §23.1) |
| `snapshot_full.players[].allyBreaks` · 델타 `playerDeltas[].allyBreaks?` (바뀐 때만) | `Object.assign` 으로 모델에 그대로 → `playerInfo.allyBreaksOf` → 정보 카드 "동맹 파기 n회" (없거나 모양이 다르면 줄 숨김). `diffAgainstFull` 비교 목록에도 추가 |
| `players[].troops/gold/tiles/techCount`, `bases[].ownerId/hpPct/prodPm`, `production` | 순위표 열, 대상 바, 카드, 병력 바(회복 = production 합) |
| `alliances` · `allyProposals` · `ALLIANCE_*` 상수 | 카드 외교 버튼 (`playerInfo.diplomacyAction` — 외교 창과 같은 규칙, 외교 창도 같은 `diplomacyState` 사용) |
| `room_list.rooms[]` (`RoomListing`) | 로비 방 카드 (`ui/roomCards.ts`) |

새 메시지 타입 없음. 명령은 기존 `cmd_ally_propose / cmd_ally_break / cmd_ally_respond`, `emote` 그대로.

### 구현
1. **영토 라벨 병력** (`render/territoryLabels.ts`, `renderer.drawTerritoryNames`): 이름 아래 총 병력(`fmtCompact` — "2.55K", 유효숫자 3자리 버림) 작은 줄(이름 × 0.62, 최소 9px) + 이름 왼쪽 플레이어 색 방패 문장. 겹침 상자가 병력 줄·문장 폭까지 포함(기존 크기·생략 규칙 그대로, `sub` 인자를 안 주면 예전과 같다).
2. **하단 병력 바** (`GameScreen.CommandBar`, `fmt.troopBarParts`): `현재 [채움 바 +회복/초] 상한`, 가득 차면 "가득 참". 비율 슬라이더 "보낼 병력 50% (103명)" = floor(풀 × 비율)(발령 식의 budget), hover = 병종별 깃발 병력. 골드 순수입 표시는 그대로. 상단 HUD 병력도 짧은 표기.
3. **순위표** (`panels.Scoreboard`, `playerInfo.leaderboardRows/visibleLeaderRows`): 표(#·이름·점유율·병력·골드·기지), 열 머리 클릭 = 정렬(다시 누르면 오름/내림), 탈락자는 항상 아래, 순위 = 지금 정렬 기준 자리(OpenFront 식). 넓은 화면 위 8줄(+ "전체 n명 보기"), 좁은 화면 위 4줄·#·이름·점유율·병력만. 기준 플레이어(나, 관전이면 따라가는 사람)가 밖이면 "⋯" 다음 줄에 고정. 줄 클릭 = 정보 카드 + (관전자·탈락자·종료 후) 따라가기 토글 — 예전 동작 유지. 긴 세력 이름은 말줄임.
4. **상단 대상 바** (`GameScreen.updateTargetBar`, `playerInfo.hoverTarget`): rAF 루프에서 DOM 직접 갱신(내용이 바뀔 때만). 색·이름(버튼 → 카드)·종류(플레이어/봇/중립)·관계(나/동맹/적 — 관전자는 생략)·병력·골드·기지 수·점유율. 중립 땅 = "중립 땅 · 중립 기지 n곳". 위치는 맨 위 가운데 → 겹치면 HUD 첫 줄 오른쪽 → 그래도 안 되면 HUD 아래(0.3초마다 다시 잼, 순위표·버튼 묶음 회피). 넓은 화면 커서 툴팁은 소유자 줄을 뺐다(지형 위주), 좁은 화면은 대상 바가 없어 소유자 줄 유지.
6. **플레이어 정보 카드** (`ui/PlayerCard.tsx`, `playerInfo.playerCardData`): 순위표 줄·대상 바 이름·외교 창 이름·카드 안 동맹 이름으로 연다. 색·이름·종류·관계·탈락/끊김, 점유율·병력(상한·회복)·골드(순수입)·테크 수, 기지(★수도·지명·생산력·체력, 8곳까지), 동맹 목록(해제 중이면 남은 시간), 동맹 파기 n회. 버튼: 동맹 제안/파기(최소 유지 시간 잠금 표시)/수락·거절, 제안함·해제까지 상태, 이모트(전체 공개 — 프로토콜 `emote` 는 대상이 없다), 따라가기 토글. 제목 줄 드래그(위치 기억, `player-card`), Esc·× 로 닫음. 좁은 화면은 HUD 아래 전체 폭.
7. **로비 방 카드** (`Lobby.RoomBrowser`, `ui/roomCards.ts`): 공식 맵 = 번들 썸네일(`MapThumb`, checksum 대조), 무작위 맵 = 방 id 시드로 만든 분위기 그림(`mapPreview.randomPreviewTerrain`, "무작위" 배지 — 실제 지형 아님). 맵 이름·상태(대기/곧 시작/진행 중/종료)·인원 n/최대(hover = 사람·봇)·크기(100×60 · 보통)·남은 초/경과 시간(로컬로 흐름)·관전 수·입장/관전 버튼. 방 찾기를 열면 로비 카드가 넓어진다(2열 격자, 좁은 화면 1열).
9. **우상단 컨트롤 묶음** (`GameScreen.TopCluster`, `ui/hudIcons.tsx`): 남은 시간(종반 러시면 노란색) · 이모트 · 옵션 · 도움말 · 전체 화면 · 나가기 아이콘 한 줄(title = 툴팁, aria-label). 테크·외교는 단축키·배지가 있는 주 버튼이라 왼쪽 HUD 에 남겼다. 순위표는 묶음 아래(top 48px). 좁은 화면 = 시간·옵션·도움말·나가기.

### 프로토콜과 다르게/추가로 해석한 것
- **봇 난이도(방 카드)**: `RoomListing` 에 없다. 서버가 `botDifficulty` 를 실어 보내면 표시하고 없으면 숨긴다(지금은 항상 숨김). 필요하면 백엔드에 `RoomListing.botDifficulty` 추가 요청.
- **무작위 맵 썸네일**: `room_list` 에 시드·지형이 없어 실제 맵을 그릴 수 없다 — 장식용 그림 + "무작위" 표시. 실제 미리보기가 필요하면 목록에 시드(또는 축소 지형)가 있어야 한다.
- **이모트**: 대상 지정 없음(§4) — 카드의 이모트도 모두에게 보이는 말풍선.

### 검증
- `npm run typecheck` 통과 · `npm test` 27 파일 385개 통과(백엔드 §23 포함).
- 새 테스트 `client/test/uiOct18.test.ts` (23): 짧은 표기(버림·자리 넘침 없음·음수)·초당 표기·병력 바 채움/가득 참·비율 병력, 라벨 병력 줄(겹침 상자 포함·없으면 예전과 같음·긴 세력 이름), 순위표 정렬(점유율·병력 오름/내림·골드, 탈락자 아래, 순위)·내 줄 고정(밖/안/관전), 대상 바(나·봇 적·동맹·중립 기지 수·물 null·관전자 관계 없음·델타 반영), 카드(기지 생산력·체력·지명, 동맹 해제 중, allyBreaks 있음/없음/델타 갱신·유지, 외교 버튼 제안·파기 잠금→가능·해제 중·응답·관전/나/탈락·마감), 방 카드(대기 남은 초·진행 경과·곧 시작·종료·공식 맵 이름/크기/checksum·난이도 있을 때만), 무작위 썸네일 결정론.
- 브라우저(서버 8092 / Vite 5182, M 무작위 HARD 봇 10, 공개 방 1개 대기→진행): 스크린샷 `_workspace/screenshots/2026-10-18_*` 14장 — 전체(1440), 라벨 병력, 병력 바, 순위표 내 줄 고정·병력 정렬, 대상 바(맨 위·1024 폭에서 HUD 아래로 내려감), 정보 카드(동맹 제안 → "제안함 0:30"), 모바일 플레이어·모바일 관전 카드(따라가기), 방 카드 대기/진행 중, 우상단 묶음.

### 확인 못 한 것
- **공식 맵 방 카드 썸네일**은 브라우저에서 못 봤다(공개 방은 빠른 시작 = 무작위 맵뿐) — `MapThumb` 재사용이라 방 만들기 미리보기와 같은 경로.
- 동맹이 실제 성립·파기된 상태의 카드(파기 n회 > 0)는 단위 테스트로만 확인(봇이 제안을 수락하기 전에 끝냈다).
- 전체 화면 버튼은 눌러 보지 않았다(브라우저 창 패널 제약).

## 18. 2026-10-18 우클릭 원형 메뉴 (OpenFront.io 참고 — 사용자 승인 2026-10-18)

### 사용하는 메시지 (새 메시지 없음)
- `cmd_flag_issue` — 가운데 → 병종 고리: `originBaseTileId` = 가장 가까운 내 기지(기존 삼각 메뉴와 같은 `nearestBaseFor`). 수비 배치: `anchorTileId` = `originBaseTileId` = 그 내 기지 칸 (§4 표: 내 땅 앵커 = DEFEND, 지정 기지 출발 — 프로토콜 그대로).
- `cmd_ally_propose` / `cmd_ally_break` / `cmd_ally_respond(accept=true)` — 버튼 상태는 정보 카드·외교 창과 같은 `playerInfo.diplomacyAction`.
- `emote` (코드 0·1·2·4·5·6·9·15 — 작은 고리 8개).
- 따라가기는 클라이언트 카메라만(`store.setFollow`).

### 구현
- `client/src/input/contextMenu.ts` — 순수 판정(가운데 종류·비활성 이유, 고리 항목, 병종 버튼, 배치 계산 `clampRingCenter`/`ctxExtent`/`ctxScale`).
- `controller.ts` — `Interaction.ctx`, `rightClickTile` 은 `'move' | 'menu' | null`. 내 부대 선택 + 우클릭 = 이동(2026-10-14) 그대로, 그 외(선택 없음·남의 부대 선택) = 메뉴.
  가운데를 누르면 기존 출전 상태 `issue = { phase: 'pick', …, via: 'ctx' }` 를 재사용 → 경로 화살표·기지 하이라이트·`1/2/3`·`chooseUnit` 이 그대로 동작하고, 삼각 메뉴(IssueRadial)는 via ctx 일 때 숨는다.
  닫기: Esc(다른 창보다 먼저) · 캔버스 클릭(그 클릭은 아무 동작도 시작하지 않음) · DOM 바깥 mousedown · 다시 우클릭(메뉴 위 포함). 좌·가운데 드래그 이동은 메뉴를 유지(칸을 따라감).
- `ui/ContextRadial.tsx` + `styles.css .ctx-*` — 아이콘 + 글자, 비활성 = 점선 테두리 + 흐림 + 금지 커서, 툴팁은 지형 툴팁과 같은 모양으로 고리 바깥(화면 오른쪽 절반이면 왼쪽)에. 가장자리에서는 고리를 안쪽으로 당기고(위쪽 HUD 48px 비움) 원래 칸을 핀으로 표시. 작은 창은 배율 0.7~1.
- 좌클릭 → 삼각 메뉴 흐름은 그대로 둠(중복이지만 더 빠른 경로라 제거하지 않음).
- 모바일 길게 누르기는 구현하지 않음(좁은 화면 = 관전·간단 보기).

### 판단한 것 (사용자 확인 필요)
- 수비 배치 = 한 번에 발령(병종 고리 없이) — 방어력(병종 기본 × 테크)이 가장 높은 병종, 현재 비율. 내 기지 칸의 가운데(방어)는 병종을 고르는 경로로 남겼다.
- 원형 메뉴 이모트는 16개 중 8개만(작은 고리). 전체는 우상단 이모트 버튼·정보 카드.
- 관전자·종료 후에도 메뉴는 열린다(정보·따라가기만 사용 가능, 나머지는 이유와 함께 비활성).
- 가운데 사전 판정: 관전 / 물 / 동맹 영토 / 깃발 슬롯 가득 / 내 기지 없음 / 사거리(40칸) 밖. 병종 버튼: 최소 병력 40 미만. 서버 판정이 최종(cmd_ack).

### 검증
- `client/test/contextRadial.test.ts` 24개 (여는 조건, 칸별 항목, 비활성 이유, 가운데 → 병종 → cmd_flag_issue, 수비 배치, 동맹·정보·따라가기·이모트, Esc·캔버스 클릭·다시 우클릭 닫기, 배치). `issueFlow.test.ts` 의 "선택 없음/남의 부대 + 우클릭 = null" 단언을 'menu' 로 갱신.
- 브라우저(서버 8092 / 클라이언트 5182, 봇 9): 내 수도·적 땅(사거리 밖 이유)·중립 → 병종 고리 → `2` 로 실제 발령 수락, 바깥 HUD 클릭·드래그 유지·다시 우클릭 닫기, 정보 → 정보 카드. 콘솔 오류 없음.
  스크린샷: `_workspace/screenshots/2026-10-18b_{own-base,enemy-tile,unit-ring,disabled-tooltip}.jpg`.
