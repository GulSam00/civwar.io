/**
 * mulberry32 — 맵 생성 유일 PRNG (GDD 2.4). Math.random 금지.
 * 확률 비교는 정수로: chance(permille) ⇔ u32 < floor(permille × 2^32 / 1000).
 */
export class Mulberry32 {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** rng() < permille/1000 의 정수판 */
  chance(permille: number): boolean {
    return this.nextU32() < Math.floor((permille * 4294967296) / 1000);
  }
}

/**
 * 타일 동률 깨기용 정수 해시 (§32) — rng 를 쓰지 않는 순수 함수. 동률을 "tileId 가장 작은 칸" 으로 풀면 늘 위·왼쪽이 먼저 뽑혀
 * 방향 편향(위쪽 스폰이 약해짐)이 생기므로, 의미 없는 대신 방향성도 없는 순서로 푼다. 부동소수·Math.random 없음.
 */
export function tileTieHash(salt: number, t: number): number {
  let h = (salt ^ Math.imul(t + 0x9e3779b1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
