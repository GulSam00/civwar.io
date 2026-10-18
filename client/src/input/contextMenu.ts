/**
 * 우클릭 원형 메뉴 (2026-10-18 사용자 승인 — OpenFront.io 참고, design-decisions「추가로 진행할 작업: 우클릭 원형 메뉴」).
 * 내 부대가 선택돼 있지 않을 때 맵 칸을 우클릭하면 커서 칸 둘레에 고리 메뉴가 뜬다. (부대 선택 + 우클릭 = 이동은 그대로 — 2026-10-14)
 *
 *  가운데 = 그 칸의 주 동작: 내 땅 = 방어 / 적·중립 = 공격 출전 (가장 가까운 내 기지에서) → 바깥 고리에 창·검·기 (1/2/3)
 *  고리   = 정보(주인 정보 카드 · 중립·물 = 지형 정보) · 동맹(제안·파기·수락) · 이모트(바깥 고리) · 따라가기
 *           + 내 기지 칸이면 수비 배치 (이 기지에 방어 부대 한 번에 — 방어력이 가장 높은 병종, 출발 = 이 기지)
 *  쓸 수 없는 항목은 회색 점선 + 툴팁에 이유. 서버 검증을 대신하지 않는다(표시 전용 사전 판정 — 수락/거절은 cmd_ack).
 *
 * 이 파일은 GameModel 을 읽기만 하는 순수 함수 — 상태 전이는 controller.ts, 그리기는 ui/ContextRadial.tsx.
 */
import { FLAG_MIN_TROOPS, type Unit } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import type { CursorPreview } from './preview.js';
import { diplomacyAction, relationTo, type DiploAction, type PlayerNames, type Relation } from '../ui/playerInfo.js';
import { UNIT_NAME, fmtClock } from '../ui/text.js';

/** 열린 원형 메뉴 상태. sub = 바깥 고리 (units = 병종, emote = 이모트, terrain = 지형 정보 상자) */
export type CtxSub = 'units' | 'emote' | 'terrain' | null;
export interface CtxMenuState {
  tile: number;
  sub: CtxSub;
}

export type CtxSegId = 'info' | 'ally' | 'emote' | 'follow' | 'station';

export interface CtxItem {
  id: CtxSegId;
  label: string;
  /** 툴팁 설명 (무엇을 하는가) */
  hint: string;
  /** 툴팁 둘째 줄 (비용·대상 등). 없으면 null */
  detail: string | null;
  disabled: boolean;
  /** 쓸 수 없는 이유 (disabled 일 때만) */
  reason: string | null;
}

export type CtxCenterKind = 'attack' | 'defend' | 'blocked';

export interface CtxCenter {
  kind: CtxCenterKind;
  label: string;
  hint: string;
  detail: string | null;
  disabled: boolean;
  reason: string | null;
  /** 출발 기지 (가장 가까운 내 기지). 없으면 null */
  base: number | null;
}

export interface CtxUnitItem {
  unit: Unit;
  troops: number;
  disabled: boolean;
  reason: string | null;
}

export interface CtxMenuModel {
  tile: number;
  ownerId: number;
  land: boolean;
  relation: Relation | null;
  center: CtxCenter;
  segments: CtxItem[];
  /** 이 칸의 동맹 동작 (ally 칸을 눌렀을 때 실행할 것) */
  allyAction: DiploAction | null;
  /** 수비 배치 병종·병력 (내 기지 칸일 때만) */
  station: { unit: Unit; troops: number } | null;
}

/** 원형 메뉴에 담는 이모트 (작은 고리 — 8개). 전체 16개는 우상단 이모트 버튼·정보 카드에 그대로 있다 */
export const CTX_EMOTE_CODES: readonly number[] = [0, 1, 2, 4, 5, 6, 9, 15];

export interface CtxInput {
  g: GameModel;
  tile: number;
  me: number | null;
  /** 관전자가 아닌가 (me 가 있고 room 에 내 자리가 있음) */
  spectating: boolean;
  canCommand: boolean;
  /** 가장 가까운 내 기지 (controller.nearestBaseFor) */
  base: number | null;
  /** 커서 예고 (preview.computePreview — 사거리 밖·물·동맹 판정) */
  preview: CursorPreview | null;
  followingId: number | null;
  names: PlayerNames;
  /** 병종별 보낼 병력 (controller.troopsToSend) */
  troopsFor: (u: Unit) => number;
  /** 병종별 방어력 ‰ (techInfo.unitCombatStats(...).def) */
  defFor: (u: Unit) => number;
}

function minTroops(g: GameModel): number {
  return (g.config.constants?.FLAG_MIN_TROOPS as number | undefined) ?? FLAG_MIN_TROOPS;
}

