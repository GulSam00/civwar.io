/**
 * 고정 tick 루프 (GDD 3.1 / 7.4 / 4.9).
 *
 * onTick(t) 단계 순서는 GDD 7.4 그대로이며 함수 하나 = 단계 하나다.
 *
 * 결정론 절대 규칙 (4.9)
 *  - Phase A(4a·6) 는 Readonly<GameState> 만 받고 tick 로컬 결과 객체만 돌려준다. 게임 상태 쓰기 금지.
 *  - Phase B(4b·7) 만 상태를 쓴다. 순회 정렬 키: 깃발 = flag.id ASC, 타일·기지 = tileId ASC,
 *    플레이어 = playerId ASC. (state.flags / state.bases / state.players 는 항상 그 순서로 유지된다.)
 *  - Math.random·부동소수 누적 금지. 정수·floor/ceil·isqrt 만.
 *
 * 2차 구현 범위: 1~14 전 단계 (4 movement.ts / 4a·4b combat.ts / 5·6·7·9·10 gauge.ts / 3 alliance.ts).
 * 11(봇)만 자리 — 3차.
 */
import {
  BASE_HP_REGEN_MILLI,
  BASE_REGEN_DELAY_TICK,
  BASE_PROD_MAX_PERMILLE,
  BASE_PROD_RECOVER_PER_MIN_PERMILLE,
  techBaseRecoverPm,
  DISCONNECT_GRACE_TICK,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENDGAME_RUSH_TICK,
  SNAPSHOT_FULL_INTERVAL,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_SCALE,
  TICKS_PER_MIN,
  type BotDifficultyParams,
  type C2S_GameCommand,
  type S2C_CmdAck,
  type S2C_GameOver,
  TICK_MS,
} from '@civwar/shared';
import { allianceTimers, dropPlayerDiplomacy } from './alliance.js';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from './combat.js';
import { compareQueued, stage1_drainInput, type QueuedCommand } from './commands.js';
import { removeFlag } from './flagops.js';
import { stage5_accumulateBudget, stage6_combatPhaseA, stage7_combatPhaseB, stage7c_progressDecay, stage9_derived, stage10_flagEnd } from './gauge.js';
import { stage4_moveFlags } from './movement.js';
import { destOf, fieldKey } from './rules.js';
import { troopCap } from './economy.js';
import { ANNEX } from './annex.js';
import { computeProduction } from './production.js';
import { newOutbox, type Outbox } from './outbox.js';
import { DeltaTracker, buildSnapshotFull } from './snapshot.js';
import { compareRank, judgeVictory, thresholdPct, thresholdScaled } from './victory.js';
import { NEUTRAL, setTileOwner, type GameState } from './state.js';

// Phase A 결과 타입은 각 모듈에 있다: FlagCombatPlan(combat.ts) / PushPlan(gauge.ts)
export type { FlagCombatPlan } from './combat.js';
export type { PushPlan } from './gauge.js';
export { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from './combat.js';
export { stage4_moveFlags } from './movement.js';
export { stage5_accumulateBudget, stage6_combatPhaseA, stage7_combatPhaseB, stage7c_progressDecay, stage9_derived, stage10_flagEnd } from './gauge.js';

// ───────────────────── 봇 자리 (3차) ─────────────────────

export interface BotBrain {
  /**
   * 11단계에서 호출. 반환 명령은 다음 tick 1단계 입력 큐에 들어간다.
   * params = 그 봇의 난이도 레버(state.players[playerId].bot 과 같은 객체, v4.1 [A-46]).
   */
  decide(state: Readonly<GameState>, playerId: number, t: number, params: Readonly<BotDifficultyParams>): C2S_GameCommand[];
}
/** 1차: 아무것도 하지 않는 봇 */
export const IdleBot: BotBrain = { decide: () => [] };

// ───────────────────── 단계 함수 ─────────────────────

/**
 * 2. 자원 생산 — playerId ASC. 병력(√tiles) / 골드(그로스 → 유지비 차감 → 순증).
 * v4.5 (§22): 영토 생산 + 기지 생산(기지 60칸분 / 수도 100칸분 × 생산력) — production.ts. 내역은 state.yields 에.
 */
export function stage2_produce(state: GameState): void {
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive) {
      state.yields[id] = [];
      continue;
    }
    const prod = computeProduction(state, p);
    state.yields[id] = prod.yields;
    // 병력 (3.2) — troops = min(troops + regen, cap). cap 초과분(환급·영토 상실)은 잘리고 장부 capClamp 로 기록
    const regen = prod.regenMilli;
    p.troopsMilli += regen;
    state.ledger.regen += regen;
    const capMilli = troopCap(p) * 1000;
    if (p.troopsMilli > capMilli) {
      state.ledger.capClamp += p.troopsMilli - capMilli;
      p.troopsMilli = capMilli;
    }
    // 골드 (3.3) — 유지비는 9단계(직전 tick)의 주둔 상태를 읽는다
    const net = prod.netMilli;
    p.upkeepPm = prod.upkeepPm;
    p.goldMilli += net;
    p.goldEarnedMilli += Math.max(0, net); // 패치 7차: 순수입이 음수여도 누적 획득 골드(타이브레이커)는 줄지 않는다
  }
}

