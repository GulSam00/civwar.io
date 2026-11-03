/**
 * civwar.io 밸런스 상수 — 단일 소스 (GDD v4.0 부록 A, 3단계 2차 재조정 반영)
 *
 * 규칙
 *  - 모든 배율은 permille 정수(1/1000 고정소수점). `1.15` → `1150`.
 *  - `_BP` 접미사는 basis point(1/10000).
 *  - `_MILLI` 접미사는 1/1000 단위 정수(병력·골드·진척도·기지 체력).
 *  - 지형별 배열은 TERRAIN enum 값(0..6)으로 인덱싱한다.
 *  - 테크 단계별 배열은 [무테크, T1, T2, T3] 4칸.
 *  - 페이싱 레버(ENEMY_BASE, THRESHOLD_*, HARD_TIMEOUT_TICK, FLAG_ORDER_COOLDOWN_TICKS 등)는
 *    여기에서만 정의한다. 서버·클라이언트 어느 곳에서도 하드코딩 금지.
 *
 * 서버는 이 객체 전체를 match_config.constants 로 클라이언트에 내려보낸다(GDD 7.6).
 */

// ══ 프로토콜 ══
export const PROTOCOL_VERSION = 1;

// ══ 시간 ══
export const TICK_MS = 200; // 초당 5 tick
export const TICKS_PER_MIN = 300;
export const ENDGAME_RUSH_TICK = 7800; // 26분 — §24 [A-117] (구 8400 = 28분 [A-38])
export const ENDGAME_RUSH_COST_MULT_PERMILLE = 600; // tileCost × 0.6 — §24 [A-118] (구 750)
export const HARD_TIMEOUT_TICK = 9600; // 32분 [A-38]
export const SNAPSHOT_FULL_INTERVAL = 25; // 5초
export const PLAYER_DELTA_INTERVAL = 5; // 1초. troops/gold/flagStats 델타 주기
export const BASE_HP_DELTA_INTERVAL = 5; // 1초
export const DISCONNECT_GRACE_TICK = 450; // 90초

// ══ 인원 ══ (v4.1 2.8: 방 최대 인원 2~12)
export const ROOM_MAX_PLAYERS_RANGE = [2, 12] as const;
export const MIN_PLAYERS = ROOM_MAX_PLAYERS_RANGE[0];
export const MAX_PLAYERS = ROOM_MAX_PLAYERS_RANGE[1];

// ══ 맵 ══
// v4.5 (사용자 2026-10-15, 프로토콜 §22): 물 = 통행 불가 장애물, 물 비율 약 10% (테두리 깊은 물 포함). 육지는 항상 한 덩어리(4방향 연결).
// 1단계 = 반해상도 격자에 호수 노이즈 → CA → 2배 확대 → 전해상도 다듬기 → 최대 육지 덩어리만 남김. 비율이 창 밖이면 p 를 조정해 다시.
export const LAND_TILES_PER_PLAYER = 390; // 참고값 (v2.1). 생성기는 쓰지 않는다
export const TARGET_LAND_RATIO_PERMILLE = 900; // v4.5: 650 → 900 (물 ≈ 10%)
export const LAND_RATIO_MIN_PERMILLE = 885; // v4.5 [A]: 물 8.5~11.5%
export const LAND_RATIO_MAX_PERMILLE = 915;
export const CA_INIT_LAND_P_PERMILLE = 540; // v4.5 [A]: 반해상도 칸이 "육지"일 확률 (= 호수 노이즈 460‰)
export const CA_LAND_P_STEP_PERMILLE = 10; // 시도마다 p ± 0.01
export const CA_MAX_ATTEMPTS = 12;
export const CA_SMOOTH_STEPS = 3; // 반해상도 CA 단계 (전해상도 다듬기 2단계는 고정)
export const CA_LAND_NEIGHBOR_MIN = 5; // 8방향 기준 (호수 CA: 물 이웃 ≥ 5 → 물)
export const SPAWN_BLOCK = 3; // 3×3
/** v4.1: "인원별 기본 크기"(2.3 표) — 생성기는 lookup 하지 않고 W×H 를 인자로 받는다. 테스트·스크립트 편의용 */
export const MAP_SIZE: Readonly<Record<number, readonly [number, number]>> = {
  8: [90, 54],
  9: [95, 57],
  10: [100, 60],
  11: [104, 63],
  12: [108, 66],
};
/** [A-45] 크기 프리셋 (2.8 b). recommended = [하한, 상한], max = 맵 최대 인원 */
export type MapSizeClass = 'S' | 'M' | 'L';
export const MAP_SIZE_PRESETS: Readonly<Record<MapSizeClass, { w: number; h: number; recommended: readonly [number, number]; max: number }>> = {
  S: { w: 72, h: 42, recommended: [5, 6], max: 7 },
  M: { w: 100, h: 60, recommended: [9, 11], max: 12 }, // 기본 · 페이싱 보증
  L: { w: 108, h: 66, recommended: [11, 12], max: 12 },
};
export const MAPGEN_MAX_SEED_RETRIES = 16; // 불변식 실패 시 seed+1 재생성 상한 (GDD에 없음 — 임의)

// ══ 지형 7종 ══ (v4.0: WATER → DEEP(0) + SHALLOW(6))
export const TERRAIN = {
  DEEP: 0,
  PLAIN: 1,
  FERTILE: 2,
  HILLS: 3,
  DESERT: 4,
  MOUNTAIN: 5,
  SHALLOW: 6,
} as const;
export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];
export const TERRAIN_COUNT = 7;

/** 육지 대비 지형 쿼터 (permille). 평원은 나머지(≈390) */
export const TERRAIN_SHARE_PERMILLE = {
  PLAIN: 390,
  FERTILE: 150,
  HILLS: 160,
  DESERT: 220,
  MOUNTAIN: 80,
} as const;

export const WATER_MODE = { BORDER_ONLY: 0, SHALLOW_QUOTA: 1 } as const;
export type WaterMode = (typeof WATER_MODE)[keyof typeof WATER_MODE];
export interface MapGenConfig {
  waterMode: WaterMode;
  /** SHALLOW_QUOTA 에서만 사용. 테두리 제외 물 중 얕은 물 비율 (0..1000) */
  shallowPermille: number;
}
export const MAP_GEN_DEFAULT: Readonly<MapGenConfig> = {
  waterMode: WATER_MODE.BORDER_ONLY,
  shallowPermille: 1000,
};

//                                   DEEP PLAIN FERT HILLS DESERT MTN SHALLOW
/** 점령비용 배율. 물은 점령 불가 → 0(미사용) */
export const TERRAIN_COST_PERMILLE = [0, 1000, 1150, 1300, 800, 1700, 0] as const;
/** 골드 가중치 */
export const TERRAIN_GOLD_MILLI = [0, 1000, 2000, 900, 300, 300, 0] as const; // 패치 6차 (사용자 2026-10-25): 비옥 2300 → 2000, 산 250 → 300
/** "느려짐 배율". v4.5: 물(DEEP·SHALLOW)은 통행 불가 → 조회되지 않음. SHALLOW 5000 은 기록용(커스텀 표시 호환) */
export const TERRAIN_MOVE_PERMILLE = [0, 1000, 1000, 1250, 1100, 1800, 5000] as const;
export const SHALLOW_MOVE_PERMILLE = 5000; // v4.5: 미사용 (해상 이동 폐지)

export const TERRAIN_GEN = {
  MOUNTAIN_BLOB_P_PERMILLE: 420,
  MOUNTAIN_BLOB_STEPS: 3,
  FERTILE_BLOB_P_PERMILLE: 450,
  FERTILE_BLOB_STEPS: 2,
  FERTILE_WATER_DIST_MIN: 1,
  FERTILE_WATER_DIST_MAX: 2,
  FERTILE_WATER_DIST_FALLBACK_MAX: 3, // 후보 부족 시 확장 (희귀)
  DESERT_BLOB_P_PERMILLE: 460,
  DESERT_BLOB_STEPS: 3,
  SHALLOW_BLOB_P_PERMILLE: 500, // 커스텀 SHALLOW_QUOTA 전용
  SHALLOW_BLOB_STEPS: 2,
} as const;

// ══ 기지 배치 ══ (v2.1 불변, 물 = DEEP ∪ SHALLOW 기준)
// NEUTRAL_BASE_COUNT = N (플레이어 수). 총 기지 = 2N ≤ 24
export const BASE_MIN_WATER_DIST = 2;
export const BASE_MIN_CAPITAL_DIST = 12;
export const BASE_MAX_CAPITAL_DIST = 24;
export const BASE_MIN_SEP = 12;
export const BASE_CONTEST_W = 3;
// 완화 사다리 값
export const BASE_RELAX_MIN_SEP = 8;
export const BASE_RELAX_MIN_CAPITAL_DIST = 9;
export const BASE_RELAX_MIN_WATER_DIST = 1;

