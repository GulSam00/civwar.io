import { describe, expect, it } from 'vitest';
import { MORALE_DROP_LOSS_K, MORALE_DROP_PER_TICK, POSTURE, TERRAIN, UNIT, channelValues, sideLossDetail, type CombatFlagInput } from '@civwar/shared';
import { CombatSim, DEFAULT_GLOBAL, defaultSide, presetStats } from '../src/lab/combatSim.js';

const flag = (unit: number, morale: number, posture: number = POSTURE.ATTACK): CombatFlagInput => ({
  unit,
  posture,
  terrain: TERRAIN.HILLS,
  onOwnBase: false,
  troopsMilli: 100_000,
  morale,
  disengage: false,
  statPm: [],
});

describe('전투 실험실 — statOverride', () => {
  it('프리셋 값으로 덮어쓰면 병종 상수와 채널값이 같다', () => {
    for (const u of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY])
      for (const m of [0, 400, 1000])
        for (const p of [POSTURE.ATTACK, POSTURE.DEFEND]) {
          const ps = presetStats(u);
          const plain = flag(u, m, p);
          expect(channelValues({ ...plain, statOverride: ps })).toEqual(channelValues(plain));
        }
  });
});

describe('전투 실험실 — CombatSim', () => {
  it('첫 tick 손실이 shared sideLossDetail 과 같고 사기 감소 = 고정 + K × 손실%', () => {
    const a = defaultSide(UNIT.SWORD);
    const b = defaultSide(UNIT.CAVALRY);
    const sim = new CombatSim([a, b], DEFAULT_GLOBAL);
    const inputs = [sim.input(0), sim.input(1)];
    const L = Math.max(Math.floor((200_000 * DEFAULT_GLOBAL.lossBp) / 20000), Math.floor((200_000 * DEFAULT_GLOBAL.floorBp) / 20000), DEFAULT_GLOBAL.minLossMilli);
    const det = sideLossDetail([[inputs[0]], [inputs[1]]], 2 * L);
    sim.step();
    const r = sim.records[1];
    expect(r.sides[0].lossMilli).toBe(det[0].lossMilli);
    expect(r.sides[1].lossMilli).toBe(det[1].lossMilli);
    const bp = Math.floor((det[0].lossMilli * 10000) / 100_000);
    expect(r.sides[0].morale).toBe(1000 - (MORALE_DROP_PER_TICK[UNIT.SWORD] + Math.floor((bp * MORALE_DROP_LOSS_K + 50) / 100)));
  });

  it('사기 0 이면 이탈 대기 후 이탈로 끝난다', () => {
    const sim = new CombatSim([defaultSide(UNIT.SWORD), defaultSide(UNIT.SPEAR)], DEFAULT_GLOBAL);
    while (sim.step());
    expect(sim.result).not.toBeNull();
    expect(sim.logs.some((l) => l.kind === 'retreat')).toBe(true);
    expect(sim.result!.reason).toBe('breakaway');
  });

  it('자기 기지 위는 사기 300 아래로 내려가지 않는다', () => {
    const a = { ...defaultSide(UNIT.SPEAR, POSTURE.DEFEND), onOwnBase: true, troops: 500 };
    const sim = new CombatSim([a, defaultSide(UNIT.CAVALRY)], DEFAULT_GLOBAL);
    while (sim.step());
    expect(Math.min(...sim.records.slice(1).map((r) => r.sides[0].morale))).toBeGreaterThanOrEqual(300);
    expect(sim.logs.some((l) => l.kind === 'retreat' && l.side === 0)).toBe(false);
  });
});
