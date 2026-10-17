/**
 * 숫자 짧게 쓰기 (2026-10-18 UI 개선 — OpenFront.io 참고). 영토 라벨·병력 바·순위표·대상 바·정보 카드가 같이 쓴다.
 *   0..999        → "742"
 *   1,000..       → 유효숫자 3자리, 버림 — "2.55K", "17.5K", "175K", "1.23M"
 * 버림(반올림 아님)이라 "999.9K → 1000K" 같은 자리 넘침이 없고, 실제 값보다 커 보이지 않는다.
 */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  const a = Math.floor(Math.abs(n));
  let s: string;
  if (a < 1000) s = String(a);
  else {
    const units: [number, string][] = [
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    const [div, suf] = units.find(([d]) => a >= d)!;
    const v = a / div; // 1 ≤ v < 1000
    const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    const k = 10 ** dec;
    // 부동소수 오차(2.55 → 2.5499…)로 한 자리 덜 나오지 않게 아주 작은 값을 더하고 버린다
    const t = Math.floor(v * k + 1e-9) / k;
    const txt = t.toFixed(dec);
    s = `${dec > 0 ? txt.replace(/\.?0+$/, '') : txt}${suf}`;
  }
  return neg && s !== '0' ? `−${s}` : s;
}

/** 초당 값 (+520/s, +1.2K/s). 10 미만이면 소수 한 자리 */
export function fmtRate(perSec: number): string {
  const sign = perSec < 0 ? '−' : '+';
  const a = Math.abs(perSec);
  return `${sign}${a < 10 ? a.toFixed(1) : fmtCompact(a)}/초`;
}

/** 하단 병력 바 (2026-10-18 UI 개선 2): 채움 % = 현재 / 상한 (0..100), 글자 = 현재 · 초당 회복 · 상한 */
export function troopBarParts(troops: number, cap: number, ratePerSec: number | null): { fillPct: number; cur: string; cap: string; rate: string | null; full: boolean } {
  const fillPct = cap > 0 ? Math.max(0, Math.min(100, (troops * 100) / cap)) : 0;
  return { fillPct, cur: fmtCompact(troops), cap: fmtCompact(cap), rate: ratePerSec === null ? null : fmtRate(ratePerSec), full: cap > 0 && troops >= cap };
}

/** 비율 슬라이더 옆 "실제로 풀에서 빠질 병력" = floor(풀 × 비율) (발령 식 troopsForRatio 의 budget 과 같다) */
export function ratioBudget(pool: number, ratio: number): number {
  return Math.max(0, Math.floor(pool * ratio));
}
