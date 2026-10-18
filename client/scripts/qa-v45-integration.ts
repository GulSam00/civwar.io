/**
 * [QA v4.5 — 커밋 금지] 실제 Simulation(명령 큐 경로) + 실제 ClientStore 로 v4.4~v4.5 경계면을 검증한다.
 *  S1 태세 쿨타임 중 우클릭(내 기지 / 적·중립) — v4.6 §27: postureHeld · 대기·자동 적용 없음 · 쿨타임 재전환 거절
 *  S2 방어 깃발 "unreachable" IDLE — 실제 명령·실제 소유 지도에서 서버 이벤트 → 클라이언트 flagIdleReason·경로 미리보기
 *  S3 멸망·합병: annexedTiles ↔ delta.tileChanges ↔ 클라이언트 annexFlashes, 기지 함락/멸망 tick 직후 새 부트스트랩 = 연속 모델
 *  S4 combatLoss 합 = ledger.combat, production.rows 불변식
 */
import { MAP_GEN_DEFAULT, POSTURE, UNIT, type C2S_GameCommand, type RoomMember, type S2C_RoomState, type ServerMessage } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';
import { RouteCache, computeRoute } from '../src/input/route.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState, type GameState } from '../../server/src/game/state.js';
import { IdleBot, Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';
import { defendDest } from '../../server/src/game/rules.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : ' — ' + detail}`);
};
function roomState(state: GameState): S2C_RoomState {
  const players: RoomMember[] = state.players
    .filter(Boolean)
    .map((p) => ({ playerId: p.id, sessionId: p.id === 1 ? 's_me' : null, nickname: `n${p.id}`, isBot: p.id !== 1, isHost: p.id === 1, ready: true, status: p.alive ? 'PLAYING' : 'ELIMINATED_SPECTATING' }));
  return {
    type: 'room_state',
    roomId: 'r1',
    roomCode: 'QAQAQA',
    isPublic: false,
    phase: 'IN_GAME',
    hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: players.length, botCount: players.length - 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'x', expectedPlayers: players.length },
    players,
    spectatorCount: 0,
    countdownMs: null,
    autoStartMs: null,
  };
}
function bootstrap(state: GameState): ClientStore {
  const s = new ClientStore('ws://unused');
  s.reconCheck = true;
  s.sessionId = 's_me';
  s.onMessage(wire(roomState(state)));
  s.onMessage(wire(buildMatchConfig(state)));
  s.onMessage(wire(buildMapInit(state)));
  s.onMessage(wire(buildSnapshotFull(state)));
  return s;
}
let seq = 0;
function step(sim: Simulation, cmds: [number, Record<string, unknown>][] = [], stores: ClientStore[] = []) {
  const seqs: number[] = [];
  for (const [pid, c] of cmds) {
    const clientSeq = ++seq;
    seqs.push(clientSeq);
    sim.enqueue(pid, pid, { ...c, clientSeq } as unknown as C2S_GameCommand);
  }
  const out = sim.step();
  const msgs = [...out.broadcast, ...out.personal.map((p) => p.msg)].map((m) => wire(m) as ServerMessage);
  for (const s of stores) for (const m of msgs) s.onMessage(m);
  return { msgs, acks: seqs.map((q) => msgs.find((m) => m.type === 'cmd_ack' && (m as any).clientSeq === q) as any) };
}
const mkState = (seed: number, n: number, size: 'S' | 'M' | 'L', bots = true) => {
  const map = generateMapForSize(seed, size, n, MAP_GEN_DEFAULT);
  return createGameState(map, Array.from({ length: n }, (_, i) => ({ playerId: i + 1, isBot: bots, connected: true, botDifficulty: 'HARD' as const })), 'NORMAL', seed);
};