/** 3. 외교·시간 타이머 — 동맹(6.2), 종반 러시 발동, 접속 유예 → 봇 인계, threshold_update */
export function stage3_timers(state: GameState, t: number, out: Outbox): void {
  allianceTimers(state, t, out);
  if (t === ENDGAME_RUSH_TICK) {
    state.endgameRushActive = true;
    out.broadcast.push({ type: 'endgame_rush', tick: t, costMultPermille: ENDGAME_RUSH_COST_MULT_PERMILLE });
  }
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive || p.connected || p.botControlled || p.disconnectedSinceTick === null) continue;
    if (t - p.disconnectedSinceTick >= DISCONNECT_GRACE_TICK) {
      p.botControlled = true;
      out.broadcast.push({ type: 'bot_takeover', tick: t, playerId: id });
    }
  }
  // threshold_update: 감쇠 시작부터 분당 1회, 바닥 도달 tick 까지
  if (t >= THRESHOLD_DECAY_START && (t - THRESHOLD_DECAY_START) % TICKS_PER_MIN === 0) {
    const prevAtFloor = t > THRESHOLD_DECAY_START && thresholdScaled(t - TICKS_PER_MIN) <= THRESHOLD_FLOOR_PCT * THRESHOLD_SCALE;
    if (!prevAtFloor) out.broadcast.push({ type: 'threshold_update', tick: t, thresholdPct: thresholdPct(t) });
  }
}

/** 8. 기지 체력 회복 — tileId ASC. 이번 tick 피해 없음 + 지연 경과한 기지만 */
export function stage8_baseRegen(state: GameState, t: number): void {
  for (const b of state.bases) {
    // v4.4 [A-85]: 생산력 선형 회복 (피해·소유와 무관, 매 tick)
    if (b.prodScaled < BASE_PROD_MAX_PERMILLE * TICKS_PER_MIN) {
      // 2026-10-24 기지 재건(TER-3B): 기지 소유자의 회복 속도 배율 (무소유·무테크 1000)
      const own = state.players[state.owners[b.tileId]];
      const recover = own ? Math.floor((BASE_PROD_RECOVER_PER_MIN_PERMILLE * techBaseRecoverPm(own.statPm)) / 1000) : BASE_PROD_RECOVER_PER_MIN_PERMILLE;
      b.prodScaled = Math.min(BASE_PROD_MAX_PERMILLE * TICKS_PER_MIN, b.prodScaled + recover);
    }
    if (b.damagedThisTick) {
      b.damagedThisTick = false;
      continue;
    }
    if (b.hpMilli >= b.maxHpMilli) continue;
    if (t - b.lastDamageTick < BASE_REGEN_DELAY_TICK) continue;
    b.hpMilli = Math.min(b.maxHpMilli, b.hpMilli + BASE_HP_REGEN_MILLI);
  }
}

/** 11. 봇 AI — 봇별 t % bot.decisionInterval == 0 (v4.1 [A-46]), botIndex(=playerId) ASC. 명령은 다음 tick 큐로 */
export function stage11_bots(state: GameState, t: number, brain: BotBrain): { playerId: number; cmds: C2S_GameCommand[] }[] {
  const res: { playerId: number; cmds: C2S_GameCommand[] }[] = [];
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive || !p.botControlled) continue;
    if (t % p.bot.decisionInterval !== 0) continue;
    const cmds = brain.decide(state, id, t, p.bot);
    if (cmds.length) res.push({ playerId: id, cmds });
  }
  return res;
}

/**
 * 12. 탈락 판정 (4.14) — v4.4 (§21, 사용자 2026-10-14): **기지(수도 포함)를 모두 잃으면 즉시 멸망**하고,
 * 남은 영토 전부를 멸망시킨 플레이어(마지막 기지를 점령한 쪽 = lastBaseLostTo)가 합병한다. 깃발은 전부 소멸(환불 없음).
 * 구 규칙(타일 0 → 탈락)은 이 규칙에 포함된다(타일 0 ⇒ 기지 0). playerId ASC.
 * 합병 대상이 이미 멸망했으면 그를 멸망시킨 플레이어로 거슬러 올라가고(같은 tick 연쇄), 끝내 생존자가 없으면 중립으로 돌린다.
 */
