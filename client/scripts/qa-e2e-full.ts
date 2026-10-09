/**
 * [QA Phase 6 — 커밋 금지] 실제 ws 서버(인프로세스, 임시 포트) + 실제 ClientStore 여러 개로 전체 판(최대 32분)을 끝까지 돌린다.
 *  룸 A: 무작위 M, NORMAL, 사람 2(alice=방장·능동, bob=끊김→봇 인계→재접속) + 봇 8, 관전자 carol(중간 입장·새로고침), ivan(GAME_OVER 후 관전)
 *  룸 B: 무작위 S 얕은 물 40%, EASY, 비공개 재번호(dave·erin·frank → erin 퇴장 → frank 2번), dave 능동
 *  룸 C: 공식 L-01, HARD, gina 방장 무행동(탈락 경로 기대) + 봇 11
 *  룸 D: 공개 빠른 시작(harry) — autoStartMs, 30초 자동 시작, 인게임 lobby_leave
 * 출력: 콘솔 + QA_OUT(JSON)
 */
import { writeFileSync } from 'node:fs';
import type { ServerMessage } from '@civwar/shared';
import { startServer } from '../../server/src/net/server.js';
import { ClientStore, type KeyValueStorage } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';
import { computePreview } from '../src/input/preview.js';
import { techCost } from '../src/ui/techInfo.js';

const OUT = process.env.QA_OUT ?? 'qa-e2e-full.json';
const T0 = Date.now();
const sec = () => (Date.now() - T0) / 1000;
const errorsThrown: string[] = [];
process.on('uncaughtException', (e) => errorsThrown.push(`${sec().toFixed(1)}s ${e?.stack ?? e}`));

class Mem implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

interface Probe {
  name: string;
  store: ClientStore;
  storage: Mem;
  types: Map<string, number>;
  acks: { accepted: number; rejected: Record<string, number>; byCmd: Record<string, Record<string, number>> };
  errors: string[];
  orderViolations: string[];
  afterGameOver: string[];
  gameOverTick: number | null;
  gameOverReason: string | null;
  lastDeltaTick: number;
  log: string[];
  sentCmd: Map<number, { type: string; expect?: string; note?: string }>;
  predictMismatch: string[];
  roomStates: { phase: string; myPlayerId: number | null; autoStartMs: number | null; t: number }[];
}

function probe(name: string, storage = new Mem(), url = URL_): Probe {
  const store = new ClientStore(url, storage);
  store.reconCheck = true;
  store.setNickname(name);
  const p: Probe = {
    name,
    store,
    storage,
    types: new Map(),
    acks: { accepted: 0, rejected: {}, byCmd: {} },
    errors: [],
    orderViolations: [],
    afterGameOver: [],
    gameOverTick: null,
    gameOverReason: null,
    lastDeltaTick: -1,
    log: [],
    sentCmd: new Map(),
    predictMismatch: [],
    roomStates: [],
  };
  store.observe((m: ServerMessage) => {
    p.types.set(m.type, (p.types.get(m.type) ?? 0) + 1);
    if (p.gameOverTick !== null && m.type !== 'room_state' && m.type !== 'cmd_ack' && m.type !== 'error' && m.type !== 'pong') p.afterGameOver.push(m.type);
    switch (m.type) {
      case 'cmd_ack': {
        const c = p.sentCmd.get(m.clientSeq);
        const key = c?.type ?? '?';
        p.acks.byCmd[key] ??= {};
        const r = m.accepted ? 'OK' : m.reason ?? '?';
        p.acks.byCmd[key][r] = (p.acks.byCmd[key][r] ?? 0) + 1;
        if (m.accepted) p.acks.accepted++;
        else p.acks.rejected[r] = (p.acks.rejected[r] ?? 0) + 1;
        if (c?.expect && c.expect !== r) p.predictMismatch.push(`${key} 예측 ${c.expect} / 실제 ${r} ${c.note ?? ''}`);
        p.sentCmd.delete(m.clientSeq);
        break;
      }
      case 'error':
        p.errors.push(`${sec().toFixed(0)}s ${m.code}`);
        break;
      case 'snapshot_delta':
        if (p.lastDeltaTick >= 0 && m.tick !== p.lastDeltaTick + 1) p.orderViolations.push(`delta tick ${p.lastDeltaTick}→${m.tick}`);
        p.lastDeltaTick = m.tick;
        break;
      case 'snapshot_full':
        // 부트스트랩 full 이후 delta 는 full.tick+1 부터
        if (p.lastDeltaTick < 0 || m.tick > p.lastDeltaTick) p.lastDeltaTick = m.tick;
        break;
      case 'game_over':
        p.gameOverTick = m.finalTick;
        p.gameOverReason = m.reason;
        if (p.lastDeltaTick !== m.finalTick) p.orderViolations.push(`game_over finalTick ${m.finalTick} but last delta ${p.lastDeltaTick}`);
        break;
      case 'room_state':
        queueMicrotask(() => p.roomStates.push({ phase: m.phase, myPlayerId: store.myPlayerId, autoStartMs: m.autoStartMs ?? null, t: sec() }));
        break;
    }
  });
  return p;
}

