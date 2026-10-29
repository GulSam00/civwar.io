# QA 보고서 — GDD v5.1 전체 경계면 교차 검증 (오케스트레이터 Phase 6)

- 작성: 2026-10-29, integration-qa
- 대상: 서버·shared `d900c0f` + `e3c8aac`(커밋됨), 클라이언트 v5.1 반영분(미커밋: `client/` 수정 16개 + `client/src/input/origin.ts`, `client/test/v51.test.ts`)
- 기준 문서: `_workspace/02_backend_protocol.md` §37, `_workspace/03_frontend_integration-notes.md` §26, `_workspace/01_game-designer_gdd.md` 2.5 · 4.2 · 4.4~4.6 · 9장, `_workspace/04_qa_report_v51_backend.md` F-1~F-8
- 코드는 고치지 않았다. 커밋·stash·reset·checkout 하지 않았다. 스크래치 스크립트는 세션 scratchpad 에만 두었다.

## 결론

**통과. 치명적 문제 0건.** 프로토콜 문서 · 서버 · 클라이언트 3자 사이에서 v5.1 필드 · 이벤트 · 거절 사유의 shape 불일치를 찾지 못했다. 클라이언트 재구성 쿨타임, 출발 기지 선택, 점령 비용, 사기 하한 판정을 실제 봇 판 전체에서 서버 값과 직접 비교했고 불일치는 0이었다. 실제 v5.1 서버(직접 띄운 8091)에서 사기 붕괴 자동 후퇴의 토스트 · 피드 · 지도 태그가 뜨는 것을 브라우저로 확인했다.

경미한 문제 4건(전부 프론트, 게임 동작 · 상태 일관성에는 영향 없음)과 관찰 2건을 남긴다.

## 실행한 검증

| 항목 | 명령 / 방법 | 결과 |
|---|---|---|
| 타입 검사 | `npm run typecheck` (shared · server · client 모두 `--noEmit`) | 0 오류 |
| 전체 테스트 | `npx vitest run` | **611/611 통과** |
| 서버+클라이언트 동시 구동 대조 (스크래치 `v51full.mts`) | 서버 `Simulation` 이 내보내는 모든 메시지를 JSON 왕복 후 클라이언트 `GameModel` 에 그대로 먹이며 매 tick 대조. M 10인, 시드 1000 · 1001(지연 0), 1002(지연 2 tick), 1003(지연 2 · 3 · 4 tick). 1번 자리는 사람 흉내(명시 `originBaseTileId` 로 발령) | 아래 F-3 · F-4 · F-5 · F-6 · F-7 |
| 출발 기지 거리 변경 부작용 (스크래치 `toposide.mts`) | 토폴로지 거리로 고른 기지 vs 가중 이동 거리 최단 기지, M10 시드 1000 · L16 시드 2024 | 아래 F-4 |
| 실제 판 (브라우저) | 직접 띄운 v5.1 서버 `PORT=8091` + `vite --port 5181`, S 6인(봇 5) 판을 관전 | 게이지 · 사기 붕괴 토스트/피드/태그 확인, `reconStats.mismatchedFulls = 0`. 스크린샷 `_workspace/ui-2026-10-29-qa/` |

8080/5173 에 떠 있던 서버(PID 29092, 2026-10-28 22:23 시작)는 v5.1 빌드인지 확인하지 않고 건드리지 않았다. 대신 새 포트로 띄웠고, 그 서버의 `match_config.constants` 에서 `BASE_DISPATCH_COOLDOWN_TICKS=25`, `MORALE_BASE_FLOOR=300`, `UNIT_ATK_MULT_PERMILLE=[1000,1000,1000]` 를 확인했다. 확인이 끝난 뒤 직접 띄운 서버 · vite · 호스트 스크립트는 모두 종료했다.

### 대조 스크립트 수치 (지연 0 판 두 개 합)

