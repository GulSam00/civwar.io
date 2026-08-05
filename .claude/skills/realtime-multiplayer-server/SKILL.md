---
name: realtime-multiplayer-server
description: "Node.js + TypeScript + WebSocket(ws)으로 실시간 멀티플레이어 게임의 권위 서버(authoritative server)를 구축하는 방법론. 게임 룸/로비, 고정 tick 루프, 상태 브로드캐스트, 클라이언트 입력 검증, WebSocket 프로토콜 문서화를 다룬다. 멀티플레이어 서버 구현, WebSocket 룸 설계, 틱 루프 구현, 프로토콜 스키마 작성 요청 시 반드시 이 스킬을 사용할 것."
---

# 실시간 멀티플레이어 서버 — Node.js + WebSocket 권위 서버

브라우저 IO 게임의 서버는 "클라이언트가 보낸 걸 그대로 중계"하면 안 된다. 클라이언트는 조작될 수 있으므로, 서버가 게임 상태의 유일한 근거(source of truth)여야 한다. 이 스킬은 그 구조를 만드는 방법을 다룬다.

## 아키텍처 개요

```
[클라이언트] --입력(의도)--> [서버] --검증+적용--> [게임 상태]
                                                        │
[클라이언트] <--상태 브로드캐스트(매 tick)-- [서버] <---┘
```

클라이언트는 "무엇을 하고 싶은지"만 보낸다("A영토에서 B영토로 공격"). 서버가 그 의도가 유효한지(내 소유인가, 인접한가, 병력이 있는가) 검증하고 게임 상태에 반영한다.

## 게임 룸 / 로비

- 방(room) 단위로 게임 상태를 격리한다. 방마다 독립된 tick 루프와 플레이어 목록을 가진다.
- 로비 단계(대기 중)와 인게임 단계(진행 중)를 명확히 분리한다 — 로비에서는 참가/퇴장만 허용하고, 시작 후에는 게임 액션만 허용한다.
- 인원 최소치 미달 시 시작 불가, 최대치 초과 시 참가 거부 — GDD의 세션 페이싱 전제(플레이어 수)를 지키기 위해 필요하다.
- 방 시작 조건(예: 최소 인원 도달 + 방장 시작 버튼, 또는 자동 매치메이킹)은 GDD에 없다면 가장 단순한 것(방장 시작)을 기본값으로 택한다.

## Tick 루프

```typescript
const TICK_RATE_MS = 200; // GDD의 성장/전투 공식과 반드시 일치시킨다

setInterval(() => {
  for (const room of activeRooms) {
    room.processPendingActions();   // 이번 tick에 쌓인 클라이언트 액션 처리
    room.advanceSimulation();       // 자원 생산, 전투 해석 등 게임 규칙 적용
    room.checkWinCondition();       // 승리조건 확인, 충족 시 게임 종료 처리
    room.broadcastState();          // 결과를 모든 클라이언트에 전송
  }
}, TICK_RATE_MS);
```

- tick 간격은 GDD의 성장 공식이 "초당 X" 같은 형태로 되어 있으면 그 값을 그대로 나눠 쓴다. GDD와 tick 간격이 어긋나면 밸런스가 GDD 의도와 달라진다.
- 클라이언트 액션은 즉시 처리하지 않고 큐에 쌓았다가 다음 tick에 일괄 처리한다 — 이렇게 해야 동시 다발 액션(같은 타일에 대한 동시 공격 등)을 GDD가 정한 규칙대로 결정론적으로 처리할 수 있다.

## 상태 브로드캐스트

- MVP 단계에서는 **풀 스냅샷** 방식을 기본으로 한다: 매 tick마다 전체 게임 상태를 JSON으로 직렬화해 방의 모든 클라이언트에 보낸다. 구현이 단순하고 버그가 적다.
- 델타(변경분만 전송) 압축은 실제로 대역폭/성능 문제가 측정된 뒤에만 도입한다. 조기에 델타 방식을 쓰면 프로토콜이 복잡해지고, 클라이언트가 스냅샷을 잘못 재구성하는 경계면 버그가 생기기 쉽다.
- 브로드캐스트 payload에는 최소한 다음이 포함되어야 한다: 각 영토의 소유자/병력 수, 게임 경과 시간(또는 남은 시간), 게임 상태(진행 중/종료).

## 입력 검증 (서버 권위)

클라이언트가 보내는 모든 액션에 대해 서버는 다음을 재검증한다:
- 보낸 플레이어가 실제로 그 방/게임에 참여 중인가
- 대상 영토가 실제로 그 플레이어 소유인가 (클라이언트가 잘못 알고 있거나 조작했을 수 있음)
- 목표 영토가 인접한가 (GDD의 인접 규칙 기준)
- 요청한 병력 이동량이 보유량을 초과하지 않는가

검증 실패 시 해당 액션은 조용히 무시하거나 에러 메시지를 반환한다 — 어느 쪽이든 프로토콜 문서에 명시한다.

## WebSocket 프로토콜 문서화

서버 구현과 동시에(또는 직전에) `_workspace/02_backend_protocol.md`를 작성한다. 다음 형식을 따른다:

```markdown
# civwar.io WebSocket 프로토콜

## Client → Server

### JOIN_ROOM
\`\`\`json
{ "type": "JOIN_ROOM", "roomId": "string", "playerName": "string" }
\`\`\`

### ATTACK
\`\`\`json
{ "type": "ATTACK", "from": "tileId", "to": "tileId", "troopRatio": 0.5 }
\`\`\`

## Server → Client

### STATE_UPDATE
\`\`\`json
{
  "type": "STATE_UPDATE",
  "tick": 123,
  "elapsedMs": 24600,
  "tiles": [{ "id": "tileId", "owner": "playerId | null", "troops": 42 }]
}
\`\`\`

### GAME_OVER
\`\`\`json
{ "type": "GAME_OVER", "winnerId": "playerId | null", "reason": "string" }
\`\`\`
```

**이 문서가 실제 코드와 어긋나면 안 된다.** 필드를 하나 추가/변경하면 문서도 즉시 갱신한다 — `integration-qa`가 이 문서를 신뢰 소스로 놓고 코드와 대조하기 때문이다.

## 재접속 처리

- 최소 요건: 플레이어가 연결이 끊겨도 일정 시간(예: 30초) 동안 게임에서 제거하지 않고, 같은 세션 토큰으로 재접속하면 현재 상태를 다시 스냅샷으로 보내 복구한다.
- 시간 초과 시 처리(자동 항복, AI 전환 등)는 GDD에 없다면 "영토 방치(자동 방어만, 확장 불가)"를 기본값으로 택한다 — 가장 구현이 단순하고 다른 플레이어에게 불공정하지 않다.

## 프로젝트 구조 제안

모노레포가 아니어도 되지만, 클라이언트와 프로토콜 타입을 공유하려면 다음 구조를 권장한다:

```
/server   - Node.js + TypeScript + ws
/client   - React + TypeScript + Vite (frontend-game-client-engineer가 작성)
/shared   - 프로토콜 메시지 타입 정의 (양쪽에서 import)
```

`/shared`에 메시지 타입을 TypeScript interface로 정의해두면 `_workspace/02_backend_protocol.md`의 예시와 실제 타입이 어긋나는 것을 컴파일 타임에 어느 정도 방지할 수 있다 (완전한 런타임 검증은 아니므로 `integration-qa`의 교차 검증은 여전히 필요하다).
