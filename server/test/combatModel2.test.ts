/**
 * §33 전투 모델 2 (COMBAT_MODEL 병존 플래그) — 설계 05_combat_redesign_draft.md rev.4.
 *  1) shared/combatMath 단위 (문서 시나리오 표 숫자 재현)
 *  2) 모델 1 비트 동일: 변경 전 코드에서 뽑은 골든 해시와 일치
 *  3) 모델 2 결정론·회계 불변식·사기 규칙·프로토콜 스키마
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BASE_BUFF,
  MAP_SIZE_PRESETS,
  MORALE_MAX,
  POSTURE,
  TERRAIN,
  UNIT,
  TECH_STAT,
  TECH_STAT_BASE,
  TECH_STAT_COUNT,
  channelValues,
  flagScalar,
  moraleMultiplier,
  sideLossDetail,
  sideLossShares,
  techStatValues,
  type BotDifficultyName,
  type CombatFlagInput,
  type ServerMessage,
} from '@civwar/shared';
import { validateMessage } from '../scripts/qa-schema.js';
import { CivBot } from '../src/game/bot.js';
import { combatInput, stage4a_flagCombatPhaseA, stage4b_flagCombatPhaseB } from '../src/game/combat.js';
import { newOutbox } from '../src/game/outbox.js';
import { buildMatchConfig } from '../src/game/snapshot.js';
import { createGameState, defaultCombatModel, ledgerImbalance, makeFlag, type Flag, type GameState } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap, generateMapForPlayers } from '../src/map/generate.js';
import { isClaimable } from '@civwar/shared';

// ───────────────────────── 1) combatMath 단위 ─────────────────────────

const NO_TECH = techStatValues(0);
const T = 2_000_000; // 총량이 충분히 커서 반올림·병력 상한 영향이 없다
function inp(unit: number, posture: number, o: Partial<CombatFlagInput> = {}): CombatFlagInput {
  return { unit, posture, terrain: TERRAIN.PLAIN, onOwnBase: false, troopsMilli: 3_000_000, morale: MORALE_MAX, disengage: false, statPm: NO_TECH, ...o };
}
/** 첫 tick 에 a 편(1깃발)이 잃는 비율 % */
function lossPct(a: CombatFlagInput, d: CombatFlagInput): number {
  return (sideLossShares([[a], [d]], T)[0] * 100) / T;
}
const near = (x: number, y: number, tol = 0.06) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThan(tol);
const U = UNIT;

