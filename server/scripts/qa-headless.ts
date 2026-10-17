/**
 * QA 전용 (커밋 금지) — 헤드리스 전체 판 시뮬레이션으로
 *  1) 모든 송신 메시지(JSON 왕복)를 문서 스키마로 검사 (qa-schema.ts)
 *  2) 이벤트 커버리지 (문서 이벤트 중 발생/미발생, 문서에 없는 type)
 *  3) tick 내 송신 순서 (이벤트 → snapshot_delta → snapshot_full → game_over, 이벤트 tick == t)
 *  4) "프론트 재구성 모델": 문서대로 이벤트+델타만 적용한 상태가 매 snapshot_full 과 일치하는지
 *  5) 회계 불변식, threshold_update / endgame_rush 시점
 * 실행: npx tsx server/scripts/qa-headless.ts [seed=777] [size=M] [N=10] [mix=HARD|NORMAL|EASY] [humanIdle=0]
 *   humanIdle=1 이면 playerId N 을 "끊긴 사람" 으로 시작 → 450 tick 뒤 bot_takeover
 */
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, TECH_STAT, techMaskWith, techStatValues, FLAG_CAP_BASE, FLAG_TILES_PER_SLOT, FLAG_CAP_HARD_MAX, type BotDifficultyName, type MapSizeClass, rleDecode } from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { createGameState, ledgerImbalance } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';
import { DOC_SCHEMA, validateMessage } from './qa-schema.js';

const seed = Number(process.argv[2] ?? 777);
const size = (process.argv[3] ?? 'M') as MapSizeClass;
const N = Number(process.argv[4] ?? 10);
const diff = (process.argv[5] ?? 'HARD') as BotDifficultyName;
const humanIdle = process.argv[6] === '1';

const P = MAP_SIZE_PRESETS[size];
const map = generateMap(seed, P.w, P.h, N);
const state = createGameState(
  map,
  Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: !(humanIdle && i + 1 === N), connected: !(humanIdle && i + 1 === N) })),
  diff,
);
if (humanIdle) state.players[N].disconnectedSinceTick = 0;
const sim = new Simulation(state, CivBot);

const schemaErr = new Map<string, { n: number; ex: string }>();
const counts = new Map<string, number>();
const subCounts = new Map<string, number>();
const orderErr: string[] = [];
const recon: string[] = [];
const ledgerErr: number[] = [];
const sub = (k: string) => subCounts.set(k, (subCounts.get(k) ?? 0) + 1);
const thresholdTicks: number[] = [];
let rushTick = -1;
let gameOver: any = null;
let rejects = new Map<string, number>();

