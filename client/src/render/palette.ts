/**
 * 색 팔레트 — 깔끔한 플랫 (design-decisions 「화면/UX·비주얼 기획 1차」).
 * 지형은 채도 낮은 단색, 플레이어 색은 채도 높은 12색 — 지형과 겹치지 않고 서로 구분되게.
 * 소유 타일 = 플레이어 색 OWNER_FILL_ALPHA(42%) 를 지형 위에 반투명으로 겹친다 — 지형 색이 구분되게 (사용자 요청 2026-10-10).
 * 소유 구분은 경계선 + 영토 안쪽 테두리 띠(renderer drawOwnerBands)가 맡는다.
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

/** 영토 채우기 불투명도 (0.35~0.45 권장 범위) */
export const OWNER_FILL_ALPHA = 0.42;

/** 타일 색 (0xRRGGBBAA) */
export function tileRgba(terrain: number, owner: number): number {
  const t = TERRAIN_RGB[terrain] ?? TERRAIN_RGB[1];
  if (owner === 0) return pack(t[0], t[1], t[2]);
  const p = PLAYER_RGB[owner] ?? PLAYER_RGB[0];
  // 반투명 겹치기 = 플레이어 색 a + 지형 (1 − a). 1 타일 = 1 픽셀 레이어라 미리 섞어 불투명으로 쓴다
  const a = OWNER_FILL_ALPHA;
  return pack(p[0] * a + t[0] * (1 - a), p[1] * a + t[1] * (1 - a), p[2] * a + t[2] * (1 - a));
}

function pack(r: number, g: number, b: number): number {
  return ((Math.round(r) << 24) | (Math.round(g) << 16) | (Math.round(b) << 8) | 0xff) >>> 0;
}

export const COLOR_ATTACK = '#ff3b30';
export const COLOR_DEFEND = '#2f80ed';
export const COLOR_DISABLED = '#9e9e9e';
