/**
 * v4.5 규칙 (사용자 2026-10-15, 프로토콜 §22): 해상 이동 폐지·물 ≈ 10% · 중립 비용 고정 · 손실률 0.9% · 기지 피해 상한 ·
 * 기지 생산(60/100칸분) · 기지 ×1.5 태세 무관 · 지명 양식.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_HP_DMG_CAP_MILLI_PER_TICK,
  BASE_HP_MAX_MILLI,
  BASE_PROD_TILES,
  CAPITAL_PROD_TILES,
  COMBAT_LOSS_BP,
  COMBAT_LOSS_FLOOR_BP,
  NEUTRAL_BASE,
  POSTURE,
  TERRAIN,
  TERRAIN_COST_PERMILLE,
  TICKS_PER_MIN,
  UNIT,
  UNIT_ATK_PERMILLE,
  UNIT_DEF_PERMILLE,
  isClaimable,
  type S2C_SnapshotDelta,
} from '@civwar/shared';
import { CivBot } from '../src/game/bot.js';
import { flagValue, stage4a_flagCombatPhaseA } from '../src/game/combat.js';
import { PROD_REF_REGEN_MILLI, applyRegenMult, baseRegenBaseMilli, grossGoldMilliPerTick, regenMilliPerTick, terrRegenBaseMilli } from '../src/game/economy.js';
import { splitBaseDamage } from '../src/game/gauge.js';
import { baseEqTiles, computeProduction } from '../src/game/production.js';
import { tileCost } from '../src/game/rules.js';
import { buildSnapshotFull } from '../src/game/snapshot.js';
import { NEUTRAL, baseProdPm, createGameState, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { INF, bfs, generateMapForPlayers, generateMapForSize } from '../src/map/generate.js';
import { ACTIVE_PLACE_NAME_STYLES, PLACE_NAME_POOLS, assignPlaceNames, pickPlaceNameStyle } from '../src/map/placeNames.js';
import { MapCatalog, mapFromPreset } from '../src/map/presets.js';
import { fileURLToPath } from 'node:url';

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

// ───────────────────────── 1. 물 ─────────────────────────

describe('v4.5 물 = 통행 불가, 물 ≈ 10%, 육지 한 덩어리', () => {
  const sizes = ['S', 'M', 'L'] as const;
  for (const size of sizes) {
    it(`${size}: 시드 12개 — 물 8.5~11.5%, 이동 그래프에 물 칸 없음, 모든 육지가 이동 그래프로 연결`, () => {
      for (let k = 0; k < 12; k++) {
        const seed = 7000 + k * 131;
        const m = generateMapForSize(seed, size, size === 'S' ? 7 : 12);
        const n = m.width * m.height;
        const water = n - m.totalLandTiles;
        expect(water * 1000).toBeGreaterThanOrEqual(85 * n);
        expect(water * 1000).toBeLessThanOrEqual(115 * n);
        const land: number[] = [];
        for (let t = 0; t < n; t++) {
          if (isClaimable(m.terrain[t])) land.push(t);
          else expect(m.graph.neighbors(t)).toEqual([]); // 물 칸은 그래프에 없다
          for (const x of m.graph.neighbors(t)) expect(isClaimable(m.terrain[x])).toBe(true); // 물로 가는 간선 없음
        }
        // 이동 그래프 BFS 로 전 육지 도달
        const seen = new Uint8Array(n);
        const q = [land[0]];
        seen[land[0]] = 1;
        for (let i = 0; i < q.length; i++) for (const x of m.graph.neighbors(q[i])) if (!seen[x]) (seen[x] = 1), q.push(x);
        expect(q.length).toBe(land.length);
        // 지형 무시 육지 BFS 도 같은 결과 (생성기 불변식 I1)
        const d = bfs(m.topology, [land[0]], (x) => isClaimable(m.terrain[x]));
        for (const t of land) expect(d[t]).toBeLessThan(INF);
      }
    });
  }

  it('공식 프리셋 9장: 물 ≈ 10%, 육지 연결 (재생성됨)', () => {
    const cat = MapCatalog.loadDir(fileURLToPath(new URL('../maps/official/', import.meta.url)));
    const list = cat.list();
    expect(list.map((m) => m.id).sort()).toEqual(['official-l-01', 'official-l-02', 'official-l-03', 'official-m-01', 'official-m-02', 'official-m-03', 'official-s-01', 'official-s-02', 'official-s-03']);
    for (const meta of list) {
      const m = mapFromPreset(cat.get(meta.id)!, meta.players.max);
      const n = m.width * m.height;
      expect((n - m.totalLandTiles) * 1000).toBeLessThanOrEqual(115 * n);
      const land: number[] = [];
      for (let t = 0; t < n; t++) if (isClaimable(m.terrain[t])) land.push(t);
      const seen = new Uint8Array(n);
      const q = [land[0]];
      seen[land[0]] = 1;
      for (let i = 0; i < q.length; i++) for (const x of m.graph.neighbors(q[i])) if (!seen[x]) (seen[x] = 1), q.push(x);
      expect(q.length).toBe(land.length);
    }
  });

  it('물 앵커는 여전히 WATER 로 거절, 깃발 경로는 물을 밟지 않는다', () => {
    const sim = makeSim();
    const s = sim.state;
    const lake = s.map.terrain.findIndex((t, i) => t === TERRAIN.SHALLOW && !s.map.topology.isBorder(i));
    expect(lake).toBeGreaterThanOrEqual(0);
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 1, unit: UNIT.SWORD, troops: 60, anchorTileId: lake, originBaseTileId: null });
    const out = sim.step();
    expect(out.personal[0].msg).toMatchObject({ accepted: false, reason: 'WATER' });
  });
});

// ───────────────────────── 2. 중립 비용 ─────────────────────────

describe('v4.5 중립 점령비용 고정 (√칸 항 폐기)', () => {
  it('나라 크기와 무관하게 NEUTRAL_BASE × 지형 (보급선 무료 반경 안)', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const home = p.homeTileId;
    const X = s.graph.disk(home, 4).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]) && !s.map.isBase[x]);
    expect(X).toBeDefined();
    s.map.terrain[X!] = TERRAIN.PLAIN;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 100, pos: home });
    const c0 = tileCost(s, f, X!);
    expect(c0).toBe(Math.ceil((NEUTRAL_BASE * TERRAIN_COST_PERMILLE[TERRAIN.PLAIN]) / 1000));
    p.tiles = 2500; // 크기만 바꾼다 (파생값 직접 조작 — 비용식이 tiles 를 읽지 않음을 확인)
    expect(tileCost(s, f, X!)).toBe(c0);
  });
});

// ───────────────────────── 3. 손실률 ─────────────────────────

describe('v4.5 깃발 전투 손실률 0.9% (바닥 0.45%)', () => {
  it('상수 · 4a 손실 = max(S × 0.9% / n, R × 0.45% / n, 1) × 편 수, combatLoss 델타가 4b 손실과 같다', () => {
    expect(COMBAT_LOSS_BP).toBe(90);
    expect(COMBAT_LOSS_FLOOR_BP).toBe(45);
    const sim = makeSim();
    const s = sim.state;
    const c = s.players[1].homeTileId;
    const x = s.graph.neighbors(c).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
    const a = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 1000, pos: c, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    setTileOwner(s, x, 2, false);
    const b = addFlag(s, { ownerId: 2, unit: UNIT.SWORD, troops: 1000, pos: x, posture: POSTURE.ATTACK, state: 'ENGAGED', targetOwnerId: 1 });
    const plan = stage4a_flagCombatPhaseA(s, 1);
    const L = Math.floor((2_000_000 * 90) / (2 * 10000)); // 9000 milli
    const total = (plan.lossMilliByFlag.get(a.id) ?? 0) + (plan.lossMilliByFlag.get(b.id) ?? 0);
    expect(total).toBe(2 * L);
    const out = sim.step();
    const d = out.broadcast.find((m) => m.type === 'snapshot_delta') as S2C_SnapshotDelta;
    const lossOf = new Map(d.combatLoss);
    expect(lossOf.get(a.id)! + lossOf.get(b.id)!).toBe(2 * L);
    expect(lossOf.get(a.id)).toBe(1_000_000 - a.troopsMilli); // 내 땅 위 수비 = 노출 소모 없음 → 델타 값 = 실제 감소
    expect(d.combatLoss!.map(([id]) => id)).toEqual([...d.combatLoss!.map(([id]) => id)].sort((p, q) => p - q));
  });
});

// ───────────────────────── 4. 기지 피해 상한 ─────────────────────────

describe('v4.5 기지 피해 상한 300/tick', () => {
  it('splitBaseDamage: 합 ≤ 300·체력, 비례 분배, 잔여는 큰 피해 → 앞 순서', () => {
    expect(splitBaseDamage([100, 150], 22500)).toEqual([100, 150]); // 상한 아래는 그대로
    expect(splitBaseDamage([2800, 2800, 2800], 22500)).toEqual([100, 100, 100]);
    expect(splitBaseDamage([1000, 1000, 1000, 1000, 1000, 1000, 1000], 22500)).toEqual([43, 43, 43, 43, 43, 43, 42]);
    expect(splitBaseDamage([2000, 1000], 22500)).toEqual([200, 100]);
    expect(splitBaseDamage([2000, 1000], 90)).toEqual([60, 30]); // 남은 체력보다 많이 깎지 않는다
    for (const w of [[1], [299, 2], [5000, 7, 7], [1, 1, 1, 1, 1, 1, 1, 1000]]) {
      const r = splitBaseDamage(w, 22500);
      expect(r.reduce((a, b) => a + b, 0)).toBe(Math.min(BASE_HP_DMG_CAP_MILLI_PER_TICK, w.reduce((a, b) => a + b, 0)));
    }
  });

  it('깃발 6개가 빈 적 기지를 동시에 밀어도 tick 당 체력 손실 ≤ 300, 지출 = 적용 피해분, 최소 75 tick 걸린다', () => {
    const sim = makeSim();
    const s = sim.state;
    const B = s.players[2].homeTileId;
    // 기지 둘레 접촉 칸을 공격자(1) 땅으로 — 4방향 이웃에서만 기지를 민다. 같은 칸에 여러 깃발을 겹쳐 세운다
    const around = s.graph.neighbors(B).filter((t) => isClaimable(s.map.terrain[t]));
    for (const t of around) setTileOwner(s, t, 1, false);
    const flags: Flag[] = [];
    for (let i = 0; i < 6; i++) {
      flags.push(addFlag(s, { ownerId: 1, unit: UNIT.CAVALRY, troops: 2000, pos: around[i % around.length], anchor: B, posture: POSTURE.ATTACK, targetOwnerId: 2, state: 'ENGAGED', spendBudgetMilli: 750_000 }));
    }
    const base = s.bases[s.baseIndexOf.get(B)!];
    let prev = base.hpMilli;
    let ticks = 0;
    let captured = false;
    while (!captured && ticks < 200) {
      const spent0 = s.ledger.spentAP;
      const out = sim.step();
      ticks++;
      expect(ledgerImbalance(s)).toBe(0);
      captured = out.broadcast.some((m) => m.type === 'base_captured' && m.tileId === B);
      if (captured) break;
      const lost = prev - base.hpMilli;
      expect(lost).toBeLessThanOrEqual(BASE_HP_DMG_CAP_MILLI_PER_TICK);
      // 지출 ≤ Σ ceil(적용 피해 × cost / 1000) — 상한에 잘린 피해에는 병력을 쓰지 않는다 (cost ≤ 30 넉넉히)
      expect(s.ledger.spentAP - spent0).toBeLessThanOrEqual(lost * 30 + 6 * 1000);
      prev = base.hpMilli;
    }
    expect(captured).toBe(true);
    expect(ticks).toBeGreaterThanOrEqual(Math.ceil(BASE_HP_MAX_MILLI / BASE_HP_DMG_CAP_MILLI_PER_TICK));
  });
});

// ───────────────────────── 5. 기지 생산 ─────────────────────────

describe('v4.5 기지 생산 = 영토 60칸분(수도 100칸분) × 생산력, 행 합 = 총합', () => {
  it('기지 기본 병력 = 기준 390칸 평균 재생 × 환산 칸 × 생산력, 골드 = 평원 칸 × 생산력', () => {
    expect(PROD_REF_REGEN_MILLI).toBe(terrRegenBaseMilli(390));
    expect(baseRegenBaseMilli(BASE_PROD_TILES, 1000)).toBe(Math.floor((60 * PROD_REF_REGEN_MILLI) / 390));
    expect(baseRegenBaseMilli(CAPITAL_PROD_TILES, 1000)).toBe(Math.floor((100 * PROD_REF_REGEN_MILLI) / 390));
    expect(baseRegenBaseMilli(BASE_PROD_TILES, 500)).toBe(Math.floor((60 * 500 * PROD_REF_REGEN_MILLI) / (390 * 1000)));
  });

  it('수도 행 tiles = 100, 일반 기지 60, 영토 행 = 전체 칸·생산력 1000. 영토 행만 보면 기존 공식과 같다', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const B = s.map.baseTiles.filter((b) => s.owners[b] === NEUTRAL).sort((a, b) => s.graph.distance(a, p.homeTileId) - s.graph.distance(b, p.homeTileId))[0];
    setTileOwner(s, B, 1, false);
    p.troopsMilli = 0;
    const r = computeProduction(s, p);
    expect(r.yields.map((y) => y.kind)).toEqual(['base', 'base', 'territory'].slice(3 - r.yields.length));
    const cap = r.yields.find((y) => y.baseTileId === p.homeTileId)!;
    const other = r.yields.find((y) => y.baseTileId === B)!;
    const terr = r.yields[r.yields.length - 1];
    expect(cap.tiles).toBe(100);
    expect(other.tiles).toBe(60);
    expect(baseEqTiles(s, p.homeTileId)).toBe(100);
    expect(terr).toMatchObject({ kind: 'territory', baseTileId: -1, tiles: p.tiles, prodPm: 1000 });
    // 기지가 없다면(가상) 영토만 → 기존 economy 식
    const terrOnly = applyRegenMult(p, terrRegenBaseMilli(p.tiles));
    expect(terrOnly).toBe(regenMilliPerTick(p));
    expect(r.regenMilli).toBeGreaterThan(regenMilliPerTick(p));
    expect(r.grossMilli).toBeGreaterThan(grossGoldMilliPerTick(p));
    // 수도 기지 생산 > 일반 기지 (100 vs 60칸분)
    expect(cap.troopsMilli).toBeGreaterThan(other.troopsMilli);
    expect(cap.goldGrossMilli).toBeGreaterThan(other.goldGrossMilli);
  });

  it('생산력 50% 기지는 그 행만 줄고 영토 행·다른 기지 행 가중치는 그대로', () => {
    const s = makeSim().state;
    const p = s.players[1];
    const B = s.map.baseTiles.filter((b) => s.owners[b] === NEUTRAL).sort((a, b) => s.graph.distance(a, p.homeTileId) - s.graph.distance(b, p.homeTileId))[0];
    setTileOwner(s, B, 1, false);
    p.troopsMilli = 0;
    const full = computeProduction(s, p);
    s.bases[s.baseIndexOf.get(B)!].prodScaled = 500 * TICKS_PER_MIN;
    const half = computeProduction(s, p);
    const row = (r: typeof full, b: number) => r.yields.find((y) => y.baseTileId === b)!;
    expect(row(half, B).prodPm).toBe(500);
    expect(row(half, B).goldGrossMilli).toBeLessThan(row(full, B).goldGrossMilli);
    expect(row(half, B).troopsMilli).toBeLessThan(row(full, B).troopsMilli);
    expect(half.regenMilli).toBeLessThan(full.regenMilli);
    // 골드는 선형이라 다른 행 값이 그대로 (분배 잔여 ±1 milli 허용)
    expect(Math.abs(row(half, p.homeTileId).goldGrossMilli - row(full, p.homeTileId).goldGrossMilli)).toBeLessThanOrEqual(1);
    const terr = (r: typeof full) => r.yields[r.yields.length - 1];
    expect(Math.abs(terr(half).goldGrossMilli - terr(full).goldGrossMilli)).toBeLessThanOrEqual(1);
  });

  it('봇 판 1500 tick: 매 50 tick 행 합 = 총 생산(병력·그로스·순골드), 기지 행 = 내 기지 ASC, 스냅숏 rows = 2단계 내역', () => {
    const map = generateMapForPlayers(77, 8);
    const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })));
    const sim = new Simulation(s, CivBot);
    let checked = 0;
    let sawPenalty = false;
    for (let i = 0; i < 1500 && !sim.finished; i++) {
      sim.step();
      if (s.tick % 50 !== 0) continue;
      for (const p of s.players) {
        if (!p || !p.alive) continue;
        const r = computeProduction(s, p);
        const sum = (k: 'troopsMilli' | 'goldGrossMilli' | 'goldNetMilli') => r.yields.reduce((a, y) => a + y[k], 0);
        expect(sum('troopsMilli')).toBe(r.regenMilli);
        expect(sum('goldGrossMilli')).toBe(r.grossMilli);
        expect(sum('goldNetMilli')).toBe(r.netMilli);
        expect(r.yields.filter((y) => y.kind === 'base').map((y) => y.baseTileId)).toEqual(p.baseTiles);
        expect(r.yields.filter((y) => y.kind === 'territory')).toHaveLength(1);
        for (const y of r.yields) if (y.kind === 'base') {
          expect(y.tiles).toBe(baseEqTiles(s, y.baseTileId));
          expect(y.prodPm).toBe(baseProdPm(s.bases[s.baseIndexOf.get(y.baseTileId)!]));
          if (y.prodPm < 1000) sawPenalty = true;
        }
        checked++;
      }
      const full = buildSnapshotFull(s);
      for (const pp of full.production!) {
        const ys = s.yields[pp.playerId] ?? [];
        expect(pp.rows.map((x) => x.troopsPerSecMilli)).toEqual(ys.map((y) => y.troopsMilli * 5));
        expect(pp.rows.map((x) => x.kind)).toEqual(ys.map((y) => y.kind));
        if (pp.rows.length) expect(pp.rows[pp.rows.length - 1]).toMatchObject({ kind: 'territory', baseTileId: null });
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(sawPenalty).toBe(true); // 중립 기지 점령 → 생산력 50% 가 실제로 나온다
  });
});

// ───────────────────────── 6. 기지 ×1.5 ─────────────────────────

describe('v4.5 기지 ×1.5 — 태세 무관', () => {
  it('방어 = 지형 항 대체 1500, 공격 = 공격값 × 1.5. 남의 기지·기지 밖은 해당 없음', () => {
    const s = makeSim().state;
    const cap = s.players[1].homeTileId;
    s.map.terrain[cap] = TERRAIN.HILLS;
    for (const unit of [UNIT.SPEAR, UNIT.SWORD, UNIT.CAVALRY] as const) {
      const f = addFlag(s, { ownerId: 1, unit, troops: 100, pos: cap, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      expect(flagValue(s, f, [f])).toBe(Math.floor((UNIT_DEF_PERMILLE[unit] * 1500) / 1000));
      f.posture = POSTURE.ATTACK;
      expect(flagValue(s, f, [f])).toBe(Math.floor((UNIT_ATK_PERMILLE[unit] * 1500) / 1000));
      // 남의 기지 칸이면 공격 ×1.0, 방어 = 지형
      setTileOwner(s, cap, 2, false);
      expect(flagValue(s, f, [f])).toBe(UNIT_ATK_PERMILLE[unit]);
      f.posture = POSTURE.DEFEND;
      expect(flagValue(s, f, [f])).toBe(Math.floor((UNIT_DEF_PERMILLE[unit] * 1300) / 1000));
      setTileOwner(s, cap, 1, false);
    }
  });
});

// ───────────────────────── 7. 지명 ─────────────────────────

describe('v4.5 지명 양식', () => {
  it('서양식 판타지 ≥ 120, 동양식 보관, 양식 간 중복 없음', () => {
    expect(PLACE_NAME_POOLS.western.length).toBeGreaterThanOrEqual(120);
    expect(new Set(PLACE_NAME_POOLS.western).size).toBe(PLACE_NAME_POOLS.western.length);
    expect(PLACE_NAME_POOLS.eastern.length).toBeGreaterThanOrEqual(1);
    const all = [...PLACE_NAME_POOLS.western, ...PLACE_NAME_POOLS.eastern];
    expect(new Set(all).size).toBe(all.length);
    expect(ACTIVE_PLACE_NAME_STYLES).toEqual(['western']);
  });
  it('매치 지명은 한 양식 안에서만 — 시드 50개, 지금은 전부 서양식', () => {
    const west = new Set(PLACE_NAME_POOLS.western);
    for (let seed = 0; seed < 50; seed++) {
      expect(pickPlaceNameStyle(seed * 7919)).toBe('western');
      const names = assignPlaceNames(seed * 7919, 24);
      expect(new Set(names).size).toBe(24);
      for (const n of names) expect(west.has(n)).toBe(true);
    }
    // 양식을 지정하면 그 양식 안에서만
    const east = new Set(PLACE_NAME_POOLS.eastern);
    for (const n of assignPlaceNames(5, 24, 'eastern')) expect(east.has(n)).toBe(true);
    // 실제 게임 상태도 서양식
    for (const n of makeSim().state.baseNames) expect(west.has(n)).toBe(true);
  });
});

// ───────────────────────── 8. 방어 태세 경로 — 적 땅 통과 금지 (§22.12) ─────────────────────────

describe('v4.5 방어 태세 깃발은 적 땅을 지나지 못한다', () => {
  /** 반경 9 가 전부 중립 육지인 중심 — 평원으로 만든다 */
  function arena() {
    const sim = makeSim();
    const s = sim.state;
    const W = s.map.width;
    let c = -1;
    for (let t = 0; t < s.owners.length && c < 0; t++) {
      const row = Math.floor(t / W);
      const col = t % W;
      if (row < 11 || col < 11 || row >= s.map.height - 11 || col >= W - 11) continue;
      if (s.graph.disk(t, 9).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === NEUTRAL)) c = t;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    for (const t of s.graph.disk(c, 9)) s.map.terrain[t] = TERRAIN.PLAIN;
    return { sim, s, c, W };
  }
  const walk = (sim: Simulation, f: Flag, n: number) => {
    const visited: number[] = [];
    const idle: string[] = [];
    for (let i = 0; i < n && sim.state.flags.includes(f); i++) {
      const out = sim.step();
      visited.push(f.posTileId);
      for (const m of out.broadcast) if (m.type === 'flag_idle' && m.flagId === f.id) idle.push(m.reason);
      if (f.state !== 'MARCHING') break;
    }
    return { visited, idle };
  };

  it('적 땅 벽을 돌아간다 (중립은 지나간다) — 공격 태세 경로는 그대로 벽을 가로지른다', async () => {
    const { nextStep } = await import('../src/game/rules.js');
    const { sim, s, c, W } = arena();
    const S = c - 4;
    const A = c + 4;
    setTileOwner(s, S, 1, false);
    setTileOwner(s, A, 1, false);
    const wall = [-2, -1, 0, 1, 2].map((d) => c + d * W);
    for (const t of wall) setTileOwner(s, t, 2, false);
    // 공격 태세 경로(기존 stepToward)는 직선 — 벽 칸을 밟는다
    const probe = makeFlag({ id: 999, ownerId: 1, slotIndex: 0, unit: UNIT.SWORD, troopsMilli: 1, initialTroops: 1, posTileId: S, anchorTileId: A, originTileId: S });
    const atkPath: number[] = [];
    for (let pos = S, k = 0; pos !== A && k < 40; k++) atkPath.push((pos = nextStep(s, probe, pos, A)));
    expect(atkPath.some((t) => wall.includes(t))).toBe(true);
    // 방어 태세는 벽을 피해 A 에 도착(ENGAGED)
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: S, anchor: A, posture: POSTURE.DEFEND, state: 'MARCHING', targetOwnerId: 254 });
    const r = walk(sim, f, 400);
    expect(r.visited.some((t) => s.owners[t] === 2)).toBe(false);
    expect(f.posTileId).toBe(A);
    expect(f.state).toBe('ENGAGED');
    expect(r.visited.length).toBeGreaterThan(8); // 직선(8칸)보다 길다
  });

  it('적 땅 없이는 못 가면 목적지에 가장 가까운 칸(적 땅 바로 앞)에서 멈추고 IDLE(unreachable)', async () => {
    const { defendDest, getField } = await import('../src/game/rules.js');
    const { sim, s, c, W } = arena();
    const S = c - 6;
    const A = c + 3;
    setTileOwner(s, S, 1, false);
    for (const t of s.graph.disk(A, 1)) setTileOwner(s, t, 1, false);
    for (const t of s.graph.disk(A, 3)) if (s.graph.distance(t, A) >= 2) setTileOwner(s, t, 2, false); // 두께 2 고리
    const stop = defendDest(s, 1, S, A);
    expect(stop).not.toBe(A);
    expect(s.owners[stop]).not.toBe(2);
    expect(s.graph.neighbors(stop).some((n) => s.owners[n] === 2)).toBe(true); // 적 땅 바로 앞
    const terr = getField(s, A);
    expect(terr[stop]).toBe(Math.min(...s.graph.disk(A, 6).filter((t) => s.owners[t] !== 2 && s.graph.distance(t, A) >= 4).map((t) => terr[t])));
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 500, pos: S, anchor: A, posture: POSTURE.DEFEND, state: 'MARCHING', targetOwnerId: 254 });
    const r = walk(sim, f, 400);
    expect(r.visited.some((t) => s.owners[t] === 2)).toBe(false);
    expect(f.posTileId).toBe(stop);
    expect(f.state).toBe('IDLE');
    expect(r.idle).toEqual(['unreachable']);
    void W;
  });

  it('행군 중 공격 → 방어 전환: 다음 걸음부터 적 땅을 피한다 / 귀환은 그대로 적 땅을 지난다', async () => {
    const { nextStep, stepToward } = await import('../src/game/rules.js');
    const { s, c, W } = arena();
    const S = c - 1;
    const A = c + 4;
    setTileOwner(s, S, 1, false);
    setTileOwner(s, A, 1, false);
    for (const d of [-2, -1, 0, 1, 2]) setTileOwner(s, c + d * W, 2, false);
    const f = makeFlag({ id: 998, ownerId: 1, slotIndex: 0, unit: UNIT.SWORD, troopsMilli: 1, initialTroops: 1, posTileId: S, anchorTileId: A, originTileId: S });
    expect(nextStep(s, f, S, A)).toBe(c); // 공격: 바로 옆 적 칸으로
    f.posture = POSTURE.DEFEND;
    expect(s.owners[nextStep(s, f, S, A)]).not.toBe(2); // 방어: 피한다
    f.state = 'RETURNING';
    expect(nextStep(s, f, S, A)).toBe(stepToward(s, 1, S, A)); // 귀환: 제한 없음
  });
});

