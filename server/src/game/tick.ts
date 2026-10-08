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
 * 1차 구현 범위: 1(명령: 테크) · 2(병력·골드) · 3(타이머 일부) · 8(기지 회복) · 9 · 12 · 13 · 14.
 * 4·4a·4b·5·6·7·10·11 은 자리만 있다 (2차: 깃발·전투, 3차: 봇).
 */
import {
  BASE_HP_MAX_MILLI,
  BASE_HP_REGEN_MILLI,
  BASE_REGEN_DELAY_TICK,
  BOT_DECISION_INTERVAL,
  DISCONNECT_GRACE_TICK,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENDGAME_RUSH_TICK,
  SNAPSHOT_FULL_INTERVAL,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_SCALE,
  TICKS_PER_MIN,
  type C2S_GameCommand,
  type S2C_GameOver,
} from '@civwar/shared';
import { stage1_drainInput, type QueuedCommand } from './commands.js';
import { garrisonUpkeepPermille, grossGoldMilliPerTick, regenMilliPerTick, troopCap } from './economy.js';
import { newOutbox, type Outbox } from './outbox.js';
import { DeltaTracker, buildSnapshotFull } from './snapshot.js';
import { compareRank, judgeVictory, thresholdPct, thresholdScaled } from './victory.js';
import type { GameState } from './state.js';

// ───────────────────── Phase A 결과 타입 (tick 로컬, 2차에서 채움) ─────────────────────

/** 4a 산출: flagId → 이번 tick 손실(milli). 무리 처리 순서와 무관하게 4b 이전 확정 */
export interface FlagCombatPlan {
  readonly lossMilliByFlag: ReadonlyMap<number, number>;
}
/** 6 산출: 깃발별 밀기(진척도 +), 방어 배분(되돌리기 −), 기지 피해 */
export interface PushPlan {
  readonly pushMilliByFlag: ReadonlyMap<number, number>;
  readonly undoMilliByFlag: ReadonlyMap<number, number>;
  readonly baseDamageByTile: ReadonlyMap<number, ReadonlyMap<number, number>>; // tileId → flagId → dmg
}

// ───────────────────── 봇 자리 (3차) ─────────────────────

export interface BotBrain {
  /** 11단계에서 호출. 반환 명령은 다음 tick 1단계 입력 큐에 들어간다 */
  decide(state: Readonly<GameState>, playerId: number, t: number): C2S_GameCommand[];
}
/** 1차: 아무것도 하지 않는 봇 */
export const IdleBot: BotBrain = { decide: () => [] };

// ───────────────────── 단계 함수 ─────────────────────

/** 2. 자원 생산 — playerId ASC. 병력(√tiles) / 골드(그로스 → 유지비 차감 → 순증) */
export function stage2_produce(state: GameState): void {
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive) continue;
    // 병력 (3.2)
    p.troopsMilli += regenMilliPerTick(p);
    p.troopsMilli = Math.min(p.troopsMilli, troopCap(p) * 1000);
    // 골드 (3.3) — 유지비는 9단계(직전 tick)의 주둔 상태를 읽는다
    const gross = grossGoldMilliPerTick(p);
    const upkeepPm = garrisonUpkeepPermille(state, p);
    const net = gross - Math.floor((gross * upkeepPm) / 1000);
    p.upkeepPm = upkeepPm;
    p.goldMilli += net;
    p.goldEarnedMilli += net;
  }
}