describe('combatMath — 문서 시나리오 숫자 재현 (사기 만땅 양쪽 동일)', () => {
  it('2.7 공격 대 방어 평지 손실% 3x3 표 (신규)', () => {
    const rows: [number, number[]][] = [
      [U.SPEAR, [50.0, 50.2, 52.0]],
      [U.SWORD, [49.7, 50.0, 51.8]],
      [U.CAVALRY, [47.8, 48.1, 50.0]],
    ];
    for (const [au, exp] of rows) for (const du of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(au, POSTURE.ATTACK), inp(du, POSTURE.DEFEND)), exp[du]);
  });

  it('2.7 공격 대 공격(조우전) 표', () => {
    const rows: [number, number[]][] = [
      [U.SPEAR, [50.0, 51.2, 54.4]],
      [U.SWORD, [48.8, 50.0, 53.3]],
      [U.CAVALRY, [45.6, 46.7, 50.0]],
    ];
    for (const [au, exp] of rows) for (const du of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(au, POSTURE.ATTACK), inp(du, POSTURE.ATTACK)), exp[du]);
  });

  it('같은 병종 거울 평지는 50:50 (평지 방어 이점 없음)', () => {
    for (const u of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(u, POSTURE.ATTACK), inp(u, POSTURE.DEFEND)), 50.0, 0.01);
  });

  it('4절 지형 확인: 검병 거울 방어 지형별 공격측 손실 구릉 56.6 / 산 61.5 / 비옥 51.2 / 사막 48.7, 구릉 위 공격 47.6', () => {
    const sw = (ter: number) => lossPct(inp(U.SWORD, POSTURE.ATTACK), inp(U.SWORD, POSTURE.DEFEND, { terrain: ter }));
    near(sw(TERRAIN.HILLS), 56.6);
    near(sw(TERRAIN.MOUNTAIN), 61.5);
    near(sw(TERRAIN.FERTILE), 51.2);
    near(sw(TERRAIN.DESERT), 48.7);
    near(lossPct(inp(U.SWORD, POSTURE.ATTACK, { terrain: TERRAIN.HILLS }), inp(U.SWORD, POSTURE.DEFEND)), 47.6);
  });

  it('2.8 이탈 x0.7: 검병 거울, 이탈 대기 방어 깃발 손실 67.1%', () => {
    near(lossPct(inp(U.SWORD, POSTURE.DEFEND, { disengage: true }), inp(U.SWORD, POSTURE.ATTACK)), 67.1);
  });

  it('2.9 기지 양 채널 배율(BASE_BUFF): 문서 수치는 1300 기준이므로 배율이 1300 일 때만 재현값과 비교하고 아니면 방향(손실 감소)만 확인', () => {
    const cavVsBaseSpear = lossPct(inp(U.CAVALRY, POSTURE.ATTACK), inp(U.SPEAR, POSTURE.DEFEND, { onOwnBase: true }));
    const cavVsPlainSpear = lossPct(inp(U.CAVALRY, POSTURE.ATTACK), inp(U.SPEAR, POSTURE.DEFEND));
    if (BASE_BUFF[1][0] === 1300 && BASE_BUFF[1][1] === 1300) {
      near(cavVsBaseSpear, 68.0);
      near(lossPct(inp(U.SWORD, POSTURE.ATTACK), inp(U.SWORD, POSTURE.DEFEND, { onOwnBase: true })), 62.8);
      near(lossPct(inp(U.SPEAR, POSTURE.ATTACK), inp(U.SPEAR, POSTURE.DEFEND, { onOwnBase: true })), 62.8);
      near(lossPct(inp(U.SWORD, POSTURE.ATTACK, { onOwnBase: true }), inp(U.SWORD, POSTURE.DEFEND)), 37.2);
    } else {
      expect(cavVsBaseSpear).toBeGreaterThan(cavVsPlainSpear);
    }
  });

  it('기지 칸은 지형 항을 대체한다 (곱하지 않음): 산 위 기지 = 평지 기지', () => {
    const a = channelValues(inp(U.SPEAR, POSTURE.DEFEND, { onOwnBase: true, terrain: TERRAIN.MOUNTAIN, morale: 800 })); // m=800 -> 사기 곱 1000
    const b = channelValues(inp(U.SPEAR, POSTURE.DEFEND, { onOwnBase: true, terrain: TERRAIN.PLAIN, morale: 800 }));
    expect(a).toEqual(b);
    expect(b).toEqual([Math.floor((900 * BASE_BUFF[1][0]) / 1000), Math.floor((1100 * BASE_BUFF[1][1]) / 1000)]);
  });

  it('채널값은 단계마다 floor, 최소 1, 지형표 7행 (공격 태세 / 방어 태세)', () => {
    const exp: Record<number, [number[], number[]]> = {
      [TERRAIN.DEEP]: [[1000, 1000], [1000, 1000]],
      [TERRAIN.PLAIN]: [[1000, 1000], [1000, 1000]],
      [TERRAIN.FERTILE]: [[1000, 1000], [1000, 1050]],
      [TERRAIN.HILLS]: [[1100, 1000], [1000, 1300]],
      [TERRAIN.DESERT]: [[1100, 1000], [1000, 950]],
      [TERRAIN.MOUNTAIN]: [[1000, 1150], [1000, 1600]],
      [TERRAIN.SHALLOW]: [[1000, 1000], [1000, 1000]],
    };
    for (const [ter, [atkRow, defRow]] of Object.entries(exp)) {
      // 검병: 능력치 1000/1000, 사기 곱은 800 에서 1000 이므로 지형 배율이 그대로 보인다
      expect(channelValues(inp(U.SWORD, POSTURE.ATTACK, { terrain: Number(ter), morale: 800 }))).toEqual(atkRow);
      expect(channelValues(inp(U.SWORD, POSTURE.DEFEND, { terrain: Number(ter), morale: 800 }))).toEqual(defRow);
    }
    // 단계 floor: 창병(ATK 900) 공격 사막 1.1 -> 990, 사기 m=800(곱 1000) 그대로
    expect(channelValues(inp(U.SPEAR, POSTURE.ATTACK, { terrain: TERRAIN.DESERT, morale: 800 }))[0]).toBe(Math.floor((900 * 1100) / 1000));
    expect(channelValues(inp(U.SPEAR, POSTURE.ATTACK, { morale: 0 }))[0]).toBe(Math.floor((900 * 600) / 1000));
  });

  it('5.1 사기 곱 경계: m=1000 -> 1100, 800 -> 1000, 0 -> 600, 상한 1500', () => {
    expect(moraleMultiplier(U.SWORD, 1000, NO_TECH)).toBe(1100);
    expect(moraleMultiplier(U.SWORD, 800, NO_TECH)).toBe(1000);
    expect(moraleMultiplier(U.SWORD, 0, NO_TECH)).toBe(600);
    const st = NO_TECH.slice();
    st[TECH_STAT.MORALE_FULL_BONUS_CAVALRY] = 2000; // 예약 칸에 큰 값을 넣어도
    expect(moraleMultiplier(U.CAVALRY, 1000, st)).toBe(1500);
    expect(moraleMultiplier(U.SWORD, 1000, st)).toBe(1100); // 다른 병종은 영향 없음
    st[TECH_STAT.MORALE_FULL_BONUS_CAVALRY] = 100; // T1 기세 +20% (1100 -> 1200)
    expect(moraleMultiplier(U.CAVALRY, 1000, st)).toBe(1200);
  });

  it('5.2 병종별 사기 곱: 10초(50 tick) 창 1025 / 검 950 / 기 850, 20초 기병 600', () => {
    const at = (u: number, perTick: number, ticks: number) => moraleMultiplier(u, Math.max(0, 1000 - perTick * ticks), NO_TECH);
    expect(at(U.SPEAR, 3, 50)).toBe(1025);
    expect(at(U.SWORD, 6, 50)).toBe(950);
    expect(at(U.CAVALRY, 10, 50)).toBe(850);
    expect(at(U.CAVALRY, 10, 100)).toBe(600);
    expect(at(U.SPEAR, 3, 335)).toBe(600 + Math.floor((500 * 0) / 1000)); // 약 67초에 바닥 (1000 - 1005 -> 0)
  });

  it('5.5(a) 사기 소모 후 상성: 기 vs 창 조우전 0초 45.6% → 10초 54.4% (기병 850 / 창 1025) → 20초 66.7%', () => {
    const f = (ticks: number) => lossPct(inp(U.CAVALRY, POSTURE.ATTACK, { morale: Math.max(0, 1000 - 10 * ticks) }), inp(U.SPEAR, POSTURE.ATTACK, { morale: Math.max(0, 1000 - 3 * ticks) }));
    near(f(0), 45.6);
    near(f(50), 54.4);
    near(f(100), 66.7);
  });

  it('손실 총량 불변: Σloss == T (병력 상한 전), 편 순서를 바꿔도 같은 편 손실(잔여 milli 1~2 제외)', () => {
    const S = (u: number, p: number, o: Partial<CombatFlagInput> = {}) => [inp(u, p, o)];
    const sides = [S(U.SPEAR, POSTURE.DEFEND, { terrain: TERRAIN.HILLS }), S(U.CAVALRY, POSTURE.ATTACK), S(U.SWORD, POSTURE.ATTACK, { morale: 300 })];
    for (const total of [3, 1000, 12345, 2_000_000]) {
      const det = sideLossDetail(sides, total);
      expect(det.reduce((a, d) => a + d.lossMilli, 0)).toBe(total);
    }
    const a = sideLossShares(sides, 1_000_000);
    const rev = sideLossShares([sides[2], sides[1], sides[0]], 1_000_000);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - rev[2 - i])).toBeLessThanOrEqual(2);
    // 병력 상한
    expect(sideLossShares([[inp(U.SWORD, POSTURE.ATTACK, { troopsMilli: 5 })], [inp(U.SWORD, POSTURE.DEFEND)]], 2000)[0]).toBe(5);
  });

  it('편 안 혼합: 병력 가중 채널값·ω (병력 3:1 공격/방어 혼합)', () => {
    const det = sideLossDetail(
      [[inp(U.SWORD, POSTURE.ATTACK, { troopsMilli: 3000 }), inp(U.SWORD, POSTURE.DEFEND, { troopsMilli: 1000 })], [inp(U.SWORD, POSTURE.ATTACK)]],
      1000,
    );
    expect(det[0].omegaA).toBe(Math.floor((3000 * 600 + 1000 * 400) / 4000)); // 550
    expect(det[0].troopsMilli).toBe(4000);
  });

  it('정수 범위: 극단 입력에서도 안전한 정수·합 보존 (T 9e6, 병력 1e8, 5편)', () => {
    const sides = Array.from({ length: 5 }, (_, i) => [inp(i % 3, i % 2, { troopsMilli: 1e8, morale: i * 250, onOwnBase: i === 1, terrain: TERRAIN.MOUNTAIN })]);
    const det = sideLossDetail(sides, 9_000_000);
    for (const d of det) {
      expect(Number.isSafeInteger(d.lossMilli)).toBe(true);
      expect(Number.isSafeInteger(d.raw)).toBe(true);
    }
    expect(det.reduce((a, d) => a + d.lossMilli, 0)).toBe(9_000_000);
  });

  it('테크 예약 스탯: 기본값은 효과 없음 (statPm 길이 50, 앞 32칸 길이 불변), 없는 칸(구 서버 설정)도 같은 값', () => {
    expect(TECH_STAT_COUNT).toBe(50);
    expect(NO_TECH.length).toBe(50);
    expect(TECH_STAT_BASE.slice(0, 32).length).toBe(32);
    const f = inp(U.CAVALRY, POSTURE.ATTACK);
    expect(channelValues(f)).toEqual(channelValues({ ...f, statPm: NO_TECH.slice(0, 32) }));
    expect(flagScalar(f)).toBe(Math.floor((600 * channelValues(f)[0] + 400 * channelValues(f)[1]) / 1000));
  });

  it('테크 채널별 적용 (A-D6): COMBAT_ATK 는 태세와 무관하게 ATK 채널에만', () => {
    const st = NO_TECH.slice();
    st[TECH_STAT.COMBAT_ATK] = 14; // 2026-10-24: 점수 (+14점 = +140‰, 병종 기본에 더한 뒤 지형 배율)
    const base = channelValues(inp(U.SWORD, POSTURE.DEFEND, { morale: 800 }));
    const up = channelValues(inp(U.SWORD, POSTURE.DEFEND, { morale: 800, statPm: st }));
    expect(up[0]).toBeGreaterThan(base[0]);
    expect(Math.abs(up[0] - Math.floor((base[0] * 1140) / 1000))).toBeLessThanOrEqual(2); // 병종 기본 1000 → 1140 (배율을 곱하기 전에 더한다)
    expect(up[1]).toBe(base[1]);
  });
});

