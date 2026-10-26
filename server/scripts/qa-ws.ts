/**
 * QA 전용 (커밋 금지) — 실제 ws 서버에 붙어 수신 메시지 전부를 문서 스키마로 검사하고,
 * 로비 검증·거절 코드·견고성(잘못된 입력)·rate limit·재접속·관전·송신 순서를 확인한다.
 * 실행: npx tsx server/scripts/qa-ws.ts
 */
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from '@civwar/shared';
import { startServer } from '../src/net/server.js';
import { MapCatalog } from '../src/map/presets.js';
import { validateMessage } from './qa-schema.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
const schemaErrs = new Map<string, number>();
const typeSeen = new Map<string, number>();
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws!: WebSocket;
  log: any[] = [];
  closed: { code: number; reason: string } | null = null;
  seq = 0;
  constructor(readonly name: string) {}
  async open(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.log.push(m);
      typeSeen.set(m.type, (typeSeen.get(m.type) ?? 0) + 1);
      for (const e of validateMessage(m)) {
        const k = `${m.type}: ${e.replace(/\[\d+\]/g, '[]')}`;
        schemaErrs.set(k, (schemaErrs.get(k) ?? 0) + 1);
      }
    });
    this.ws.on('close', (code, reason) => (this.closed = { code, reason: reason.toString() }));
    this.ws.on('error', () => {});
    await new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  send(o: unknown) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  mark() { return this.log.length; }
  async wait(pred: (m: any) => boolean, from = 0, ms = 8000): Promise<any> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.log.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() > end) return undefined;
      await sleep(20);
    }
  }
  async req(o: any, pred: (m: any) => boolean, ms = 3000) { const k = this.mark(); this.send(o); return this.wait(pred, k, ms); }
  err(o: any) { return this.req(o, (m) => m.type === 'error'); }
  async cmd(o: any) { const clientSeq = ++this.seq + 1000; return this.req({ ...o, clientSeq }, (m) => m.type === 'cmd_ack' && m.clientSeq === clientSeq, 4000); }
}
async function hello(port: number, name: string, extra: Record<string, unknown> = {}): Promise<{ c: C; w: any }> {
  const c = new C(name);
  await c.open(port);
  const w = await c.req({ type: 'hello', nickname: name, clientVersion: PROTOCOL_VERSION, ...extra }, (m) => m.type === 'welcome' || m.type === 'error');
  return { c, w };
}