// ══ 기지 체력 ══
/** 패치 5차 (사용자 2026-10-25) [A]: 기지 체력은 기지별 — 일반·중립 기지 10000, 처음 수도였던 칸 15000(점령당해도 수도 체력 유지). 구 22500 공통 */
export const BASE_HP_MILLI = 10000;
export const CAPITAL_HP_MILLI = 15000; // 패치 5차 재조정: 20000 → 15000 (수도 점령·탈락이 너무 줄어서, 사용자 확정)
/** 점령 직후 체력 = 그 기지 최대 체력 × 이 값 ‰ (사용자 확정 — 각 최대치의 50%) */
export const BASE_HP_CAPTURE_PERMILLE = 500;
/** 마지막 피해 뒤 이 tick 이 지나면 BASE_HP_REGEN_MILLI 씩 회복. 패치 5차: 50 → 25(5초), 35 → 50 (수도도 같은 값) */
export const BASE_HP_REGEN_MILLI = 50;
export const BASE_REGEN_DELAY_TICK = 25;
export const BASE_CAPTURE_LOCK_TICK = 25;
/** v5.1 (GDD 2.5·4.2, 사용자 확정 2026-10-28): 기지에서 깃발이 출전한 tick t 부터 이 tick 동안 그 기지는 출발 기지가 될 수 없다.
 *  BaseState.dispatchReadyTick = t + 이 값, 출전 가능 = 현재 tick ≥ dispatchReadyTick. 소유권이 바뀌면 0 으로 초기화 [A-5.1-2] */
export const BASE_DISPATCH_COOLDOWN_TICKS = 25;
/** 패치 5차: 300 → 200. 깃발 수와 무관하게 기지 하나가 한 tick 에 잃는 체력 상한 (milli). 일반 기지 최소 50 tick(10초), 수도 75 tick(15초).
 *  방어 깃발이 선 기지는 이 상한도 BASE_DEFENDED_DMG_PERMILLE 만큼 줄고, 요새화·공성 테크 배율은 상한에도 곱해진다 */
export const BASE_HP_DMG_CAP_MILLI_PER_TICK = 200;

// ══ v4.4 기지 생산력·기지 방어 (사용자 2026-10-14, 프로토콜 §21) ══
/** 방어 태세 깃발이 내 기지 칸 위에 서 있으면 지형 보정 대신 이 값 (곱하지 않고 대체) — 사용자 확정 */
export const COMBAT_BASE_DEF_PERMILLE = 1500;
/** v4.5 (사용자 2026-10-15): 공격 태세 깃발도 내 기지 칸 위면 공격값 × 이 값 / 1000 (태세 무관 ×1.5) */
export const COMBAT_BASE_ATK_PERMILLE = 1500;
/** 기지 생산력 시작값·상한 (‰). 중립 기지도 1000 에서 시작 — 사용자 확정 */
export const BASE_PROD_MAX_PERMILLE = 1000;
/** 점령될 때마다 현재 생산력 × 이 값 / 1000 (×0.5 → 연속 두 번 = 25%) — 사용자 확정 */
export const BASE_PROD_CAPTURE_PERMILLE = 500;
/** [A-85] 생산력 회복 속도 — 선형, 분당 +167‰ (50% → 100% 약 3분, 25% → 100% 약 4.5분). 에이전트 선택 */
export const BASE_PROD_RECOVER_PER_MIN_PERMILLE = 167;
/** 생산 내역(production) 델타 주기 — 1초 */
export const PRODUCTION_DELTA_INTERVAL = 5;


// ══ 약소국 정리 보상 (사용자 2026-10-23, 프로토콜 §31, [A-141]~) ══
/** 마지막 기지를 점령해 멸망시킨(합병 받는) 플레이어가 받는 보상. 0 = 없음 */
export const ANNEX_ASSET_PERMILLE = 0; // 멸망자 풀·깃발 병력 인계 비율 ‰ (패치 6차: 인계 폐지 — 멸망자 자산은 소멸)
export const ANNEX_GOLD_PERMILLE = 0; // 멸망자 골드 인계 비율 ‰ (패치 6차: 폐지)
export const ANNEX_BOUNTY_TROOPS = 0; // 정액 병력 현상금 (패치 6차: 폐지)
export const ANNEX_BOUNTY_GOLD = 0; // 정액 골드 현상금 (패치 6차: 폐지)
export const ANNEX_FULL_PROD = 0; // 1 이면 마지막 기지 점령 시 생산력 ×0.5 면제 (패치 6차: 면제 폐지)
/** 패치 6차 (사용자 2026-10-25) [A]: 정리 보상 = 합병자 자신의 현재 총병력(풀+깃발)의 이 비율 ‰ 만큼 병력 풀 회복(상한까지) */
export const ANNEX_OWN_TROOPS_PERMILLE = 200;
/** + 합병자 자신의 현재 골드 순수입 N 초치 (순수입이 0 이하면 0) */
export const ANNEX_OWN_GOLD_SECONDS = 60;

// ══ v4.5 기지 생산 (사용자 2026-10-15, 프로토콜 §22 — 2026-10-14 "생산 지역" 해석 폐기) ══
/** 기지 한 칸의 생산 = 영토(평원) 이 칸 수만큼 — 사용자 확정 */
export const BASE_PROD_TILES = 50; // 패치 6차: 60 → 50 (일반 기지, 수도는 CAPITAL_PROD_TILES)
/** 수도 한 칸의 생산 = 영토(평원) 이 칸 수만큼 — 사용자 확정 */
export const CAPITAL_PROD_TILES = 100;
/**
 * [A-103] 기지 병력 생산의 칸당 기준값을 정하는 기준 영토 크기 (= LAND_TILES_PER_PLAYER).
 * 칸당 병력 재생(milli/tick) = (REGEN_BASE_MILLI + REGEN_SQRT_COEF × √PROD_REF_TILES) / PROD_REF_TILES — 정수식은 economy.ts
 */
export const PROD_REF_TILES = 390;

// ══ 시작값 ══
export const START_TROOPS = 150;
export const START_GOLD = 200;

// ══ 병력 ══
export const TROOP_CAP_BASE = 100;
export const TROOP_CAP_PER_TILE = 20;
export const REGEN_BASE_MILLI = 800; // 0.8
export const REGEN_SQRT_COEF_PERMILLE = 500; // 0.50

// ══ 골드 ══
export const GOLD_RATE_PERMILLE = 2080; // [A-39]

// ══ 점령 비용 ══
export const NEUTRAL_BASE = 7; // [A-37]. v4.5 (사용자 2026-10-15): 고정 비용 — √칸 항(NEUTRAL_SQRT_COEF_PERMILLE 750) 폐기
export const ENEMY_BASE = 11; // [A-37, A-33 흡수]
export const ADJACENCY_COEF_PERMILLE = 150;
export const MIN_TILE_COST = 4;

// ══ 보급선 ══
export const SUPPLY_FREE_RADIUS = 10;
export const SUPPLY_COEF_PERMILLE = 20;
export const SUPPLY_MAX_MULT_PERMILLE = 1600;
export const SUPPLY_NO_BASE_DIST = 40;

// ══ 깃발 ══
export const FLAG_CAP_BASE = 3;
export const FLAG_TILES_PER_SLOT = 300;
export const FLAG_CAP_HARD_MAX = 7;
export const FLAG_MIN_TROOPS = 40;
export const FLAG_SPEED_BASE_MILLI = 140; // v4.2 [A-64] 120 → 140 (쟁기 규칙으로 점령 속도가 걷는 속도에 묶임)
export const FLAG_SPEND_RATE_PERMILLE = 15;
export const FLAG_SPEND_BUDGET_CAP_TICKS = 25;
export const FLAG_TILE_RATE_BASE = 2;
export const FRONT_RADIUS = 6;
export const FRONT_MAX_RANGE = 40;
export const FLAG_ENGAGE_RANGE = 1; // ATTACK 도착 판정 + 깃발 교전 거리(D-2). 사용자 결정 2026-10-11: 깃발 접촉(전투·ZOC·진척 유지) = 8방향(대각선 포함, topology.touching). 땅 점령은 4방향 그대로
/** v5.6: 재지정·태세 전환이 함께 쓰는 깃발 조작 쿨타임 (3초). 경직은 아니다 — 깃발은 바로 움직인다 */
export const FLAG_ORDER_COOLDOWN_TICKS = 20; // 사용자 확정 튜닝 레버. v5.8: 15 → 20 (4초), 테크로 줄어든다 (TECH_STAT.ORDER_COOLDOWN)
export const FLAG_RECALL_REFUND_PERMILLE = 850;
/** v4.2 [A-63]: RETURNING(회수·IDLE 자동 귀환·패주) 이동 속도 배율. 행군·재지정 이동엔 적용 안 함 */
export const RETURN_SPEED_PERMILLE = 1500; // v4.5: 무테크 값 — 플레이어 스탯 TECH_STAT.RETURN_SPEED (MOB-3B 급속 귀환 2200)
/** 이탈 대기 tick (4.15 g). v4.5: 무테크 값 — 플레이어 스탯 TECH_STAT.DISENGAGE_TICKS (MOB-2B 철수 훈련 10) */
export const DISENGAGE_TICKS = 15;
export const FLAG_IDLE_TIMEOUT = 600;
/**
 * 노출 소모 — **적 땅**(적대 플레이어 소유) 위 깃발, tick 당 병력의 0.05% (최소 1 병력 = 1000 milli/tick).
 * 실제 크기: 0.05% × 300 tick = 분당 약 14% (복리, 1 − 0.9995^300). 구 주석 "≈3%/분" 은 틀린 값이었다.
 */
