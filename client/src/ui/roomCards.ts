/**
 * 로비 공개 방 카드 (2026-10-18 UI 개선 7 — OpenFront.io 참고) — room_list.rooms[] 한 항목을 카드 표시값으로.
 * 프로토콜 RoomListing 필드만 쓴다. §26.1 botDifficulty 는 서버가 모든 방·모든 단계에 싣는다(타입이 옵셔널인 것은 옛 픽스처 호환 — 없으면 태그 숨김).
 * §26.2 thumbnail = 진행 중·종료된 무작위 맵 방의 실제 축소 지형 (대기·카운트다운·공식 맵 방은 null).
 */
import type { BotDifficultyName, MapThumbnail, OfficialMapInfo, RoomListing } from '@civwar/shared';
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
  /** 봇 난이도 표시 이름 (§26.1 — "쉬움"/"보통"/"어려움"). 필드가 없으면 null */
  difficulty: string | null;
  /** 난이도 원값 (태그 색) */
  difficultyCode: BotDifficultyName | null;
  /** §26.2 무작위 맵 실제 축소 지형 (공식 맵 방이거나 맵 생성 전이면 null) */
  thumbnail: MapThumbnail | null;
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
  const diff = r.botDifficulty ?? null;
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
    difficulty: diff ? (DIFFICULTY_NAME[diff] ?? diff) : null,
    difficultyCode: diff,
    thumbnail: preset ? null : (r.thumbnail ?? null),
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