// ───────── 프론트 재구성 모델 (문서만 보고 구현한다고 가정) ─────────
type FM = Record<string, any>;
const M = {
  owners: new Uint8Array(0) as Uint8Array,
  players: new Map<number, FM>(),
  flags: new Map<number, FM>(),
  bases: new Map<number, number>(), // tileId → hpPct
  baseProd: new Map<number, number>(), // v4.4 tileId → prodPm
  production: new Map<number, string>(), // v4.4 playerId → JSON(PlayerProduction)
  alliances: new Map<string, FM>(),
  proposals: new Map<number, FM>(),
  freeze: null as number | null,
  lockout: null as number | null,
  threshold: 60,
  rush: false,
};
function loadFull(f: any): void {
  M.owners = rleDecode(f.owners, map.width * map.height);
  M.players = new Map(f.players.map((p: any) => [p.id, { ...p }]));
  M.flags = new Map(f.flags.map((x: any) => [x.id, { ...x }]));
  M.bases = new Map(f.bases.map((b: any) => [b.tileId, b.hpPct]));
  M.baseProd = new Map(f.bases.map((b: any) => [b.tileId, b.prodPm]));
  M.production = new Map(f.production.map((pp: any) => [pp.playerId, JSON.stringify(pp)]));
  M.alliances = new Map(f.alliances.map((a: any) => [`${a.a}-${a.b}`, { ...a }]));
  M.proposals = new Map(f.allyProposals.map((p: any) => [p.proposalId, { ...p }]));
  M.freeze = f.allianceFreezeUntilTick;
  M.lockout = f.lockoutDissolveTick;
  M.threshold = f.thresholdPct;
  M.rush = f.endgameRushActive;
}
const BIT = { IN_COMBAT: 1, ROUTED: 2, BLOCKED: 4, DISENGAGING: 8, BREAKAWAY: 16, STALLED: 32, HALTED: 64, POSTURE_PENDING: 128 };
function applyEvent(e: any): void {
  switch (e.type) {
    case 'flag_issued':
      M.flags.set(e.flagId, { id: e.flagId, ownerId: e.playerId, slotIndex: e.slotIndex, unit: e.unit, posture: e.posture, troops: e.troops, posTileId: e.originTileId, anchorTileId: e.anchorTileId, targetOwnerId: e.targetOwnerId, state: 'MARCHING', targetTileId: null, progressPct: 0, stalled: false, inCombat: false, routed: false, blocked: false, disengaging: false, postureCooldownUntilTick: 0, disengageUntilTick: null, breakaway: false, halted: false, returnBaseTileId: null, pendingPosture: null });
      break;
    case 'flag_retargeted': {
      const f = M.flags.get(e.flagId);
      if (f) Object.assign(f, { anchorTileId: e.anchorTileId, targetOwnerId: e.targetOwnerId, posture: e.posture });
      break;
    }
    case 'flag_posture_changed': {
      const f = M.flags.get(e.flagId);
      // I-1 수정 후: 이벤트의 targetOwnerId 를 그대로 쓴다 (문서 §5)
      if (f) Object.assign(f, { posture: e.posture, postureCooldownUntilTick: e.cooldownUntilTick, targetOwnerId: e.targetOwnerId });
      break;
    }
    case 'flag_disengage_started': {
      const f = M.flags.get(e.flagId);
      if (f) f.disengageUntilTick = e.untilTick;
      break;
    }
    case 'flag_routed': {
      // 문서 §5: 패주 시 disengageUntilTick = null (m-8)
      const f = M.flags.get(e.flagId);
      if (f) f.disengageUntilTick = null;
      break;
    }
    case 'flag_disengaged': {
      const f = M.flags.get(e.flagId);
      if (f) f.disengageUntilTick = null;
      break;
    }
    case 'flag_ended':
      M.flags.delete(e.flagId);
      break;
    case 'tech_purchased': {
      const p = M.players.get(e.playerId)!;
      p.techMask = techMaskWith(p.techMask, e.nodeId);
      p.techCount += 1;
      if (p.techMask !== e.techMask) recon.push(`t${e.tick} tech_purchased.techMask ${e.techMask} ≠ 모델 ${p.techMask}`);
      if (e.newFlagCap !== capOf(p)) recon.push(`t${e.tick} tech_purchased.newFlagCap ${e.newFlagCap} ≠ 문서식 ${capOf(p)}`);
      break;
    }
    case 'player_eliminated':
      M.players.get(e.playerId)!.alive = false;
      break;
    case 'endgame_rush':
      M.rush = true;
      break;
    case 'ally_formed':
      M.alliances.set(`${e.a}-${e.b}`, { a: e.a, b: e.b, state: 'ACTIVE', sinceTick: e.tick, breakAtTick: null });
      break;
    case 'ally_break_started': {
      const a = M.alliances.get(`${e.a}-${e.b}`);
      if (a) Object.assign(a, { state: 'BREAKING', breakAtTick: e.breakAtTick });
      break;
    }
    case 'ally_broken':
      M.alliances.delete(`${e.a}-${e.b}`);
      break;
    case 'ally_proposed':
      M.proposals.set(e.proposalId, { proposalId: e.proposalId, fromPlayerId: e.fromPlayerId, toPlayerId: e.toPlayerId, expireTick: e.expireTick });
      break;
    case 'ally_proposal_closed':
      M.proposals.delete(e.proposalId);
      break;
    case 'alliance_lockout':
      if (e.phase === 'countdown') M.lockout = e.forceDissolveTick;
      else M.lockout = null;
      if (e.phase === 'dissolved') M.freeze = e.freezeUntilTick;
      break;
  }
}
function capOf(p: FM): number {
  return Math.min(FLAG_CAP_HARD_MAX, FLAG_CAP_BASE + Math.floor(p.tiles / FLAG_TILES_PER_SLOT) + techStatValues(p.techMask)[TECH_STAT.SLOT_BONUS]);
}
function applyDelta(d: any): void {
  for (const [t, o] of d.tileChanges) M.owners[t] = o;
  for (const pd of d.playerDeltas) Object.assign(M.players.get(pd.id)!, pd);
  for (const [id, pos] of d.flagMoves) { const f = M.flags.get(id); if (f) f.posTileId = pos; else recon.push(`t${d.tick} flagMoves 모르는 깃발 ${id}`); }
  for (const [id, tr, st] of d.flagStats) { const f = M.flags.get(id); if (f) Object.assign(f, { troops: tr, state: st }); else recon.push(`t${d.tick} flagStats 모르는 깃발 ${id}`); }
  const prog = new Map<number, number>(d.flagProgress);
  for (const f of M.flags.values()) f.progressPct = prog.get(f.id) ?? 0; // 문서 v4.2: progressPct > 0 깃발 전부 → 없으면 0 으로 본다
  for (const [id, tt] of d.flagTargets) { const f = M.flags.get(id); if (f) f.targetTileId = tt; }
  for (const [tile, hp] of d.baseHp) M.bases.set(tile, hp);
  for (const [tile, pm] of d.baseProd) M.baseProd.set(tile, pm); // v4.4 §21
  for (const pp of d.production) M.production.set(pp.playerId, JSON.stringify(pp)); // v4.4 §21
  for (const id of d.flagsGone) M.flags.delete(id);
  if (d.thresholdPct !== undefined) M.threshold = d.thresholdPct;
  for (const [id, posture, bits, cd] of d.flagFlags) {
    const f = M.flags.get(id);
    if (!f) { recon.push(`t${d.tick} flagFlags 모르는 깃발 ${id}`); continue; }
    Object.assign(f, { posture, postureCooldownUntilTick: cd, inCombat: !!(bits & BIT.IN_COMBAT), routed: !!(bits & BIT.ROUTED), blocked: !!(bits & BIT.BLOCKED), disengaging: !!(bits & BIT.DISENGAGING), breakaway: !!(bits & BIT.BREAKAWAY), stalled: !!(bits & BIT.STALLED), halted: !!(bits & BIT.HALTED), pendingPosture: bits & BIT.POSTURE_PENDING ? 1 - posture : null });
  }
  for (const [id, rb] of d.flagReturnBase ?? []) {
    const f = M.flags.get(id);
    if (f) f.returnBaseTileId = rb;
  }
  if (M.freeze !== null && d.tick >= M.freeze) M.freeze = null;
}
const reconByField = new Map<string, { n: number; ex: string }>();
function noteRecon(field: string, ex: string) {
  const r = reconByField.get(field);
  if (r) r.n++;
  else reconByField.set(field, { n: 1, ex });
}
function compareFull(f: any): void {
  const t = f.tick;
  const owners = rleDecode(f.owners, map.width * map.height);
  let od = 0;
  for (let i = 0; i < owners.length; i++) if (owners[i] !== M.owners[i]) od++;
  if (od) noteRecon('owners', `t${t} ${od}칸 불일치`);
  for (const p of f.players) {
    const m = M.players.get(p.id)!;
    for (const k of ['tiles', 'troops', 'gold', 'goldWeight', 'upkeepPm', 'alive', 'allyBreaks']) if (m[k] !== p[k]) noteRecon(`player.${k}`, `t${t} p${p.id} 모델 ${m[k]} / full ${p[k]}`);
    if (m.techMask !== p.techMask || m.techCount !== p.techCount) noteRecon('player.techMask', `t${t} p${p.id}`);
    if (capOf(p) !== p.flagCap) noteRecon('player.flagCap(문서식)', `t${t} p${p.id} 문서식 ${capOf(p)} / full ${p.flagCap}`);
  }
  const ids = new Set([...M.flags.keys(), ...f.flags.map((x: any) => x.id)]);
  for (const id of ids) {
    const a = M.flags.get(id);
    const b = f.flags.find((x: any) => x.id === id);
    if (!a || !b) { noteRecon('flags.존재', `t${t} flag ${id} 모델 ${!!a} / full ${!!b}`); continue; }
    for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) noteRecon(`flag.${k}`, `t${t} flag ${id} (${b.state},posture ${b.posture}) 모델 ${JSON.stringify(a[k])} / full ${JSON.stringify(b[k])}`);
  }
  for (const b of f.bases) {
    if (M.bases.get(b.tileId) !== b.hpPct) noteRecon('base.hpPct', `t${t} base ${b.tileId} 모델 ${M.bases.get(b.tileId)} / full ${b.hpPct}`);
    if (M.owners[b.tileId] !== b.ownerId) noteRecon('base.ownerId', `t${t}`);
    if (M.baseProd.get(b.tileId) !== b.prodPm) noteRecon('base.prodPm', `t${t} base ${b.tileId} 모델 ${M.baseProd.get(b.tileId)} / full ${b.prodPm}`);
  }
  for (const pp of f.production) if (M.production.get(pp.playerId) !== JSON.stringify(pp)) noteRecon('production', `t${t} p${pp.playerId}`);
  const al = [...M.alliances.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  if (JSON.stringify(al) !== JSON.stringify(f.alliances)) noteRecon('alliances', `t${t} 모델 ${JSON.stringify(al)} / full ${JSON.stringify(f.alliances)}`);
  const pr = [...M.proposals.values()].sort((x, y) => x.proposalId - y.proposalId);
  if (JSON.stringify(pr) !== JSON.stringify(f.allyProposals)) noteRecon('allyProposals', `t${t} 모델 ${JSON.stringify(pr)} / full ${JSON.stringify(f.allyProposals)}`);
  if (M.freeze !== f.allianceFreezeUntilTick) noteRecon('allianceFreezeUntilTick', `t${t} 모델 ${M.freeze} / full ${f.allianceFreezeUntilTick}`);
  if (M.lockout !== f.lockoutDissolveTick) noteRecon('lockoutDissolveTick', `t${t} 모델 ${M.lockout} / full ${f.lockoutDissolveTick}`);
  if (M.threshold !== f.thresholdPct) noteRecon('thresholdPct', `t${t} 모델 ${M.threshold} / full ${f.thresholdPct}`);
  if (M.rush !== f.endgameRushActive) noteRecon('endgameRushActive', `t${t}`);
  if (f.ticksRemaining !== Math.max(0, HARD_TIMEOUT_TICK - t)) noteRecon('ticksRemaining', `t${t}`);
}