// ───────────────────────── 2) 모델 1 비트 동일 (골든 해시) ─────────────────────────

/**
 * 방송·개인 메시지 전 tick JSON + 최종 상태 해시. 모델 2 도입 때는 변경 전 코드에서 뽑아 모델 1 비트 동일을 증명했고,
 * 2026-10-24 봇 '약한 적 우선'(A-167)과 테크 개편(4티어·절대 점수, 봇 테크 목록 교체, 병종 점령 소모·편성비 개편)으로 봇 행동이 달라져 그 시점 코드로 다시 뽑았다(회귀 고정용).
 */
const GOLDEN = {
  G1: { stream: '1a4fb4305c520eb6817c4739f406836be24ba5e4005e3c0a5a85e9239625cc09', state: '86ce6618d9a6a0811eee237e9e3b482f04e0263bd78a12bf8059e26702c01744' },
  G2: { stream: 'e091a15b7d630a8c384107efdae2bf7a5be710c4d2cce1be2005683b1068a321', state: '269396d802546d4f223c292eb97bb38618f8e30ca9ead71d3996058b17afce44' },
  G3: { stream: '20d810457761501c019d35547cdef129f7610ca4b9417bc61ad64c0c00ae13ba', state: '0c34b421c957d3f7b9728d930ae98ffea9142a4c39a5aaaf84108eece1639208' },
};