export const FLAG_EXPOSED_ATTRITION_BP = 5;
/**
 * v4.5 (사용자 2026-10-15): **중립 땅** 위 노출 소모 = 적 땅의 절반 — tick 당 25 / 100,000 (0.025%, 분당 약 7%).
 * [A-113] 단위 = 10만분율(PCM), 최소 = 적 땅 최소의 절반 500 milli/tick. 내 땅·동맹 땅 = 0 (기존)
 */
export const FLAG_EXPOSED_ATTRITION_NEUTRAL_PCM = 25;
/** 노출 소모 tick 당 최소 (milli) — 적 땅 / 중립 땅 [A-113] */
export const FLAG_EXPOSED_MIN_MILLI = 1000;
export const FLAG_EXPOSED_NEUTRAL_MIN_MILLI = 500;
export const FLAG_STALL_TICKS = 25;

// ══ 주둔 유지비 (골드) ══
/**
 * 패치 7차 (사용자 2026-10-25) [A]: 병력 비례 유지비. 출전한 깃발(패주 제외)의 병력 1000명당 골드/초 × 1000(milli) — 창 0.3 / 검 0.5 / 기병 0.9 (v5.8: 기병 1.0 → 0.9).
 * 풀(pool) 병력은 무료, 무료 구간 없음. 테크(마구간)가 바꾸는 병종 가중치(UPKEEP_WEIGHT_*)는 기준(UNIT_GARRISON_PERMILLE) 대비 비율로 곱한다.
 * 순수입 = 총수입 − 유지비 (음수 가능 → 골드가 0 미만이면 빚 패널티, DEBT_*). 아래 GARRISON_UPKEEP_*(계수 방식)는 더 이상 쓰지 않는다(스탯 칸 호환용으로만 남김).
 */
export const UNIT_UPKEEP_RATE_MILLI = [300, 500, 900] as const;
export const GARRISON_UPKEEP_PERMILLE = 90;
export const GARRISON_UPKEEP_FREE_PERMILLE = 1000;
export const GARRISON_UPKEEP_MAX_PERMILLE = 700;
/** 패치 6차 (사용자 2026-10-25) [A]: 골드가 0 미만이면(빚) 전 병종 공격·방어 채널 ×0.7 (모델 2), 점령 속도 ×0.5, 점령(기지 공격 포함) 소모 ×1.5 */
export const DEBT_STAT_PERMILLE = 700;
export const DEBT_CAPTURE_SPEED_PERMILLE = 500;
export const DEBT_CAPTURE_COST_PERMILLE = 1500;
export const GARRISON_ESCALATE_TICK = 900;
export const GARRISON_ESCALATE_MAX = 1; // 사용자 기각 — escalate(f) ≡ 1

// ══ 병종 3종 ══
export const UNIT = { SPEAR: 0, SWORD: 1, CAVALRY: 2 } as const;
export type Unit = (typeof UNIT)[keyof typeof UNIT];
//                                     SPEAR SWORD CAVALRY
// 2026-10-24 기본 능력치 재조정 [A]: 창 90 / 검 100 / 기 120 (구 75 / 100 / 145)
export const UNIT_SPEED_PERMILLE = [900, 1000, 1200] as const;
// 점령(영토·기지 공격) 시 병력 소모 배율. v5.1 (사용자 확정 2026-10-28): 전 병종 1000 — 점령 소모는 병종 무관 (구 1000 / 850 / 1400).
// 병종 전용 점령 소모 테크(SPE-2A·SPE-3B·SWO-2B·CAV-3A)는 그대로 둔다 — docs/issues/20261028-1600-unit-capture-tech-redesign.md
export const UNIT_ATK_MULT_PERMILLE = [1000, 1000, 1000] as const;
// 2026-10-24 밸런스 패치 [A]: 기병 유지비 가중치 1600 → 2000 (사용자 확정 — 기병 쏠림 완화). v5.8 (사용자 2026-11-04): 2000 → 1800 (단가 UNIT_UPKEEP_RATE_MILLI 와 같은 비율)
export const UNIT_GARRISON_PERMILLE = [600, 1000, 1800] as const;
export const UNIT_ASSAULT_PERMILLE = [700, 1000, 1400] as const;
// 2026-10-24 병종 정체성: 최초 동원비(편성비) — 창병 낮음 / 기병 높음 [A] (구 1000 / 1000 / 1150)
// 2026-10-24 밸런스 패치 [A]: 기병 편성비 1300 → 1600 (사용자 확정 — 병력 풀에서만 빠지고 골드는 들지 않는다)
// v5.8 (사용자 2026-11-04): 창병 900 → 1000, 기병 1600 → 1200
export const UNIT_CONVERT_PERMILLE = [1000, 1000, 1200] as const;

// ══ v4.1 진척도 자동 감소 (4.7 e) ══
// v4.1 삭제: DEFENSE_LEVERAGE_PERMILLE, UNIT_DEF_PUSH_PERMILLE (게이지 되돌리기 폐지).
// UNIT_DEF_PERMILLE(깃발 전투 DEF, A-23)은 독립 상수로 유지.
export const PROGRESS_DECAY_MILLI_PER_TICK = 20; // [A-40] 밀지 않는 tick 마다 감소 — 1000 → 0 에 50 tick(10초)
export const PROGRESS_HOLD_RANGE = 1; // [A-41] = FLAG_ENGAGE_RANGE. 4a 스냅숏에서 접촉(8방향, 2026-10-11) 중인 적 깃발 → 감소 면제

// ══ 태세 ══
export const POSTURE = { ATTACK: 0, DEFEND: 1 } as const;
export type Posture = (typeof POSTURE)[keyof typeof POSTURE];

// ══ 테크 v4.3 ══ (사용자 승인 2026-10-11 — 01b_tech-tree-v4.3-proposal.md, A-66~A-84 전부 ①)
// 7갈래(공통 4 + 병종 3) × 32노드, 노드마다 부모 하나·스탯 하나. 보유 노드 = techMask(uint32, 비트 i = 노드 i).
// 효과 합산 [A-71]: stat 값 = (보유한 'set' 노드가 있으면 그 값, 없으면 TECH_STAT_BASE) + Σ 보유한 'add' 노드의 value.
//   정수 덧셈만 → 구매 순서와 무관. 한 스탯에 'set' 노드는 최대 하나, 'set' 과 'add' 를 섞지 않는다(shared/tech.ts 가 로드 시 검사).
// 가격 [A-69·A-70]: cost(node, n) = floor(TECH_NODE_BASE_COST[tier-1] × (1000 + TECH_PROGRESSIVE_COEF_PERMILLE × n) / 1000), n = 총 구매 수.
//
// v4.3 에서 폐기 (구 4축 × 3단계 — 기록용 주석, 서버·클라이언트 어디서도 읽지 않는다. match_config.constants 에서도 빠졌다):
//   TECH_AXIS / TECH_AXIS_COUNT / TECH_MAX_TIER / TECH_BASE_COST [450,1100,2600] / 누진 250‰
//   MIL_ATK_COST [1000,930,860,780] · MIL_DEF_COST [1000,1070,1150,1220] · MIL_COMBAT [1000,1025,1050,1075]
//   ECO_GOLD [1000,1250,1550,1900] · ECO_REGEN [1000,1060,1130,1200] · TER_NEUTRAL_COST [1000,880,760,620] · TER_CAP [1000,1100,1220,1350]
//   MOB_SPEED [1000,1450,1720,2000] · MOB_SLOT_BONUS [0,0,1,2] · MOB_CONVERT [1000,1080,1150,1220]
//   SHALLOW_MOVE_BY_TIER [5000,4000,3000,2500] · WATER_EXPOSURE [1000,1000,500,500]
//   COMBAT_WATER_VS_LAND [800,870,950,1000] · COMBAT_WATER_VS_WATER [1000,1000,1050,1100]
// [A-75] 사라진 효과: 물 위 노출 소모 감소(항상 ×1.0), 물 대 물 교전 보너스(항상 ×1.0), 전 병종 편성 효율(기병 CAV-2A 로 축소), 슬롯 +2 단계(최대 +1).
// v4.5 (2026-10-15): 해상 이동·상륙 폐지 — 아래 둘은 서버 계산식이 읽지 않는다(기록용). 스탯 칸 11·13 은 DISENGAGE_TICKS·RETURN_SPEED 로 재사용.
export const SHALLOW_MOVE_PERMILLE_MIN = 2000; // [A-20] (미사용)
/** (미사용) 구 상륙 교전 실효값 배율 [A-25] */
export const COMBAT_WATER_VS_LAND_PERMILLE = 800;