// 초기 부트스트랩 (room.beginGame 과 같은 snapshot_full tick 0)
import { buildSnapshotFull, buildMatchConfig, buildMapInit } from '../src/game/snapshot.js';
for (const m0 of [buildMatchConfig(state), buildMapInit(state), buildSnapshotFull(state)]) {
  const m = JSON.parse(JSON.stringify(m0));
  for (const e of validateMessage(m)) schemaErr.set(`${m.type}: ${e.replace(/\[\d+\]/g, '[]')}`, { n: 1, ex: e });
  counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
}
loadFull(JSON.parse(JSON.stringify(buildSnapshotFull(state))));

const t0 = performance.now();
while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 5) {
  const out = sim.step();
  const t = state.tick;
  const imb = ledgerImbalance(state);
  if (imb !== 0) ledgerErr.push(t);
  // 송신 순서
  const types = out.broadcast.map((m) => m.type);
  const di = types.indexOf('snapshot_delta');
  if (di < 0) orderErr.push(`t${t} snapshot_delta 없음`);
  for (let i = 0; i < types.length; i++) {
    const ty = types[i];
    if (i < di && (ty === 'snapshot_full' || ty === 'game_over')) orderErr.push(`t${t} ${ty} 가 delta 앞`);
    if (i > di && !['snapshot_full', 'game_over'].includes(ty)) orderErr.push(`t${t} 이벤트 ${ty} 가 delta 뒤`);
  }
  if (types.includes('game_over') && types[types.length - 1] !== 'game_over') orderErr.push(`t${t} game_over 가 마지막 broadcast 아님`);
  const all = [...out.broadcast, ...out.personal.map((p) => p.msg)];
  for (const m0 of all) {
    const m = JSON.parse(JSON.stringify(m0));
    counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    for (const e of validateMessage(m)) {
      const key = `${m.type}: ${e.replace(/\[\d+\]/g, '[]').replace(/실제 .*/, '')}`;
      const r = schemaErr.get(key);
      if (r) r.n++;
      else schemaErr.set(key, { n: 1, ex: e });
    }
    if ('tick' in m && m.type !== 'snapshot_full' && m.type !== 'snapshot_delta' && m.tick !== t) orderErr.push(`t${t} ${m.type}.tick=${m.tick}`);
    if (m.type === 'cmd_ack' && !m.accepted) rejects.set(m.reason, (rejects.get(m.reason) ?? 0) + 1);
    if (m.reason !== undefined && m.type !== 'cmd_ack' && m.type !== 'game_over') sub(`${m.type}.${m.reason}`);
    if (m.cause !== undefined) sub(`${m.type}.${m.cause}`);
    if (m.type === 'alliance_lockout') sub(`alliance_lockout.${m.phase}`);
    if (m.type === 'flag_retargeted') sub(`flag_retargeted.auto=${m.auto}`);
    if (m.type === 'flag_posture_changed') sub(`flag_posture_changed.auto=${m.auto}`);
    if (m.type === 'combat_ended') sub(`combat_ended.winner=${m.winnerSideKey === null ? 'null' : 'side'}`);
    if (m.type === 'combat_started') {
      if (m.groupKey !== Math.min(...m.flagIds)) sub('combat_started.groupKey≠min(flagIds)');
      else sub('combat_started.groupKey=min(flagIds)');
    }
    if (m.type === 'threshold_update') thresholdTicks.push(m.tick);
    if (m.type === 'endgame_rush') rushTick = m.tick;
    if (m.type === 'game_over') gameOver = m;
  }
  // 재구성: 이벤트 → delta → (full 이면 비교 후 덮어쓰기)
  for (const m0 of out.broadcast) {
    const m = JSON.parse(JSON.stringify(m0));
    if (m.type === 'snapshot_delta') applyDelta(m);
    else if (m.type === 'snapshot_full') { compareFull(m); loadFull(m); }
    else applyEvent(m);
  }
  if (process.env.QA_STRICT5 === '1' && t % 5 === 0) {
    for (const p of state.players) { if (!p) continue; const m = M.players.get(p.id)!; const tr = Math.floor(p.troopsMilli / 1000), gd = Math.floor(p.goldMilli / 1000);
      if (m.troops !== tr || m.gold !== gd || m.tiles !== p.tiles) noteRecon('strict5.player', 't' + t + ' p' + p.id + ' 모델 ' + [m.tiles, m.troops, m.gold] + ' / 실제 ' + [p.tiles, tr, gd]); }
    for (const f of state.flags) { const m = M.flags.get(f.id); if (m && (m.troops !== Math.floor(f.troopsMilli / 1000) || m.state !== f.state)) noteRecon('strict5.flagStats', 't' + t + ' f' + f.id); }
  }
  // 늦은 입장(재접속·관전) 흉내: tick 사이에 개인 부트스트랩 snapshot_full 을 받은 클라이언트
  if (process.env.QA_LATE === '1' && t % 25 === 13) loadFull(JSON.parse(JSON.stringify(buildSnapshotFull(state))));
}
const ms = performance.now() - t0;

