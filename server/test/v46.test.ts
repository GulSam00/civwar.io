/**
 * 사용자 2026-10-18 (프로토콜 §23): 봇 세력 이름(항목 8) · 플레이어별 동맹 파기 수 allyBreaks(항목 6 정보 카드용).
 */
import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX_LEN, type S2C_SnapshotDelta } from '@civwar/shared';
import { DeltaTracker, buildSnapshotFull } from '../src/game/snapshot.js';
import { createGameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMapForPlayers } from '../src/map/generate.js';
import {
  ACTIVE_PLACE_NAME_STYLES,
  FACTION_CORE_POOLS,
  FACTION_FORMS,
  FACTION_NAME_MAX_LEN,
  PLACE_NAME_POOLS,
  assignFactionNames,
  assignPlaceNames,
  factionCore,
  type PlaceNameStyle,
} from '../src/map/placeNames.js';

const STYLES: PlaceNameStyle[] = ['western', 'eastern'];

describe('§23 세력 이름 풀', () => {
  it('세력 전용 핵심어는 모든 지명 풀과 겹치지 않고, 양식끼리도 겹치지 않는다', () => {
    const allPlaces = new Set(STYLES.flatMap((s) => PLACE_NAME_POOLS[s]));
    for (const s of STYLES) {
      expect(new Set(FACTION_CORE_POOLS[s]).size).toBe(FACTION_CORE_POOLS[s].length);
      for (const c of FACTION_CORE_POOLS[s]) {
        expect(allPlaces.has(c)).toBe(false);
        expect(c.includes(' ')).toBe(false);
      }
    }
    const w = new Set(FACTION_CORE_POOLS.western); // 꼴(왕국 등)은 양식끼리 겹쳐도 된다 — 핵심어가 양식을 정한다
    for (const x of FACTION_CORE_POOLS.eastern) expect(w.has(x)).toBe(false);
  });

  it('길이 상한 = NICKNAME_MAX_LEN, 가능한 모든 조합이 상한 안', () => {
    expect(FACTION_NAME_MAX_LEN).toBe(NICKNAME_MAX_LEN);
    for (const s of STYLES) {
      const cores = [...FACTION_CORE_POOLS[s], ...PLACE_NAME_POOLS[s]];
      const longest = Math.max(...cores.map((c) => c.length)) + 1 + Math.max(...FACTION_FORMS[s].map((f) => f.length));
      expect(longest).toBeLessThanOrEqual(NICKNAME_MAX_LEN);
    }
  });

  it('고유 · 결정론 · ≤16자 · 한 양식 안 · exclude(지명) 핵심어 회피 — 시드 200개', () => {
    for (const style of STYLES) {
      const coreSet = new Set([...FACTION_CORE_POOLS[style], ...PLACE_NAME_POOLS[style]]);
      const formSet = new Set(FACTION_FORMS[style]);
      for (let seed = 0; seed < 200; seed++) {
        const places = assignPlaceNames(seed, 24, style);
        const a = assignFactionNames(seed, 12, { style, exclude: places });
        expect(a).toEqual(assignFactionNames(seed, 12, { style, exclude: places }));
        expect(a).toHaveLength(12);
        expect(new Set(a).size).toBe(12);
        const placeSet = new Set(places);
        for (const n of a) {
          expect(n.length).toBeLessThanOrEqual(NICKNAME_MAX_LEN);
          const core = factionCore(n);
          expect(coreSet.has(core)).toBe(true);
          expect(formSet.has(n.slice(core.length + 1))).toBe(true);
          expect(placeSet.has(core)).toBe(false);
        }
      }
    }
  });

  it('시드가 다르면 이름이 다르다 · 기본 양식 = 활성 양식(서양식)', () => {
    expect(ACTIVE_PLACE_NAME_STYLES).toEqual(['western']);
    expect(assignFactionNames(1, 8)).not.toEqual(assignFactionNames(2, 8));
    const formSet = new Set(FACTION_FORMS.western);
    for (const n of assignFactionNames(77, 12)) expect(formSet.has(n.slice(factionCore(n).length + 1))).toBe(true);
  });

  it('핵심어가 모자라면 "이름 2" 꼴로 고유성 유지', () => {
    const big = assignFactionNames(5, 500);
    expect(new Set(big).size).toBe(500);
  });
});

describe('§23 allyBreaks', () => {
  function allySim() {
    const N = 8;
    const map = generateMapForPlayers(4242, N);
    const sim = new Simulation(createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true }))));
    return sim;
  }
  const run = (sim: Simulation, n: number) => {
    const all: ReturnType<Simulation['step']>['broadcast'] = [];
    for (let i = 0; i < n; i++) all.push(...sim.step().broadcast);
    return all;
  };

  it('파기 시작한 쪽만 +1 → snapshot_full 에 항상 · 델타엔 바뀐 때만', () => {
    const sim = allySim();
    const s = sim.state;
    expect(buildSnapshotFull(s).players.map((p) => p.allyBreaks)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    sim.enqueue(1, 1, { type: 'cmd_ally_propose', clientSeq: 1, targetPlayerId: 2 });
    sim.enqueue(2, 2, { type: 'cmd_ally_propose', clientSeq: 1, targetPlayerId: 1 }); // 상호 제안 → 즉시 성립
    run(sim, 2);
    expect(s.alliances).toHaveLength(1);
    run(sim, 400); // 최소 유지 시간
    const tracker = new DeltaTracker(s);
    // 파기 전 델타: allyBreaks 없음
    let deltas: S2C_SnapshotDelta[] = [];
    for (let i = 0; i < 10; i++) {
      sim.step();
      deltas.push(tracker.buildDelta(s));
    }
    expect(deltas.flatMap((d) => d.playerDeltas).some((pd) => 'allyBreaks' in pd)).toBe(false);
    sim.enqueue(2, 2, { type: 'cmd_ally_break', clientSeq: 2, allyPlayerId: 1 });
    deltas = [];
    let started = false;
    for (let i = 0; i < 10; i++) {
      const out = sim.step();
      if (out.broadcast.some((m) => m.type === 'ally_break_started' && m.byPlayerId === 2)) started = true;
      deltas.push(tracker.buildDelta(s));
    }
    expect(started).toBe(true);
    expect(s.players[2].allyBreaks).toBe(1);
    expect(s.players[1].allyBreaks).toBe(0);
    const withBreaks = deltas.flatMap((d) => d.playerDeltas).filter((pd) => pd.allyBreaks !== undefined);
    expect(withBreaks).toEqual([expect.objectContaining({ id: 2, allyBreaks: 1 })]);
    expect(buildSnapshotFull(s).players.map((p) => p.allyBreaks)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
    // 이후 델타엔 다시 안 실린다
    deltas = [];
    for (let i = 0; i < 10; i++) {
      sim.step();
      deltas.push(tracker.buildDelta(s));
    }
    expect(deltas.flatMap((d) => d.playerDeltas).some((pd) => pd.allyBreaks !== undefined)).toBe(false);
  });
});
