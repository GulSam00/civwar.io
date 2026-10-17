/**
 * 로비 공개 방 카드 (2026-10-18 UI 개선 7 — OpenFront.io 참고) — room_list.rooms[] 한 항목을 카드 표시값으로.
 * 프로토콜 RoomListing 필드만 쓴다. botDifficulty 는 RoomListing 에 없어(§2 room_list) 서버가 실어 보낼 때만 보인다.
 */
import type { BotDifficultyName, OfficialMapInfo, RoomListing } from '@civwar/shared';
import { fmtClock } from './text.js';

export const SIZE_NAME: Record<string, string> = { S: '작음', M: '보통', L: '큼' };
export const DIFFICULTY_NAME: Record<string, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };

export type RoomCardStatus = 'waiting' | 'starting' | 'live' | 'over';
export const ROOM_STATUS_NAME: Record<RoomCardStatus, string> = { waiting: '대기', starting: '곧 시작', live: '진행 중', over: '종료' };

export interface RoomCard {
  roomId: string;
  title: string;
  /** 공식 맵이면 맵 id (썸네일), 무작위면 null */
  presetId: string | null;
  checksum: string | undefined;
  width: number;
  height: number;
  /** "100×60 · 보통" */
  sizeText: string;
  /** 사람 + 봇 / 최대 */
  players: number;
  maxPlayers: number;
  humans: number;
  bots: number;
  spectators: number;
  status: RoomCardStatus;
  /** "12초 후 시작" · "진행 4:31" · null */
  timeText: string | null;
  /** 봇 난이도 (서버가 목록에 실어 보낼 때만 — 지금 프로토콜에는 없다) */
  difficulty: string | null;
  joinable: boolean;
  spectatable: boolean;
}

/** ageMs = 목록을 받은 뒤 지난 시간 (남은 초·경과 시간을 로컬로 흘린다) */
export function roomCard(r: RoomListing, ageMs: number, officialMaps: readonly OfficialMapInfo[] = []): RoomCard {
  const preset = r.map.kind === 'preset' ? r.map.mapId : null;
  const info = preset ? officialMaps.find((m) => m.id === preset) : undefined;
  const sizeClass = r.map.kind === 'random' ? r.map.size : info?.sizeClass;
  const title = r.mapName?.ko ?? (r.map.kind === 'random' ? '무작위 맵' : (info?.name.ko ?? r.map.mapId));
  const status: RoomCardStatus = r.phase === 'LOBBY' ? 'waiting' : r.phase === 'COUNTDOWN' ? 'starting' : r.phase === 'IN_GAME' ? 'live' : 'over';
  let timeText: string | null = null;
  if (status === 'waiting' && r.autoStartMs !== null) timeText = `${Math.max(0, Math.ceil((r.autoStartMs - ageMs) / 1000))}초 후 시작`;
  else if (status === 'live') timeText = `진행 ${fmtClock(r.elapsedMs + ageMs)}`;
  else if (status === 'over') timeText = `${fmtClock(r.elapsedMs)} 진행`;
  const diff = (r as RoomListing & { botDifficulty?: BotDifficultyName }).botDifficulty;
  return {
    roomId: r.roomId,
    title,
    presetId: preset,
    width: r.width,
    height: r.height,
    checksum: info?.checksum,
    sizeText: `${r.width}×${r.height}${sizeClass ? ` · ${SIZE_NAME[sizeClass] ?? sizeClass}` : ''}`,
    players: r.humans + r.bots,
    maxPlayers: r.maxPlayers,
    humans: r.humans,
    bots: r.bots,
    spectators: r.spectatorCount,
    status,
    timeText,
    difficulty: typeof diff === 'string' ? (DIFFICULTY_NAME[diff] ?? diff) : null,
    joinable: r.joinable,
    spectatable: r.spectatable,
  };
}

/** 무작위 맵 썸네일용 시드 (방 id → 32비트) — 같은 방은 늘 같은 그림 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