| 대조 | 비교 횟수 | 불일치 |
|---|---|---|
| F-3 `snapshot_full.bases[].dispatchReadyTick` vs 클라 재구성 값 (판 전체) | full 727회 (기지 수 × full 은 그 이상, 0이 아닌 값 1403개 포함) | **0** |
| F-3 `GameModel.diffAgainstFull` 의 기지 항목 | 727 | **0** |
| F-4 `pickIssueOrigin(model, topo, p, anchor)` vs 서버 `pickOriginBaseFor(state, p, anchor, tick+1)` (전원 · 무작위 앵커) | 293,582 (그중 쿨타임 때문에 다음 기지로 간 경우 12,607, 전부 쿨타임 33,166) | **0** |
| F-4 클라가 고른 기지가 서버 `tick+1` 에서 쿨타임인 경우 | 같음 | **0** |
| F-4 `baseWaitTicks == 0` ⇔ 서버 `isBaseDispatchReady(tick+1)` (모든 내 기지) | 같음 | **0** |
| F-7 `captureCost` vs 서버 `tileCost` (전원 · 병종 3 · 무작위 칸, 러시 · 빚 강제 표본 포함) | 385,194 (적 265k · 중립 120k · 인접 가산 265k · 보급 375k · 러시 73k · 빚 32k · 기지 칸 1.4k · 테크 보유 3.1k 플레이어-표본) | **0** |
| F-7 `techStatsOf(techMask)` vs 서버 `statPm` | 플레이어-표본 전부 | **0** |
| F-6 `moraleBaseFloor !== null` ⇔ 서버 `onOwnBase` (모든 깃발 · 매 tick) | 607,318 (표시 105,889) | **0** |
| F-5 `flag_recalled{morale}` → 토스트 Draft · `moraleRetreat` 등록 | 219건 (지연 판 포함 478건) | **0** 누락. `reason` 없는 `flag_recalled` 0건 |
| F-5 앞선 `flag_disengage_started{auto:true}` 가 알림 · "태세 전환 중" 으로 잡힘 | 같음 | **0** |
| 사람 흉내 발령(명시 출발 기지)의 `BASE_COOLDOWN` 거절 | 지연 0: 172건 / 지연 2 · 3 tick: 136+136+76건 | **0** (지연 4 tick 은 경미 m-1) |

## 항목별 대조

### F-1 `REJECT_TEXT.BASE_COOLDOWN` — 통과
`client/src/ui/text.ts:31`. 서버 거절 위치 `server/src/game/flagops.ts:138`(지정) · `:143`(생략 · 전부 쿨타임)과 `shared/src/protocol.ts:38` 이 같다. 클라이언트 tsc 통과.

### F-2 테스트 기대값 — 통과
`options.test.ts` · `techTree.test.ts` · `unitStats.test.ts` · `qaV45.test.ts` · `unitRing.test.ts` 가 갱신됐고 전체 611건이 통과한다.

### F-3 기지 출전 쿨타임 상태 — 통과
- 생산자: `server/src/game/snapshot.ts:179`(`snapshot_full` 에만), `flagops.ts:157`(수락된 발령의 출발 기지만 `t+25`), `state.ts:477`(`setTileOwner` 에서 0). `setTileOwner(…, record=false)` 는 초기화(`state.ts:430`)에서만 쓰여 `tileChanges` 없이 주인이 바뀌는 경로는 없다.
- 소비자: `client/src/state/gameModel.ts` — full 로 초기화(없으면 0), `flag_issued` 의 `originTileId` 가 기지면 `e.tick + dispatchCooldownTicks`, `base_captured` · 델타 `tileChanges` 기지 칸이면 0. 백엔드 QA 불변식 1과 같은 세 규칙이다.
- 판 전체에서 서버 값과 정확히 같았다(위 표). 실제 브라우저 판에서도 개발 빌드 대조기(`window.__civwar.reconStats`)가 full 48회 이상 동안 `mismatchedFulls = 0`.
- **로컬 임시 쿨타임(`controller.sentFrom`)이 서버 상태를 덮어쓰는가 — 아니다.** `sentFrom` 은 컨트롤러 안의 별도 Map 이고 `GameModel.bases` 를 건드리지 않는다. 읽을 때만 `readyTickWith` 가 `max(서버 값, 로컬 값)` 으로 합친다(`client/src/input/origin.ts:38-40`). 서버 `flag_issued` 값은 `처리 tick + 25 ≥ 보낸 tick + 1 + 25` 이므로 도착하면 항상 서버 값이 이긴다. 게이지(`renderer.drawDispatchGauges`)와 hover 는 서버 값만 쓴다.
- 오판 가능성: 거절된 발령의 기지가 최대 5 tick 동안 쿨타임으로 보인다(경미 m-2). 응답이 5 tick 안에 안 오면 같은 기지를 다시 고른다(경미 m-1).