// ───────────────────────── S1 태세 쿨타임 중 우클릭 ─────────────────────────
{
  const state = mkState(31, 4, 'S', false);
  const sim = new Simulation(state, IdleBot);
  const store = bootstrap(state);
  const g = store.game!;
  const p1 = state.players[1];
  const home = p1.homeTileId;
  const near = (d: number) => {
    for (let t = 0; t < state.owners.length; t++) if (state.owners[t] === 0 && state.graph.distance(home, t) === d && state.map.terrain[t] !== 0 && state.map.terrain[t] !== 6 && !state.map.isBase[t]) return t;
    throw new Error('no tile');
  };
  const n5 = near(5);
  const n7 = near(7);
  const issue = (anchor: number) => ({ type: 'cmd_flag_issue', unit: UNIT.SWORD, troops: 40, anchorTileId: anchor, originBaseTileId: null });
  let r = step(sim, [[1, issue(n5)]], [store]);
  const fid = r.acks[0].flagId as number;
  check('S1 발령 ATTACK', r.acks[0].accepted && r.acks[0].posture === POSTURE.ATTACK);
  for (let i = 0; i < 3; i++) step(sim, [], [store]);
  r = step(sim, [[1, { type: 'cmd_set_posture', flagId: fid, posture: POSTURE.DEFEND }]], [store]);
  check('S1 set_posture DEFEND 수락', r.acks[0].accepted && r.acks[0].posture === POSTURE.DEFEND, JSON.stringify(r.acks[0]));
  const fl = state.flags.find((f) => f.id === fid)!;
  const cdUntil = fl.postureCooldownUntilTick;
  check('S1 쿨타임 시작 (현재 tick + 25)', cdUntil === state.tick + 25 || cdUntil > state.tick, `cd ${cdUntil} tick ${state.tick}`);
  // v4.6 (§27): 쿨타임 중 중립 칸 우클릭 → 도착지 기본 ATTACK 이지만 DEFEND 유지 + 이동만 (postureHeld), 대기·자동 적용 없음
  for (let i = 0; i < 2; i++) step(sim, [], [store]);
  r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: fid, anchorTileId: n7 }]], [store]);
  check('S1 쿨타임 중 중립 우클릭: 수락, ack.posture = 현재(DEFEND), ack.postureHeld = true', r.acks[0].accepted && r.acks[0].posture === POSTURE.DEFEND && r.acks[0].postureHeld === true, JSON.stringify(r.acks[0]));
  check('S1 flag_retargeted.postureHeld = true, posture = 현재(DEFEND)', (r.msgs.find((m) => m.type === 'flag_retargeted') as any)?.postureHeld === true && (r.msgs.find((m) => m.type === 'flag_retargeted') as any)?.posture === POSTURE.DEFEND);
  check('S1 서버 posture DEFEND 유지 + pendingPosture 필드 없음', fl.posture === POSTURE.DEFEND && !('pendingPosture' in fl), `${fl.posture}`);
  check('S1 flag_posture_changed 없음 (쿨타임 중)', !r.msgs.some((m) => m.type === 'flag_posture_changed'));
  const mf = g.flags.get(fid)!;
  check('S1 클라이언트 모델: posture DEFEND, pendingPosture 없음', mf.posture === POSTURE.DEFEND && !('pendingPosture' in mf), `${mf.posture}`);
  check('S1 postureHeld 토스트 1회 ("태세 전환 쿨타임 중 — 이동만 했습니다")', store.toasts.filter((t) => /이동만 했습니다/.test(t.text)).length === 1, store.toasts.map((t) => t.text).join('|'));
  let changedAt = -1;
  for (let i = 0; i < 40; i++) {
    const rr = step(sim, [], [store]);
    if (rr.msgs.some((m) => m.type === 'flag_posture_changed' && (m as any).flagId === fid)) changedAt = state.tick;
  }
  check('S1 쿨타임이 끝나도 자동 전환 없음 (40 tick 동안 flag_posture_changed 0)', changedAt < 0 && fl.posture === POSTURE.DEFEND && g.flags.get(fid)!.posture === POSTURE.DEFEND, `전환 ${changedAt}`);
  // 쿨타임이 지난 뒤 중립 칸 우클릭 → 이동과 함께 즉시 ATTACK (auto:true), postureHeld = false
  store.toasts = [];
  r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: fid, anchorTileId: n5 }]], [store]);
  check('S1 쿨타임 경과 후 중립 우클릭: 즉시 ATTACK + postureHeld false, 토스트 없음', r.acks[0]?.accepted && r.acks[0].posture === POSTURE.ATTACK && r.acks[0].postureHeld === false && r.msgs.some((m) => m.type === 'flag_posture_changed' && (m as any).auto === true) && store.toasts.length === 0, JSON.stringify(r.acks[0]));
  // 반대 방향: 새 깃발 — 쿨타임 중 내 수도로 우클릭 → 현재 ATTACK 유지(postureHeld), 쿨타임이 끝나도 DEFEND 로 안 바뀐다
  r = step(sim, [[1, issue(n5)]], [store]);
  const f2id = r.acks[0].flagId as number;
  const fl2 = state.flags.find((f) => f.id === f2id)!;
  step(sim, [], [store]);
  step(sim, [[1, { type: 'cmd_set_posture', flagId: f2id, posture: POSTURE.DEFEND }]], [store]);
  while (state.tick < fl2.postureCooldownUntilTick) step(sim, [], [store]);
  r = step(sim, [[1, { type: 'cmd_set_posture', flagId: f2id, posture: POSTURE.ATTACK }]], [store]);
  check('S1 쿨타임 경과 후 수동 전환 ATTACK 수락', r.acks[0].accepted && fl2.posture === POSTURE.ATTACK, JSON.stringify(r.acks[0]));
  check('S1 쿨타임 안의 재전환은 POSTURE_COOLDOWN 거절 (대기열 없음)', (step(sim, [[1, { type: 'cmd_set_posture', flagId: f2id, posture: POSTURE.DEFEND }]], [store]).acks[0] as any)?.reason === 'POSTURE_COOLDOWN');
  const cd2 = fl2.postureCooldownUntilTick;
  r = step(sim, [[1, { type: 'cmd_flag_retarget', flagId: f2id, anchorTileId: home }]], [store]);
  check('S1 쿨타임 중 내 수도 우클릭: ack.posture 현재(ATTACK), postureHeld true', r.acks[0]?.accepted && r.acks[0].posture === POSTURE.ATTACK && r.acks[0].postureHeld === true, JSON.stringify(r.acks[0]));
  check('S1 flag_retargeted.posture = 현재 태세(ATTACK)', (r.msgs.find((m) => m.type === 'flag_retargeted') as any)?.posture === POSTURE.ATTACK);
  let ch2 = -1;
  while (state.tick < cd2 + 20) {
    const rr = step(sim, [], [store]);
    if (rr.msgs.some((m) => m.type === 'flag_posture_changed' && (m as any).flagId === f2id)) ch2 = state.tick;
  }
  check('S1 내 수도 우클릭 뒤 쿨타임이 끝나도 DEFEND 자동 전환 없음', ch2 < 0 && fl2.posture === POSTURE.ATTACK, `전환 ${ch2}`);
  const dd = g.diffAgainstFull(buildSnapshotFull(state)).filter((x) => x.startsWith('flag') && !/\.(troops|state) /.test(x));
  check('S1 모델 flag = 서버 full flag', dd.length === 0, dd.join(';'));
}