/** 3. 외교·시간 타이머 — 동맹(6.2)은 2차. 1차: 종반 러시 발동, 접속 유예 → 봇 인계, threshold_update */
export function stage3_timers(state: GameState, t: number, out: Outbox): void {
  // (2차) 제안 만료, BREAKING→BROKEN, freeze 해제, lockout 카운트다운
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

/** 4. 깃발 이동 — flagId ASC (2차) */
export function stage4_moveFlags(_state: GameState, _t: number, _out: Outbox): void {
  // 2차: 전진, 노출 소모, MARCHING→ENGAGED, RETURNING 완료, ZOC(tick 시작 스냅숏 기준)
}

/** 4a. 깃발 전투 Phase A — 읽기 전용. 무리 탐색(flagId ASC 시드 BFS), 손실 산출 (2차) */
export function stage4a_flagCombatPhaseA(_state: Readonly<GameState>, _t: number): FlagCombatPlan {
  return { lossMilliByFlag: new Map() };
}

/** 4b. 깃발 전투 Phase B — flagId ASC. 손실 적용, inCombat/routed/blocked/breakaway 갱신 (2차) */
export function stage4b_flagCombatPhaseB(_state: GameState, _plan: FlagCombatPlan, _t: number, _out: Outbox): void {}

/** 5. AP 예산 누적 — flagId ASC, ENGAGED 이고 !inCombat 만. 이후 6·7 동결 (2차) */
export function stage5_accumulateBudget(_state: GameState, _t: number): void {}

/** 6. 전투 Phase A — 읽기 전용. 밀기 산출 + 방어 그리디 배분 (2차) */
export function stage6_combatPhaseA(_state: Readonly<GameState>, _t: number): PushPlan {
  return { pushMilliByFlag: new Map(), undoMilliByFlag: new Map(), baseDamageByTile: new Map() };
}

/** 7. 전투 Phase B — tileId ASC. 진척도·기지 체력 적용, 소유권 이전(setTileOwner), 병력 차감 (2차) */
export function stage7_combatPhaseB(_state: GameState, _plan: PushPlan, _t: number, _out: Outbox): void {}

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

/** 9. 파생 상태 — tiles/goldWeight 는 증분 완료. flagId ASC 로 calmTicks 갱신 (2차) */
export function stage9_derived(_state: GameState, _t: number): void {}

/** 10. 깃발 종료 판정 — 소진/전선 소멸/guard 소멸/중립 자동 전환/IDLE 타임아웃 (2차) */
export function stage10_flagEnd(_state: GameState, _t: number, _out: Outbox): void {}

/** 11. 봇 AI — t % BOT_DECISION_INTERVAL == 0, botIndex(=playerId) ASC. 명령은 다음 tick 큐로 */
export function stage11_bots(state: GameState, t: number, brain: BotBrain): { playerId: number; cmds: C2S_GameCommand[] }[] {
  if (t % BOT_DECISION_INTERVAL !== 0) return [];
  const res: { playerId: number; cmds: C2S_GameCommand[] }[] = [];
  for (let id = 1; id < state.players.length; id++) {
    const p = state.players[id];
    if (!p.alive || !p.botControlled) continue;
    const cmds = brain.decide(state, id, t);
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
    p.troopsMilli = 0;
    p.goldMilli = 0;
    p.goldWeight = 0;
    // 모든 깃발 즉시 소멸 (환불 없음)
    state.flags = state.flags.filter((f) => {
      if (f.ownerId !== id) return true;
      state.changes.flagsGone.push(f.id);
      return false;
    });
    // 모든 동맹 즉시 해제
    state.alliances = state.alliances.filter((a) => a.a !== id && a.b !== id);
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
    stage7_combatPhaseB(state, push, t, out); // 7
    stage8_baseRegen(state, t); // 8
    stage9_derived(state, t); // 9
    stage10_flagEnd(state, t, out); // 10
    for (const { playerId, cmds } of stage11_bots(state, t, this.brain)) {
      for (const c of cmds) this.enqueue(0, playerId, c); // 11 → 다음 tick 입력
    }
    stage12_elimination(state, t, out); // 12
    const gameOver = stage13_victory(state, t); // 13
    stage14_broadcast(state, t, this.tracker, out); // 14
    if (gameOver) out.broadcast.push(gameOver); // 최종 스냅샷 뒤에 game_over
    return out;
  }
}