### F-4 출발 기지 미리보기 — 통과 (경미 m-1)
- 같은 함수 · 같은 입력: 클라 `pickIssueOrigin`(`origin.ts:42-50`) 과 서버 `pickOriginBaseFor`(`flagops.ts:205-212`) 모두 shared `pickOriginBase`. 후보는 클라 `g.baseTiles` 중 주인이 나인 것, 서버 `p.baseTiles`(동률 처리는 함수 안에서 tileId ASC 라 순서 무관). 거리는 클라 `SquareTopologyView.distance`(`client/src/render/topology.ts:108-112`) 와 서버 `server/src/topology/square.ts:62-66` 이 같은 맨해튼 식이다.
- tick 기준: 클라 `g.tick + 1`, 서버는 실제 처리 tick `T ≥ g.tick + 1`. 내 기지의 준비 tick 은 내 발령으로만 늘고 소유권 변경으로만 0이 되므로, 클라가 `g.tick+1` 에 준비됐다고 본 기지는 T 에서도 준비 상태다(내 다른 발령이 그 사이 같은 기지를 쓰지 않는 한 — 이것을 `sentFrom` 이 막는다). 그래서 명시 `originBaseTileId` 가 `BASE_COOLDOWN` 으로 거절되는 경우는 지연 0~3 tick 에서 0건이었다.
- 거절이 나는 경우: 왕복 지연이 길어 `flag_issued` 가 `sentFrom` 유효 기간(5 tick = 1초)보다 늦게 오면, 그 사이 다시 누른 발령이 같은 기지를 고른다 → m-1.
- 우클릭 출발 기지를 가중 이동 거리에서 토폴로지 거리로 바꾼 부작용: 출발 기지가 달라진 비율은 M10 1.4%(364 표본 중 5), L16 4.2%(451 중 19). 이동 거리 증가는 중앙값 ×1.05~1.11, 최대 ×1.37, ×2 이상 0건, **도달 불가 기지 선택 0건**. 고른 기지에서 화살표 경로(`computeRoute`)를 그리므로 화면과 실제 경로는 같다. 서버가 생략 시 고르는 기지와 같아졌으므로 의도한 변화이며 결함으로 보지 않는다.

### F-5 `flag_recalled.reason` 소비 — 통과
- 서버 송신 4곳(`flagops.ts:307` · `:324`, `basecapture.ts:30`, `gauge.ts:382`), 판 전체에서 reason 누락 0건.
- 클라: `feed.ts:156-161` 은 `reason ?? 'command'` 로 읽고 `morale` 이며 내 깃발일 때만 토스트. `gameModel.ts` `flag_recalled` 에서 `moraleRetreat` 등록, 다른 사유 회수 · `flag_ended` · `flagsGone` · 새 발령 · full 에서 RETURNING 이 아니면 제거. `flag_disengage_started{auto:true}` 는 피드 · `disengageForPosture` 어디에도 들어가지 않는다(대조 0건). RETURNING 깃발은 재지정이 거절되므로(`flagops.ts:234`) 표식이 남는 경로도 없다.
- 실제 판: t1343 `flag_recalled{flag 70, reason:"morale"}` 에서 따라가는 플레이어 기준 토스트 · 피드 줄 "사기 붕괴 후퇴 — …" 와 자홍색 `사기 붕괴` 태그가 떴고, 귀환 내내(t1392~1399 RETURNING) 표식이 유지됐다. 같은 tick 의 다른 `auto:true`(flag 73, 귀환 중 붙잡힘)는 알림이 없었다. `02_morale_retreat_toast_feed_tag.jpg`, `03_morale_retreat_tag_zoom.png`.
- F-8(재접속자는 RETURNING + disengaging 으로만 봄): full 에서 RETURNING 이 아닌 표식만 지우고, 새 접속자는 표식이 없다. 문서대로다.

