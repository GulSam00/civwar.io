/**
 * 전투 실험실 — 깃발 1 대 1 교전을 tick 단위로 돌리는 순수 시뮬레이터 (이슈 20261029-2358-combat-attrition-sim-script).
 * 서버 4단계(server/src/game/combat.ts)의 1 대 1 경로를 그대로 옮겼다:
 *   4a  L = max(S × 손실률, R × 하한률, 최소) / 2, T = 2L, 편 손실 = shared sideLossDetail (채널 대비 γ=2)
 *   4b  병력 차감 → 0 이하면 패주(사기 0) → 이탈 대기 만료면 이탈
 *   4c  사기: 자기 기지 칸 위 하한 미만이면 기지 회복량으로 하한까지, 아니면 max(하한, m − (고정 감소 + K × 손실%))
 *   4d  사기 0 · 기지 칸 아님 · 이탈 대기 아님 → 이탈 대기 시작 (채널값 ×0.7, 끝나면 이탈)
 * 테크는 넣지 않는다(무테크). 능력치는 CombatFlagInput.statOverride 로 병종 상수를 대신한다.
 */
import {
  COMBAT_LOSS_BP,
  COMBAT_LOSS_FLOOR_BP,
  COMBAT_MIN_LOSS_MILLI,
  DISENGAGE_TICKS,
  MORALE_BASE_FLOOR,
  MORALE_DROP_DEFEND_PER_TICK,
  MORALE_DROP_LOSS_K,
  MORALE_DROP_LOSS_PER_TROOP,
  MORALE_DROP_PER_TICK,
  MORALE_FLOOR,
  MORALE_FULL,
  MORALE_MAX,
  MORALE_RECOVER,
  MORALE_RECOVER_BASE,
  POSTURE,
  TERRAIN,
  UNIT_STAT,
  channelValues,
  overrideMoraleMultiplier,
  sideLossDetail,
  type CombatFlagInput,
  type Unit,
} from '@civwar/shared';
import { UNIT_NAME } from '../ui/text.js';

export interface SideConfig {
  unit: Unit; // 아이콘·이름 표시용 (능력치는 아래 값이 정한다)
  troops: number; // 출전 병력 (명)
  morale: number; // 시작 사기 ‰
  atk: number; // 공격력 ‰ (병종 기본)
  def: number; // 방어력 ‰ (병종 기본)
  moraleFloor: number; // 사기 0 일 때 곱 ‰
  moraleFull: number; // 사기 1000 일 때 곱 ‰
  dropAttack: number; // 교전 중 tick 당 고정 사기 감소 (공격 태세)
  dropDefend: number; // 〃 (방어 태세)
  posture: number; // POSTURE
  terrain: number; // TERRAIN
  onOwnBase: boolean; // 자기 기지 칸 위 (지형 대신 기지 배율, 사기 하한 300)
  disengageTicks: number; // 사기 붕괴 후 이탈 대기 tick
}

export interface GlobalConfig {
  lossBp: number; // 편 병력 합 대비 tick 당 손실 (만분율)
  floorBp: number; // 출전 병력 합 대비 손실 하한 (만분율)
  minLossMilli: number; // tick 당 최소 손실 (milli)
  lossK: number; // 손실 1% 당 추가 사기 감소
  lossPerTroop: number; // 손실 감소 상한 — 그 tick 사상자 1명당
  maxTicks: number; // 이 tick 에서 끊는다
}

export const DEFAULT_GLOBAL: GlobalConfig = {
  lossBp: COMBAT_LOSS_BP,
  floorBp: COMBAT_LOSS_FLOOR_BP,
  minLossMilli: COMBAT_MIN_LOSS_MILLI,
  lossK: MORALE_DROP_LOSS_K,
  lossPerTroop: MORALE_DROP_LOSS_PER_TROOP,
  maxTicks: 3000,
};

