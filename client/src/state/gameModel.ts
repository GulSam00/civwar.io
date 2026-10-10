/**
 * 인게임 상태 리듀서 — 서버 상태의 거울.
 *
 * 프로토콜(_workspace/02_backend_protocol.md §5)대로:
 *   부트스트랩: match_config → map_init → snapshot_full (개인 또는 룸, 시작 tick 0)
 *   매 tick: 이벤트 → snapshot_delta → (t % 25 == 0 이면) snapshot_full 로 덮어쓰기
 * 참조 구현: server/scripts/qa-headless.ts 「프론트 재구성 모델」 (snapshot_full 과 불일치 0 달성).
 *
 * 렌더 루프와 분리: 이 모델은 메시지가 올 때만 바뀌고, 렌더러는 rAF 에서 읽기만 한다.
 * 렌더러가 증분 갱신을 할 수 있도록 ownersVersion / dirtyTiles 를 노출한다.
 * 클라이언트 예측 없음 — 모든 값은 서버 메시지로만 바뀐다.
 */
import {
  ANY_HOSTILE,
  FLAG_BIT,
  FLAG_CAP_BASE,
  FLAG_CAP_HARD_MAX,
  FLAG_TILES_PER_SLOT,
  MOB_SLOT_BONUS_BY_TIER,
  TER_CAP_PERMILLE_BY_TIER,
  TROOP_CAP_BASE,
  TROOP_CAP_PER_TILE,
  isClaimable,
  rleDecode,
  type AllianceSnapshot,
  type AllyProposalSnapshot,
  type BaseSnapshot,
  type FlagSnapshot,
  type PlayerSnapshot,
  type S2C_GameOver,
  type S2C_MapInit,
  type S2C_MatchConfig,
  type S2C_SnapshotDelta,
  type S2C_SnapshotFull,
  type ServerMessage,
  type SpawnInfo,
} from '@civwar/shared';

export { ANY_HOSTILE };

/** match_config.constants 우선, 없으면 shared 상수 (프로토콜 §5 "서버가 보낸 값을 우선") */
function constNum<T>(cfg: S2C_MatchConfig | null, name: string, fallback: T): T {
  const v = cfg?.constants?.[name];
  return (v === undefined ? fallback : v) as T;
}

export class GameModel {
  readonly config: S2C_MatchConfig;
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;

  terrain: Uint8Array | null = null;
  spawns: SpawnInfo[] = [];
  /** 기지 타일 (tileId ASC, 매치 동안 불변) */
  baseTiles: number[] = [];
  capitalTiles = new Set<number>();

  owners: Uint8Array;
  players = new Map<number, PlayerSnapshot>();
  flags = new Map<number, FlagSnapshot>();
  bases = new Map<number, BaseSnapshot>();
  alliances = new Map<string, AllianceSnapshot>();
  proposals = new Map<number, AllyProposalSnapshot>();
  allianceFreezeUntilTick: number | null = null;
  lockoutDissolveTick: number | null = null;
  thresholdPct: number;
  endgameRushActive = false;
  tick = 0;
  gameOver: S2C_GameOver | null = null;
  /**
   * 교전 개시 추정 tick (flag_issued / flag_retargeted.engageEtaTick — 서버 MARCHING 도착 판정 기준 추정, ZOC·전투 무시.
   * 구버전 서버면 etaTick(앵커 도착)으로 대체).
   * snapshot 에는 없는 표시 전용 값이라 이벤트로만 유지하고, 행군이 아니게 되면 지운다.
   */
  flagEta = new Map<number, number>();
  /** 귀환 목적지 (flag_recalled / flag_routed.returnTileId — 표시 전용, 이동 방향 화살표) */
  flagReturn = new Map<number, number>();

  /** snapshot_full 을 1회 이상 받았는가 — 그 전에는 delta 를 적용하지 않는다 */
  ready = false;

