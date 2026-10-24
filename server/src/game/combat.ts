/**
 * 깃발 대 깃발 전투 (GDD 4.15) — 4a(Phase A, 읽기 전용) / 4b(Phase B, flagId ASC 적용).
 */
import {
  BASE_COMBAT_DMG_MILLI_PER_TICK,
  COMBAT_BASE_ATK_PERMILLE,
  COMBAT_BASE_DEF_PERMILLE,
  COMBAT_LOSS_BP,
  COMBAT_LOSS_FLOOR_BP,
  COMBAT_MIN_LOSS_MILLI,
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  DISENGAGE_VALUE_PERMILLE,
  MORALE_DROP_DEFEND_PERMILLE,
  MORALE_DROP_PER_TICK,
  MORALE_MAX,
  MORALE_RECOVER,
  MORALE_RECOVER_BASE,
  POSTURE,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  flagScalar,
  sideLossDetail,
  TECH_POINT_PERMILLE,
  techCombatPts,
  techDisengageTicks,
  techMoraleDropPm,
  techMoraleRecoverPm,
  type CombatFlagInput,
} from '@civwar/shared';
import { captureBase } from './basecapture.js';
import { beginReturn } from './flagops.js';
import type { Outbox } from './outbox.js';
import { isAlly, type Flag, type GameState } from './state.js';

export interface CombatSidePlan {
  key: number; // 편 안 최소 ownerId
  ownerIds: number[];
  flagIds: number[]; // ASC
  power: number; // W_s (모델 2: ω 평균 스칼라)
  troopsMilli: number; // 4a 시점 편 병력
  lossMilli: number; // Ls
  /** §33 모델 2 에서만: 편 채널값·손실 비율 ‰·평균 사기 (combat_started 선택 필드의 원천) */
  atk?: number;
  def?: number;
  lossPermille?: number;
  morale?: number;
}
export interface CombatGroupPlan {
  key: number; // 무리 안 최소 flagId
  flagIds: number[]; // ASC
  sides: CombatSidePlan[]; // key ASC
}
/**
 * v4.1 (4.7 e): 4a 스냅숏 — 7c holdProgress 가 읽는다.
 * posOf = 모든 깃발의 4a 위치, ownersAt = presentEnemy(g) = (not routed and troopsMilli > 0) 인 깃발의 타일별 소유자 목록(상태·태세 무관).
 */
export interface FlagPresence {
  readonly posOf: ReadonlyMap<number, number>;
  readonly ownersAt: ReadonlyMap<number, readonly number[]>;
}

export function snapshotPresence(state: Readonly<GameState>): FlagPresence {
  const posOf = new Map<number, number>();
  const ownersAt = new Map<number, number[]>();
  for (const f of state.flags) {
    posOf.set(f.id, f.posTileId);
    if (f.routed || f.troopsMilli <= 0) continue;
    const arr = ownersAt.get(f.posTileId);
    if (arr) arr.push(f.ownerId);
    else ownersAt.set(f.posTileId, [f.ownerId]);
  }
  return { posOf, ownersAt };
}

/** 4a 산출: flagId → 이번 tick 손실(milli). 무리 처리 순서와 무관하게 4b 이전 확정 */
export interface FlagCombatPlan {
  /** v4.1: 4a 스냅숏 (7c 진척도 유지 판정용) */
  readonly presence: FlagPresence;
  readonly lossMilliByFlag: ReadonlyMap<number, number>;
  readonly groups: readonly CombatGroupPlan[];
  readonly groupOf: ReadonlyMap<number, CombatGroupPlan>;
  readonly sideOf: ReadonlyMap<number, number>; // flagId → sideKey
}

export function combatEligible(f: Readonly<Flag>): boolean {
  return !f.routed && f.troopsMilli > 0 && !f.breakaway;
}

export function hostile(state: Readonly<GameState>, a: number, b: number): boolean {
  return a !== b && !isAlly(state, a, b);
}

/** v4.2 [A-62]: 간선의 "공격 쪽" = RETURNING 이 아닌 공격 태세 깃발. 귀환 깃발은 지나가며 싸움을 걸지 않는다 */
export function attackSide(f: Readonly<Flag>): boolean {
  return f.posture === POSTURE.ATTACK && f.state !== 'RETURNING';
}

