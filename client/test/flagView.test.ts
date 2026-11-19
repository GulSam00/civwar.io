/**
 * 2026-11-06 UI 개편 (이슈 20261104-0112) — 깃발 hover 카드·선택 패널이 같이 쓰는 표시 계산.
 */
import { describe, expect, it } from 'vitest';
import { POSTURE } from '@civwar/shared';
import { flagStatusParts, moraleDetailRows } from '../src/ui/flagView.js';
import type { MoraleDetail } from '../src/ui/morale.js';

const base = { state: 'MARCHING' as const, inCombat: false, routed: false, blocked: false, disengaging: false, stalled: false };

describe('flagStatusParts', () => {
  it('기본 상태만 있으면 한 조각', () => {
    expect(flagStatusParts(base, false)).toEqual(['행군']);
  });
  it('표시 순서: 전투 중 → 패주/사기 붕괴 후퇴 → 대치 → 이탈 대기 → 정체', () => {
    expect(flagStatusParts({ ...base, state: 'ENGAGED', inCombat: true, blocked: true, disengaging: true, stalled: true }, true)).toEqual(['교전', '전투 중', '사기 붕괴 후퇴', '대치', '이탈 대기', '정체']);
  });
  it('패주면 사기 붕괴 후퇴는 붙이지 않는다', () => {
    expect(flagStatusParts({ ...base, state: 'RETURNING', routed: true }, true)).toEqual(['귀환', '패주']);
  });
});

describe('moraleDetailRows', () => {
  const md = (over: Partial<MoraleDetail> = {}): MoraleDetail =>
    ({
      view: { value: 800, pct: 80, tone: 'high', text: '', multPm: 1100, bands: { low: 200, mid: 400 } },
      now: [1080, 1200],
      full: [1100, 1220],
      empty: [850, 950],
      floorPm: 850,
      fullPm: 1200,
      neutral: 430,
      rates: { dropAtk: 2, dropDef: 1, lossK: 0.5, recover: 1.5, recoverBase: 5 },
      baseFloor: null,
      ...over,
    }) as MoraleDetail;

  it('수치만 — 사기 배율·범위·±0 경계·교전 중(태세별)·회복', () => {
    expect(moraleDetailRows({ posture: POSTURE.ATTACK }, md())).toEqual([
      ['사기 배율', '+10%', 'tt-strong'],
      ['사기 0 → 100%', '−15% → +20%'],
      ['±0 경계', '사기 43%'],
      ['교전 중', '−2%/초 · 손실 1%당 −0.5%p'],
      ['회복', '+1.5%/초 · 기지 위 +5%/초'],
    ]);
    expect(moraleDetailRows({ posture: POSTURE.DEFEND }, md())[3]).toEqual(['교전 중', '−1%/초 · 손실 1%당 −0.5%p']);
  });
  it('±0 경계가 없으면(창병) "없음", 내 기지 위면 기지 사기 하한 행', () => {
    const rows = moraleDetailRows({ posture: POSTURE.ATTACK }, md({ neutral: null, baseFloor: 300 }));
    expect(rows[2]).toEqual(['±0 경계', '없음']);
    expect(rows.at(-1)).toEqual(['기지 사기 하한', '30%', 'tt-floor']);
  });
});
