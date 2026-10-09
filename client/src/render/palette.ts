/**
 * 색 팔레트 — 깔끔한 플랫 (design-decisions 「화면/UX·비주얼 기획 1차」).
 * 지형은 채도 낮은 단색, 플레이어 색은 채도 높은 12색 — 지형과 겹치지 않고 서로 구분되게.
 * 소유 타일 = 플레이어 색 85% + 지형 15% (지형이 은은하게 비친다).
 */

/** 지형 7종 (TERRAIN 인덱스): DEEP PLAIN FERTILE HILLS DESERT MOUNTAIN SHALLOW */
export const TERRAIN_RGB: readonly (readonly [number, number, number])[] = [
  [28, 44, 66], // DEEP — 짙은 남색
  [214, 220, 196], // PLAIN — 옅은 회녹
  [180, 206, 160], // FERTILE — 연녹
  [196, 184, 158], // HILLS — 회갈
  [234, 222, 186], // DESERT — 모래
  [140, 136, 132], // MOUNTAIN — 회색
  [64, 98, 132], // SHALLOW — 탁한 청
];

/** 플레이어 1..12. 0(중립)은 쓰지 않는다 */
export const PLAYER_HEX = [
  '#888888', // 0 (미사용)
  '#e53935', // 1 빨강
  '#1e6fe0', // 2 파랑
  '#f4c20d', // 3 노랑
  '#8e24aa', // 4 보라
  '#fb8c00', // 5 주황
  '#00a39f', // 6 청록
  '#ec407a', // 7 분홍
  '#2e7d32', // 8 진녹
  '#3f2b96', // 9 남보라
  '#7b1f1f', // 10 적갈
  '#2b3a42', // 11 먹색
  '#f2f2f2', // 12 흰색
] as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export const PLAYER_RGB = PLAYER_HEX.map(hexToRgb);

export function playerColor(id: number): string {
  return PLAYER_HEX[id] ?? '#888888';
}

/** 테두리·텍스트 외곽용 어두운 변형 */
export function playerDark(id: number): string {
  const [r, g, b] = PLAYER_RGB[id] ?? [136, 136, 136];
  const k = id === 12 ? 0.55 : 0.6;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

/** 타일 색 (0xRRGGBBAA) */
export function tileRgba(terrain: number, owner: number): number {
  const t = TERRAIN_RGB[terrain] ?? TERRAIN_RGB[1];
  if (owner === 0) return pack(t[0], t[1], t[2]);
  const p = PLAYER_RGB[owner] ?? PLAYER_RGB[0];
  // 산·언덕은 조금 어둡게 비치도록 지형 명도를 섞는다
  const mix = 0.15;
  return pack(p[0] * (1 - mix) + t[0] * mix, p[1] * (1 - mix) + t[1] * mix, p[2] * (1 - mix) + t[2] * mix);
}

function pack(r: number, g: number, b: number): number {
  return ((Math.round(r) << 24) | (Math.round(g) << 16) | (Math.round(b) << 8) | 0xff) >>> 0;
}

export const COLOR_ATTACK = '#ff3b30';
export const COLOR_DEFEND = '#2f80ed';
export const COLOR_DISABLED = '#9e9e9e';