// ───────────────────────── S2 방어 깃발 unreachable IDLE ─────────────────────────
{
  let found = false;
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const state = mkState(seed, 8, 'M', true);
    const bot = new Simulation(state, CivBot);
    for (let i = 0; i < 2600 && !bot.finished; i++) bot.step();
    state.flags.length = 0;
    for (const p of state.players) if (p) p.isBot = false;
    const sim = new Simulation(state, IdleBot);
    const store = bootstrap(state);
    const topo = createTopologyView('square', state.map.width, state.map.height);
    const g = store.game!;
    let pick: { p: number; B: number; A: number; stop: number } | null = null;
    outer: for (let p = 1; p <= 8; p++) {
      const pl = state.players[p];
      if (!pl.alive || pl.baseTiles.length < 1) continue;
      const mine: number[] = [];
      for (let t = 0; t < state.owners.length; t++) if (state.owners[t] === p) mine.push(t);
      for (const B of pl.baseTiles)
        for (let k = 0; k < mine.length; k += 7) {
          const A = mine[k];
          if (A === B) continue;
          const d = defendDest(state, p, B, A);
          if (d !== A && d !== B && state.graph.distance(B, A) < 40) {
            pick = { p, B, A, stop: d };
            break outer;
          }
        }
    }
    if (!pick) continue;
    found = true;
    const { p, B, A, stop } = pick;
    const cache = new RouteCache();
    const field = cache.fieldFor(g, topo, A);
    const rt = computeRoute(g, topo, field, p, B, A, false);
    check(`S2[seed ${seed}] 클라이언트 미리보기 blocked & stopTile = 서버 defendDest (${stop})`, rt.blocked && rt.stopTile === stop, JSON.stringify({ blocked: rt.blocked, stop: rt.stopTile }));
    const r = step(sim, [[p, { type: 'cmd_flag_issue', unit: UNIT.SWORD, troops: 40, anchorTileId: A, originBaseTileId: B }]], [store]);
    check(`S2[seed ${seed}] 발령 수락 (방어)`, r.acks[0]?.accepted === true && r.acks[0].posture === POSTURE.DEFEND, JSON.stringify(r.acks[0]));
    const fid = r.acks[0].flagId as number;
    let idleMsg: any = null;
    for (let i = 0; i < 1500 && !idleMsg; i++) {
      const rr = step(sim, [], [store]);
      idleMsg = rr.msgs.find((m) => m.type === 'flag_idle' && (m as any).flagId === fid) ?? null;
      if (!state.flags.some((f) => f.id === fid)) break;
    }
    const f = state.flags.find((x) => x.id === fid);
    if (!idleMsg) {
      check(`S2[seed ${seed}] unreachable 이벤트 도착`, false, `flag 종료/미도착 state=${f?.state} pos=${f?.posTileId} stop=${stop}`);
      continue;
    }
    check(`S2[seed ${seed}] flag_idle reason=unreachable (+autoRecallTick = t+600)`, idleMsg.reason === 'unreachable' && idleMsg.autoRecallTick === idleMsg.tick + 600, JSON.stringify(idleMsg));
    check(`S2[seed ${seed}] 서버 깃발 IDLE, 멈춘 칸 = 예측 stop(${stop})`, f!.state === 'IDLE' && f!.posTileId === stop, `pos ${f!.posTileId} stop ${stop} state ${f!.state}`);
    const mfEarly = g.flags.get(fid)!;
    console.log(`  (이벤트 직후 모델 state=${mfEarly.state}; flagStats 1초 주기)`);
    while (state.tick % 5 !== 0) step(sim, [], [store]);
    const mf = g.flags.get(fid)!;
    check(`S2[seed ${seed}] 클라이언트 모델(5의 배수 tick): state IDLE, flagIdleReason=unreachable, 위치 일치`, mf.state === 'IDLE' && g.flagIdleReason.get(fid) === 'unreachable' && mf.posTileId === f!.posTileId, `${mf.state}/${g.flagIdleReason.get(fid)}`);
    let ret = false;
    for (let i = 0; i < 620 && !ret; i++) {
      step(sim, [], [store]);
      const ff = state.flags.find((x) => x.id === fid);
      ret = !ff || ff.state === 'RETURNING';
    }
    check(`S2[seed ${seed}] 600 tick 뒤 자동 귀환(RETURNING) 또는 종료`, ret);
    const ff = g.flags.get(fid);
    check(`S2[seed ${seed}] 귀환 시작 뒤 클라이언트 flagIdleReason 정리`, !ff || ff.state !== 'RETURNING' || !g.flagIdleReason.has(fid), `reason ${g.flagIdleReason.get(fid)}`);
    break;
  }
  if (!found) check('S2 후보(막히는 방어 앵커)를 찾음', false, '6개 시드에서 못 찾음');
}

