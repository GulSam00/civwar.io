/**
 * 깃발 전투 틱당 손실 "−n" 숫자 (사용자 요청 2026-10-15, 프로토콜 §22.3 델타 combatLoss).
 *
 * 매 tick 서버가 [flagId, lossMilli] 를 보낸다(> 0 인 깃발만). 그대로 tick 마다 숫자를 띄우면 교전이 많을 때 화면이 숫자로 덮이므로:
 *  - 깃발별 합산: 같은 깃발의 숫자가 아직 "젊으면"(AGG_MS 안) 새 손실을 거기에 더한다.
 *    → 평소엔 2 tick(0.4초)마다 새 숫자가 올라가고(0.2초마다 띄우면 한 깃발 위에 숫자가 기둥처럼 쌓인다 — 브라우저 확인),
 *      바쁠 때는 한 숫자에 더 많은 tick 이 합쳐진다. 깃발당 떠 있는 숫자는 최대 MAX_PER_FLAG 개(오래된 것부터 버림).
 *  - 스로틀: 동시에 교전 중인 깃발이 많으면 합산 창을 늘린다(busy → AGG_MS × 3).
 *  - 상한: 떠 있는 숫자 최대 MAX_LIVE 개 — 넘치면 우선순위(내 깃발·선택 > 손실 큰 것) 낮은 새 숫자는 버린다.
 * 위치는 그리는 쪽(renderer)이 깃발의 현재 화면 위치로 정한다 — 여기는 시간·값만 관리한다.
 */

export interface LossFloater {
  flagId: number;
  /** 누적 손실 (milli) */
  milli: number;
  /** 처음 뜬 시각 (ms) */
  born: number;
  /** 마지막으로 값이 더해진 시각 (ms) */
  updated: number;
  /** 같은 깃발에서 연달아 뜬 순번 */
  seq: number;
  /** 강조 (내 깃발·선택 깃발) */
  important: boolean;
}

export const FLOAT_LIFE_MS = 1000;
export const AGG_MS = 380;
export const MAX_PER_FLAG = 2;
export const BUSY_FLAGS = 12;
export const MAX_LIVE = 36;

export class LossFloaters {
  private live: LossFloater[] = [];
  private seqOf = new Map<number, number>();
  private lastTick = -1;

  /**
   * 한 tick 의 손실 적용. 같은 tick 을 두 번 넣으면 무시한다(렌더 프레임마다 불러도 된다).
   * important(id) = 내 깃발·선택 깃발이면 true.
   */
  ingest(tick: number, losses: readonly (readonly [number, number])[], now: number, important: (flagId: number) => boolean = () => false): void {
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    this.prune(now);
    if (!losses.length) return;
    const busy = losses.length > BUSY_FLAGS;
    const window = busy ? AGG_MS * 2.5 : AGG_MS;
    const fresh: LossFloater[] = [];
    for (const [flagId, milli] of losses) {
      if (!(milli > 0)) continue;
      // 같은 깃발의 젊은 숫자가 있으면 거기에 더한다 (합산)
      let cur: LossFloater | undefined;
      for (const f of this.live) if (f.flagId === flagId && now - f.born < window && (!cur || f.born > cur.born)) cur = f;
      if (cur) {
        cur.milli += milli;
        cur.updated = now;
        continue;
      }
      // 깃발당 상한 — 오래된 숫자부터 버린다
      const mine = this.live.filter((f) => f.flagId === flagId);
      if (mine.length >= MAX_PER_FLAG) {
        const drop = new Set(mine.sort((a, b) => a.born - b.born).slice(0, mine.length - MAX_PER_FLAG + 1));
        this.live = this.live.filter((f) => !drop.has(f));
      }
      const seq = (this.seqOf.get(flagId) ?? 0) + 1;
      this.seqOf.set(flagId, seq);
      fresh.push({ flagId, milli, born: now, updated: now, seq, important: important(flagId) });
    }
    if (!fresh.length) return;
    // 상한: 자리가 모자라면 중요한 것·손실 큰 것부터
    const room = MAX_LIVE - this.live.length;
    if (fresh.length > room) {
      fresh.sort((a, b) => Number(b.important) - Number(a.important) || b.milli - a.milli || a.flagId - b.flagId);
      fresh.length = Math.max(0, room);
    }
    this.live.push(...fresh);
  }

  /** 수명이 다한 숫자 제거 */
  prune(now: number): void {
    if (this.live.some((f) => now - f.born >= FLOAT_LIFE_MS)) this.live = this.live.filter((f) => now - f.born < FLOAT_LIFE_MS);
  }

  /** 지금 떠 있는 숫자 (오래된 것 먼저) */
  active(now: number): readonly LossFloater[] {
    this.prune(now);
    return this.live;
  }

  /** 사라진 깃발 정리 */
  retain(alive: (flagId: number) => boolean): void {
    this.live = this.live.filter((f) => alive(f.flagId));
    for (const id of [...this.seqOf.keys()]) if (!alive(id)) this.seqOf.delete(id);
  }

  clear(): void {
    this.live = [];
    this.seqOf.clear();
    this.lastTick = -1;
  }
}

/** 표시 문자열: 소수 1자리(서버 권장), 100 이상은 정수 — "−4.5", "−120" */
export function lossText(milli: number): string {
  const v = milli / 1000;
  return `−${v >= 100 ? Math.round(v) : v.toFixed(1)}`;
}

/** 나이(0..1) → 올라간 거리(px)·투명도. 처음 0.15 는 살짝 커지며 나타나고 마지막 40% 동안 사라진다 */
export function floatAnim(age: number, rise = 26): { dy: number; alpha: number; scale: number } {
  const k = Math.max(0, Math.min(1, age));
  const dy = -rise * (1 - (1 - k) * (1 - k)); // ease-out
  const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  const scale = k < 0.15 ? 0.85 + (k / 0.15) * 0.15 : 1;
  return { dy, alpha, scale };
}
