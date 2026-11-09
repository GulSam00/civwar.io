/**
 * 깃발 hover 카드·깃발 선택 패널이 같이 쓰는 표시 계산 (2026-11-06 UI 개편, 이슈 20261104-0112).
 * 사용자 결정: hover 카드 = 병종·병력·주인·태세·상태·사기 막대와 %·지금 공격/방어.
 * 사기 상세(사기 곱 범위·±0 경계·증감 속도·기지 하한)는 선택 패널의 접기 안과 [?] 도움말로 옮겼다.
 */
import { POSTURE, type FlagSnapshot } from '@civwar/shared';
import { FLAG_STATE_NAME } from './text.js';
import { fmt1, pctOfPm } from './unitStats.js';
import type { MoraleDetail } from './morale.js';

/** 상태 줄 조각 — 기본 상태(행군·교전·귀환·대기) 뒤에 표시(전투 중·패주·사기 붕괴 후퇴·대치·이탈 대기·정체) */
export function flagStatusParts(f: Pick<FlagSnapshot, 'state' | 'inCombat' | 'routed' | 'blocked' | 'disengaging' | 'stalled'>, moraleRetreat: boolean): string[] {
  const out: string[] = [FLAG_STATE_NAME[f.state]];
  if (f.inCombat) out.push('전투 중');
  if (f.routed) out.push('패주');
  else if (moraleRetreat) out.push('사기 붕괴 후퇴');
  if (f.blocked) out.push('대치');
  if (f.disengaging) out.push('이탈 대기');
  if (f.stalled) out.push('정체');
  return out;
}

/** 선택 패널 '사기 상세' 접기 안의 행 [이름, 값, class] — 수치만 (설명은 [?] 도움말) */
export function moraleDetailRows(f: Pick<FlagSnapshot, 'posture'>, md: MoraleDetail): [string, string, string?][] {
  const rows: [string, string, string?][] = [];
  rows.push(['사기 배율', pctOfPm(md.view.multPm), 'tt-strong']);
  rows.push(['사기 0 → 100%', `${pctOfPm(md.floorPm)} → ${pctOfPm(md.fullPm)}`]);
  rows.push(['±0 경계', md.neutral === null ? '없음' : `사기 ${Math.round(md.neutral / 10)}%`]);
  const drop = f.posture === POSTURE.ATTACK ? md.rates.dropAtk : md.rates.dropDef;
  rows.push(['교전 중', `−${fmt1(drop)}%/초 · 손실 1%당 −${fmt1(md.rates.lossK)}%p`]);
  rows.push(['회복', `+${fmt1(md.rates.recover)}%/초 · 기지 위 +${fmt1(md.rates.recoverBase)}%/초`]);
  // v5.1 (GDD 4.5 ③): 내 기지 칸 위 = 사기 하한 30%
  if (md.baseFloor !== null) rows.push(['기지 사기 하한', `${Math.round(md.baseFloor / 10)}%`, 'tt-floor']);
  return rows;
}
