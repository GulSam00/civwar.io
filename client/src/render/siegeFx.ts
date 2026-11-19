/**
 * 공성 시각 효과 (2026-11-10 사용자 채택: 피격 흔들림 · B 포위 고리 · C 함락 파동).
 * 서버 값만 본다 — 기지 체력(hpPct)이 줄면 피격, 주인이 바뀌면 함락. 그리기는 renderer.drawBases 가 한다.
 */

/** 피격 흔들림 길이 (ms) */
export const SHAKE_MS = 320;
/** 흔들림 최대 폭 (px) */
export const SHAKE_PX = 2.5;
/** 마지막 피격 뒤 이 시간 동안은 포위 중으로 본다 (ms) — 체력 델타가 tick 마다 오지 않아도 고리가 깜빡이지 않게 */
export const SIEGE_HOLD_MS = 1500;
/** 함락 파동 길이 (ms) */
export const WAVE_MS = 1000;

interface BaseFxState {
  hp: number;
  owner: number;
  hitAt: number;
  capturedAt: number;
}

export class SiegeTracker {
  private s = new Map<number, BaseFxState>();

  /** 매 프레임 기지마다 부른다. 처음 본 기지는 효과 없이 기록만 한다 */
  observe(tile: number, hpPct: number, ownerId: number, now: number): BaseFxState {
    let st = this.s.get(tile);
    if (!st) {
      st = { hp: hpPct, owner: ownerId, hitAt: -1e9, capturedAt: -1e9 };
      this.s.set(tile, st);
      return st;
    }
    if (ownerId !== st.owner) {
      st.owner = ownerId;
      st.capturedAt = now;
      st.hitAt = -1e9; // 함락 = 공성 끝
    } else if (hpPct < st.hp) st.hitAt = now;
    st.hp = hpPct;
    return st;
  }

  get(tile: number): BaseFxState | undefined {
    return this.s.get(tile);
  }
}

/** 피격 흔들림 화면 오프셋 — 맞은 직후 가장 크고 SHAKE_MS 동안 줄어든다 (난수 없이 사인파) */
export function shakeOffset(now: number, hitAt: number): { dx: number; dy: number } {
  const t = now - hitAt;
  if (t < 0 || t >= SHAKE_MS) return { dx: 0, dy: 0 };
  const k = 1 - t / SHAKE_MS;
  return { dx: Math.sin(t * 0.09) * SHAKE_PX * k, dy: Math.cos(t * 0.13) * SHAKE_PX * 0.6 * k };
}

/** 포위 중인가 — 마지막 피격이 SIEGE_HOLD_MS 안이거나 공격 깃발이 지금 이 기지를 밀고 있다 */
export function underSiege(now: number, hitAt: number, attackerEngaged: boolean): boolean {
  return attackerEngaged || now - hitAt < SIEGE_HOLD_MS;
}

/** 함락 파동 진행 0..1 (끝났으면 null) */
export function waveProgress(now: number, capturedAt: number): number | null {
  const t = now - capturedAt;
  if (t < 0 || t >= WAVE_MS) return null;
  return t / WAVE_MS;
}

/** 체력 고리 채움 각도 (라디안, 12시부터 시계 방향) */
export function ringSweep(hpPct: number): number {
  return (Math.max(0, Math.min(100, hpPct)) / 100) * Math.PI * 2;
}