  // ── 렌더러용 변경 신호 ──
  /** owners 가 통째로 바뀌면(full) 증가 */
  ownersVersion = 0;
  /** 증분 변경 타일 (렌더러가 소비 후 비운다). ownersVersion 이 바뀌면 무시하고 전체 다시 그림 */
  dirtyTiles: number[] = [];
  /** 아무 상태나 바뀌면 증가 (HUD 갱신 판단) */
  version = 0;

  constructor(config: S2C_MatchConfig) {
    this.config = config;
    this.width = config.width;
    this.height = config.height;
    this.tileCount = config.width * config.height;
    this.owners = new Uint8Array(this.tileCount);
    this.thresholdPct = config.thresholdCurve.startPct;
  }

  // ───────────── 부트스트랩 ─────────────

  applyMapInit(m: S2C_MapInit): void {
    this.terrain = rleDecode(m.terrain, this.tileCount);
    this.spawns = m.spawns;
    this.baseTiles = [...m.bases];
    this.capitalTiles = new Set(m.spawns.map((s) => s.homeTileId));
    this.ownersVersion++;
    this.version++;
  }

  loadFull(f: S2C_SnapshotFull): void {
    this.owners = rleDecode(f.owners, this.tileCount);
    this.players = new Map(f.players.map((p) => [p.id, { ...p, tech: [...p.tech] as PlayerSnapshot['tech'] }]));
    this.flags = new Map(f.flags.map((x) => [x.id, { ...x }]));
    for (const id of [...this.flagEta.keys()]) if (this.flags.get(id)?.state !== 'MARCHING') this.flagEta.delete(id);
    for (const id of [...this.flagReturn.keys()]) if (this.flags.get(id)?.state !== 'RETURNING') this.flagReturn.delete(id);
    this.bases = new Map(f.bases.map((b) => [b.tileId, { ...b }]));
    this.alliances = new Map(f.alliances.map((a) => [allianceKey(a.a, a.b), { ...a }]));
    this.proposals = new Map(f.allyProposals.map((p) => [p.proposalId, { ...p }]));
    this.allianceFreezeUntilTick = f.allianceFreezeUntilTick;
    this.lockoutDissolveTick = f.lockoutDissolveTick;
    this.thresholdPct = f.thresholdPct;
    this.endgameRushActive = f.endgameRushActive;
    this.tick = f.tick;
    this.ready = true;
    this.ownersVersion++;
    this.dirtyTiles = [];
    this.version++;
  }

  // ───────────── 메시지 디스패치 ─────────────

  /** 게임 상태 메시지를 적용한다. 처리했으면 true (모르는 type 은 무시 — 전방 호환) */
  apply(msg: ServerMessage): boolean {
    switch (msg.type) {
      case 'map_init':
        this.applyMapInit(msg);
        return true;
      case 'snapshot_full':
        this.loadFull(msg);
        return true;
      case 'snapshot_delta':
        if (this.ready) this.applyDelta(msg);
        return true;
      case 'game_over':
        this.gameOver = msg;
        this.version++;
        return true;
      default:
        if (!this.ready) return false;
        return this.applyEvent(msg);
    }
  }

