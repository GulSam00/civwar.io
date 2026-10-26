/**
 * 플레이어 정보 — 순위표(정렬·내 줄 고정), 상단 대상 바(가리키는 칸의 주인), 플레이어 정보 카드, 외교 버튼 상태.
 * (2026-10-18 UI 개선 3·4·6 — OpenFront.io 참고. 사용자 결정은 design-decisions.md 2026-10-18)
 * 전부 GameModel 을 읽기만 하는 순수 함수 — React 컴포넌트(panels.tsx · PlayerCard.tsx · GameScreen.tsx)는 그리기만 한다.
 */
import { ALLIANCE_CUTOFF_TICK, ALLIANCE_MIN_DURATION, MAX_ALLIES_PER_PLAYER, type PlayerSnapshot } from '@civwar/shared';
import type { GameModel } from '../state/gameModel.js';
import { incomeOf } from './production.js';

function constOf<T>(g: GameModel, name: string, fallback: T): T {
  const v = g.config.constants?.[name];
  return (v === undefined ? fallback : v) as T;
}

/** 표시 이름·봇 여부 (store.nicknameOf · room_state.players[].isBot) */
export interface PlayerNames {
  nick(id: number): string;
  isBot(id: number): boolean;
}

// ───────────────────────── 관계 ─────────────────────────

export type Relation = 'me' | 'ally' | 'enemy' | 'neutral';
export const RELATION_NAME: Record<Relation, string> = { me: '나', ally: '동맹', enemy: '적', neutral: '중립' };

/** 보는 사람(me) 기준 관계. 중립 땅 = 중립. 관전자(me = null)에게 플레이어는 관계가 없다(null — 표시 안 함) */
export function relationTo(g: GameModel, me: number | null, owner: number): Relation | null {
  if (owner === 0) return 'neutral';
  if (me === null) return null;
  if (owner === me) return 'me';
  return g.isAlly(me, owner) ? 'ally' : 'enemy';
}

/** 플레이어가 가진 기지 수 */
export function basesOf(g: GameModel, id: number): number {
  let n = 0;
  for (const b of g.bases.values()) if (b.ownerId === id) n++;
  return n;
}

/** 점유율 % (전체 육지 대비) */
export function sharePct(g: GameModel, tiles: number): number {
  return (tiles * 100) / Math.max(1, g.config.totalLandTiles);
}

// ───────────────────────── 순위표 ─────────────────────────

export type LeaderKey = 'share' | 'troops' | 'gold' | 'bases';
export const LEADER_KEYS: readonly LeaderKey[] = ['share', 'troops', 'gold', 'bases'];
export const LEADER_COL_NAME: Record<LeaderKey, string> = { share: '점유율', troops: '병력', gold: '골드', bases: '기지' };

export interface LeaderRow {
  id: number;
  rank: number;
  name: string;
  isBot: boolean;
  alive: boolean;
  connected: boolean;
  share: number;
  tiles: number;
  troops: number;
  gold: number;
  bases: number;
}

/**
 * 정렬된 순위표 행. 살아 있는 플레이어가 항상 먼저, 그 안에서 key 기준(desc = 큰 값 먼저), 같으면 점유율 → id.
 * 순위(rank)는 지금 정렬 기준의 자리 (OpenFront 처럼 — 열을 바꾸면 그 열의 순위).
 */