/** 프리셋 — 현재 게임 상수 기준 병종 능력치. 병력·태세·지형은 그대로 둔다 */
export function presetStats(unit: Unit): Pick<SideConfig, 'unit' | 'atk' | 'def' | 'moraleFloor' | 'moraleFull' | 'dropAttack' | 'dropDefend'> {
  return {
    unit,
    atk: UNIT_STAT[0][unit],
    def: UNIT_STAT[1][unit],
    moraleFloor: MORALE_FLOOR[unit],
    moraleFull: MORALE_FULL[unit],
    dropAttack: MORALE_DROP_PER_TICK[unit],
    dropDefend: MORALE_DROP_DEFEND_PER_TICK[unit],
  };
}

export function defaultSide(unit: Unit, posture: number = POSTURE.ATTACK): SideConfig {
  return {
    ...presetStats(unit),
    troops: 100,
    morale: MORALE_MAX,
    posture,
    terrain: TERRAIN.PLAIN,
    onOwnBase: false,
    disengageTicks: DISENGAGE_TICKS,
  };
}

export interface SideTick {
  troopsMilli: number; // tick 끝 병력
  morale: number; // tick 끝 사기
  atk: number; // 이번 tick 4a 실효 공격력 (사기·지형·이탈 대기 반영)
  def: number;
  lossMilli: number;
  lossPermille: number; // 이번 tick 총 손실 중 이 편 몫 ‰
  moraleDelta: number;
}

export interface TickRecord {
  tick: number;
  sides: [SideTick, SideTick];
}

export type LogKind = 'tick' | 'retreat' | 'breakaway' | 'rout' | 'end';
export interface LogEntry {
  tick: number;
  kind: LogKind;
  side?: 0 | 1;
  text: string;
}

export type EndReason = 'rout' | 'breakaway' | 'timeout';
export interface SimResult {
  tick: number;
  reason: EndReason;
  /** 남은 편 (둘 다 남았거나 둘 다 무너지면 null) */
  winner: 0 | 1 | null;
}

interface SideState {
  troopsMilli: number;
  initialMilli: number;
  morale: number;
  disengageUntil: number | null;
  routed: boolean;
  brokeAway: boolean;
  /** 사기 0 처음 닿은 tick */
  moraleZeroTick: number | null;
}

export const SIDE_NAME = ['좌', '우'] as const;

/** 초 표시 (tick 200ms) */
export function tickSec(tick: number): string {
  return `${(tick / 5).toFixed(1)}초`;
}
function troopsText(milli: number): string {
  return (milli / 1000).toFixed(1);
}

export class CombatSim {
  /** records[0] = tick 0 (교전 전), 이후 tick 마다 하나 */
  readonly records: TickRecord[] = [];
  readonly logs: LogEntry[] = [];
  result: SimResult | null = null;
  tick = 0;
  private readonly st: [SideState, SideState];

  constructor(
    readonly sides: readonly [SideConfig, SideConfig],
    readonly g: GlobalConfig,
  ) {
    this.st = sides.map((c) => ({
      troopsMilli: Math.max(1, Math.round(c.troops * 1000)),
      initialMilli: Math.max(1, Math.round(c.troops * 1000)),
      morale: clampMorale(c.morale),
      disengageUntil: null,
      routed: false,
      brokeAway: false,
      moraleZeroTick: null,
    })) as [SideState, SideState];
    const desc = (i: 0 | 1) => {
      const c = sides[i];
      return `${SIDE_NAME[i]} ${UNIT_NAME[c.unit]} ${c.troops}명 사기 ${c.morale} 공 ${c.atk} 방 ${c.def} ${c.posture === POSTURE.DEFEND ? '방어' : '공격'}태세`;
    };
    this.logs.push({ tick: 0, kind: 'end', text: `교전 시작 — ${desc(0)} / ${desc(1)}` });
    this.records.push(this.initialRecord());
  }

  get over(): boolean {
    return this.result !== null;
  }

