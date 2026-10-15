/**
 * 토폴로지 추상화 (design-decisions 「구현 제약」, GDD 2.2).
 *
 * 게임 로직(전투·깃발·봇·점유율)은 이 인터페이스만 호출한다.
 * `row*width+col`, 맨해튼 거리, `id ± 1 / id ± width` 는 사각 구현체(square.ts) 안에만 존재한다.
 */
export interface Topology {
  readonly kind: 'square';
  tileCount(): number;
  /** 두 타일 사이 격자 거리 (통행 무시). 사각 = 맨해튼 */
  distance(a: number, b: number): number;
  /** 인접 타일 전체 (지형 무시). 고정 순서 → 결정론. 경로 계층·맵 생성기 내부 전용 */
  adjacent(t: number): readonly number[];
  /** 맵 외곽 테두리 타일인가 */
  isBorder(t: number): boolean;
  /** distance(center, t) <= r 인 모든 타일 (지형 무시), tileId 오름차순 */
  disk(center: number, r: number): readonly number[];
  /**
   * 사용자 결정 2026-10-11: 깃발 "접촉"(깃발 대 깃발 전투·ZOC·진척 유지·봇 전투 판단) 이웃 — 자기 자신 제외, tileId 오름차순.
   * 사각 = 8방향(체비셰프 거리 1, 대각선 포함), 육각이면 일반 이웃. 지형 무시.
   * 땅 점령(marchFront)·guard·이동 경로는 이것을 쓰지 않는다 — adjacent()/neighbors() (사각 4방향) 그대로.
   */
  contactNeighbors(t: number): readonly number[];
  /** a, b 가 접촉하는가 (a === b 포함) = a === b ∨ b ∈ contactNeighbors(a) */
  touching(a: number, b: number): boolean;
}

/**
 * 지형이 입혀진 이동 그래프 — 경로 계층.
 * neighbors() 는 isPassable 인 인접 타일만 돌려준다 (v4.5: 물(DEEP·SHALLOW)은 그래프에 존재하지 않는다).
 */
export interface MapGraph {
  readonly topology: Topology;
  tileCount(): number;
  distance(a: number, b: number): number;
  neighbors(t: number): readonly number[];
  /** distance(center, t) <= r 인 모든 타일 (지형 무시, 캐시), tileId 오름차순 */
  disk(center: number, r: number): readonly number[];
  /** Topology.contactNeighbors (깃발 접촉 — 사각 8방향). 지형 무시 */
  contactNeighbors(t: number): readonly number[];
  /** Topology.touching */
  touching(a: number, b: number): boolean;
}
