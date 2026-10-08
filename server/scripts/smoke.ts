/**
 * 스모크 테스트 — 실제 WebSocket 서버를 띄우고 프로토콜 흐름을 끝까지 확인한다.
 *   hello → welcome → lobby_create_private → (2번째 클라이언트) lobby_join_private
 *   → lobby_start_now → room_state(COUNTDOWN) → match_config / map_init / snapshot_full
 *   → snapshot_delta 매 tick → snapshot_full(25 tick) → cmd_buy_tech ack → ping/pong
 *   → 관전자 lobby_spectate → 재접속(playerToken) 복구
 * 실행: npm run smoke   (종료 코드 0 = 성공)
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION, rleDecode, type ServerMessage } from '@civwar/shared';
import { startServer } from '../src/net/server.js';

type Msg = ServerMessage;

class Client {
  ws!: WebSocket;
  inbox: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  constructor(readonly name: string) {}

  open(port: number): Promise<void> {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
    return new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(o: unknown): void {
    this.ws.send(JSON.stringify(o));
  }
  wait<T extends Msg['type']>(type: T, pred: (m: Extract<Msg, { type: T }>) => boolean = () => true, ms = 10000): Promise<Extract<Msg, { type: T }>> {
    const p = (m: Msg) => m.type === type && pred(m as Extract<Msg, { type: T }>);
    const hit = this.inbox.find(p);
    if (hit) {
      this.inbox.splice(this.inbox.indexOf(hit), 1);
      return Promise.resolve(hit as Extract<Msg, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[${this.name}] timeout waiting ${type}`)), ms);
      this.waiters.push({
        pred: p,
        resolve: (m) => {
          clearTimeout(timer);
          this.inbox.splice(this.inbox.indexOf(m), 1);
          resolve(m as Extract<Msg, { type: T }>);
        },
      });
    });
  }
  close(): void {
    this.ws.close();
  }
}

function ok(cond: unknown, label: string): void {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

async function main(): Promise<void> {
  const server = await startServer(0, { seed: 20261008 });
  console.log(`server on :${server.port}`);
  try {
    const a = new Client('A');
    await a.open(server.port);
    a.send({ type: 'lobby_join_public' });
    ok((await a.wait('error')).code === 'NOT_HELLO', 'hello 이전 명령 거절 NOT_HELLO');
    a.send({ type: 'hello', nickname: 'alice', clientVersion: PROTOCOL_VERSION });
    const wa = await a.wait('welcome');
    ok(wa.protocolVersion === PROTOCOL_VERSION && wa.tickMs === 200 && wa.playerToken.length > 10, 'welcome 수신');

    a.send({ type: 'lobby_create_private', targetPlayers: 8 });
    const rs1 = await a.wait('room_state');
    ok(rs1.phase === 'LOBBY' && rs1.roomCode.length === 6 && rs1.hostId === 1 && rs1.players.length === 1, `방 생성 (code=${rs1.roomCode})`);

    const b = new Client('B');
    await b.open(server.port);
    b.send({ type: 'hello', nickname: 'bob', clientVersion: PROTOCOL_VERSION });
    const wb = await b.wait('welcome');
    b.send({ type: 'lobby_join_private', roomCode: rs1.roomCode });
    const rs2 = await b.wait('room_state', (m) => m.players.length === 2);
    ok(rs2.players.find((p) => p.sessionId === wb.sessionId)?.playerId === 2, '두 번째 클라이언트 입장 (playerId 2)');

    b.send({ type: 'lobby_start_now' });
    ok((await b.wait('error')).code === 'NOT_HOST', '방장 아닌 lobby_start_now 거절');

    a.send({ type: 'lobby_start_now' });
    const cd = await a.wait('room_state', (m) => m.phase === 'COUNTDOWN');
    ok(cd.players.length === 8 && cd.players.filter((p) => p.isBot).length === 6, '카운트다운 + 봇 6명 충원');

    const mc = await a.wait('match_config');
    ok(mc.width === 90 && mc.height === 54 && mc.hardTimeoutTick === 9600 && (mc.constants as any).ENEMY_BASE === 11, 'match_config (8인 90×54, 상수표)');
    const mi = await a.wait('map_init');
    const terrain = rleDecode(mi.terrain, mc.width * mc.height);
    ok(terrain.length === 4860 && mi.bases.length === 16 && mi.spawns.length === 8, 'map_init (RLE 지형, 기지 16, 스폰 8)');
    const sf0 = await a.wait('snapshot_full', (m) => m.tick === 0);
    ok(sf0.players.length === 8 && sf0.bases.length === 16 && sf0.thresholdPct === 60, 'snapshot_full tick 0');

    const d1 = await a.wait('snapshot_delta', (m) => m.tick === 1);
    ok(Array.isArray(d1.tileChanges) && Array.isArray(d1.flagMoves), 'snapshot_delta tick 1');

    a.send({ type: 'cmd_buy_tech', clientSeq: 1, axis: 0, tier: 1 });
    const ack1 = await a.wait('cmd_ack', (m) => m.clientSeq === 1);
    ok(!ack1.accepted && ack1.reason === 'INSUFFICIENT', 'cmd_buy_tech 골드 부족 → cmd_ack INSUFFICIENT');
    a.send({ type: 'cmd_buy_tech', clientSeq: 2, axis: 7, tier: 1 });
    ok((await a.wait('cmd_ack', (m) => m.clientSeq === 2)).reason === 'BAD_REQUEST', '형식 오류 → cmd_ack BAD_REQUEST');
    a.send({ type: 'cmd_flag_issue', clientSeq: 3, unit: 1, troops: 50, anchorTileId: 0 });
    ok((await a.wait('cmd_ack', (m) => m.clientSeq === 3)).reason === 'WATER', 'cmd_flag_issue 물 앵커 → WATER');

    // ── 2차: 깃발 발령 → 이동 → 교전(게이지) → 중립 점령 ──
    const W = mc.width;
    const owners0 = rleDecode(sf0.owners, mc.width * mc.height);
    const home = mi.spawns.find((sp) => sp.playerId === 1)!.homeTileId;
    const dist = (x: number, y: number) => Math.abs(Math.floor(x / W) - Math.floor(y / W)) + Math.abs((x % W) - (y % W));
    let anchor = -1;
    for (let t = 0; t < owners0.length && anchor < 0; t++) {
      if (dist(t, home) === 4 && owners0[t] === 0 && terrain[t] !== 0 && terrain[t] !== 6 && !mi.bases.includes(t)) anchor = t;
    }
    a.send({ type: 'cmd_flag_issue', clientSeq: 4, unit: 2, troops: 100, anchorTileId: anchor, originBaseTileId: null });
    const ackF = await a.wait('cmd_ack', (m) => m.clientSeq === 4);
    ok(ackF.accepted && ackF.flagId === 1 && ackF.posture === 0, `cmd_flag_issue 수락 (flagId ${ackF.flagId}, posture ATTACK, anchor ${anchor})`);
    const fi = await a.wait('flag_issued', (m) => m.flagId === 1);
    ok(fi.playerId === 1 && fi.unit === 2 && fi.troops === 100 && fi.etaTick > fi.tick, `flag_issued (origin ${fi.originTileId}, eta tick ${fi.etaTick})`);
    const mv = await a.wait('snapshot_delta', (m) => m.flagMoves.some(([id]) => id === 1), 15000);
    ok(true, `flagMoves 수신 (tick ${mv.tick})`);
    const fe = await a.wait('flag_engaged', (m) => m.flagId === 1, 20000);
    ok(fe.posture === 0 && (fe.frontTileCount ?? 0) > 0, `flag_engaged (front ${fe.frontTileCount}칸, tick ${fe.tick})`);
    const prog = await a.wait('snapshot_delta', (m) => m.flagProgress.some(([id, pct]) => id === 1 && pct > 0), 15000);
    ok(true, `flagProgress 게이지 상승 (tick ${prog.tick})`);
    const cap = await a.wait('snapshot_delta', (m) => m.tileChanges.some(([, o]) => o === 1), 20000);
    ok(true, `중립 점령 tileChanges ${JSON.stringify(cap.tileChanges)} (tick ${cap.tick})`);
    const sfF = await a.wait('snapshot_full', (m) => m.flags.some((f) => f.id === 1), 15000);
    const fs = sfF.flags.find((f) => f.id === 1)!;
    ok(fs.state === 'ENGAGED' && fs.breakaway === false && fs.disengageUntilTick === null && Array.isArray(sfF.allyProposals), 'snapshot_full.flags 2차 필드');
    a.send({ type: 'cmd_set_posture', clientSeq: 5, flagId: 1, posture: 0 });
    ok((await a.wait('cmd_ack', (m) => m.clientSeq === 5)).reason === 'SAME_POSTURE', 'cmd_set_posture 같은 태세 → SAME_POSTURE');
    a.send({ type: 'cmd_ally_propose', clientSeq: 6, targetPlayerId: 2 });
    ok((await a.wait('cmd_ack', (m) => m.clientSeq === 6)).accepted, 'cmd_ally_propose 수락');
    const ap = await b.wait('ally_proposed');
    b.send({ type: 'cmd_ally_respond', clientSeq: 1, proposalId: ap.proposalId, accept: true });
    const af = await a.wait('ally_formed');
    ok(af.a === 1 && af.b === 2, 'ally_proposed → ally_respond → ally_formed');

    a.send({ type: 'ping', clientTime: 123 });
    const pong = await a.wait('pong');
    ok(pong.clientTime === 123 && pong.tick > 0, `pong (tick ${pong.tick})`);

    const d5 = await a.wait('snapshot_delta', (m) => m.tick === 5);
    ok(d5.playerDeltas.some((p) => p.id === 1), `playerDeltas 5 tick 주기 (표시값이 바뀐 ${d5.playerDeltas.length}명만)`);

    const sf25 = await a.wait('snapshot_full', (m) => m.tick >= 25, 15000);
    const me = sf25.players.find((p) => p.id === 1)!;
    ok(me.gold >= 200, `snapshot_full tick ${sf25.tick} (troops ${me.troops}, gold ${me.gold})`);

    // 관전자
    const c = new Client('C');
    await c.open(server.port);
    c.send({ type: 'hello', nickname: 'carol', clientVersion: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ type: 'lobby_spectate', roomCode: rs1.roomCode });
    await c.wait('match_config');
    await c.wait('map_init');
    await c.wait('snapshot_full');
    await c.wait('snapshot_delta');
    ok(true, '관전자 입장 → 부트스트랩 + 델타 수신');

    // 재접속
    b.close();
    const rsDisc = await a.wait('room_state', (m) => m.players.find((p) => p.playerId === 2)?.status === 'DISCONNECTED');
    ok(!!rsDisc, '접속 끊김 → DISCONNECTED');
    const b2 = new Client('B2');
    await b2.open(server.port);
    b2.send({ type: 'hello', nickname: 'bob', clientVersion: PROTOCOL_VERSION, playerToken: wb.playerToken });
    const wb2 = await b2.wait('welcome');
    ok(wb2.resumed && wb2.sessionId === wb.sessionId, '재접속 welcome.resumed');
    await b2.wait('match_config');
    await b2.wait('snapshot_full');
    const rec = await a.wait('player_reconnected');
    ok(rec.playerId === 2, 'player_reconnected 브로드캐스트');

    // tick 속도 측정 (2초)
    a.inbox = [];
    const tStart = (await a.wait('snapshot_delta')).tick;
    await new Promise((r) => setTimeout(r, 2000));
    const tEnd = Math.max(...a.inbox.filter((m) => m.type === 'snapshot_delta').map((m) => (m as { tick: number }).tick));
    ok(tEnd - tStart >= 9 && tEnd - tStart <= 11, `tick 속도 ≈ 5/s (2초 동안 ${tEnd - tStart} tick)`);

    for (const x of [a, b2, c]) x.close();
    console.log('SMOKE PASSED');
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
