/**
 * 약소국 정리 보상 (사용자 2026-10-23, 프로토콜 §31, [A-141]~):
 * 마지막 기지를 점령해 상대를 멸망시킨(합병 받는) 플레이어가 멸망자의 병력·골드 일부와 정액 현상금을 받는다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { POSTURE, UNIT, isClaimable, type ServerMessage } from '@civwar/shared';
import { ANNEX } from '../src/game/annex.js';
import { troopCap } from '../src/game/economy.js';
import { NEUTRAL, baseProdPm, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMapForPlayers } from '../src/map/generate.js';

const SAVED = { ...ANNEX };
afterEach(() => Object.assign(ANNEX, SAVED));

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup));
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

/** 풀 병력을 직접 정한다 (회계 시작량도 같이 옮겨 불변식 유지) */
function setPool(s: GameState, id: number, troops: number): void {
  const p = s.players[id];
  s.ledger.initial += troops * 1000 - p.troopsMilli;
  p.troopsMilli = troops * 1000;
}

const landNeighbor = (s: GameState, b: number): number => s.graph.neighbors(b).find((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x])!;

/** P1 이 P2 의 유일한 기지(수도)를 함락하는 장면을 만들고 멸망 tick 까지 돌린다. 반환 = player_eliminated 이벤트 */
function eliminateP2(sim: Simulation, victim: { troops: number; gold: number; flagTroops: number }) {
  const s = sim.state;
  const cap = s.players[2].homeTileId;
  const nb = landNeighbor(s, cap);
  setTileOwner(s, nb, 1, false);
  setPool(s, 2, victim.troops);
  s.players[2].goldMilli = victim.gold * 1000;
  if (victim.flagTroops > 0) {
    // 수도와 떨어진 자기 칸에서 쉬는 공격 깃발 (수비대로 서면 함락이 늦어진다)
    const far = s.graph.disk(cap, 6).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]) && !s.map.isBase[x])!;
    setTileOwner(s, far, 2, false);
    addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: victim.flagTroops, pos: far, posture: POSTURE.ATTACK, state: 'IDLE', idleSinceTick: s.tick });
  }
  s.bases[s.baseIndexOf.get(cap)!].hpMilli = 150; // 틱당 상한(200) 이내 -> 한 tick 에 함락
  addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: nb, anchor: cap, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 100_000 });
  let elim: ServerMessage | undefined;
  for (let i = 0; i < 8 && !elim; i++) {
    const out = sim.step();
    expect(ledgerImbalance(s)).toBe(0);
    elim = out.broadcast.find((m) => m.type === 'player_eliminated');
  }
  return elim;
}

const LEVERS = { assetPermille: 0, goldPermille: 0, bountyTroops: 0, bountyGold: 0, fullProd: 0 };

