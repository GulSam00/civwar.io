/**
 * 헤드리스 통합 확인 — 클라이언트 ClientStore/GameModel 을 실제 서버 ws 에 붙인다 (브라우저 없음, Node 22 전역 WebSocket).
 *  1) hello → 비공개 방(봇 9, HARD) → 시작 → 부트스트랩
 *  2) 실행 중 매 룸 snapshot_full 직전 리듀서 상태 vs full 비교 (store.reconCheck)
 *  3) 몇 초마다 내 영토 경계 근처로 깃발 발령·태세 전환·회수 — cmd_ack 수락/거절 집계
 * 실행: (서버 기동 후) npx tsx client/scripts/headless-check.ts [seconds=60] [ws://localhost:8080]
 */
import { ClientStore } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';

const seconds = Number(process.argv[2] ?? 60);
const url = process.argv[3] ?? 'ws://localhost:8080';
const store = new ClientStore(url);
store.reconCheck = true;
store.setNickname('headless');
const acks = { accepted: 0, rejected: new Map<string, number>() };
const seen = new Map<string, number>();
store.observe((m) => {
  seen.set(m.type, (seen.get(m.type) ?? 0) + 1);
  if (m.type === 'cmd_ack') {
    if (m.accepted) acks.accepted++;
    else acks.rejected.set(m.reason ?? '?', (acks.rejected.get(m.reason ?? '?') ?? 0) + 1);
  }
  // 관찰자는 store 처리 전에 불린다 → 처리 후 확인
  if (m.type === 'room_state' && m.phase === 'LOBBY') queueMicrotask(() => store.isHost && store.startNow());
});
store.createRoom({ map: { kind: 'random', size: 'M' }, maxPlayers: 10, botCount: 9, botDifficulty: 'HARD' });
store.start();

let step = 0;
const timer = setInterval(() => {
  const g = store.game;
  const me = store.myPlayerId;
  if (!g || !g.ready || me === null || g.gameOver) return;
  step++;
  const topo = createTopologyView(g.config.topology, g.width, g.height);
  const mine = g.flagsOf(me);
  if (step % 3 === 0 && mine.length) {
    const f = mine[0];
    if (step % 2 === 0) store.setPosture(f.id, f.posture === 0 ? 1 : 0);
    else store.recall(f.id);
    return;
  }
  // 내 땅과 맞닿은 비소유 육지 중 하나로 발령
  const p = g.players.get(me)!;
  const cands: number[] = [];
  for (let t = 0; t < g.tileCount; t++) {
    if (g.owners[t] === me || !g.isLand(t)) continue;
    if (topo.neighbors(t).some((n) => g.owners[n] === me)) cands.push(t);
  }
  if (cands.length && p.troops >= 120) store.issueFlag((step % 3) as 0 | 1 | 2, Math.floor(p.troops * 0.6), cands[(step * 7919) % cands.length], 0);
}, 2000);

setTimeout(() => {
  clearInterval(timer);
  const g = store.game;
  const me = store.myPlayerId;
  console.log(`\n=== headless-check ${seconds}s @ ${url} ===`);
  console.log(`room ${store.room?.roomCode} phase ${store.room?.phase} myPlayerId ${me} tick ${g?.tick}`);
  console.log(`me: ${JSON.stringify(me !== null ? g?.players.get(me) : null)}`);
  console.log(`snapshot_full 비교 ${store.reconStats.fulls}회, 불일치 ${store.reconStats.mismatchedFulls}회`);
  for (const s of store.reconStats.samples) console.log('  ' + s);
  console.log(`cmd_ack 수락 ${acks.accepted}, 거절 ${JSON.stringify(Object.fromEntries(acks.rejected))}`);
  console.log(`수신 type: ${[...seen].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  store.stop();
  process.exit(store.reconStats.mismatchedFulls === 0 && store.reconStats.fulls > 0 ? 0 : 1);
}, seconds * 1000);
