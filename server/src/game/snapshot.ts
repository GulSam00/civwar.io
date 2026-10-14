/**
 * 직렬화 (GDD 7.3 / 7.5). 시야 전체 공개 — 플레이어별 필터링 없음.
 */
import {
  BASE_HP_DELTA_INTERVAL,
  FLAG_BIT,
  BASE_HP_MAX_MILLI,
  ENDGAME_RUSH_COST_MULT_PERMILLE,
  ENDGAME_RUSH_TICK,
  HARD_TIMEOUT_TICK,
  PLAYER_DELTA_INTERVAL,
  PRODUCTION_DELTA_INTERVAL,
  POSTURE,
  THRESHOLD_DECAY_PER_MIN_PERMILLE,
  THRESHOLD_DECAY_START,
  THRESHOLD_FLOOR_PCT,
  THRESHOLD_SCALE,
  THRESHOLD_START_PCT,
  TICK_MS,
  rleEncode,
  type FlagSnapshot,
  type FlagState,
  type PlayerDelta,
  type PlayerProduction,
  type PlayerSnapshot,
  type S2C_MapInit,
  type S2C_MatchConfig,
  type S2C_SnapshotDelta,
  type S2C_SnapshotFull,
} from '@civwar/shared';
import * as SHARED from '@civwar/shared';
import { flagCap } from './economy.js';
import { baseProdPm, type Flag, type GameState, type PlayerState } from './state.js';
import { thresholdPct } from './victory.js';

export function hpPct(hpMilli: number): number {
  return Math.floor((hpMilli * 100) / BASE_HP_MAX_MILLI);
}

export function progressPct(progressMilli: number): number {
  return Math.floor(progressMilli / 10);
}

/** shared/constants.ts 의 상수 전체 (함수 제외) */
export function constantsTable(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(SHARED)) {
    if (typeof v === 'function') continue;
    if (/^[A-Z][A-Z0-9_]*$/.test(k)) out[k] = v;
  }
  return out;
}

export function buildMatchConfig(state: Readonly<GameState>): S2C_MatchConfig {
  const m = state.map;
  return {
    type: 'match_config',
    seed: m.seed,
    topology: 'square',
    width: m.width,
    height: m.height,
    totalLandTiles: m.totalLandTiles,
    tickMs: TICK_MS,
    hardTimeoutTick: HARD_TIMEOUT_TICK,
    endgameRush: { tick: ENDGAME_RUSH_TICK, costMultPermille: ENDGAME_RUSH_COST_MULT_PERMILLE },
    thresholdCurve: {
      startPct: THRESHOLD_START_PCT,
      decayStartTick: THRESHOLD_DECAY_START,
      decayPerMinPermille: THRESHOLD_DECAY_PER_MIN_PERMILLE,
      floorPct: THRESHOLD_FLOOR_PCT,
      scale: THRESHOLD_SCALE,
    },
    mapSource: m.source.kind,
    ...(m.source.kind === 'preset' ? { mapId: m.source.mapId } : {}),
    botDifficulty: state.botDifficulty,
    constants: constantsTable(),
  };
}

export function buildMapInit(state: Readonly<GameState>): S2C_MapInit {
  const m = state.map;
  return {
    type: 'map_init',
    terrain: rleEncode(m.terrain),
    spawns: m.spawns.map((s) => ({ playerId: s.playerId, tileId: s.tileId, homeTileId: s.homeTileId })),
    bases: m.baseTiles.slice(),
    baseNames: state.baseNames.slice(),
  };
}

/** v4.4 (§21): milli/tick → milli/초 (TICK_MS 200 → ×5) */
const perSec = (milliPerTick: number): number => Math.floor((milliPerTick * 1000) / TICK_MS);

/** v4.4 (§21): 플레이어 생산 내역 (직전 2단계 정산 state.yields). 탈락자·아직 정산 전 = regions [] */
export function playerProduction(state: Readonly<GameState>, id: number): PlayerProduction {
  const ys = state.players[id]?.alive ? (state.yields[id] ?? []) : [];
  return {
    playerId: id,
    regions: ys.map((y) => ({
      baseTileId: y.baseTileId >= 0 ? y.baseTileId : null,
      tiles: y.tiles,
      prodPm: y.prodPm,
      troopsPerSecMilli: perSec(y.troopsMilli),
      goldGrossPerSecMilli: perSec(y.goldGrossMilli),
      goldNetPerSecMilli: perSec(y.goldNetMilli),
    })),
  };
}

function playerSnap(p: Readonly<PlayerState>): PlayerSnapshot {
  return {
    id: p.id,
    tiles: p.tiles,
    troops: Math.floor(p.troopsMilli / 1000),
    gold: Math.floor(p.goldMilli / 1000),
    goldWeight: p.goldWeight,
    upkeepPm: p.upkeepPm,
    techMask: p.techMask,
    techCount: p.techPurchased,
    flagCap: flagCap(p),
    alive: p.alive,
    connected: p.connected,
  };
}