console.log(`\n=== qa-headless seed=${seed} size=${size} N=${N} diff=${diff} humanIdle=${humanIdle} — ${state.tick} tick, ${ms.toFixed(0)} ms ===`);
console.log(`game_over: ${JSON.stringify(gameOver && { finalTick: gameOver.finalTick, reason: gameOver.reason, winnerId: gameOver.winnerId })}`);
console.log(`회계 불변식 위반 tick 수: ${ledgerErr.length}${ledgerErr.length ? ' 예 ' + ledgerErr.slice(0, 5) : ''}`);
console.log(`threshold_update ${thresholdTicks.length}회: ${thresholdTicks.join(',')}`);
console.log(`endgame_rush tick: ${rushTick}`);
console.log(`\n[메시지 type 수신 수]`);
for (const k of Object.keys(DOC_SCHEMA)) console.log(`  ${counts.get(k) ? 'O' : '-'} ${k.padEnd(24)} ${counts.get(k) ?? 0}`);
for (const k of counts.keys()) if (!DOC_SCHEMA[k]) console.log(`  !! 문서에 없는 type ${k} ${counts.get(k)}`);
console.log(`\n[세부 사유/원인 분포]`);
for (const [k, v] of [...subCounts].sort()) console.log(`  ${k} ${v}`);
console.log(`\n[cmd_ack 거절 분포] ${JSON.stringify(Object.fromEntries(rejects))}`);
console.log(`\n[문서 스키마 위반] ${schemaErr.size}종`);
for (const [k, v] of schemaErr) console.log(`  ${v.n}× ${k}  예: ${v.ex}`);
console.log(`\n[송신 순서 위반] ${orderErr.length}`);
for (const e of orderErr.slice(0, 10)) console.log(`  ${e}`);
console.log(`\n[재구성 모델 ↔ snapshot_full 불일치] ${reconByField.size}종 (+ 기타 ${recon.length})`);
for (const [k, v] of reconByField) console.log(`  ${v.n}× ${k}  예: ${v.ex}`);
for (const e of recon.slice(0, 10)) console.log(`  ${e}`);
