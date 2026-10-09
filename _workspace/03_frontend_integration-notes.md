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
