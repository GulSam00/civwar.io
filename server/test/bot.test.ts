import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BOT_CAVALRY_CHANCE_PERMILLE, BOT_COMMIT_ENEMY_PERMILLE, BOT_DIFFICULTY, MAP_SIZE_PRESETS, POSTURE, TERRAIN, UNIT, isClaimable, type BotDifficultyName, type C2S_GameCommand } from '@civwar/shared';
import { BOT_DEEP_MAX, BOT_DEEP_MIN, CivBot, botKnobs, chooseUnitFor, decideBot } from '../src/game/bot.js';
import { generateMap, generateMapForPlayers } from '../src/map/generate.js';
import { NEUTRAL, botAggressionPermille, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation, type BotBrain } from '../src/game/tick.js';

function botGame(seed: number, N: number, diff: BotDifficultyName | BotDifficultyName[] = 'NORMAL', brain: BotBrain = CivBot, aggression?: number) {
  const P = MAP_SIZE_PRESETS.M;
  const map = generateMap(seed, P.w, P.h, N);
  const diffs = Array.isArray(diff) ? diff : Array.from({ length: N }, () => diff);
  const state = createGameState(
    map,
    diffs.map((d, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: d, aggressionPermille: aggression })),
  );
  return new Simulation(state, brain);
}

