/**
 * GDD v5.15 (이슈 20261110-2056, 사용자 결정 2026-11-13): 방어 태세 주둔 점령.
 * - 앵커에 도착해 주둔(ENGAGED·DEFEND)한 비전투 깃발이 옆 칸(중립·적)을 민다. 행군 중 정지 점령은 없다.
 * - 속도 ×0.6 (게이지 상한·AP 예산 누적 모두), 칸당 병력 비용은 공격과 같다.
 * - 점령에는 FLAG_MIN_TROOPS(40) 위 병력만 쓴다 — 그 아래로는 점령만 멈추고 주둔을 계속한다(소진 없음).
 * - 모델 2 전용 (모델 1 비트 동일).
 */
import { describe, expect, it } from 'vitest';
import { DEFEND_CAPTURE_SPEED_PERMILLE, FLAG_MIN_TROOPS, FLAG_SPEND_RATE_PERMILLE, FLAG_TILE_RATE_BASE, POSTURE, TERRAIN, UNIT, UNIT_ASSAULT_PERMILLE, isClaimable } from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { availAP, capturing, defendCapturing, maxProgress, spendRateMilli, threatened } from '../src/game/rules.js';
import { NEUTRAL, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';

function makeSim(model: 1 | 2 = 2, seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  // 봇이 시험 구역에 끼어들지 않게 전원 사람(명령 없음)으로 둔다
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true }));
  return new Simulation(createGameState(map, setup, undefined, undefined, model));
}

function findOpenArea(s: GameState, r: number): number {
  const W = s.map.width;
  const H = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) return t;
  }
  throw new Error('no open area');
}

function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number; anchor?: number } & Partial<Flag>): Flag {
  const f = makeFlag({
    id: s.nextFlagId++,
    ownerId: o.ownerId,
    slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length,
    unit: o.unit,
    troopsMilli: o.troops * 1000,
    initialTroops: o.troops,
    posTileId: o.pos,
    anchorTileId: o.anchor ?? o.pos,
    originTileId: o.pos,
  });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, anchor: _a, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}

function scenario(model: 1 | 2 = 2) {
  const sim = makeSim(model);
  const s = sim.state;
  const c = findOpenArea(s, 8);
  for (const t of s.graph.disk(c, 8)) s.map.terrain[t] = TERRAIN.PLAIN;
  setTileOwner(s, c, 1, false);
  return { sim, s, c, W: s.map.width };
}

function run(sim: Simulation, n: number) {
  for (let i = 0; i < n; i++) sim.step();
}

/** 옆 칸을 전부 먹을 때까지 걸린 tick (최대 limit) */
function ticksToClearFront(sim: Simulation, s: GameState, c: number, limit = 600): number {
  const all = () => s.graph.neighbors(c).every((n) => s.owners[n] === 1);
  for (let i = 1; i <= limit; i++) {
    sim.step();
    if (all()) return i;
  }
  return -1;
}

