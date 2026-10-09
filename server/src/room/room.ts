/**
 * 룸 — 로비 / 카운트다운 / 인게임 / 게임 종료 (GDD 7.1).
 * 방마다 독립된 tick 루프(Simulation)와 멤버 목록을 가진다.
 */
import {
  EMOTE_CODE_MAX,
  LOBBY_COUNTDOWN_MS,
  MAX_COMMANDS_PER_TICK,
  PUBLIC_LOBBY_AUTOSTART_MS,
  ROOM_CLOSE_AFTER_GAME_MS,
  TICK_MS,
  type C2S_GameCommand,
  type ErrorCode,
  type MemberStatus,
  type RoomMember,
  type RoomPhase,
  type S2C_RoomState,
  type ServerMessage,
} from '@civwar/shared';
import { generateMapForSize, type GeneratedMap } from '../map/generate.js';
import { mapFromPreset, type MapCatalog } from '../map/presets.js';
import { applyRoomOptions, mapLimits, plannedPlayers, settingsEcho, type RoomSettings } from './settings.js';
import type { Outbox } from '../game/outbox.js';
import { buildMapInit, buildMatchConfig, buildSnapshotFull } from '../game/snapshot.js';
import { createGameState } from '../game/state.js';
import { CivBot } from '../game/bot.js';
import { Simulation, type BotBrain } from '../game/tick.js';
import type { Session } from './session.js';

export interface Member {
  playerId: number;
  session: Session | null; // 봇이면 null
  nickname: string;
  isBot: boolean;
  ready: boolean;
}

export interface RoomHooks {
  /** 룸이 정리될 때 (LobbyManager 가 인덱스에서 제거) */
  onDispose(room: Room): void;
  /** 맵 시드 결정 (테스트에서 고정 가능) */
  nextSeed(): number;
}

export class Room {
  phase: RoomPhase = 'LOBBY';
  hostId: number | null = null;
  readonly members = new Map<number, Member>();
  readonly spectators = new Set<Session>();
  sim: Simulation | null = null;
  private countdownEndsAt: number | null = null;
  /** 공개 룸 자동 시작 예정 시각 (Date.now 기준). 비공개 룸은 null — room_state.autoStartMs (프론트 2차 추가) */
  private autoStartAt: number | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private loopStart = 0;
  private disposed = false;

  constructor(
    readonly id: string,
    readonly code: string,
    readonly isPublic: boolean,
    /** v4.1 방 설정 (2.8). 비공개 방은 방장이 LOBBY 중 lobby_update_settings 로 바꾼다 */
    public settings: RoomSettings,
    private readonly catalog: MapCatalog,
    private readonly hooks: RoomHooks,
    private readonly brain: BotBrain = CivBot,
  ) {
    if (isPublic) {
      this.autoStartAt = Date.now() + PUBLIC_LOBBY_AUTOSTART_MS;
      this.later(PUBLIC_LOBBY_AUTOSTART_MS, () => this.phase === 'LOBBY' && this.startCountdown());
    }
  }

  // ───────────────────────── 조회 ─────────────────────────