export const TECH_BRANCH = { MIL: 0, ECO: 1, TER: 2, MOB: 3, SPE: 4, SWO: 5, CAV: 6 } as const;
export type TechBranch = (typeof TECH_BRANCH)[keyof typeof TECH_BRANCH];
export const TECH_BRANCH_COUNT = 7;
// 2026-10-24: 경제 → 재정, 영토 → 행정 (갈래 코드 ECO·TER 는 그대로)
export const TECH_BRANCH_NAME = ['군사', '재정', '행정', '기동', '창병', '검병', '기병'] as const;

/**
 * 테크가 건드리는 스탯 (TECH_NODES[].stat). 값은 전부 정수.
 * 병종별 스탯은 `<이름>_SPEAR + unit` 으로 인덱싱한다 (UNIT.SPEAR 0 / SWORD 1 / CAVALRY 2).
 */
export const TECH_STAT = {
  ATK_COST: 0, // 적 땅 점령비용 배율 (공격자 쪽) ‰
  DEF_COST: 1, // 내 땅 피점령비용 배율 (방어자 쪽) ‰
  COMBAT_ATK: 2, // 2026-10-24: 공격 전투값 **점수**(+10 = 병종 기본 +10점 = +100‰) — 공통 부분 (병종 증분 COMBAT_ATK_* 를 더해 쓴다)
  COMBAT_DEF: 3, // 방어 전투값 **점수** — 공통 부분 (병종 증분 COMBAT_DEF_* 를 더해 쓴다)
  GOLD: 4, // 골드 생산 배율 ‰ (국고 +200)
  UPKEEP_COEF: 5, // 그 플레이어의 GARRISON_UPKEEP_PERMILLE (값 자체)
  REGEN: 6, // 병력 재생 배율 ‰
  NEUTRAL_COST: 7, // 중립 땅 점령비용 배율 ‰
  TROOP_CAP: 8, // 병력 상한 배율 ‰
  SUPPLY_COEF: 9, // 그 플레이어의 SUPPLY_COEF_PERMILLE (값 자체)
  SPEED: 10, // 깃발 이동속도 **점수** — 공통 부분 (병종 증분 SPEED_* 를 더해 쓴다), 1점 = 10‰
  DISENGAGE_TICKS: 11, // v4.5 (A-95 ①, 구 SHALLOW_MOVE 칸 재사용): 그 플레이어의 이탈 대기 tick (값 자체, 무테크 DISENGAGE_TICKS 15)
  SLOT_BONUS: 12, // 깃발 슬롯 보너스 (개수)
  RETURN_SPEED: 13, // v4.5 (A-95 ①, 구 LANDING_COMBAT 칸 재사용): 그 플레이어의 귀환 속도 배율 ‰ (값 자체, 무테크 RETURN_SPEED_PERMILLE 1500)
  COMBAT_ATK_SPEAR: 14,
  COMBAT_ATK_SWORD: 15,
  COMBAT_ATK_CAVALRY: 16,
  COMBAT_DEF_SPEAR: 17,
  COMBAT_DEF_SWORD: 18,
  COMBAT_DEF_CAVALRY: 19,
  SPEED_SPEAR: 20,
  SPEED_SWORD: 21,
  SPEED_CAVALRY: 22,
  UPKEEP_WEIGHT_SPEAR: 23, // 그 플레이어의 UNIT_GARRISON_PERMILLE[unit] (값 자체, v5.8: 마구간·목초지가 가산)
  UPKEEP_WEIGHT_SWORD: 24,
  UPKEEP_WEIGHT_CAVALRY: 25,
  CONVERT_SPEAR: 26, // 그 플레이어의 UNIT_CONVERT_PERMILLE[unit] (값 자체)
  CONVERT_SWORD: 27,
  CONVERT_CAVALRY: 28,
  CAPTURE_MULT_SPEAR: 29, // 그 플레이어의 UNIT_ATK_MULT_PERMILLE[unit] (점령비용 병종 배율, 값 자체)
  CAPTURE_MULT_SWORD: 30,
  CAPTURE_MULT_CAVALRY: 31,
  // §33 (전투 모델 2) 예약 칸 — 노드는 아직 없다. 기본값은 모두 효과 없음 (공통 1000 / 가산 0 / 병종별 0)
  MORALE_FULL_BONUS: 32, // 사기 만땅 곱 가산 ‰ (공통). FULL(unit) = MORALE_FULL + 공통 + 병종별
  MORALE_FULL_BONUS_SPEAR: 33,
  MORALE_FULL_BONUS_SWORD: 34,
  MORALE_FULL_BONUS_CAVALRY: 35,
  MORALE_DROP: 36, // 사기 감소율 배율 ‰ (공통 1000 + 병종별 가산)
  MORALE_DROP_SPEAR: 37,
  MORALE_DROP_SWORD: 38,
  MORALE_DROP_CAVALRY: 39,
  MORALE_RECOVER: 40, // 사기 회복 배율 ‰ (공통 1000 + 병종별 가산)
  MORALE_RECOVER_SPEAR: 41,
  MORALE_RECOVER_SWORD: 42,
  MORALE_RECOVER_CAVALRY: 43,
  // 2026-10-24 테크 개편 (재정·행정): 기지 효과는 최대치를 바꾸지 않고 피해·회복·생산 배율로 둔다. 기본 1000
  BASE_DMG: 44, // 기지 체력 피해 배율 ‰ (요새화 −200)
  BASE_RECOVER: 45, // 기지 생산력 회복 속도 배율 ‰ (기지 재건 +500)
  BASE_PROD: 46, // 모든 기지 생산 배율 ‰ (기지 증산 +100). 2026-10-24: 수도 전용 → 전 기지
  // 2026-10-24 재정 개편: 지형별 골드 보너스(‰, 기본 0)와 공통 편성비 배율
  GOLD_PLAIN: 47, // 평지·비옥·언덕 영토 골드 가산 ‰ (농경 +50 · 관개 +100)
  GOLD_POOR: 48, // 사막·산 영토 골드 가산 ‰ (개간 +800 · 채굴 +1200)
  CONVERT: 49, // 편성비 공통 배율 ‰ (기본 1000, 징발 규정 −50) — 병종별 CONVERT_* 에 곱한다
  // 51: 폐지된 GOLD_TERRAIN (v5.8 국고가 GOLD 로 바뀜). 뒤 칸 번호 유지를 위해 비워 둔다
  SIEGE: 50, // 공성: 내 깃발이 적 기지에 입히는 체력 피해 배율 ‰ (기본 1000, 공성 전술 +100 · 공성 장비 +150). tick 당 피해 상한에도 같은 배율
  ORDER_COOLDOWN: 52, // v5.8: 그 플레이어의 재지정·태세 공용 쿨타임 tick (값 자체, 무테크 FLAG_ORDER_COOLDOWN_TICKS 20, 전령 −2 · 지휘 체계 −3)
} as const;
export type TechStat = (typeof TECH_STAT)[keyof typeof TECH_STAT];
export const TECH_STAT_COUNT = 53; // §33: 32 -> 44 (사기 예약 12칸 추가, 앞 32칸 불변), 2026-10-24: 44 -> 47 (기지 3칸), v5.8: 52 -> 53 (쿨타임 1칸)
/** 무테크 스탯 값 (인덱스 = TECH_STAT). 값 자체가 상수인 스탯은 그 상수를 그대로 쓴다 */
export const TECH_STAT_BASE: readonly number[] = [
  1000, 1000, 0, 0, 1000, GARRISON_UPKEEP_PERMILLE, 1000, 1000, 1000, SUPPLY_COEF_PERMILLE, // COMBAT_ATK·COMBAT_DEF 는 점수(기본 0)
  0, DISENGAGE_TICKS, 0, RETURN_SPEED_PERMILLE, // SPEED 도 점수(기본 0)
  0, 0, 0, // COMBAT_ATK_* (공통 COMBAT_ATK 에 더하는 병종 증분)
  0, 0, 0, // COMBAT_DEF_*
  0, 0, 0, // SPEED_* (공통 SPEED 에 더하는 병종 증분)
  UNIT_GARRISON_PERMILLE[0], UNIT_GARRISON_PERMILLE[1], UNIT_GARRISON_PERMILLE[2],
  UNIT_CONVERT_PERMILLE[0], UNIT_CONVERT_PERMILLE[1], UNIT_CONVERT_PERMILLE[2],
  UNIT_ATK_MULT_PERMILLE[0], UNIT_ATK_MULT_PERMILLE[1], UNIT_ATK_MULT_PERMILLE[2],
  0, 0, 0, 0, // MORALE_FULL_BONUS (+ 병종별)
  1000, 0, 0, 0, // MORALE_DROP
  1000, 0, 0, 0, // MORALE_RECOVER
  1000, 1000, 1000, // BASE_DMG · BASE_RECOVER · BASE_PROD
  0, 0, 1000, // GOLD_PLAIN · GOLD_POOR · CONVERT
  1000, // SIEGE
  0, // 51 (폐지)
  FLAG_ORDER_COOLDOWN_TICKS, // ORDER_COOLDOWN
];

