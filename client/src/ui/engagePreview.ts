/**
 * 교전 예상 (전투 모델 2, §33) — 지금 싸우는 깃발이 이 교전에서 손실을 얼마나 나눠 지는지 미리 보인다.
 * shared `sideLossDetail` 을 서버 4a 와 같은 입력(지형·기지·사기·이탈 반영)으로 부르므로, 상수가 바뀌어도 UI 는 그대로 맞는다.
 * 교전 그룹은 render/combatPairs 의 쌍(서버 전투 간선과 같은 규칙)을 이어서 찾는다.
 *
 * 한계: 총 손실량 T 의 바닥항(시작 병력 기준)은 클라이언트가 시작 병력을 몰라 현재 병력으로 근사한다.
 * 그래서 절대 손실량은 보이지 않고, 편 사이 비율(lossPermille)만 보인다 — 그 비율은 서버 4a 와 같다.
 */
import { COMBAT_LOSS_BP, COMBAT_LOSS_FLOOR_BP, COMBAT_MIN_LOSS_MILLI, groupTotalLoss, sideLossDetail, type FlagSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { combatPairs } from '../render/combatPairs.js';
import { createTopologyView, type TopologyView } from '../render/topology.js';
import { flagCombatInput, moraleOn } from './morale.js';

/** 내 쪽 손실 비중(‰)이 이 값 이하면 유리, 이 값 이상이면 불리 (UI 표시 구분선 — 규칙 아님) */
export const PREVIEW_FAVORABLE_PERMILLE = 400;
export const PREVIEW_UNFAVORABLE_PERMILLE = 600;

export type EngageVerdict = 'favorable' | 'even' | 'unfavorable';

export interface EngagePreview {
  /** 이 교전에 얽힌 깃발 수 */
  flagCount: number;
  /** 편 수 (둘 이상) */
  sideCount: number;
  /** 내 편 손실 비중 ‰ (편 손실 합 대비) */
  minePermille: number;
  /** 교환비: 상대가 잃는 양 / 내가 잃는 양 (내 편 손실 0 이면 null) */
  ratio: number | null;
  verdict: EngageVerdict;
  /** "내 쪽 손실 38% · 상대 62% — 유리" */
  text: string;
}

const topoCache = new WeakMap<GameModel, { key: string; topo: TopologyView }>();
function topoOf(g: GameModel): TopologyView {
  const key = `${g.config.topology}:${g.width}x${g.height}`;
  const hit = topoCache.get(g);
  if (hit && hit.key === key) return hit.topo;
  const topo = createTopologyView(g.config.topology, g.width, g.height);
  topoCache.set(g, { key, topo });
  return topo;
}

export function verdictOf(minePermille: number): EngageVerdict {
  return minePermille <= PREVIEW_FAVORABLE_PERMILLE ? 'favorable' : minePermille >= PREVIEW_UNFAVORABLE_PERMILLE ? 'unfavorable' : 'even';
}

const VERDICT_TEXT: Record<EngageVerdict, string> = { favorable: '유리', even: '접전', unfavorable: '불리' };

/** 서버 buildSides 와 같은 편 가르기: 동맹 union-find, 편 안에 적대 쌍이 있으면 소유자별로 쪼갠다 */
function sidesOf(g: GameModel, owners: number[]): number[][] {
  const parent = new Map(owners.map((o) => [o, o] as const));
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (let i = 0; i < owners.length; i++)
    for (let j = i + 1; j < owners.length; j++)
      if (g.isAlly(owners[i], owners[j])) {
        const a = find(owners[i]);
        const b = find(owners[j]);
        if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
      }
  const comps = new Map<number, number[]>();
  for (const o of owners) {
    const r = find(o);
    comps.set(r, [...(comps.get(r) ?? []), o]);
  }
  const sides: number[][] = [];
  for (const c of comps.values()) {
    const ok = c.every((a, i) => c.every((b, j) => i >= j || g.isAlly(a, b)));
    if (ok) sides.push(c);
    else for (const o of c) sides.push([o]);
  }
  for (const s of sides) s.sort((a, b) => a - b);
  sides.sort((a, b) => a[0] - b[0]);
  return sides;
}

/** f 가 속한 교전 그룹의 예상. 모델 1 이거나 교전 중이 아니거나 상대를 못 찾으면 null */
export function engagePreview(g: GameModel, f: FlagSnapshot): EngagePreview | null {
  if (!moraleOn(g) || !f.inCombat || !g.terrain) return null;
  const pairs = combatPairs(g.flags.values(), (a, b) => topoOf(g).touching(a, b), (a, b) => g.isAlly(a, b));
  const adj = new Map<number, number[]>();
  for (const p of pairs) {
    adj.set(p.a, [...(adj.get(p.a) ?? []), p.b]);
    adj.set(p.b, [...(adj.get(p.b) ?? []), p.a]);
  }
  if (!adj.has(f.id)) return null;
  const seen = new Set<number>([f.id]);
  const queue = [f.id];
  for (let qi = 0; qi < queue.length; qi++) {
    for (const n of adj.get(queue[qi]) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  }
  const comp = queue.map((id) => g.flags.get(id)!).sort((a, b) => a.id - b.id);
  const owners = [...new Set(comp.map((x) => x.ownerId))].sort((a, b) => a - b);
  const sideOwners = sidesOf(g, owners);
  if (sideOwners.length < 2) return null;
  const sideFlags = sideOwners.map((os) => comp.filter((x) => os.includes(x.ownerId)));
  const inputs = sideFlags.map((fs) => fs.map((x) => flagCombatInput(g, x)!));
  const S = comp.reduce((a, x) => a + x.troops * 1000, 0);
  const T = groupTotalLoss(S, S, comp.length, sideOwners.length, COMBAT_LOSS_BP, COMBAT_LOSS_FLOOR_BP, COMBAT_MIN_LOSS_MILLI);
  const det = sideLossDetail(inputs, T);
  const mi = sideOwners.findIndex((os) => os.includes(f.ownerId));
  const minePermille = det[mi].lossPermille;
  const total = det.reduce((a, d) => a + d.lossMilli, 0);
  const foeLoss = total - det[mi].lossMilli;
  const ratio = det[mi].lossMilli > 0 ? foeLoss / det[mi].lossMilli : null;
  const verdict = verdictOf(minePermille);
  return {
    flagCount: comp.length,
    sideCount: sideOwners.length,
    minePermille,
    ratio,
    verdict,
    text: `내 쪽 손실 ${Math.round(minePermille / 10)}% · 상대 ${100 - Math.round(minePermille / 10)}% — ${VERDICT_TEXT[verdict]}`,
  };
}
