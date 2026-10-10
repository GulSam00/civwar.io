/**
 * civwar.io 밸런스 상수 — 단일 소스 (GDD v4.0 부록 A, 3단계 2차 재조정 반영)
 *
 * 규칙
 *  - 모든 배율은 permille 정수(1/1000 고정소수점). `1.15` → `1150`.
 *  - `_BP` 접미사는 basis point(1/10000).
 *  - `_MILLI` 접미사는 1/1000 단위 정수(병력·골드·진척도·기지 체력).
 *  - 지형별 배열은 TERRAIN enum 값(0..6)으로 인덱싱한다.
 *  - 테크 단계별 배열은 [무테크, T1, T2, T3] 4칸.
 *  - 페이싱 레버(ENEMY_BASE, THRESHOLD_*, HARD_TIMEOUT_TICK, POSTURE_COOLDOWN_TICKS 등)는
 *    여기에서만 정의한다. 서버·클라이언트 어느 곳에서도 하드코딩 금지.
 *
 * 서버는 이 객체 전체를 match_config.constants 로 클라이언트에 내려보낸다(GDD 7.6).
 */

// ══ 프로토콜 ══
export const PROTOCOL_VERSION = 1;

// ══ 시간 ══
export const TICK_MS = 200; // 초당 5 tick
export const TICKS_PER_MIN = 300;
export const ENDGAME_RUSH_TICK = 8400; // 28분 [A-38]
export const ENDGAME_RUSH_COST_MULT_PERMILLE = 750; // tileCost × 0.75
export const HARD_TIMEOUT_TICK = 9600; // 32분 [A-38]
export const SNAPSHOT_FULL_INTERVAL = 25; // 5초
export const PLAYER_DELTA_INTERVAL = 5; // 1초. troops/gold/flagStats 델타 주기
export const BASE_HP_DELTA_INTERVAL = 5; // 1초
export const DISCONNECT_GRACE_TICK = 450; // 90초

// ══ 인원 ══ (v4.1 2.8: 방 최대 인원 2~12)
export const ROOM_MAX_PLAYERS_RANGE = [2, 12] as const;
export const MIN_PLAYERS = ROOM_MAX_PLAYERS_RANGE[0];
export const MAX_PLAYERS = ROOM_MAX_PLAYERS_RANGE[1];

// ══ 맵 ══ (v2.1 불변)
export const LAND_TILES_PER_PLAYER = 390;
export const TARGET_LAND_RATIO_PERMILLE = 650;
export const LAND_RATIO_MIN_PERMILLE = 600;
export const LAND_RATIO_MAX_PERMILLE = 700;
export const CA_INIT_LAND_P_PERMILLE = 550;
export const CA_LAND_P_STEP_PERMILLE = 20; // 시도마다 p ± 0.02
export const CA_MAX_ATTEMPTS = 10;
export const CA_SMOOTH_STEPS = 4;
export const CA_LAND_NEIGHBOR_MIN = 5; // 8방향 기준
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
export const TERRAIN_GOLD_MILLI = [0, 1000, 2300, 900, 300, 250, 0] as const;
/** "느려짐 배율". DEEP 은 통행 불가 → 0(조회되지 않음). SHALLOW 5000 = 속도 0.2배 */
export const TERRAIN_MOVE_PERMILLE = [0, 1000, 1000, 1250, 1100, 1800, 5000] as const;
export const SHALLOW_MOVE_PERMILLE = 5000;

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
export const BASE_HP_MAX_MILLI = 15000;
export const BASE_HP_INIT_MILLI = 15000;
export const BASE_HP_CAPTURE_MILLI = 7500;
export const BASE_HP_REGEN_MILLI = 23; // [A-39]
export const BASE_REGEN_DELAY_TICK = 50;
export const BASE_CAPTURE_LOCK_TICK = 25;

// ══ 시작값 ══
export const START_TROOPS = 150;
export const START_GOLD = 200;

// ══ 병력 ══
export const TROOP_CAP_BASE = 100;
export const TROOP_CAP_PER_TILE = 12;
export const REGEN_BASE_MILLI = 800; // 0.8
export const REGEN_SQRT_COEF_PERMILLE = 500; // 0.50

// ══ 골드 ══
export const GOLD_RATE_PERMILLE = 2080; // [A-39]

// ══ 점령 비용 ══
export const NEUTRAL_BASE = 7; // [A-37]
export const NEUTRAL_SQRT_COEF_PERMILLE = 750; // [A-37]
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
export const FLAG_ENGAGE_RANGE = 1; // ATTACK 도착 판정 + 깃발 교전 거리(D-2)
export const FLAG_RETARGET_LOCK_TICK = 15;
export const FLAG_RECALL_REFUND_PERMILLE = 850;
/** v4.2 [A-63]: RETURNING(회수·IDLE 자동 귀환·패주) 이동 속도 배율. 행군·재지정 이동엔 적용 안 함 */
export const RETURN_SPEED_PERMILLE = 1500;
export const FLAG_IDLE_TIMEOUT = 600;
export const FLAG_EXPOSED_ATTRITION_BP = 5;
export const FLAG_STALL_TICKS = 25;

