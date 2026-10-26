/**
 * 색각 보조 패턴 — 플레이어마다 다른 무늬(빗금 방향·간격·점·격자)를 영토 위에 얇게 겹친다.
 * 색만으로 구분하지 않도록 하는 보조 신호 (design-decisions 「비주얼 기획 제약」 4).
 */
const cache = new Map<number, CanvasPattern | null>();

type Draw = (g: CanvasRenderingContext2D, s: number) => void;
const line = (x0: number, y0: number, x1: number, y1: number): Draw => (g) => {
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
};
// 12종: 플레이어 1..12
const SPECS: { size: number; draw: Draw[]; dots?: boolean }[] = [
  { size: 8, draw: [] }, // 0 미사용
  { size: 8, draw: [line(0, 8, 8, 0)] }, // 1 /
  { size: 8, draw: [line(0, 0, 8, 8)] }, // 2 \
  { size: 8, draw: [line(4, 0, 4, 8)] }, // 3 |
  { size: 8, draw: [line(0, 4, 8, 4)] }, // 4 -
  { size: 10, draw: [line(0, 10, 10, 0), line(0, 0, 10, 10)] }, // 5 x
  { size: 10, draw: [line(5, 0, 5, 10), line(0, 5, 10, 5)] }, // 6 +
  { size: 8, draw: [], dots: true }, // 7 점
  { size: 14, draw: [line(0, 14, 14, 0)] }, // 8 성긴 /
  { size: 14, draw: [line(0, 0, 14, 14)] }, // 9 성긴 \
  { size: 14, draw: [line(7, 0, 7, 14), line(0, 7, 14, 7)] }, // 10 성긴 +
  { size: 12, draw: [line(0, 6, 12, 6), line(0, 0, 12, 0)] }, // 11 촘촘 -
  { size: 12, draw: [], dots: true }, // 12 성긴 점
];

export function ownerPattern(ctx: CanvasRenderingContext2D, owner: number): CanvasPattern | null {
  if (cache.has(owner)) return cache.get(owner)!;
  const spec = SPECS[owner];
  if (!spec || (!spec.draw.length && !spec.dots) || typeof document === 'undefined') {
    cache.set(owner, null);
    return null;
  }
  const c = document.createElement('canvas');
  c.width = spec.size;
  c.height = spec.size;
  const g = c.getContext('2d')!;
  // 밝은 색(노랑·흰색) 위에서도 보이도록 어두운 선
  g.strokeStyle = owner === 12 || owner === 3 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.35)';
  g.fillStyle = g.strokeStyle;
  g.lineWidth = 1.2;
  if (spec.dots) {
    g.beginPath();
    g.arc(spec.size / 2, spec.size / 2, 1.4, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    for (const d of spec.draw) d(g, spec.size);
    g.stroke();
  }
  const pat = ctx.createPattern(c, 'repeat');
  cache.set(owner, pat);
  return pat;
}
