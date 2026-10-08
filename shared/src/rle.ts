/**
 * RLE 인코딩 — uint8 배열을 [value, runLength, value, runLength, ...] 평탄 배열로.
 * 프로토콜: map_init.terrain, snapshot_full.owners.
 */
export function rleEncode(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    const v = data[i];
    let j = i + 1;
    while (j < n && data[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

export function rleDecode(rle: readonly number[], length?: number): Uint8Array {
  let total = 0;
  for (let i = 1; i < rle.length; i += 2) total += rle[i];
  if (length !== undefined && length !== total) {
    throw new Error(`RLE length mismatch: expected ${length}, got ${total}`);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    out.fill(rle[i], p, p + rle[i + 1]);
    p += rle[i + 1];
  }
  return out;
}