let URL_ = '';

function sendCmd(p: Probe, seq: number, type: string, expect?: string, note?: string): void {
  if (seq > 0) p.sentCmd.set(seq, { type, expect, note });
}

/** 능동 플레이: 경계 칸 발령(예고와 서버 판정 비교) · 재지정 · 태세 · 회수 · 테크 · 동맹 */
function act(p: Probe, step: number): void {
  const s = p.store;
  const g = s.game;
  const me = s.myPlayerId;
  if (!g || !g.ready || me === null || g.gameOver || s.spectating) return;
  const pl = g.players.get(me);
  if (!pl || !pl.alive) return;
  const topo = createTopologyView(g.config.topology, g.width, g.height);
  const mine = g.flagsOf(me);
  // 테크: 클라이언트 계산으로 살 수 있으면 산다 → 서버가 INSUFFICIENT 면 불일치
  if (step % 5 === 0) {
    for (let axis = 0; axis < 4; axis++) {
      const tier = pl.tech[axis] + 1;
      if (tier > 3) continue;
      const cost = techCost(tier, pl.tech, g.config.constants);
      if (pl.gold >= cost) {
        sendCmd(p, s.buyTech(axis as 0, tier as 1), 'cmd_buy_tech', 'OK', `gold ${pl.gold} cost ${cost} t${g.tick}`);
        break;
      }
    }
  }
  if (step % 17 === 3) {
    const others = [...g.players.values()].filter((x) => x.id !== me && x.alive);
    if (others.length) sendCmd(p, s.proposeAlly(others[step % others.length].id), 'cmd_ally_propose');
  }
  for (const pr of g.proposals.values()) if (pr.toPlayerId === me) sendCmd(p, s.respondAlly(pr.proposalId, step % 2 === 0), 'cmd_ally_respond');
  if (step % 4 === 1 && mine.length) {
    const f = mine[step % mine.length];
    const r = step % 3;
    if (r === 0) sendCmd(p, s.setPosture(f.id, f.posture === 0 ? 1 : 0), 'cmd_set_posture');
    else if (r === 1) sendCmd(p, s.recall(f.id), 'cmd_flag_recall');
    else {
      const t = (f.anchorTileId + 3) % g.tileCount;
      sendCmd(p, s.retarget(f.id, t), 'cmd_flag_retarget');
    }
    return;
  }
  // 발령: 경계 바깥 칸 또는 무작위 칸 (예고가 blocked 인 칸도 일부러 섞는다)
  const field = topo.distanceField((t) => g.owners[t] === me);
  let tile: number;
  if (step % 6 === 5) tile = (step * 104729) % g.tileCount;
  else {
    const cands: number[] = [];
    for (let t = 0; t < g.tileCount; t++) if (g.owners[t] !== me && g.isLand(t) && topo.neighbors(t).some((n) => g.owners[n] === me)) cands.push(t);
    if (!cands.length) return;
    tile = cands[(step * 7919) % cands.length];
  }
  const pv = computePreview(g, topo, me, tile, field);
  const unit = (step % 3) as 0 | 1 | 2;
  const troops = Math.floor(pl.troops * 0.5);
  let expect: string | undefined;
  if (pv?.kind === 'blocked') expect = pv.label.startsWith('물') ? 'WATER' : pv.label.startsWith('동맹') ? 'ALLIED' : 'OUT_OF_RANGE';
  const slotsFull = mine.length >= pl.flagCap;
  if (slotsFull) expect = 'NO_SLOT';
  if (!expect && troops < 40) expect = 'TOO_SMALL';
  let origin: number | null = null;
  if (step % 7 === 2) {
    for (const b of g.bases.values()) if (b.ownerId === me) origin = b.tileId;
  }
  sendCmd(p, s.issueFlag(unit, troops, tile, origin), 'cmd_flag_issue', expect, `t${g.tick} tile ${tile} kind ${pv?.kind} flags ${mine.length}/${pl.flagCap}`);
}