/** 깃발을 새로 낼 수 있는가 — 공통 사전 판정 (관전·슬롯·기지). 이유 문자열 또는 null */
function issueBlock(inp: CtxInput): string | null {
  const { g, me } = inp;
  if (!inp.canCommand || me === null) return inp.spectating || me === null ? '관전 중에는 명령할 수 없습니다' : '지금은 명령할 수 없습니다';
  const p = g.players.get(me);
  if (p && g.flagsOf(me).length >= p.flagCap) return `깃발 슬롯이 꽉 찼습니다 (${g.flagsOf(me).length}/${p.flagCap})`;
  if (inp.base === null) return '출전할 내 기지가 없습니다';
  return null;
}

/** 방어력이 가장 높은 병종 (같으면 번호가 작은 쪽) */
export function bestDefender(defFor: (u: Unit) => number): Unit {
  let best: Unit = 0;
  for (const u of [1, 2] as Unit[]) if (defFor(u) > defFor(best)) best = u;
  return best;
}

export function contextMenuModel(inp: CtxInput): CtxMenuModel | null {
  const { g, tile, me } = inp;
  if (!g.ready || tile < 0 || tile >= g.tileCount) return null;
  const land = g.isLand(tile);
  const ownerId = land ? g.owners[tile] : 0;
  const relation = land ? relationTo(g, me, ownerId) : null;
  const tickMs = g.config.tickMs;
  const clock = (ticks: number) => fmtClock(ticks * tickMs);
  const baseName = (t: number | null) => (t === null ? '' : (g.baseNames.get(t) ?? (g.capitalTiles.has(t) ? '수도' : '기지')));

  // ── 가운데: 주 동작 ──
  const block = issueBlock(inp);
  let center: CtxCenter;
  if (!land) center = { kind: 'blocked', label: '지정 불가', hint: '이 칸에는 깃발을 보낼 수 없습니다', detail: null, disabled: true, reason: '물 — 통행·점령 불가', base: inp.base };
  else if (me !== null && ownerId !== me && ownerId !== 0 && g.isAlly(me, ownerId))
    center = { kind: 'blocked', label: '지정 불가', hint: '동맹 영토에는 깃발을 보낼 수 없습니다', detail: null, disabled: true, reason: '동맹 영토입니다', base: inp.base };
  else {
    const defend = me !== null && ownerId === me;
    const kind: CtxCenterKind = defend ? 'defend' : 'attack';
    const outOfRange = inp.preview?.kind === 'blocked' ? inp.preview.label : null;
    const reason = block ?? outOfRange;
    center = {
      kind,
      label: defend ? '방어' : '공격',
      hint: defend ? '여기로 부대를 보내 지킵니다 (방어 태세) → 병종 선택' : `${ownerId === 0 ? '중립' : '적'} 땅으로 진격합니다 (공격 태세) → 병종 선택`,
      detail: inp.base !== null ? `출발: 가장 가까운 내 기지 ${baseName(inp.base)}` : null,
      disabled: reason !== null,
      reason,
      base: inp.base,
    };
  }

  const segments: CtxItem[] = [];

  // ── 정보 ──
  if (ownerId > 0) segments.push({ id: 'info', label: '정보', hint: `${inp.names.nick(ownerId)} 정보 카드 열기`, detail: null, disabled: false, reason: null });
  else segments.push({ id: 'info', label: '정보', hint: '이 칸의 지형 정보 보기', detail: land ? '중립 땅' : null, disabled: false, reason: null });

  // ── 동맹 ──
  let allyAction: DiploAction | null = null;
  const ally = (label: string, hint: string, reason: string | null, detail: string | null = null): CtxItem => ({ id: 'ally', label, hint, detail, disabled: reason !== null, reason });
  if (ownerId === 0) segments.push(ally('동맹', '이 칸 주인과 동맹 제안·파기', land ? '중립 땅 — 동맹할 상대가 없습니다' : '물 — 주인이 없습니다'));
  else if (ownerId === me) segments.push(ally('동맹', '이 칸 주인과 동맹 제안·파기', '내 영토입니다'));
  else {
    const act = diplomacyAction(g, me, ownerId, inp.canCommand);
    allyAction = act;
    const who = inp.names.nick(ownerId);
    switch (act.kind) {
      case 'propose':
        segments.push(ally('동맹 제안', `${who}에게 동맹 제안 (상대가 수락하면 성립)`, act.reason));
        break;
      case 'break':
        segments.push(ally('동맹 파기', `${who}와의 동맹 파기 — 30초 뒤 해제 (그동안 서로 공격 불가)`, act.disabled ? `${act.reason ?? '아직 파기할 수 없습니다'} (남은 ${clock(act.waitTicks)})` : null));
        break;
      case 'respond':
        segments.push(ally('동맹 수락', `${who}의 동맹 제안 수락`, null, `남은 시간 ${clock(act.expireTicks)} · 거절은 정보 카드·외교 창`));
        break;
      case 'outgoing':
        segments.push(ally('제안함', `${who}에게 보낸 동맹 제안`, `이미 제안했습니다 — 응답 대기 (${clock(act.expireTicks)})`));
        break;
      case 'breaking':
        segments.push(ally('해제 중', `${who}와의 동맹 해제 중`, `동맹 해제까지 ${clock(act.breakTicks)}`));
        break;
      default:
        segments.push(ally('동맹', '이 칸 주인과 동맹 제안·파기', act.reason || '동맹을 맺을 수 없습니다'));
    }
  }

  // ── 이모트 ──
  segments.push({
    id: 'emote',
    label: '이모트',
    hint: '말풍선 보내기 (모두에게 보입니다)',
    detail: null,
    disabled: !inp.canCommand,
    reason: inp.canCommand ? null : '관전 중에는 이모트를 보낼 수 없습니다',
  });

  // ── 따라가기 ──
  if (ownerId > 0) {
    const on = inp.followingId === ownerId;
    segments.push({ id: 'follow', label: on ? '따라가기 끔' : '따라가기', hint: on ? '카메라 따라가기 끄기 (자유 카메라)' : `카메라로 ${inp.names.nick(ownerId)} 따라가기`, detail: null, disabled: false, reason: null });
  } else segments.push({ id: 'follow', label: '따라가기', hint: '카메라로 이 칸 주인 따라가기', detail: null, disabled: true, reason: land ? '중립 땅 — 따라갈 주인이 없습니다' : '물 — 주인이 없습니다' });

  // ── 수비 배치 (내 기지 칸) ──
  let station: CtxMenuModel['station'] = null;
  const myBase = me !== null && g.bases.get(tile)?.ownerId === me;
  if (myBase) {
    const unit = bestDefender(inp.defFor);
    const troops = inp.troopsFor(unit);
    station = { unit, troops };
    const blockStation = inp.canCommand ? issueBlockNoBase(inp) : '관전 중에는 명령할 수 없습니다';
    const reason = blockStation ?? (troops < minTroops(g) ? `병력이 너무 적습니다 (최소 ${minTroops(g)})` : null);
    segments.push({
      id: 'station',
      label: '수비 배치',
      hint: `이 ${g.capitalTiles.has(tile) ? '수도' : '기지'}에 방어 부대를 바로 배치 (출발 = 이 기지)`,
      detail: `${UNIT_NAME[unit]} ${troops.toLocaleString()}명 — 방어력이 가장 높은 병종 · 보낼 병력 비율 반영`,
      disabled: reason !== null,
      reason,
    });
  }

  return { tile, ownerId, land, relation, center, segments, allyAction, station };
}