### F-6 기지 사기 하한 표시 — 통과
- 서버 4c(`server/src/game/combat.ts:390-399`): 교전 중 · 자기 기지 칸 · m<300 → `min(300, m + floor(10 × 회복배율/1000))`, 아니면 `max(300, m−d)`.
- 클라 `client/src/ui/morale.ts` `moraleBaseFloor`: 모델 2 · `bases.get(posTileId).ownerId === f.ownerId` → `MORALE_BASE_FLOOR`(config 우선). 서버 `onOwnBase` 판정과 60만 표본에서 일치.
- 문구(`GameScreen.tsx` `moraleRows`): 300 미만 "전투 중에도 30%까지 회복 (+rec%/초)", 이상 "30% 아래로 안 떨어짐". `rates.recoverBase = floor(MORALE_RECOVER_BASE × 회복배율/1000) × 5` %/초 단위라 서버 `rec`(‰/tick)와 같은 식이다. 패주 깃발은 카드 자체를 띄우지 않는다(`!fl.routed`).

### F-7 점령 병력 hover — 통과
- `client/src/ui/unitStats.ts:88-112` `captureCost` 와 `server/src/game/rules.ts:178-198` `tileCost` 의 곱 순서 · floor 위치가 같다: 기본(중립 7 / 적 11) → 중립 테크 또는 방어자 DEF × 공격자 ATK → 인접 가산(같은 주인 이웃 수) → 지형 → 병종 점령 배율 → 보급(내 기지 최단 토폴로지 거리) → 종반 러시 → 빚(`gold < 0`; 스냅숏 `gold = floor(goldMilli/1000)` 이라 음수 판정이 서버와 같다) → `ceilMicro` · 최소값.
- 서버 값과 직접 비교 38.5만 건 불일치 0 (러시 · 빚은 양쪽 상태를 같이 강제한 표본 포함).
- 기지 칸 `baseCaptureTroops`(`unitStats.ts:120-129`)는 GDD 4.4 [A-5.1-6·7]의 근사 식 그대로다. `hpPct` 가 서버에서 floor(`snapshot.ts:38-39`)라 표시값은 실제보다 최대 1%p 체력분 적다 → "약 N명" 표기로 충분.
- 수비 깃발 판정 `baseGuarded`(`terrainInfo.ts`)는 서버 `baseOccupiedByHostile`(`gauge.ts:106-112`, `combatEligible`)을 스냅숏 필드(routed · breakaway · troops)로 근사한다. 시간 ×2 문구에만 쓰여 병력 수치에는 영향 없다.

## ws-protocol-qa 체크리스트 (v5.1 중심)

#### 프로토콜 문서 ↔ 서버
- [x] §37.1 의 새 항목(`BASE_COOLDOWN`, `bases[].dispatchReadyTick`, `flag_recalled.reason`, `match_config.constants` 2개)이 실제로 송신된다 — 대조 스크립트 · 실제 서버 모두 확인. 백엔드 QA(`qa-ws` 82/82, 스키마 위반 0)와 같다.
- [x] 서버가 문서에 없는 v5.1 필드를 보내지 않는다(델타에 쿨타임 없음, 깃발 필드 추가 없음).
- [x] 필드명 camelCase 일관.

#### 프로토콜 문서 ↔ 클라이언트
- [x] 클라가 읽는 v5.1 필드(`dispatchReadyTick`, `reason`, `auto`, `originTileId`, `tileChanges`, `constants.BASE_DISPATCH_COOLDOWN_TICKS · MORALE_BASE_FLOOR`)는 모두 문서에 있고 서버가 채운다.
- [x] 옵셔널 방어: `dispatchReadyTick ?? 0`, `reason ?? 'command'`, constants 는 shared 상수로 폴백.
- [x] `cmd_flag_issue.originBaseTileId` 를 실제 UI(우클릭 · 기지 조준)에서 보낸다. 발령 경로는 `controller.chooseUnit` 하나뿐이다(`store.issueFlag` 호출 1곳).

#### GDD ↔ 서버 로직
- [x] 백엔드 QA 결과를 재확인할 필요 없이 이번 대조에서 쿨타임 · 하한 판정이 클라 재구성과 맞음을 확인. GDD 4.6 조건 5의 "다음 tick" 문구 차이(백엔드 m-4)는 그대로 남아 있다(game-designer 판단 사항).