/** [A-69] 티어별 기본 가격 (인덱스 = tier-1) */
export const TECH_NODE_BASE_COST = [160, 360, 700, 1200] as const;
/** [A-69·A-70] 구매 1회마다 +6% (총 구매 수 기준) */
export const TECH_PROGRESSIVE_COEF_PERMILLE = 60;
export const TECH_NODE_COUNT = 42; // 2026-10-24: 4티어 × 7갈래. techMask 는 53비트 안전 정수(노드 ≤ 53)

export interface TechNodeDef {
  /** 0..41 = techMask 비트 번호 = cmd_buy_tech.nodeId */
  id: number;
  code: string;
  branch: TechBranch;
  /** 티어 = 가격 티어 (TECH_NODE_BASE_COST[tier-1]) */
  tier: 1 | 2 | 3 | 4;
  /** 선행 노드 id (T1 = null) [A-66] */
  parent: number | null;
  /** 2026-10-24: T4 는 부모 또는 이 노드 중 하나만 보유해도 열린다 */
  parentAlt?: number;
  /** 2026-10-24: 양자택일 — 이 노드를 보유하면 해당 id 노드를 살 수 없다(서로 대칭) */
  exclusive?: number;
  stat: TechStat;
  /** 'add' = 스탯에 value 를 더한다 / 'set' = 스탯을 value 로 덮어쓴다 */
  op: 'add' | 'set';
  value: number;
  name: string;
  /** 짧은 효과 문구 (UI 한 줄) */
  desc: string;
  /** v4.5: 아이콘 콘셉트 (그림 설명, 선택). 실제 아이콘은 클라이언트 techIcons — 새로 바뀐 노드만 채운다 */
  icon?: string;
}

/**
 * 2026-10-24 테크 개편 [A] — 4티어 42노드 (설계: _workspace/06_tech_overhaul_draft.md §10).
 * COMBAT_ATK*·COMBAT_DEF*·SPEED* 의 value 는 **점수**(+10 = 병종 기본 +10점). 나머지는 ‰ 그대로. 수치는 전부 [A] — 밸런스 일괄 패치 때 이 표만 고친다.
 */
