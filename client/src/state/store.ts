/**
 * 클라이언트 스토어 — 연결 · 세션(토큰) · 로비/룸 · 게임 모델 · 명령(clientSeq/cmd_ack) · 토스트.
 *
 * React 와의 경계: 로비 수준 변화(연결·room_state·토스트 등)는 subscribe 리스너로 알린다.
 * 인게임 상태(GameModel)는 메시지마다 리스너를 부르지 않는다 — Canvas 는 rAF 에서, HUD 는 짧은 주기로 읽는다.
 * (렌더 루프와 상태 갱신 분리: WS 수신 즉시 React 렌더를 일으키지 않는다)
 */
import {
  POSTURE,
  PROTOCOL_VERSION,
  type C2S_GameCommand,
  type ClientMessage,
  type OfficialMapInfo,
  type Posture,
  type RoomOptions,
  type S2C_RoomList,
  type S2C_RoomState,
  type ServerMessage,
  type Unit,
} from '@civwar/shared';
import { GameSocket, type ConnState } from '../net/socket.js';
import { GameModel } from './gameModel.js';
import { describeEvent, type FeedEntry } from './feed.js';
import { ERROR_TEXT, REJECT_TEXT } from '../ui/text.js';

/** §26.3 세션당 1초 1회 (서버 제한과 같다 — 대상·비대상 공유) */
export const EMOTE_COOLDOWN_MS = 1000;
/** 화면에 띄우는 최근 이모트. targetPlayerId 는 대상 이모트일 때만 */
export interface EmoteShown {
  playerId: number;
  code: number;
  at: number;
  targetPlayerId?: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
  until: number;
}

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

interface PendingCmd {
  type: C2S_GameCommand['type'];
  sentAt: number;
  /** cmd_buy_tech 의 노드 id (테크 창 "구매 요청 중" 상태) */
  nodeId?: number;
}

/** cmd_ack 를 이 시간 넘게 못 받으면 "요청 중" 표시를 접는다 (끊김 등) */
const PENDING_TECH_MS = 5000;

/** 테크 구매 거절 문구 (테크 창 토스트 — 공용 REJECT_TEXT 보다 구체적으로) */
export const TECH_REJECT_TEXT: Partial<Record<string, string>> = {
  INSUFFICIENT: '골드가 부족합니다',
  PREREQ_MISSING: '선행 노드를 먼저 사야 합니다',
  ALREADY_OWNED: '이미 보유한 노드입니다',
  BAD_REQUEST: '잘못된 테크 요청입니다',
};