// ══ 주둔 유지비 (골드) ══
export const GARRISON_UPKEEP_PERMILLE = 90;
export const GARRISON_UPKEEP_FREE_PERMILLE = 1000;
export const GARRISON_UPKEEP_MAX_PERMILLE = 700;
export const GARRISON_ESCALATE_TICK = 900;
export const GARRISON_ESCALATE_MAX = 1; // 사용자 기각 — escalate(f) ≡ 1

// ══ 병종 3종 ══
export const UNIT = { SPEAR: 0, SWORD: 1, CAVALRY: 2 } as const;
export type Unit = (typeof UNIT)[keyof typeof UNIT];
//                                     SPEAR SWORD CAVALRY
export const UNIT_SPEED_PERMILLE = [750, 1000, 1450] as const;
export const UNIT_ATK_MULT_PERMILLE = [1150, 1000, 850] as const;
export const UNIT_GARRISON_PERMILLE = [600, 1000, 1600] as const;
export const UNIT_ASSAULT_PERMILLE = [700, 1000, 1400] as const;
export const UNIT_CONVERT_PERMILLE = [1000, 1000, 1150] as const;

// ══ v4.1 진척도 자동 감소 (4.7 e) ══
// v4.1 삭제: DEFENSE_LEVERAGE_PERMILLE, UNIT_DEF_PUSH_PERMILLE (게이지 되돌리기 폐지).
// UNIT_DEF_PERMILLE(깃발 전투 DEF, A-23)은 독립 상수로 유지.
export const PROGRESS_DECAY_MILLI_PER_TICK = 20; // [A-40] 밀지 않는 tick 마다 감소 — 1000 → 0 에 50 tick(10초)
export const PROGRESS_HOLD_RANGE = 1; // [A-41] = FLAG_ENGAGE_RANGE. 4a 스냅숏 거리 ≤ 1 적 깃발 → 감소 면제

// ══ 태세 ══
export const POSTURE = { ATTACK: 0, DEFEND: 1 } as const;
export type Posture = (typeof POSTURE)[keyof typeof POSTURE];

// ══ 테크 ══
export const TECH_AXIS = { MILITARY: 0, ECONOMY: 1, TERRITORY: 2, MOBILITY: 3 } as const;
export type TechAxis = (typeof TECH_AXIS)[keyof typeof TECH_AXIS];
export const TECH_AXIS_COUNT = 4;
export const TECH_MAX_TIER = 3;
/** 인덱스 = tier-1 */
export const TECH_BASE_COST = [450, 1100, 2600] as const;
export const TECH_PROGRESSIVE_COEF_PERMILLE = 250;
//                                                  무테크 T1   T2   T3
export const MIL_ATK_COST_PERMILLE_BY_TIER = [1000, 930, 860, 780] as const;
export const MIL_DEF_COST_PERMILLE_BY_TIER = [1000, 1070, 1150, 1220] as const;
export const MIL_COMBAT_PERMILLE_BY_TIER = [1000, 1025, 1050, 1075] as const; // [A-36]
export const ECO_GOLD_PERMILLE_BY_TIER = [1000, 1250, 1550, 1900] as const;
export const ECO_REGEN_PERMILLE_BY_TIER = [1000, 1060, 1130, 1200] as const;
export const TER_NEUTRAL_COST_PERMILLE_BY_TIER = [1000, 880, 760, 620] as const;
export const TER_CAP_PERMILLE_BY_TIER = [1000, 1100, 1220, 1350] as const;
export const MOB_SPEED_PERMILLE_BY_TIER = [1000, 1450, 1720, 2000] as const;
export const MOB_SLOT_BONUS_BY_TIER = [0, 0, 1, 2] as const;
export const MOB_CONVERT_PERMILLE_BY_TIER = [1000, 1080, 1150, 1220] as const;
// 물 업그레이드 = 기동 축 단계 [A-19]
export const SHALLOW_MOVE_PERMILLE_BY_TIER = [5000, 4000, 3000, 2500] as const;
export const SHALLOW_MOVE_PERMILLE_MIN = 2000; // [A-20]
export const WATER_EXPOSURE_PERMILLE_BY_TIER = [1000, 1000, 500, 500] as const;
export const COMBAT_WATER_VS_LAND_PERMILLE = [800, 870, 950, 1000] as const; // [A-25]
export const COMBAT_WATER_VS_WATER_PERMILLE = [1000, 1000, 1050, 1100] as const; // [A-25]

// ══ 승리 ══
export const THRESHOLD_START_PCT = 60;
export const THRESHOLD_DECAY_START = 4800; // 16분 [A-38]
export const THRESHOLD_DECAY_PER_MIN_PERMILLE = 1500; // 1.5 %p/분 [A-38]
export const THRESHOLD_FLOOR_PCT = 45;
/**
 * 정수 판정 스케일: 1 %p = 200 단위 (GDD 6.1 thresholdScaled).
 * decay/tick = 1500 × 200 / (1000 × 300) = 1 단위 → 정확히 정수.
 */
export const THRESHOLD_SCALE = 200;