export const TECH_NODES: readonly TechNodeDef[] = [
  // 군사 MIL — 공통 (0..5)
  { id: 0, code: 'MIL-1', branch: 0, tier: 1, parent: null, stat: TECH_STAT.REGEN, op: 'add', value: 50, name: '징병령', desc: '병력 재생 +5%' },
  { id: 1, code: 'MIL-2A', branch: 0, tier: 2, parent: 0, stat: TECH_STAT.SIEGE, op: 'add', value: 100, name: '공성 전술', desc: '적 기지 공격 피해 +10%' },
  { id: 2, code: 'MIL-2B', branch: 0, tier: 2, parent: 0, stat: TECH_STAT.TROOP_CAP, op: 'add', value: 60, name: '병참 창고', desc: '병력 상한 +6%' },
  { id: 3, code: 'MIL-3A', branch: 0, tier: 3, parent: 1, stat: TECH_STAT.SIEGE, op: 'add', value: 150, name: '공성 장비', desc: '적 기지 공격 피해 +15%' },
  { id: 4, code: 'MIL-3B', branch: 0, tier: 3, parent: 2, stat: TECH_STAT.TROOP_CAP, op: 'add', value: 60, name: '예비대 편성', desc: '병력 상한 +6%' },
  { id: 5, code: 'MIL-4', branch: 0, tier: 4, parent: 3, parentAlt: 4, stat: TECH_STAT.SLOT_BONUS, op: 'add', value: 1, name: '총동원령', desc: '깃발 슬롯 +1' },
  // 재정 ECO (6..11) — 2A/2B 양자택일
  { id: 6, code: 'ECO-1', branch: 1, tier: 1, parent: null, stat: TECH_STAT.CONVERT, op: 'add', value: -50, name: '징발 규정', desc: '편성비 −5% (전 병종)' },
  { id: 7, code: 'ECO-2A', branch: 1, tier: 2, parent: 6, exclusive: 8, stat: TECH_STAT.GOLD_PLAIN, op: 'add', value: 50, name: '농경', desc: '평지·비옥·언덕 영토 골드 +5%' },
  { id: 8, code: 'ECO-2B', branch: 1, tier: 2, parent: 6, exclusive: 7, stat: TECH_STAT.GOLD_POOR, op: 'add', value: 800, name: '개간', desc: '사막·산 영토 골드 +80%' },
  { id: 9, code: 'ECO-3A', branch: 1, tier: 3, parent: 7, stat: TECH_STAT.GOLD_PLAIN, op: 'add', value: 100, name: '관개', desc: '평지·비옥·언덕 영토 골드 +10%' },
  { id: 10, code: 'ECO-3B', branch: 1, tier: 3, parent: 8, stat: TECH_STAT.GOLD_POOR, op: 'add', value: 1200, name: '채굴', desc: '사막·산 영토 골드 +120%' },
  { id: 11, code: 'ECO-4', branch: 1, tier: 4, parent: 9, parentAlt: 10, stat: TECH_STAT.GOLD, op: 'add', value: 200, name: '국고', desc: '모든 지형 골드 +20%' },
  // 행정 TER (12..17) — 2A/2B 양자택일
  { id: 12, code: 'TER-1', branch: 2, tier: 1, parent: null, stat: TECH_STAT.NEUTRAL_COST, op: 'add', value: -60, name: '개척민', desc: '중립 땅 점령비용 −6%' },
  { id: 13, code: 'TER-2A', branch: 2, tier: 2, parent: 12, exclusive: 14, stat: TECH_STAT.NEUTRAL_COST, op: 'add', value: -80, name: '확장', desc: '중립 땅 점령비용 −8%' },
  { id: 14, code: 'TER-2B', branch: 2, tier: 2, parent: 12, exclusive: 13, stat: TECH_STAT.BASE_DMG, op: 'add', value: -100, name: '요새화', desc: '기지 체력 피해 −10%' },
  { id: 15, code: 'TER-3A', branch: 2, tier: 3, parent: 13, stat: TECH_STAT.BASE_PROD, op: 'add', value: 100, name: '기지 증산', desc: '모든 기지 생산 +10%' },
  { id: 16, code: 'TER-3B', branch: 2, tier: 3, parent: 14, stat: TECH_STAT.BASE_RECOVER, op: 'add', value: 500, name: '기지 재건', desc: '기지 생산력 회복 +50%' },
  { id: 17, code: 'TER-4', branch: 2, tier: 4, parent: 15, parentAlt: 16, stat: TECH_STAT.BASE_DMG, op: 'add', value: -200, name: '기지 확충', desc: '기지 체력 피해 −20%' },
  // 기동 MOB — 공통 (18..23)
  { id: 18, code: 'MOB-1', branch: 3, tier: 1, parent: null, stat: TECH_STAT.RETURN_SPEED, op: 'add', value: 200, name: '행군로', desc: '귀환 속도 ×1.5 → ×1.7' },
  { id: 19, code: 'MOB-2A', branch: 3, tier: 2, parent: 18, stat: TECH_STAT.ORDER_COOLDOWN, op: 'add', value: -2, name: '전령', desc: '재지정·태세 전환 쿨타임 −0.4초', icon: '속도선이 붙은 신호 깃발' },
  { id: 20, code: 'MOB-2B', branch: 3, tier: 2, parent: 18, stat: TECH_STAT.DISENGAGE_TICKS, op: 'set', value: 10, name: '철수 훈련', desc: '이탈 대기 3.0초 → 2.0초', icon: '방패 뒤로 꺾여 돌아가는 화살표' },
  { id: 21, code: 'MOB-3A', branch: 3, tier: 3, parent: 19, stat: TECH_STAT.ORDER_COOLDOWN, op: 'add', value: -3, name: '지휘 체계', desc: '재지정·태세 전환 쿨타임 −0.6초', icon: '시계' },
  { id: 22, code: 'MOB-3B', branch: 3, tier: 3, parent: 20, stat: TECH_STAT.RETURN_SPEED, op: 'add', value: 500, name: '급속 귀환', desc: '귀환 속도 +×0.5', icon: '기지 지붕 + 안으로 들어가는 화살표' },
  { id: 23, code: 'MOB-4', branch: 3, tier: 4, parent: 21, parentAlt: 22, stat: TECH_STAT.SLOT_BONUS, op: 'add', value: 1, name: '참모부', desc: '깃발 슬롯 +1' },
  // 창병 SPE — 창병 깃발에만 (24..29)
  { id: 24, code: 'SPE-1', branch: 4, tier: 1, parent: null, stat: TECH_STAT.SPEED_SPEAR, op: 'add', value: 10, name: '행군 대열', desc: '창병 이동 +10' },
  { id: 25, code: 'SPE-2A', branch: 4, tier: 2, parent: 24, stat: TECH_STAT.COMBAT_ATK_SPEAR, op: 'add', value: 10, name: '장창 돌격', desc: '창병 공격 +10', icon: '앞으로 내지르는 창과 속도선' },
  { id: 26, code: 'SPE-2B', branch: 4, tier: 2, parent: 24, stat: TECH_STAT.COMBAT_DEF_SPEAR, op: 'add', value: 10, name: '방진', desc: '창병 방어 +10' },
  { id: 27, code: 'SPE-3A', branch: 4, tier: 3, parent: 26, stat: TECH_STAT.COMBAT_DEF_SPEAR, op: 'add', value: 10, name: '고슴도치 진', desc: '창병 방어 +10' },
  { id: 28, code: 'SPE-3B', branch: 4, tier: 3, parent: 25, stat: TECH_STAT.CAPTURE_MULT_SPEAR, op: 'add', value: -100, name: '경장 보급', desc: '창병 점령 소모 −0.10' },
  { id: 29, code: 'SPE-4', branch: 4, tier: 4, parent: 27, parentAlt: 28, stat: TECH_STAT.COMBAT_DEF_SPEAR, op: 'add', value: 20, name: '철벽', desc: '창병 방어 +20' },
  // 검병 SWO — 검병 깃발에만 (30..35)
  { id: 30, code: 'SWO-1', branch: 5, tier: 1, parent: null, stat: TECH_STAT.COMBAT_ATK_SWORD, op: 'add', value: 10, name: '검술', desc: '검병 공격 +10' },
  { id: 31, code: 'SWO-2A', branch: 5, tier: 2, parent: 30, stat: TECH_STAT.SPEED_SWORD, op: 'add', value: 10, name: '경장 행군', desc: '검병 이동 +10', icon: '발자국 + 속도선' },
  { id: 32, code: 'SWO-2B', branch: 5, tier: 2, parent: 30, stat: TECH_STAT.COMBAT_DEF_SWORD, op: 'add', value: 10, name: '사슬 갑옷', desc: '검병 방어 +10' },
  { id: 33, code: 'SWO-3A', branch: 5, tier: 3, parent: 31, stat: TECH_STAT.COMBAT_ATK_SWORD, op: 'add', value: 10, name: '정예 검사', desc: '검병 공격 +10' },
  { id: 34, code: 'SWO-3B', branch: 5, tier: 3, parent: 32, stat: TECH_STAT.COMBAT_DEF_SWORD, op: 'add', value: 10, name: '철갑 보병', desc: '검병 방어 +10', icon: '투구' },
  { id: 35, code: 'SWO-4', branch: 5, tier: 4, parent: 34, parentAlt: 33, stat: TECH_STAT.CAPTURE_MULT_SWORD, op: 'add', value: -200, name: '돌격 보병', desc: '검병 점령 소모 −0.20' },
  // 기병 CAV — 기병 깃발에만 (36..41)
  { id: 36, code: 'CAV-1', branch: 6, tier: 1, parent: null, stat: TECH_STAT.SPEED_CAVALRY, op: 'add', value: 10, name: '군마', desc: '기병 이동 +10' },
  { id: 37, code: 'CAV-2A', branch: 6, tier: 2, parent: 36, stat: TECH_STAT.UPKEEP_WEIGHT_CAVALRY, op: 'add', value: -100, name: '마구간', desc: '기병 유지비 가중 −0.1 (1000명당 0.9 → 0.85골드/초)' },
  { id: 38, code: 'CAV-2B', branch: 6, tier: 2, parent: 36, stat: TECH_STAT.COMBAT_ATK_CAVALRY, op: 'add', value: 20, name: '기병창', desc: '기병 공격 +20' },
  { id: 39, code: 'CAV-3A', branch: 6, tier: 3, parent: 37, stat: TECH_STAT.UPKEEP_WEIGHT_CAVALRY, op: 'add', value: -200, name: '목초지', desc: '기병 유지비 가중 −0.2 (1000명당 0.85 → 0.75골드/초)', icon: '울타리 친 풀밭' },
  { id: 40, code: 'CAV-3B', branch: 6, tier: 3, parent: 38, stat: TECH_STAT.COMBAT_ATK_CAVALRY, op: 'add', value: 30, name: '중기병', desc: '기병 공격 +30' },
  { id: 41, code: 'CAV-4', branch: 6, tier: 4, parent: 40, parentAlt: 39, stat: TECH_STAT.CONVERT_CAVALRY, op: 'add', value: -100, name: '군마 징발', desc: '기병 편성비 −0.1 (×1.2 → ×1.1)' },
];

// ══ 승리 ══
export const THRESHOLD_START_PCT = 60;
export const THRESHOLD_DECAY_START = 6000; // 20분 — §24 [A-114] (구 4800 = 16분 [A-38])
export const THRESHOLD_DECAY_PER_MIN_PERMILLE = 3500; // 3.5 %p/분 — §24 [A-115] (구 1500)
export const THRESHOLD_FLOOR_PCT = 25; // §24 [A-116] (구 45). 60 − 3.5 × 10분 = 25 → 바닥 도달 30분(tick 9000)
/**
 * 정수 판정 스케일: 1 %p = 200 단위 (GDD 6.1 thresholdScaled).
 * §24: decay/분 = 3500 × 200 / 1000 = 700 단위(정수) — 분 경계 값은 정확(56.5, 53.0, …).
 * tick 사이 값은 floor (decay/tick = 2.33 단위). threshold_update 는 분 경계에서만 나가므로 표시값은 항상 0.5 %p 단위.
 */
export const THRESHOLD_SCALE = 200;

// ══ 동맹 ══
export const MAX_ALLIES_PER_PLAYER = 2;
export const PROPOSAL_TTL_TICK = 150;
export const ALLIANCE_MIN_DURATION = 300;
export const BACKSTAB_COOLDOWN_TICK = 150;
export const ALLIANCE_CUTOFF_TICK = ENDGAME_RUSH_TICK; // = 종반 러시 tick (§24: 7800 = 26분)
export const LOCKOUT_COUNTDOWN_TICK = 150;
export const LOCKOUT_FREEZE_TICK = 300;