  applyEvent(e: ServerMessage): boolean {
    switch (e.type) {
      case 'flag_issued':
        this.flags.set(e.flagId, {
          id: e.flagId,
          ownerId: e.playerId,
          slotIndex: e.slotIndex,
          unit: e.unit,
          posture: e.posture,
          troops: e.troops,
          posTileId: e.originTileId,
          anchorTileId: e.anchorTileId,
          targetOwnerId: e.targetOwnerId,
          state: 'MARCHING',
          targetTileId: null,
          progressPct: 0,
          stalled: false,
          inCombat: false,
          routed: false,
          blocked: false,
          disengaging: false,
          postureCooldownUntilTick: 0,
          disengageUntilTick: null,
          breakaway: false,
        });
        this.flagEta.set(e.flagId, e.engageEtaTick ?? e.etaTick);
        break;
      case 'flag_retargeted': {
        const f = this.flags.get(e.flagId);
        if (f) Object.assign(f, { anchorTileId: e.anchorTileId, targetOwnerId: e.targetOwnerId, posture: e.posture });
        if (!e.auto) this.flagEta.set(e.flagId, e.engageEtaTick ?? e.etaTick);
        break;
      }
      case 'flag_posture_changed': {
        const f = this.flags.get(e.flagId);
        // QA I-1: 이벤트의 targetOwnerId 로 덮어쓴다 (§16)
        if (f) Object.assign(f, { posture: e.posture, postureCooldownUntilTick: e.cooldownUntilTick, targetOwnerId: e.targetOwnerId });
        break;
      }
      case 'flag_disengage_started': {
        const f = this.flags.get(e.flagId);
        if (f) f.disengageUntilTick = e.untilTick;
        break;
      }
      case 'flag_routed':
        this.flagReturn.set(e.flagId, e.returnTileId);
        {
          const f = this.flags.get(e.flagId);
          if (f) f.disengageUntilTick = null;
        }
        break;
      case 'flag_disengaged': {
        // §5: 패주 시 disengageUntilTick = null (m-8), 이탈 완료·무리 소멸도 null
        const f = this.flags.get(e.flagId);
        if (f) f.disengageUntilTick = null;
        break;
      }
      case 'flag_ended':
        this.flags.delete(e.flagId);
        this.flagEta.delete(e.flagId);
        this.flagReturn.delete(e.flagId);
        break;
      case 'tech_purchased': {
        const p = this.players.get(e.playerId);
        if (p) {
          p.tech[e.axis] = e.tier;
          p.flagCap = e.newFlagCap;
        }
        break;
      }
      case 'player_eliminated': {
        const p = this.players.get(e.playerId);
        if (p) p.alive = false;
        break;
      }
      case 'player_reconnected': {
        const p = this.players.get(e.playerId);
        if (p) p.connected = true;
        break;
      }
      case 'endgame_rush':
        this.endgameRushActive = true;
        break;
      case 'threshold_update':
        this.thresholdPct = e.thresholdPct;
        break;
      case 'base_captured': {
        const b = this.bases.get(e.tileId);
        if (b) Object.assign(b, { ownerId: e.toPlayerId, hpPct: e.newHpPct });
        break;
      }
      case 'ally_formed':
        this.alliances.set(allianceKey(e.a, e.b), { a: e.a, b: e.b, state: 'ACTIVE', sinceTick: e.tick, breakAtTick: null });
        break;
      case 'ally_break_started': {
        const a = this.alliances.get(allianceKey(e.a, e.b));
        if (a) Object.assign(a, { state: 'BREAKING', breakAtTick: e.breakAtTick });
        break;
      }
      case 'ally_broken':
        this.alliances.delete(allianceKey(e.a, e.b));
        break;
      case 'ally_proposed':
        this.proposals.set(e.proposalId, { proposalId: e.proposalId, fromPlayerId: e.fromPlayerId, toPlayerId: e.toPlayerId, expireTick: e.expireTick });
        break;
      case 'ally_proposal_closed':
        this.proposals.delete(e.proposalId);
        break;
      case 'alliance_lockout':
        this.lockoutDissolveTick = e.phase === 'countdown' ? e.forceDissolveTick : null;
        if (e.phase === 'dissolved') this.allianceFreezeUntilTick = e.freezeUntilTick;
        break;
      case 'flag_recalled':
        this.flagReturn.set(e.flagId, e.returnTileId);
        this.flagEta.delete(e.flagId);
        break;
      case 'flag_engaged':
      case 'flag_idle':
        this.flagEta.delete(e.flagId);
        break;
      case 'flag_stalled':
      case 'flag_progress_lost':
      case 'flag_blocked':
      case 'flag_unblocked':
      case 'combat_started':
      case 'combat_ended':
      case 'emote_broadcast':
      case 'bot_takeover':
        // 상태 필드는 같은 tick 의 snapshot_delta(flagStats/flagFlags/flagTargets)가 싣는다 — 표시 피드 전용
        break;
      default:
        return false;
    }
    this.version++;
    return true;
  }