function engagedPair(state: Readonly<GameState>, f: Readonly<Flag>, g: Readonly<Flag>): boolean {
  // v4.6 (§27) [A]: 전투 중 태세 전환의 이탈 대기(disengageHold) 동안은 상대 태세와 무관하게 간선 유지
  return hostile(state, f.ownerId, g.ownerId) && (attackSide(f) || attackSide(g) || f.disengageHold || g.disengageHold);
}

/** v4.5: 깃발이 자기(소유자) 기지 칸(수도 포함) 위에 서 있는가 — 태세 무관 ×1.5 의 조건 */
export function onOwnBase(state: Readonly<GameState>, f: Readonly<Flag>): boolean {
  const pos = f.posTileId;
  return state.map.isBase[pos] === 1 && state.owners[pos] === f.ownerId;
}

/**
 * 실효 전투값 v(f) (4.15 d·e·g) — permille, 단계마다 floor, 최소 1.
 * v4.5 (사용자 2026-10-15): 내 기지 칸 위면 **태세 무관 ×1.5** [A-106]
 *   - 방어 태세: 지형 항 = COMBAT_BASE_DEF_PERMILLE 1500 (지형 보정을 대체 — 곱하지 않음, v4.4 그대로)
 *   - 공격 태세: floor(UNIT_ATK × COMBAT_BASE_ATK_PERMILLE 1500 / 1000) (공격 태세엔 원래 지형 항이 없다)
 * 2026-10-24: 테크는 점수(techCombatPts) — 병종 기본 ‰ 에 10‰/점을 **더한 뒤** 기지·지형 배율을 곱한다 (공격 COMBAT_ATK + COMBAT_ATK_<unit>, 방어 COMBAT_DEF + COMBAT_DEF_<unit>).
 * v4.5: 물 위 깃발이 없어져 상륙 배율(LANDING_COMBAT) 항 삭제. group 인자는 호출 호환용.
 */
export function flagValue(state: Readonly<GameState>, f: Readonly<Flag>, _group: readonly Readonly<Flag>[]): number {
  if (state.combatModel === 2) return flagScalar(combatInput(state, f)); // §33: 호환 스칼라 (ω 평균, 사기 포함)
  const terrain = state.map.terrain;
  const base = onOwnBase(state, f);
  let v: number;
  const owner = state.players[f.ownerId];
  const pts = TECH_POINT_PERMILLE * techCombatPts(owner.statPm, f.unit, f.posture === POSTURE.DEFEND);
  if (f.posture === POSTURE.ATTACK) {
    v = UNIT_ATK_PERMILLE[f.unit] + pts;
    if (base) v = Math.floor((v * COMBAT_BASE_ATK_PERMILLE) / 1000);
  } else {
    const td = base ? COMBAT_BASE_DEF_PERMILLE : COMBAT_TERRAIN_DEF_POSTURE_PERMILLE[terrain[f.posTileId]];
    v = Math.floor(((UNIT_DEF_PERMILLE[f.unit] + pts) * td) / 1000);
  }
  if (f.disengageUntilTick !== null) v = Math.floor((v * DISENGAGE_VALUE_PERMILLE) / 1000);
  return Math.max(1, v);
}

/**
 * §33 (전투 모델 2): 깃발 -> shared/combatMath 입력. 봇 가상 깃발(troopsMilli·morale 없음)도 받는다 (사기 1000 가정).
 * disengage 를 주면 이탈 대기 여부를 덮어쓴다 (봇의 이탈 3초 손실 추정용).
 */
export function combatInput(state: Readonly<GameState>, f: Readonly<Flag>, disengage?: boolean): CombatFlagInput {
  return {
    unit: f.unit,
    posture: f.posture,
    terrain: state.map.terrain[f.posTileId],
    onOwnBase: onOwnBase(state, f),
    troopsMilli: f.troopsMilli ?? 0,
    morale: f.morale ?? MORALE_MAX,
    disengage: disengage ?? (f.disengageUntilTick !== null && f.disengageUntilTick !== undefined),
    statPm: state.players[f.ownerId].statPm,
  };
}

/**
 * §33 모델 2 전용 (봇 후퇴 판단): 깃발 f 한 개 대 foes(한 편으로 합산)의 이번 tick 정확 손실(milli). 같은 L/T 식, 편 2개.
 * 현행 스칼라 근사(병력 x v)와 달리 sideLossShares 와 같은 참값이다.
 */