  input(i: 0 | 1): CombatFlagInput {
    const c = this.sides[i];
    const s = this.st[i];
    return {
      unit: c.unit,
      posture: c.posture,
      terrain: c.terrain,
      onOwnBase: c.onOwnBase,
      troopsMilli: s.troopsMilli,
      morale: s.morale,
      disengage: s.disengageUntil !== null,
      statPm: [],
      statOverride: { atk: c.atk, def: c.def, moraleFloor: c.moraleFloor, moraleFull: c.moraleFull },
    };
  }

  /** tick 0 (교전 전) 실효 능력치 — 그래프 첫 점 */
  private initialRecord(): TickRecord {
    const side = (i: 0 | 1): SideTick => {
      const a = channelValues(this.input(i));
      return { troopsMilli: this.st[i].troopsMilli, morale: this.st[i].morale, atk: a[0], def: a[1], lossMilli: 0, lossPermille: 0, moraleDelta: 0 };
    };
    return { tick: 0, sides: [side(0), side(1)] };
  }

  /** 사기 곱 ‰ (표시용) */
  moraleMult(i: 0 | 1): number {
    const c = this.sides[i];
    return overrideMoraleMultiplier(c, this.st[i].morale);
  }

  /** 한 tick 진행. 끝났으면 false */
  step(): boolean {
    if (this.result) return false;
    const t = ++this.tick;
    const g = this.g;
    const st = this.st;
    const inputs = [this.input(0), this.input(1)];
    const ch = inputs.map((f) => channelValues(f));

    // 4a — 1 대 1 이라 깃발 수 n = 2, 편 수 2
    const S = st[0].troopsMilli + st[1].troopsMilli;
    const R = st[0].initialMilli + st[1].initialMilli;
    const L = Math.max(Math.floor((S * g.lossBp) / 20000), Math.floor((R * g.floorBp) / 20000), g.minLossMilli);
    const det = sideLossDetail([[inputs[0]], [inputs[1]]], 2 * L);

    // 4b — 병력 차감
    const lossBp = [0, 0];
    const lossMilli = [0, 0];
    for (const i of [0, 1] as const) {
      const l = det[i].lossMilli;
      if (l > 0 && st[i].troopsMilli > 0) lossBp[i] = Math.floor((l * 10000) / st[i].troopsMilli);
      lossMilli[i] = l;
      st[i].troopsMilli -= l;
    }
    // 패주
    for (const i of [0, 1] as const) {
      if (st[i].troopsMilli > 0) continue;
      st[i].troopsMilli = 0;
      st[i].routed = true;
      st[i].morale = 0;
      st[i].disengageUntil = null;
      this.logs.push({ tick: t, kind: 'rout', side: i, text: `${SIDE_NAME[i]} 패주 — 병력 0` });
    }
    const anyRouted = st[0].routed || st[1].routed;
    // 이탈 대기 만료 (패주가 우선)
    if (!anyRouted)
      for (const i of [0, 1] as const) {
        const s = st[i];
        if (s.disengageUntil === null || t < s.disengageUntil) continue;
        s.disengageUntil = null;
        s.brokeAway = true;
        this.logs.push({ tick: t, kind: 'breakaway', side: i, text: `${SIDE_NAME[i]} 이탈 완료 — 병력 ${troopsText(s.troopsMilli)} 남음` });
      }
    const fighting = !anyRouted && !st[0].brokeAway && !st[1].brokeAway;

    // 4c — 사기
    const before = [st[0].morale, st[1].morale];
    for (const i of [0, 1] as const) {
      const s = st[i];
      const c = this.sides[i];
      if (s.routed) continue;
      const inCombat = !s.brokeAway; // 상대가 무너져도 이번 tick 은 교전 중이었다
      if (inCombat) {
        if (c.onOwnBase && s.morale < MORALE_BASE_FLOOR) {
          s.morale = Math.min(MORALE_BASE_FLOOR, s.morale + MORALE_RECOVER_BASE);
          continue;
        }
        const fixed = c.posture === POSTURE.DEFEND ? c.dropDefend : c.dropAttack;
        const byLoss = Math.min(Math.floor((lossBp[i] * g.lossK + 50) / 100), Math.floor(lossMilli[i] / 1000) * g.lossPerTroop);
        const drop = Math.max(1, fixed + byLoss);
        s.morale = Math.max(c.onOwnBase ? MORALE_BASE_FLOOR : 0, s.morale - drop);
      } else {
        s.morale = Math.min(MORALE_MAX, s.morale + (c.onOwnBase ? MORALE_RECOVER_BASE : MORALE_RECOVER));
      }
    }
    // 4d — 사기 붕괴 후퇴
    if (fighting)
      for (const i of [0, 1] as const) {
        const s = st[i];
        if (s.morale === 0 && s.moraleZeroTick === null) s.moraleZeroTick = t;
        if (s.morale !== 0 || s.disengageUntil !== null || this.sides[i].onOwnBase) continue;
        s.disengageUntil = t + this.sides[i].disengageTicks;
        this.logs.push({ tick: t, kind: 'retreat', side: i, text: `${SIDE_NAME[i]} 사기 붕괴 — 후퇴 시작, ${tickSec(this.sides[i].disengageTicks)} 뒤 이탈 (그동안 능력치 ×0.7)` });
      }

    const side = (i: 0 | 1): SideTick => ({
      troopsMilli: st[i].troopsMilli,
      morale: st[i].morale,
      atk: ch[i][0],
      def: ch[i][1],
      lossMilli: det[i].lossMilli,
      lossPermille: det[i].lossPermille,
      moraleDelta: st[i].morale - before[i],
    });
    const rec: TickRecord = { tick: t, sides: [side(0), side(1)] };
    this.records.push(rec);
    const line = (i: 0 | 1) => {
      const s = rec.sides[i];
      const d = s.moraleDelta;
      return `${SIDE_NAME[i]} −${troopsText(s.lossMilli)} → ${troopsText(s.troopsMilli)}명 · 사기 ${s.morale}(${d >= 0 ? '+' : ''}${d}) · 공 ${s.atk} 방 ${s.def}`;
    };
    this.logs.push({ tick: t, kind: 'tick', text: `${line(0)}  |  ${line(1)}` });

    if (anyRouted) {
      const winner = st[0].routed && st[1].routed ? null : st[0].routed ? 1 : 0;
      this.finish(t, 'rout', winner);
    } else if (st[0].brokeAway || st[1].brokeAway) {
      const winner = st[0].brokeAway && st[1].brokeAway ? null : st[0].brokeAway ? 1 : 0;
      this.finish(t, 'breakaway', winner);
    } else if (t >= g.maxTicks) {
      this.finish(t, 'timeout', null);
    }
    return true;
  }