  applyDelta(d: S2C_SnapshotDelta): void {
    this.tick = d.tick;
    if (this.dirtyTiles.length > this.tileCount) {
      // 렌더러가 소비하지 못하는 동안(탭 숨김 등) 무한히 쌓이지 않게 — 전체 다시 그리기로 전환
      this.dirtyTiles = [];
      this.ownersVersion++;
    }
    for (const [t, o] of d.tileChanges) {
      this.owners[t] = o;
      this.dirtyTiles.push(t);
      const b = this.bases.get(t);
      if (b) b.ownerId = o;
    }
    for (const pd of d.playerDeltas) {
      const p = this.players.get(pd.id);
      if (!p) continue;
      Object.assign(p, pd);
      // flagCap = 문서 §8 식 (tiles 가 바뀌면 같이 바뀐다)
      p.flagCap = this.flagCapOf(p);
    }
    for (const [id, pos] of d.flagMoves) {
      const f = this.flags.get(id);
      if (f) f.posTileId = pos;
    }
    for (const [id, troops, state] of d.flagStats) {
      const f = this.flags.get(id);
      if (f) Object.assign(f, { troops, state });
    }
    // §5: flagProgress = ATTACK·ENGAGED 깃발 "전부" (매 tick) → 목록에 없으면 0
    const prog = new Map<number, number>(d.flagProgress);
    for (const f of this.flags.values()) f.progressPct = prog.get(f.id) ?? 0;
    for (const [id, tt] of d.flagTargets) {
      const f = this.flags.get(id);
      if (f) f.targetTileId = tt;
    }
    for (const [tile, hp] of d.baseHp) {
      const b = this.bases.get(tile);
      if (b) b.hpPct = hp;
    }
    for (const id of d.flagsGone) {
      this.flags.delete(id);
      this.flagEta.delete(id);
      this.flagReturn.delete(id);
    }
    if (d.thresholdPct !== undefined) this.thresholdPct = d.thresholdPct;
    for (const [id, posture, bits, cd] of d.flagFlags) {
      const f = this.flags.get(id);
      if (!f) continue;
      f.posture = posture;
      f.postureCooldownUntilTick = cd;
      f.inCombat = (bits & FLAG_BIT.IN_COMBAT) !== 0;
      f.routed = (bits & FLAG_BIT.ROUTED) !== 0;
      f.blocked = (bits & FLAG_BIT.BLOCKED) !== 0;
      f.disengaging = (bits & FLAG_BIT.DISENGAGING) !== 0;
      f.breakaway = (bits & FLAG_BIT.BREAKAWAY) !== 0;
      f.stalled = (bits & FLAG_BIT.STALLED) !== 0;
    }
    if (this.allianceFreezeUntilTick !== null && d.tick >= this.allianceFreezeUntilTick) this.allianceFreezeUntilTick = null;
    this.version++;
  }

  // ───────────── 파생값 (표시용) ─────────────

  get ticksRemaining(): number {
    return Math.max(0, this.config.hardTimeoutTick - this.tick);
  }

  isLand(t: number): boolean {
    return this.terrain !== null && isClaimable(this.terrain[t]);
  }

  isAlly(a: number, b: number): boolean {
    if (a === b || a === 0 || b === 0) return false;
    return this.alliances.has(allianceKey(a, b));
  }

  flagCapOf(p: Pick<PlayerSnapshot, 'tiles' | 'tech'>): number {
    const base = constNum(this.config, 'FLAG_CAP_BASE', FLAG_CAP_BASE);
    const per = constNum(this.config, 'FLAG_TILES_PER_SLOT', FLAG_TILES_PER_SLOT);
    const max = constNum(this.config, 'FLAG_CAP_HARD_MAX', FLAG_CAP_HARD_MAX);
    const bonus = constNum<readonly number[]>(this.config, 'MOB_SLOT_BONUS_BY_TIER', MOB_SLOT_BONUS_BY_TIER);
    return Math.min(max, base + Math.floor(p.tiles / per) + bonus[p.tech[3]]);
  }

