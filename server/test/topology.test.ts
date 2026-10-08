import { describe, expect, it } from 'vitest';
import { TERRAIN } from '@civwar/shared';
import { SquareTopology, TerrainGraph } from '../src/topology/square.js';

describe('SquareTopology', () => {
  const topo = new SquareTopology(5, 4);
  it('tileCount / distance', () => {
    expect(topo.tileCount()).toBe(20);
    expect(topo.distance(0, 19)).toBe(4 + 3);
    expect(topo.distance(7, 7)).toBe(0);
  });
  it('adjacent 는 대칭이고 오름차순', () => {
    for (let t = 0; t < 20; t++) {
      const a = topo.adjacent(t);
      expect([...a]).toEqual([...a].sort((x, y) => x - y));
      for (const x of a) expect(topo.adjacent(x)).toContain(t);
    }
    expect(topo.adjacent(0)).toEqual([1, 5]);
    expect(topo.adjacent(6)).toEqual([1, 5, 7, 11]);
  });
  it('TerrainGraph.neighbors 는 DEEP 을 제외 (얕은 물은 포함)', () => {
    const terrain = new Uint8Array(20).fill(TERRAIN.PLAIN);
    terrain[1] = TERRAIN.DEEP;
    terrain[5] = TERRAIN.SHALLOW;
    const g = new TerrainGraph(topo, terrain);
    expect(g.neighbors(0)).toEqual([5]);
    expect(g.neighbors(1)).toEqual([]);
  });
});
