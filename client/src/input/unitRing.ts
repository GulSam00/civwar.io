/**
 * 병종 고리 (2026-10-22 사용자 확정 — 조작 변경). 우클릭 둘레 메뉴(정보·동맹·이모트·따라가기·수비 배치)와 삼각 병종 메뉴를 대신한다.
 *
 * 맵 칸을 우클릭하면(내 부대 선택 없음) 그 칸 둘레에 창·검·기 세 병종 고리가 뜬다. 고르면 가장 가까운 내 기지에서 출전
 * (고리가 열릴 때 내 땅 = 방어, 적·중립 = 공격이 미리 선택되고, 가운데를 눌러 바꾼다 — v5.6). 기지 클릭 → 조준 → 지점 클릭도 같은 고리에서 끝난다 (출전 기지만 고른 기지).
 * 쓸 수 없는 병종은 점선 + 툴팁에 이유. 서버 검증을 대신하지 않는다(표시 전용 사전 판정 — 수락/거절은 cmd_ack).
 *
 * 이 파일은 GameModel 을 읽기만 하는 순수 함수 — 상태 전이는 controller.ts, 그리기는 ui/UnitRing.tsx.
 */
import { FLAG_MIN_TROOPS, type Unit } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import type { CursorPreview } from './preview.js';

export type RingKind = 'attack' | 'defend' | 'blocked';

export interface RingUnit {
  unit: Unit;
  /** 지금 비율로 보낼 병력 */
  troops: number;
  disabled: boolean;
  /** 쓸 수 없는 이유 (disabled 일 때만) */
  reason: string | null;
}

export interface RingModel {
  tile: number;
  ownerId: number;
  land: boolean;
  /** 고른 출전 태세. 물·동맹 = blocked */
  kind: RingKind;
  /** 가운데 글자 (방어 / 공격 / 지정 불가) */
  label: string;
  /** 가운데 툴팁 설명 */
  hint: string;
  /** 출발 기지 안내 (없으면 null) */
  detail: string | null;
  /** 병종 공통으로 쓸 수 없는 이유 (없으면 null — 병력 부족은 병종마다 따로) */
  reason: string | null;
  /** 출발 기지 (가장 가까운 내 기지 또는 조준에서 고른 기지). 없으면 null */
  base: number | null;
  units: RingUnit[];
}

export interface RingInput {
  g: GameModel;
  tile: number;
  me: number | null;
  /** 관전자가 아닌가 (me 가 있고 room 에 내 자리가 있음) */
  spectating: boolean;
  canCommand: boolean;
  /** 출발 기지 (controller 가 정한 것) */
  base: number | null;
  /** v5.6 지금 고른 출전 태세 (controller.ix.issue.posture). 없으면 땅 기준 기본값 */
  posture?: RingKind;
  /** 커서 예고 (preview.computePreview — 사거리 밖·물·동맹 판정) */
  preview: CursorPreview | null;
  /** 병종별 보낼 병력 (controller.troopsToSend) */
  troopsFor: (u: Unit) => number;
  /** v5.1 출전 쿨타임 때문에 못 보내는 이유 (예: "이 기지는 출전 준비 중입니다 (3초)") — 없으면 null */
  cooldown?: string | null;
  /** v5.1 더 가까운 기지가 출전 준비 중이라 다음 기지에서 나간다 */
  skippedNearer?: boolean;
}

function minTroops(g: GameModel): number {
  return (g.config.constants?.FLAG_MIN_TROOPS as number | undefined) ?? FLAG_MIN_TROOPS;
}