export function engageLossPerTick(state: Readonly<GameState>, f: Readonly<Flag>, foes: readonly Readonly<Flag>[], disengageMe?: boolean): { mine: number; foes: number } {
  const all = [f, ...foes];
  let S = 0;
  let R = 0;
  for (const x of all) {
    S += x.troopsMilli;
    R += x.initialTroops * 1000;
  }
  const n = all.length;
  const L = Math.max(Math.floor((S * COMBAT_LOSS_BP) / (n * 10000)), Math.floor((R * COMBAT_LOSS_FLOOR_BP) / (n * 10000)), COMBAT_MIN_LOSS_MILLI);
  const det = sideLossDetail([[combatInput(state, f, disengageMe)], foes.map((g) => combatInput(state, g))], 2 * L);
  return { mine: det[0].lossMilli, foes: det[1].lossMilli };
}

/** 무리 안 소유자들을 isAlly 로 union-find. 편 안에 적대 쌍이 생기면(비이행 동맹) 그 편은 ownerId별로 쪼갠다 [A-12] */
function buildSides(state: Readonly<GameState>, owners: number[]): number[][] {
  const parent = new Map<number, number>();
  for (const o of owners) parent.set(o, o);
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (let i = 0; i < owners.length; i++)
    for (let j = i + 1; j < owners.length; j++)
      if (isAlly(state, owners[i], owners[j])) {
        const a = find(owners[i]);
        const b = find(owners[j]);
        if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
      }
  const comps = new Map<number, number[]>();
  for (const o of owners) {
    const r = find(o);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r)!.push(o);
  }
  const sides: number[][] = [];
  for (const c of comps.values()) {
    let ok = true;
    for (let i = 0; i < c.length && ok; i++) for (let j = i + 1; j < c.length && ok; j++) if (!isAlly(state, c[i], c[j])) ok = false;
    if (ok) sides.push(c);
    else for (const o of c) sides.push([o]);
  }
  for (const s of sides) s.sort((a, b) => a - b);
  sides.sort((a, b) => a[0] - b[0]);
  return sides;
}

/** 4a — 읽기 전용 */
export function stage4a_flagCombatPhaseA(state: Readonly<GameState>, _t: number): FlagCombatPlan {
  const loss = new Map<number, number>();
  const groups: CombatGroupPlan[] = [];
  const groupOf = new Map<number, CombatGroupPlan>();
  const sideOf = new Map<number, number>();
  const index = new Map<number, Flag[]>();
  for (const f of state.flags) {
    if (!combatEligible(f)) continue;
    const arr = index.get(f.posTileId);
    if (arr) arr.push(f);
    else index.set(f.posTileId, [f]);
  }
  const candidates = (f: Readonly<Flag>): Flag[] => {
    const out: Flag[] = [];
    // 사용자 결정 2026-10-11: 깃발 접촉 = 8방향 (topology.contactNeighbors — 사각은 대각선 포함). 지형 무시(깃발은 깊은 물에 서지 않는다)
    const tiles = [f.posTileId, ...state.graph.contactNeighbors(f.posTileId)];
    for (const t of tiles) for (const g of index.get(t) ?? []) if (g !== f && engagedPair(state, f, g)) out.push(g);
    return out;
  };
  const visited = new Set<number>();
  for (const f of state.flags) {
    if (visited.has(f.id) || !combatEligible(f)) continue;
    if (candidates(f).length === 0) continue;
    const comp: Flag[] = [f];
    visited.add(f.id);
    for (let qi = 0; qi < comp.length; qi++) {
      const cs = candidates(comp[qi]).sort((a, b) => a.id - b.id);
      for (const g of cs) {
        if (visited.has(g.id)) continue;
        visited.add(g.id);
        comp.push(g);
      }
    }
    comp.sort((a, b) => a.id - b.id);

    const owners = [...new Set(comp.map((x) => x.ownerId))].sort((a, b) => a - b);
    const sideOwners = buildSides(state, owners);
    const n = comp.length;
    let S = 0;
    let R = 0;
    for (const x of comp) {
      S += x.troopsMilli;
      R += x.initialTroops * 1000;
    }
    const L = Math.max(Math.floor((S * COMBAT_LOSS_BP) / (n * 10000)), Math.floor((R * COMBAT_LOSS_FLOOR_BP) / (n * 10000)), COMBAT_MIN_LOSS_MILLI);
    const T = sideOwners.length * L;

    const sides: CombatSidePlan[] = sideOwners.map((os) => {
      const members = comp.filter((x) => os.includes(x.ownerId));
      let sum = 0;
      let wsum = 0;
      for (const x of members) {
        sum += x.troopsMilli;
        wsum += x.troopsMilli * flagValue(state, x, comp);
      }
      return { key: os[0], ownerIds: os, flagIds: members.map((x) => x.id), power: Math.max(1, Math.floor(wsum / sum)), troopsMilli: sum, lossMilli: 0 };
    });
    if (state.combatModel === 2) {
      // §33: 채널 비교 + ω 합성 (shared/combatMath.sideLossDetail). 총량 T 는 현행과 같다
      const det = sideLossDetail(
        sides.map((s) => comp.filter((x) => s.ownerIds.includes(x.ownerId)).map((x) => combatInput(state, x))),
        T,
      );
      sides.forEach((s, i) => {
        s.lossMilli = det[i].lossMilli;
        s.atk = det[i].atk;
        s.def = det[i].def;
        s.lossPermille = det[i].lossPermille;
        s.morale = det[i].morale;
      });
    } else {
      const inv = sides.map((s) => Math.floor(1_000_000_000 / s.power));
      const sumInv = inv.reduce((a, b) => a + b, 0);
      const raw = inv.map((iv) => Math.floor((T * iv) / sumInv));
      let rem = T - raw.reduce((a, b) => a + b, 0);
      for (let i = 0; rem > 0; i = (i + 1) % sides.length, rem--) raw[i] += 1;
      sides.forEach((s, i) => (s.lossMilli = Math.min(raw[i], s.troopsMilli)));
    }

    // 편 내부: 현재 병력 비례, 잔여 milli 는 (troopsMilli DESC, flagId ASC) 로 1씩 (4.9 정렬표)
    for (const s of sides) {
      const members = comp.filter((x) => s.flagIds.includes(x.id));
      const base = members.map((x) => Math.floor((s.lossMilli * x.troopsMilli) / s.troopsMilli));
      let r = s.lossMilli - base.reduce((a, b) => a + b, 0);
      const order = members.map((x, i) => ({ x, i })).sort((a, b) => b.x.troopsMilli - a.x.troopsMilli || a.x.id - b.x.id);
      for (let k = 0; r > 0; k = (k + 1) % order.length, r--) base[order[k].i] += 1;
      members.forEach((x, i) => {
        loss.set(x.id, Math.min(base[i], x.troopsMilli));
        sideOf.set(x.id, s.key);
      });
    }
    const g: CombatGroupPlan = { key: comp[0].id, flagIds: comp.map((x) => x.id), sides };
    groups.push(g);
    for (const x of comp) groupOf.set(x.id, g);
  }
  return { presence: snapshotPresence(state), lossMilliByFlag: loss, groups, groupOf, sideOf };
}