function playHash(seed: number, mix: BotDifficultyName[], ticks: number, model: 1 | 2 | undefined, hook?: (out: { broadcast: ServerMessage[] }, s: GameState) => void) {
  const P = MAP_SIZE_PRESETS.M;
  const map = generateMap(seed, P.w, P.h, mix.length);
  const state = createGameState(
    map,
    mix.map((d, i) => ({ playerId: i + 1, isBot: true, connected: true, botDifficulty: d })),
    undefined,
    undefined,
    model,
  );
  const sim = new Simulation(state, CivBot);
  const h = createHash('sha256');
  for (let i = 0; i < ticks && !sim.finished; i++) {
    const out = sim.step();
    h.update(JSON.stringify(out.broadcast));
    h.update(JSON.stringify(out.personal));
    hook?.(out, state);
  }
  const s = createHash('sha256');
  s.update(Buffer.from(state.owners));
  s.update(JSON.stringify(state.flags, (k, v) => (k === 'morale' ? undefined : v)));
  s.update(JSON.stringify(state.players.filter(Boolean).map((p) => [p.troopsMilli, p.goldMilli, p.techMask, p.tiles, p.alive])));
  s.update(JSON.stringify(state.ledger));
  return { stream: h.digest('hex'), state: s.digest('hex'), sim };
}
const NORMAL10: BotDifficultyName[] = Array.from({ length: 10 }, () => 'NORMAL');
const MIX8: BotDifficultyName[] = ['HARD', 'NORMAL', 'EASY', 'NORMAL', 'HARD', 'EASY', 'NORMAL', 'NORMAL'];

