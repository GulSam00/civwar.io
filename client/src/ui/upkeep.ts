/**
 * 깃발 유지비 표시 (하단 바 — 사용자 요청 2026-10-10). 표시 전용, 서버 값이 권위.
 *
 * 프로토콜(02_backend_protocol §8): 서버는 플레이어별 `upkeepPm`(총 골드 수입에서 빠지는 몫, ‰)만 보낸다.
 *   유지비 골드/초 = 총수입 − 순수입 (goldPerSecond 가 upkeepPm 으로 계산) → 서버 값만으로 정확.
 *
 * "다음 깃발이 더할 유지비" 미리보기는 서버 식을 클라이언트에서 다시 계산해야 한다:
 *   drainPm(w) = min(MAX, floor(max(0, w − FREE) × RATE / 1000)),  w = Σ UNIT_GARRISON_PERMILLE[unit]
 * 백엔드가 유지비 대상 집합을 바꾸는 중이다(종전: 주둔 = ENGAGED·내 땅 앵커·방어 → 변경: 패주 제외 모든 깃발).
 * 그래서 두 규칙으로 각각 계산해 **서버 upkeepPm 과 맞는 규칙만** 쓴다. 어느 쪽도 안 맞으면(식이 바뀜) 미리보기를 숨긴다.
 */
import {
  GARRISON_UPKEEP_FREE_PERMILLE,
  GARRISON_UPKEEP_MAX_PERMILLE,
  GARRISON_UPKEEP_PERMILLE,
  POSTURE,
  UNIT_GARRISON_PERMILLE,
  type FlagSnapshot,
  type Unit,
} from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';

type Consts = Record<string, unknown> | undefined;
const num = (c: Consts, k: string, d: number) => (c?.[k] as number | undefined) ?? d;

export function drainPm(weight: number, c?: Consts): number {
  const free = num(c, 'GARRISON_UPKEEP_FREE_PERMILLE', GARRISON_UPKEEP_FREE_PERMILLE);
  const rate = num(c, 'GARRISON_UPKEEP_PERMILLE', GARRISON_UPKEEP_PERMILLE);
  const max = num(c, 'GARRISON_UPKEEP_MAX_PERMILLE', GARRISON_UPKEEP_MAX_PERMILLE);
  return Math.min(max, Math.floor((Math.max(0, weight - free) * rate) / 1000));
}

export type UpkeepRule = 'all' | 'garrison';

const isGarrison = (m: GameModel, f: FlagSnapshot) => f.state === 'ENGAGED' && f.posture === POSTURE.DEFEND && m.owners[f.anchorTileId] === f.ownerId;
const isBillableAll = (f: FlagSnapshot) => !f.routed;

export function upkeepWeight(m: GameModel, playerId: number, rule: UpkeepRule): number {
  const w = (m.config.constants?.UNIT_GARRISON_PERMILLE as readonly number[] | undefined) ?? UNIT_GARRISON_PERMILLE;
  let s = 0;
  for (const f of m.flagsOf(playerId)) if (rule === 'all' ? isBillableAll(f) : isGarrison(m, f)) s += w[f.unit];
  return s;
}

/**
 * 서버 upkeepPm 과 하나만 맞는 규칙. 둘 다 맞거나(예: 깃발 없음 — 구분 불가) 하나도 안 맞으면 null.
 * 호출 쪽은 마지막으로 판별된 규칙을 기억해 쓴다(playerDeltas 는 5 tick 마다라 깃발 변화 직후 잠깐 어긋날 수 있다).
 */
export function detectRule(m: GameModel, playerId: number, serverPm: number): UpkeepRule | null {
  const c = m.config.constants;
  const all = drainPm(upkeepWeight(m, playerId, 'all'), c) === serverPm;
  const gar = drainPm(upkeepWeight(m, playerId, 'garrison'), c) === serverPm;
  if (all && !gar) return 'all';
  if (gar && !all) return 'garrison';
  return null;
}

/** 깃발 하나(unit)를 더 보냈을 때 늘어날 유지비 ‰ — 'all' 규칙에서만 출전 즉시 과금되므로 그때만 값, 아니면 null */
export function nextFlagExtraPm(m: GameModel, playerId: number, rule: UpkeepRule | null, unit: Unit): number | null {
  if (rule !== 'all') return null;
  const c = m.config.constants;
  const w = (c?.UNIT_GARRISON_PERMILLE as readonly number[] | undefined) ?? UNIT_GARRISON_PERMILLE;
  const cur = upkeepWeight(m, playerId, 'all');
  return drainPm(cur + w[unit], c) - drainPm(cur, c);
}