async function main() {
  const catalog = MapCatalog.loadDir(fileURLToPath(new URL('../test/fixtures/maps/', import.meta.url)));
  const server = await startServer(0, { seed: 31337, catalog });
  const port = server.port;
  try {
    // ── 연결·hello ──
    {
      const c = new C('raw');
      await c.open(port);
      let e = await c.err({ type: 'ping', clientTime: 1 });
      check('hello 전 ping → NOT_HELLO', e?.code === 'NOT_HELLO', JSON.stringify(e));
      e = await c.err('not json');
      check('JSON 아님 → BAD_MESSAGE', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
      e = await c.err({ type: 'hello', nickname: 'x', clientVersion: 999 });
      check('버전 불일치 → BAD_VERSION', e?.code === 'BAD_VERSION', JSON.stringify(e));
      e = await c.err({ type: 'hello', nickname: '   ', clientVersion: PROTOCOL_VERSION });
      check('공백 닉네임 → BAD_NICKNAME', e?.code === 'BAD_NICKNAME', JSON.stringify(e));
      e = await c.err({ type: 'hello', nickname: 'a'.repeat(17), clientVersion: PROTOCOL_VERSION });
      check('17자 닉네임 → BAD_NICKNAME', e?.code === 'BAD_NICKNAME', JSON.stringify(e));
      e = await c.err({ type: 'hello', nickname: 'a'.repeat(65), clientVersion: PROTOCOL_VERSION });
      check('65자 닉네임 → BAD_NICKNAME (문서) ', e?.code === 'BAD_NICKNAME', `실제 ${JSON.stringify(e)}`);
      const w = await c.req({ type: 'hello', nickname: 'raw', clientVersion: PROTOCOL_VERSION }, (m) => m.type === 'welcome');
      check('welcome.officialMaps = 카탈로그 메타', w?.officialMaps?.length === 1 && w.officialMaps[0].id === 'sample-m-01', JSON.stringify(w?.officialMaps));
      e = await c.err({ type: 'hello', nickname: 'raw', clientVersion: PROTOCOL_VERSION });
      check('두 번째 hello → ALREADY_HELLO', e?.code === 'ALREADY_HELLO', JSON.stringify(e));
      e = await c.err({ type: 'nope' });
      check('모르는 type → BAD_MESSAGE', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
      e = await c.err({ type: 'cmd_flag_issue' });
      check('clientSeq 없는 cmd_* → error BAD_MESSAGE (cmd_ack 불가)', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
      const a = await c.req({ type: 'cmd_nope', clientSeq: 5 }, (m) => m.type === 'cmd_ack' || m.type === 'error');
      check('모르는 cmd_* + clientSeq → cmd_ack BAD_REQUEST', a?.type === 'cmd_ack' && a.reason === 'BAD_REQUEST', JSON.stringify(a));
      const a2 = await c.req({ type: 'cmd_buy_tech', clientSeq: 6, nodeId: 0 }, (m) => m.type === 'cmd_ack');
      check('룸 없이 cmd → cmd_ack NOT_IN_GAME', a2?.reason === 'NOT_IN_GAME', JSON.stringify(a2));
      e = await c.err({ type: 'lobby_leave' });
      check('룸 없이 lobby_leave → NOT_IN_ROOM', e?.code === 'NOT_IN_ROOM', JSON.stringify(e));
      e = await c.err({ type: 'lobby_join_private', roomCode: 'ZZZZZZ' });
      check('없는 방 코드 → ROOM_NOT_FOUND', e?.code === 'ROOM_NOT_FOUND', JSON.stringify(e));
      e = await c.err({ type: 'lobby_join_private', roomCode: 'abc' });
      check('형식 틀린 방 코드 → BAD_MESSAGE', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
      const big = JSON.stringify({ type: 'ping', clientTime: 1, pad: 'x'.repeat(5000) });
      c.send(big);
      await sleep(300);
      check('4KB 초과 프레임 → (문서: 미기술) 연결 종료 1009', c.closed?.code === 1009, `close=${JSON.stringify(c.closed)}`);
    }

    // ── 방 설정 검증 ──
    const { c: h } = await hello(port, 'host');
    const bad = async (o: any, want: string, label: string) => {
      const e = await h.err({ type: 'lobby_create_private', ...o });
      check(`create ${label} → ${want}`, e?.code === want, JSON.stringify(e));
    };
    await bad({ maxPlayers: 13 }, 'BAD_ROOM_OPTIONS', 'maxPlayers 13');
    await bad({ maxPlayers: 1 }, 'BAD_ROOM_OPTIONS', 'maxPlayers 1');
    await bad({ maxPlayers: 2.5 }, 'BAD_ROOM_OPTIONS', 'maxPlayers 2.5');
    await bad({ map: { kind: 'random', size: 'S' }, maxPlayers: 8 }, 'BAD_ROOM_OPTIONS', 'S + 8');
    await bad({ map: { kind: 'random', size: 'XL' } }, 'BAD_ROOM_OPTIONS', 'size XL');
    await bad({ map: { kind: 'random', water: { waterMode: 'LAKES' } } }, 'BAD_ROOM_OPTIONS', 'waterMode 잘못');
    await bad({ map: { kind: 'random', water: { waterMode: 'SHALLOW_QUOTA', shallowPermille: 1001 } } }, 'BAD_ROOM_OPTIONS', 'shallowPermille 1001');
    await bad({ botCount: 10 }, 'BAD_ROOM_OPTIONS', 'botCount 10 (max 10)');
    await bad({ botDifficulty: 'INSANE' }, 'BAD_ROOM_OPTIONS', 'botDifficulty');
    await bad({ map: { kind: 'preset', mapId: 'nope' } }, 'MAP_NOT_FOUND', '없는 mapId');
    await bad({ map: 'M' }, 'BAD_ROOM_OPTIONS', 'map 문자열');
    await bad({ timeLimitMin: 'x' }, 'BAD_MESSAGE', 'timeLimitMin 문자열');
    let rs = await h.req({ type: 'lobby_create_private', map: { kind: 'random', size: 'S' } }, (m) => m.type === 'room_state' || m.type === 'error');
    check('S + maxPlayers 생략 → 7 로 낮춤', rs?.settings?.maxPlayers === 7 && rs.settings.mapMaxPlayers === 7 && JSON.stringify(rs.settings.recommended) === '[5,6]', JSON.stringify(rs?.settings));
    check('random echo 에 water 항상 채움', rs?.settings?.map?.water?.waterMode === 'BORDER_ONLY' && rs.settings.map.water.shallowPermille === 1000, JSON.stringify(rs?.settings?.map));
    rs = await h.req({ type: 'lobby_create_private', targetPlayers: 6 }, (m) => m.type === 'room_state' || m.type === 'error');
    check('구 targetPlayers 6 → maxPlayers 6 (방 이동)', rs?.settings?.maxPlayers === 6, JSON.stringify(rs?.settings));
    rs = await h.req({ type: 'lobby_create_private', map: { kind: 'preset', mapId: 'sample-m-01' }, maxPlayers: 3, botCount: 1, botDifficulty: 'HARD' }, (m) => m.type === 'room_state' || m.type === 'error');
    check('preset 방 생성 echo {kind,mapId}', rs?.settings?.map?.kind === 'preset' && rs.settings.map.mapId === 'sample-m-01' && rs.settings.mapMaxPlayers === 12, JSON.stringify(rs?.settings));
    const code = rs.roomCode;
    let e = await h.err({ type: 'lobby_update_settings', maxPlayers: 13 });
    check('update maxPlayers 13 → BAD_ROOM_OPTIONS', e?.code === 'BAD_ROOM_OPTIONS', JSON.stringify(e));
    const { c: g } = await hello(port, 'guest');
    rs = await g.req({ type: 'lobby_join_private', roomCode: code.toLowerCase() }, (m) => m.type === 'room_state' || m.type === 'error');
    check('소문자 방 코드로 입장 (대소문자 무시)', rs?.type === 'room_state' && rs.players.length === 2, JSON.stringify(rs?.code ?? rs?.players?.length));
    e = await h.err({ type: 'lobby_update_settings', maxPlayers: 1 });
    check('update maxPlayers < 사람 수(2) → BAD_ROOM_OPTIONS', e?.code === 'BAD_ROOM_OPTIONS', JSON.stringify(e));
    e = await g.err({ type: 'lobby_update_settings', botCount: 0 });
    check('방장 아닌 update → NOT_HOST', e?.code === 'NOT_HOST', JSON.stringify(e));
    rs = await g.req({ type: 'lobby_set_ready', ready: true }, (m) => m.type === 'room_state');
    check('ready 는 표시만 (자동 시작 없음)', rs?.phase === 'LOBBY' && rs.players.find((p: any) => p.playerId === 2)?.ready === true, JSON.stringify(rs?.phase));
    e = await g.err({ type: 'lobby_join_private', roomCode: code });
    check('이미 그 방 → ALREADY_IN_ROOM', e?.code === 'ALREADY_IN_ROOM', JSON.stringify(e));
    const { c: s1 } = await hello(port, 'spec');
    e = await s1.err({ type: 'lobby_spectate', roomCode: code });
    check('게임 전 관전 → NOT_LOBBY', e?.code === 'NOT_LOBBY', JSON.stringify(e));
    // 공개 룸 설정 변경
    {
      const { c: p } = await hello(port, 'pub');
      const prs = await p.req({ type: 'lobby_join_public' }, (m) => m.type === 'room_state');
      check('공개 룸 settings: M/10/NORMAL, botCount=정원−사람, pacing guaranteed', prs?.isPublic && prs.settings.maxPlayers === 10 && prs.settings.botCount === 9 && prs.settings.pacingNote === 'guaranteed' && prs.settings.expectedPlayers === 10, JSON.stringify(prs?.settings));
      e = await p.err({ type: 'lobby_update_settings', botCount: 1 });
      check('공개 룸 update → BAD_ROOM_OPTIONS', e?.code === 'BAD_ROOM_OPTIONS', JSON.stringify(e));
      // 플레이테스트 후속: 공개 방 방장 시작 허용(비방장 NOT_HOST) · 방 찾기
      const { c: p2 } = await hello(port, 'pub2');
      await p2.req({ type: 'lobby_join_public' }, (m) => m.type === 'room_state');
      e = await p2.err({ type: 'lobby_start_now' });
      check('공개 룸 비방장 start_now → NOT_HOST', e?.code === 'NOT_HOST', JSON.stringify(e));
      const { c: br } = await hello(port, 'browser');
      const rl = await br.req({ type: 'lobby_list_rooms' }, (m) => m.type === 'room_list');
      const mine = rl?.rooms?.find((r: any) => r.roomId === prs.roomId);
      check('room_list: 공개 대기 방 포함(humans 2, joinable), 비공개 방·방 코드 없음', !!mine && mine.humans === 2 && mine.joinable && !JSON.stringify(rl).includes(prs.roomCode) && rl.rooms.every((r: any) => r.roomId !== rs.roomId), JSON.stringify(rl?.rooms));
      check('§26 room_list: botDifficulty NORMAL, 대기 중 무작위 맵 thumbnail null', mine?.botDifficulty === 'NORMAL' && mine?.thumbnail === null, JSON.stringify(mine && { d: mine.botDifficulty, t: mine.thumbnail }));
      e = await br.err({ type: 'lobby_list_rooms' });
      check('room_list 1초 이내 재요청 → RATE_LIMITED', e?.code === 'RATE_LIMITED', JSON.stringify(e));
      e = await br.err({ type: 'lobby_join_listed', roomId: 'x1', spectate: false });
      check('lobby_join_listed 형식 오류 → BAD_MESSAGE', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
      const k1 = p.mark();
      p.send({ type: 'lobby_start_now' });
      const pcd = await p.wait((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN', k1);
      check('공개 룸 방장 start_now → COUNTDOWN (3초)', !!pcd && typeof pcd.countdownMs === 'number', JSON.stringify(pcd?.phase));
      p2.ws.close();
      br.ws.close();
      p.send({ type: 'lobby_leave' });
      await sleep(100);
      p.ws.close();
    }
    // NOT_ENOUGH_PLAYERS
    {
      const { c: lone } = await hello(port, 'lone');
      await lone.req({ type: 'lobby_create_private', botCount: 0 }, (m) => m.type === 'room_state');
      e = await lone.err({ type: 'lobby_start_now' });
      check('사람 1 + 봇 0 start_now → NOT_ENOUGH_PLAYERS', e?.code === 'NOT_ENOUGH_PLAYERS', JSON.stringify(e));
      lone.ws.close();
    }

    // ── 게임 시작 (preset, 3인: 사람 2 + HARD 봇 1) ──
    const k0 = h.mark();
    h.send({ type: 'lobby_start_now' });
    const cd = await h.wait((m) => m.type === 'room_state' && m.phase === 'COUNTDOWN', k0);
    check('COUNTDOWN room_state: countdownMs 숫자, 봇 1, 재번호 1..3', cd && typeof cd.countdownMs === 'number' && cd.players.map((p: any) => p.playerId).join() === '1,2,3' && cd.players[2].isBot, JSON.stringify(cd?.players?.map((p: any) => [p.playerId, p.isBot])));
    const { c: late } = await hello(port, 'late');
    e = await late.err({ type: 'lobby_join_private', roomCode: code });
    check('카운트다운 중 입장 → ROOM_IN_PROGRESS', e?.code === 'ROOM_IN_PROGRESS', JSON.stringify(e));
    const mc = await h.wait((m) => m.type === 'match_config', k0, 6000);
    check('preset match_config: mapSource preset + mapId + botDifficulty HARD', mc?.mapSource === 'preset' && mc.mapId === 'sample-m-01' && mc.botDifficulty === 'HARD' && mc.width === 100, JSON.stringify(mc && { s: mc.mapSource, id: mc.mapId, d: mc.botDifficulty }));
    // 시작 메시지 순서
    await h.wait((m) => m.type === 'snapshot_delta', k0, 3000);
    const startSeq = h.log.slice(k0).map((m) => m.type).filter((t) => ['room_state', 'match_config', 'map_init', 'snapshot_full', 'snapshot_delta'].includes(t));
    const iIn = h.log.slice(k0).findIndex((m) => m.type === 'room_state' && m.phase === 'IN_GAME');
    check('시작 순서: room_state(IN_GAME) → match_config → map_init → snapshot_full(0) → delta(1)', iIn >= 0 && startSeq.join(',').includes('match_config,map_init,snapshot_full,snapshot_delta'), startSeq.slice(0, 8).join(','));
    const sf0 = await h.wait((m) => m.type === 'snapshot_full' && m.tick === 0, k0);
    check('snapshot_full tick 0, players 3, ticksRemaining 9600', sf0?.players?.length === 3 && sf0.ticksRemaining === 9600, '');
    e = await late.err({ type: 'lobby_join_private', roomCode: code });
    check('진행 중 입장 → ROOM_IN_PROGRESS', e?.code === 'ROOM_IN_PROGRESS', JSON.stringify(e));
    const spr = await s1.req({ type: 'lobby_spectate', roomCode: code }, (m) => m.type === 'snapshot_full', 4000);
    check('관전 입장 → room_state + 부트스트랩', !!spr && s1.log.some((m) => m.type === 'match_config'), '');
    const lj = await h.err({ type: 'lobby_join_public' });
    check('살아있는 인게임 플레이어 다른 룸 → ALREADY_IN_ROOM', lj?.code === 'ALREADY_IN_ROOM', JSON.stringify(lj));
    e = await h.err({ type: 'lobby_set_ready', ready: false });
    check('인게임 ready → NOT_LOBBY', e?.code === 'NOT_LOBBY', JSON.stringify(e));

    // ── 명령 형식 견고성 ──
    const ack = (o: any) => h.cmd(o);
    const r = await Promise.all([
      ack({ type: 'cmd_flag_issue', unit: 3, troops: 50, anchorTileId: 10 }),
      ack({ type: 'cmd_flag_issue', unit: 1, troops: 1e300, anchorTileId: 10 }),
      ack({ type: 'cmd_flag_issue', unit: 1, troops: -1, anchorTileId: 10 }),
      ack({ type: 'cmd_flag_issue', unit: 1, troops: 50, anchorTileId: 2 ** 33 }),
      ack({ type: 'cmd_flag_issue', unit: 1, troops: 50, anchorTileId: 4294967295 }),
      ack({ type: 'cmd_flag_retarget', flagId: 4294967295, anchorTileId: 5 }),
      ack({ type: 'cmd_flag_recall', flagId: -1 }),
      ack({ type: 'cmd_set_posture', flagId: 1, posture: 2 }),
      ack({ type: 'cmd_ally_propose', targetPlayerId: 0 }),
      ack({ type: 'cmd_ally_respond', proposalId: 99, accept: 'yes' }),
    ]);
    const want = ['BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST', 'NO_FLAG', 'BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST'];
    r.forEach((a, i) => check(`형식 견고성 #${i} → ${want[i]}`, a?.reason === want[i], JSON.stringify(a)));
    check('unit 3 은 BAD_UNIT 이 아니라 BAD_REQUEST (문서 §4 표는 BAD_UNIT 을 1단계 검증으로 기술)', r[0]?.reason === 'BAD_REQUEST', '');
    // emote
    let k = h.mark();
    h.send({ type: 'emote', code: 3 });
    h.send({ type: 'emote', code: 4 });
    h.send({ type: 'emote', code: 99 });
    await sleep(400);
    const em = h.log.slice(k).filter((m) => m.type === 'emote_broadcast');
    check('emote 1초 1회 + 범위 밖 무시', em.length === 1 && em[0].code === 3, JSON.stringify(em));
    check('§26 대상 없는 emote_broadcast 에는 targetPlayerId 없음', em.length === 1 && !('targetPlayerId' in em[0]), JSON.stringify(em));
    // §26 대상 이모트: 자기 자신·판에 없는 자리 → 조용히 무시(1초 제한 소모 안 함), 다른 플레이어 → targetPlayerId 실어 브로드캐스트
    await sleep(1100);
    k = h.mark();
    h.send({ type: 'emote', code: 5, targetPlayerId: 1 });
    h.send({ type: 'emote', code: 6, targetPlayerId: 9 });
    h.send({ type: 'emote', code: 7, targetPlayerId: 3 });
    h.send({ type: 'emote', code: 8, targetPlayerId: 2 });
    await sleep(400);
    const emT = h.log.slice(k).filter((m) => m.type === 'emote_broadcast');
    check('§26 대상 이모트: 자기·없는 자리 무시, 유효 대상 1회 + targetPlayerId, 1초 제한 유지', emT.length === 1 && emT[0].code === 7 && emT[0].targetPlayerId === 3 && emT[0].playerId === 1, JSON.stringify(emT));
    e = await h.err({ type: 'emote', code: 1, targetPlayerId: 0 });
    check('§26 emote targetPlayerId 형식 오류(0) → BAD_MESSAGE', e?.code === 'BAD_MESSAGE', JSON.stringify(e));
    // rate limit
    k = h.mark();
    for (let i = 0; i < 25; i++) h.send({ type: 'cmd_buy_tech', clientSeq: 5000 + i, nodeId: 3 });
    await sleep(800);
    const rl = h.log.slice(k).filter((m) => m.type === 'cmd_ack' && m.clientSeq >= 5000 && m.clientSeq < 5025);
    const nRL = rl.filter((m) => m.reason === 'RATE_LIMITED').length;
    check('rate limit: 25개 연사 → 모두 ack, 일부 RATE_LIMITED', rl.length === 25 && nRL >= 5, `ack ${rl.length}, RATE_LIMITED ${nRL}, 기타 ${[...new Set(rl.map((m) => m.reason))]}`);
    // QA m-5 수정 후 (문서 §5): cmd_ack 은 처리 tick 의 방송(이벤트 → delta → full → game_over)보다 먼저 온다
    k = h.mark();
    const a1 = await h.cmd({ type: 'cmd_ally_propose', targetPlayerId: 2 });
    await sleep(300);
    const idxAck = h.log.indexOf(a1);
    const ev = h.log.slice(k).find((m) => m.type === 'ally_proposed' || m.type === 'ally_formed');
    const deltaAfter = h.log.slice(idxAck + 1).find((m) => m.type === 'snapshot_delta');
    check('cmd_ack 이 같은 tick 의 이벤트·snapshot_delta 보다 먼저 도착 (문서 §5)', a1?.accepted === true && (!!ev && h.log.indexOf(ev) > idxAck && !!deltaAfter && deltaAfter.tick === ev.tick), `ack ${JSON.stringify(a1)} idx ${idxAck}, 이벤트 idx ${ev ? h.log.indexOf(ev) : -1} tick ${ev?.tick}, 다음 delta tick ${deltaAfter?.tick}`);

    // ── 재접속 ──
    const tokenG = (g.log.find((m) => m.type === 'welcome') as any).playerToken;
    g.ws.close();
    const disc = await h.wait((m) => m.type === 'room_state' && m.players.find((p: any) => p.playerId === 2)?.status === 'DISCONNECTED', h.mark() - 5);
    check('인게임 끊김 → room_state DISCONNECTED', !!disc, '');
    await sleep(600);
    const fullTicks = h.log.filter((m) => m.type === 'snapshot_full' && m.tick > 0 && m.players.find((p: any) => p.id === 2)?.connected === false);
    const { c: g2, w: w2 } = await hello(port, 'ignored', { playerToken: tokenG });
    check('재접속 welcome.resumed + 같은 sessionId', w2?.resumed === true && w2.sessionId === (g.log[0] as any).sessionId, JSON.stringify(w2 && { resumed: w2.resumed }));
    const boot = await g2.wait((m) => m.type === 'snapshot_full', 0, 3000);
    const nextDelta = await g2.wait((m) => m.type === 'snapshot_delta', 0, 3000);
    const bootTypes = g2.log.slice(0, 6).map((m) => m.type).join(',');
    check('재접속 부트스트랩 순서 welcome → room_state → match_config → map_init → snapshot_full', bootTypes.startsWith('welcome,room_state,match_config,map_init,snapshot_full'), bootTypes);
    check('부트스트랩 full 다음 delta tick = full.tick + 1 (연속)', boot && nextDelta && nextDelta.tick === boot.tick + 1, `full ${boot?.tick} delta ${nextDelta?.tick}`);
    const pr = await h.wait((m) => m.type === 'player_reconnected', 0, 3000);
    check('player_reconnected 브로드캐스트', pr?.playerId === 2, JSON.stringify(pr));
    check('[관찰] 재접속자가 받은 부트스트랩 full 의 connected', true, `p2 connected=${boot?.players?.find((p: any) => p.id === 2)?.connected} (끊긴 동안 full ${fullTicks.length}회 connected=false)`);
    // 같은 토큰 다른 소켓 → 기존 소켓 close 4000
    const { c: g3 } = await hello(port, 'x', { playerToken: tokenG });
    await sleep(200);
    check('같은 토큰 새 소켓 → 기존 소켓 close 4000', g2.closed?.code === 4000, JSON.stringify(g2.closed));
    // 인게임 lobby_leave → 재접속 불가
    g3.send({ type: 'lobby_leave' });
    await sleep(200);
    g3.ws.close();
    await sleep(100);
    const { c: g4, w: w4 } = await hello(port, 'again', { playerToken: tokenG });
    check('인게임 lobby_leave 후 같은 토큰 → (문서: 재접속 불가)', w4?.resumed === false || w4?.type === 'error' || g4.log.every((m) => m.type !== 'match_config'), JSON.stringify(w4 && { type: w4.type, resumed: w4.resumed }));

    for (const x of [h, s1, late, g4]) x.ws.close();
  } finally {
    await server.close();
  }

  console.log('\n=== qa-ws ===');
  let fail = 0;
  for (const r of results) {
    if (!r.ok) fail++;
    console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok && !r.name.startsWith('[관찰]') ? '' : '  — ' + r.detail}`);
  }
  console.log(`\n수신 메시지 문서 스키마 위반 ${schemaErrs.size}종`);
  for (const [k2, v] of schemaErrs) console.log(`  ${v}× ${k2}`);
  console.log(`수신 type: ${[...typeSeen].map(([t, n]) => `${t}:${n}`).join(' ')}`);
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
