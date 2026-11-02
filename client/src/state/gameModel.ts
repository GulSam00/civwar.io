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
  MORALE_MAX,
  SORTIE_INITIAL_MORALE,
  TECH_NODES,
  TECH_STAT,
  TECH_STAT_BASE,
  TROOP_CAP_BASE,
  TROOP_CAP_PER_TILE,
  isClaimable,
  rleDecode,
  techCount,
  techStatValues,
  BASE_PROD_MAX_PERMILLE,
  BASE_PROD_RECOVER_PER_MIN_PERMILLE,
  BASE_DISPATCH_COOLDOWN_TICKS,
  type AllianceSnapshot,
  type AllyProposalSnapshot,
  type BaseSnapshot,
  type FlagSnapshot,
  type FlagState,
  type PlayerSnapshot,
  type ProductionRow,
  type S2C_GameOver,
  type S2C_MapInit,
  type S2C_MatchConfig,
  type S2C_SnapshotDelta,
  type S2C_SnapshotFull,
  type ServerMessage,
  type SpawnInfo,
} from '@civwar/shared';

export { ANY_HOSTILE };

/** v4.3: 플레이어 스탯 (서버 statPm 과 같은 식, 상수는 match_config 우선) */
function techStatsFor(cfg: S2C_MatchConfig | null, mask: number): number[] {
  return techStatValues(mask, constNum(cfg, 'TECH_NODES', TECH_NODES), constNum(cfg, 'TECH_STAT_BASE', TECH_STAT_BASE));
}

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

  // ── v4.4 (§21) 기지 생산력 · 지명 · 생산 내역 · 합병 ──
  /** 지명 (map_init.baseNames, bases 와 같은 순서) — tileId → 이름 */
  baseNames = new Map<number, string>();
  /** 기지 생산력 ‰ 의 마지막 서버 값과 그 tick (보간 기준) — snapshot_full.bases[].prodPm · 델타 baseProd · base_captured.newProdPm */
  baseProd = new Map<number, { pm: number; tick: number }>();
  /**
   * v5.1 (§37.1 [A-5.1-14]) 기지 출전 준비 tick — bases[].dispatchReadyTick 에 둔다 (0 = 즉시 가능).
   * snapshot_full 에만 실려 오므로 사이 구간은 세 규칙으로 유지한다(QA 불변식 1 — 서버 값과 정확히 같다):
   *   flag_issued 의 출발 칸이 기지 → tick + BASE_DISPATCH_COOLDOWN_TICKS · base_captured → 0 · 델타 tileChanges 의 기지 칸(합병 포함) → 0
   * 아래 baseDispatchWait / dispatchReadyOf 로 읽는다.
   */
  /** 플레이어별 생산 내역 (snapshot_full.production 전원 / 델타 production 은 바뀐 플레이어만 통째 교체) */
  production = new Map<number, ProductionRow[]>();
  /** 합병 표시용 — player_eliminated 직후 같은 tick tileChanges 로 넘어간 칸 (렌더러가 잠깐 번쩍인다) */
  annexFlashes: { playerId: number; byPlayerId: number; tick: number; tiles: number[]; at: number }[] = [];
  /**
   * §22.3 깃발 전투 틱당 손실 — 델타 combatLoss 를 tick 별로 쌓는다(렌더러가 꺼내 "−n" 숫자로 띄운다). 최근 20 tick 만 유지.
   * 표시 전용 (병력은 flagStats 가 권위).
   */
  combatLossQueue: { tick: number; losses: [number, number][] }[] = [];
  /** §22.12 IDLE 깃발이 멈춘 이유 (flag_idle.reason — "unreachable" 이면 지도에 "막힘" 태그). 재지정·회수·종료 시 지운다 */
  flagIdleReason = new Map<number, string>();
  /**
   * v4.6 (§27): 이탈 대기가 "태세 전환"으로 열린 깃발 id — flag_posture_changed 와 같은 tick 의
   * flag_disengage_started{auto:false} 가 오면 넣고, flag_disengaged·패주·종료·델타 disengaging=false 에서 뺀다 (호 색·태그 "태세 전환 중").
   */
  disengageForPosture = new Set<number>();
  /**
   * v5.1 (§37.1 F-5): 사기 0 자동 후퇴 중인 깃발 — flag_recalled{reason:"morale"} 에서 넣고, 종료·소멸·다른 사유의 회수·새 발령에서 뺀다.
   * 같은 tick 에 앞서 오는 flag_disengage_started{auto:true} 는 "태세 전환 중"이 아니다(위 disengageForPosture 에 안 들어간다).
   * 스냅숏에는 이 구분이 없어 재접속자는 "귀환·이탈"로만 본다 (§37.1 F-8, 문서대로).
   */
  moraleRetreat = new Set<number>();
  /** flag_posture_changed 를 받은 tick (같은 tick 의 disengage_started 가 태세 전환 때문인지 가리는 용도) */
  private manualPostureTick = new Map<number, number>();
  /** 마지막 tick 을 받은 시각 (performance.now 기준 ms — tick 사이 보간) */
  tickReceivedAt = 0;
  /** 시계 (테스트에서 바꾼다) */
  clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
    this.baseNames = baseNameMap(m.bases, m.baseNames);
    this.ownersVersion++;
    this.version++;
  }

  loadFull(f: S2C_SnapshotFull): void {
    this.owners = rleDecode(f.owners, this.tileCount);
    this.players = new Map(f.players.map((p) => [p.id, { ...p }]));
    this.flags = new Map(f.flags.map((x) => [x.id, { ...x }]));
    for (const id of [...this.flagEta.keys()]) if (this.flags.get(id)?.state !== 'MARCHING') this.flagEta.delete(id);
    for (const id of [...this.disengageForPosture]) if (!this.flags.get(id)?.disengaging) this.disengageForPosture.delete(id);
    for (const id of [...this.flagReturn.keys()]) if (this.flags.get(id)?.state !== 'RETURNING') this.flagReturn.delete(id);
    for (const id of [...this.moraleRetreat]) if (this.flags.get(id)?.state !== 'RETURNING') this.moraleRetreat.delete(id);
    this.bases = new Map(f.bases.map((b) => [b.tileId, { ...b, dispatchReadyTick: b.dispatchReadyTick ?? 0 }]));
    this.baseProd = new Map(f.bases.filter((b) => b.prodPm !== undefined).map((b) => [b.tileId, { pm: b.prodPm!, tick: f.tick }]));
    if (f.production) this.production = new Map(f.production.map((pp) => [pp.playerId, pp.rows]));
    this.alliances = new Map(f.alliances.map((a) => [allianceKey(a.a, a.b), { ...a }]));
    this.proposals = new Map(f.allyProposals.map((p) => [p.proposalId, { ...p }]));
    this.allianceFreezeUntilTick = f.allianceFreezeUntilTick;
    this.lockoutDissolveTick = f.lockoutDissolveTick;
    this.thresholdPct = f.thresholdPct;
    this.endgameRushActive = f.endgameRushActive;
    this.tick = f.tick;
    this.tickReceivedAt = this.clock();
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
          orderCooldownUntilTick: 0,
          disengageUntilTick: null,
          breakaway: false,
          // v4.2 (shared FlagSnapshot 추가 필드) — 이후 snapshot_delta flagFlags(HALTED)·flagReturnBase 가 갱신
          halted: false,
          returnBaseTileId: null,
          // §33: 모델 2 에서만 사기를 싣는다 (새 깃발은 SORTIE_INITIAL_MORALE) — 이후 moraleChanged 가 갱신
          ...(this.config.combatModel === 2 ? { morale: SORTIE_INITIAL_MORALE } : {}),
        });
        this.flagEta.set(e.flagId, e.engageEtaTick ?? e.etaTick);
        {
          // v5.1: 출발 칸이 기지면 그 기지의 출전 쿨타임 시작
          const ob = this.bases.get(e.originTileId);
          if (ob) ob.dispatchReadyTick = e.tick + this.dispatchCooldownTicks;
        }
        this.moraleRetreat.delete(e.flagId);
        break;
      case 'flag_retargeted': {
        const f = this.flags.get(e.flagId);
        if (f) Object.assign(f, { anchorTileId: e.anchorTileId, targetOwnerId: e.targetOwnerId, posture: e.posture, orderCooldownUntilTick: e.cooldownUntilTick });
        if (!e.auto) this.flagEta.set(e.flagId, e.engageEtaTick ?? e.etaTick);
        this.flagIdleReason.delete(e.flagId);
        break;
      }
      case 'flag_posture_changed': {
        const f = this.flags.get(e.flagId);
        // QA I-1: 이벤트의 targetOwnerId 로 덮어쓴다 (§16)
        if (f) Object.assign(f, { posture: e.posture, orderCooldownUntilTick: e.cooldownUntilTick, targetOwnerId: e.targetOwnerId });
        this.manualPostureTick.set(e.flagId, e.tick);
        break;
      }
      case 'flag_disengage_started': {
        const f = this.flags.get(e.flagId);
        if (f) f.disengageUntilTick = e.untilTick;
        // §27.1-4: 수동 전환이 같은 tick 에 이탈 대기를 열었다 → "태세 전환 중" (이미 열린 대기에 전환하면 이벤트가 없어 표식도 없다)
        if (!e.auto && this.manualPostureTick.get(e.flagId) === e.tick) this.disengageForPosture.add(e.flagId);
        else this.disengageForPosture.delete(e.flagId);
        break;
      }
      case 'flag_routed':
        this.flagReturn.set(e.flagId, e.returnTileId);
        {
          const f = this.flags.get(e.flagId);
          if (f) f.disengageUntilTick = null;
        }
        this.disengageForPosture.delete(e.flagId);
        this.setFlagState(e.flagId, 'RETURNING'); // 서버 beginReturn — 패주도 귀환 상태
        break;
      case 'flag_disengaged': {
        // §5: 패주 시 disengageUntilTick = null (m-8), 이탈 완료·무리 소멸도 null
        // reason: broke_away(빠져나감) · combat_over(전투 끝) · wait_over(§27 A-121: 제자리 전환 대기 만료 — 전투에 남음).
        // 호는 어느 경우든 조용히 닫는다 — 클라이언트는 빠져나감 연출을 따로 그리지 않는다.
        const f = this.flags.get(e.flagId);
        if (f) f.disengageUntilTick = null;
        this.disengageForPosture.delete(e.flagId);
        break;
      }
      case 'flag_ended':
        this.moraleRetreat.delete(e.flagId);
        this.disengageForPosture.delete(e.flagId);
        this.manualPostureTick.delete(e.flagId);
        this.flagIdleReason.delete(e.flagId);
        this.flags.delete(e.flagId);
        this.flagEta.delete(e.flagId);
        this.flagReturn.delete(e.flagId);
        break;
      case 'tech_purchased': {
        const p = this.players.get(e.playerId);
        if (p) {
          p.techMask = e.techMask;
          p.techCount = techCount(e.techMask);
          p.flagCap = e.newFlagCap;
        }
        break;
      }
      case 'player_eliminated': {
        const p = this.players.get(e.playerId);
        if (p) p.alive = false;
        this.production.set(e.playerId, []);
        // §21.3: 넘어간 칸은 같은 tick snapshot_delta.tileChanges 로 온다 → applyDelta 가 채운다
        if (e.byPlayerId !== null && (e.annexedTiles ?? 0) > 0) this.annexFlashes.push({ playerId: e.playerId, byPlayerId: e.byPlayerId, tick: e.tick, tiles: [], at: this.clock() });
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
        if (b) Object.assign(b, { ownerId: e.toPlayerId, hpPct: e.newHpPct, dispatchReadyTick: 0 }); // v5.1: 주인이 바뀌면 쿨타임 0
        if (e.newProdPm !== undefined) {
          this.baseProd.set(e.tileId, { pm: e.newProdPm, tick: e.tick });
          if (b) b.prodPm = e.newProdPm;
        }
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
        // v5.1 (§37.1): reason 이 없으면(구 서버) command. morale = 사기 0 자동 후퇴 → 지도 태그 "사기 붕괴" (귀환이 끝날 때까지)
        if ((e.reason ?? 'command') === 'morale') this.moraleRetreat.add(e.flagId);
        else this.moraleRetreat.delete(e.flagId);
        this.flagReturn.set(e.flagId, e.returnTileId);
        this.flagEta.delete(e.flagId);
        this.flagIdleReason.delete(e.flagId); // 주석대로 회수(자동 귀환 포함) 때도 지운다
        this.setFlagState(e.flagId, 'RETURNING');
        break;
      case 'flag_engaged':
        this.flagEta.delete(e.flagId);
        this.setFlagState(e.flagId, 'ENGAGED');
        break;
      case 'flag_idle':
        this.flagEta.delete(e.flagId);
        this.setFlagState(e.flagId, 'IDLE');
        this.flagIdleReason.set(e.flagId, e.reason);
        break;
      case 'flag_stalled':
      case 'flag_progress_lost':
      case 'flag_blocked':
      case 'flag_unblocked':
      case 'combat_started':
      case 'combat_ended':
      case 'emote_broadcast':
      case 'bot_takeover':
        // 표시 피드 전용. 상태 필드(flagFlags/flagTargets)는 snapshot_delta 가 싣는다.
        // (flagStats 의 state 는 1초 주기(t%5==0, 교전 중만 매 tick)라, 상태가 바뀌는 flag_recalled/engaged/idle/routed 는 위에서 즉시 반영한다)
        break;
      default:
        return false;
    }
    this.version++;
    return true;
  }

  /** 이벤트가 알려 준 상태를 flagStats(1초 주기)를 기다리지 않고 바로 반영 — 다음 flagStats 가 오면 서버 값으로 덮어쓴다 */
  private setFlagState(flagId: number, state: FlagState): void {
    const f = this.flags.get(flagId);
    if (f) f.state = state;
  }

  applyDelta(d: S2C_SnapshotDelta): void {
    this.tick = d.tick;
    this.tickReceivedAt = this.clock();
    const flashes = this.annexFlashes.filter((a) => a.tick === d.tick);
    if (this.dirtyTiles.length > this.tileCount) {
      // 렌더러가 소비하지 못하는 동안(탭 숨김 등) 무한히 쌓이지 않게 — 전체 다시 그리기로 전환
      this.dirtyTiles = [];
      this.ownersVersion++;
    }
    for (const [t, o] of d.tileChanges) {
      this.owners[t] = o;
      this.dirtyTiles.push(t);
      for (const a of flashes) if (a.byPlayerId === o) a.tiles.push(t);
      const b = this.bases.get(t);
      if (b) {
        b.ownerId = o;
        b.dispatchReadyTick = 0; // v5.1: 함락·합병·중립화 — 서버 setTileOwner 가 0 으로 둔다
      }
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
    if (d.combatLoss?.length) {
      this.combatLossQueue.push({ tick: d.tick, losses: d.combatLoss });
      if (this.combatLossQueue.length > 20) this.combatLossQueue.splice(0, this.combatLossQueue.length - 20);
    }
    // v4.4 (§21): 기지 생산력 (바뀐 기지만) · 생산 내역 (바뀐 플레이어만 통째 교체)
    for (const [tile, pm] of d.baseProd ?? []) {
      this.baseProd.set(tile, { pm, tick: d.tick });
      const b = this.bases.get(tile);
      if (b) b.prodPm = pm;
    }
    for (const pp of d.production ?? []) this.production.set(pp.playerId, pp.rows);
    for (const id of d.flagsGone) {
      this.moraleRetreat.delete(id);
      this.flags.delete(id);
      this.flagEta.delete(id);
      this.flagReturn.delete(id);
    }
    if (d.thresholdPct !== undefined) this.thresholdPct = d.thresholdPct;
    for (const [id, posture, bits, cd] of d.flagFlags) {
      const f = this.flags.get(id);
      if (!f) continue;
      f.posture = posture;
      f.orderCooldownUntilTick = cd;
      f.inCombat = (bits & FLAG_BIT.IN_COMBAT) !== 0;
      f.routed = (bits & FLAG_BIT.ROUTED) !== 0;
      f.blocked = (bits & FLAG_BIT.BLOCKED) !== 0;
      f.disengaging = (bits & FLAG_BIT.DISENGAGING) !== 0;
      if (!f.disengaging) this.disengageForPosture.delete(id);
      f.breakaway = (bits & FLAG_BIT.BREAKAWAY) !== 0;
      f.stalled = (bits & FLAG_BIT.STALLED) !== 0;
      f.halted = (bits & FLAG_BIT.HALTED) !== 0; // v4.2 4.4a 정지 점령
    }
    // v4.2 [A-61]: 지정 귀환 기지 — 바뀐 깃발만
    for (const [id, base] of d.flagReturnBase ?? []) {
      const f = this.flags.get(id);
      if (f) f.returnBaseTileId = base;
    }
    // §33: 사기 (모델 2, 5 tick 마다 바뀐 깃발만)
    for (const [id, m] of d.moraleChanged ?? []) {
      const f = this.flags.get(id);
      if (f) f.morale = m;
    }
    if (this.allianceFreezeUntilTick !== null && d.tick >= this.allianceFreezeUntilTick) this.allianceFreezeUntilTick = null;
    this.version++;
  }

  // ───────────── 파생값 (표시용) ─────────────

  /** v5.1 기지 출전 쿨타임 tick (match_config.constants 우선, 25 = 5초) */
  get dispatchCooldownTicks(): number {
    return constNum(this.config, 'BASE_DISPATCH_COOLDOWN_TICKS', BASE_DISPATCH_COOLDOWN_TICKS);
  }

  /** 그 기지의 출전 준비 tick (모르면 0) */
  dispatchReadyOf(tile: number): number {
    return this.bases.get(tile)?.dispatchReadyTick ?? 0;
  }

  /** 그 기지가 다시 출전할 수 있을 때까지 남은 tick (0 = 지금 가능) */
  baseDispatchWait(tile: number, tick: number = this.tick): number {
    return Math.max(0, this.dispatchReadyOf(tile) - tick);
  }

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

  flagCapOf(p: Pick<PlayerSnapshot, 'tiles' | 'techMask'>): number {
    const base = constNum(this.config, 'FLAG_CAP_BASE', FLAG_CAP_BASE);
    const per = constNum(this.config, 'FLAG_TILES_PER_SLOT', FLAG_TILES_PER_SLOT);
    const max = constNum(this.config, 'FLAG_CAP_HARD_MAX', FLAG_CAP_HARD_MAX);
    const bonus = techStatsFor(this.config, p.techMask)[TECH_STAT.SLOT_BONUS]; // v4.3: MOB-3A +1
    return Math.min(max, base + Math.floor(p.tiles / per) + bonus);
  }

  /** v5.2 (§38): 출전 중인 깃발 병력 합 — 총병력(대기 + 깃발)이 상한에 닿으면 생산이 멈춘다 */
  deployedTroopsOf(playerId: number): number {
    let n = 0;
    for (const f of this.flags.values()) if (f.ownerId === playerId) n += f.troops;
    return n;
  }

  /** §8 troopCap = floor((100 + 12·tiles) × capPm / 1000), capPm = 영토 테크 */
  troopCapOf(p: Pick<PlayerSnapshot, 'tiles' | 'techMask'>): number {
    const base = constNum(this.config, 'TROOP_CAP_BASE', TROOP_CAP_BASE);
    const per = constNum(this.config, 'TROOP_CAP_PER_TILE', TROOP_CAP_PER_TILE);
    const capPm = techStatsFor(this.config, p.techMask)[TECH_STAT.TROOP_CAP]; // v4.3: TER-2B/3B
    return Math.floor(((base + per * p.tiles) * capPm) / 1000);
  }

  /**
   * 기지 생산력 ‰ 표시값 — 마지막 서버 값에서 회복 속도(분당 BASE_PROD_RECOVER_PER_MIN_PERMILLE)로 앞으로 보간, 상한 BASE_PROD_MAX.
   * tickFloat = 지금 tick + tick 안 경과 비율 (renderTick). 서버 값이 오면 그 값으로 다시 맞춘다(권위).
   */
  baseProdPm(tile: number, tickFloat: number = this.tick): number | null {
    const v = this.baseProd.get(tile);
    if (!v) return null;
    return interpBaseProd(v.pm, tickFloat - v.tick, this.config.tickMs, constNum(this.config, 'BASE_PROD_RECOVER_PER_MIN_PERMILLE', BASE_PROD_RECOVER_PER_MIN_PERMILLE), constNum(this.config, 'BASE_PROD_MAX_PERMILLE', BASE_PROD_MAX_PERMILLE));
  }

  /** 렌더용 연속 tick (마지막 tick + 경과/tickMs, 한 tick 이상 앞서가지 않음) */
  renderTick(now: number = this.clock()): number {
    return this.tick + Math.max(0, Math.min(1, (now - this.tickReceivedAt) / this.config.tickMs));
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
      for (const k of ['tiles', 'troops', 'gold', 'goldWeight', 'upkeepPm', 'flagCap', 'alive', 'connected', 'allyBreaks'] as const) {
        if (m[k] !== p[k]) out.push(`player ${p.id}.${k} 모델 ${m[k]} / full ${p[k]}`);
      }
      if (m.techMask !== p.techMask) out.push(`player ${p.id}.techMask`);
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
      if (b.dispatchReadyTick !== undefined && (m?.dispatchReadyTick ?? 0) !== b.dispatchReadyTick) out.push(`base ${b.tileId}.dispatchReadyTick 모델 ${m?.dispatchReadyTick} / full ${b.dispatchReadyTick}`);
      if (!m || m.hpPct !== b.hpPct || m.ownerId !== b.ownerId) out.push(`base ${b.tileId} 모델 ${JSON.stringify(m)} / full ${JSON.stringify(b)}`);
      // §21.4 생산력: 모델의 마지막 서버 값(보간 전) = full
      if (b.prodPm !== undefined && this.baseProd.get(b.tileId)?.pm !== b.prodPm) out.push(`baseProd ${b.tileId} 모델 ${this.baseProd.get(b.tileId)?.pm} / full ${b.prodPm}`);
    }
    for (const pp of f.production ?? []) {
      const mine = this.production.get(pp.playerId) ?? [];
      if (JSON.stringify(mine) !== JSON.stringify(pp.rows)) out.push(`production ${pp.playerId}`);
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

/** map_init.bases + baseNames → tileId → 이름 (길이가 다르면 있는 만큼만) */
export function baseNameMap(bases: readonly number[], names: readonly string[] | undefined): Map<number, string> {
  const m = new Map<number, string>();
  if (!names) return m;
  bases.forEach((t, i) => {
    const n = names[i];
    if (typeof n === 'string' && n) m.set(t, n);
  });
  return m;
}

/**
 * 생산력 보간: pm + 경과 tick × (분당 회복 ‰ × tickMs / 60000), [pm, max] 안. 서버는 ‰×300 정수 누적 후 floor 라
 * 표시값은 서버보다 최대 1‰ 앞설 수 있다 — 다음 서버 값이 덮어쓴다.
 */
export function interpBaseProd(pm: number, elapsedTicks: number, tickMs: number, perMinPm: number, maxPm: number): number {
  if (pm >= maxPm) return maxPm;
  const v = pm + Math.max(0, elapsedTicks) * ((perMinPm * tickMs) / 60000);
  return Math.min(maxPm, v);
}

export function allianceKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