  get humanCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (!m.isBot && m.session) n++;
    return n;
  }
  get hasFreeSlot(): boolean {
    return this.members.size < this.settings.maxPlayers;
  }
  memberOf(session: Session): Member | undefined {
    return session.playerId !== null ? this.members.get(session.playerId) : undefined;
  }

  private statusOf(m: Member): MemberStatus {
    if (this.phase === 'LOBBY' || this.phase === 'COUNTDOWN') return 'LOBBY_WAITING';
    const p = this.sim?.state.players[m.playerId];
    if (p && !p.alive) return 'ELIMINATED_SPECTATING';
    if (!m.isBot && !m.session?.socket) return 'DISCONNECTED';
    return 'PLAYING';
  }

  roomState(): S2C_RoomState {
    const players: RoomMember[] = [...this.members.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map((m) => ({
        playerId: m.playerId,
        sessionId: m.session?.id ?? null,
        nickname: m.nickname,
        isBot: m.isBot,
        isHost: m.playerId === this.hostId,
        ready: m.ready,
        status: this.statusOf(m),
      }));
    return {
      type: 'room_state',
      roomId: this.id,
      roomCode: this.code,
      isPublic: this.isPublic,
      phase: this.phase,
      hostId: this.hostId,
      settings: settingsEcho(this.settings, this.catalog, this.lobbyHumanCount(), this.isPublic),
      players,
      spectatorCount: this.spectators.size,
      countdownMs: this.countdownEndsAt !== null ? Math.max(0, this.countdownEndsAt - Date.now()) : null,
      autoStartMs: this.isPublic && this.phase === 'LOBBY' && this.autoStartAt !== null ? Math.max(0, this.autoStartAt - Date.now()) : null,
    };
  }

  // ───────────────────────── 송신 ─────────────────────────

  private recipients(): Session[] {
    const out: Session[] = [];
    for (const m of this.members.values()) if (m.session?.socket) out.push(m.session);
    for (const s of this.spectators) if (s.socket) out.push(s);
    return out;
  }
  broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const s of this.recipients()) s.sendRaw(raw);
  }
  broadcastRoomState(): void {
    this.broadcast(this.roomState());
  }
  /**
   * QA m-5: 개인 메시지(cmd_ack — 1단계 산출)를 그 tick 의 방송(이벤트 → delta → full → game_over)보다 먼저 보낸다.
   * → game_over 가 그 tick 의 마지막 메시지, cmd_ack(flagId) 이 같은 tick 의 flag_issued 보다 먼저 온다.
   * QA m-10: 봇 명령(connId 0)의 ack 은 배달하지 않는다.
   */
  private deliver(out: Outbox): void {
    for (const { playerId, msg, fromBot } of out.personal) if (!fromBot) this.members.get(playerId)?.session?.send(msg);
    for (const msg of out.broadcast) this.broadcast(msg);
  }

  // ───────────────────────── 로비 ─────────────────────────

  /** 성공 시 null, 실패 시 오류 코드 */
  join(session: Session): ErrorCode | null {
    if (this.phase !== 'LOBBY') return 'ROOM_IN_PROGRESS';
    if (!this.hasFreeSlot) return 'ROOM_FULL';
    let pid = 1;
    while (this.members.has(pid)) pid++;
    this.members.set(pid, { playerId: pid, session, nickname: session.nickname, isBot: false, ready: false });
    session.roomId = this.id;
    session.playerId = pid;
    session.spectator = false;
    if (this.hostId === null) this.hostId = pid;
    this.broadcastRoomState();
    // 공개 방만 정원 도달 시 자동 시작 (2.8 h). 비공개 방은 방장 lobby_start_now 로만 시작
    if (this.isPublic && this.members.size >= this.settings.maxPlayers) this.startCountdown();
    return null;
  }

  /** 사람 수 (봇 슬롯 제외) */
  private lobbyHumanCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (!m.isBot) n++;
    return n;
  }

  /** v4.1 lobby_update_settings — 방장·LOBBY·비공개 방만 (7.2a) */
  updateSettings(session: Session, raw: Record<string, unknown>): { code: ErrorCode; message: string } | null {
    const m = this.memberOf(session);
    if (!m) return { code: 'NOT_IN_ROOM', message: 'not in a room' };
    if (m.playerId !== this.hostId) return { code: 'NOT_HOST', message: 'host only' };
    if (this.phase !== 'LOBBY') return { code: 'NOT_LOBBY', message: 'lobby only' };
    if (this.isPublic) return { code: 'BAD_ROOM_OPTIONS', message: 'public room settings are fixed' };
    const r = applyRoomOptions(raw, this.settings, this.catalog, this.lobbyHumanCount(), false);
    if (!r.ok) return { code: r.code, message: r.message };
    this.settings = r.settings;
    this.broadcastRoomState();
    return null;
  }

  spectate(session: Session): ErrorCode | null {
    if (this.phase !== 'IN_GAME' && this.phase !== 'GAME_OVER') return 'NOT_LOBBY';
    this.spectators.add(session);
    session.roomId = this.id;
    session.playerId = null;
    session.spectator = true;
    session.send(this.roomState());
    this.sendGameBootstrap(session);
    this.broadcastRoomState();
    return null;
  }

  /** 명시적 퇴장 (lobby_leave / 다른 룸 입장) */
  leave(session: Session): void {
    if (session.spectator) {
      this.spectators.delete(session);
    } else {
      const m = this.memberOf(session);
      if (m) {
        if (this.phase === 'LOBBY') {
          this.members.delete(m.playerId);
        } else if (this.phase === 'COUNTDOWN') {
          m.session = null; // 자리는 봇으로
          m.isBot = true;
          m.nickname = `BOT ${m.playerId}`;
        } else {
          this.markDisconnected(m);
          m.session = null;
        }
        if (this.hostId === m.playerId) this.reassignHost();
      }
    }
    session.roomId = null;
    session.playerId = null;
    session.spectator = false;
    // 붙어 있는 세션(접속 끊김 포함)이 하나도 없으면 정리. 끊긴 세션은 재접속을 위해 남아 있다
    const anyAttached = [...this.members.values()].some((x) => x.session !== null) || this.spectators.size > 0;
    if (!anyAttached) {
      this.dispose();
      return;
    }
    this.broadcastRoomState();
  }

  /** 소켓 끊김. 로비·카운트다운은 퇴장 처리, 인게임은 자리 유지 (GDD 7.1) */
  onSocketClosed(session: Session): void {
    if (session.spectator || this.phase === 'LOBBY' || this.phase === 'COUNTDOWN' || this.phase === 'GAME_OVER') {
      this.leave(session);
      return;
    }
    const m = this.memberOf(session);
    if (m) this.markDisconnected(m);
    this.broadcastRoomState();
  }

  private markDisconnected(m: Member): void {
    const p = this.sim?.state.players[m.playerId];
    if (p && p.connected) {
      p.connected = false;
      p.disconnectedSinceTick = this.sim!.state.tick;
    }
  }

  /** 같은 playerToken 으로 재접속 */
  onResume(session: Session): void {
    if (this.phase !== 'IN_GAME' && this.phase !== 'GAME_OVER') {
      session.send(this.roomState());
      return;
    }
    // QA m-7: 플래그를 먼저 바꿔 부트스트랩 snapshot_full 에 본인 connected=true 가 담기게 한다
    const m = this.memberOf(session);
    const p = m && this.sim?.state.players[m.playerId];
    const reconnected = !!p && !p.connected;
    if (p && reconnected) {
      p.connected = true;
      p.disconnectedSinceTick = null;
      if (!p.isBot) p.botControlled = false; // 인계 후 복귀해도 조종권 반환 (백엔드 결정)
    }
    session.send(this.roomState());
    this.sendGameBootstrap(session);
    if (p && reconnected) this.broadcast({ type: 'player_reconnected', tick: this.sim!.state.tick, playerId: p.id });
    this.broadcastRoomState();
  }

  setReady(session: Session, ready: boolean): ErrorCode | null {
    const m = this.memberOf(session);
    if (!m) return 'NOT_IN_ROOM';
    if (this.phase !== 'LOBBY') return 'NOT_LOBBY';
    m.ready = ready;
    this.broadcastRoomState(); // v4.1: 준비 완료는 표시용 — 자동 시작 조건이 아니다 (2.8 h)
    return null;
  }

  startNow(session: Session): ErrorCode | null {
    const m = this.memberOf(session);
    if (!m) return 'NOT_IN_ROOM';
    // QA m-6: 공개 방은 방장 권한이 없다 (정원 도달 또는 30초 자동 시작만 — GDD 2.8 h)
    if (this.isPublic || m.playerId !== this.hostId) return 'NOT_HOST';
    if (this.phase !== 'LOBBY') return 'NOT_LOBBY';
    return this.startCountdown();
  }

  private reassignHost(): void {
    this.hostId = null;
    for (const m of [...this.members.values()].sort((a, b) => a.playerId - b.playerId)) {
      if (!m.isBot && m.session) {
        this.hostId = m.playerId;
        return;
      }
    }
  }

  /**
   * 카운트다운 시작 — 인원 확정.
   * 공개 방: 1..maxPlayers 빈 번호를 봇으로 채운다. 비공개 방: 사람을 1..H 로 다시 번호 매기고(빈 번호 제거)
   * 봇 min(botCount, maxPlayers - H) 개를 H+1.. 에 붙인다. 시작 인원 < 맵 최소(2) 면 NOT_ENOUGH_PLAYERS.
   */
  startCountdown(): ErrorCode | null {
    if (this.phase !== 'LOBBY' || this.disposed) return 'NOT_LOBBY';
    const humans = [...this.members.values()].filter((x) => !x.isBot).sort((a, b) => a.playerId - b.playerId);
    const plan = plannedPlayers(this.settings, humans.length, this.isPublic);
    if (plan.total < mapLimits(this.settings.map, this.catalog).min) return 'NOT_ENOUGH_PLAYERS';
    if (this.isPublic) {
      for (let pid = 1; pid <= this.settings.maxPlayers; pid++) {
        if (!this.members.has(pid)) this.members.set(pid, { playerId: pid, session: null, nickname: `BOT ${pid}`, isBot: true, ready: true });
      }
    } else {
      const hostMember = this.hostId !== null ? this.members.get(this.hostId) : undefined;
      this.members.clear();
      humans.forEach((m, i) => {
        m.playerId = i + 1;
        if (m.session) m.session.playerId = m.playerId;
        this.members.set(m.playerId, m);
      });
      this.hostId = hostMember ? hostMember.playerId : null;
      for (let pid = humans.length + 1; pid <= plan.total; pid++) {
        this.members.set(pid, { playerId: pid, session: null, nickname: `BOT ${pid}`, isBot: true, ready: true });
      }
    }
    this.phase = 'COUNTDOWN';
    this.countdownEndsAt = Date.now() + LOBBY_COUNTDOWN_MS;
    this.broadcastRoomState();
    this.later(LOBBY_COUNTDOWN_MS, () => this.beginGame());
    return null;
  }

  /** 카운트다운 종료 시점(인원 확정 후) 맵 생성 — 2.8 (c) */
  private buildMap(N: number): GeneratedMap {
    const m = this.settings.map;
    if (m.kind === 'preset') return mapFromPreset(this.catalog.get(m.mapId)!, N);
    return generateMapForSize(this.hooks.nextSeed(), m.size, N, m.water);
  }

  // ───────────────────────── 인게임 ─────────────────────────

  private sendGameBootstrap(session: Session): void {
    if (!this.sim) return;
    const st = this.sim.state;
    session.send(buildMatchConfig(st));
    session.send(buildMapInit(st));
    session.send(buildSnapshotFull(st));
  }

  private beginGame(): void {
    if (this.phase !== 'COUNTDOWN' || this.disposed) return;
    const map = this.buildMap(this.members.size);
    const setup = [...this.members.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map((m) => ({ playerId: m.playerId, isBot: m.isBot, connected: m.isBot || !!m.session?.socket }));
    // 봇 성향 시드 = 룸 맵 시드. 프리셋 맵은 시드가 파일 고정이라 룸 시드를 따로 뽑는다
    const aggressionSeed = this.settings.map.kind === 'preset' ? this.hooks.nextSeed() : map.seed;
    const state = createGameState(map, setup, this.settings.botDifficulty, aggressionSeed);
    for (const s of setup) {
      if (!s.connected) state.players[s.playerId].disconnectedSinceTick = 0;
    }
    this.sim = new Simulation(state, this.brain);
    this.phase = 'IN_GAME';
    this.countdownEndsAt = null;
    this.broadcastRoomState();
    this.broadcast(buildMatchConfig(state));
    this.broadcast(buildMapInit(state));
    this.broadcast(buildSnapshotFull(state));
    this.loopStart = Date.now();
    this.scheduleTick();
  }

  /** 드리프트 보정 고정 간격 루프: t번째 tick 은 loopStart + t × TICK_MS 에 실행 */
  private scheduleTick(): void {
    if (!this.sim || this.disposed) return;
    const due = this.loopStart + (this.sim.state.tick + 1) * TICK_MS;
    this.tickTimer = setTimeout(() => this.runTick(), Math.max(0, due - Date.now()));
  }

  private runTick(): void {
    if (!this.sim || this.disposed) return;
    for (const m of this.members.values()) if (m.session) m.session.cmdCount = 0;
    const out = this.sim.step();
    this.deliver(out);
    const needRoomState = out.broadcast.some((m) => m.type === 'player_eliminated' || m.type === 'bot_takeover');
    if (this.sim.finished) {
      // QA m-9: 종료 뒤 큐에 남은 사람 명령에도 ack 1회 (NOT_IN_GAME)
      for (const { playerId, msg } of this.sim.flushPending()) this.members.get(playerId)?.session?.send(msg);
      this.phase = 'GAME_OVER';
      this.broadcastRoomState();
      this.later(ROOM_CLOSE_AFTER_GAME_MS, () => this.dispose());
      return;
    }
    if (needRoomState) this.broadcastRoomState();
    this.scheduleTick();
  }

  /** cmd_* 수신 — 형식 검증은 끝난 상태. 게임 규칙 검증은 tick 1단계 */
  submitCommand(session: Session, msg: C2S_GameCommand): void {
    const m = this.memberOf(session);
    const reject = (reason: 'NOT_IN_GAME' | 'RATE_LIMITED') =>
      session.send({ type: 'cmd_ack', clientSeq: msg.clientSeq, accepted: false, reason });
    if (!m || this.phase !== 'IN_GAME' || !this.sim) return reject('NOT_IN_GAME');
    if (++session.cmdCount > MAX_COMMANDS_PER_TICK) return reject('RATE_LIMITED');
    this.sim.enqueue(session.connId, m.playerId, msg);
  }

  emote(session: Session, code: number): void {
    const m = this.memberOf(session);
    if (!m || this.phase !== 'IN_GAME' || !this.sim) return;
    if (!Number.isInteger(code) || code < 0 || code > EMOTE_CODE_MAX) return;
    const now = Date.now();
    if (now - session.lastEmoteAt < 1000) return;
    session.lastEmoteAt = now;
    this.broadcast({ type: 'emote_broadcast', tick: this.sim.state.tick, playerId: m.playerId, code });
  }

  get currentTick(): number {
    return this.sim?.state.tick ?? 0;
  }

  // ───────────────────────── 정리 ─────────────────────────

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    if (this.tickTimer) clearTimeout(this.tickTimer);
    for (const m of this.members.values()) {
      if (m.session && m.session.roomId === this.id) {
        m.session.roomId = null;
        m.session.playerId = null;
      }
    }
    for (const s of this.spectators) if (s.roomId === this.id) s.roomId = null;
    this.hooks.onDispose(this);
  }
}

