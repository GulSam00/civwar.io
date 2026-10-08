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