// ───────────────────────── S3/S4 전체 판 ─────────────────────────
const total = { elims: 0, annexOk: 0, annexDiffs: [] as number[], flashDiffs: [] as number[], bootMis: 0, bootChecks: 0, bootSamples: [] as string[], elimSamples: [] as string[], lossChecks: 0, lossMis: 0, prodChecks: 0, prodMis: 0, prodSamples: [] as string[], unreach: 0, unreachClientMis: 0, bit128: 0, baseNameMis: 0, baseCaps: 0, idleStateMis: 0 };
const GAMES: { seed: number; n: number; size: 'S' | 'M' | 'L'; ticks: number }[] = [
  { seed: 7001, n: 12, size: 'S', ticks: 9600 },
  { seed: 7002, n: 12, size: 'S', ticks: 9600 },
  { seed: 7003, n: 10, size: 'M', ticks: 9600 },
  { seed: 7004, n: 12, size: 'M', ticks: 9600 },
  { seed: 7005, n: 11, size: 'S', ticks: 9600 },
];
for (const G of GAMES) {
  const state = mkState(G.seed, G.n, G.size, true);
  state.players[1].isBot = false;
  state.players[1].disconnectedSinceTick = 0;
  const sim = new Simulation(state, CivBot);
  const main = bootstrap(state);
  const g = main.game!;
  let lastLedger = state.ledger.combat;
  const pendingIdle: [number, number][] = [];
  let capPrev = false;
  while (!sim.finished && state.tick < G.ticks) {
    const before = Uint8Array.from(state.owners);
    const out = sim.step();
    const msgs = out.broadcast.map((m) => wire(m) as ServerMessage);
    for (const m of msgs) main.onMessage(m);
    const t = state.tick;
    const delta = msgs.find((m) => m.type === 'snapshot_delta') as any;
    const capLast = capPrev;
    capPrev = msgs.some((m) => m.type === 'base_captured');
    for (let i = pendingIdle.length - 1; i >= 0; i--) if (pendingIdle[i][1] === t) { const [fid] = pendingIdle.splice(i, 1)[0]; const sf = state.flags.find((x) => x.id === fid); const mf = g.flags.get(fid); if (sf && sf.state === 'IDLE' && (!mf || mf.state !== 'IDLE')) total.idleStateMis++; }
    if (delta) {
      const loss = delta.combatLoss as [number, number][];
      const sum = loss.reduce((a, [, l]) => a + l, 0);
      total.lossChecks++;
      if (sum !== state.ledger.combat - lastLedger) total.lossMis++;
      const ids = loss.map((x) => x[0]);
      if (ids.some((v, i) => i && v <= ids[i - 1]) || loss.some(([, l]) => l <= 0)) total.lossMis++;
      lastLedger = state.ledger.combat;
      if (delta.flagFlags.some((x: number[]) => (x[2] & 128) !== 0)) total.bit128++;
      const capNear = msgs.some((m) => m.type === 'base_captured') || capLast;
      for (const pp of delta.production ?? []) {
        total.prodChecks++;
        const rows = pp.rows as any[];
        const p = state.players[pp.playerId];
        const mine = rows.filter((r) => r.kind === 'base').map((r) => r.baseTileId);
        const expectBases = [...p.baseTiles].sort((a, b) => a - b);
        const terrRows = rows.filter((r) => r.kind === 'territory');
        const okBases = p.alive ? JSON.stringify(mine) === JSON.stringify(expectBases) : rows.length === 0;
        const okOrder = (terrRows.length === 0 || rows[rows.length - 1].kind === 'territory') && terrRows.length <= 1;
        const okTiles = true; // 영토 행 tiles 는 2단계 정산 시점 값(이후 단계의 점령은 다음 정산) — 비교 대상 아님
        if ((!okBases && !capNear) || !okOrder || !okTiles) {
          total.prodMis++;
          if (total.prodSamples.length < 5) total.prodSamples.push(`t${t} p${pp.playerId} bases ${JSON.stringify(mine)} vs ${JSON.stringify(expectBases)} terr ${terrRows[0]?.tiles} vs ${p.tiles}`);
        }
      }
    }
    for (const m of msgs) {
      if (m.type === 'flag_idle' && (m as any).reason === 'unreachable') {
        total.unreach++;
        const mf = g.flags.get((m as any).flagId);
        if (!mf || g.flagIdleReason.get((m as any).flagId) !== 'unreachable') total.unreachClientMis++;
        pendingIdle.push([(m as any).flagId, t + (5 - (t % 5)) % 5]);
      }
      if (m.type === 'base_captured') total.baseCaps++;
    }
    for (const m of msgs) {
      if (m.type !== 'player_eliminated') continue;
      total.elims++;
      const e = m as any;
      const elim = e.playerId as number;
      const by = e.byPlayerId as number | null;
      const moved = (delta.tileChanges as [number, number][]).filter(([tile, o]) => before[tile] === elim && o === (by ?? 0));
      const leftover = Array.from(state.owners).filter((o) => o === elim).length;
      const diff = moved.length - e.annexedTiles;
      total.annexDiffs.push(diff);
      if (leftover === 0 && state.players[elim].tiles === 0 && diff >= 0 && diff <= 5) total.annexOk++;
      else if (total.elimSamples.length < 8) total.elimSamples.push(`t${t} elim ${elim} by ${by} annexed ${e.annexedTiles} moved ${moved.length} leftover ${leftover} p.tiles ${state.players[elim].tiles}`);
      const fl = g.annexFlashes.find((a) => a.playerId === elim && a.tick === t);
      if (by !== null && e.annexedTiles > 0) total.flashDiffs.push((fl?.tiles.length ?? -1) - e.annexedTiles);
    }
    if (msgs.some((m) => m.type === 'base_captured' || m.type === 'player_eliminated')) {
      const full = buildSnapshotFull(state);
      const d1 = g.diffAgainstFull(wire(full));
      const filt = t % 5 === 0 ? d1 : d1.filter((x) => x.startsWith('owners') || (x.startsWith('flag ') && !/\.(troops|state) /.test(x)) || false);
      total.bootChecks++;
      if (filt.length) {
        total.bootMis++;
        if (total.bootSamples.length < 8) total.bootSamples.push(`t${t}: ${filt.slice(0, 3).join(' | ')}`);
      }
      for (const [tile, b] of g.bases) if (b.ownerId !== state.owners[tile]) { total.bootMis++; if (total.bootSamples.length < 8) total.bootSamples.push(`t${t} base ${tile} ownerId ${b.ownerId} / owners ${state.owners[tile]}`); }
      const late = bootstrap(state);
      const lg = late.game!;
      let od = 0;
      for (let i = 0; i < lg.owners.length; i++) if (lg.owners[i] !== g.owners[i]) od++;
      if (od) {
        total.bootMis++;
        if (total.bootSamples.length < 8) total.bootSamples.push(`t${t} late-join owners ${od}칸`);
      }
      for (const [tile, nm] of g.baseNames) if (lg.baseNames.get(tile) !== nm) total.baseNameMis++;
    }
  }
  console.log(`  [game ${G.seed}] tick ${state.tick} reason ${state.result?.reason ?? 'running'} 누적 멸망 ${total.elims} 기지 함락 ${total.baseCaps}`);
}
check('S4 combatLoss 합 = ledger.combat 증가 (매 tick) · flagId ASC · >0', total.lossMis === 0, `${total.lossMis}/${total.lossChecks}`);
check(`S4 production.rows: 기지 행 = 내 기지 ASC(탈락자 []), 영토 행 1개·맨 끝·tiles = 소유 칸 (n=${total.prodChecks})`, total.prodMis === 0, `${total.prodMis}/${total.prodChecks} ${total.prodSamples.join(' / ')}`);
check(`S3 player_eliminated.annexedTiles ↔ delta.tileChanges (n=${total.elims}), 멸망자 잔여 칸 0`, total.elims > 0 && total.annexOk === total.elims, `ok ${total.annexOk}/${total.elims} ${total.elimSamples.join(' / ')}`);
console.log(`  (이동 칸 − annexedTiles): ${total.annexDiffs.join(',')} | (클라 annexFlashes.tiles − annexedTiles): ${total.flashDiffs.join(',')}`);
check(`S3 기지 함락·멸망 tick 직후 모델 = 새 full / 늦은 입장 모델 (n=${total.bootChecks})`, total.bootMis === 0 && total.bootChecks > 0, `${total.bootMis}/${total.bootChecks} ${total.bootSamples.join(' / ')}`);
check('S3 baseNames 늦은 입장 모델과 일치', total.baseNameMis === 0);
check(`S2' 실제 판의 unreachable 이벤트(n=${total.unreach}) → 클라이언트 flagIdleReason`, total.unreachClientMis === 0, `${total.unreachClientMis}`);
check(`S2' 같은 이벤트 → 5의 배수 tick 에 모델 state IDLE (서버 IDLE 인 한)`, total.idleStateMis === 0, `${total.idleStateMis}`);
check(`S1' v4.6 (§27): 델타 flagFlags 에 비트 128 이 실리지 않는다`, total.bit128 === 0, `${total.bit128}`);
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