#### 좌표/단위계
- [x] 서버 · 클라 모두 `row*width+col` 사각 토폴로지, 거리 = 맨해튼으로 같다.

#### 엣지 케이스
- [x] 재접속: `snapshot_full` 로 쿨타임을 다시 맞추고 `moraleRetreat` 는 문서대로 비어 시작한다.
- [x] 기지가 없는 플레이어: 서버는 영토 출발(쿨타임 없음)을 허용, 클라 `flag_issued` 처리는 기지가 아닌 출발 칸이면 아무 것도 바꾸지 않는다.
- [ ] 마지막 1명 · 인원 초과: v5.1 변경과 무관해 이번에 보지 않았다.

## 치명적 문제
없음.

## 경미한 문제 (모두 프론트 — frontend-game-client-engineer)

### m-1. 왕복 지연이 1초를 넘으면 연타 시 `BASE_COOLDOWN` 거절이 난다
- 위치: `client/src/input/controller.ts:277` (`g.tick > v.sent + 5` 이면 `sentFrom` 에서 버림), `:431`.
- 원인: 보낸 기지의 임시 쿨타임이 "보낸 tick + 5"(1초)에 사라진다. `flag_issued` 가 그보다 늦게 오면 그 사이 같은 기지가 다시 준비 상태로 보여 같은 기지를 명시해 보낸다.
- 재현(스크래치 `v51full.mts 1003 M 10 <지연tick> 1`): 단방향 지연 2 · 3 tick 에서는 거절 0건, **4 tick(단방향 0.8초, 왕복 약 1.6초)에서는 사람 흉내 발령 242건 중 121건이 `BASE_COOLDOWN`**(4 tick 간격 연속 발령). 예: seq 2 base 731, 클라가 tick 8 에 보냄 → 서버 처리 tick 17, 서버 준비 tick 34.
- 영향: 토스트 한 번과 그 발령 실패뿐이다. 상태는 어긋나지 않는다. 보통 지연(왕복 1초 미만)에서는 나지 않는다.
- 수정 방법: 버리는 조건을 "flag_issued(같은 기지) 또는 cmd_ack 거절을 받을 때까지, 최대 N초"로 바꾼다. 예: `sentFrom` 에 clientSeq 를 같이 넣고 cmd_ack 를 받으면 버린다. 또는 만료를 5 tick 에서 `ceil(RTT/tickMs)+2` 로 늘린다.

### m-2. 다른 사유로 거절된 발령의 기지가 최대 1초 동안 "출전 준비 중 약 5초"로 보인다
- 위치: `controller.ts:431` 은 보내는 즉시 `ready = g.tick + 1 + 25` 를 넣는다. `INSUFFICIENT` · `NO_SLOT` · `TOO_SMALL` 등으로 거절돼도 5 tick 동안 지워지지 않는다.
- 영향: 그 1초 동안 고리를 다시 열면 "이 기지는 출전 준비 중입니다 (5초 뒤 가능)" 또는 다음 기지 안내가 보이고, 1초 뒤 갑자기 풀린다. 표시만의 문제다.
- 재현: 병력 풀보다 많은 병력으로 발령해 `INSUFFICIENT` 를 받은 직후 같은 지점을 우클릭한다(통합 노트 §26 "거절되면 1초 뒤 사라진다"와 같은 동작).
- 수정 방법: m-1 과 같이 cmd_ack 거절을 받으면 그 clientSeq 의 `sentFrom` 항목을 바로 지운다.

### m-3. 남은 시간 표시가 실제보다 최대 1 tick(0.2초) 길다
- 위치: `client/src/input/origin.ts:48`(`ready(t) - g.tick`), `:55`(`r - g.tick`).
- 내용: 출전 가능 판정은 `g.tick + 1 ≥ ready` 인데 남은 tick 은 `ready − g.tick` 으로 센다. 실제로 기다릴 tick 은 `ready − g.tick − 1` 이다. 초 단위 올림 때문에 "1초"가 0.2초 더 오래 남는 정도다.
- 수정 방법: `ready − (g.tick + 1)` 로 센다(최소 1 유지). 아니면 그대로 둔다.