describe('GDD v5.15 방어 태세 주둔 점령', () => {
  it('속도 배율: maxProgress·AP 누적은 ×0.6, 칸당 비용은 그대로', () => {
    const { s, c } = scenario();
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const a = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    expect(DEFEND_CAPTURE_SPEED_PERMILLE).toBe(600);
    expect(maxProgress(a, s)).toBe(FLAG_TILE_RATE_BASE * UNIT_ASSAULT_PERMILLE[UNIT.SWORD]);
    expect(maxProgress(d, s)).toBe(Math.floor((FLAG_TILE_RATE_BASE * UNIT_ASSAULT_PERMILLE[UNIT.SWORD] * 600) / 1000));
    expect(spendRateMilli(a)).toBe(500 * FLAG_SPEND_RATE_PERMILLE);
    expect(spendRateMilli(d)).toBe(Math.floor((500 * FLAG_SPEND_RATE_PERMILLE * 600) / 1000));
  });

  it('주둔 중 옆 중립 칸을 점령한다 — 같은 조건의 공격 태세보다 약 1/0.6 배 오래 걸린다', () => {
    const A = scenario();
    // 100명: 예산(AP 누적)이 묶는 구간이라 속도 배율이 그대로 시간에 드러난다
    addFlag(A.s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: A.c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const tA = ticksToClearFront(A.sim, A.s, A.c);
    const D = scenario();
    const d = addFlag(D.s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: D.c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    expect(defendCapturing(D.s, d)).toBe(true);
    const tD = ticksToClearFront(D.sim, D.s, D.c);
    expect(tA).toBeGreaterThan(0);
    expect(tD).toBeGreaterThan(0);
    expect(tD / tA).toBeGreaterThan(1.5);
    expect(tD / tA).toBeLessThan(1.85);
    // 주둔은 계속된다 (점령해도 앞으로 나가지 않는다)
    expect(d.state).toBe('ENGAGED');
    expect(d.posTileId).toBe(D.c);
    expect(d.posture).toBe(POSTURE.DEFEND);
    expect(ledgerImbalance(D.s)).toBe(0);
  });

  it('수비 병력 보존: 40명 위 병력만 쓰고, 그 아래로는 점령만 멈춘다 (소진 없음)', () => {
    const { sim, s, c } = scenario();
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 60, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    run(sim, 600);
    expect(s.flags.includes(d)).toBe(true);
    expect(d.state).toBe('ENGAGED');
    expect(d.troopsMilli).toBeGreaterThanOrEqual(FLAG_MIN_TROOPS * 1000);
    expect(d.troopsMilli).toBeLessThan(60 * 1000); // 실제로 점령에 썼다
    expect(availAP(d)).toBe(Math.floor(Math.min(d.spendBudgetMilli, d.troopsMilli - FLAG_MIN_TROOPS * 1000) / 1000));
    // 40명이면 점령 대상이 아니다
    const e = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: FLAG_MIN_TROOPS, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    expect(defendCapturing(s, e)).toBe(false);
    expect(ledgerImbalance(s)).toBe(0);
  });

  it('행군 중에는 멈춰서 점령하지 않는다 (정지 점령은 공격 태세만)', () => {
    const { sim, s, c } = scenario();
    for (let k = 0; k <= 5; k++) setTileOwner(s, c + k, 1, false);
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, anchor: c + 5, posture: POSTURE.DEFEND, state: 'MARCHING' });
    let marched = 0;
    for (let i = 0; i < 120 && f.state === 'MARCHING'; i++) {
      sim.step();
      if (f.state !== 'MARCHING') break;
      marched++;
      expect(f.halted).toBe(false);
      expect(capturing(s, f)).toBe(false);
      expect(f.troopsMilli).toBe(500 * 1000); // 내 땅 행군 — 지출·노출 없음
    }
    expect(marched).toBeGreaterThan(10);
    expect(f.posTileId).toBe(c + 5);
    expect(f.state).toBe('ENGAGED');
    run(sim, 300);
    expect(f.troopsMilli).toBeLessThan(500 * 1000); // 도착 뒤에는 옆 중립 칸을 민다
    expect(s.graph.neighbors(c + 5).some((n) => n !== c + 4 && s.owners[n] === 1)).toBe(true);
  });

  it('적 땅도 점령하고, 그 칸을 관할하는 적 방어 깃발은 위협(threatened)으로 본다', () => {
    const { sim, s, c } = scenario();
    const e = c + 1;
    setTileOwner(s, e, 2, false);
    const g = addFlag(s, { ownerId: 2, unit: UNIT.SPEAR, troops: 40, pos: e + 3, anchor: e, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED', targetTileId: e });
    run(sim, 1);
    expect(d.targetTileId).toBe(e);
    expect(threatened(s, g)).toBe(true);
    run(sim, 400);
    expect(s.owners[e]).toBe(1);
  });

  it('모델 1 은 방어 태세가 점령하지 않는다 (비트 동일)', () => {
    const { sim, s, c } = scenario(1);
    const d = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    expect(defendCapturing(s, d)).toBe(false);
    run(sim, 200);
    expect(d.troopsMilli).toBe(500 * 1000);
    expect(s.graph.neighbors(c).every((n) => s.owners[n] !== 1)).toBe(true);
  });
});