function summary(p: Probe) {
  const g = p.store.game;
  return {
    name: p.name,
    myPlayerId: p.store.myPlayerId,
    room: p.store.room ? { code: p.store.room.roomCode, phase: p.store.room.phase } : null,
    spectating: p.store.spectating,
    tick: g?.tick,
    recon: { fulls: p.store.reconStats.fulls, mismatched: p.store.reconStats.mismatchedFulls, samples: p.store.reconStats.samples.slice(0, 8) },
    acks: p.acks,
    pendingNoAck: [...p.sentCmd.values()].map((x) => x.type),
    storePendingLeft: p.store.pending.size,
    errors: p.errors,
    order: p.orderViolations.slice(0, 10),
    afterGameOver: p.afterGameOver.slice(0, 10),
    gameOver: { tick: p.gameOverTick, reason: p.gameOverReason, modelHasGameOver: !!g?.gameOver },
    predictMismatch: p.predictMismatch.slice(0, 15),
    predictMismatchCount: p.predictMismatch.length,
    toasts: p.store.toasts.map((t) => t.text),
    feedLen: p.store.feed.length,
    types: Object.fromEntries(p.types),
    roomStates: p.roomStates.filter((r, i, a) => i === 0 || r.phase !== a[i - 1].phase || r.myPlayerId !== a[i - 1].myPlayerId),
    log: p.log,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number, label: string): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(100);
  }
  console.log(`[timeout] ${label}`);
  return false;
}