  private finish(t: number, reason: EndReason, winner: 0 | 1 | null): void {
    this.result = { tick: t, reason, winner };
    const why = reason === 'rout' ? '패주' : reason === 'breakaway' ? '이탈' : '시간 제한';
    const who = winner === null ? '승자 없음' : `${SIDE_NAME[winner]} 승`;
    const left = (i: 0 | 1) => `${SIDE_NAME[i]} ${troopsText(this.st[i].troopsMilli)}명(${Math.floor((this.st[i].troopsMilli * 100) / this.st[i].initialMilli)}%)`;
    this.logs.push({ tick: t, kind: 'end', text: `교전 종료 (${why}) — ${who} · ${tickSec(t)} · ${left(0)} / ${left(1)}` });
  }

  /** 요약 — 사기 0 도달 tick, 남은 병력 비율 */
  summary(i: 0 | 1): { moraleZeroTick: number | null; troopsPct: number; troopsMilli: number } {
    const s = this.st[i];
    return { moraleZeroTick: s.moraleZeroTick, troopsPct: Math.floor((s.troopsMilli * 1000) / s.initialMilli) / 10, troopsMilli: s.troopsMilli };
  }
}

function clampMorale(m: number): number {
  return Math.max(0, Math.min(MORALE_MAX, Math.round(m)));
}
