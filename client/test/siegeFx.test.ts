/**
 * 2026-11-10 공성 시각 효과 (피격 흔들림 · 포위 고리 · 함락 파동) 판정.
 */
import { describe, expect, it } from 'vitest';
import { SHAKE_MS, SIEGE_HOLD_MS, SiegeTracker, WAVE_MS, ringSweep, shakeOffset, underSiege, waveProgress } from '../src/render/siegeFx.js';

describe('SiegeTracker', () => {
  it('처음 본 기지는 효과 없음, 체력이 줄면 피격 시각 기록', () => {
    const t = new SiegeTracker();
    const a = t.observe(5, 100, 1, 0);
    expect(a.hitAt).toBeLessThan(-1e8);
    expect(a.capturedAt).toBeLessThan(-1e8);
    expect(t.observe(5, 100, 1, 100).hitAt).toBeLessThan(-1e8); // 그대로면 피격 아님
    expect(t.observe(5, 97, 1, 200).hitAt).toBe(200);
    expect(t.observe(5, 98, 1, 300).hitAt).toBe(200); // 회복은 피격 아님
  });
  it('주인이 바뀌면 함락 시각 기록, 포위(피격) 상태는 끝난다', () => {
    const t = new SiegeTracker();
    t.observe(5, 10, 1, 0);
    t.observe(5, 4, 1, 100);
    const st = t.observe(5, 100, 2, 200);
    expect(st.capturedAt).toBe(200);
    expect(st.hitAt).toBeLessThan(-1e8);
    expect(st.owner).toBe(2);
  });
});

describe('효과 시간', () => {
  it('흔들림은 맞은 직후만, SHAKE_MS 뒤엔 0', () => {
    expect(shakeOffset(1000, 1000 - SHAKE_MS)).toEqual({ dx: 0, dy: 0 });
    const o = shakeOffset(1010, 1000);
    expect(Math.abs(o.dx) + Math.abs(o.dy)).toBeGreaterThan(0);
  });
  it('포위 = 공격 깃발이 밀고 있거나 마지막 피격이 SIEGE_HOLD_MS 안', () => {
    expect(underSiege(5000, -1e9, true)).toBe(true);
    expect(underSiege(5000, 5000 - SIEGE_HOLD_MS + 1, false)).toBe(true);
    expect(underSiege(5000, 5000 - SIEGE_HOLD_MS, false)).toBe(false);
  });
  it('함락 파동은 WAVE_MS 동안 0 → 1', () => {
    expect(waveProgress(1000, 1000)).toBe(0);
    expect(waveProgress(1000 + WAVE_MS / 2, 1000)).toBe(0.5);
    expect(waveProgress(1000 + WAVE_MS, 1000)).toBeNull();
  });
  it('체력 고리 각도 = 체력 비율 × 한 바퀴', () => {
    expect(ringSweep(100)).toBeCloseTo(Math.PI * 2);
    expect(ringSweep(25)).toBeCloseTo(Math.PI / 2);
    expect(ringSweep(-5)).toBe(0);
  });
});