describe('모델 1 비트 동일 (COMBAT_MODEL=1 이 기본값)', () => {
  it('기본값은 모델 1이고 환경변수가 없으면 모델 1', () => {
    if (process.env.COMBAT_MODEL === undefined) expect(defaultCombatModel()).toBe(1);
    const map = generateMapForPlayers(4242, 8);
    expect(createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 1).combatModel).toBe(1);
  });

  it('G1 10인 NORMAL 시드 1000 4500 tick: 변경 전 해시와 같다 (방송·개인 메시지 전량 + 최종 상태)', () => {
    const r = playHash(1000, NORMAL10, 4500, 1);
    expect(r.stream).toBe(GOLDEN.G1.stream);
    expect(r.state).toBe(GOLDEN.G1.state);
  });

  it('G2 혼합 난이도 8인 시드 77 3000 tick', () => {
    const r = playHash(77, MIX8, 3000, 1);
    expect(r.stream).toBe(GOLDEN.G2.stream);
    expect(r.state).toBe(GOLDEN.G2.state);
  });

  it('G3 10인 NORMAL 시드 1003 한 판 끝까지 (9700 tick)', () => {
    const r = playHash(1003, NORMAL10, 9700, 1);
    expect(r.stream).toBe(GOLDEN.G3.stream);
    expect(r.state).toBe(GOLDEN.G3.state);
  }, 120000);

  it('모델 1 메시지에는 새 필드가 없다 (match_config.combatModel · flags[].morale · moraleChanged · sides[].atk 등)', () => {
    const seen = { cfg: false, full: false, delta: false, combat: false };
    playHash(1000, NORMAL10, 2600, 1, (out, s) => { // 2026-10-24: 점령 소모 개편 뒤 첫 교전이 늦어져 1300 → 2600
      for (const m of out.broadcast) {
        if (m.type === 'snapshot_full') {
          seen.full = true;
          expect(m.flags.every((f) => !('morale' in f))).toBe(true);
        } else if (m.type === 'snapshot_delta') {
          seen.delta = true;
          expect('moraleChanged' in m).toBe(false);
        } else if (m.type === 'combat_started') {
          seen.combat = true;
          expect(m.sides.every((x) => !('atk' in x) && !('def' in x) && !('lossPermille' in x) && !('morale' in x))).toBe(true);
        }
      }
      if (s.tick === 1) {
        seen.cfg = true;
        expect('combatModel' in buildMatchConfig(s)).toBe(false);
      }
    });
    expect(seen).toEqual({ cfg: true, full: true, delta: true, combat: true });
  });
});