### m-4. 9장 "설명 문장은 두지 않는다" 원칙과 새 문구 길이
- 위치: `client/src/state/feed.ts:160` 토스트 "사기 붕괴 후퇴 — 사기가 0이 되어 깃발이 자동으로 물러납니다 (이탈 대기 뒤 귀환, 도착하면 남은 병력 85% 환급)", `GameScreen.tsx` `moraleRows` "전투 중에도 30%까지 회복".
- 내용: GDD 9장 원칙("수치만 표시하고 설명 문장은 두지 않는다")보다 길다. 실제 판 화면(`02_morale_retreat_toast_feed_tag.jpg`)에서 토스트가 두 줄, 피드가 세 줄을 차지한다. 기능 문제는 아니다.
- 수정 방법: 예를 들어 "사기 붕괴 후퇴 (85% 환급)" 정도로 줄일지 game-designer · 사용자 판단.

## 관찰 (결함 아님)
- 관전자는 지형 hover 에 점령 병력 · 출전 쿨타임 줄이 없다. `GameScreen.tsx:316` 이 `store.myPlayerId`(관전 시 null)를 넘기기 때문이고, 따라가는 플레이어 기준으로 보이지 않는 것은 v5.1 이전과 같은 설계다. 지도 게이지는 관전 시 모든 기지에 보인다(`01_spectate_dispatch_gauge.jpg`).
- GDD 4.4 [A-5.1-5]는 hover 점령 병력을 "선택 병종 또는 기본 검병 기준"으로 적었는데, 클라는 선택이 없으면 세 병종을 보이고 같으면 한 숫자로 합친다. 무테크에선 결과가 같고, 테크 차이가 있으면 더 많은 정보를 준다. 문서를 클라 동작에 맞출지 game-designer 판단.

## 재작업할 쪽
- **프론트**: m-1 · m-2(같은 수정으로 해결) · m-3(선택) · m-4(문구, game-designer 와 같이). 모두 경미.
- **백엔드**: 없음. 백엔드 QA 의 m-1(qa-scenarios 미갱신) · m-2 · m-3 · m-5(문서 낡음)는 이번 범위에서 다시 보지 않았고 그대로 남아 있을 수 있다.

## 확인하지 못한 것
- 사람 플레이어로 브라우저에서 직접 발령하는 흐름(우클릭 고리의 "더 가까운 기지는 출전 준비 중" · 모두 쿨타임 비활성 · `BASE_COOLDOWN` 토스트 · 지형 hover "함락까지 약 N명")은 화면으로 보지 못했다. 관전 세션 토큰이 새 탭에서도 이어져 플레이어로 다시 들어가는 데 실패했다. 이 부분은 `client/test/v51.test.ts` 단위 테스트와, 같은 함수를 실제 판 입력으로 서버와 비교한 대조 스크립트(불일치 0)로만 확인했다.
- 부대 창(FlagPanel)의 "사기 붕괴 후퇴" 상태 줄과 사기 카드의 하한 눈금은 실제 화면으로 보지 않았다(관전자는 부대 창이 없음). 단위 테스트와 `moraleBaseFloor` 판정 대조로만 확인.
- 8080 에 떠 있던 서버가 v5.1 빌드인지는 확인하지 않았다(건드리지 않음).
- 기지 함락 병력 근사(`baseCaptureTroops`)를 실제 함락 지출 합과 비교하지는 않았다. GDD 가 근사를 허용한다.
- 마지막 1명 · 인원 초과 등 v5.1 과 무관한 엣지 케이스.

## 산출물
- 스크린샷: `_workspace/ui-2026-10-29-qa/01_spectate_dispatch_gauge.jpg`, `01b_dispatch_gauge_zoom.png`, `02_morale_retreat_toast_feed_tag.jpg`, `03_morale_retreat_tag_zoom.png`
- 스크래치 스크립트(레포 밖): 세션 scratchpad 의 `v51full.mts`(서버-클라 동시 구동 대조), `toposide.mts`(출발 기지 거리 부작용), `host.mts`(실제 판 방 생성)
