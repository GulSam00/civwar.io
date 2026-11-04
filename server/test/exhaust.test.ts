/**
 * v5.9 (이슈 20261104-0110, 사용자 결정): 공격 계열 깃발 소진 = "칸 하나를 더 못 살 때만". 방어 깃발은 40명 기준 그대로, 모델 1 은 구 규칙.
 */
import { describe, expect, it } from 'vitest';
import { FLAG_MIN_TROOPS, POSTURE, UNIT, isClaimable, type ServerMessage } from '@civwar/shared';
import { stage10_flagEnd } from '../src/game/gauge.js';
import type { Outbox } from '../src/game/outbox.js';
import { attackExhaustLineMilli, selectAttackTargetRO, tileCost } from '../src/game/rules.js';
import { NEUTRAL, createGameState, makeFlag, setTileOwner, type Flag, type GameState } from '../src/game/state.js';
import { generateMapForPlayers } from '../src/map/generate.js';

function makeState(model: 1 | 2): GameState {
  const map = generateMapForPlayers(4242, 8);
  const setup = Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true }));
  return createGameState(map, setup, undefined, undefined, model);
}

/** 수도 옆 땅 칸 하나를 플레이어 1 땅으로 만들고, 그 칸의 4방향 이웃에 중립 칸이 있는 위치를 돌려준다 */
function frontTile(s: GameState): number {
  for (let t = 0; t < s.owners.length; t++) {
    if (s.owners[t] !== NEUTRAL || !isClaimable(s.map.terrain[t]) || s.map.isBase[t]) continue;
    const nb = s.graph.neighbors(t);
    if (nb.some((x) => s.owners[x] === NEUTRAL && isClaimable(s.map.terrain[x]) && !s.map.isBase[x])) {
      setTileOwner(s, t, 1, false);
      return t;
    }
  }
  throw new Error('no front tile');
}

function addFlag(s: GameState, pos: number, troops: number, o: Partial<Flag>): Flag {
  const f = makeFlag({
    id: s.nextFlagId++,
    ownerId: 1,
    slotIndex: s.flags.filter((x) => x.ownerId === 1).length,
    unit: UNIT.SWORD,
    troopsMilli: troops,
    initialTroops: 100,
    posTileId: pos,
    anchorTileId: pos,
    originTileId: pos,
  });
  Object.assign(f, o);
  s.flags.push(f);
  return f;
}

function endOnce(s: GameState): ServerMessage[] {
  const out: Outbox = { broadcast: [], personal: [] } as unknown as Outbox;
  stage10_flagEnd(s, 1, out);
  return out.broadcast;
}

const exhausted = (msgs: ServerMessage[]) => msgs.some((m) => m.type === 'flag_ended' && m.reason === 'exhausted');

describe('v5.9 공격 깃발 소진 — 칸 하나를 더 못 살 때만', () => {
  it('모델 2: 40명 미만이어도 다음 칸 비용 이상 남으면 유지, 비용 미만이면 소진', () => {
    const s = makeState(2);
    const pos = frontTile(s);
    const f = addFlag(s, pos, 30_000, { posture: POSTURE.ATTACK, state: 'ENGAGED' });
    const X = selectAttackTargetRO(s, f)!;
    const c = tileCost(s, f, X);
    expect(c).toBeLessThan(30);
    expect(exhausted(endOnce(s))).toBe(false);
    expect(s.flags).toContain(f);

    // 남은 진척을 반영: 진척 600 이면 0.4칸 분량만 있으면 된다
    f.targetTileId = X;
    f.progressMilli = 600;
    expect(attackExhaustLineMilli(s, f)).toBe(400 * c);
    f.troopsMilli = Math.ceil((400 * c) / 1000) * 1000;
    expect(exhausted(endOnce(s))).toBe(false);

    // 쓸 수 있는 병력(명 단위 내림)이 남은 비용보다 적으면 소진 — 소수 병력은 버린다
    f.troopsMilli = Math.ceil((400 * c) / 1000) * 1000 - 1;
    expect(exhausted(endOnce(s))).toBe(true);
    expect(s.flags).not.toContain(f);
  });

  it('모델 2: 정지 점령(MARCHING + halted)도 같은 규칙', () => {
    const s = makeState(2);
    const pos = frontTile(s);
    const f = addFlag(s, pos, 20_000, { posture: POSTURE.ATTACK, state: 'MARCHING', halted: true });
    expect(exhausted(endOnce(s))).toBe(false);
    f.troopsMilli = 1_000;
    expect(exhausted(endOnce(s))).toBe(true);
  });

  it('모델 2: 방어 깃발은 40명 기준 그대로', () => {
    const s = makeState(2);
    const pos = frontTile(s);
    addFlag(s, pos, (FLAG_MIN_TROOPS - 1) * 1000, { posture: POSTURE.DEFEND, state: 'ENGAGED' });
    expect(exhausted(endOnce(s))).toBe(true);
  });

  it('모델 1: 구 규칙(40명 미만 소진) 비트 동일', () => {
    const s = makeState(1);
    const pos = frontTile(s);
    addFlag(s, pos, 30_000, { posture: POSTURE.ATTACK, state: 'ENGAGED' });
    expect(exhausted(endOnce(s))).toBe(true);
  });
});