// ───────────────────────── 3) 모델 2 ─────────────────────────

describe('모델 2 — 결정론 · 회계 · 프로토콜', () => {
  it('같은 시드 -> 같은 해시 (G1 2500 tick), 그리고 모델 1 과는 다르다', () => {
    const a = playHash(1000, NORMAL10, 2500, 2);
    const b = playHash(1000, NORMAL10, 2500, 2);
    expect(a.stream).toBe(b.stream);
    expect(a.state).toBe(b.state);
    const m1 = playHash(1000, NORMAL10, 2500, 1);
    expect(a.stream).not.toBe(m1.stream);
  });

  it('매 tick 회계 불변식 0 · 사기 0..1000 · 교전 중 감소/비전투 증가 · 스키마 통과 (10인 NORMAL 2500 tick)', () => {
    const prev = new Map<number, { morale: number; inCombat: boolean }>();
    const errs: string[] = [];
    let combatSeen = 0;
    let dropSeen = 0;
    let recSeen = 0;
    let routedSeen = 0;
    let deltaSeen = 0;
    const kinds = new Set<string>();
    playHash(1003, NORMAL10, 2500, 2, (out, s) => {
      expect(ledgerImbalance(s)).toBe(0);
      for (const f of s.flags) {
        expect(f.morale).toBeGreaterThanOrEqual(0);
        expect(f.morale).toBeLessThanOrEqual(1000);
        const p = prev.get(f.id);
        if (p) {
          // 갱신은 4b 에서 확정된 inCombat 기준이다. 이번 tick 값(f.inCombat)과 비교
          if (f.inCombat) {
            expect(f.morale).toBeLessThanOrEqual(p.morale);
            if (f.morale < p.morale) dropSeen++;
          } else if (!f.routed) {
            expect(f.morale).toBeGreaterThanOrEqual(p.morale);
            if (f.morale > p.morale) recSeen++;
          }
        }
        if (f.routed && f.morale === 0) routedSeen++;
        prev.set(f.id, { morale: f.morale, inCombat: f.inCombat });
        if (f.inCombat) combatSeen++;
      }
      for (const m of out.broadcast) {
        if (m.type === 'snapshot_delta' && m.moraleChanged) {
          deltaSeen++;
          expect(s.tick % 5).toBe(0);
        }
        if (m.type === 'snapshot_delta' && s.tick % 5 !== 0) expect('moraleChanged' in m).toBe(false);
        if (m.type === 'combat_started') {
          expect(m.sides.every((x) => typeof x.atk === 'number' && typeof x.def === 'number' && typeof x.lossPermille === 'number' && typeof x.morale === 'number')).toBe(true);
          const sum = m.sides.reduce((a, x) => a + (x.lossPermille ?? 0), 0);
          expect(sum).toBeGreaterThanOrEqual(1000 - m.sides.length);
          expect(sum).toBeLessThanOrEqual(1000);
        }
        if (m.type === 'snapshot_full') expect(m.flags.every((f) => typeof f.morale === 'number')).toBe(true);
        if (['snapshot_full', 'snapshot_delta', 'combat_started', 'combat_ended', 'flag_routed'].includes(m.type) && !kinds.has(m.type + (s.tick < 100 ? '' : '2'))) {
          kinds.add(m.type + (s.tick < 100 ? '' : '2'));
        }
        const e = validateMessage(m);
        if (e.length && errs.length < 5) errs.push(`${m.type}: ${e.join('; ')}`);
      }
    });
    expect(errs).toEqual([]);
    expect(combatSeen).toBeGreaterThan(50);
    expect(dropSeen).toBeGreaterThan(20);
    expect(recSeen).toBeGreaterThan(50);
    expect(deltaSeen).toBeGreaterThan(5);
    expect(routedSeen).toBeGreaterThanOrEqual(0);
  });

  it('match_config: 모델 2 에서만 combatModel=2, 새 상수 노출 (스키마 통과)', () => {
    const map = generateMapForPlayers(4242, 8);
    const s2 = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 2);
    const cfg = buildMatchConfig(s2);
    expect(cfg.combatModel).toBe(2);
    expect(validateMessage(cfg)).toEqual([]);
    for (const k of ['COMBAT_MODEL', 'UNIT_STAT', 'TERRAIN_BUFF', 'BASE_BUFF', 'POSTURE_W', 'COMBAT_GAMMA', 'COMBAT_VMIN', 'DISENGAGE_VALUE_PERMILLE_V2', 'MORALE_FLOOR', 'MORALE_FULL', 'MORALE_MULT_CAP', 'MORALE_DROP_PER_TICK', 'MORALE_RECOVER', 'MORALE_RECOVER_BASE']) {
      expect(cfg.constants[k], k).toBeDefined();
    }
    const s1 = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: true, connected: true })), undefined, undefined, 1);
    expect(validateMessage(buildMatchConfig(s1))).toEqual([]);
  });
});