function playerDelta(p: Readonly<PlayerState>): PlayerDelta {
  return {
    id: p.id,
    tiles: p.tiles,
    troops: Math.floor(p.troopsMilli / 1000),
    gold: Math.floor(p.goldMilli / 1000),
    goldWeight: p.goldWeight,
    upkeepPm: p.upkeepPm,
    techMask: p.techMask,
  };
}

function flagSnap(f: Readonly<Flag>): FlagSnapshot {
  return {
    id: f.id,
    ownerId: f.ownerId,
    slotIndex: f.slotIndex,
    unit: f.unit,
    posture: f.posture,
    troops: Math.floor(f.troopsMilli / 1000),
    posTileId: f.posTileId,
    anchorTileId: f.anchorTileId,
    targetOwnerId: f.targetOwnerId,
    state: f.state,
    targetTileId: f.targetTileId,
    progressPct: progressPct(f.progressMilli),
    stalled: f.stalled,
    inCombat: f.inCombat,
    routed: f.routed,
    blocked: f.blocked,
    disengaging: f.disengageUntilTick !== null,
    postureCooldownUntilTick: f.postureCooldownUntilTick,
    disengageUntilTick: f.disengageUntilTick,
    breakaway: f.breakaway,
    halted: f.halted,
    returnBaseTileId: f.returnBaseTileId,
    pendingPosture: f.pendingPosture,
  };
}

export function buildSnapshotFull(state: Readonly<GameState>): S2C_SnapshotFull {
  const t = state.tick;
  return {
    type: 'snapshot_full',
    tick: t,
    owners: rleEncode(state.owners),
    players: state.players.filter(Boolean).map(playerSnap),
    flags: state.flags.map(flagSnap),
    bases: state.bases.map((b) => ({ tileId: b.tileId, ownerId: state.owners[b.tileId], hpPct: hpPct(b.hpMilli), prodPm: baseProdPm(b) })),
    alliances: state.alliances.map((a) => ({ a: a.a, b: a.b, state: a.state, sinceTick: a.sinceTick, breakAtTick: a.breakAtTick })),
    thresholdPct: thresholdPct(t),
    ticksRemaining: Math.max(0, HARD_TIMEOUT_TICK - t),
    endgameRushActive: state.endgameRushActive,
    allyProposals: state.proposals.map((p) => ({ proposalId: p.id, fromPlayerId: p.from, toPlayerId: p.to, expireTick: p.expireTick })),
    allianceFreezeUntilTick: state.allianceFreezeUntilTick,
    lockoutDissolveTick: state.lockoutDissolveTick,
    production: state.players.filter(Boolean).map((p) => playerProduction(state, p.id)),
  };
}

export function flagBits(f: Readonly<Flag>): number {
  return (
    (f.inCombat ? FLAG_BIT.IN_COMBAT : 0) |
    (f.routed ? FLAG_BIT.ROUTED : 0) |
    (f.blocked ? FLAG_BIT.BLOCKED : 0) |
    (f.disengageUntilTick !== null ? FLAG_BIT.DISENGAGING : 0) |
    (f.breakaway ? FLAG_BIT.BREAKAWAY : 0) |
    (f.stalled ? FLAG_BIT.STALLED : 0) |
    (f.halted ? FLAG_BIT.HALTED : 0) |
    (f.pendingPosture !== null ? FLAG_BIT.POSTURE_PENDING : 0)
  );
}

function flagFlagsKey(f: Readonly<Flag>): string {
  return `${f.posture}|${flagBits(f)}|${f.postureCooldownUntilTick}`;
}

/** 델타용 "마지막으로 보낸 값" 캐시 */
export class DeltaTracker {
  private players = new Map<number, string>();
  private flagPos = new Map<number, number>();
  private flagStat = new Map<number, string>();
  private flagTarget = new Map<number, number | null>();
  private flagFlag = new Map<number, string>();
  private flagProg = new Map<number, number>();
  private flagRetBase = new Map<number, number | null>();
  private baseHp = new Map<number, number>();
  private baseProd = new Map<number, number>();
  private production = new Map<number, string>();
  private threshold = -1;

  constructor(state: Readonly<GameState>) {
    this.resync(state);
  }

  /** snapshot_full 송신 직후 호출 — 캐시를 현재 상태로 맞춘다 */
  resync(state: Readonly<GameState>): void {
    this.players.clear();
    for (const p of state.players) if (p) this.players.set(p.id, JSON.stringify(playerDelta(p)));
    this.flagPos.clear();
    this.flagStat.clear();
    this.flagTarget.clear();
    this.flagFlag.clear();
    this.flagProg.clear();
    this.flagRetBase.clear();
    for (const f of state.flags) {
      this.flagProg.set(f.id, progressPct(f.progressMilli));
      this.flagRetBase.set(f.id, f.returnBaseTileId);
      this.flagFlag.set(f.id, flagFlagsKey(f));
      this.flagPos.set(f.id, f.posTileId);
      this.flagStat.set(f.id, `${Math.floor(f.troopsMilli / 1000)}|${f.state}`);
      this.flagTarget.set(f.id, f.targetTileId);
    }
    this.baseHp.clear();
    for (const b of state.bases) this.baseHp.set(b.tileId, hpPct(b.hpMilli));
    this.baseProd.clear();
    for (const b of state.bases) this.baseProd.set(b.tileId, baseProdPm(b));
    this.production.clear();
    for (const p of state.players) if (p) this.production.set(p.id, JSON.stringify(playerProduction(state, p.id)));
    this.threshold = thresholdPct(state.tick);
  }

