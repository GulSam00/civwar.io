# civwar.io

실시간 멀티플레이어 영토 정복 IO 게임. 2~12인, 한 판 25~32분(표준 30분).

깃발에 병력을 실어 보내 땅을 점령하고, 공격/방어 태세로 적 깃발과 싸운다. 점유율이 승리 기준(16분부터 60% → 26분에 45%)에 닿거나 32분 하드 타임아웃 시 점유율 1위가 승리한다.

## 실행

요구: Node.js 22, npm.

```bash
npm install
npm run dev
```

서버(ws, 8080)와 클라이언트(Vite, 5173)가 함께 뜬다. 브라우저에서 http://localhost:5173 접속 → 닉네임 → **빠른 시작**. 빈자리는 봇이 채운다.

따로 띄우기: `npm run start:server`, `npm run dev:client`. 다른 서버에 붙이기: `http://localhost:5173/?ws=ws://<host>:8080`.

## 조작 (PC)

| 입력 | 동작 |
|---|---|
| `1` / `2` / `3` → 맵 클릭 | 창병 / 검병 / 기병 깃발 발령 (내 땅 = 방어 태세, 적·중립 = 공격 태세) |
| `Q` / `E` | 보낼 병력 비율 |
| `Alt+클릭`, 기지 위 `B` | 출발 기지 지정 |
| 깃발 선택 → 우클릭 / `F` / `R` / `Tab` | 재지정 / 태세 전환(쿨타임 5초) / 회수 / 내 깃발 순환 |
| `T` / `P` / `C` / `?` | 테크 / 외교 / 색각 보조 / 도움말 |

## 개발

| 명령 | 내용 |
|---|---|
| `npm run typecheck` | shared·server·client 타입 검사 |
| `npm test` | 전체 테스트 (vitest) |
| `npm run smoke` | 실제 ws 서버 스모크 |
| `npm run build:client` | 클라이언트 빌드 |
| `npm run selfplay -w @civwar/server -- 10 1000 M 10` | 봇 자가대전 (판 수, 시드, 크기, 인원) |
| `npx tsx server/scripts/export-map.ts --size M --seed 1000 --count 40` | 맵 후보 생성 → `node server/scripts/eval-maps.cjs server/maps/candidates` 로 평가 |

## 구조

- `shared/` 상수(밸런스 단일 소스)·프로토콜 타입 — 서버·클라이언트가 TS 소스를 그대로 공유
- `server/` 권위 서버: 5Hz 결정론 tick, 맵 생성·공식 맵 9장(`server/maps/official`), 봇 AI
- `client/` React + Canvas 클라이언트
- `_workspace/` 설계·프로토콜·QA 문서 — GDD `01_game-designer_gdd.md`, 프로토콜 `02_backend_protocol.md`(클라이언트의 신뢰 소스), 결정 기록 `00_input/design-decisions.md`