// ───────────────────────── 4a/4b 순수 결투 ─────────────────────────

function open(s: GameState, r: number): number {
  const W = s.map.width;
  const H = s.map.height;
  for (let t = 0; t < s.owners.length; t++) {
    const row = Math.floor(t / W);
    const col = t % W;
    if (row < r + 1 || col < r + 1 || row >= H - r - 1 || col >= W - r - 1) continue;
    if (s.graph.disk(t, r).every((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x] && s.owners[x] === 0)) return t;
  }
  throw new Error('no open area');
}
function addFlag(s: GameState, o: { ownerId: number; unit: 0 | 1 | 2; troops: number; pos: number } & Partial<Flag>): Flag {
  const f = makeFlag({ id: s.nextFlagId++, ownerId: o.ownerId, slotIndex: s.flags.filter((x) => x.ownerId === o.ownerId).length, unit: o.unit, troopsMilli: o.troops * 1000, initialTroops: o.troops, posTileId: o.pos, anchorTileId: o.pos, originTileId: o.pos });
  const { ownerId: _o, unit: _u, troops: _t, pos: _p, ...rest } = o;
  Object.assign(f, rest);
  s.flags.push(f);
  s.ledger.initial += o.troops * 1000;
  return f;
}
function duelState(model: 1 | 2) {
  const map = generateMapForPlayers(4242, 8);
  const s = createGameState(map, Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true })), undefined, undefined, model);
  const c = open(s, 3);
  for (const t of s.graph.disk(c, 3)) s.map.terrain[t] = TERRAIN.PLAIN;
  return { s, c };
}

