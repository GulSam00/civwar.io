/**
 * 커서 예고 (GDD 4.3 UX 표, v4.2 4.4a) — 깃발 발령/재지정 전 "기본 태세와 결과"를 보여준다.
 * 서버 검증을 대신하지 않는다: 표시 전용. 실제 수락/거절은 cmd_ack 로만 판단한다.
 *
 *  적/중립 타일 → 공격 태세 (붉은 진격 경로 + 쟁기 회랑 — route.ts. v4.2 에서 공격 원 폐기, disk 는 비어 있음)
 *  내 타일      → 푸른 보호 원(guard, 반경 FRONT_RADIUS), 방어 태세 · 보호 n타일
 *  동맹 / 물 / 사거리 밖 → 회색(불가)
 */
import { FRONT_MAX_RANGE, FRONT_RADIUS, POSTURE, type Posture } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import type { TopologyView } from '../render/topology.js';

export type PreviewKind = 'attack' | 'defend' | 'blocked';

export interface CursorPreview {
  kind: PreviewKind;
  tile: number;
  posture: Posture | null;
  /** 방어 보호 원(guard) 타일 — FRONT_RADIUS. 공격·불가는 [] (v4.2: 공격 원 폐기) */
  disk: number[];
  /** 공격: 0 (회랑 칸 수는 route.ts) / 방어: 보호 타일 수 */
  count: number;
  label: string;
}

/** 내 영토 거리장 캐시 (owners 가 바뀔 때만 다시 계산) */
export class RangeCache {
  private key = '';
  private field: Int32Array | null = null;
  get(model: GameModel, topo: TopologyView, me: number): Int32Array {
    const key = `${me}:${model.ownersVersion}:${model.tick}`;
    if (this.field && this.key === key) return this.field;
    this.field = topo.distanceField((t) => model.owners[t] === me);
    this.key = key;
    return this.field;
  }
}

export function computePreview(model: GameModel, topo: TopologyView, me: number, tile: number, rangeField: Int32Array | null): CursorPreview | null {
  if (tile < 0 || !model.terrain) return null;
  const radius = (model.config.constants?.FRONT_RADIUS as number | undefined) ?? FRONT_RADIUS;
  const maxRange = (model.config.constants?.FRONT_MAX_RANGE as number | undefined) ?? FRONT_MAX_RANGE;
  const owner = model.owners[tile];
  if (!model.isLand(tile)) return { kind: 'blocked', tile, posture: null, disk: [], count: 0, label: '물 — 앵커로 지정할 수 없음' };
  if (owner === me) {
    const disk = topo.disk(tile, radius);
    let n = 0;
    for (const t of disk) if (model.owners[t] === me) n++;
    return { kind: 'defend', tile, posture: POSTURE.DEFEND, disk, count: n, label: `방어 태세 · 여기로 이동해 지킴 · 보호 ${n}타일` };
  }
  if (model.isAlly(me, owner)) return { kind: 'blocked', tile, posture: null, disk: [], count: 0, label: '동맹 영토' };
  if (rangeField) {
    const d = rangeField[tile];
    if (d < 0 || d > maxRange) return { kind: 'blocked', tile, posture: null, disk: [], count: 0, label: `사거리 밖 (내 영토에서 ${maxRange}칸 초과)` };
  }
  const who = owner === 0 ? '중립' : '적';
  return { kind: 'attack', tile, posture: POSTURE.ATTACK, disk: [], count: 0, label: `공격 태세 · ${who} 땅까지 진격 · 경로 옆 모든 적·중립 칸을 공격` };
}

/**
 * 발령 병력 = 풀 × 비율 을 병종 변환비로 나눈 값 (풀 차감 = ceil(troops × UNIT_CONVERT / MOB_CONVERT), §4).
 * 비율은 "풀에서 빠져나갈 몫". 결과가 풀을 넘지 않게 floor.
 */
export function troopsForRatio(pool: number, ratio: number, unitConvertPm: number, mobConvertPm: number): number {
  const budget = Math.floor(pool * ratio);
  return Math.max(0, Math.floor((budget * mobConvertPm) / unitConvertPm));
}
