---
name: react-game-client
description: "React + TypeScript + Vite로 실시간 멀티플레이어 게임 클라이언트를 구축하는 방법론. Canvas 기반 맵/영토 렌더링, WebSocket 연동 훅, 렌더 루프와 상태 갱신 분리, 로비/HUD UI 구성을 다룬다. 게임 클라이언트 구현, Canvas 렌더링, WebSocket 훅, 게임 UI(로비/HUD/미니맵) 요청 시 반드시 이 스킬을 사용할 것."
---

# React 게임 클라이언트 — 실시간 멀티플레이어 IO 게임

서버가 게임 상태의 유일한 근거이므로, 클라이언트의 역할은 **서버 상태를 빠르게 렌더링**하고 **입력을 서버에 의도로 전달**하는 것으로 좁혀진다. 이 스킬은 그 구조를 React + Canvas로 구현하는 방법을 다룬다.

## WebSocket 연동 훅

WebSocket 연결/재연결/메시지 처리를 커스텀 훅으로 캡슐화해 컴포넌트에서 상태 관리 로직을 분리한다.

```typescript
function useGameSocket(roomId: string) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "STATE_UPDATE":
          setGameState(msg); // 서버 값으로 항상 덮어쓴다 — 로컬 예측값을 유지하지 않는다
          break;
        case "GAME_OVER":
          // 게임 종료 처리
          break;
      }
    };

    ws.onclose = () => {
      // 재연결 로직: 지수 백오프로 재시도
    };

    return () => ws.close();
  }, [roomId]);

  const sendAction = (action: ClientAction) => {
    wsRef.current?.send(JSON.stringify(action));
  };

  return { gameState, sendAction };
}
```

**`_workspace/02_backend_protocol.md`에 정의된 메시지 타입과 필드명을 정확히 그대로 사용한다.** 문서에 없는 필드를 있다고 가정하거나, 문서의 타입명을 임의로 변형하면(예: 문서는 `troops`인데 클라이언트가 `troopCount`로 씀) 통합 단계에서 반드시 걸린다.

## 렌더 루프와 상태 갱신 분리

WebSocket 메시지는 서버 tick 주기(예: 200ms)로 오지만, 화면은 그보다 부드럽게 그려야 한다. 두 루프를 분리한다:

```typescript
function GameCanvas({ gameState }: { gameState: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(gameState);
  stateRef.current = gameState; // 최신 상태를 ref로 유지 (렌더 루프가 참조)

  useEffect(() => {
    let frameId: number;
    const render = () => {
      draw(canvasRef.current!, stateRef.current);
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []); // 최초 1회만 루프 시작 — gameState가 바뀔 때마다 루프를 재시작하지 않는다

  return <canvas ref={canvasRef} />;
}
```

`requestAnimationFrame` 루프를 `gameState`가 바뀔 때마다 새로 시작하면(의존성 배열에 `gameState`를 넣으면) 매 상태 갱신마다 루프가 재생성되어 낭비다 — ref로 최신 상태를 참조하고 루프 자체는 마운트 시 1회만 시작한다.

## 입력 처리: 화면 좌표 → 게임 좌표

Canvas 클릭 이벤트는 픽셀 좌표를 준다. 이를 서버가 이해하는 게임 좌표(타일 ID 등)로 변환해야 한다.

```typescript
function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const tileId = pixelToTileId(x, y, camera); // 카메라/줌 상태를 반영해 변환
  // 선택 상태 갱신 또는 sendAction({ type: "ATTACK", from: selectedTile, to: tileId, ... })
}
```

카메라 이동/줌을 지원한다면 변환 함수가 카메라 오프셋과 스케일을 반영해야 한다 — 이 부분을 놓치면 "클릭한 곳과 실제 선택되는 타일이 다른" 흔한 버그가 생긴다.

## UI 화면 구성

**civwar.io의 UI 규칙(톤, 정보 표시, 색 토큰, 아이콘, 문구, 확인 절차)은 `client/UI-CONVENTIONS.md`에 있다. 화면을 만들거나 고치기 전에 읽는다.** 아래는 일반적인 화면 구성 방법이다.


최소 3개 화면으로 시작한다:
1. **로비** — 방 생성/참가, 참가자 목록, 방장의 시작 버튼
2. **인게임 HUD** — 내 자원/병력 요약, 경과/남은 시간, (선택) 미니맵
3. **게임 종료** — 승자, 종료 사유, 재대결/로비 복귀 버튼

각 화면은 서버 메시지(`_workspace/02_backend_protocol.md`의 `type` 필드)에 따라 전환한다 — 클라이언트가 자체적으로 "게임이 끝난 것 같다"고 추측해 화면을 바꾸지 않는다. 항상 서버의 `GAME_OVER` 같은 명시적 메시지를 트리거로 삼는다.

## 상태 관리

게임 상태는 서버가 매 tick 통째로 내려주므로, 복잡한 전역 상태 관리 라이브러리가 꼭 필요하지는 않다. `useGameSocket` 훅의 `useState`로 충분히 시작 가능하다. 여러 컴포넌트가 상태를 깊이 공유해야 하는 규모가 되면 Context나 가벼운 스토어(zustand 등)를 고려하되, MVP 단계에서 미리 도입하지 않는다.

## 프로젝트 구조

`realtime-multiplayer-server` 스킬의 프로젝트 구조 제안과 맞춘다:

```
/client
  /src
    /hooks       - useGameSocket 등
    /components  - GameCanvas, Lobby, HUD, GameOver
    /render      - Canvas 그리기 함수 (draw, pixelToTileId 등)
    /types       - /shared의 프로토콜 타입 재사용 (중복 정의 금지)
```

프로토콜 타입을 클라이언트에서 다시 정의하지 않는다 — `/shared`의 타입을 import해 사용한다. 두 곳에서 각각 정의하면 한쪽만 갱신되는 경계면 버그의 근원이 된다.