/** 4b — flagId ASC 적용 */
export function stage4b_flagCombatPhaseB(state: GameState, plan: FlagCombatPlan, t: number, out: Outbox): void {
  const routedNow: number[] = [];
  const brokeAway = new Set<number>();
  for (const f of state.flags) {
    const l = plan.lossMilliByFlag.get(f.id);
    if (l !== undefined) {
      f.troopsMilli -= l;
      state.ledger.combat += l;
      if (l > 0) state.changes.combatLoss.push([f.id, l]); // v4.5 (§22): 델타 combatLoss (flagId ASC — state.flags 순서)
    }
    const inGroup = plan.groupOf.has(f.id);
    if (inGroup && !f.inCombat) f.combatSinceTick = t;
    if (!inGroup) f.combatSinceTick = null;
    f.inCombat = inGroup;
    if (inGroup) f.halted = false; // v4.2 (4.4a c): 전투 우선
  }
  // 패주 (D-3)
  for (const f of state.flags) {
    if (!plan.groupOf.has(f.id) || f.troopsMilli > 0 || f.routed) continue;
    f.troopsMilli = 0;
    f.routed = true;
    if (state.combatModel === 2) f.morale = 0; // §33: 패주 시 사기 0
    f.inCombat = false;
    f.disengageUntilTick = null;
    f.disengageHold = false;
    f.breakaway = false;
    f.blocked = false;
    beginReturn(state, f);
    routedNow.push(f.id);
    out.broadcast.push({ type: 'flag_routed', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
  }
  // v4.2 [A-62]: 전투에 붙잡힌 귀환(비패주) 깃발 → 자동 이탈 대기 (3초, 실효값 ×0.5 — 4.15 g 그대로)
  for (const f of state.flags) {
    if (!f.inCombat || f.state !== 'RETURNING' || f.routed || f.disengageUntilTick !== null || f.breakaway) continue;
    f.disengageUntilTick = t + techDisengageTicks(state.players[f.ownerId].statPm); // v4.5: 소유자 스탯 (MOB-2B 철수 훈련 10)
    out.broadcast.push({ type: 'flag_disengage_started', tick: t, flagId: f.id, untilTick: f.disengageUntilTick, auto: true });
  }
  // 이탈 대기 (4.15 g)
  for (const f of state.flags) {
    if (f.disengageUntilTick === null) continue;
    if (!plan.groupOf.has(f.id)) {
      f.disengageUntilTick = null;
      f.disengageHold = false;
      out.broadcast.push({ type: 'flag_disengaged', tick: t, flagId: f.id, reason: 'combat_over' });
    } else if (t >= f.disengageUntilTick && f.disengageHold && (f.state === 'ENGAGED' || f.state === 'IDLE')) {
      // v4.6 (§27) [A]: 제자리 깃발의 태세 전환 대기 — 만료돼도 빠져나갈 곳이 없다. 대기(×0.5)만 끝나고 전투는 계속 (breakaway 면 영구 면역이 된다)
      f.disengageUntilTick = null;
      f.disengageHold = false;
      out.broadcast.push({ type: 'flag_disengaged', tick: t, flagId: f.id, reason: 'wait_over' });
    } else if (t >= f.disengageUntilTick) {
      f.disengageUntilTick = null;
      f.disengageHold = false;
      f.breakaway = true;
      f.inCombat = false;
      brokeAway.add(f.id);
      out.broadcast.push({ type: 'flag_disengaged', tick: t, flagId: f.id, reason: 'broke_away' });
    }
  }
  // 대치 표시 (4.15 h) — 4단계가 기록한 ZOC 정지
  for (const f of state.flags) {
    const by = state.zocBlocked.get(f.id);
    const nb = by !== undefined && !f.inCombat && !f.routed;
    if (nb === f.blocked) continue;
    f.blocked = nb;
    if (nb) out.broadcast.push({ type: 'flag_blocked', tick: t, flagId: f.id, byFlagIds: by! });
    else out.broadcast.push({ type: 'flag_unblocked', tick: t, flagId: f.id });
  }
  if (state.combatModel === 2) {
    stage4c_updateMorale(state, new Set(routedNow)); // §33: 4b 끝, flagId ASC
    stage4d_baseCombatWear(state, t, out);
  }
  trackCombatEvents(state, plan, routedNow, brokeAway, t, out);
}

/**
 * §33 사기 갱신 (모델 2 전용, 4b 마지막 — inCombat 이 확정된 뒤, flagId ASC, 정수 ‰).
 * 교전 중: -drop(unit) (방어 태세는 ×0.5) · 비전투: +3, 자기 기지 칸 위 +10. 이번 tick 패주한 깃발은 건너뛴다(0 유지).
 */
export function stage4c_updateMorale(state: GameState, skip: ReadonlySet<number>): void {
  for (const f of state.flags) {
    if (skip.has(f.id)) continue;
    const stat = state.players[f.ownerId].statPm;
    if (f.inCombat) {
      const drop = Math.max(1, Math.floor((MORALE_DROP_PER_TICK[f.unit] * techMoraleDropPm(stat, f.unit)) / 1000));
      const dropPosture = f.posture === POSTURE.DEFEND ? Math.max(1, Math.ceil((drop * MORALE_DROP_DEFEND_PERMILLE) / 1000)) : drop; // 패치 2차 [A]: 방어 태세는 절반(올림)
      f.morale = Math.max(0, f.morale - dropPosture);
    } else {
      const rec = Math.floor(((onOwnBase(state, f) ? MORALE_RECOVER_BASE : MORALE_RECOVER) * techMoraleRecoverPm(stat, f.unit)) / 1000);
      f.morale = Math.min(MORALE_MAX, f.morale + rec);
    }
  }
}

/**
 * 2026-10-24 [A] 모델 2: 자기 기지 칸 위에서 교전 중인 방어 깃발이 있으면 그 기지의 체력이 tick 마다 고정량 깎인다(기지당 1회 — 깃발 수·승패 무관).
 * 패치 3차 (사용자 확정): 깃발이 서 있어도 체력이 0 이 되면 기지는 함락된다 — 차지하는 쪽 = 그 칸과 접촉한 교전 중 적대 깃발 가운데 병력이 가장 큰 깃발의 주인
 * (동률 flagId 작은 쪽). 그런 깃발이 없으면 체력은 1 에서 멈춘다.
 * 피해 기록(lastDamageTick·damagedThisTick)을 남겨 체력 회복 지연·봇 기지 위협 판단이 그대로 작동한다.
 */
export function stage4d_baseCombatWear(state: GameState, t: number, out: Outbox): void {
  const worn = new Set<number>();
  for (const f of state.flags) {
    if (!f.inCombat || f.routed || !onOwnBase(state, f) || worn.has(f.posTileId)) continue;
    const B = f.posTileId;
    worn.add(B);
    const b = state.bases[state.baseIndexOf.get(B)!];
    if (b.hpMilli <= 0) continue;
    const taker = baseTaker(state, B, f.ownerId);
    b.hpMilli = Math.max(taker ? 0 : 1, b.hpMilli - BASE_COMBAT_DMG_MILLI_PER_TICK);
    b.lastDamageTick = t;
    b.damagedThisTick = true;
    if (b.hpMilli <= 0 && taker) captureBase(state, B, taker.ownerId, t, out);
  }
}

/** 교전 소모로 함락될 때 기지를 차지할 깃발: B 칸과 접촉(같은 칸 포함)한 교전 중 적대 깃발 중 병력 최대 (동률 flagId ASC) */
function baseTaker(state: Readonly<GameState>, B: number, ownerId: number): Flag | null {
  const near = new Set<number>([B, ...state.graph.contactNeighbors(B)]);
  let best: Flag | null = null;
  for (const g of state.flags) {
    if (!g.inCombat || !combatEligible(g) || !near.has(g.posTileId) || !hostile(state, g.ownerId, ownerId)) continue;
    if (!best || g.troopsMilli > best.troopsMilli || (g.troopsMilli === best.troopsMilli && g.id < best.id)) best = g;
  }
  return best;
}

/** combat_started / combat_ended (표시 전용 — 규칙에 영향 없음) */
function trackCombatEvents(state: GameState, plan: FlagCombatPlan, routedNow: number[], brokeAway: Set<number>, t: number, out: Outbox): void {
  const routedSet = new Set(routedNow);
  const seen = new Set<object>();
  const next: typeof state.combats = [];
  const alive = new Set(state.flags.map((f) => f.id));
  for (const g of plan.groups) {
    const matched = state.combats.filter((r) => g.flagIds.some((id) => r.flagIds.has(id)));
    for (const r of matched) seen.add(r);
    const rec = { key: g.key, flagIds: new Set<number>(), routed: [] as number[] };
    // 3차-2 수정: 여러 기록이 합쳐질 때 routed 를 중복 없이 합친다 (중복 누적 → 배열 폭증 → spread 스택 초과)
    const routedUnion = new Set<number>();
    for (const r of matched) {
      for (const id of r.flagIds) rec.flagIds.add(id);
      for (const id of r.routed) routedUnion.add(id);
    }
    rec.routed.push(...routedUnion);
    const joined = matched.length === 0 || g.flagIds.some((id) => !rec.flagIds.has(id));
    for (const id of g.flagIds) rec.flagIds.add(id);
    if (joined) {
      out.broadcast.push({
        type: 'combat_started',
        tick: t,
        groupKey: g.key,
        flagIds: g.flagIds.slice(),
        sides: g.sides.map((s) => ({
          sideKey: s.key,
          ownerIds: s.ownerIds.slice(),
          troops: Math.floor(s.troopsMilli / 1000),
          power: s.power,
          ...(state.combatModel === 2 ? { atk: s.atk, def: s.def, lossPermille: s.lossPermille, morale: s.morale } : {}),
        })),
      });
    }
    for (const id of g.flagIds) if (routedSet.has(id) && !routedUnion.has(id)) rec.routed.push(id);
    const survivorSides = new Set<number>();
    for (const id of g.flagIds) if (alive.has(id) && !routedSet.has(id) && !brokeAway.has(id)) survivorSides.add(plan.sideOf.get(id)!);
    if (survivorSides.size <= 1) {
      rec.routed.sort((a, b) => a - b);
      out.broadcast.push({ type: 'combat_ended', tick: t, groupKey: g.key, winnerSideKey: survivorSides.size ? [...survivorSides][0] : null, routedFlagIds: rec.routed });
    } else next.push(rec);
  }
  for (const r of state.combats) {
    if (seen.has(r)) continue;
    r.routed.sort((a, b) => a - b);
    out.broadcast.push({ type: 'combat_ended', tick: t, groupKey: r.key, winnerSideKey: null, routedFlagIds: r.routed });
  }
  state.combats = next;
}