// ───────────────────────── 9. 노출 소모 — 중립 땅은 절반 (§22.13) ─────────────────────────

describe('v4.5 노출 소모: 적 땅 0.05% / 중립 땅 0.025% / 내 땅·동맹 땅 0', () => {
  it('비율·최소값', async () => {
    const { exposureLossMilli } = await import('../src/game/movement.js');
    const s = makeSim().state;
    const home = s.players[1].homeTileId;
    const neutral = s.graph.disk(home, 6).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]))!;
    const enemy = s.players[2].homeTileId;
    const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 4000, pos: enemy });
    expect(exposureLossMilli(s, f)).toBe(2000); // 4,000,000 × 5 / 10000
    f.posTileId = neutral;
    expect(exposureLossMilli(s, f)).toBe(1000); // 절반: × 25 / 100000
    f.posTileId = home;
    expect(exposureLossMilli(s, f)).toBe(0);
    // 동맹 땅 = 0
    s.alliances.push({ a: 1, b: 2, state: 'ACTIVE', sinceTick: 0, breakAtTick: null });
    const { rebuildAllyMatrix } = await import('../src/game/state.js');
    rebuildAllyMatrix(s);
    f.posTileId = enemy;
    expect(exposureLossMilli(s, f)).toBe(0);
    s.alliances.length = 0;
    rebuildAllyMatrix(s);
    // 작은 깃발: 최소값 — 적 땅 1000, 중립 500 milli/tick
    f.troopsMilli = 100_000;
    expect(exposureLossMilli(s, f)).toBe(1000);
    f.posTileId = neutral;
    expect(exposureLossMilli(s, f)).toBe(500);
    // 남은 병력보다 많이 깎지 않는다 · 패주 깃발 면제(기존)
    f.troopsMilli = 300;
    expect(exposureLossMilli(s, f)).toBe(300);
    f.routed = true;
    expect(exposureLossMilli(s, f)).toBe(0);
  });

  it('시뮬레이션: 중립 위 IDLE 깃발이 1분에 잃는 병력 ≈ 적 땅의 절반 (분당 ≈7% vs ≈14%)', () => {
    const run1 = (enemy: boolean) => {
      const sim = makeSim();
      const s = sim.state;
      const home = s.players[1].homeTileId;
      const pos = enemy ? s.players[3].homeTileId : s.graph.disk(home, 6).find((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]) && !s.map.isBase[x])!;
      const f = addFlag(s, { ownerId: 1, unit: UNIT.SWORD, troops: 5000, pos, posture: POSTURE.DEFEND, state: 'IDLE', idleSinceTick: 0 });
      for (let i = 0; i < TICKS_PER_MIN; i++) sim.step();
      return 5000 - f.troopsMilli / 1000;
    };
    const lossEnemy = run1(true);
    const lossNeutral = run1(false);
    expect(lossEnemy / 5000).toBeGreaterThan(0.13);
    expect(lossEnemy / 5000).toBeLessThan(0.15);
    expect(lossNeutral / 5000).toBeGreaterThan(0.065);
    expect(lossNeutral / 5000).toBeLessThan(0.08);
  });
});