// ══ 봇 ══
// v4.1 [A-46]: BOT_DECISION_INTERVAL / BOT_RESERVE_RATIO / BOT_MIN_DEFENSE_RATIO / 병종 선택은 난이도별 값(BOT_DIFFICULTY)으로 이동.
export type BotDifficultyName = 'EASY' | 'NORMAL' | 'HARD';
export interface BotDifficultyParams {
  decisionInterval: number; // tick
  reserveRatioPermille: number;
  minDefenseRatioPermille: number;
  /** null = chooseUnit 정상, 값 = 항상 그 병종 (UNIT) */
  fixedUnit: number | null;
  /** 봇 성향 0..1000 (서버 전용, 생략 = 500 중립). PlayerState.bot 에만 채워진다 */
  aggressionPermille?: number;
  /** 테크 우선순위 목록 번호 0..3 (서버 전용, 생략 = (playerId-1) % 4 — §32 이전 동작). PlayerState.bot 에만 채워진다 */
  techStyle?: number;
}
export const BOT_DIFFICULTY: Readonly<Record<BotDifficultyName, Readonly<BotDifficultyParams>>> = {
  EASY: { decisionInterval: 30, reserveRatioPermille: 450, minDefenseRatioPermille: 100, fixedUnit: 1 /* SWORD */ },
  NORMAL: { decisionInterval: 15, reserveRatioPermille: 300, minDefenseRatioPermille: 250, fixedUnit: null }, // 기본
  HARD: { decisionInterval: 10, reserveRatioPermille: 200, minDefenseRatioPermille: 300, fixedUnit: null },
};
export const BOT_DIFFICULTY_DEFAULT: BotDifficultyName = 'NORMAL';
export const BOT_COMMIT_NEUTRAL_PERMILLE = 450;
export const BOT_COMMIT_ENEMY_PERMILLE = 350;
// v4.2 봇 기지 공격 (사용자 확정 2026-10-10: 국경 6칸 안 적 기지 후보 · 점수 ×2.5 · 풀 50%). 나머지 값은 에이전트 선택 (프로토콜 §10)
export const BOT_COMMIT_BASE_PERMILLE = 500; // 기지 공격 발령 병력 = 풀 × 50% (사용자 확정)
export const BOT_BASE_ATTACK_RANGE = 6; // 내 땅에서 이 거리 안의 적 기지만 후보 (사용자 확정)
export const BOT_BASE_ATTACK_WEIGHT_PERMILLE = 2500; // 기지 후보 점수 ×2.5 (사용자 확정)
export const BOT_BASE_UNGUARDED_PERMILLE = 1500; // 적 방어 관할 원 밖 기지 ×1.5 (에이전트 선택)
export const BOT_BASE_CAPITAL_PERMILLE = 1500; // 수도 ×1.5 (에이전트 선택). 체력 절반 미만 ×1.4 는 기존 8.3 항 그대로
export const BOT_DEFEND_COMMIT_PERMILLE = 400;
export const BOT_NEUTRAL_BIAS_TICK = 2442;
export const BOT_THREAT_TRIGGER = 3000;
export const BOT_THREAT_LOOKAHEAD = 25;
export const BOT_BASE_THREAT_W = 3;
/** 패치 5차: 기지 위협 점수를 구 기지 체력(22500) 척도로 환산하는 기준 — 기지별 최대 체력이 달라져도 가중치 튜닝을 유지 */
export const BOT_BASE_HP_REF = 22500;
export const BOT_PREEMPT_FACTOR_PERMILLE = 1600;
export const BOT_STALL_SWITCH_PERMILLE = 1300;
export const BOT_GARRISON_PATIENCE = 900;
export const BOT_GUARD_PENALTY = 2;
export const BOT_INTERCEPT_RATIO_PERMILLE = 1250;
export const BOT_AVOID_RATIO_PERMILLE = 900;
export const BOT_RETREAT_RATIO_PERMILLE = 800; // [A-32]
export const BOT_COUNTER_MARGIN_PERMILLE = 1200; // [A-32]
export const BOT_BLOCK_ATTACK_RATIO_PERMILLE = 500; // [A-32]
/** v4.7 (§29) A5: 봇은 전투 시작 후 이 tick(10초) 동안 후퇴·회수·재지정하지 않는다 (봇 전용 — 사람·시스템 규칙과 무관) [A-127] */
export const BOT_MIN_ENGAGE_TICKS = 50;
/** v4.8 (§29.5) A5 후속 [A-135]: 내 실효력(병력×위력)이 교전 상대 합의 이 비(‰) 미만이면 최소 교전 시간 억제를 해제한다 (봇 전용) */
export const BOT_ENGAGE_BREAK_RATIO_PERMILLE = 200; // 1:5 (시험 100~1000 중 채택, §29.5)

// ══ 봇 성향 aggression (사용자 결정 2026-10-09, 3차-2 후속) ══
// 봇마다 aggressionPermille ∈ [0, 1000] (0 = 수비적, 1000 = 공격적) 을 (룸 시드, playerId) 정수 해시로 배정.
// 알고리즘 분기 없음 — 아래 값만 보간: 값(a) = 기준 + (a − 500) × SPAN / 500 (floor 아님: 정수 나눗셈 trunc, 결과 clamp).
// 기준 = 난이도 값(BOT_DIFFICULTY) 또는 아래 전역 기준. a = 500 이면 성향 없음(기준 그대로).
export const BOT_AGGRESSION_NEUTRAL_PERMILLE = 500;
// 패치 8차 (사용자 2026-10-25): 신중형 분기 폐지. 성향은 알고리즘을 바꾸지 않고 '예비 병력 비율'과 '적 공격 발령 병력 비율' 두 값만 상·하한 안에서 바꾼다.
export const BOT_RESERVE_RATIO_MIN_PERMILLE = 150; // [A]
export const BOT_RESERVE_RATIO_MAX_PERMILLE = 450; // [A]
export const BOT_COMMIT_ENEMY_MIN_PERMILLE = 200; // [A]
export const BOT_COMMIT_ENEMY_MAX_PERMILLE = 500; // [A]
/** 적 땅 공격 깃발을 기병(단기전)으로 낼 확률 ‰ — 교전 시도마다 시드 해시 난수로 기병/검병을 고른다. 아니면 검병(지속전) [A] */
export const BOT_CAVALRY_CHANCE_PERMILLE = 500;
/** 초반(BOT_NEUTRAL_BIAS_TICK 전) 중립 땅 앵커 점수 배수 ‰ (구 160%). 중립 기지 가중(BOT_NEUTRAL_BASE_WEIGHT_PERMILLE)은 bot.ts [A] */
export const BOT_NEUTRAL_EARLY_MULT_PERMILLE = 3000;
export const BOT_MAX_DEFENSE_RATIO_PERMILLE = 500; // 방어 깃발 상한 비율 기준 (굳히기·새 요격 발령 상한, 이전 임의값 "슬롯 절반")
export const BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE = 1000; // 적(비중립) 앵커 점수 가중 기준
export interface BotAggressionSpan {
  reserveRatioPermille: number; // 난이도 기준 ± — 공격적일수록 예비 작게 (패치 8차: 비율 항목)
  commitEnemyPermille: number; // BOT_COMMIT_ENEMY_PERMILLE ± — 공격적일수록 적 공격 발령 병력 크게 (패치 8차: 비율 항목)
  // 패치 8차: 아래 항목은 성향과 무관하게 기준값 고정 (편차 0)
  minDefenseRatioPermille: number;
  maxDefenseRatioPermille: number;
  counterMarginPermille: number;
  retreatRatioPermille: number;
  blockAttackRatioPermille: number;
  enemyAnchorWeightPermille: number;
}
/** a = 0 / 1000 에서의 편차 = ∓SPAN. 예: reserve NORMAL 300 → 400(수비) … 200(공격) */
export const BOT_AGGRESSION_SPAN: Readonly<BotAggressionSpan> = {
  reserveRatioPermille: -100,
  commitEnemyPermille: 150, // [A] 성향 0 → 200, 500 → 350, 1000 → 500
  minDefenseRatioPermille: 0,
  maxDefenseRatioPermille: 0,
  counterMarginPermille: 0,
  retreatRatioPermille: 0,
  blockAttackRatioPermille: 0,
  enemyAnchorWeightPermille: 0,
};

// ══ v4.0 깃발 대 깃발 전투 (4.15) ══
export const COMBAT_LOSS_BP = 90; // [A-11] v4.5 사용자 2026-10-15: 150 → 90 (0.9%)
export const COMBAT_LOSS_FLOOR_BP = 45; // [A-11] v4.5 [A-105]: 75 → 45 (손실률과 같은 비율 ×0.6)
export const COMBAT_MIN_LOSS_MILLI = 1000;
//                                   SPEAR SWORD CAVALRY
export const UNIT_ATK_PERMILLE = [900, 1000, 1200] as const; // [A-23] 2026-10-24 재조정 (구 870 / 1000 / 1180)
export const UNIT_DEF_PERMILLE = [1100, 1000, 900] as const; // [A-23] 2026-10-24 재조정 (구 1300 / 1000 / 700)
/** 방어 태세만, 소유자 무관. 인덱스 = TERRAIN (v4.5: 물 칸에는 깃발이 서지 않는다) */
export const COMBAT_TERRAIN_DEF_POSTURE_PERMILLE = [1000, 1000, 1050, 1300, 1000, 1600, 1000] as const;
// DISENGAGE_TICKS 는 깃발 절로 옮겼다 (v4.5 — TECH_STAT_BASE 가 참조)
export const DISENGAGE_VALUE_PERMILLE = 500; // [A-31]
export const ANY_HOSTILE = 254; // targetOwnerId 예약값 [A-27]
// ══ §33 전투 모델 2 (v4.9, 2026-10-23 설계 05_combat_redesign_draft.md rev.4) ══
// COMBAT_MODEL = 기본 모델 (1 = 현행, 2 = 채널 비교 + 사기). 서버는 환경변수 COMBAT_MODEL=2 또는 createGameState 인자로 덮어쓴다.
// 모델 1 에서는 아래 상수를 아무도 읽지 않는다 (현행 상수는 삭제하지 않는다).
export const COMBAT_MODEL: 1 | 2 = 2;
export const CHANNEL_COUNT = 2;
/** 채널 번호 (채널을 늘리면 뒤에 붙인다) */
export const CHANNEL = { ATK: 0, DEF: 1 } as const;
/** UNIT_STAT[채널][병종] — 병종 기본 능력치 (현행 ATK/DEF 표와 같은 값) */
export const UNIT_STAT: readonly (readonly number[])[] = [UNIT_ATK_PERMILLE, UNIT_DEF_PERMILLE];
/**
 * TERRAIN_BUFF[지형][태세][채널] ‰ — 인덱스 = TERRAIN(0..6), 태세 = POSTURE(0 공격, 1 방어), 채널 = CHANNEL.
 * 깃발이 서 있는 자기 칸의 지형만 읽는다. 기지 칸은 BASE_BUFF 가 대체한다.
 */