export function leaderboardRows(g: GameModel, names: PlayerNames, key: LeaderKey = 'share', desc = true): LeaderRow[] {
  const rows: LeaderRow[] = [...g.players.values()].map((p) => ({
    id: p.id,
    rank: 0,
    name: names.nick(p.id),
    isBot: names.isBot(p.id),
    alive: p.alive,
    connected: p.connected,
    share: sharePct(g, p.tiles),
    tiles: p.tiles,
    troops: p.troops,
    gold: p.gold,
    bases: basesOf(g, p.id),
  }));
  const val = (r: LeaderRow) => (key === 'share' ? r.tiles : r[key]);
  const dir = desc ? -1 : 1;
  rows.sort((a, b) => Number(b.alive) - Number(a.alive) || dir * (val(a) - val(b)) || b.tiles - a.tiles || a.id - b.id);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/**
 * 보이는 행: 위에서 topN 개 + (기준 플레이어가 그 밖이면) 맨 아래에 고정한 그 줄. pinned = 고정 줄 (없으면 null).
 * topN ≥ 행 수면 전부.
 */
export function visibleLeaderRows(rows: readonly LeaderRow[], topN: number, pinId: number | null): { top: LeaderRow[]; pinned: LeaderRow | null } {
  const top = rows.slice(0, Math.max(0, topN));
  if (pinId === null || top.some((r) => r.id === pinId)) return { top, pinned: null };
  return { top, pinned: rows.find((r) => r.id === pinId) ?? null };
}

// ───────────────────────── 상단 대상 바 ─────────────────────────

export type TargetKind = 'player' | 'bot' | 'neutral';
export const TARGET_KIND_NAME: Record<TargetKind, string> = { player: '플레이어', bot: '봇', neutral: '중립' };

export interface HoverTarget {
  kind: TargetKind;
  ownerId: number;
  name: string;
  relation: Relation | null;
  /** 중립이면 null */
  troops: number | null;
  gold: number | null;
  bases: number;
  share: number | null;
  alive: boolean;
}

/**
 * 가리키는 칸의 주인 (상단 중앙 바). 물·맵 밖·모델 준비 전이면 null. 중립 땅 = 중립 기지 수만 보인다.
 */
export function hoverTarget(g: GameModel, tile: number, me: number | null, names: PlayerNames): HoverTarget | null {
  if (!g.ready || tile < 0 || tile >= g.tileCount || !g.isLand(tile)) return null;
  const owner = g.owners[tile];
  if (owner === 0) return { kind: 'neutral', ownerId: 0, name: '중립 땅', relation: 'neutral', troops: null, gold: null, bases: basesOf(g, 0), share: null, alive: true };
  const p = g.players.get(owner);
  return {
    kind: names.isBot(owner) ? 'bot' : 'player',
    ownerId: owner,
    name: names.nick(owner),
    relation: relationTo(g, me, owner),
    troops: p?.troops ?? null,
    gold: p?.gold ?? null,
    bases: basesOf(g, owner),
    share: p ? sharePct(g, p.tiles) : null,
    alive: p?.alive ?? true,
  };
}

// ───────────────────────── 외교 버튼 상태 ─────────────────────────

export type DiploState = 'none' | 'active' | 'breaking' | 'outgoing' | 'incoming';

export function diplomacyState(g: GameModel, me: number, other: number): { rel: DiploState; proposalId?: number; expire?: number; since?: number; breakAt?: number | null } {
  const key = me < other ? `${me}-${other}` : `${other}-${me}`;
  const a = g.alliances.get(key);
  if (a) return a.state === 'ACTIVE' ? { rel: 'active', since: a.sinceTick } : { rel: 'breaking', breakAt: a.breakAtTick };
  for (const pr of g.proposals.values()) {
    if (pr.fromPlayerId === other && pr.toPlayerId === me) return { rel: 'incoming', proposalId: pr.proposalId, expire: pr.expireTick };
    if (pr.fromPlayerId === me && pr.toPlayerId === other) return { rel: 'outgoing', expire: pr.expireTick };
  }
  return { rel: 'none' };
}

/** 외교 창과 같은 규칙으로 정한 버튼 (cmd_ally_propose / cmd_ally_break / cmd_ally_respond) */
export type DiploAction =
  | { kind: 'propose'; disabled: boolean; reason: string | null }
  | { kind: 'break'; disabled: boolean; reason: string | null; waitTicks: number }
  | { kind: 'respond'; proposalId: number; expireTicks: number }
  | { kind: 'outgoing'; expireTicks: number }
  | { kind: 'breaking'; breakTicks: number }
  | { kind: 'none'; reason: string };

export function diplomacyAction(g: GameModel, me: number | null, other: number, canAct: boolean): DiploAction {
  if (me === null || !canAct) return { kind: 'none', reason: '관전 중에는 외교를 할 수 없습니다' };
  if (other === me) return { kind: 'none', reason: '' };
  const op = g.players.get(other);
  if (!op?.alive) return { kind: 'none', reason: '탈락한 플레이어입니다' };
  const cutoff = constOf(g, 'ALLIANCE_CUTOFF_TICK', ALLIANCE_CUTOFF_TICK);
  const minDur = constOf(g, 'ALLIANCE_MIN_DURATION', ALLIANCE_MIN_DURATION);
  const maxAllies = constOf(g, 'MAX_ALLIES_PER_PLAYER', MAX_ALLIES_PER_PLAYER);
  const r = diplomacyState(g, me, other);
  switch (r.rel) {
    case 'active': {
      const wait = Math.max(0, (r.since ?? 0) + minDur - g.tick);
      return { kind: 'break', disabled: wait > 0, reason: wait > 0 ? `성립 후 ${Math.round((minDur * g.config.tickMs) / 1000)}초가 지나야 파기 가능` : null, waitTicks: wait };
    }
    case 'breaking':
      return { kind: 'breaking', breakTicks: Math.max(0, (r.breakAt ?? g.tick) - g.tick) };
    case 'incoming':
      return { kind: 'respond', proposalId: r.proposalId!, expireTicks: Math.max(0, (r.expire ?? g.tick) - g.tick) };
    case 'outgoing':
      return { kind: 'outgoing', expireTicks: Math.max(0, (r.expire ?? g.tick) - g.tick) };
    default: {
      const myAllies = [...g.alliances.values()].filter((a) => a.a === me || a.b === me).length;
      const frozen = g.allianceFreezeUntilTick !== null && g.tick < g.allianceFreezeUntilTick;
      const reason = g.tick >= cutoff ? '신규 동맹 마감됨' : frozen ? '동맹 재체결 금지 기간' : myAllies >= maxAllies ? `동맹은 최대 ${maxAllies}개` : null;
      return { kind: 'propose', disabled: reason !== null, reason };
    }
  }
}

// ───────────────────────── 플레이어 정보 카드 ─────────────────────────

export interface CardBase {
  tileId: number;
  name: string | null;
  capital: boolean;
  hpPct: number;
  /** 생산력 % (서버가 안 보냈으면 null) */
  prodPct: number | null;
}

export interface CardAlly {
  id: number;
  name: string;
  /** 해제 중이면 남은 tick */
  breakingTicks: number | null;
}

export interface PlayerCardData {
  id: number;
  name: string;
  kind: 'player' | 'bot';
  relation: Relation | null;
  alive: boolean;
  connected: boolean;
  share: number;
  tiles: number;
  troops: number;
  troopCap: number;
  troopRate: number | null;
  gold: number;
  goldNet: number | null;
  techCount: number;
  bases: CardBase[];
  allies: CardAlly[];
  /** 동맹 파기 횟수 (§23 allyBreaks — 서버가 아직 안 보내면 null = 표시 안 함) */
  allyBreaks: number | null;
}

/**
 * §23 allyBreaks 를 방어적으로 읽는다: 숫자면 그대로, 배열이면 길이, 없거나 다른 모양이면 null.
 * (백엔드가 §23 을 추가하는 중 — 필드가 없을 때 줄을 숨긴다)
 */
export function allyBreaksOf(p: PlayerSnapshot | undefined): number | null {
  const v = (p as (PlayerSnapshot & { allyBreaks?: unknown }) | undefined)?.allyBreaks;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (Array.isArray(v)) return v.length;
  return null;
}

export function playerCardData(g: GameModel, id: number, me: number | null, names: PlayerNames): PlayerCardData | null {
  const p = g.players.get(id);
  if (!p) return null;
  const inc = incomeOf(g, id);
  const bases: CardBase[] = [];
  for (const b of g.bases.values()) {
    if (b.ownerId !== id) continue;
    const pm = g.baseProdPm(b.tileId);
    bases.push({ tileId: b.tileId, name: g.baseNames.get(b.tileId) ?? null, capital: g.capitalTiles.has(b.tileId), hpPct: Math.round(b.hpPct), prodPct: pm === null ? null : Math.floor(pm / 10) });
  }
  bases.sort((a, b) => Number(b.capital) - Number(a.capital) || (b.prodPct ?? 0) - (a.prodPct ?? 0) || a.tileId - b.tileId);
  const allies: CardAlly[] = [];
  for (const a of g.alliances.values()) {
    if (a.a !== id && a.b !== id) continue;
    const other = a.a === id ? a.b : a.a;
    allies.push({ id: other, name: names.nick(other), breakingTicks: a.state === 'BREAKING' && a.breakAtTick !== null ? Math.max(0, a.breakAtTick - g.tick) : null });
  }
  allies.sort((x, y) => x.id - y.id);
  return {
    id,
    name: names.nick(id),
    kind: names.isBot(id) ? 'bot' : 'player',
    relation: relationTo(g, me, id),
    alive: p.alive,
    connected: p.connected,
    share: sharePct(g, p.tiles),
    tiles: p.tiles,
    troops: p.troops,
    troopCap: g.troopCapOf(p),
    troopRate: inc?.troops ?? null,
    gold: p.gold,
    goldNet: inc?.net ?? null,
    techCount: p.techCount,
    bases,
    allies,
    allyBreaks: allyBreaksOf(p),
  };
}