describe('모델 2 — 4a/4b 서버 경로', () => {
  it('4a 의 편 손실 == shared sideLossShares (같은 함수), 총량 T = 편 수 x L 불변', () => {
    const { s, c } = duelState(2);
    const a = addFlag(s, { ownerId: 1, unit: U.CAVALRY, troops: 500, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', morale: 700 });
    const d = addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 300, pos: c + 1, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 900 });
    const plan = stage4a_flagCombatPhaseA(s, 1);
    const g = plan.groups[0];
    expect(g.sides.length).toBe(2);
    const L = Math.max(Math.floor((800_000 * 90) / (2 * 10000)), Math.floor((800_000 * 45) / (2 * 10000)), 1000);
    const direct = sideLossShares([[combatInput(s, a)], [combatInput(s, d)]], 2 * L);
    expect(plan.lossMilliByFlag.get(a.id)).toBe(direct[0]);
    expect(plan.lossMilliByFlag.get(d.id)).toBe(direct[1]);
    expect(direct[0] + direct[1]).toBe(2 * L);
    expect(g.sides[0].atk).toBeDefined();
    expect(g.sides[0].morale).toBe(700);
  });

  it('사기 규칙: 교전 tick 마다 창 -3 / 검 -6 / 기 -10, 이탈 완료 후 비전투 +3, 기지 위 +10, 패주 0', () => {
    const { s, c } = duelState(2);
    const sp = addFlag(s, { ownerId: 1, unit: U.SPEAR, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const cv = addFlag(s, { ownerId: 2, unit: U.CAVALRY, troops: 2000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const out = newOutbox();
    for (let t = 1; t <= 10; t++) {
      s.tick = t;
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
      expect(sp.morale).toBe(1000 - 3 * t);
      expect(cv.morale).toBe(1000 - 10 * t);
    }
    // 전투 종료: 상대를 치워 비전투로 -> 회복 +3 (기지 밖)
    s.flags.splice(s.flags.indexOf(cv), 1);
    s.tick = 11;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 11), 11, out);
    expect(sp.inCombat).toBe(false);
    expect(sp.morale).toBe(1000 - 30 + 3);
    // 자기 기지 위 +10
    const cap = s.players[3].homeTileId;
    const onBase = addFlag(s, { ownerId: 3, unit: U.SWORD, troops: 100, pos: cap, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 500 });
    s.tick = 12;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 12), 12, out);
    expect(onBase.morale).toBe(510);
    // 패주: 병력 1 -> 한 방에 0, 사기 0
    const { s: s2, c: c2 } = duelState(2);
    const big = addFlag(s2, { ownerId: 1, unit: U.CAVALRY, troops: 3000, pos: c2, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const weak = addFlag(s2, { ownerId: 2, unit: U.SPEAR, troops: 1, pos: c2 + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    s2.tick = 1;
    stage4b_flagCombatPhaseB(s2, stage4a_flagCombatPhaseA(s2, 1), 1, newOutbox());
    expect(weak.routed).toBe(true);
    expect(weak.morale).toBe(0);
    expect(big.morale).toBe(990);
  });

  it('총손실 회계: 모델 2 에서도 ledger.combat 이 깃발 병력 감소와 일치', () => {
    const { s, c } = duelState(2);
    addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 400, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 400, pos: c + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    const out = newOutbox();
    for (let t = 1; t <= 100; t++) {
      s.tick = t;
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
      expect(ledgerImbalance(s)).toBe(0);
    }
  });

  it('flagValue 호환 스칼라: 모델 2 는 ω 평균(사기 반영), 봇 가상 깃발(사기 없음)도 계산된다', async () => {
    const { flagValue } = await import('../src/game/combat.js');
    const { s, c } = duelState(2);
    const f = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 100, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    expect(flagValue(s, f, [f])).toBe(flagScalar(combatInput(s, f)));
    f.morale = 0;
    expect(flagValue(s, f, [f])).toBeLessThan(flagScalar({ ...combatInput(s, f), morale: 1000 }));
    const fake = { ownerId: 1, unit: U.SWORD, posture: POSTURE.ATTACK, posTileId: c, disengageUntilTick: null } as unknown as Flag;
    expect(Number.isFinite(flagValue(s, fake, []))).toBe(true);
  });
});
