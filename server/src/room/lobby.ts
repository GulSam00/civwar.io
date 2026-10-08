/**
 * 로비 매니저 — 세션·룸 인덱스, 공개 대기열, 방 코드.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { ROOM_CODE_LENGTH, type ErrorCode } from '@civwar/shared';
import { IdleBot, type BotBrain } from '../game/tick.js';
import { Room } from './room.js';
import { Session } from './session.js';

/** 공개 룸 기본 인원 (GDD에 없음 — 기본 맵 10인 기준으로 임의 결정) */
export const PUBLIC_ROOM_TARGET_PLAYERS = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I 제외

export interface LobbyOptions {
  /** 고정 시드(테스트·재현용). 없으면 crypto 난수 */
  seed?: number;
  brain?: BotBrain;
}

export class LobbyManager {
  readonly sessionsById = new Map<string, Session>();
  readonly sessionsByToken = new Map<string, Session>();
  readonly rooms = new Map<string, Room>();
  readonly roomsByCode = new Map<string, Room>();
  private roomSeq = 0;
  private seedCounter: number | undefined;

  constructor(private readonly opts: LobbyOptions = {}) {
    this.seedCounter = opts.seed;
  }

  createSession(nickname: string): Session {
    const id = 's_' + randomBytes(6).toString('hex');
    const token = randomBytes(18).toString('base64url');
    const s = new Session(id, token, nickname);
    this.sessionsById.set(id, s);
    this.sessionsByToken.set(token, s);
    return s;
  }

  dropSession(s: Session): void {
    this.sessionsById.delete(s.id);
    this.sessionsByToken.delete(s.token);
  }

  roomOf(s: Session): Room | undefined {
    return s.roomId ? this.rooms.get(s.roomId) : undefined;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.roomsByCode.has(c)) return c;
    }
  }

  private nextSeed(): number {
    if (this.seedCounter !== undefined) return this.seedCounter++ >>> 0;
    return randomInt(0, 0xffffffff);
  }

  createRoom(isPublic: boolean, targetPlayers: number): Room {
    const id = `r${++this.roomSeq}`;
    const room = new Room(
      id,
      this.newCode(),
      isPublic,
      targetPlayers,
      {
        onDispose: (r) => {
          this.rooms.delete(r.id);
          this.roomsByCode.delete(r.code);
          // 소켓이 없는 세션은 룸과 함께 소멸
          for (const m of r.members.values()) if (m.session && !m.session.socket) this.dropSession(m.session);
        },
        nextSeed: () => this.nextSeed(),
      },
      this.opts.brain ?? IdleBot,
    );
    this.rooms.set(id, room);
    this.roomsByCode.set(room.code, room);
    return room;
  }

  private leaveCurrent(s: Session): void {
    const r = this.roomOf(s);
    if (r) r.leave(s);
  }

  joinPublic(s: Session): ErrorCode | null {
    if (this.blockedByActiveGame(s)) return 'ALREADY_IN_ROOM';
    this.leaveCurrent(s);
    let room: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.isPublic && r.phase === 'LOBBY' && r.hasFreeSlot) {
        room = r; // Map 삽입 순서 = 오래된 룸 우선
        break;
      }
    }
    room ??= this.createRoom(true, PUBLIC_ROOM_TARGET_PLAYERS);
    return room.join(s);
  }

  createPrivate(s: Session, targetPlayers: number): ErrorCode | null {
    if (this.blockedByActiveGame(s)) return 'ALREADY_IN_ROOM';
    this.leaveCurrent(s);
    return this.createRoom(false, targetPlayers).join(s);
  }

  joinPrivate(s: Session, code: string): ErrorCode | null {
    const room = this.roomsByCode.get(code);
    if (!room) return 'ROOM_NOT_FOUND';
    if (room.id === s.roomId) return 'ALREADY_IN_ROOM';
    if (this.blockedByActiveGame(s)) return 'ALREADY_IN_ROOM';
    if (room.phase !== 'LOBBY') return 'ROOM_IN_PROGRESS';
    if (!room.hasFreeSlot) return 'ROOM_FULL';
    this.leaveCurrent(s);
    return room.join(s);
  }

  spectate(s: Session, code: string): ErrorCode | null {
    const room = this.roomsByCode.get(code);
    if (!room) return 'ROOM_NOT_FOUND';
    if (this.blockedByActiveGame(s)) return 'ALREADY_IN_ROOM';
    if (room.phase !== 'IN_GAME' && room.phase !== 'GAME_OVER') return 'NOT_LOBBY';
    this.leaveCurrent(s);
    return room.spectate(s);
  }

  /** 살아 있는 플레이어로 진행 중인 게임에 속해 있으면 다른 룸으로 못 간다 (lobby_leave 먼저) */
  private blockedByActiveGame(s: Session): boolean {
    const r = this.roomOf(s);
    if (!r || r.phase !== 'IN_GAME' || s.spectator || s.playerId === null) return false;
    const p = r.sim?.state.players[s.playerId];
    return !!p && p.alive;
  }

  shutdown(): void {
    for (const r of [...this.rooms.values()]) r.dispose();
  }
}