export function stage12_elimination(state: GameState, t: number, out: Outbox): void {
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive || (p.baseTiles.length > 0 && p.tiles > 0)) continue;
    const by = resolveConqueror(state, id, p.lastBaseLostTo ?? p.lastLostTo);
    // 합병: 남은 칸 전부 (기지는 이미 없다). setTileOwner 경유 → tileChanges 델타·파생값·생산 지역 무효화
    let annexed = 0;
    const to = by ?? NEUTRAL;
    for (let tile = 0; tile < state.owners.length; tile++) {
      if (state.owners[tile] !== id) continue;
      setTileOwner(state, tile, to);
      if (by !== null) annexed++;
    }
    p.alive = false;
    p.eliminatedTick = t;
    p.conqueredBy = by;
    // 약소국 정리 보상 (§31): 풀·깃발 병력 인계분 + 정액 현상금, 골드 인계분 + 정액 현상금 — 합병자(생존)에게만
    let assetMilli = p.troopsMilli;
    p.troopsMilli = 0;
    let goldMilli = p.goldMilli;
    p.goldMilli = 0;
    p.goldWeight = 0;
    // 모든 깃발 즉시 소멸 (환불 없음)
    for (const f of state.flags.filter((x) => x.ownerId === id)) {
      assetMilli += f.troopsMilli;
      f.troopsMilli = 0;
      removeFlag(state, f, t, 'eliminated', 0, out);
    }
    const heir = by !== null ? state.players[by] : null;
    let gotTroops = 0;
    let gotGold = 0;
    if (heir && heir.alive) {
      const room = Math.max(0, troopCap(heir) * 1000 - heir.troopsMilli);
      const fromAssets = Math.min(room, Math.floor((assetMilli * ANNEX.assetPermille) / 1000));
      // 패치 6차: 합병자 자신의 현재 총병력(풀+깃발)의 ownTroopsPermille‰ 회복 (상한까지, 새로 생긴 병력 = 회계상 regen)
      let ownTotal = heir.troopsMilli;
      for (const f of state.flags) if (f.ownerId === heir.id) ownTotal += f.troopsMilli;
      const ownRecover = Math.min(room - fromAssets, Math.floor((ownTotal * ANNEX.ownTroopsPermille) / 1000));
      const bounty = Math.min(room - fromAssets - ownRecover, ANNEX.bountyTroops * 1000) + ownRecover;
      heir.troopsMilli += fromAssets + bounty;
      assetMilli -= fromAssets; // 인계된 만큼은 소멸이 아니다
      state.ledger.regen += bounty; // 새로 생긴 병력 (회계상 생산)
      gotTroops = Math.floor((fromAssets + bounty) / 1000);
      // 합병자 자신의 골드 순수입 ownGoldSeconds 초치 (순수입 ≤ 0 이면 0)
      const ownNet = Math.max(0, computeProduction(state, heir).netMilli) * Math.floor((ANNEX.ownGoldSeconds * 1000) / TICK_MS);
      const g = Math.floor((goldMilli * ANNEX.goldPermille) / 1000) + ANNEX.bountyGold * 1000 + ownNet;
      heir.goldMilli += g;
      heir.goldEarnedMilli += 0; // 누적 획득 골드(타이브레이커)에는 넣지 않는다
      gotGold = Math.floor(g / 1000);
    }
    state.ledger.eliminated += assetMilli;
    // 모든 동맹·제안 즉시 해제 (쿨다운 없이)
    dropPlayerDiplomacy(state, id, t, out);
    out.broadcast.push({ type: 'player_eliminated', tick: t, playerId: id, byPlayerId: by, annexedTiles: annexed, bountyTroops: gotTroops, bountyGold: gotGold });
  }
}

/** 합병 받을 생존 플레이어 — 후보가 멸망했으면 conqueredBy 를 따라간다. 없으면 null */
function resolveConqueror(state: GameState, victim: number, cand: number | null): number | null {
  let c = cand;
  for (let guard = 0; c !== null && guard < state.players.length; guard++) {
    if (c === victim || c === NEUTRAL) return null;
    const q = state.players[c];
    if (!q) return null;
    if (q.alive) return c;
    c = q.conqueredBy;
  }
  return null;
}

