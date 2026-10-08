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
  BASE_HP_MAX_MILLI,
  BASE_HP_REGEN_MILLI,
  BASE_REGEN_DELAY_TICK,
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
  type S2C_GameOver,
} from '@civwar/shared';
import { allianceTimers, dropPlayerDiplomacy } from './alliance.js';
import { stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from './combat.js';
import { stage1_drainInput, type QueuedCommand } from './commands.js';
import { removeFlag } from './flagops.js';
import { stage5_accumulateBudget, stage6_combatPhaseA, stage7_combatPhaseB, stage7c_progressDecay, stage9_derived, stage10_flagEnd } from './gauge.js';
import { stage4_moveFlags } from './movement.js';
import { destOf, fieldKey, mobilityTier } from './rules.js';
import { garrisonUpkeepPermille, grossGoldMilliPerTick, regenMilliPerTick, troopCap } from './economy.js';
import { newOutbox, type Outbox } from './outbox.js';
import { DeltaTracker, buildSnapshotFull } from './snapshot.js';
import { compareRank, judgeVictory, thresholdPct, thresholdScaled } from './victory.js';
import type { GameState } from './state.js';

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

/** 2. 자원 생산 — playerId ASC. 병력(√tiles) / 골드(그로스 → 유지비 차감 → 순증) */
export function stage2_produce(state: GameState): void {
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive) continue;
    // 병력 (3.2) — troops = min(troops + regen, cap). cap 초과분(환급·영토 상실)은 잘리고 장부 capClamp 로 기록
    const regen = regenMilliPerTick(p);
    p.troopsMilli += regen;
    state.ledger.regen += regen;
    const capMilli = troopCap(p) * 1000;
    if (p.troopsMilli > capMilli) {
      state.ledger.capClamp += p.troopsMilli - capMilli;
      p.troopsMilli = capMilli;
    }
    // 골드 (3.3) — 유지비는 9단계(직전 tick)의 주둔 상태를 읽는다
    const gross = grossGoldMilliPerTick(p);
    const upkeepPm = garrisonUpkeepPermille(state, p);
    const net = gross - Math.floor((gross * upkeepPm) / 1000);
    p.upkeepPm = upkeepPm;
    p.goldMilli += net;
    p.goldEarnedMilli += net;
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
    if (b.damagedThisTick) {
      b.damagedThisTick = false;
      continue;
    }
    if (b.hpMilli >= BASE_HP_MAX_MILLI) continue;
    if (t - b.lastDamageTick < BASE_REGEN_DELAY_TICK) continue;
    b.hpMilli = Math.min(BASE_HP_MAX_MILLI, b.hpMilli + BASE_HP_REGEN_MILLI);
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

/** 12. 탈락 판정 (4.14) */
export function stage12_elimination(state: GameState, t: number, out: Outbox): void {
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive || p.tiles !== 0) continue;
    p.alive = false;
    p.eliminatedTick = t;
    state.ledger.eliminated += p.troopsMilli;
    p.troopsMilli = 0;
    p.goldMilli = 0;
    p.goldWeight = 0;
    // 모든 깃발 즉시 소멸 (환불 없음)
    for (const f of state.flags.filter((x) => x.ownerId === id)) {
      state.ledger.eliminated += f.troopsMilli;
      f.troopsMilli = 0;
      removeFlag(state, f, t, 'eliminated', 0, out);
    }
    // 모든 동맹·제안 즉시 해제 (쿨다운 없이)
    dropPlayerDiplomacy(state, id, t, out);
    out.broadcast.push({ type: 'player_eliminated', tick: t, playerId: id, byPlayerId: p.lastLostTo });
  }
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
  if (state.fields.size === 0) return;
  const used = new Set<string>();
  for (const f of state.flags) used.add(fieldKey(destOf(f), mobilityTier(state.players[f.ownerId])));
  for (const k of [...state.fields.keys()]) if (!used.has(k)) state.fields.delete(k);
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

  get finished(): boolean {
    return this.state.result !== null;
  }

  /** onTick(t) — GDD 7.4 */
  step(): Outbox {
    const out = newOutbox();
    if (this.finished) return out;
    const state = this.state;
    const t = ++state.tick;
    state.changes = { tileChanges: [], flagsGone: [] };

    const queue = this.queue; // 1. tick 경계 이전 도착분만
    this.queue = [];
    stage1_drainInput(state, queue, t, out);
    stage2_produce(state); // 2
    stage3_timers(state, t, out); // 3
    stage4_moveFlags(state, t, out); // 4
    const combat = stage4a_flagCombatPhaseA(state, t); // 4a (읽기 전용)
    stage4b_flagCombatPhaseB(state, combat, t, out); // 4b
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
