/** 교전 시각화: 교전 쌍 추출 (§20 8방향 접촉 — 대각선 포함), 아이콘 종류, 겹침 제거 */
import { describe, expect, it } from 'vitest';
import { combatPairs, declutter, pairGlyphKind, type CombatFlagLike } from '../src/render/combatPairs.js';
import { SquareTopologyView } from '../src/render/topology.js';

const W = 10;
const topo = new SquareTopologyView(W, 10);
const at = (r: number, c: number) => r * W + c;
const touching = (a: number, b: number) => topo.touching(a, b);
const noAlly = () => false;
const flag = (id: number, ownerId: number, tile: number, posture: 0 | 1, inCombat = true): CombatFlagLike => ({ id, ownerId, posTileId: tile, posture, inCombat, state: 'ENGAGED', routed: false, troops: 100, breakaway: false });

describe('touching = 체비셰프 1', () => {
  it('같은 칸·상하좌우·대각선 = 접촉, 2칸 = 아님, 행 경계 넘김 없음', () => {
    expect(topo.touching(at(5, 5), at(5, 5))).toBe(true);
    expect(topo.touching(at(5, 5), at(4, 5))).toBe(true);
    expect(topo.touching(at(5, 5), at(6, 6))).toBe(true);
    expect(topo.touching(at(5, 5), at(4, 4))).toBe(true);
    expect(topo.touching(at(5, 5), at(5, 7))).toBe(false);
    expect(topo.touching(at(5, 5), at(7, 6))).toBe(false);
    expect(topo.touching(at(3, 9), at(4, 0))).toBe(false); // 줄 끝 → 다음 줄 처음 (id 차 1 이지만 멀다)
  });
});

describe('combatPairs — 서버 전투 간선 규칙 (combat.ts engagedPair)', () => {
  it('둘 다 방어 태세면 간선 없음 (한쪽이 공격 태세여야)', () => {
    expect(combatPairs([flag(1, 1, at(5, 5), 1), flag(2, 2, at(5, 6), 1)], touching, noAlly)).toEqual([]);
  });
  it('귀환 중인 공격 깃발은 공격 쪽이 아니다 — 적 방어 깃발과 선 없음, 상대가 공격이면 선 있음', () => {
    const ret = { ...flag(1, 1, at(5, 5), 0), state: 'RETURNING' };
    expect(combatPairs([ret, flag(2, 2, at(5, 6), 1)], touching, noAlly)).toEqual([]);
    expect(combatPairs([ret, flag(2, 2, at(5, 6), 0)], touching, noAlly)).toHaveLength(1);
  });
  it('패주(routed)·병력 0·분리(breakaway) 깃발은 제외 (combatEligible)', () => {
    const base = flag(1, 1, at(5, 5), 0);
    for (const bad of [{ routed: true }, { troops: 0 }, { breakaway: true }]) {
      expect(combatPairs([{ ...base, ...bad }, flag(2, 2, at(5, 6), 0)], touching, noAlly)).toEqual([]);
    }
  });
});

describe('combatPairs', () => {
  it('대각선 쌍도 잡는다', () => {
    const pairs = combatPairs([flag(2, 1, at(5, 5), 0), flag(1, 2, at(6, 6), 1)], touching, noAlly);
    expect(pairs).toEqual([{ a: 1, b: 2, aAttack: false, bAttack: true }]);
  });
  it('inCombat 아닌 깃발·같은 주인·동맹·떨어진 깃발은 제외', () => {
    const fl = [flag(1, 1, at(5, 5), 0), flag(2, 1, at(5, 6), 0), flag(3, 3, at(5, 4), 0, false), flag(4, 4, at(4, 4), 1), flag(5, 2, at(8, 8), 0)];
    const ally = (a: number, b: number) => (a === 1 && b === 4) || (a === 4 && b === 1);
    expect(combatPairs(fl, touching, ally)).toEqual([]);
    expect(combatPairs(fl, touching, noAlly)).toEqual([{ a: 1, b: 4, aAttack: true, bAttack: false }]);
  });
  it('여럿이 싸우면 쌍 여러 개 (2 대 1 — 대각선 + 가로)', () => {
    const fl = [flag(1, 1, at(5, 5), 0), flag(2, 1, at(4, 4), 1), flag(3, 2, at(4, 5), 0)];
    expect(combatPairs(fl, touching, noAlly).map((p) => `${p.a}-${p.b}`)).toEqual(['1-3', '2-3']);
  });
  it('같은 칸 교전', () => {
    expect(combatPairs([flag(1, 1, at(2, 2), 0), flag(2, 2, at(2, 2), 0)], touching, noAlly)).toHaveLength(1);
  });
});

describe('아이콘 종류 · 겹침 제거', () => {
  it('둘 다 공격 = 검 둘, 둘 다 방어 = 방패, 섞이면 검+방패', () => {
    expect(pairGlyphKind({ aAttack: true, bAttack: true })).toBe('swords');
    expect(pairGlyphKind({ aAttack: false, bAttack: false })).toBe('shields');
    expect(pairGlyphKind({ aAttack: true, bAttack: false })).toBe('mixed');
  });
  it('가까운 자리는 먼저 놓인 것만 남긴다', () => {
    expect(declutter([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 30, y: 0 }], 16)).toEqual([0, 2]);
  });
});
