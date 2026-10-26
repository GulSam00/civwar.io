/**
 * 깃발 위치 보간 — 서버는 tile-discrete 위치(posTileId)만 보낸다 (flagMoves).
 * GDD 미결정 9번 결정: **단조 이징 보간, 스냅 금지**.
 *
 *  - 새 칸이 오면 "지금 화면에 그려진 위치"에서 새 칸 중심으로 이동을 시작한다 (튀지 않는다).
 *  - 구간 시간 = 같은 깃발의 직전 칸 변경 간격 추정(EMA) — 행군 속도에 맞춰 다음 칸 도착 즈음 끝난다.
 *  - 이징 = easeOutQuad (0→1 단조 증가) → 위치가 목표를 지나치거나 되돌아가지 않는다.
 *  - 처음 보는 깃발은 그 자리에서 나타난다 (등장은 스냅이 아니다).
 */
export interface Pt {
  x: number;
  y: number;
}

interface Track {
  tile: number;
  from: Pt;
  to: Pt;
  start: number;
  dur: number;
  lastChange: number;
  /** 칸 변경 간격 추정 (ms) */
  interval: number;
}

export const INTERP_DEFAULT_MS = 600;
export const INTERP_MIN_MS = 150;
export const INTERP_MAX_MS = 2500;

export function easeOutQuad(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * (2 - c);
}

export class FlagInterpolator {
  private tracks = new Map<number, Track>();

  /** 렌더 프레임마다 깃발의 현재 posTileId 를 알려준다. 반환 = 그릴 위치 */
  update(flagId: number, tile: number, center: Pt, now: number): Pt {
    let tr = this.tracks.get(flagId);
    if (!tr) {
      tr = { tile, from: center, to: center, start: now, dur: 0, lastChange: now, interval: INTERP_DEFAULT_MS };
      this.tracks.set(flagId, tr);
      return { ...center };
    }
    if (tr.tile !== tile) {
      const cur = this.positionOf(tr, now);
      const gap = now - tr.lastChange;
      // 첫 변경 간격은 기본값과 섞는다. 너무 긴 정지(교전 후 재출발 등)는 상한으로
      tr.interval = clamp(tr.interval * 0.5 + clamp(gap, INTERP_MIN_MS, INTERP_MAX_MS) * 0.5, INTERP_MIN_MS, INTERP_MAX_MS);
      tr.tile = tile;
      tr.from = cur;
      tr.to = center;
      tr.start = now;
      tr.dur = tr.interval;
      tr.lastChange = now;
    }
    return this.positionOf(tr, now);
  }

  private positionOf(tr: Track, now: number): Pt {
    if (tr.dur <= 0) return { ...tr.to };
    const k = easeOutQuad((now - tr.start) / tr.dur);
    return { x: tr.from.x + (tr.to.x - tr.from.x) * k, y: tr.from.y + (tr.to.y - tr.from.y) * k };
  }

  /** 사라진 깃발 정리 */
  retain(alive: (flagId: number) => boolean): void {
    for (const id of this.tracks.keys()) if (!alive(id)) this.tracks.delete(id);
  }

  clear(): void {
    this.tracks.clear();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