export const TERRAIN_BUFF: readonly (readonly (readonly number[])[])[] = [
  [[1000, 1000], [1000, 1000]], // DEEP (깃발이 서지 않음)
  [[1050, 1000], [1000, 1000]], // PLAIN    패치 11차 (사용자 2026-10-26): 채널 한정 — 공격 태세일 때 공격력만 +5%
  [[1050, 1000], [1000, 1000]], // FERTILE  공격 태세일 때 공격력만 +5%
  [[1000, 1000], [1000, 1200]], // HILLS    방어 태세일 때 방어력만 +20% (패치 12차: +10% → +20%)
  [[900, 1000], [900, 1000]], // DESERT     태세 무관 공격력만 −10%
  [[1000, 1000], [1000, 1500]], // MOUNTAIN 방어 태세일 때 방어력만 +50% (패치 12차: +30% → +50%)
  [[1000, 1000], [1000, 1000]], // SHALLOW (깃발이 서지 않음)
];
/** BASE_BUFF[태세][채널] ‰ — 자기 기지 칸(수도 포함). 지형 항을 대체한다. 패치 11차: 방어 태세일 때 방어력만 +20% */
// 2026-10-23 레버 조정(측정 없음, [A-166]): 1300 → 1200. 자가대전 20판에서 1300 은 멸망 0.10/판, 1200 은 0.25, 1100 은 0.30(현행 모델 1 은 0.85) — 기본 모델이 1 이라 영향 없음
export const BASE_BUFF: readonly (readonly number[])[] = [
  [1000, 1000],
  [1000, 1200],
];
export const COMBAT_GAMMA = 2; // 대비 지수 (구현은 정수 역제곱 고정; 값은 표시·문서용)
export const COMBAT_VMIN = 100; // 편 채널값 하한
export const DISENGAGE_VALUE_PERMILLE_V2 = 700; // 이탈 대기 배율 (현행 500)
// 사기 (깃발 단위, ‰ 0..1000)
export const MORALE_MAX = 1000;
/** v5.4 (사용자 확정 2026-10-31): 출전한 새 깃발의 시작 사기 ‰ (화면 90%). 기지에서 기다렸다 나가는 요격을 너프한다 — 행군 중 MORALE_RECOVER 로 회복하므로 기지 앞 짧은 출전만 불리하다. 모델 2 전용 */
export const SORTIE_INITIAL_MORALE = 900;
/** 패치 12차 (시제품 A 채택, 사용자 2026-10-26) [A]: 병종별 사기 곱 범위 ‰ — 인덱스 = UNIT (창/검/기). 사기 0 → FLOOR, 1000 → FULL, 사이는 선형 */
export const MORALE_FLOOR: readonly number[] = [1050, 850, 750];
export const MORALE_FULL: readonly number[] = [1100, 1200, 1300];
export const MORALE_MULT_CAP = 1500; // 곱 상한 (테크 기세 가산 후에도)
/** 교전 tick 당 사기 고정 감소 ‰ — 인덱스 = UNIT. 공격 태세 창 3 / 검 4 / 기 5 (v5.7 사용자 결정: 기병 6 → 5) */
export const MORALE_DROP_PER_TICK = [3, 4, 5] as const;
/** 방어 태세 교전 tick 당 사기 고정 감소 ‰ — 창 2 / 검 3 / 기 4 (v5.7 사용자 결정: 기병 5 → 4) */
export const MORALE_DROP_DEFEND_PER_TICK = [2, 3, 4] as const;
/** 그 tick 자기 병력 손실 1%당 추가 사기 감소 ‰ (v5.7 사용자 결정: 10 → 5) — 많이 잃는 편이 더 빨리 꺾이고, 이기는 편은 사기를 지킨다 */
export const MORALE_DROP_LOSS_K = 5;
export const MORALE_RECOVER = 3; // 비전투 tick 당 회복 ‰
export const MORALE_RECOVER_BASE = 10; // 자기 기지 칸 위 비전투 tick 당 회복 ‰
/** v5.1 (GDD 4.5, 사용자 확정 2026-10-28): 자기 기지 칸(수도 포함) 위 깃발의 사기 하한 ‰ (화면 30%). 모델 2 전용.
 *  교전 중: m < 하한 이면 +MORALE_RECOVER_BASE(테크 회복 배율)로 하한까지만 회복, m ≥ 하한 이면 max(하한, m − 감소).
 *  점령 사기 소모(7단계): m < 하한 이면 소모 없음, 아니면 max(하한, m − 소모). 패주(사기 0 직접 대입)에는 적용하지 않는다 */
export const MORALE_BASE_FLOOR = 300;
export const MORALE_DELTA_INTERVAL = 5; // 델타 moraleChanged 주기 (tick)
/** 2026-10-24 [A] 점령·기지 공격(게이지를 미는 tick) 사기 소모 ‰/tick — 병종별 실효 점령 배율(techCaptureMultPm)을 곱한다. 모델 2 전용 */
export const CAPTURE_MORALE_DROP = 6;
// 패치 5차: 교전 기지 소모(BASE_COMBAT_DMG_MILLI_PER_TICK) 폐지 — 방어 깃발이 선 기지도 밀 수 있으므로(BASE_DEFENDED_DMG_PERMILLE) 불필요
/** 2026-10-24 밸런스 패치 4차 [A]: 방어 깃발(전투 가능)이 서 있는 기지를 공격자가 미는 피해 배율 ‰ (사용자 확정 — 절반). 모델 2 전용.
 *  깃발이 없는 기지는 1000. 교전 중인 공격 깃발도 이 경우에 한해 기지를 밀 수 있다 */
export const BASE_DEFENDED_DMG_PERMILLE = 500;

// 폐기·구현 금지: COMBAT_HOME_DEF_PERMILLE, COMBAT_TERRAIN_DEF_PERMILLE(A-16), UNIT_POWER, LOSER_ATTRITION_RATIO 등

// ══ 로비 (v4.1 2.8 h — 사용자 승인값 + 백엔드 결정) ══
export const ROOM_CODE_LENGTH = 6;
export const NICKNAME_MAX_LEN = 16;
export const LOBBY_COUNTDOWN_MS = 3000;
/** 공개 룸: 첫 인간 입장 후 이 시간이 지나면 남은 자리를 봇으로 채우고 시작 (GDD PUBLIC_AUTOSTART_MS) */
export const PUBLIC_LOBBY_AUTOSTART_MS = 30000;
/** 공개 룸 정원 — 시작 시 빈자리를 NORMAL 봇으로 충원 */
export const PUBLIC_ROOM_PLAYERS = 10;
export const PUBLIC_ROOM_SIZE: MapSizeClass = 'M';
/**
 * 판 길이 추정식(GDD 2.8 e)의 기준 1인당 육지 = M 10인의 육지/인. v4.5 [A-110]: 물 ≈ 10% 로 390 → 540.
 * 서버 pacingNote 와 클라이언트 미리보기가 같은 값을 쓴다
 */
export const PACING_P_REF_LAND_PER_PLAYER = Math.floor((MAP_SIZE_PRESETS.M.w * MAP_SIZE_PRESETS.M.h * TARGET_LAND_RATIO_PERMILLE) / 1000 / PUBLIC_ROOM_PLAYERS);
/** 게임 종료 후 룸을 정리하기까지 대기 */
export const ROOM_CLOSE_AFTER_GAME_MS = 60000;
/** 세션당 tick 당 최대 명령 수 — 초과분은 RATE_LIMITED */
export const MAX_COMMANDS_PER_TICK = 10;
export const EMOTE_CODE_MAX = 15;
