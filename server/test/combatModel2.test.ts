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
  BASE_CAPTURE_LOCK_TICK,
  BASE_HP_DMG_CAP_MILLI_PER_TICK,
  CAPITAL_HP_MILLI,
  BASE_DEFENDED_DMG_PERMILLE,
  BASE_HP_MILLI,
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
import { stage6_combatPhaseA, stage7_combatPhaseB } from '../src/game/gauge.js';
import { newOutbox } from '../src/game/outbox.js';
import { buildMatchConfig, hpPct } from '../src/game/snapshot.js';
import { captureBase } from '../src/game/basecapture.js';
import { createGameState, defaultCombatModel, ledgerImbalance, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { Simulation, stage8_baseRegen } from '../src/game/tick.js';
import { generateMap, generateMapForPlayers } from '../src/map/generate.js';
import { isClaimable } from '@civwar/shared';

// ───────────────────────── 1) combatMath 단위 ─────────────────────────

const NO_TECH = techStatValues(0);
const T = 2_000_000; // 총량이 충분히 커서 반올림·병력 상한 영향이 없다
/** 기본 지형 = DEEP(깃발이 서지 않는 칸) — 지형 효과 없음. 패치 6차부터 평원도 공격 태세 +5% 라서 기준 지형으로 쓰지 않는다 */
function inp(unit: number, posture: number, o: Partial<CombatFlagInput> = {}): CombatFlagInput {
  return { unit, posture, terrain: TERRAIN.DEEP, onOwnBase: false, troopsMilli: 3_000_000, morale: MORALE_MAX, disengage: false, statPm: NO_TECH, ...o };
}
/** 첫 tick 에 a 편(1깃발)이 잃는 비율 % */
function lossPct(a: CombatFlagInput, d: CombatFlagInput): number {
  return (sideLossShares([[a], [d]], T)[0] * 100) / T;
}
const near = (x: number, y: number, tol = 0.06) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThan(tol);
const U = UNIT;

describe('combatMath — 문서 시나리오 숫자 재현 (사기 만땅 양쪽 동일)', () => {
  it('2.7 공격 대 방어 평지 손실% 3x3 표 (사기 만땅: 패치 12차 병종별 사기 곱 창 1.10 / 검 1.20 / 기 1.30)', () => {
    const rows: [number, number[]][] = [
      [U.SPEAR, [50.0, 54.54, 59.8]],
      [U.SWORD, [45.46, 50.0, 55.78]],
      [U.CAVALRY, [40.2, 44.22, 50.0]],
    ];
    for (const [au, exp] of rows) for (const du of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(au, POSTURE.ATTACK), inp(du, POSTURE.DEFEND)), exp[du]);
  });

  it('2.7 공격 대 공격(조우전) 표 — 패치 11차부터 태세 가중이 같아 공격 대 방어 표와 같다', () => {
    const rows: [number, number[]][] = [
      [U.SPEAR, [50.0, 54.54, 59.8]],
      [U.SWORD, [45.46, 50.0, 55.78]],
      [U.CAVALRY, [40.2, 44.22, 50.0]],
    ];
    for (const [au, exp] of rows) for (const du of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(au, POSTURE.ATTACK), inp(du, POSTURE.ATTACK)), exp[du]);
  });

  it('같은 병종 거울 평지는 50:50 (평지 방어 이점 없음)', () => {
    for (const u of [U.SPEAR, U.SWORD, U.CAVALRY]) near(lossPct(inp(u, POSTURE.ATTACK), inp(u, POSTURE.DEFEND)), 50.0, 0.01);
  });

  it('4절 지형 확인 (패치 6차): 검병 거울 방어 지형별 공격측 손실 구릉 54.5 / 산 59.6 / 비옥 50.0 / 사막 47.4, 평지 위 공격 48.8 · 구릉 위 공격 50.0 (패치 11차 채널 한정, 12차 구릉 +20% · 산 +50%)', () => {
    const sw = (ter: number) => lossPct(inp(U.SWORD, POSTURE.ATTACK), inp(U.SWORD, POSTURE.DEFEND, { terrain: ter }));
    near(sw(TERRAIN.HILLS), 54.51);
    near(sw(TERRAIN.MOUNTAIN), 59.62);
    near(sw(TERRAIN.FERTILE), 50.0);
    near(sw(TERRAIN.DESERT), 47.38);
    near(lossPct(inp(U.SWORD, POSTURE.ATTACK, { terrain: TERRAIN.PLAIN }), inp(U.SWORD, POSTURE.DEFEND)), 48.78);
    near(lossPct(inp(U.SWORD, POSTURE.ATTACK, { terrain: TERRAIN.HILLS }), inp(U.SWORD, POSTURE.DEFEND)), 50.0);
  });

  it('2.8 이탈 x0.9 (v5.10, 구 x0.7 = 67.1%): 검병 거울, 이탈 대기 방어 깃발 손실 55.2%', () => {
    near(lossPct(inp(U.SWORD, POSTURE.DEFEND, { disengage: true }), inp(U.SWORD, POSTURE.ATTACK)), 55.2);
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
    const mm = moraleMultiplier(U.SPEAR, 800, NO_TECH); // 패치 12차: 병종별 사기 곱 (창 800 -> 1090)
    expect(b).toEqual([Math.floor((Math.floor((900 * BASE_BUFF[1][0]) / 1000) * mm) / 1000), Math.floor((Math.floor((1100 * BASE_BUFF[1][1]) / 1000) * mm) / 1000)]);
  });

  it('채널값은 단계마다 floor, 최소 1, 지형표 7행 (공격 태세 / 방어 태세) — 패치 11차: 지형은 한 채널에만, 12차: 구릉 +20% · 산 +50%', () => {
    const exp: Record<number, [number[], number[]]> = {
      [TERRAIN.DEEP]: [[1000, 1000], [1000, 1000]],
      [TERRAIN.PLAIN]: [[1050, 1000], [1000, 1000]],
      [TERRAIN.FERTILE]: [[1050, 1000], [1000, 1000]],
      [TERRAIN.HILLS]: [[1000, 1000], [1000, 1200]],
      [TERRAIN.DESERT]: [[900, 1000], [900, 1000]],
      [TERRAIN.MOUNTAIN]: [[1000, 1000], [1000, 1500]],
      [TERRAIN.SHALLOW]: [[1000, 1000], [1000, 1000]],
    };
    const swm = moraleMultiplier(U.SWORD, 800, NO_TECH); // 검병 800 -> 1130
    const sc = (row: number[]) => row.map((v) => Math.floor((v * swm) / 1000));
    for (const [ter, [atkRow, defRow]] of Object.entries(exp)) {
      // 검병: 능력치 1000/1000 이므로 지형 배율 x 사기 곱(단계마다 floor)이 그대로 보인다
      expect(channelValues(inp(U.SWORD, POSTURE.ATTACK, { terrain: Number(ter), morale: 800 }))).toEqual(sc(atkRow));
      expect(channelValues(inp(U.SWORD, POSTURE.DEFEND, { terrain: Number(ter), morale: 800 }))).toEqual(sc(defRow));
    }
    // 단계 floor: 창병(ATK 900) 공격 평원 1.05 -> 945, 사기 m=800(창 곱 1090)
    expect(channelValues(inp(U.SPEAR, POSTURE.ATTACK, { terrain: TERRAIN.PLAIN, morale: 800 }))[0]).toBe(Math.floor((Math.floor((900 * 1050) / 1000) * 1090) / 1000));
    expect(channelValues(inp(U.SPEAR, POSTURE.ATTACK, { morale: 0 }))[0]).toBe(Math.floor((900 * 1050) / 1000));
  });

  it('5.1 사기 곱 경계 (패치 12차 병종별): 창 1050~1100 / 검 850~1200 / 기 750~1300, 상한 1500', () => {
    expect([U.SPEAR, U.SWORD, U.CAVALRY].map((u) => moraleMultiplier(u, 1000, NO_TECH))).toEqual([1100, 1200, 1300]);
    expect([U.SPEAR, U.SWORD, U.CAVALRY].map((u) => moraleMultiplier(u, 0, NO_TECH))).toEqual([1050, 850, 750]);
    expect(moraleMultiplier(U.SWORD, 800, NO_TECH)).toBe(1130);
    const st = NO_TECH.slice();
    st[TECH_STAT.MORALE_FULL_BONUS_CAVALRY] = 2000; // 예약 칸에 큰 값을 넣어도
    expect(moraleMultiplier(U.CAVALRY, 1000, st)).toBe(1500);
    expect(moraleMultiplier(U.SWORD, 1000, st)).toBe(1200); // 다른 병종은 영향 없음
    st[TECH_STAT.MORALE_FULL_BONUS_CAVALRY] = 100; // 돌격 기세 +10%p (1300 -> 1400)
    expect(moraleMultiplier(U.CAVALRY, 1000, st)).toBe(1400);
  });

  it('5.2 병종별 사기 곱 (고정 감소만): 10초(50 tick) 창 1092 / 검 1130 / 기 1135, 20초 기병 970', () => {
    const at = (u: number, perTick: number, ticks: number) => moraleMultiplier(u, Math.max(0, 1000 - perTick * ticks), NO_TECH);
    expect(at(U.SPEAR, 3, 50)).toBe(1092);
    expect(at(U.SWORD, 4, 50)).toBe(1130);
    expect(at(U.CAVALRY, 6, 50)).toBe(1135);
    expect(at(U.CAVALRY, 6, 100)).toBe(970);
    expect(at(U.SPEAR, 3, 335)).toBe(1050); // 약 67초에 바닥 (1000 - 1005 -> 0)
  });

  it('5.5(a) 사기 소모 후 상성: 기 vs 창 조우전(고정 감소만) 0초 40.2% → 10초 46.1% → 20초 53.2% (패치 12차 병종별 사기 곱)', () => {
    const f = (ticks: number) => lossPct(inp(U.CAVALRY, POSTURE.ATTACK, { morale: Math.max(0, 1000 - 6 * ticks) }), inp(U.SPEAR, POSTURE.ATTACK, { morale: Math.max(0, 1000 - 3 * ticks) }));
    near(f(0), 40.2);
    near(f(50), 46.13);
    near(f(100), 53.2);
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

  it('편 안 혼합: 병력 가중 채널값 (병력 3:1 검병/기병 혼합, 태세 가중은 없다)', () => {
    const det = sideLossDetail(
      [[inp(U.SWORD, POSTURE.ATTACK, { troopsMilli: 3000 }), inp(U.CAVALRY, POSTURE.DEFEND, { troopsMilli: 1000 })], [inp(U.SWORD, POSTURE.ATTACK)]],
      1000,
    );
    expect(det[0].atk).toBe(Math.floor((3000 * 1200 + 1000 * 1560) / 4000)); // 1290 (사기 만땅: 검 x1.2 / 기 x1.3)
    expect(det[0].def).toBe(Math.floor((3000 * 1200 + 1000 * 1170) / 4000)); // 1192
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

  it('테크 예약 스탯: 기본값은 효과 없음 (statPm 길이 54, 앞 32칸 길이 불변), 없는 칸(구 서버 설정)도 같은 값', () => {
    expect(TECH_STAT_COUNT).toBe(54);
    expect(NO_TECH.length).toBe(54);
    expect(TECH_STAT_BASE.slice(0, 32).length).toBe(32);
    const f = inp(U.CAVALRY, POSTURE.ATTACK);
    expect(channelValues(f)).toEqual(channelValues({ ...f, statPm: NO_TECH.slice(0, 32) }));
    expect(flagScalar(f)).toBe(Math.floor((channelValues(f)[0] + channelValues(f)[1]) / 2));
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
 * 2026-10-24 봇 '약한 적 우선'(A-167)과 테크 개편(4티어·절대 점수, 봇 테크 목록 교체, 병종 점령 소모·편성비 개편)으로 봇 행동이 달라져 그 시점 코드로 다시 뽑았다(회귀 고정용). 같은 날 밸런스 패치(중립 확장 검병·신중형·기병 편성비 ×1.6·유지비 ×2.0)로 한 번 더 다시 뽑았다. 2026-10-25 패치 5차(기지 체력 10000/15000·상한 200·회복 5초 +50)로 또 다시 뽑았다. 2026-10-25 패치 6차(지형 골드 가중·기지 생산 50칸·정리 보상·ECO-4 지형 가산)로 한 번 더 다시 뽑았다. 같은 날 패치 7차(병력 비례 유지비·봇 빚 회피)로 또 다시 뽑았다. 2026-10-28 v5.1(점령 배율 전 병종 1000·기지 출전 쿨타임 25 tick·봇 출발 기지 확인 — 모델 1·2 공통)로 다시 뽑았다.  2026-10-31 귀환지를 출발 기지 대신 가까운 기지로 바꾸면서(모델 1·2 공통) G1·G3 을 다시 뽑았다. 같은 날 병력 상한 칸당 계수 12 → 18 로 G1~G3 을 또 다시 뽑았다. 2026-11-02 칸당 병력 상한 18 → 20 (v5.5) 으로 다시 뽑았다.
 * 2026-11-02 v5.6: 봇이 태세를 명시하고 재지정 뒤 쿨타임을 기다려 태세를 바꾸므로 다시 고정.
 * 2026-11-03 v5.8: 재정 골드 개편(언덕 이관·수치·국고 ×1.2), 공용 쿨타임 4초, 기동 테크 교체, 병종 편성비·기병 유지비, 병종 갈래 재구성, 공통·병종 노드 수치와 MOB-2B·3B 교환, 기지 골드 테크(ECO-1)로 다시 고정.
 * 2026-11-05 v5.10: 이탈 대기 15 → 8 tick(모델 1·2 공통)·철수 훈련 5 tick·귀환 이탈 면제 2초로 다시 고정.
 * 2026-11-05 v5.11: 화면 값 5·10 단위(사막·산 이동, 골드 비율 2000·지형 골드 가중, 개간·채굴 +100%, 테크 가격 10 단위 반올림)로 다시 고정.
 * 2026-11-11 v5.13: 기지 체력 ×1.5(15000/22500)·회복 +75 (모델 1·2 공통)로 다시 고정.
 */
const GOLDEN = {
  G1: { stream: '29e4762a1d49087f545510a9a5ced86ec721928b3af1c230bbcb7b9ab95cb389', state: '49b280d8adcf1bc04ba16c540c7daae49e25df69a99d60945bf48c63c2c96e99' },
  G2: { stream: '67e4f4fb64642021be9a9c87f0261ffdfcc349a3ca00f5449ef5697c99945968', state: 'c654c039ad6e238d8c67ade7a7f999ac5bd0305fcae198b2f96845115dc9aca4' },
  G3: { stream: '687f18523c2a36432b0875485858342e2a7983646af236e353e7dac9caa6e2be', state: '82d06479b3a67e3371ec6aa77ce1f6ec0ede9de9388de29e7cedb04a2ac04648' },
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

describe('모델 1 비트 동일 (명시적으로 모델 1 을 고른 경우 — 기본값은 2026-10-24 부터 모델 2)', () => {
  it('기본값은 모델 2이고 환경변수가 없으면 모델 2, 인자로 1 을 주면 모델 1', () => {
    if (process.env.COMBAT_MODEL === undefined) expect(defaultCombatModel()).toBe(2);
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
            // 2026-10-24: 점령·기지 공격(게이지를 미는 깃발)은 비전투여도 사기가 깎인다 — 그 외에는 줄지 않는다
            if (f.posture !== POSTURE.ATTACK) expect(f.morale).toBeGreaterThanOrEqual(p.morale);
            else expect(f.morale).toBeGreaterThanOrEqual(p.morale - 8);
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
    for (const k of ['COMBAT_MODEL', 'UNIT_STAT', 'TERRAIN_BUFF', 'BASE_BUFF', 'COMBAT_GAMMA', 'COMBAT_VMIN', 'DISENGAGE_VALUE_PERMILLE_V2', 'MORALE_FLOOR', 'MORALE_FULL', 'MORALE_MULT_CAP', 'MORALE_DROP_PER_TICK', 'MORALE_RECOVER', 'MORALE_RECOVER_BASE']) {
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

  it('사기 규칙 (v5.7): 교전 tick 마다 고정(창 3 / 기 5) + 자기 손실 1%당 5, 이탈 완료 후 비전투 +3, 기지 위 +10, 패주 0', () => {
    const { s, c } = duelState(2);
    const sp = addFlag(s, { ownerId: 1, unit: U.SPEAR, troops: 2000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const cv = addFlag(s, { ownerId: 2, unit: U.CAVALRY, troops: 2000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const out = newOutbox();
    const expDrop = (fixed: number, before: number, after: number) => fixed + Math.floor((Math.floor(((before - after) * 10000) / before) * 5 + 50) / 100);
    sp.morale = 1000; // 출전 직후 사기(900) 대신 만땅에서 감소 규칙만 본다
    cv.morale = 1000;
    let mSp = 1000;
    let mCv = 1000;
    for (let t = 1; t <= 10; t++) {
      s.tick = t;
      const [bSp, bCv] = [sp.troopsMilli, cv.troopsMilli];
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
      mSp -= expDrop(3, bSp, sp.troopsMilli);
      mCv -= expDrop(5, bCv, cv.troopsMilli);
      expect(sp.morale).toBe(mSp);
      expect(cv.morale).toBe(mCv);
      expect(1000 - mSp).toBeGreaterThan(3 * t); // 손실 항이 붙는다
    }
    // 전투 종료: 상대를 치워 비전투로 -> 회복 +3 (기지 밖)
    s.flags.splice(s.flags.indexOf(cv), 1);
    s.tick = 11;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 11), 11, out);
    expect(sp.inCombat).toBe(false);
    expect(sp.morale).toBe(mSp + 3);
    // 자기 기지 위 +10
    const cap = s.players[3].homeTileId;
    const onBase = addFlag(s, { ownerId: 3, unit: U.SWORD, troops: 100, pos: cap, posture: POSTURE.DEFEND, state: 'ENGAGED', morale: 500 });
    s.tick = 12;
    stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 12), 12, out);
    expect(onBase.morale).toBe(510);
    // 패주: 병력 1 -> 한 방에 0, 사기 0
    const { s: s2, c: c2 } = duelState(2);
    const big = addFlag(s2, { ownerId: 1, unit: U.CAVALRY, troops: 3000, pos: c2, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    big.morale = 1000;
    const weak = addFlag(s2, { ownerId: 2, unit: U.SPEAR, troops: 1, pos: c2 + 1, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    s2.tick = 1;
    stage4b_flagCombatPhaseB(s2, stage4a_flagCombatPhaseA(s2, 1), 1, newOutbox());
    expect(weak.routed).toBe(true);
    expect(weak.morale).toBe(0);
    expect(big.morale).toBeLessThanOrEqual(1000 - 6); // 기병 고정 감소 6 + 손실 항
    expect(big.morale).toBeGreaterThan(950);
  });

  it('기지 체력 [A 패치 5차, 이슈 20261110-2055 ×1.5]: 일반·중립 15000 / 처음 수도 22500, 퍼센트는 기지별 최대 기준, 점령 직후 각 최대의 50%, 점령당해도 수도는 수도 체력', () => {
    const { s } = duelState(2);
    const home = s.players[2].homeTileId;
    const cap = s.bases[s.baseIndexOf.get(home)!];
    const plain = s.bases.find((x) => !s.capitalTiles.has(x.tileId))!;
    expect([cap.maxHpMilli, plain.maxHpMilli]).toEqual([CAPITAL_HP_MILLI, BASE_HP_MILLI]);
    expect([cap.hpMilli, plain.hpMilli]).toEqual([CAPITAL_HP_MILLI, BASE_HP_MILLI]);
    expect([CAPITAL_HP_MILLI, BASE_HP_MILLI, BASE_HP_DMG_CAP_MILLI_PER_TICK]).toEqual([22500, 15000, 200]);
    cap.hpMilli = 7500;
    plain.hpMilli = 7500;
    expect([hpPct(cap), hpPct(plain)]).toEqual([33, 50]);
    // 수도 칸 함락: 새 주인이 차지해도 최대 체력은 22500, 점령 직후 50% = 11250
    cap.hpMilli = 0;
    const out = newOutbox();
    captureBase(s, home, 1, 1, out);
    expect(cap.hpMilli).toBe(11250);
    expect(cap.maxHpMilli).toBe(CAPITAL_HP_MILLI);
    captureBase(s, plain.tileId, 1, 1, out);
    expect(plain.hpMilli).toBe(7500);
    const caps = out.broadcast.filter((m) => m.type === 'base_captured');
    expect(caps.map((m) => (m as { newHpPct: number }).newHpPct)).toEqual([50, 50]);
  });

  it('기지 회복 [A 패치 5차, 이슈 20261110-2055]: 마지막 피해 25 tick(5초) 뒤부터 tick 당 +75, 최대 체력에서 멈춘다. 교전 소모는 없다', () => {
    const { s } = duelState(2);
    const b = s.bases[s.baseIndexOf.get(s.players[2].homeTileId)!]; // 수도 22500
    b.hpMilli = 22300;
    b.lastDamageTick = 0;
    const heal = (t: number) => {
      s.tick = t;
      stage8_baseRegen(s, t);
    };
    for (let t = 1; t <= 24; t++) heal(t);
    expect(b.hpMilli).toBe(22300); // 25 tick 이 지나기 전엔 회복 없음
    heal(25);
    expect(b.hpMilli).toBe(22375);
    for (let t = 26; t <= 40; t++) heal(t);
    expect(b.hpMilli).toBe(22500); // 상한에서 멈춤
    // 방어 깃발이 교전 중이어도 기지 체력은 깎이지 않는다 (교전 소모 폐지)
    const home = s.players[2].homeTileId;
    const nb = s.graph.contactNeighbors(home).find((x) => isClaimable(s.map.terrain[x]) && !s.map.isBase[x])!;
    addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 3000, pos: home, posture: POSTURE.DEFEND, state: 'ENGAGED' });
    addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 3000, pos: nb, posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const out = newOutbox();
    for (let t = 41; t <= 50; t++) {
      s.tick = t;
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, t), t, out);
    }
    expect(b.hpMilli).toBe(CAPITAL_HP_MILLI);
    expect(b.lastDamageTick).toBe(0);
  });

  it('방어 태세는 교전 중 사기 고정 감소가 더 작다 (v5.7): 공격 창 3 / 검 4 / 기 5, 방어 창 2 / 검 3 / 기 4 (손실 항 제외)', () => {
    const drop = (unit: 0 | 1 | 2, posture: 0 | 1) => {
      const { s, c } = duelState(2);
      const f = addFlag(s, { ownerId: 1, unit, troops: 3000, pos: c, posture, state: 'ENGAGED' });
      f.morale = 1000;
      addFlag(s, { ownerId: 2, unit: U.SWORD, troops: 3000, pos: c + 1, posture: POSTURE.ATTACK, state: 'ENGAGED' });
      const out = newOutbox();
      s.tick = 1;
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 1), 1, out);
      expect(f.inCombat).toBe(true);
      const lossBp = Math.floor(((3_000_000 - f.troopsMilli) * 10000) / 3_000_000);
      return 1000 - f.morale - Math.floor((lossBp * 5 + 50) / 100); // 손실 항을 뺀 고정 감소
    };
    expect([U.SPEAR, U.SWORD, U.CAVALRY].map((u) => drop(u, POSTURE.DEFEND))).toEqual([2, 3, 4]);
    expect([U.SPEAR, U.SWORD, U.CAVALRY].map((u) => drop(u, POSTURE.ATTACK))).toEqual([3, 4, 5]);
  });

  it('기지 함락 시 그 칸 위 이전 주인 깃발은 귀환으로 퇴각한다 [A 패치 2차] (모델 2, 마지막 기지 제외, 모델 1 불변)', () => {
    for (const model of [1, 2] as const) {
      const { s } = duelState(model);
      const home = s.players[2].homeTileId;
      const extra = s.map.baseTiles.find((x) => s.owners[x] === 0 && x !== home)!;
      setTileOwner(s, extra, 2, false);
      const b = s.bases[s.baseIndexOf.get(extra)!];
      const nb = s.graph.neighbors(extra).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!; // 4방향 이웃 — 점령은 4방향
      // 이탈을 마친(breakaway) 이전 주인 깃발은 교전 자격이 없어 공격자가 기지를 밀 수 있다
      const old = addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 500, pos: extra, posture: POSTURE.DEFEND, state: 'ENGAGED', breakaway: true });
      addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 3000, pos: nb, anchorTileId: extra, targetOwnerId: 2, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 750_000 });
      b.hpMilli = 100;
      s.tick = 1;
      const out = newOutbox();
      stage7_combatPhaseB(s, stage6_combatPhaseA(s, 1), 1, out);
      expect(s.owners[extra]).toBe(1);
      expect(old.state).toBe(model === 2 ? 'RETURNING' : 'ENGAGED');
      expect(out.broadcast.some((m) => m.type === 'flag_recalled' && m.flagId === old.id)).toBe(model === 2);
    }
  });

  it('방어 깃발이 선 기지는 교전 중인 공격자도 ×0.5 피해로 밀 수 있다 [A 패치 4차] (모델 2), 깃발이 없으면 ×1, 모델 1 은 막힘', () => {
    const hit = (model: 1 | 2, defended: boolean) => {
      const { s } = duelState(model);
      const home = s.players[2].homeTileId;
      const b = s.bases[s.baseIndexOf.get(home)!];
      const nb = s.graph.neighbors(home).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
      if (defended) addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 3000, pos: home, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      const atk = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 3000, pos: nb, anchorTileId: home, targetOwnerId: 2, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 750_000 });
      s.tick = 1;
      const out = newOutbox();
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 1), 1, out); // 교전 개시
      expect(atk.inCombat).toBe(defended);
      b.hpMilli = b.maxHpMilli;
      b.damagedThisTick = false;
      s.tick = 2;
      const plan = stage6_combatPhaseA(s, 2); // 틱당 상한(300) 적용 전의 원래 피해로 비교한다
      return plan.baseHits.find((h) => h.flagId === atk.id)?.dmg ?? 0;
    };
    const free = hit(2, false);
    expect(free).toBeGreaterThan(0);
    const half = hit(2, true);
    expect(half).toBe(Math.floor((free * BASE_DEFENDED_DMG_PERMILLE) / 1000));
    expect(hit(1, true)).toBe(0);
  });

  it('GDD v5.12 ①②: 앵커가 옆 칸 적대 기지면 행군(MARCHING) 중 교전이어도 ×0.5 로 민다, 기지 옆 수비 깃발도 방어로 본다', () => {
    type Def = 'none' | 'onBase' | 'nextToBase' | 'thirdParty';
    const hit = (def: Def, o: { state?: Flag['state']; anchorIsBase?: boolean } = {}) => {
      const { s } = duelState(2);
      const home = s.players[2].homeTileId;
      const b = s.bases[s.baseIndexOf.get(home)!];
      const land = (t: number) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t];
      const nb = s.graph.neighbors(home).find(land)!;
      // 기지와 공격 깃발 모두에 붙은 칸 (기지 옆 수비 자리)
      const side = s.graph.contactNeighbors(home).find((t) => t !== nb && land(t) && s.graph.touching(nb, t))!;
      expect(side).toBeDefined();
      setTileOwner(s, side, 2);
      if (def === 'onBase') addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 3000, pos: home, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      if (def === 'nextToBase') addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 3000, pos: side, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      if (def === 'thirdParty') addFlag(s, { ownerId: 3, unit: U.SPEAR, troops: 3000, pos: side, posture: POSTURE.ATTACK, state: 'ENGAGED' });
      const anchor = o.anchorIsBase === false ? side : home;
      const atk = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 3000, pos: nb, anchorTileId: anchor, targetOwnerId: 2, posture: POSTURE.ATTACK, state: o.state ?? 'MARCHING', spendBudgetMilli: 750_000 });
      s.tick = 1;
      const out = newOutbox();
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 1), 1, out); // 교전 개시
      expect(atk.inCombat).toBe(def !== 'none');
      b.hpMilli = b.maxHpMilli;
      b.damagedThisTick = false;
      s.tick = 2;
      const plan = stage6_combatPhaseA(s, 2);
      const dmg = plan.baseHits.find((h) => h.flagId === atk.id)?.dmg ?? 0;
      const hp0 = b.hpMilli;
      stage7_combatPhaseB(s, plan, 2, out);
      return { dmg, lost: hp0 - b.hpMilli };
    };
    const free = hit('none', { state: 'ENGAGED' }).dmg; // 비전투 ENGAGED 가 미는 원래 피해
    expect(free).toBeGreaterThan(0);
    const half = Math.floor((free * BASE_DEFENDED_DMG_PERMILLE) / 1000);
    // ① 행군 중 교전 (종전에는 피해 0)
    expect(hit('onBase').dmg).toBe(half);
    // ② 기지 칸이 비어 있어도 기지 옆 수비 깃발과 교전 중이면 방어된 기지로 ×0.5 (상한도 ×0.5)
    expect(hit('nextToBase').dmg).toBe(half);
    expect(hit('nextToBase', { state: 'ENGAGED' }).dmg).toBe(half);
    // 앵커가 그 기지가 아니면 행군 깃발은 종전대로 못 민다
    expect(hit('onBase', { anchorIsBase: false }).dmg).toBe(0);
    // 기지 주인 편이 아닌 제3국 깃발은 기지를 지키는 깃발이 아니다
    expect(hit('thirdParty').dmg).toBe(0);
  });

  it('틱당 기지 피해 상한 [A 패치 5차]: 200, 방어 깃발이 선 기지는 100 (요새화·공성 테크 배율은 상한에도 곱해진다)', () => {
    const lost = (defended: boolean, fortPm = 1000, siegePm = 1000) => {
      const { s } = duelState(2);
      const home = s.players[2].homeTileId;
      const b = s.bases[s.baseIndexOf.get(home)!];
      const nb = s.graph.neighbors(home).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
      if (defended) addFlag(s, { ownerId: 2, unit: U.SPEAR, troops: 3000, pos: home, posture: POSTURE.DEFEND, state: 'ENGAGED' });
      addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 9000, pos: nb, anchorTileId: home, targetOwnerId: 2, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 9_000_000 });
      s.players[2].statPm[TECH_STAT.BASE_DMG] = fortPm;
      s.players[1].statPm[TECH_STAT.SIEGE] = siegePm;
      const out = newOutbox();
      s.tick = 1;
      stage4b_flagCombatPhaseB(s, stage4a_flagCombatPhaseA(s, 1), 1, out);
      const hp0 = b.hpMilli;
      s.tick = 2;
      stage7_combatPhaseB(s, stage6_combatPhaseA(s, 2), 2, out);
      return hp0 - b.hpMilli;
    };
    expect(lost(false)).toBe(BASE_HP_DMG_CAP_MILLI_PER_TICK);
    expect(lost(true)).toBe(BASE_HP_DMG_CAP_MILLI_PER_TICK / 2);
    expect(lost(false, 500)).toBe(BASE_HP_DMG_CAP_MILLI_PER_TICK / 2); // 요새화 ×0.5
    expect(lost(false, 1000, 1500)).toBe(BASE_HP_DMG_CAP_MILLI_PER_TICK * 1.5); // 공성 ×1.5
    expect(lost(true, 1000, 1500)).toBe((BASE_HP_DMG_CAP_MILLI_PER_TICK * 1.5) / 2);
  });

  it('이슈 20261110-2055 (사용자 2026-11-11): 기지 체력 ×1.5, 상한 200 유지 → 공성 시간·병력 ×1.5 — 수도 끝까지 밀어 tick·지출을 잰다', async () => {
    const { tileCost } = await import('../src/game/rules.js');
    expect([BASE_HP_MILLI, CAPITAL_HP_MILLI, BASE_HP_DMG_CAP_MILLI_PER_TICK]).toEqual([15000, 22500, 200]);
    const { s } = duelState(2);
    const home = s.players[2].homeTileId;
    const b = s.bases[s.baseIndexOf.get(home)!];
    expect(b.maxHpMilli).toBe(CAPITAL_HP_MILLI);
    const nb = s.graph.neighbors(home).find((t) => isClaimable(s.map.terrain[t]) && !s.map.isBase[t])!;
    const f = addFlag(s, { ownerId: 1, unit: U.SWORD, troops: 9000, pos: nb, anchorTileId: home, targetOwnerId: 2, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 9_000_000 });
    const c = tileCost(s, f, home);
    const troops0 = f.troopsMilli;
    const out = newOutbox();
    let ticks = 0;
    for (let t = 1; t <= 1000 && s.owners[home] === 2; t++) {
      s.tick = t;
      f.spendBudgetMilli = 9_000_000; // 예산은 넉넉히 — 상한만 시간을 정한다 (실측: 피해 tick 의 98% 가 상한 제한)
      stage7_combatPhaseB(s, stage6_combatPhaseA(s, t), t, out);
      ticks = t;
    }
    expect(s.owners[home]).toBe(1);
    // 시간: ceil(22500 ÷ 200) = 113 tick (22.6초) ≈ 구 15000 ÷ 200 = 75 tick 의 ×1.5
    expect(ticks).toBe(Math.ceil(CAPITAL_HP_MILLI / BASE_HP_DMG_CAP_MILLI_PER_TICK));
    expect(Math.abs(ticks / 75 - 1.5)).toBeLessThan(0.01);
    // 병력: tick 마다 ceil(적용 피해 × 칸 비용 ÷ 1000) 이고 tick 당 지출은 그대로라 tick 수에 비례 → 구 규칙 실제 지출의 ×1.5
    const spent = (troops0 - f.troopsMilli) / 1000;
    const perTick = Math.ceil((BASE_HP_DMG_CAP_MILLI_PER_TICK * c) / 1000);
    const lastNet = CAPITAL_HP_MILLI - (ticks - 1) * BASE_HP_DMG_CAP_MILLI_PER_TICK;
    expect(spent).toBe((ticks - 1) * perTick + Math.ceil((lastNet * c) / 1000));
    const oldSpent = 75 * perTick;
    expect(Math.abs(spent / oldSpent - 1.5)).toBeLessThan(0.02);
  });

  it('점령 사기 소모 [A]: 게이지를 미는 tick 마다 v5.1 전 병종 -6 (CAPTURE_MORALE_DROP x 점령 배율 1000), 모델 1 은 사기 없음', () => {
    const drop = (unit: 0 | 1 | 2, model: 1 | 2) => {
      const { s, c } = duelState(model);
      const f = addFlag(s, { ownerId: 1, unit, troops: 3000, pos: c, posture: POSTURE.ATTACK, state: 'ENGAGED', spendBudgetMilli: 750_000 });
      f.morale = 1000;
      s.tick = 1;
      const plan = stage6_combatPhaseA(s, 1);
      expect(plan.pushes.length + plan.baseHits.length).toBe(1);
      stage7_combatPhaseB(s, plan, 1, newOutbox());
      return 1000 - f.morale;
    };
    expect(drop(U.SPEAR, 2)).toBe(6);
    expect(drop(U.SWORD, 2)).toBe(6); // v5.1: 점령 배율 전 병종 1000 (구 5)
    expect(drop(U.CAVALRY, 2)).toBe(6); // v5.1 (구 8)
    expect(drop(U.CAVALRY, 1)).toBe(0);
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
