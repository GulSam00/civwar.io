/**
 * 옵션 창 설정 (사용자 요청 2026-10-11). localStorage 한 키에 JSON 으로 저장, 실패하면 기본값.
 * 이전 버전의 낱개 키(civwar.colorblind / civwar.directions)는 새 키가 없을 때 한 번 읽어 옮긴다.
 */

export type DirectionMode = 'all' | 'mine' | 'off';

/** 지형 툴팁 항목 */
export const TOOLTIP_FIELDS = ['terrain', 'defense', 'speed', 'cost', 'gold', 'owner', 'baseHp'] as const;
export type TooltipField = (typeof TOOLTIP_FIELDS)[number];

export const TOOLTIP_FIELD_NAME: Record<TooltipField, string> = {
  terrain: '지형 유형',
  defense: '전투 보정',
  speed: '이동력',
  cost: '점령 비용',
  gold: '골드',
  owner: '소유자',
  baseHp: '기지 체력',
};

export const DIRECTION_MODE_NAME: Record<DirectionMode, string> = {
  all: '모두 보기',
  mine: '내 깃발만',
  off: '숨기기',
};

export interface GameOptions {
  colorblind: boolean;
  directions: DirectionMode;
  tooltip: boolean;
  tooltipFields: Record<TooltipField, boolean>;
}

export const OPTIONS_KEY = 'civwar.options.v1';
const LEGACY_COLORBLIND = 'civwar.colorblind';
const LEGACY_DIRECTIONS = 'civwar.directions';

export function defaultOptions(): GameOptions {
  return {
    colorblind: false,
    directions: 'all',
    tooltip: true,
    tooltipFields: { terrain: true, defense: true, speed: true, cost: true, gold: true, owner: true, baseHp: true },
  };
}

/** 저장값이 일부 깨졌거나 옛 버전이어도 알려진 필드만 골라 기본값 위에 얹는다 */
export function sanitizeOptions(raw: unknown): GameOptions {
  const o = defaultOptions();
  if (!raw || typeof raw !== 'object') return o;
  const r = raw as Record<string, unknown>;
  if (typeof r.colorblind === 'boolean') o.colorblind = r.colorblind;
  if (r.directions === 'all' || r.directions === 'mine' || r.directions === 'off') o.directions = r.directions;
  if (typeof r.tooltip === 'boolean') o.tooltip = r.tooltip;
  if (r.tooltipFields && typeof r.tooltipFields === 'object') {
    const f = r.tooltipFields as Record<string, unknown>;
    for (const k of TOOLTIP_FIELDS) if (typeof f[k] === 'boolean') o.tooltipFields[k] = f[k] as boolean;
  }
  return o;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // 접근 자체가 막힌 환경 (사파리 프라이빗 등)
  }
}

export function loadOptions(storage: StorageLike | null = defaultStorage()): GameOptions {
  if (!storage) return defaultOptions();
  try {
    const s = storage.getItem(OPTIONS_KEY);
    if (s) return sanitizeOptions(JSON.parse(s));
    // 이전 낱개 키 이전
    const o = defaultOptions();
    if (storage.getItem(LEGACY_COLORBLIND) === '1') o.colorblind = true;
    if (storage.getItem(LEGACY_DIRECTIONS) === '0') o.directions = 'off';
    return o;
  } catch {
    return defaultOptions();
  }
}

/** 저장 성공 여부 (실패해도 이번 세션 값은 그대로 쓴다) */
export function saveOptions(o: GameOptions, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(OPTIONS_KEY, JSON.stringify(o));
    return true;
  } catch {
    return false;
  }
}

/** V 키: 모두 → 내 깃발만 → 숨기기 → 모두 */
export function nextDirectionMode(m: DirectionMode): DirectionMode {
  return m === 'all' ? 'mine' : m === 'mine' ? 'off' : 'all';
}