/** 수비 배치용: 출발 기지 = 이 기지라 "내 기지 없음"은 해당 없음 */
function issueBlockNoBase(inp: CtxInput): string | null {
  const { g, me } = inp;
  if (me === null) return '관전 중에는 명령할 수 없습니다';
  const p = g.players.get(me);
  if (p && g.flagsOf(me).length >= p.flagCap) return `깃발 슬롯이 꽉 찼습니다 (${g.flagsOf(me).length}/${p.flagCap})`;
  return null;
}

/** 바깥 고리 병종 버튼 (창·검·기) — 최소 병력 미만이면 비활성 */
export function ctxUnitItems(g: GameModel, troopsFor: (u: Unit) => number): CtxUnitItem[] {
  const min = minTroops(g);
  return ([0, 1, 2] as Unit[]).map((unit) => {
    const troops = troopsFor(unit);
    return { unit, troops, disabled: troops < min, reason: troops < min ? `병력이 너무 적습니다 (최소 ${min})` : null };
  });
}

// ───────────────────────── 배치 (화면 좌표) ─────────────────────────

/** 고리 반지름 (배율 1 기준 px) */
export const CTX_R1 = 76;
export const CTX_R2 = 146;

/** n 개 항목의 각도(도) — 맨 위부터 시계 방향 */
export function ringAngles(n: number, start = -90): number[] {
  return Array.from({ length: n }, (_, i) => start + (i * 360) / n);
}

export function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) };
}

/** 지금 메뉴가 차지하는 반경(배율 1) — 화면 가장자리 안쪽으로 끌어오는 데 쓴다 */
export function ctxExtent(sub: CtxSub): number {
  if (sub === 'units' || sub === 'emote') return CTX_R2 + 76; // 위쪽 주인 이름표까지
  if (sub === 'terrain') return CTX_R1 + 170;
  return CTX_R1 + 76;
}

/** 화면 크기에 맞춘 배율 (작은 창에서 줄인다) */
export function ctxScale(viewW: number, viewH: number): number {
  return Math.max(0.7, Math.min(1, Math.min(viewW, viewH) / 760));
}

/**
 * 메뉴 중심을 화면 안쪽으로 (가장자리 근처에서도 고리 전체가 보이게). top = 위쪽 HUD 줄만큼 더 비울 높이.
 * 화면이 메뉴보다 작으면 가운데.
 */
export function clampRingCenter(x: number, y: number, viewW: number, viewH: number, extent: number, margin = 6, top = 0): { x: number; y: number } {
  const fit = (v: number, size: number, lo: number) => (size - lo < 2 * (extent + margin) ? lo + (size - lo) / 2 : Math.min(size - extent - margin, Math.max(lo + extent + margin, v)));
  return { x: Math.round(fit(x, viewW, 0)), y: Math.round(fit(y, viewH, top)) };
}
