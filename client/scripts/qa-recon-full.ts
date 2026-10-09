/**
 * [QA Phase 6 — 커밋 금지] 헤드리스 전체 판(9600 tick 또는 승리까지)을 실제 Simulation 으로 돌리고,
 * 서버가 룸에 방송하는 메시지를 JSON 왕복해 **클라이언트 ClientStore.onMessage** 경로(피드·room_state 포함)에 그대로 넣는다.
 *  - 메인 관찰 store(플레이어 1 = 사람 자리, 시작부터 끊김 → 봇 인계 → t3000 재접속 → t5000 다시 끊김)
 *  - 중간 입장 store 들(관전/재접속 흉내: tick 사이 개인 부트스트랩) — 매 full 과 diff
 *  - 클라이언트 자체 계산 vs 서버 함수: troopCap, 골드 수입, 테크 비용, 예고(front/guard 수·사거리), ETA 오차
 * 실행: npx tsx client/scripts/qa-recon-full.ts [configIndex|all]
 */
import { MAP_GEN_DEFAULT, WATER_MODE, rleDecode, type RoomMember, type S2C_RoomState, type ServerMessage, type BotDifficultyName } from '@civwar/shared';
import { ClientStore } from '../src/state/store.js';
import { createTopologyView } from '../src/render/topology.js';
import { computePreview } from '../src/input/preview.js';
import { goldPerSecond, techCost as cTechCost } from '../src/ui/techInfo.js';
import { CivBot } from '../../server/src/game/bot.js';
import { createGameState, type GameState } from '../../server/src/game/state.js';
import { Simulation } from '../../server/src/game/tick.js';
import { generateMapForSize } from '../../server/src/map/generate.js';
import { MapCatalog, mapFromPreset } from '../../server/src/map/presets.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../../server/src/game/snapshot.js';
import { troopCap, grossGoldMilliPerTick, techCost as sTechCost } from '../../server/src/game/economy.js';
import { frontCount, guardCount, minDistFromTerritory } from '../../server/src/game/rules.js';

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m));
const DIFFS: BotDifficultyName[] = ['EASY', 'NORMAL', 'HARD'];

interface Cfg {
  name: string;
  kind: 'random' | 'preset';
  size?: 'S' | 'M' | 'L';
  mapId?: string;
  seed: number;
  n: number;
  water?: { waterMode: number; shallowPermille: number };
  diff: (pid: number) => BotDifficultyName;
}
const CFGS: Cfg[] = [
  { name: 'S7 random shallow40 mixed', kind: 'random', size: 'S', seed: 1101, n: 7, water: { waterMode: WATER_MODE.SHALLOW_QUOTA, shallowPermille: 400 }, diff: (p) => DIFFS[p % 3] },
  { name: 'M10 random mixed', kind: 'random', size: 'M', seed: 2202, n: 10, diff: (p) => DIFFS[(p + 1) % 3] },
  { name: 'L12 official-l-01 mixed', kind: 'preset', mapId: 'official-l-01', seed: 0, n: 12, diff: (p) => DIFFS[(p + 2) % 3] },
  { name: 'M9 official-m-02 HARD', kind: 'preset', mapId: 'official-m-02', seed: 0, n: 9, diff: () => 'HARD' },
  { name: 'L11 random EASY', kind: 'random', size: 'L', seed: 3303, n: 11, diff: () => 'EASY' },
];

function roomState(state: GameState, phase: S2C_RoomState['phase']): S2C_RoomState {
  const players: RoomMember[] = state.players.filter(Boolean).map((p) => ({
    playerId: p.id,
    sessionId: p.id === 1 ? 's_me' : null,
    nickname: p.id === 1 ? 'me' : `BOT ${p.id}`,
    isBot: p.id !== 1,
    isHost: p.id === 1,
    ready: true,
    status: !p.alive ? 'ELIMINATED_SPECTATING' : p.id === 1 && !p.connected ? 'DISCONNECTED' : 'PLAYING',
  }));
  return {
    type: 'room_state',
    roomId: 'r1',
    roomCode: 'QAQAQA',
    isPublic: false,
    phase,
    hostId: 1,
    settings: { map: { kind: 'random', size: 'M' }, maxPlayers: players.length, botCount: players.length - 1, botDifficulty: 'NORMAL', mapMaxPlayers: 12, recommended: [9, 11], pacingNote: 'x', expectedPlayers: players.length },
    players,
    spectatorCount: 0,
    countdownMs: null,
    autoStartMs: null,
  };
}