export function unitRingModel(inp: RingInput): RingModel | null {
  const { g, tile, me } = inp;
  if (!g.ready || tile < 0 || tile >= g.tileCount) return null;
  const land = g.isLand(tile);
  const ownerId = land ? g.owners[tile] : 0;
  const baseName = (t: number | null) => (t === null ? '' : (g.baseNames.get(t) ?? (g.capitalTiles.has(t) ? '수도' : '기지')));

  let kind: RingKind;
  let label: string;
  let hint: string;
  let reason: string | null = null;
  if (!inp.canCommand || me === null) {
    kind = !land ? 'blocked' : me !== null && ownerId === me ? 'defend' : 'attack';
    label = kind === 'blocked' ? '지정 불가' : kind === 'defend' ? '방어' : '공격';
    hint = '출전 병종을 고릅니다';
    reason = inp.spectating || me === null ? '관전 중에는 명령할 수 없습니다' : '지금은 명령할 수 없습니다';
  } else if (!land) {
    kind = 'blocked';
    label = '지정 불가';
    hint = '이 칸에는 깃발을 보낼 수 없습니다';
    reason = '물 — 통행·점령 불가';
  } else if (ownerId !== me && ownerId !== 0 && g.isAlly(me, ownerId)) {
    kind = 'blocked';
    label = '지정 불가';
    hint = '동맹 영토에는 깃발을 보낼 수 없습니다';
    reason = '동맹 영토입니다';
  } else {
    const mine = ownerId === me;
    const defend = (inp.posture ?? (mine ? 'defend' : 'attack')) === 'defend';
    const where = ownerId === 0 ? '중립' : '적';
    kind = defend ? 'defend' : 'attack';
    label = defend ? '방어' : '공격';
    if (defend) hint = mine ? '여기로 부대를 보내 지킵니다 (방어 태세)' : `${where} 땅 방향으로 보내 지킵니다 — 적 땅은 지나가지 못합니다 (방어 태세)`;
    else hint = mine ? '내 땅으로 보내 옆 칸의 적·중립 땅을 공격합니다 (공격 태세)' : `${where} 땅으로 진격합니다 (공격 태세)`;
    const p = g.players.get(me);
    if (p && g.flagsOf(me).length >= p.flagCap) reason = `깃발 슬롯이 꽉 찼습니다 (${g.flagsOf(me).length}/${p.flagCap})`;
    else if (inp.base === null) reason = '출전할 내 기지가 없습니다';
    else if (inp.cooldown) reason = inp.cooldown;
    else if (inp.preview?.kind === 'blocked') reason = inp.preview.label;
  }

  const min = minTroops(g);
  const units: RingUnit[] = ([0, 1, 2] as Unit[]).map((unit) => {
    const troops = inp.troopsFor(unit);
    const r = reason ?? (troops < min ? `병력이 너무 적습니다 (최소 ${min})` : null);
    return { unit, troops, disabled: r !== null, reason: r };
  });
  return {
    tile,
    ownerId,
    land,
    kind,
    label,
    hint,
    detail:
      inp.base === null
        ? null
        : `출발: ${tile === inp.base ? '이 기지' : inp.skippedNearer ? `내 기지 ${baseName(inp.base)} (더 가까운 기지는 출전 준비 중)` : `가장 가까운 내 기지 ${baseName(inp.base)}`}`,
    reason,
    base: inp.base,
    units,
  };
}

// ───────────────────────── 배치 (화면 좌표) ─────────────────────────

/** 병종 고리 반지름 (배율 1 기준 px) */
export const RING_R = 76;

/** 병종 버튼 각도(도) — 위 = 창, 왼쪽 아래 = 검, 오른쪽 아래 = 기병 */
export const RING_UNIT_ANGLES: readonly number[] = [-90, 150, 30];

export function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) };
}

/** 고리가 차지하는 반경(배율 1) — 화면 가장자리 안쪽으로 끌어오는 데 쓴다 (위쪽 주인 이름표까지) */
export const RING_EXTENT = RING_R + 76;

/** 화면 크기에 맞춘 배율 (작은 창에서 줄인다) */
export function ringScale(viewW: number, viewH: number): number {
  return Math.max(0.7, Math.min(1, Math.min(viewW, viewH) / 760));
}

/**
 * 고리 중심을 화면 안쪽으로 (가장자리 근처에서도 고리 전체가 보이게). top = 위쪽 HUD 줄만큼 더 비울 높이.
 * 화면이 고리보다 작으면 가운데.
 */
export function clampRingCenter(x: number, y: number, viewW: number, viewH: number, extent: number, margin = 6, top = 0): { x: number; y: number } {
  const fit = (v: number, size: number, lo: number) => (size - lo < 2 * (extent + margin) ? lo + (size - lo) / 2 : Math.min(size - extent - margin, Math.max(lo + extent + margin, v)));
  return { x: Math.round(fit(x, viewW, 0)), y: Math.round(fit(y, viewH, top)) };
}
