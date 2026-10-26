/**
 * 카메라 — 월드(타일 단위) ↔ 화면(CSS 픽셀) 변환. 팬·줌.
 * 클릭 좌표 → 타일 변환은 반드시 이 변환을 거친다 (카메라 오프셋·스케일 누락 버그 방지).
 */
export interface Camera {
  /** 화면 중앙에 오는 월드 좌표 */
  cx: number;
  cy: number;
  /** 타일 1칸 = zoom CSS 픽셀 */
  zoom: number;
  /** 뷰포트 크기 (CSS 픽셀) */
  viewW: number;
  viewH: number;
}

export const ZOOM_MIN = 4;
export const ZOOM_MAX = 64;

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.viewW / 2) / cam.zoom + cam.cx, y: (sy - cam.viewH / 2) / cam.zoom + cam.cy };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.cx) * cam.zoom + cam.viewW / 2, y: (wy - cam.cy) * cam.zoom + cam.viewH / 2 };
}

/** 화면 점 (sx, sy) 을 고정한 채 줌 */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
  const after = screenToWorld(cam, sx, sy);
  cam.cx += before.x - after.x;
  cam.cy += before.y - after.y;
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): void {
  cam.cx -= dxScreen / cam.zoom;
  cam.cy -= dyScreen / cam.zoom;
}

/** 월드 영역이 뷰포트 밖으로 너무 멀리 나가지 않게 */
export function clampCamera(cam: Camera, worldW: number, worldH: number): void {
  cam.cx = Math.min(worldW, Math.max(0, cam.cx));
  cam.cy = Math.min(worldH, Math.max(0, cam.cy));
}

/** 월드 전체가 들어오는 줌 */
export function fitZoom(viewW: number, viewH: number, worldW: number, worldH: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(viewW / worldW, viewH / worldH) * 0.95));
}