function hashState(s: GameState): string {
  const h = createHash('sha256');
  h.update(Buffer.from(s.owners));
  h.update(JSON.stringify(s.flags));
  h.update(JSON.stringify(s.players.filter(Boolean).map((p) => [p.troopsMilli, p.goldMilli, p.techMask, p.tiles])));
  return h.digest('hex');
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

describe('봇 AI (GDD 8장, 3차-2)', () => {
  it('10인 전원 NORMAL 5분: 거절 명령 비율 < 2%, 매 tick 회계 불변식 0, 확장 진행', () => {
    const sim = botGame(1000, 10);
    let acc = 0;
    let rej = 0;
    for (let i = 0; i < 1500; i++) {
      const out = sim.step();
      for (const pm of out.personal) {
        if (pm.msg.type !== 'cmd_ack') continue;
        if (pm.msg.accepted) acc++;
        else rej++;
      }
      expect(ledgerImbalance(sim.state)).toBe(0);
    }
    expect(acc).toBeGreaterThan(100);
    expect(rej / (acc + rej)).toBeLessThan(0.02);
    const tiles = sim.state.players.filter(Boolean).map((p) => p.tiles);
    expect(tiles.reduce((a, b) => a + b, 0) / tiles.length).toBeGreaterThan(80);
  });

  it('결정론: 같은 시드 → 같은 상태 해시 (900 tick, 혼합 난이도)', () => {
    const mix: BotDifficultyName[] = ['HARD', 'NORMAL', 'EASY', 'NORMAL', 'HARD', 'EASY', 'NORMAL', 'NORMAL'];
    const a = botGame(77, 8, mix);
    const b = botGame(77, 8, mix);
    for (let i = 0; i < 900; i++) {
      a.step();
      b.step();
    }
    expect(hashState(a.state)).toBe(hashState(b.state));
    const c1 = decideBot(a.state, 1, a.state.tick, BOT_DIFFICULTY.HARD);
    const c2 = decideBot(a.state, 1, a.state.tick, BOT_DIFFICULTY.HARD);
    expect(c1).toEqual(c2);
  });

  it('난이도: 결정 주기(10/15/30)와 예비 병력 비율이 발령 시점·크기를 바꾼다', () => {
    const calls: Record<number, number[]> = {};
    const spy: BotBrain = {
      decide(s, id, t, params) {
        (calls[id] ??= []).push(t);
        return CivBot.decide(s, id, t, params);
      },
    };
    const sim = botGame(5, 3, ['EASY', 'NORMAL', 'HARD'], spy);
    for (let i = 0; i < 60; i++) sim.step();
    expect(calls[1]).toEqual([30, 60]);
    expect(calls[2]).toEqual([15, 30, 45, 60]);
    expect(calls[3]).toEqual([10, 20, 30, 40, 50, 60]);

    const fresh = botGame(5, 3).state;
    const at = (troops: number) => (fresh.players[1].troopsMilli = troops * 1000);
    const issued = (d: BotDifficultyName) =>
      decideBot(fresh, 1, 30, BOT_DIFFICULTY[d])
        .filter((c): c is Extract<C2S_GameCommand, { type: 'cmd_flag_issue' }> => c.type === 'cmd_flag_issue')
        .reduce((a, c) => a + c.troops, 0);
    at(150); // 시작 병력: 예비(EASY 45% / HARD 20% of cap 280)를 빼면 최소 공격 병력 미만 → 셋 다 대기
    expect(issued('EASY')).toBe(0);
    expect(issued('HARD')).toBe(0);
    at(180); // HARD 만 발령 (180 − 56 ≥ 120), NORMAL 180 − 84 < 120, EASY 180 − 126 < 95
    expect(issued('EASY')).toBe(0);
    expect(issued('NORMAL')).toBe(0);
    expect(issued('HARD')).toBeGreaterThan(0);
    at(260); // EASY 도 발령한다 (예비 126 → 240 에서는 아직 대기)
    expect(issued('EASY')).toBeGreaterThan(0);
    expect(issued('EASY')).toBeLessThanOrEqual(issued('HARD'));
  });

  it('난이도: EASY 공격 깃발은 항상 검병(fixedUnit), NORMAL 도 중립 선점은 검병 (2026-10-24 밸런스 패치)', () => {
    const units = (d: BotDifficultyName) => {
      const sim = botGame(11, 6, d);
      const atk: number[] = [];
      for (let i = 0; i < 1200; i++) for (const m of sim.step().broadcast) if (m.type === 'flag_issued' && m.posture === POSTURE.ATTACK) atk.push(m.unit);
      return atk;
    };
    const easy = units('EASY');
    expect(easy.length).toBeGreaterThan(0);
    expect(easy.every((u) => u === UNIT.SWORD)).toBe(true);
    const normal = units('NORMAL');
    expect(normal.filter((u) => u === UNIT.SWORD).length / normal.length).toBeGreaterThan(0.8); // 초반 4분은 대부분 중립 확장 → 검병
  });

  it('요격 (v4.1 8.6.0): 내 땅을 미는 적 공격 깃발 옆 내 땅 칸에 방어 태세 깃발 — 실제 명령 경로에서 수락', () => {
    const sim = new Simulation(createGameState(generateMapForPlayers(4242, 8), Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true }))));
    const s = sim.state;
    const c = findOpenArea(s, 7);
    const W = s.map.width;
    for (const t of s.graph.disk(c, 7)) {
      s.map.terrain[t] = TERRAIN.PLAIN;
      setTileOwner(s, t, t % W <= c % W ? 1 : 2, false);
    }
    s.players[1].troopsMilli += 3000_000;
    s.ledger.initial += 3000_000;
    const e = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 800, pos: c + 1, anchor: c, posture: POSTURE.ATTACK, state: 'ENGAGED', targetOwnerId: 1, targetTileId: c, progressMilli: 400 });
    s.tick = 15;
    const cmds = decideBot(s, 1, 15, BOT_DIFFICULTY.NORMAL);
    const iss = cmds.find((x): x is Extract<C2S_GameCommand, { type: 'cmd_flag_issue' }> => x.type === 'cmd_flag_issue');
    expect(iss).toBeDefined();
    expect(s.owners[iss!.anchorTileId]).toBe(1);
    // 2026-10-11: 요격 칸 = 적 깃발과 접촉(8방향, 대각선 포함)하는 내 땅
    expect(s.graph.touching(iss!.anchorTileId, e.posTileId)).toBe(true);
    expect([UNIT.SPEAR, UNIT.CAVALRY]).toContain(iss!.unit);
    // 요격 병력 ≥ 적 × 1.25 × (적 v / 내 v)
    expect(iss!.troops).toBeGreaterThanOrEqual(1000);
    sim.enqueue(0, 1, iss!);
    const out = sim.step();
    const ack = out.personal.find((p) => p.playerId === 1 && p.msg.type === 'cmd_ack');
    expect(ack?.msg).toMatchObject({ accepted: true, posture: POSTURE.DEFEND });
    expect(ledgerImbalance(s)).toBe(0);
  });

  it('외교 (8.5): 제안자 타일 ≥ 내 타일 × 1.2 이면 수락, 아니면 거절. 먼저 제안하지 않는다', () => {
    const s = botGame(3, 4).state;
    let k = 0;
    for (let t = 0; t < s.owners.length && k < 40; t++) {
      if (s.owners[t] === NEUTRAL && isClaimable(s.map.terrain[t]) && !s.map.isBase[t]) {
        setTileOwner(s, t, 2, false);
        k++;
      }
    }
    s.proposals.push({ id: 1, from: 2, to: 1, expireTick: 500 }, { id: 2, from: 1, to: 2, expireTick: 500 });
    const r1 = decideBot(s, 1, 15, BOT_DIFFICULTY.NORMAL).find((c) => c.type === 'cmd_ally_respond');
    const r2 = decideBot(s, 2, 15, BOT_DIFFICULTY.NORMAL).find((c) => c.type === 'cmd_ally_respond');
    expect(r1).toMatchObject({ proposalId: 1, accept: true });
    expect(r2).toMatchObject({ proposalId: 2, accept: false });
    for (const id of [1, 2, 3, 4]) expect(decideBot(s, id, 15, BOT_DIFFICULTY.NORMAL).some((c) => c.type === 'cmd_ally_propose')).toBe(false);
  });

  it('성향 배정: (룸 시드, playerId) 결정론 해시, 0..1000, 봇마다 다름', () => {
    expect(botAggressionPermille(1234, 3)).toBe(botAggressionPermille(1234, 3));
    const vals = Array.from({ length: 12 }, (_, i) => botAggressionPermille(1234, i + 1));
    for (const v of vals) expect(v >= 0 && v <= 1000).toBe(true);
    expect(new Set(vals).size).toBeGreaterThan(8);
    expect(vals).not.toEqual(Array.from({ length: 12 }, (_, i) => botAggressionPermille(1235, i + 1)));
    const a = botGame(9, 4).state;
    const b = botGame(9, 4).state;
    expect(a.players.filter(Boolean).map((p) => p.bot.aggressionPermille)).toEqual(b.players.filter(Boolean).map((p) => p.bot.aggressionPermille));
    expect(a.players[2].bot.aggressionPermille).toBe(botAggressionPermille(a.map.seed, 2));
  });

  it('성향 보간 (패치 8차): 예비 병력·적 공격 발령 비율만 변하고 나머지는 기준 고정', () => {
    const N = BOT_DIFFICULTY.NORMAL;
    const fixed = { minDefenseRatioPermille: 250, maxDefenseRatioPermille: 500, counterMarginPermille: 1200, retreatRatioPermille: 800, blockAttackRatioPermille: 500, enemyAnchorWeightPermille: 1000 };
    expect(botKnobs({ ...N, aggressionPermille: 500 })).toMatchObject({ reserveRatioPermille: 300, commitEnemyPermille: 350, ...fixed });
    expect(botKnobs({ ...N, aggressionPermille: 0 })).toMatchObject({ reserveRatioPermille: 400, commitEnemyPermille: 200, ...fixed });
    expect(botKnobs({ ...N, aggressionPermille: 1000 })).toMatchObject({ reserveRatioPermille: 200, commitEnemyPermille: 500, ...fixed });
    expect(botKnobs(BOT_DIFFICULTY.HARD)).toMatchObject({ reserveRatioPermille: 200, minDefenseRatioPermille: 300 });
  });

  it('성향 0 vs 1000: 짧은 판에서 방어 슬롯 비중과 공격 발령 수가 측정 가능하게 다르다', () => {
    const run = (aggr: number) => {
      const sim = botGame(1001, 10, 'NORMAL', CivBot, aggr);
      let def = 0;
      let all = 0;
      let attacks = 0;
      for (let i = 0; i < 4500; i++) {
        for (const m of sim.step().broadcast) if (m.type === 'flag_issued' && m.posture === POSTURE.ATTACK) attacks++;
        if (sim.state.tick % 15 === 0) for (const f of sim.state.flags) {
          all++;
          if (f.posture === POSTURE.DEFEND) def++;
        }
      }
      return { defShare: def / all, attacks };
    };
    const lo = run(0);
    const hi = run(1000);
    expect(lo.attacks).toBeGreaterThan(0); // 패치 8차: 방어 비중은 성향과 무관 (비율 두 값만 다름)
  });

  it('비율 상·하한 (패치 8차): 어떤 난이도·성향에서도 예비 150~450‰, 적 발령 200~500‰', () => {
    for (const d of Object.values(BOT_DIFFICULTY)) for (const a of [0, 250, 500, 750, 1000]) {
      const k = botKnobs({ ...d, aggressionPermille: a });
      expect(k.reserveRatioPermille).toBeGreaterThanOrEqual(150);
      expect(k.reserveRatioPermille).toBeLessThanOrEqual(450);
      expect(k.commitEnemyPermille).toBeGreaterThanOrEqual(200);
      expect(k.commitEnemyPermille).toBeLessThanOrEqual(500);
    }
    expect(BOT_COMMIT_ENEMY_PERMILLE).toBe(350);
  });

  it('약한 적 기준 (패치 9차): 성향 0 → 30%, 1000 → 50%, 약한 적 최대 가중 ×3', () => {
    const N = BOT_DIFFICULTY.NORMAL;
    expect(botKnobs({ ...N, aggressionPermille: 0 }).weakRatioPermille).toBe(300);
    expect(botKnobs({ ...N, aggressionPermille: 500 }).weakRatioPermille).toBe(400);
    expect(botKnobs({ ...N, aggressionPermille: 1000 }).weakRatioPermille).toBe(500);
  });
});