  /** §8 troopCap = floor((100 + 12·tiles) × capPm / 1000), capPm = 영토 테크 */
  troopCapOf(p: Pick<PlayerSnapshot, 'tiles' | 'tech'>): number {
    const base = constNum(this.config, 'TROOP_CAP_BASE', TROOP_CAP_BASE);
    const per = constNum(this.config, 'TROOP_CAP_PER_TILE', TROOP_CAP_PER_TILE);
    const capPm = constNum<readonly number[]>(this.config, 'TER_CAP_PERMILLE_BY_TIER', TER_CAP_PERMILLE_BY_TIER)[p.tech[2]];
    return Math.floor(((base + per * p.tiles) * capPm) / 1000);
  }

  flagsOf(playerId: number): FlagSnapshot[] {
    const out: FlagSnapshot[] = [];
    for (const f of this.flags.values()) if (f.ownerId === playerId) out.push(f);
    return out;
  }

  /** 디버그: 현재 모델과 snapshot_full 의 차이 목록 (loadFull 직전에 호출) */
  diffAgainstFull(f: S2C_SnapshotFull): string[] {
    const out: string[] = [];
    const owners = rleDecode(f.owners, this.tileCount);
    let od = 0;
    for (let i = 0; i < owners.length; i++) if (owners[i] !== this.owners[i]) od++;
    if (od) out.push(`owners ${od}칸`);
    for (const p of f.players) {
      const m = this.players.get(p.id);
      if (!m) {
        out.push(`player ${p.id} 없음`);
        continue;
      }
      for (const k of ['tiles', 'troops', 'gold', 'goldWeight', 'upkeepPm', 'flagCap', 'alive', 'connected'] as const) {
        if (m[k] !== p[k]) out.push(`player ${p.id}.${k} 모델 ${m[k]} / full ${p[k]}`);
      }
      if (m.tech.join() !== p.tech.join()) out.push(`player ${p.id}.tech`);
    }
    const ids = new Set([...this.flags.keys(), ...f.flags.map((x) => x.id)]);
    for (const id of ids) {
      const a = this.flags.get(id);
      const b = f.flags.find((x) => x.id === id);
      if (!a || !b) {
        out.push(`flag ${id} 존재 모델 ${!!a} / full ${!!b}`);
        continue;
      }
      for (const k of Object.keys(b) as (keyof FlagSnapshot)[]) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`flag ${id}.${k} 모델 ${JSON.stringify(a[k])} / full ${JSON.stringify(b[k])}`);
      }
    }
    for (const b of f.bases) {
      const m = this.bases.get(b.tileId);
      if (!m || m.hpPct !== b.hpPct || m.ownerId !== b.ownerId) out.push(`base ${b.tileId} 모델 ${JSON.stringify(m)} / full ${JSON.stringify(b)}`);
    }
    const al = [...this.alliances.values()].sort((x, y) => x.a - y.a || x.b - y.b);
    if (JSON.stringify(al) !== JSON.stringify(f.alliances)) out.push(`alliances 모델 ${JSON.stringify(al)} / full ${JSON.stringify(f.alliances)}`);
    const pr = [...this.proposals.values()].sort((x, y) => x.proposalId - y.proposalId);
    if (JSON.stringify(pr) !== JSON.stringify(f.allyProposals)) out.push(`allyProposals`);
    if (this.allianceFreezeUntilTick !== f.allianceFreezeUntilTick) out.push(`allianceFreezeUntilTick ${this.allianceFreezeUntilTick} / ${f.allianceFreezeUntilTick}`);
    if (this.lockoutDissolveTick !== f.lockoutDissolveTick) out.push(`lockoutDissolveTick ${this.lockoutDissolveTick} / ${f.lockoutDissolveTick}`);
    if (this.thresholdPct !== f.thresholdPct) out.push(`thresholdPct ${this.thresholdPct} / ${f.thresholdPct}`);
    if (this.endgameRushActive !== f.endgameRushActive) out.push('endgameRushActive');
    if (this.tick !== f.tick) out.push(`tick ${this.tick} / ${f.tick}`);
    if (this.ticksRemaining !== f.ticksRemaining) out.push(`ticksRemaining ${this.ticksRemaining} / ${f.ticksRemaining}`);
    return out;
  }
}

export function allianceKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