/** 13. 승리 판정 (6.1). game_over 메시지는 14단계 스냅샷 뒤에 송신되도록 반환만 한다 */
export function stage13_victory(state: GameState, t: number): S2C_GameOver | null {
  const r = judgeVictory(state, t);
  if (!r) return null;
  state.result = r;
  const all = state.players.filter(Boolean);
  const alive = all.filter((p) => p.alive).sort(compareRank);
  const dead = all.filter((p) => !p.alive).sort((a, b) => (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0) || a.id - b.id);
  const standings = [...alive, ...dead].map((p, i) => ({
    rank: i + 1,
    playerId: p.id,
    tiles: p.tiles,
    troops: Math.floor(p.troopsMilli / 1000),
    goldEarned: Math.floor(p.goldEarnedMilli / 1000),
    alive: p.alive,
  }));
  return { type: 'game_over', finalTick: t, winnerId: r.winnerId, reason: r.reason, standings };
}

/** 14. 브로드캐스트 — snapshot_delta (+ t % 25 == 0 이면 snapshot_full) */
export function stage14_broadcast(state: GameState, t: number, tracker: DeltaTracker, out: Outbox): void {
  out.broadcast.push(tracker.buildDelta(state));
  if (t % SNAPSHOT_FULL_INTERVAL === 0) {
    out.broadcast.push(buildSnapshotFull(state));
    tracker.resync(state);
  }
}

/** 거리장 캐시 정리 — 살아 있는 깃발이 쓰지 않는 키 삭제 (결과에 영향 없음, 메모리만) */
function pruneFields(state: GameState): void {
  if (state.fields.size === 0 && state.defFields.size === 0) return;
  const used = new Set<number>();
  for (const f of state.flags) used.add(fieldKey(destOf(f)));
  for (const k of [...state.fields.keys()]) if (!used.has(k)) state.fields.delete(k);
  for (const [k, v] of [...state.defFields]) if (v.ver !== state.pathVersion) state.defFields.delete(k); // v4.5: 낡은 방어 경로
}

// ───────────────────── 시뮬레이션 ─────────────────────

export class Simulation {
  private queue: QueuedCommand[] = [];
  private recvSeq = 0;
  readonly tracker: DeltaTracker;

  constructor(
    readonly state: GameState,
    private readonly brain: BotBrain = IdleBot,
  ) {
    this.tracker = new DeltaTracker(state);
  }

  /** 다음 tick 1단계에서 처리할 명령을 받는다. 수신 순번(recvSeq)이 1차 정렬 키 */
  enqueue(connId: number, playerId: number, msg: C2S_GameCommand): void {
    this.queue.push({ recvSeq: ++this.recvSeq, connId, playerId, msg });
  }

  /** 게임 종료 후 처리되지 못한 명령 — 사람(connId ≠ 0) 명령마다 NOT_IN_GAME ack 을 만들고 큐를 비운다 (QA m-9) */
  flushPending(): { playerId: number; msg: S2C_CmdAck }[] {
    const res = this.queue
      .filter((q) => q.connId !== 0)
      .sort(compareQueued)
      .map((q) => ({ playerId: q.playerId, msg: { type: 'cmd_ack', clientSeq: q.msg.clientSeq, accepted: false, reason: 'NOT_IN_GAME' } as S2C_CmdAck }));
    this.queue = [];
    return res;
  }

  get finished(): boolean {
    return this.state.result !== null;
  }

  /** onTick(t) — GDD 7.4 */
  step(): Outbox {
    const out = newOutbox();
    if (this.finished) return out;
    const state = this.state;
    const t = ++state.tick;
    state.changes = { tileChanges: [], flagsGone: [], combatLoss: [] };

    const queue = this.queue; // 1. tick 경계 이전 도착분만
    this.queue = [];
    stage1_drainInput(state, queue, t, out);
    stage2_produce(state); // 2
    stage3_timers(state, t, out); // 3
    stage4_moveFlags(state, t, out); // 4
    const combat = stage4a_flagCombatPhaseA(state, t); // 4a (읽기 전용)
    stage4b_flagCombatPhaseB(state, combat, t, out); // 4b (§33 모델 2: 끝에서 stage4c_updateMorale — flagId ASC)
    stage5_accumulateBudget(state, t); // 5
    const push = stage6_combatPhaseA(state, t); // 6 (읽기 전용)
    const pushedSet = stage7_combatPhaseB(state, push, t, out); // 7
    stage7c_progressDecay(state, combat.presence, pushedSet, t, out); // 7c (v4.1)
    stage8_baseRegen(state, t); // 8
    stage9_derived(state, t, out); // 9
    stage10_flagEnd(state, t, out); // 10
    for (const { playerId, cmds } of stage11_bots(state, t, this.brain)) {
      for (const c of cmds) this.enqueue(0, playerId, c); // 11 → 다음 tick 입력
    }
    stage12_elimination(state, t, out); // 12
    const gameOver = stage13_victory(state, t); // 13
    pruneFields(state);
    stage14_broadcast(state, t, this.tracker, out); // 14
    if (gameOver) out.broadcast.push(gameOver); // 최종 스냅샷 뒤에 game_over
    return out;
  }
}