async function main() {
  const srv = await startServer(0);
  URL_ = `ws://localhost:${srv.port}`;
  console.log(`server ${URL_}`);
  const extra: Record<string, unknown> = {};

  // ── 로비 오류 경로 ──
  const zed = probe('zed');
  zed.store.createRoom({ map: { kind: 'random', size: 'S' }, maxPlayers: 8 }); // S 최대 7 → BAD_ROOM_OPTIONS
  zed.store.start();
  await until(() => zed.errors.length > 0, 5000, 'zed BAD_ROOM_OPTIONS');
  zed.store.createRoom({ map: { kind: 'preset', mapId: 'official-x-99' } });
  await until(() => zed.errors.length > 1, 5000, 'zed MAP_NOT_FOUND');
  zed.store.createRoom({ map: { kind: 'random', size: 'S' }, maxPlayers: 4, botCount: 0 });
  await until(() => !!zed.store.room, 5000, 'zed room');
  zed.store.startNow(); // 사람 1 + 봇 0 → NOT_ENOUGH_PLAYERS
  await until(() => zed.errors.length > 2, 5000, 'zed NOT_ENOUGH');
  zed.store.updateSettings({ botCount: 2, botDifficulty: 'HARD' });
  await until(() => zed.store.room?.settings.botCount === 2, 5000, 'zed update');
  extra.zed = { errors: zed.errors, settings: zed.store.room?.settings, toasts: zed.store.toasts.map((t) => t.text) };
  zed.store.leaveRoom();
  await wait(300);
  extra.zedAfterLeave = { room: zed.store.room, errors: zed.errors.slice(3) };
  zed.store.stop();

  // ── 룸 A ──
  const alice = probe('alice');
  alice.store.createRoom({ map: { kind: 'random', size: 'M', water: { waterMode: 'BORDER_ONLY', shallowPermille: 1000 } }, maxPlayers: 10, botCount: 9, botDifficulty: 'NORMAL' });
  alice.store.start();
  await until(() => !!alice.store.room, 5000, 'alice room');
  const codeA = alice.store.room!.roomCode;
  const bob = probe('bob');
  bob.store.joinByCode(codeA);
  bob.store.start();
  await until(() => (bob.store.room?.players.length ?? 0) === 2, 5000, 'bob join');
  extra.A_lobby = { settings: alice.store.room!.settings, autoStartMs: alice.store.room!.autoStartMs };

  // ── 룸 B (재번호) ──
  const dave = probe('dave');
  dave.store.createRoom({ map: { kind: 'random', size: 'S', water: { waterMode: 'SHALLOW_QUOTA', shallowPermille: 400 } }, maxPlayers: 7, botCount: 6, botDifficulty: 'EASY' });
  dave.store.start();
  await until(() => !!dave.store.room, 5000, 'dave room');
  const codeB = dave.store.room!.roomCode;
  const erin = probe('erin');
  erin.store.joinByCode(codeB);
  erin.store.start();
  await until(() => erin.store.myPlayerId === 2, 5000, 'erin 2');
  const frank = probe('frank');
  frank.store.joinByCode(codeB);
  frank.store.start();
  await until(() => frank.store.myPlayerId === 3, 5000, 'frank 3');
  erin.store.leaveRoom();
  await until(() => (dave.store.room?.players.length ?? 0) === 2, 5000, 'erin left');
  extra.B_beforeStart = { frankId: frank.store.myPlayerId, players: dave.store.room!.players.map((x) => [x.playerId, x.nickname]), expected: dave.store.room!.settings.expectedPlayers };
  erin.store.stop();

  // ── 룸 C (공식 L) ──
  const gina = probe('gina');
  gina.store.createRoom({ map: { kind: 'preset', mapId: 'official-l-01' }, maxPlayers: 12, botCount: 11, botDifficulty: 'HARD' });
  gina.store.start();
  await until(() => !!gina.store.room, 5000, 'gina room');

  // 시작
  alice.store.startNow();
  dave.store.startNow();
  gina.store.startNow();
  await until(() => frank.store.room?.phase === 'COUNTDOWN', 5000, 'B countdown');
  extra.B_countdown = { frankId: frank.store.myPlayerId, players: frank.store.room!.players.map((x) => [x.playerId, x.nickname, x.isBot]), daveHost: dave.store.isHost };
  await until(() => !!alice.store.game?.ready && !!dave.store.game?.ready && !!gina.store.game?.ready, 15000, 'games ready');
  extra.B_inGame = { frankId: frank.store.myPlayerId, frankSpawn: frank.store.game?.spawns.find((s) => s.playerId === frank.store.myPlayerId) ?? null };
  extra.C_config = { mapSource: gina.store.game?.config.mapSource, mapId: gina.store.game?.config.mapId, w: gina.store.game?.width, h: gina.store.game?.height, botDifficulty: gina.store.game?.config.botDifficulty };

  // ── 룸 D (공개) ──
  const harry = probe('harry');
  harry.store.quickStart();
  harry.store.start();
  await until(() => !!harry.store.room, 5000, 'harry room');
  extra.D_lobby = { autoStartMs: harry.store.room!.autoStartMs, isPublic: harry.store.room!.isPublic, isHostTag: harry.store.room!.players[0]?.isHost, storeIsHost: harry.store.isHost, settings: harry.store.room!.settings };

  let step = 0;
  let carol: Probe | null = null;
  let carol2: Probe | null = null;
  let bob2: Probe | null = null;
  let ivan: Probe | null = null;
  let bobId: number | null = null;
  const phases: Record<string, number> = {};
  const loop = setInterval(() => {
    step++;
    try {
      act(alice, step);
      act(dave, step + 1);
      act(frank, step + 2);
      if (bob2) act(bob2, step + 3);
    } catch (e) {
      errorsThrown.push(`act ${e}`);
    }
  }, 1500);

  // 시나리오 타이머
  const t0 = sec();
  const at = async (s: number) => {
    while (sec() - t0 < s) await wait(200);
  };
  await at(30);
  carol = probe('carol');
  carol.store.spectate(codeA);
  carol.store.start();
  await until(() => !!carol!.store.game?.ready, 10000, 'carol spectate');
  phases.carolSpectating = carol.store.spectating ? 1 : 0;
  await at(40);
  // harry: 공개 방 30초 자동 시작 확인 후 인게임 퇴장
  extra.D_started = { phase: harry.store.room?.phase, ready: !!harry.store.game?.ready, players: harry.store.room?.players.length };
  bobId = bob.store.myPlayerId;
  bob.store.stop(); // 소켓 끊김 (새로고침/네트워크)
  await at(60);
  const harryTypesBefore = harry.types.get('snapshot_delta') ?? 0;
  harry.store.leaveRoom();
  await wait(2000);
  extra.D_afterLeave = { room: harry.store.room, deltasAfterLeave: (harry.types.get('snapshot_delta') ?? 0) - harryTypesBefore, errors: harry.errors };
  harry.store.stop();
  await at(150); // 90초 + 여유 → bot_takeover 이후
  bob2 = probe('bob', bob.storage);
  bob2.store.start();
  await until(() => !!bob2!.store.game?.ready, 10000, 'bob2 resume');
  extra.A_bobResume = {
    before: bobId,
    after: bob2.store.myPlayerId,
    connected: bob2.store.game?.players.get(bobId ?? -1)?.connected,
    spectating: bob2.store.spectating,
    aliceSeesTakeover: alice.types.get('bot_takeover') ?? 0,
    aliceSeesReconnected: alice.types.get('player_reconnected') ?? 0,
    aliceModelConnected: alice.store.game?.players.get(bobId ?? -1)?.connected,
  };
  await at(200);
  // 관전자 새로고침
  carol.store.stop();
  await wait(1000);
  carol2 = probe('carol', carol.storage);
  carol2.store.start();
  await wait(3000);
  extra.A_carolRefresh = { room: carol2.store.room?.phase ?? null, game: !!carol2.store.game, types: Object.fromEntries(carol2.types) };
  carol2.store.spectate(codeA);
  await until(() => !!carol2!.store.game?.ready, 10000, 'carol2 re-spectate');

  // 판 끝까지
  await until(() => [alice, dave, gina].every((p) => p.gameOverTick !== null), 40 * 60 * 1000, 'all games over');
  clearInterval(loop);
  extra.endedAt = sec();
  // 게임 종료 뒤 GAME_OVER 룸 관전 (ivan)
  ivan = probe('ivan');
  ivan.store.spectate(codeA);
  ivan.store.start();
  await wait(4000);
  extra.ivanGameOverSpectate = { phase: ivan.store.room?.phase, ready: !!ivan.store.game?.ready, gotGameOver: ivan.gameOverTick !== null, modelGameOver: !!ivan.store.game?.gameOver };
  // dave 는 즉시 로비로, carol2 는 룸 정리(60초) 뒤 로비로
  await wait(2000);
  dave.store.leaveRoom();
  await wait(1000);
  extra.daveLeave = { room: dave.store.room, errors: dave.errors.slice(-3) };
  await wait(62000);
  carol2.store.leaveRoom();
  alice.store.leaveRoom();
  await wait(1500);
  extra.lateLeave = { carol2Errors: carol2.errors.slice(-3), aliceErrors: alice.errors.slice(-3), carol2Toasts: carol2.store.toasts.map((t) => t.text) };
  // 로비 복귀 후 다시 빠른 시작이 되는가
  alice.store.quickStart();
  await until(() => alice.store.room?.phase === 'LOBBY', 5000, 'alice requeue');
  extra.aliceRequeue = { phase: alice.store.room?.phase, errors: alice.errors.slice(-2) };

  const all = [alice, bob, bob2, dave, frank, gina, harry, carol, carol2, ivan].filter(Boolean) as Probe[];
  const res = { elapsedSec: sec(), errorsThrown, extra, probes: all.map(summary) };
  writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ errorsThrown, extra }, null, 1));
  for (const p of all) {
    const s = summary(p);
    console.log(`${s.name}: id ${s.myPlayerId} recon ${s.recon.fulls}/${s.recon.mismatched} acks ${s.acks.accepted} rej ${JSON.stringify(s.acks.rejected)} noAck ${s.pendingNoAck.length} go ${JSON.stringify(s.gameOver)} order ${s.order.length} afterGO ${s.afterGameOver.length} predictMis ${s.predictMismatchCount}`);
  }
  for (const p of all) p.store.stop();
  await srv.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
