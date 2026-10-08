import { TERRAIN } from './constants.js';

/**
 * 게임 로직이 쓰는 유일한 지형 판정 (GDD 2.2). "육지" = owner 를 가질 수 있는 타일.
 * 통행 판정(isPassable)은 서버 토폴로지 계층 내부 전용이므로 여기 두지 않는다.
 */
export function isClaimable(terrain: number): boolean {
  return terrain !== TERRAIN.DEEP && terrain !== TERRAIN.SHALLOW;
}