function mkStore(asMe: boolean): ClientStore {
  const s = new ClientStore('ws://unused');
  s.reconCheck = true;
  if (asMe) s.sessionId = 's_me';
  return s;
}
function bootstrap(s: ClientStore, state: GameState): void {
  s.onMessage(wire(roomState(state, 'IN_GAME')));
  s.onMessage(wire(buildMatchConfig(state)));
  s.onMessage(wire(buildMapInit(state)));
  s.onMessage(wire(buildSnapshotFull(state)));
}

function run(cfg: Cfg) {
  const t0 = Date.now();
  const catalog = MapCatalog.loadDir();
  const map =
    cfg.kind === 'preset'
      ? mapFromPreset(catalog.get(cfg.mapId!)!, cfg.n)
      : generateMapForSize(cfg.seed, cfg.size!, cfg.n, (cfg.water as never) ?? MAP_GEN_DEFAULT);
  const setup = Array.from({ length: cfg.n }, (_, i) => ({ playerId: i + 1, isBot: i !== 0, connected: i !== 0, botDifficulty: cfg.diff(i + 1) }));
  const state = createGameState(map, setup, 'NORMAL', cfg.seed || 777);
  state.players[1].disconnectedSinceTick = 0;
  const sim = new Simulation(state, CivBot);
  const main = mkStore(true);
  bootstrap(main, state);
  const lates: ClientStore[] = [];
  const unhandled = new Map<string, number>();
  const seen = new Map<string, number>();
  const calc: Record<string, number> = { troopCapChecks: 0, troopCapMis: 0, goldChecks: 0, goldMis: 0, techChecks: 0, techMis: 0, previewChecks: 0, previewCountMis: 0, previewRangeMis: 0 };
  const calcSamples: string[] = [];
  const eta = new Map<number, number>();
  const etaErr: number[] = [];
  const orderIssues: string[] = [];
  let feedErrors = 0;
  const topo = createTopologyView('square', map.width, map.height);
  let rng = 12345;
  const rand = (n: number) => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) % n);

  while (!sim.finished) {
    const out = sim.step();
    const t = state.tick;
    const msgs = out.broadcast.map((m) => wire(m) as ServerMessage);
    // 순서 검사: 이벤트 → delta → full → game_over
    const idxDelta = msgs.findIndex((m) => m.type === 'snapshot_delta');
    const idxGo = msgs.findIndex((m) => m.type === 'game_over');
    msgs.forEach((m, i) => {
      if ('tick' in m && m.type !== 'snapshot_full' && m.type !== 'snapshot_delta' && (m as { tick: number }).tick !== t) orderIssues.push(`t${t} ${m.type} tick ${(m as { tick: number }).tick}`);
      if (i > idxDelta && m.type !== 'snapshot_full' && m.type !== 'game_over') orderIssues.push(`t${t} ${m.type} after delta`);
    });
    if (idxGo >= 0 && idxGo !== msgs.length - 1) orderIssues.push(`t${t} game_over not last`);
    for (const m of msgs) {
      seen.set(m.type, (seen.get(m.type) ?? 0) + 1);
      if (m.type === 'flag_issued') eta.set(m.flagId, m.etaTick);
      if (m.type === 'flag_engaged' && eta.has(m.flagId)) {
        etaErr.push(m.tick - eta.get(m.flagId)!);
        eta.delete(m.flagId);
      }
      if (m.type === 'flag_retargeted' && !m.auto) eta.set(m.flagId, m.etaTick);
      if (m.type === 'flag_ended' || m.type === 'flag_recalled' || m.type === 'flag_idle') eta.delete(m.flagId);
      if (m.type === 'snapshot_full') {
        // 클라이언트 계산 비교 (모델은 full 직전 = 같은 tick 의 delta 적용 상태)
        const g = main.game!;
        for (const p of state.players) {
          if (!p) continue;
          const mp = g.players.get(p.id)!;
          calc.troopCapChecks++;
          if (g.troopCapOf(mp) !== troopCap(p)) {
            calc.troopCapMis++;
            if (calcSamples.length < 10) calcSamples.push(`t${t} troopCap p${p.id} c ${g.troopCapOf(mp)} s ${troopCap(p)}`);
          }
          calc.goldChecks++;
          const gc = goldPerSecond(mp.goldWeight, mp.tech[1], mp.upkeepPm, g.config.constants);
          const sg = (grossGoldMilliPerTick(p) * 5) / 1000;
          if (Math.abs(gc.gross - sg) > 1e-9) {
            calc.goldMis++;
            if (calcSamples.length < 10) calcSamples.push(`t${t} gold p${p.id} c ${gc.gross} s ${sg}`);
          }
          for (let tier = 1; tier <= 3; tier++) {
            calc.techChecks++;
            if (cTechCost(tier, mp.tech, g.config.constants) !== sTechCost(tier, p.techPurchased)) calc.techMis++;
          }
        }
        if (t % 250 === 0) {
          for (let k = 0; k < 30; k++) {
            const alive = state.players.filter((p) => p && p.alive);
            const me = alive[rand(alive.length)].id;
            const tile = rand(g.tileCount);
            const field = topo.distanceField((x) => g.owners[x] === me);
            const pv = computePreview(g, topo, me, tile, field);
            if (!pv || pv.kind === 'blocked' && pv.label.startsWith('물')) continue;
            calc.previewChecks++;
            const sd = minDistFromTerritory(state, me, tile);
            const outRange = sd > 40;
            const owner = state.owners[tile];
            const pseudo = { ownerId: me, targetOwnerId: owner === me ? 254 : owner, anchorTileId: tile, posTileId: tile } as never;
            if (pv.kind === 'blocked' && pv.label.startsWith('사거리') !== outRange) calc.previewRangeMis++;
            if (pv.kind === 'attack' && outRange) calc.previewRangeMis++;
            if (pv.kind === 'attack' && pv.count !== frontCount(state, pseudo)) {
              calc.previewCountMis++;
              if (calcSamples.length < 20) calcSamples.push(`t${t} front p${me} tile ${tile} c ${pv.count} s ${frontCount(state, pseudo)}`);
            }
            if (pv.kind === 'defend' && pv.count !== guardCount(state, pseudo)) calc.previewCountMis++;
          }
        }
      }
      for (const s of [main, ...lates]) {
        try {
          s.onMessage(m);
        } catch (e) {
          feedErrors++;
          if (feedErrors < 5) console.log('onMessage throw', m.type, e);
        }
      }
      if (main.game && main.game.ready && m.type !== 'snapshot_full' && m.type !== 'snapshot_delta' && m.type !== 'game_over') {
        // 커버리지: GameModel 이 모르는 이벤트 (apply false)
        const probe = new (main.game.constructor as new (c: unknown) => { ready: boolean; applyEvent(x: ServerMessage): boolean })(main.game.config);
        probe.ready = true;
        if (!probe.applyEvent(m)) unhandled.set(m.type, (unhandled.get(m.type) ?? 0) + 1);
      }
    }
    // 룸 동작 흉내: 탈락·봇 인계 → room_state
    if (msgs.some((m) => m.type === 'player_eliminated' || m.type === 'bot_takeover')) for (const s of [main, ...lates]) s.onMessage(wire(roomState(state, 'IN_GAME')));
    if (sim.finished) {
      for (const s of [main, ...lates]) s.onMessage(wire(roomState(state, 'GAME_OVER')));
      break;
    }
    // 재접속 (t3000) / 다시 끊김 (t5000)
    const p1 = state.players[1];
    if (t === 3000 && p1.alive) {
      p1.connected = true;
      p1.disconnectedSinceTick = null;
      p1.botControlled = false;
      const re = mkStore(true);
      re.onMessage(wire(roomState(state, 'IN_GAME')));
      re.onMessage(wire(buildMatchConfig(state)));
      re.onMessage(wire(buildMapInit(state)));
      re.onMessage(wire(buildSnapshotFull(state)));
      lates.push(re);
      for (const s of [main, ...lates]) s.onMessage(wire({ type: 'player_reconnected', tick: t, playerId: 1 } as ServerMessage));
      for (const s of [main, ...lates]) s.onMessage(wire(roomState(state, 'IN_GAME')));
    }
    if (t === 5000 && p1.alive) {
      p1.connected = false;
      p1.disconnectedSinceTick = t;
      for (const s of [main, ...lates]) s.onMessage(wire(roomState(state, 'IN_GAME')));
    }
    // 중간 입장 관전자: 임의 tick (25 배수 아닌 곳 포함)
    if (t % 977 === 311) {
      const sp = mkStore(false);
      bootstrap(sp, state);
      lates.push(sp);
    }
  }
  const go = main.game?.gameOver;
  const all = [main, ...lates];
  const res = {
    cfg: cfg.name,
    size: `${map.width}x${map.height}`,
    ms: Date.now() - t0,
    finalTick: go?.finalTick,
    reason: go?.reason,
    winner: go?.winnerId,
    stores: all.map((s) => ({ fulls: s.reconStats.fulls, mismatched: s.reconStats.mismatchedFulls, samples: s.reconStats.samples.slice(0, 3), gameOver: !!s.game?.gameOver, phase: s.room?.phase, spectating: s.spectating, me: s.myPlayerId, feed: s.feed.length })),
    totalFulls: all.reduce((a, s) => a + s.reconStats.fulls, 0),
    totalMismatch: all.reduce((a, s) => a + s.reconStats.mismatchedFulls, 0),
    unhandledEvents: Object.fromEntries(unhandled),
    seenTypes: [...seen.keys()].sort(),
    calc,
    calcSamples,
    eta: etaErr.length ? { n: etaErr.length, exact: etaErr.filter((x) => x === 0).length, mean: +(etaErr.reduce((a, b) => a + b, 0) / etaErr.length).toFixed(2), min: Math.min(...etaErr), max: Math.max(...etaErr), within5: etaErr.filter((x) => Math.abs(x) <= 5).length } : null,
    orderIssues: orderIssues.slice(0, 10),
    feedErrors,
    toastsMain: main.toasts.length,
  };
  return res;
}