describe('§31 약소국 정리 보상', () => {
  it('레버가 전부 0 이면 기존 규칙 그대로 — 병력·골드는 소멸, 이벤트 보상 0', () => {
    Object.assign(ANNEX, LEVERS);
    const sim = makeSim();
    const s = sim.state;
    setPool(s, 1, 100);
    const g0 = s.players[1].goldMilli;
    const elim = eliminateP2(sim, { troops: 60, gold: 77, flagTroops: 0 });
    expect(elim).toMatchObject({ playerId: 2, byPlayerId: 1, bountyTroops: 0, bountyGold: 0 });
    expect(s.players[1].goldMilli - g0).toBeLessThan(77_000); // 정산분만 늘 수 있다 (77 이 넘어오지 않는다)
  });

  it('인계: 멸망자 풀 + 깃발 병력의 assetPermille 이 합병자 풀로, 골드 goldPermille 이 합병자 골드로 — 보상 없는 같은 장면과의 차이로 검증', () => {
    const scene = (levers: typeof LEVERS) => {
      Object.assign(ANNEX, levers);
      const sim = makeSim();
      setPool(sim.state, 1, 100);
      const elim = eliminateP2(sim, { troops: 60, gold: 90, flagTroops: 40 });
      return { s: sim.state, elim };
    };
    const base = scene(LEVERS);
    const rich = scene({ ...LEVERS, assetPermille: 500, goldPermille: 1000 });
    if (rich.elim?.type !== 'player_eliminated') throw new Error('no elimination');
    // (60 + 40) × 50% = 50, 같은 tick 의 재생분이 조금 얹힐 수 있다
    expect(rich.elim).toMatchObject({ playerId: 2, byPlayerId: 1 });
    expect(rich.elim.bountyTroops).toBeGreaterThanOrEqual(50);
    expect(rich.elim.bountyTroops).toBeLessThanOrEqual(53);
    expect(rich.elim.bountyGold).toBeGreaterThanOrEqual(90);
    expect(rich.elim.bountyGold).toBeLessThanOrEqual(92);
    const dT = rich.s.players[1].troopsMilli - base.s.players[1].troopsMilli;
    const dG = rich.s.players[1].goldMilli - base.s.players[1].goldMilli;
    expect(dT).toBeGreaterThanOrEqual(50_000);
    expect(dT).toBeLessThanOrEqual(53_000);
    expect(dG).toBeGreaterThanOrEqual(90_000);
    expect(dG).toBeLessThanOrEqual(92_000);
    expect(rich.s.players[1].goldEarnedMilli).toBe(base.s.players[1].goldEarnedMilli); // 누적 획득 골드(타이브레이커)에는 안 들어간다
    expect(rich.s.players[2].troopsMilli).toBe(0);
    expect(rich.s.players[2].goldMilli).toBe(0);
  });

  it('정액 현상금은 병력 상한까지만 — 이벤트 값 = 실제 받은 양, 회계 불변식 유지', () => {
    Object.assign(ANNEX, { ...LEVERS, bountyTroops: 150, bountyGold: 100 });
    const sim = makeSim();
    const s = sim.state;
    setPool(s, 1, troopCap(s.players[1]) - 60); // 상한까지 여유 60
    const elim = eliminateP2(sim, { troops: 0, gold: 0, flagTroops: 0 });
    if (elim?.type !== 'player_eliminated') throw new Error('no elimination');
    // 합병으로 칸이 늘어 상한도 같이 늘었으므로 받은 양은 60 이상 150 이하
    expect(elim.bountyTroops).toBeGreaterThanOrEqual(60);
    expect(elim.bountyTroops).toBeLessThanOrEqual(150);
    expect(elim.bountyGold).toBe(100);
    expect(s.players[1].troopsMilli).toBeLessThanOrEqual(troopCap(s.players[1]) * 1000);
  });

  it('상한이 이미 꽉 찼으면 병력 보상 0, 골드는 그대로 받는다', () => {
    Object.assign(ANNEX, { ...LEVERS, assetPermille: 1000, bountyTroops: 150, bountyGold: 100 });
    const sim = makeSim();
    const s = sim.state;
    // 풀은 먼저 합병 전 상한으로 잘리므로, 남는 여유는 합병으로 늘어난 상한분(칸당 12)뿐이다
    setPool(s, 1, troopCap(s.players[1]) + 100_000);
    const elim = eliminateP2(sim, { troops: 60, gold: 0, flagTroops: 0 });
    if (elim?.type !== 'player_eliminated') throw new Error('no elimination');
    expect(elim.bountyTroops).toBeLessThanOrEqual(12 * ((elim.annexedTiles ?? 0) + 1));
    expect(elim.bountyGold).toBe(100);
  });

  it('합병자가 없으면(남은 땅이 중립으로) 아무도 보상을 받지 않는다 — 이벤트 보상 0', () => {
    Object.assign(ANNEX, { assetPermille: 1000, goldPermille: 1000, bountyTroops: 150, bountyGold: 100, fullProd: 0 });
    const sim = makeSim();
    const s = sim.state;
    const p2 = s.players[2];
    p2.lastBaseLostTo = null;
    p2.lastLostTo = null;
    setTileOwner(s, p2.homeTileId, NEUTRAL, false); // 기지를 중립 쪽으로 — 멸망 조건만 만든다
    setPool(s, 2, 50);
    const out = sim.step();
    expect(ledgerImbalance(s)).toBe(0);
    const ev = out.broadcast.find((m) => m.type === 'player_eliminated');
    expect(ev).toMatchObject({ playerId: 2, byPlayerId: null, bountyTroops: 0, bountyGold: 0 });
  });

  it('fullProd: 마지막 기지를 점령하면 생산력 ×0.5 면제(100% 유지), 아니면 500', () => {
    for (const full of [0, 1]) {
      Object.assign(ANNEX, { ...LEVERS, fullProd: full });
      const sim = makeSim();
      const s = sim.state;
      const cap = s.players[2].homeTileId;
      eliminateP2(sim, { troops: 0, gold: 0, flagTroops: 0 });
      expect(s.owners[cap]).toBe(1);
      const pm = baseProdPm(s.bases[s.baseIndexOf.get(cap)!]); // 점령 직후 (이후 분당 +167 회복이 몇 tick 반영될 수 있다)
      if (full) expect(pm).toBeGreaterThanOrEqual(990);
      else expect(pm).toBeLessThanOrEqual(520);
    }
  });

  it('마지막 기지가 아닌 기지를 점령할 때는 fullProd 여도 ×0.5, 멸망·보상 없음', () => {
    Object.assign(ANNEX, { ...LEVERS, bountyTroops: 150, bountyGold: 100, fullProd: 1 });
    const sim = makeSim();
    const s = sim.state;
    const extra = s.map.baseTiles.find((b) => s.owners[b] === NEUTRAL)!;
    setTileOwner(s, extra, 2, false); // P2 는 기지 2개
    const nb = landNeighbor(s, extra);
    setTileOwner(s, nb, 1, false);
    s.bases[s.baseIndexOf.get(extra)!].hpMilli = 150; // 틱당 상한(200) 이내 -> 한 tick 에 함락
    addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: nb, anchor: extra, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 100_000 });
    const g0 = s.players[1].goldMilli;
    for (let i = 0; i < 8 && s.owners[extra] !== 1; i++) sim.step();
    expect(s.owners[extra]).toBe(1);
    expect(s.players[2].alive).toBe(true);
    expect(baseProdPm(s.bases[s.baseIndexOf.get(extra)!])).toBeLessThanOrEqual(520);
    expect(s.players[1].goldMilli - g0).toBeLessThan(100_000);
  });
});