// ══ 동맹 ══
export const MAX_ALLIES_PER_PLAYER = 2;
export const PROPOSAL_TTL_TICK = 150;
export const ALLIANCE_MIN_DURATION = 300;
export const BACKSTAB_COOLDOWN_TICK = 150;
export const ALLIANCE_CUTOFF_TICK = 8400; // = ENDGAME_RUSH_TICK [A-38]
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
export const BOT_PREEMPT_FACTOR_PERMILLE = 1600;
export const BOT_STALL_SWITCH_PERMILLE = 1300;
export const BOT_GARRISON_PATIENCE = 900;
export const BOT_GUARD_PENALTY = 2;
export const BOT_INTERCEPT_RATIO_PERMILLE = 1250;
export const BOT_AVOID_RATIO_PERMILLE = 900;
export const BOT_RETREAT_RATIO_PERMILLE = 800; // [A-32]
export const BOT_COUNTER_MARGIN_PERMILLE = 1200; // [A-32]
export const BOT_BLOCK_ATTACK_RATIO_PERMILLE = 500; // [A-32]

// ══ 봇 성향 aggression (사용자 결정 2026-10-09, 3차-2 후속) ══
// 봇마다 aggressionPermille ∈ [0, 1000] (0 = 수비적, 1000 = 공격적) 을 (룸 시드, playerId) 정수 해시로 배정.
// 알고리즘 분기 없음 — 아래 값만 보간: 값(a) = 기준 + (a − 500) × SPAN / 500 (floor 아님: 정수 나눗셈 trunc, 결과 clamp).
// 기준 = 난이도 값(BOT_DIFFICULTY) 또는 아래 전역 기준. a = 500 이면 성향 없음(기준 그대로).
export const BOT_AGGRESSION_NEUTRAL_PERMILLE = 500;
export const BOT_MAX_DEFENSE_RATIO_PERMILLE = 500; // 방어 깃발 상한 비율 기준 (굳히기·새 요격 발령 상한, 이전 임의값 "슬롯 절반")
export const BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE = 1000; // 적(비중립) 앵커 점수 가중 기준
export interface BotAggressionSpan {
  reserveRatioPermille: number; // 난이도 기준 ± — 공격적일수록 예비 작게
  minDefenseRatioPermille: number; // 난이도 기준 ±
  maxDefenseRatioPermille: number; // BOT_MAX_DEFENSE_RATIO_PERMILLE ±
  counterMarginPermille: number; // BOT_COUNTER_MARGIN_PERMILLE ± — 공격적일수록 낮은 우위에도 반격
  retreatRatioPermille: number; // BOT_RETREAT_RATIO_PERMILLE ± — 공격적일수록 덜 후퇴
  blockAttackRatioPermille: number; // BOT_BLOCK_ATTACK_RATIO_PERMILLE ± — 공격적일수록 차단 깃발을 더 쉽게 공격
  enemyAnchorWeightPermille: number; // BOT_ENEMY_ANCHOR_WEIGHT_PERMILLE ± — 공격적일수록 적 땅 앵커 선호
}
/** a = 0 / 1000 에서의 편차 = ∓SPAN. 예: reserve NORMAL 300 → 400(수비) … 200(공격) */
export const BOT_AGGRESSION_SPAN: Readonly<BotAggressionSpan> = {
  reserveRatioPermille: -100,
  minDefenseRatioPermille: -100,
  maxDefenseRatioPermille: -200,
  counterMarginPermille: -200,
  retreatRatioPermille: -200,
  blockAttackRatioPermille: 200,
  enemyAnchorWeightPermille: 400,
};

// ══ v4.0 깃발 대 깃발 전투 (4.15) ══
export const COMBAT_LOSS_BP = 150; // [A-11]
export const COMBAT_LOSS_FLOOR_BP = 75; // [A-11]
export const COMBAT_MIN_LOSS_MILLI = 1000;
//                                   SPEAR SWORD CAVALRY
export const UNIT_ATK_PERMILLE = [870, 1000, 1180] as const; // [A-23]
export const UNIT_DEF_PERMILLE = [1300, 1000, 700] as const; // [A-23]
/** 방어 태세만, 소유자 무관. 물 위 1000 [A-24]. 인덱스 = TERRAIN */
export const COMBAT_TERRAIN_DEF_POSTURE_PERMILLE = [1000, 1000, 1050, 1300, 1000, 1600, 1000] as const;
export const POSTURE_COOLDOWN_TICKS = 25; // 사용자 확정 튜닝 레버
export const DISENGAGE_TICKS = 15;
export const DISENGAGE_VALUE_PERMILLE = 500; // [A-31]
export const ANY_HOSTILE = 254; // targetOwnerId 예약값 [A-27]
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
/** 게임 종료 후 룸을 정리하기까지 대기 */
export const ROOM_CLOSE_AFTER_GAME_MS = 60000;
/** 세션당 tick 당 최대 명령 수 — 초과분은 RATE_LIMITED */
export const MAX_COMMANDS_PER_TICK = 10;
export const EMOTE_CODE_MAX = 15;