const arg = process.argv[2] ?? 'all';
const list = process.env.QA_ALLY ? [] : arg === 'all' ? CFGS : [CFGS[Number(arg)]];
const results = list.map((c) => {
  const r = run(c);
  console.log(JSON.stringify(r));
  return r;
});
const bad = results.filter((r) => r.totalMismatch > 0 || r.feedErrors > 0 || r.orderIssues.length > 0);
console.log(`\n=== ${results.length} 판, 불일치 판 ${bad.length} ===`);
void rleDecode;

/** 동맹·Lockout·파기 시나리오 (봇은 먼저 제안하지 않으므로 사람 자리 3명이 명령) — 개인 cmd_ack 도 store 에 넣는다 */
export function allyScenario() {
  const map = generateMapForSize(4242, 'S', 3, MAP_GEN_DEFAULT);
  const state = createGameState(map, [1, 2, 3].map((id) => ({ playerId: id, isBot: false, connected: true })), 'NORMAL', 1);
  const sim = new Simulation(state, CivBot);
  const s = mkStore(true);
  bootstrap(s, state);
  const seen = new Set<string>();
  const acks: string[] = [];
  let seq = 0;
  const cmd = (pid: number, c: Record<string, unknown>) => sim.enqueue(pid, pid, { ...c, clientSeq: ++seq } as never);
  // 플레이어 1 의 명령은 store 를 거쳐 보낸 것처럼 pending 에 넣는다 (cmd_ack 경로)
  const plan: Record<number, () => void> = {
    2: () => (cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 2 }), cmd(2, { type: 'cmd_ally_propose', targetPlayerId: 1 })),
    5: () => cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 3 }),
    7: () => cmd(3, { type: 'cmd_ally_respond', proposalId: 2, accept: true }),
    9: () => cmd(2, { type: 'cmd_ally_propose', targetPlayerId: 3 }),
    11: () => cmd(3, { type: 'cmd_ally_respond', proposalId: 3, accept: true }), // 전원 동맹 → lockout countdown
    20: () => cmd(1, { type: 'cmd_ally_break', allyPlayerId: 2 }), // MIN_DURATION
    400: () => cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 2 }), // freeze 중 → ALLY_FROZEN
    700: () => (cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 2 }), cmd(2, { type: 'cmd_ally_respond', proposalId: 999, accept: true })),
    710: () => cmd(2, { type: 'cmd_ally_respond', proposalId: 4, accept: true }),
    1100: () => cmd(1, { type: 'cmd_ally_break', allyPlayerId: 2 }),
    1120: () => cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 3 }),
    1125: () => cmd(3, { type: 'cmd_ally_respond', proposalId: 5, accept: false }),
    1130: () => cmd(1, { type: 'cmd_ally_propose', targetPlayerId: 3 }), // 만료까지 둔다
  };
  while (state.tick < 1500) {
    plan[state.tick + 1]?.();
    const out = sim.step();
    for (const p of out.personal) {
      if (p.playerId !== 1) continue;
      const m = wire(p.msg) as ServerMessage;
      if (m.type === 'cmd_ack') acks.push(`t${state.tick} ${m.accepted ? 'OK' : m.reason}`);
      s.onMessage(m);
    }
    for (const m0 of out.broadcast) {
      const m = wire(m0) as ServerMessage;
      seen.add(m.type === 'alliance_lockout' ? `alliance_lockout:${m.phase}` : m.type === 'ally_broken' ? `ally_broken:${m.reason}` : m.type === 'ally_proposal_closed' ? `ally_proposal_closed:${m.reason}` : m.type);
      s.onMessage(m);
    }
  }
  return { fulls: s.reconStats.fulls, mismatched: s.reconStats.mismatchedFulls, samples: s.reconStats.samples.slice(0, 5), seen: [...seen].filter((x) => /ally|alliance/.test(x)).sort(), acks, feed: s.feed.map((f) => f.text), toasts: s.toasts.map((t) => t.text) };
}
if (process.env.QA_ALLY) console.log(JSON.stringify(allyScenario(), null, 1));
