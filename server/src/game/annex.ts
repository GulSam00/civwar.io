/**
 * 약소국 정리 보상 (사용자 2026-10-23, §31, [A-141]~) — 마지막 기지를 점령해 상대를 멸망시킨(합병 받는) 플레이어에게 주는 보상.
 *
 * 보상 후보 (자가대전 시험용 레버 — 기본값 = 채택안, eval 스크립트가 덮어쓸 수 있다):
 *  - assetPermille  : 멸망자의 풀 병력 + 깃발 병력 중 합병자에게 넘어가는 비율 (나머지 소멸). 합병자 병력 상한까지만 받는다
 *  - goldPermille   : 멸망자의 골드 중 넘어가는 비율
 *  - bountyTroops   : 정액 병력 현상금 (합병자 풀에 더함, 상한까지, 새로 생기는 병력 = 회계상 regen)
 *  - bountyGold     : 정액 골드 현상금
 *  - fullProd       : 1 이면 마지막 기지 점령 시 생산력 ×0.5 를 면제 (100% 유지)
 */
import {
  ANNEX_ASSET_PERMILLE,
  ANNEX_BOUNTY_GOLD,
  ANNEX_BOUNTY_TROOPS,
  ANNEX_FULL_PROD,
  ANNEX_GOLD_PERMILLE,
} from '@civwar/shared';

export const ANNEX = {
  assetPermille: ANNEX_ASSET_PERMILLE,
  goldPermille: ANNEX_GOLD_PERMILLE,
  bountyTroops: ANNEX_BOUNTY_TROOPS,
  bountyGold: ANNEX_BOUNTY_GOLD,
  fullProd: ANNEX_FULL_PROD,
};

/** 진단 전용 — 환경변수 CIVWAR_ANNEX="asset=500,gold=1000,troops=100,bgold=0,prod=1" 로 덮어쓴다 (게임 상수 아님) */
export function applyAnnexOverride(spec: string | undefined): void {
  if (!spec) return;
  for (const kv of spec.split(',')) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (k === 'asset') ANNEX.assetPermille = n;
    else if (k === 'gold') ANNEX.goldPermille = n;
    else if (k === 'troops') ANNEX.bountyTroops = n;
    else if (k === 'bgold') ANNEX.bountyGold = n;
    else if (k === 'prod') ANNEX.fullProd = n;
  }
}
applyAnnexOverride(process.env.CIVWAR_ANNEX);