describe('v4.2 봇 — 깊은 앵커 [A-65] · 기지 공격 (사용자 확정 2026-10-10)', () => {
  /** p1 수도에서 가장 가까운 남의 기지를 p2 땅으로 만들고, p1 땅을 그 기지 3칸 앞까지 늘린다 */
  function baseScene(hpLow: boolean) {
    const sim = botGame(2024, 10, 'NORMAL', CivBot, 500);
    const s = sim.state;
    const p1 = s.players[1];
    const home = p1.homeTileId;
    const b = s.map.baseTiles.filter((x) => s.owners[x] !== 1 && x !== s.players[2].homeTileId).sort((x, y) => s.graph.distance(x, home) - s.graph.distance(y, home) || x - y)[0];
    setTileOwner(s, b, 2, false);
    // 수도 → 기지 최단 육지 경로(BFS)를 따라 기지 3칸 앞까지 p1 땅 (v4.5: 물이 통행 불가라 직선 근사는 호수에서 맴돈다)
    const prev = new Map<number, number>([[home, -1]]);
    const q = [home];
    for (let i = 0; i < q.length && !prev.has(b); i++) for (const n of s.graph.neighbors(q[i])) if (!prev.has(n)) (prev.set(n, q[i]), q.push(n));
    const path: number[] = [];
    for (let x = b; x !== -1; x = prev.get(x)!) path.unshift(x);
    for (const cur of path.slice(0, Math.max(0, path.length - 3))) if (s.owners[cur] !== 2) setTileOwner(s, cur, 1, false);
    const bs = s.bases[s.baseIndexOf.get(b)!];
    if (hpLow) bs.hpMilli = Math.floor(bs.hpMilli / 4);
    p1.troopsMilli = 1000 * 1000;
    return { s, b };
  }

  it('가까운 약한 적 기지(관할 원 밖, 체력 1/4)를 앵커로 기병 발령, 병력 ≈ 풀 50%', () => {
    const { s, b } = baseScene(true);
    const cmds = decideBot(s, 1, 3000, s.players[1].bot);
    const iss = cmds.filter((c) => c.type === 'cmd_flag_issue') as Extract<C2S_GameCommand, { type: 'cmd_flag_issue' }>[];
    const atk = iss.find((c) => c.anchorTileId === b);
    expect(atk).toBeTruthy();
    expect([UNIT.CAVALRY, UNIT.SWORD]).toContain(atk!.unit);
    // 풀 1000, 기병 환산 1.15 → maxIssuable 한도 안에서 floor(풀 × 500‰) (먼저 낸 최소 방어선 발령이 풀을 줄일 수 있다)
    expect(atk!.troops).toBeGreaterThanOrEqual(150);
    expect(atk!.troops).toBeLessThanOrEqual(700); // 패치 9차: 약한 적이면 풀의 70%까지
  });

  it('적 땅·기지 공격 병종은 교전 시도마다 시드 해시 난수 (기병 확률 ≈ BOT_CAVALRY_CHANCE) — 같은 입력이면 같은 결과, 중립은 검병', () => {
    const { s, b } = baseScene(true);
    const a = { tileId: b, border: b, owner: 2, kind: 1 as const, base: true };
    const bot = s.players[1].bot;
    expect(chooseUnitFor(s, 1, bot, a)).toBe(chooseUnitFor(s, 1, bot, a));
    expect(chooseUnitFor(s, 1, bot, { ...a, kind: 0 as const, owner: 0 })).toBe(UNIT.SWORD);
    let cav = 0;
    const N = 400;
    for (let t = 0; t < N; t++) {
      const ctxState = { ...s } as typeof s;
      if (chooseUnitFor(ctxState, 1, bot, { ...a, tileId: b + t }, t * 15) === UNIT.CAVALRY) cav++;
    }
    expect(cav / N).toBeGreaterThan(BOT_CAVALRY_CHANCE_PERMILLE / 1000 - 0.1);
    expect(cav / N).toBeLessThan(BOT_CAVALRY_CHANCE_PERMILLE / 1000 + 0.1);
    expect(chooseUnitFor(s, 1, { ...bot, fixedUnit: UNIT.SWORD }, a)).toBe(UNIT.SWORD);
  });

  it('공격 발령 앵커는 국경 칸이 아니라 노선 끝점(내 땅에서 4칸 이상) — 깊은 앵커', () => {
    const sim = botGame(1000, 10, 'NORMAL');
    const s = sim.state;
    const anchors: number[] = [];
    for (let i = 0; i < 300; i++) {
      const out = sim.step();
      for (const m of out.broadcast) if (m.type === 'flag_issued' && m.posture === POSTURE.ATTACK && m.playerId === 1) anchors.push(m.anchorTileId);
    }
    expect(anchors.length).toBeGreaterThan(0);
    // 발령 직후 확인은 어렵다(영토가 변함) — 앵커가 수도에서 6칸 이상 떨어진 것이 하나 이상
    expect(anchors.some((a) => s.graph.distance(a, s.players[1].homeTileId) >= 6)).toBe(true);
  });

  it('깊은 앵커 노선 깊이 4~6칸 (§25 B2, 사용자 2026-10-18: 상한 20 → 6)', () => {
    expect(BOT_DEEP_MIN).toBe(4);
    expect(BOT_DEEP_MAX).toBe(6);
  });
});
