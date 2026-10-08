/**
 * 깃발 대 깃발 전투 (GDD 4.15) — 4a(Phase A, 읽기 전용) / 4b(Phase B, flagId ASC 적용).
 */
import {
  COMBAT_LOSS_BP,
  COMBAT_LOSS_FLOOR_BP,
  COMBAT_MIN_LOSS_MILLI,
  COMBAT_TERRAIN_DEF_POSTURE_PERMILLE,
  COMBAT_WATER_VS_LAND_PERMILLE,
  COMBAT_WATER_VS_WATER_PERMILLE,
  DISENGAGE_VALUE_PERMILLE,
  MIL_COMBAT_PERMILLE_BY_TIER,
  POSTURE,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  isClaimable,
} from '@civwar/shared';
import { beginReturn } from './flagops.js';
import type { Outbox } from './outbox.js';
import { militaryTier, mobilityTier } from './rules.js';
import { isAlly, type Flag, type GameState } from './state.js';

export interface CombatSidePlan {
  key: number; // 편 안 최소 ownerId
  ownerIds: number[];
  flagIds: number[]; // ASC
  power: number; // W_s
  troopsMilli: number; // 4a 시점 편 병력
  lossMilli: number; // Ls
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

function engagedPair(state: Readonly<GameState>, f: Readonly<Flag>, g: Readonly<Flag>): boolean {
  return hostile(state, f.ownerId, g.ownerId) && (f.posture === POSTURE.ATTACK || g.posture === POSTURE.ATTACK);
}

/** 실효 전투값 v(f) (4.15 d·e·g) — permille, 단계마다 floor, 최소 1 */
export function flagValue(state: Readonly<GameState>, f: Readonly<Flag>, group: readonly Readonly<Flag>[]): number {
  const terrain = state.map.terrain;
  let v: number;
  if (f.posture === POSTURE.ATTACK) v = UNIT_ATK_PERMILLE[f.unit];
  else {
    const td = isClaimable(terrain[f.posTileId]) ? COMBAT_TERRAIN_DEF_POSTURE_PERMILLE[terrain[f.posTileId]] : 1000;
    v = Math.floor((UNIT_DEF_PERMILLE[f.unit] * td) / 1000);
  }
  const owner = state.players[f.ownerId];
  v = Math.floor((v * MIL_COMBAT_PERMILLE_BY_TIER[militaryTier(owner)]) / 1000);
  let wm = 1000;
  if (!isClaimable(terrain[f.posTileId])) {
    const vsLand = group.some((g) => hostile(state, f.ownerId, g.ownerId) && isClaimable(terrain[g.posTileId]));
    wm = vsLand ? COMBAT_WATER_VS_LAND_PERMILLE[mobilityTier(owner)] : COMBAT_WATER_VS_WATER_PERMILLE[mobilityTier(owner)];
  }
  v = Math.floor((v * wm) / 1000);
  if (f.disengageUntilTick !== null) v = Math.floor((v * DISENGAGE_VALUE_PERMILLE) / 1000);
  return Math.max(1, v);
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
    const tiles = [f.posTileId, ...state.graph.neighbors(f.posTileId)];
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
    const inv = sides.map((s) => Math.floor(1_000_000_000 / s.power));
    const sumInv = inv.reduce((a, b) => a + b, 0);
    const raw = inv.map((iv) => Math.floor((T * iv) / sumInv));
    let rem = T - raw.reduce((a, b) => a + b, 0);
    for (let i = 0; rem > 0; i = (i + 1) % sides.length, rem--) raw[i] += 1;
    sides.forEach((s, i) => (s.lossMilli = Math.min(raw[i], s.troopsMilli)));

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
    }
    const inGroup = plan.groupOf.has(f.id);
    if (inGroup && !f.inCombat) f.combatSinceTick = t;
    if (!inGroup) f.combatSinceTick = null;
    f.inCombat = inGroup;
  }
  // 패주 (D-3)
  for (const f of state.flags) {
    if (!plan.groupOf.has(f.id) || f.troopsMilli > 0 || f.routed) continue;
    f.troopsMilli = 0;
    f.routed = true;
    f.inCombat = false;
    f.disengageUntilTick = null;
    f.breakaway = false;
    f.blocked = false;
    beginReturn(state, f);
    routedNow.push(f.id);
    out.broadcast.push({ type: 'flag_routed', tick: t, flagId: f.id, returnTileId: f.returnTileId! });
  }
  // 이탈 대기 (4.15 g)
  for (const f of state.flags) {
    if (f.disengageUntilTick === null) continue;
    if (!plan.groupOf.has(f.id)) {
      f.disengageUntilTick = null;
      out.broadcast.push({ type: 'flag_disengaged', tick: t, flagId: f.id, reason: 'combat_over' });
    } else if (t >= f.disengageUntilTick) {
      f.disengageUntilTick = null;
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
  trackCombatEvents(state, plan, routedNow, brokeAway, t, out);
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
    for (const r of matched) {
      for (const id of r.flagIds) rec.flagIds.add(id);
      rec.routed.push(...r.routed);
    }
    const joined = matched.length === 0 || g.flagIds.some((id) => !rec.flagIds.has(id));
    for (const id of g.flagIds) rec.flagIds.add(id);
    if (joined) {
      out.broadcast.push({
        type: 'combat_started',
        tick: t,
        groupKey: g.key,
        flagIds: g.flagIds.slice(),
        sides: g.sides.map((s) => ({ sideKey: s.key, ownerIds: s.ownerIds.slice(), troops: Math.floor(s.troopsMilli / 1000), power: s.power })),
      });
    }
    for (const id of g.flagIds) if (routedSet.has(id)) rec.routed.push(id);
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
