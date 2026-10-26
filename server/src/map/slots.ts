/**
 * 스폰 슬롯 배정 (§32) — 플레이어(playerId) ↔ 맵 스폰 슬롯(map.spawns 인덱스) 분리.
 *
 * 맵 생성기는 슬롯 i 의 스폰에 playerId = i+1 을 붙여 둔다(슬롯 번호에는 의미가 없다).
 * 룸은 매치 시작 때 시드 기반 순열을 만들어 playerId p 가 슬롯 slotOf[p-1] 의 위치를 받게 한다.
 * `relabelSpawns` 는 그 순열대로 spawns 를 다시 늘어놓고 initialOwners 의 소유자 번호를 바꾼 맵을 돌려준다.
 * 결과 맵에서도 spawns[p-1].playerId === p 불변식이 유지되므로 프로토콜(map_init.spawns[].playerId)은 그대로다.
 */
import type { GeneratedMap, SpawnPlacement } from './generate.js';
import { Mulberry32 } from './rng.js';

/** Fisher-Yates 로 0..n-1 순열 — mulberry32(seed ^ 상수) 만 사용 (결정론, Math.random 없음) */
export function shuffledSlots(seed: number, n: number): number[] {
  const rng = new Mulberry32((seed ^ 0x5107a551) >>> 0);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function isPermutation(a: readonly number[], n: number): boolean {
  if (a.length !== n) return false;
  const seen = new Set<number>();
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/** slotOf[p-1] = 원래 맵의 스폰 인덱스. 항등 순열이면 같은 객체를 돌려준다 */
export function relabelSpawns(map: GeneratedMap, slotOf: readonly number[]): GeneratedMap {
  const N = map.spawns.length;
  if (!isPermutation(slotOf, N)) throw new Error(`relabelSpawns: slotOf 가 0..${N - 1} 의 순열이 아님`);
  if (slotOf.every((s, i) => s === i)) return map;
  const spawns: SpawnPlacement[] = slotOf.map((s, i) => ({ playerId: i + 1, tileId: map.spawns[s].tileId, homeTileId: map.spawns[s].homeTileId }));
  // 옛 소유자 번호(slot+1) → 새 playerId
  const remap = new Uint8Array(N + 1);
  slotOf.forEach((s, i) => (remap[s + 1] = i + 1));
  const initialOwners = new Uint8Array(map.initialOwners.length);
  for (let t = 0; t < initialOwners.length; t++) initialOwners[t] = remap[map.initialOwners[t]];
  return { ...map, spawns, initialOwners };
}