const LS_TOKEN = 'civwar.playerToken';
const LS_NICK = 'civwar.nickname';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class ClientStore {
  conn: ConnState = 'idle';
  nickname = '';
  sessionId: string | null = null;
  playerToken: string | null = null;
  helloSent = false;
  welcomed = false;
  private wantHello = false;
  officialMaps: OfficialMapInfo[] = [];
  /** 연결이 끊겼다가 복구 중인지 (UI 배너) */
  reconnecting = false;
  /** 다른 탭에서 같은 세션을 이어받아 이 탭은 끊김 */
  kicked = false;

  room: S2C_RoomState | null = null;
  game: GameModel | null = null;
  /** 관전 입장 여부 (players 에 내 세션이 없음) */
  spectating = false;

  toasts: Toast[] = [];
  private toastSeq = 0;
  private clientSeq = 0;
  readonly pending = new Map<number, PendingCmd>();
  /** welcome 전에 요청된 로비 동작 (hello → welcome 후 송신) */
  private queued: ClientMessage[] = [];

  /** 개발/헤드리스: 룸 snapshot_full 직전 모델과의 차이 검사 */
  reconCheck = false;
  reconStats = { fulls: 0, mismatchedFulls: 0, samples: [] as string[] };

  /** 로비 수준 변경 리스너 (React useSyncExternalStore) */
  private listeners = new Set<() => void>();
  /** 메시지 단위 관찰자 (이벤트 피드·테스트) */
  private msgObservers = new Set<(m: ServerMessage) => void>();
  private snapshotVersion = 0;

  private socket: GameSocket;

  constructor(
    url: string,
    private readonly storage: KeyValueStorage | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.socket = new GameSocket(url, {
      onOpen: () => this.onOpen(),
      onMessage: (m) => this.onMessage(m),
      onClose: (code, willRetry) => this.onClose(code, willRetry),
    });
    this.playerToken = storage?.getItem(LS_TOKEN) ?? null;
    this.nickname = storage?.getItem(LS_NICK) ?? '';
  }

  // ───────────── React 연결 ─────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.snapshotVersion;
  private emit(): void {
    this.snapshotVersion++;
    for (const fn of this.listeners) fn();
  }
  observe(fn: (m: ServerMessage) => void): () => void {
    this.msgObservers.add(fn);
    return () => this.msgObservers.delete(fn);
  }

  // ───────────── 연결 ─────────────

  /** 페이지 로드 시: 저장된 토큰+닉네임이 있으면 바로 hello 로 복구 시도 */
  start(): void {
    this.conn = 'connecting';
    this.socket.connect();
    this.emit();
  }

  stop(): void {
    this.socket.close();
  }

  private onOpen(): void {
    this.conn = 'open';
    this.helloSent = false;
    this.welcomed = false;
    // 재접속(토큰 보유) 이거나 이미 닉네임을 정했고 동작이 대기 중이면 즉시 hello
    if (this.nickname && (this.playerToken || this.queued.length > 0 || this.wantHello)) this.sendHello();
    this.emit();
  }

  private onClose(code: number, willRetry: boolean): void {
    this.conn = 'closed';
    this.helloSent = false;
    this.welcomed = false;
    this.reconnecting = willRetry && this.playerToken !== null;
    if (code === 4000) {
      this.kicked = true;
      this.toast('다른 창에서 같은 세션으로 접속해 연결이 끊겼습니다', 'error', 8000);
    }
    // 로비(대기실)에서 끊기면 서버가 즉시 퇴장 처리한다(§3) → 룸 상태를 비운다. 인게임은 재접속으로 복구.
    if (this.room && (this.room.phase === 'LOBBY' || this.room.phase === 'COUNTDOWN')) this.clearRoom();
    this.emit();
  }

  private sendHello(): void {
    if (this.helloSent) return;
    this.helloSent = true;
    this.socket.send({
      type: 'hello',
      nickname: this.nickname || 'player',
      clientVersion: PROTOCOL_VERSION,
      ...(this.playerToken ? { playerToken: this.playerToken } : {}),
    });
  }

  /** 닉네임 확정 (hello 전까지만 바뀐다 — 서버 세션 닉네임은 hello 시점 값) */
  setNickname(nick: string): void {
    this.nickname = nick.trim().slice(0, 16);
    this.storage?.setItem(LS_NICK, this.nickname);
    this.emit();
  }

  /** 로비 동작 송신 — 아직 welcome 전이면 hello 후 보낸다 */
  lobby(msg: ClientMessage): void {
    if (this.welcomed) {
      this.socket.send(msg);
      return;
    }
    this.queued.push(msg);
    if (this.conn === 'open') this.sendHello();
    else if (this.conn !== 'connecting') this.start();
  }

  // ── 방 찾기 (lobby_list_rooms → room_list, 서버 1초 1회 제한) ──
  roomList: S2C_RoomList | null = null;
  roomListAt = 0;
  listRooms(): void {
    if (this.now() - this.lastListReq < 1100) return; // 서버 RATE_LIMITED 회피
    this.lastListReq = this.now();
    this.lobby({ type: 'lobby_list_rooms' });
  }
  private lastListReq = 0;
  joinListed(roomId: string, spectate: boolean): void {
    this.lobby({ type: 'lobby_join_listed', roomId, spectate });
  }

  quickStart(): void {
    this.lobby({ type: 'lobby_join_public' });
  }
  createRoom(opts: RoomOptions): void {
    this.lobby({ type: 'lobby_create_private', ...opts });
  }
  updateSettings(opts: RoomOptions): void {
    this.lobby({ type: 'lobby_update_settings', ...opts });
  }
  joinByCode(code: string): void {
    this.lobby({ type: 'lobby_join_private', roomCode: code.trim().toUpperCase() });
  }
  spectate(code: string): void {
    this.lobby({ type: 'lobby_spectate', roomCode: code.trim().toUpperCase() });
  }
  setReady(ready: boolean): void {
    this.lobby({ type: 'lobby_set_ready', ready });
  }
  startNow(): void {
    this.lobby({ type: 'lobby_start_now' });
  }
  /**
   * 로비로 나가기 (QA J-1). 인게임 생존자는 자리가 끊긴 상태로 남고 90초 뒤 봇이 맡는다(§3 "인게임 lobby_leave" — 재접속 불가).
   * 저장된 토큰을 지워 새로고침해도 이 판으로 돌아가지 않게 한다(다음 룸에 들어가면 다시 저장).
   * 룸이 이미 정리됐을 수 있으므로(종료 60초 뒤 dispose — 통지 없음) 직후의 NOT_IN_ROOM 은 조용히 무시한다(QA m-1).
   */
  leaveRoom(): void {
    if (this.welcomed && this.room) {
      this.socket.send({ type: 'lobby_leave' });
      this.ignoreNotInRoomUntil = this.now() + 5000;
    }
    this.storage?.removeItem(LS_TOKEN);
    this.clearRoom();
    this.emit();
  }
  private ignoreNotInRoomUntil = 0;
  /** 웰컴만 받고 아무 데도 없을 때 (로비 메뉴용) */
  ensureHello(): void {
    if (this.welcomed) return;
    this.wantHello = true;
    if (this.conn === 'open') this.sendHello();
    else if (this.conn !== 'connecting') this.start();
  }

  // ───────────── 게임 명령 ─────────────

  private command(cmd: DistributiveOmit<C2S_GameCommand, 'clientSeq'>): number {
    const clientSeq = ++this.clientSeq;
    const msg = { ...cmd, clientSeq } as C2S_GameCommand;
    if (!this.socket.send(msg)) {
      this.toast('서버와 연결되어 있지 않습니다', 'error');
      return -1;
    }
    this.pending.set(clientSeq, { type: msg.type, sentAt: this.now(), ...(msg.type === 'cmd_buy_tech' ? { nodeId: msg.nodeId } : {}) });
    return clientSeq;
  }
  issueFlag(unit: Unit, troops: number, anchorTileId: number, originBaseTileId: number | null = null): number {
    return this.command({ type: 'cmd_flag_issue', unit, troops, anchorTileId, originBaseTileId });
  }
  /** v4.3: TECH_NODES id */
  buyTech(nodeId: number): number {
    return this.command({ type: 'cmd_buy_tech', nodeId });
  }
  /** cmd_ack 를 기다리는 테크 노드 id (테크 창 "구매 요청 중") */
  pendingTechNodes(): Set<number> {
    const out = new Set<number>();
    const t = this.now();
    for (const p of this.pending.values()) if (p.type === 'cmd_buy_tech' && p.nodeId !== undefined && t - p.sentAt < PENDING_TECH_MS) out.add(p.nodeId);
    // 수락 ack 와 tech_purchased(techMask) 사이 짧은 틈 — 보유가 반영될 때까지 "요청 중" 유지 (보유가 상태 우선순위에서 먼저다)
    for (const [id, at] of this.acceptedTech) if (t - at < PENDING_TECH_MS) out.add(id);
    return out;
  }
  private acceptedTech = new Map<number, number>();
  proposeAlly(targetPlayerId: number): number {
    return this.command({ type: 'cmd_ally_propose', targetPlayerId });
  }
  respondAlly(proposalId: number, accept: boolean): number {
    return this.command({ type: 'cmd_ally_respond', proposalId, accept });
  }
  /**
   * 이모트 (§4 emote — 코드 0..15 의미는 클라이언트 정의, 위반·1초 1회 초과는 서버가 조용히 무시).
   * §26.3: targetPlayerId = 그 플레이어를 향한 이모트 (정보 카드·원형 메뉴). 자기 자신·0 이하는 대상 없음으로 보낸다
   * (서버는 자기 대상을 이모트 전체 무시로 처리하므로). 1초 1회 제한은 대상 유무와 상관없이 하나 — 서버가 조용히
   * 버리기 전에 여기서 막고 토스트로 알린다. 보냈으면 true.
   */
  sendEmote(code: number, targetPlayerId?: number | null): boolean {
    const t = this.now();
    if (t - this.lastEmoteAt < EMOTE_COOLDOWN_MS) {
      this.toast('이모트는 1초에 한 번만 보낼 수 있습니다', 'info', 1500);
      return false;
    }
    const target = typeof targetPlayerId === 'number' && targetPlayerId > 0 && targetPlayerId !== this.myPlayerId ? targetPlayerId : null;
    const sent = this.socket.send(target === null ? { type: 'emote', code } : { type: 'emote', code, targetPlayerId: target });
    if (sent) this.lastEmoteAt = t;
    return sent;
  }
  private lastEmoteAt = -Infinity;
  /** 최근 이모트 (렌더러가 수도 위 말풍선으로 그린다). targetPlayerId = §26.3 대상 이모트 */
  emotes: EmoteShown[] = [];

  breakAlly(allyPlayerId: number): number {
    return this.command({ type: 'cmd_ally_break', allyPlayerId });
  }
  retarget(flagId: number, anchorTileId: number): number {
    return this.command({ type: 'cmd_flag_retarget', flagId, anchorTileId });
  }
  /**
   * 선택 부대 우클릭 = "이동" (2026-10-14 사용자 결정). 내 기지·내 땅 = 그 자리로 가서 방어, 적·중립 = 공격 —
   * 태세는 서버가 도착지로 정한다(cmd_flag_retarget 의 기본 태세 재파생, 프로토콜 §4).
   * 프로토콜 §21.2 표 그대로: 내 기지 칸도 cmd_flag_retarget(회수 아님). v4.6 (§27): 쿨타임이 안 돌면 이동과 함께 태세도 즉시 바뀌고,
   * 쿨타임 중이면 이동만 하고 태세는 그대로(대기·예약 없음) — 응답의 postureHeld 로 알려 준다(notifyPostureHeld). 호출부는 controller.rightClickTile 뿐.
   */
  moveFlag(flagId: number, tileId: number): number {
    return this.retarget(flagId, tileId);
  }
  /**
   * 회수. baseTileId 가 있으면 그 내 기지로 귀환(GDD v4.2 7.2 `cmd_flag_recall{ clientSeq, flagId, baseTileId? }`, A-61).
   * 서버가 이 필드를 아직 모르면 검증기가 버리고 기존 자동 귀환지로 회수한다 — 어느 쪽이든 회수는 된다.
   * (shared 타입에 필드가 생기기 전이라 객체를 넓혀서 보낸다)
   */
  recall(flagId: number, baseTileId?: number): number {
    const cmd: { type: 'cmd_flag_recall'; flagId: number; baseTileId?: number } = { type: 'cmd_flag_recall', flagId };
    if (baseTileId !== undefined) cmd.baseTileId = baseTileId;
    return this.command(cmd);
  }
  setPosture(flagId: number, posture: Posture): number {
    return this.command({ type: 'cmd_set_posture', flagId, posture });
  }

  // ───────────── 파생 ─────────────

  /** 내 게임 내 playerId — room_state.players 에서 sessionId 로 찾는다(§5 welcome). 비공개 방은 카운트다운 때 재번호되므로 매번 찾는다 */
  get myPlayerId(): number | null {
    if (!this.room || !this.sessionId) return null;
    return this.room.players.find((p) => p.sessionId === this.sessionId)?.playerId ?? null;
  }

  /** 관전 중 따라가는 플레이어 (null = 자유 카메라) */
  followPlayerId: number | null = null;
  /** HUD·피드 기준 플레이어: 나, 관전이면 따라가는 플레이어 */
  get viewerId(): number | null {
    // 종료 후 둘러보기: 순위표에서 고른 플레이어의 HUD 를 본다 (플레이어 본인 포함)
    const over = !!this.game?.gameOver || this.room?.phase === 'GAME_OVER';
    if (over && this.followPlayerId !== null) return this.followPlayerId;
    return this.myPlayerId ?? this.followPlayerId;
  }
  setFollow(id: number | null): void {
    this.followPlayerId = id;
    this.emit();
  }
  /** 입력 루프에서 호출 (React 알림은 값이 바뀔 때만) */
  setFollowSilently(id: number | null): void {
    if (this.followPlayerId !== id) this.setFollow(id);
  }

  get isHost(): boolean {
    const me = this.myPlayerId;
    // 플레이테스트 후속: 공개 방도 방장(첫 입장자)이 바로 시작할 수 있다 (설정 변경은 비공개 방만)
    return me !== null && this.room?.hostId === me;
  }

  nicknameOf(playerId: number): string {
    return this.room?.players.find((p) => p.playerId === playerId)?.nickname ?? `P${playerId}`;
  }

  /** room_state.players[].isBot (봇 자리. 끊긴 사람 자리를 봇이 맡아도 사람으로 남는다) */
  isBotPlayer(playerId: number): boolean {
    return this.room?.players.find((p) => p.playerId === playerId)?.isBot ?? false;
  }

  /** playerInfo.ts 용 이름 조회 */
  readonly names = { nick: (id: number) => this.nicknameOf(id), isBot: (id: number) => this.isBotPlayer(id) };

  // ───────────── 이벤트 피드 ─────────────

  feed: FeedEntry[] = [];
  feedVersion = 0;
  private feedSeq = 0;
  private feedFrom(m: ServerMessage): void {
    const g = this.game;
    if (!g || !g.ready) return;
    const e = describeEvent(m, { me: this.viewerId, nick: (id) => this.nicknameOf(id), flagOwner: (id) => g.flags.get(id)?.ownerId ?? null, tickMs: g.config.tickMs, proposal: (id) => g.proposals.get(id), baseName: (t) => g.baseNames.get(t), isCapital: (t) => g.capitalTiles.has(t) });
    if (!e) return;
    this.feed = [...this.feed, { ...e, id: ++this.feedSeq, tick: 'tick' in m ? (m as { tick: number }).tick : g.tick }].slice(-40);
    this.feedVersion++;
    if (e.toast) this.toast(e.text, e.important ? 'error' : 'info', 4000);
  }

  // ───────────── 토스트 ─────────────

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3000): void {
    const t = this.now();
    this.toasts = [...this.toasts.filter((x) => x.until > t), { id: ++this.toastSeq, text, kind, until: t + ms }].slice(-5);
    this.emit();
  }
  pruneToasts(): void {
    const t = this.now();
    const next = this.toasts.filter((x) => x.until > t);
    if (next.length !== this.toasts.length) {
      this.toasts = next;
      this.emit();
    }
  }

  // ───────────── 수신 ─────────────

  private clearRoom(): void {
    this.feed = [];
    this.followPlayerId = null;
    this.room = null;
    this.game = null;
    this.spectating = false;
    this.pending.clear();
  }

  onMessage(m: ServerMessage): void {
    for (const fn of this.msgObservers) fn(m);
    this.feedFrom(m);
    switch (m.type) {
      case 'welcome': {
        this.welcomed = true;
        this.sessionId = m.sessionId;
        this.playerToken = m.playerToken;
        this.officialMaps = m.officialMaps ?? [];
        this.reconnecting = false;
        this.storage?.setItem(LS_TOKEN, m.playerToken);
        if (!m.resumed && this.room) this.clearRoom(); // 세션이 만료돼 새로 만들어졌다 → 예전 룸은 없다
        const q = this.queued;
        this.queued = [];
        for (const msg of q) this.socket.send(msg);
        this.emit();
        return;
      }
      case 'room_state': {
        const prevPhase = this.room?.phase;
        this.room = m;
        // 나가기로 지운 토큰을 새 룸 입장 시 다시 저장 (재접속 복구용)
        if (this.playerToken && this.storage && this.storage.getItem(LS_TOKEN) !== this.playerToken) this.storage.setItem(LS_TOKEN, this.playerToken);
        this.spectating = !m.players.some((p) => p.sessionId === this.sessionId);
        if (m.phase === 'LOBBY' || m.phase === 'COUNTDOWN') this.game = null;
        if (this.game) {
          for (const rp of m.players) {
            const p = this.game.players.get(rp.playerId);
            if (p && rp.status === 'DISCONNECTED') p.connected = false;
          }
        }
        if (prevPhase === 'LOBBY' && m.phase === 'COUNTDOWN') this.toast('곧 시작합니다', 'info', 2000);
        this.emit();
        return;
      }
      case 'match_config':
        this.game = new GameModel(m);
        this.emit();
        return;
      case 'snapshot_full':
        if (this.game) {
          if (this.reconCheck && this.game.ready) {
            const diff = this.game.diffAgainstFull(m);
            this.reconStats.fulls++;
            if (diff.length) {
              this.reconStats.mismatchedFulls++;
              if (this.reconStats.samples.length < 20) this.reconStats.samples.push(`t${m.tick}: ${diff.slice(0, 5).join('; ')}`);
            }
          }
          this.game.loadFull(m);
        }
        return;
      case 'cmd_ack': {
        const p = this.pending.get(m.clientSeq);
        this.pending.delete(m.clientSeq);
        if (m.accepted && m.postureHeld === true && m.flagId !== undefined) this.notifyPostureHeld(m.flagId);
        if (m.accepted && p?.type === 'cmd_buy_tech' && p.nodeId !== undefined) this.acceptedTech.set(p.nodeId, this.now());
        if (!m.accepted && m.reason) {
          const text = (p?.type === 'cmd_buy_tech' ? TECH_REJECT_TEXT[m.reason] : undefined) ?? REJECT_TEXT[m.reason] ?? m.reason;
          this.toast(p?.type === 'cmd_buy_tech' ? `테크 구매 실패 — ${text}` : text, 'error');
        }
        return;
      }
      case 'error': {
        if (m.code === 'NOT_IN_ROOM' && this.now() < this.ignoreNotInRoomUntil) return;
        if (m.code === 'RATE_LIMITED') return; // 방 찾기 새로고침 연타 — 조용히 무시
        // QA m-10: 방 설정 오류 3종은 서버의 사람이 읽는 사유(message, §6.2)를 함께 보여준다
        const base = ERROR_TEXT[m.code] ?? m.code;
        const detailed = (m.code === 'BAD_ROOM_OPTIONS' || m.code === 'NOT_ENOUGH_PLAYERS' || m.code === 'MAP_NOT_FOUND') && m.message && m.message !== m.code;
        this.toast(detailed ? `${base} — ${m.message}` : base, 'error', 5000);
        if (m.code === 'BAD_NICKNAME') {
          // 세션이 만들어지지 않았다 → 다시 hello 할 수 있게
          this.helloSent = false;
          this.queued = [];
        }
        return;
      }
      case 'game_over':
        this.game?.apply(m);
        this.emit();
        return;
      case 'player_eliminated':
        this.game?.apply(m);
        if (m.playerId === this.myPlayerId) this.toast('탈락했습니다 — 관전 모드', 'error', 5000);
        this.emit();
        return;
      case 'pong':
        return;
      case 'room_list':
        this.roomList = m;
        this.roomListAt = this.now();
        this.emit();
        return;
      case 'emote_broadcast': {
        const t = this.now();
        const shown: EmoteShown = { playerId: m.playerId, code: m.code, at: t };
        if (typeof m.targetPlayerId === 'number') shown.targetPlayerId = m.targetPlayerId;
        this.emotes = [...this.emotes.filter((e) => t - e.at < 4000 && e.playerId !== m.playerId), shown];
        return;
      }
      case 'flag_retargeted':
        this.game?.apply(m);
        // §27.3: 내 깃발의 재지정이 태세 쿨타임 때문에 도착지 태세를 못 바꿨다 (cmd_ack 와 같은 안내 — 중복은 notifyPostureHeld 가 거른다)
        if (m.postureHeld === true && !m.auto && this.game?.flags.get(m.flagId)?.ownerId === this.myPlayerId) this.notifyPostureHeld(m.flagId);
        return;
      default:
        this.game?.apply(m);
    }
  }

  private heldToastAt = new Map<number, number>();
  /**
   * §27.3 "태세 전환 쿨타임 중 — 이동만 했습니다 (남은 n초, 현재 태세 유지)". 남은 시간 = postureCooldownUntilTick − tick.
   * cmd_ack 와 flag_retargeted 가 같은 tick 에 둘 다 오므로 같은 깃발은 0.5초 안에 한 번만.
   */
  private notifyPostureHeld(flagId: number): void {
    const t = this.now();
    if (t - (this.heldToastAt.get(flagId) ?? -1e9) < 500) return;
    this.heldToastAt.set(flagId, t);
    const g = this.game;
    const f = g?.flags.get(flagId);
    const left = g && f ? Math.max(0, f.postureCooldownUntilTick - g.tick) : 0;
    const sec = g ? Math.ceil((left * g.config.tickMs) / 1000) : 0;
    const parts: string[] = [];
    if (sec > 0) parts.push(`${sec}초 남음`);
    if (f) parts.push(`${f.posture === POSTURE.ATTACK ? '공격' : '방어'} 태세 유지`);
    this.toast(`태세 전환 쿨타임 중 — 이동만 했습니다${parts.length ? ` (${parts.join(', ')})` : ''}`, 'info', 3500);
  }
}