  buildDelta(state: Readonly<GameState>): S2C_SnapshotDelta {
    const t = state.tick;
    const d: S2C_SnapshotDelta = {
      type: 'snapshot_delta',
      tick: t,
      tileChanges: state.changes.tileChanges.slice(),
      playerDeltas: [],
      flagMoves: [],
      flagStats: [],
      flagProgress: [],
      flagTargets: [],
      baseHp: [],
      flagsGone: state.changes.flagsGone.slice(),
      flagFlags: [],
      flagReturnBase: [],
      baseProd: [],
      production: [],
    };
    if (t % PLAYER_DELTA_INTERVAL === 0) {
      for (const p of state.players) {
        if (!p) continue;
        const pd = playerDelta(p);
        const key = JSON.stringify(pd);
        if (this.players.get(p.id) !== key) {
          this.players.set(p.id, key);
          d.playerDeltas.push(pd);
        }
      }
    }
    for (const f of state.flags) {
      if (this.flagPos.get(f.id) !== f.posTileId) {
        this.flagPos.set(f.id, f.posTileId);
        d.flagMoves.push([f.id, f.posTileId]);
      }
      // 병력·상태: 1초 주기 — 단 교전 중 깃발은 매 tick (GDD 7.3 "교전 깃발은 매 tick 병력 필드가 델타에 실린다")
      if (t % PLAYER_DELTA_INTERVAL === 0 || f.inCombat || this.flagStat.get(f.id) === undefined) {
        const troops = Math.floor(f.troopsMilli / 1000);
        const key = `${troops}|${f.state}`;
        if (this.flagStat.get(f.id) !== key) {
          this.flagStat.set(f.id, key);
          d.flagStats.push([f.id, troops, f.state as FlagState]);
        }
      }
      // v4.2: progressPct > 0 인 깃발 전부 + ATTACK·(ENGAGED 또는 halted) 깃발은 0 이어도 매 tick, 그리고 0 이 된 tick 1회.
      // → 클라이언트 규칙 "목록에 없는 깃발 = 0" 이 그대로 성립한다 (행군 중 전투로 진척을 유지한 깃발도 실린다)
      const pct = progressPct(f.progressMilli);
      if (pct > 0 || (f.posture === POSTURE.ATTACK && (f.state === 'ENGAGED' || f.halted)) || this.flagProg.get(f.id) !== pct) d.flagProgress.push([f.id, pct]);
      this.flagProg.set(f.id, pct);
      if (this.flagRetBase.has(f.id) ? this.flagRetBase.get(f.id) !== f.returnBaseTileId : f.returnBaseTileId !== null) {
        d.flagReturnBase!.push([f.id, f.returnBaseTileId]);
      }
      this.flagRetBase.set(f.id, f.returnBaseTileId);
      const fk = flagFlagsKey(f);
      if (this.flagFlag.get(f.id) !== fk) {
        this.flagFlag.set(f.id, fk);
        d.flagFlags.push([f.id, f.posture, flagBits(f), f.postureCooldownUntilTick]);
      }
      if (this.flagTarget.get(f.id) !== f.targetTileId) {
        this.flagTarget.set(f.id, f.targetTileId);
        d.flagTargets.push([f.id, f.targetTileId]);
      }
    }
    for (const id of state.changes.flagsGone) {
      this.flagPos.delete(id);
      this.flagStat.delete(id);
      this.flagTarget.delete(id);
      this.flagFlag.delete(id);
      this.flagProg.delete(id);
      this.flagRetBase.delete(id);
    }
    if (t % BASE_HP_DELTA_INTERVAL === 0) {
      for (const b of state.bases) {
        const pct = hpPct(b.hpMilli);
        if (this.baseHp.get(b.tileId) !== pct) {
          this.baseHp.set(b.tileId, pct);
          d.baseHp.push([b.tileId, pct]);
        }
      }
    }
    if (t % BASE_HP_DELTA_INTERVAL === 0) {
      for (const b of state.bases) {
        const pm = baseProdPm(b);
        if (this.baseProd.get(b.tileId) !== pm) {
          this.baseProd.set(b.tileId, pm);
          d.baseProd!.push([b.tileId, pm]);
        }
      }
    }
    if (t % PRODUCTION_DELTA_INTERVAL === 0) {
      for (const p of state.players) {
        if (!p) continue;
        const pp = playerProduction(state, p.id);
        const key = JSON.stringify(pp);
        if (this.production.get(p.id) !== key) {
          this.production.set(p.id, key);
          d.production!.push(pp);
        }
      }
    }
    const th = thresholdPct(t);
    if (th !== this.threshold) {
      this.threshold = th;
      d.thresholdPct = th;
    }
    return d;
  }
}
