/**
 * AI 전용 관전 모니터 — 봇만으로 한 판을 실시간(5Hz)으로 돌리며 사람이 읽는 로그와 5분 전황 보고를 남기고,
 * (선택) 헤드리스 Chromium 관전 화면을 영상으로 녹화한다.
 *
 *   npx tsx server/scripts/watch-game.ts [출력 폴더] [인원=10] [크기=M] [난이도=NORMAL]
 *   환경변수: PW_MODULE / CHROME_PATH (생략 시 자동 탐색, NO_VIDEO=1 이면 녹화 생략)
 *            MAX_MIN=<분>  (짧게 끊어 보는 시험용), PORT_WS / PORT_HTTP
 *
 * 산출물: game-log.md(사람용 로그, 한 줄 = 사건 하나), highlights.md(핵심 사건만), events.jsonl(원본 이벤트), reports/*.md(5분 전황),
 *         shots/*.png(5분마다 화면), video/*.webm(녹화)
 * 사전 조건: npm run build:client (client/dist 를 이 스크립트가 직접 서빙한다)
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync, appendFileSync, statSync, renameSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, extname, resolve } from 'node:path';
import WebSocket from 'ws';
import {
  ANY_HOSTILE,
  HARD_TIMEOUT_TICK,
  POSTURE,
  PROTOCOL_VERSION,
  TECH_BRANCH_NAME,
  TECH_NODES,
  TICK_MS,
  techCount,
  type ServerMessage,
} from '@civwar/shared';
import { startServer } from '../src/net/server.js';
import { grossGoldMilliPerTick, troopCap, flagCap } from '../src/game/economy.js';
import { thresholdPct } from '../src/game/victory.js';
import type { GameState } from '../src/game/state.js';
import type { Room } from '../src/room/room.js';

const OUT = resolve(process.argv[2] ?? `_workspace/ai-match/${new Date().toISOString().slice(0, 10)}`);
const N = Number(process.argv[3] ?? 10);
const SIZE = (process.argv[4] ?? 'M') as 'S' | 'M' | 'L';
const DIFF = (process.argv[5] ?? 'NORMAL') as 'EASY' | 'NORMAL' | 'HARD';
const MAX_MIN = Number(process.env.MAX_MIN ?? 0);
const PORT_WS = Number(process.env.PORT_WS ?? 8095);
const PORT_HTTP = Number(process.env.PORT_HTTP ?? 5185);
const TPM = 60000 / TICK_MS; // tick / 분

for (const d of ['', 'reports', 'shots', 'video']) mkdirSync(join(OUT, d), { recursive: true });
const LOG = join(OUT, 'game-log.md');
const HL = join(OUT, 'highlights.md'); // 하이라이트: 기지·탈락·외교·1위 교체·기준 변화만
const RAW = join(OUT, 'events.jsonl');
writeFileSync(LOG, '');
writeFileSync(HL, '');
writeFileSync(RAW, '');

// ───────────────────────── 표기 도우미 ─────────────────────────
const UNIT_NAME = ['창병', '검병', '기병'];
const TERRAIN_NAME = ['바다', '평원', '비옥지', '언덕', '사막', '산', '호수'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const clock = (t: number) => {
  const s = Math.floor((t * TICK_MS) / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const pct = (x: number, d = 1) => `${x.toFixed(d)}%`;
const k = (milli: number) => Math.floor(milli / 1000);

let room: Room | null = null;
let S: GameState | null = null;
const nick = new Map<number, string>();

function temper(a: number): string {
  return a >= 667 ? '공격형' : a <= 333 ? '수비형' : '균형형';
}
function P(id: number | null | undefined): string {
  if (id === null || id === undefined) return '없음';
  if (id === 0) return '중립';
  if (id === ANY_HOSTILE) return '적 아무나';
  return `P${id}`;
}
function xy(tile: number): string {
  const w = S!.map.width;
  return `(${tile % w},${Math.floor(tile / w)})`;
}
function place(tile: number): string {
  const st = S!;
  const terr = TERRAIN_NAME[st.map.terrain[tile]] ?? '?';
  if (st.map.isBase[tile]) {
    const cap = st.players.find((p) => p && p.homeTileId === tile);
    const name = st.baseNames?.[st.baseIndexOf.get(tile) ?? -1];
    return `${cap ? `P${cap.id} 수도` : '기지'}${name ? ` '${name}'` : ''}${xy(tile)}`;
  }
  return `${terr}${xy(tile)}`;
}
function flagDesc(id: number): string {
  const f = S!.flags.find((x) => x.id === id);
  if (!f) return `깃발#${id}`;
  return `${P(f.ownerId)} ${UNIT_NAME[f.unit]}#${id}(${k(f.troopsMilli)}명, ${f.posture === POSTURE.ATTACK ? '공격' : '방어'}, ${place(f.posTileId)})`;
}
const HL_TAGS = new Set(['★기지', '✖탈락', '외교', '기준', '러시', '종료', '1위']);
function line(t: number, tag: string, text: string): void {
  const s = `[${clock(t)}] ${tag.padEnd(6, ' ')} ${text}`;
  appendFileSync(LOG, s + '\n');
  if (HL_TAGS.has(tag)) appendFileSync(HL, s + '\n');
}
function shareOf(tiles: number): number {
  return (tiles * 100) / S!.map.totalLandTiles;
}

// ───────────────────────── 집계 (5분 창) ─────────────────────────
interface Window {
  issued: number;
  issuedByUnit: number[];
  combats: number;
  routed: number;
  baseCaps: string[];
  techs: number;
  elim: string[];
  ally: number;
  recalls: number;
  exhausted: number;
}
const freshWindow = (): Window => ({ issued: 0, issuedByUnit: [0, 0, 0], combats: 0, routed: 0, baseCaps: [], techs: 0, elim: [], ally: 0, recalls: 0, exhausted: 0 });
let win = freshWindow();
const total = { issued: 0, combats: 0, routed: 0, baseCaps: 0, capitalCaps: 0, techs: 0 };
const combatStart = new Map<number, { t: number; flags: { id: number; owner: number; troops: number; base: number }[] }>();
/** 델타 combatLoss 누적 (깃발별 milli) — 교전 무리가 합쳐지거나 갈라져도 손실은 정확하다 */
const lossByFlag = new Map<number, number>();
const flagOwner = new Map<number, number>();
let winCombatLoss = new Map<number, number>();
let prevTiles = new Map<number, number>();
let windowStartTick = 0;
let leaderId = 0;
let leaderCand = 0;
let leaderCandSince = 0;
const combatPairs = { started: 0, matched: 0 };
let stopped = false;

// ───────────────────────── 이벤트 → 한 줄 ─────────────────────────
function onEvent(m: ServerMessage): void {
  const st = S!;
  switch (m.type) {
    case 'flag_issued': {
      flagOwner.set(m.flagId, m.playerId);
      win.issued++;
      win.issuedByUnit[m.unit]++;
      total.issued++;
      const d = st.graph.distance(m.originTileId, m.anchorTileId);
      const goal = m.targetOwnerId === ANY_HOSTILE ? '적 아무나' : m.targetOwnerId === 0 ? '중립 땅' : `${P(m.targetOwnerId)} 땅`;
      line(m.tick, '출전', `${P(m.playerId)} ${UNIT_NAME[m.unit]}#${m.flagId} ${m.troops}명 ${m.posture === POSTURE.ATTACK ? '공격' : '방어'} | ${place(m.originTileId)} → ${place(m.anchorTileId)} ${goal}, ${d}칸, 도착 약 ${Math.max(0, Math.round(((m.etaTick - m.tick) * TICK_MS) / 1000))}초`);
      break;
    }
    case 'flag_retargeted':
      if (!m.auto) line(m.tick, '재지정', `${flagDesc(m.flagId)} → ${place(m.anchorTileId)} (${m.targetOwnerId === 0 ? '중립' : P(m.targetOwnerId)})`);
      break;
    case 'flag_recalled':
      win.recalls++;
      line(m.tick, '회수', `${flagDesc(m.flagId)} → ${place(m.returnTileId)}로 귀환`);
      break;
    case 'flag_posture_changed':
      line(m.tick, '태세', `${flagDesc(m.flagId)} → ${m.posture === POSTURE.ATTACK ? '공격' : '방어'} 태세로 전환${m.auto ? ' (자동)' : ''}`);
      break;
    case 'flag_ended': {
      const why = { exhausted: '병력 소진', recalled: '회수 완료', attrited: '소모로 전멸', eliminated: '소유자 탈락', routed_returned: '패주 후 귀환' }[m.reason];
      if (m.reason === 'exhausted') win.exhausted++;
      line(m.tick, '해산', `깃발#${m.flagId} ${why}${m.refunded ? `, ${m.refunded}명 환급` : ''}`);
      break;
    }
    case 'combat_started': {
      win.combats++;
      total.combats++;
      const flags = m.flagIds.map((id) => {
        const f = st.flags.find((x) => x.id === id)!;
        return { id, owner: f?.ownerId ?? flagOwner.get(id) ?? 0, troops: f ? k(f.troopsMilli) : 0, base: lossByFlag.get(id) ?? 0 };
      });
      combatStart.set(m.groupKey, { t: m.tick, flags });
      combatPairs.started++;
      const sides = m.sides.map((s) => `${s.ownerIds.map(P).join('+')} ${s.troops}명(전력 ${(s.power / 1000).toFixed(2)})`).join(' vs ');
      line(m.tick, '교전', `${sides} | ${m.flagIds.map(flagDesc).join(' / ')}`);
      break;
    }
    case 'combat_ended': {
      const c = combatStart.get(m.groupKey);
      combatStart.delete(m.groupKey);
      if (c) combatPairs.matched++;
      win.routed += m.routedFlagIds.length;
      total.routed += m.routedFlagIds.length;
      let loss = '';
      if (c) {
        const byOwner = new Map<number, number>();
        // 손실 = 델타 combatLoss 누적의 차이 (노출 소모·점령 지출은 섞이지 않는다)
        for (const f0 of c.flags) byOwner.set(f0.owner, (byOwner.get(f0.owner) ?? 0) + Math.round(((lossByFlag.get(f0.id) ?? 0) - f0.base) / 1000));
        loss = ` | ${((m.tick - c.t) * TICK_MS / 1000).toFixed(1)}초, 손실 ${[...byOwner].map(([o, l]) => `${P(o)} −${l}`).join(', ')}`;
      }
      const winner = m.winnerSideKey === null ? '무승부/이탈' : `승자 ${P(c?.flags.find((f) => f.owner === m.winnerSideKey)?.owner ?? m.winnerSideKey)}`;
      line(m.tick, '교전끝', `${winner}${m.routedFlagIds.length ? `, 패주 ${m.routedFlagIds.map((id) => `깃발#${id}`).join(' ')}` : ''}${loss}`);
      break;
    }
    case 'base_captured': {
      const capital = st.players.some((p) => p && p.homeTileId === m.tileId);
      win.baseCaps.push(`${P(m.fromPlayerId)}→${P(m.toPlayerId)} ${capital ? '수도' : '기지'}${xy(m.tileId)}`);
      total.baseCaps++;
      if (capital) total.capitalCaps++;
      line(m.tick, '★기지', `${place(m.tileId)} 함락: ${P(m.fromPlayerId)} → ${P(m.toPlayerId)} (체력 ${m.newHpPct}%로 시작)`);
      break;
    }
    case 'tech_purchased': {
      win.techs++;
      total.techs++;
      const n = TECH_NODES[m.nodeId];
      line(m.tick, '테크', `${P(m.playerId)} [${TECH_BRANCH_NAME[n.branch]} T${n.tier}] ${n.name} — ${n.desc} | ${m.cost}골드, 보유 ${techCount(m.techMask)}개${m.newFlagCap ? `, 슬롯 ${m.newFlagCap}` : ''}`);
      break;
    }
    case 'player_eliminated':
      win.elim.push(`${P(m.playerId)}(by ${P(m.byPlayerId)})`);
      line(m.tick, '✖탈락', `${P(m.playerId)} 탈락 — 마지막 타격 ${P(m.byPlayerId)}`);
      break;
    case 'ally_proposed':
      line(m.tick, '외교', `${P(m.fromPlayerId)} → ${P(m.toPlayerId)} 동맹 제안`);
      break;
    case 'ally_formed':
      win.ally++;
      line(m.tick, '외교', `${P(m.a)} ↔ ${P(m.b)} 동맹 결성`);
      break;
    case 'ally_break_started':
      line(m.tick, '외교', `${P(m.byPlayerId)}가 ${P(m.a)}↔${P(m.b)} 동맹 파기 선언 (${clock(m.breakAtTick)}에 해제)`);
      break;
    case 'ally_broken':
      line(m.tick, '외교', `${P(m.a)} ↔ ${P(m.b)} 동맹 해제 (${m.reason})`);
      break;
    case 'threshold_update':
      line(m.tick, '기준', `승리 기준 ${m.thresholdPct}%로 하락`);
      break;
    case 'endgame_rush':
      line(m.tick, '러시', `종반 러시 발동 — 점령비용 ×${m.costMultPermille / 1000}`);
      break;
    case 'game_over':
      line(m.finalTick, '종료', `승자 ${P(m.winnerId)} (${m.reason}) — ${m.standings.map((s) => `${s.rank}위 ${P(s.playerId)} ${s.tiles}칸`).join(', ')}`);
      break;
  }
}

// ───────────────────────── 5분 전황 ─────────────────────────
function report(t: number, final = false): string {
  const st = S!;
  const players = st.players.filter(Boolean).slice().sort((a, b) => b.tiles - a.tiles || a.id - b.id);
  const land = st.map.totalLandTiles;
  let neutral = 0;
  for (let i = 0; i < st.owners.length; i++) if (st.owners[i] === 0 && st.map.terrain[i] >= 1 && st.map.terrain[i] <= 5) neutral++;
  const alive = players.filter((p) => p.alive).length;
  const lead = players[0];
  const second = players[1];
  const out: string[] = [];
  out.push(`## ${clock(t)} 전황 보고${final ? ' (최종)' : ''}`);
  out.push('');
  out.push(`- 승리 기준 **${thresholdPct(t)}%** · 1위 **${P(lead.id)} ${pct(shareOf(lead.tiles))}** (2위 ${P(second.id)}와 ${(shareOf(lead.tiles) - shareOf(second.tiles)).toFixed(1)}%p 차) · 생존 ${alive}/${players.length} · 중립 땅 ${pct((neutral * 100) / land)}`);
  const span = Math.round(((t - windowStartTick) * TICK_MS) / 60000);
  out.push(`- 최근 ${span}분(${clock(windowStartTick)}~${clock(t)}): 출전 ${win.issued}회(창 ${win.issuedByUnit[0]} / 검 ${win.issuedByUnit[1]} / 기 ${win.issuedByUnit[2]}), 교전 ${win.combats}회, 패주 ${win.routed}, 소진 ${win.exhausted}, 회수 ${win.recalls}, 테크 ${win.techs}개, 기지 함락 ${win.baseCaps.length}회${win.baseCaps.length ? ` (${win.baseCaps.join(', ')})` : ''}${win.elim.length ? `, 탈락 ${win.elim.join(', ')}` : ''}`);
  const cl = [...winCombatLoss].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (cl.length) out.push(`- 구간 교전 손실(틱당 combatLoss 합): ${cl.map(([o, v]) => `${P(o)} −${Math.round(v / 1000)}`).join(', ')}`);
  out.push('');
  out.push('| 순위 | 플레이어 | 성향 | 영토 (점유율, 구간 변화) | 병력 / 상한 | 골드 (초당 순익) | 깃발 공·방 / 슬롯 | 기지 | 테크 (최근) |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  players.forEach((p, i) => {
    const prev = prevTiles.get(p.id) ?? 0;
    const flags = st.flags.filter((f) => f.ownerId === p.id && !f.routed);
    const atk = flags.filter((f) => f.posture === POSTURE.ATTACK).length;
    const def = flags.length - atk;
    const netGold = (grossGoldMilliPerTick(p) * (1000 - p.upkeepPm)) / 1000 / 1000 * (1000 / TICK_MS);
    const capital = p.baseTiles.includes(p.homeTileId) ? '수도 보유' : '수도 상실';
    const owned = TECH_NODES.filter((n) => (p.techMask >>> n.id) & 1);
    const recent = owned.slice(-2).map((n) => n.name).join('·');
    const status = p.alive ? '' : ' ✖';
    out.push(`| ${i + 1} | ${P(p.id)}${status} | ${temper(p.bot.aggressionPermille ?? 500)} | ${p.tiles}칸 (${pct(shareOf(p.tiles))}, ${p.tiles - prev >= 0 ? '+' : ''}${p.tiles - prev}) | ${k(p.troopsMilli)} / ${troopCap(p)} | ${k(p.goldMilli)} (${netGold.toFixed(1)}) | ${atk}·${def} / ${flagCap(p)} | ${p.baseTiles.length}개, ${capital} | ${owned.length}개${recent ? ` (${recent})` : ''} |`);
  });
  out.push('');
  // 주목할 점 — 자동 요약
  const deltas = players.map((p) => ({ id: p.id, d: p.tiles - (prevTiles.get(p.id) ?? 0) })).sort((a, b) => b.d - a.d);
  const notes: string[] = [];
  if (deltas.length) {
    const lo = deltas[deltas.length - 1];
    const sign = (d: number) => (d >= 0 ? `+${d}` : `${d}`);
    notes.push(`가장 많이 늘린 나라 ${P(deltas[0].id)}(${sign(deltas[0].d)}칸), ${lo.d < 0 ? '가장 많이 잃은' : '가장 적게 늘린'} 나라 ${P(lo.id)}(${sign(lo.d)}칸)`);
  }
  const lostCap = players.filter((p) => p.alive && !p.baseTiles.includes(p.homeTileId)).map((p) => P(p.id));
  if (lostCap.length) notes.push(`수도를 잃고 버티는 나라: ${lostCap.join(', ')}`);
  const need = thresholdPct(t) - shareOf(lead.tiles);
  notes.push(`1위가 승리 기준까지 ${need.toFixed(1)}%p 남음`);
  out.push(`- 주목: ${notes.join(' · ')}`);
  out.push('');
  prevTiles = new Map(players.map((p) => [p.id, p.tiles]));
  win = freshWindow();
  winCombatLoss = new Map();
  windowStartTick = t;
  return out.join('\n');
}

// ───────────────────────── 정적 서버 (client/dist) ─────────────────────────
const DIST = resolve('client/dist');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serveDist(): Promise<void> {
  return new Promise((res) => {
    createServer((req, rsp) => {
      let p = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
      rsp.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(rsp);
    }).listen(PORT_HTTP, () => res());
  });
}

// ───────────────────────── 녹화 (선택) ─────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any -- playwright-core 는 선택 의존(저장소에 없음), 쓰는 표면만 느슨하게 */
type PwModule = { chromium: { launch(o: object): Promise<any> } };
interface Recorder {
  shot(name: string): Promise<void>;
  stop(): Promise<void>;
}
/** 녹화 도구 위치: 환경변수 → 스킬 기본 설치 위치(.claude/skills/ai-match-monitor/recorder) → ms-playwright 캐시의 최신 chromium */
function findRecorder(): { pwModule: string; chrome: string } | null {
  if (process.env.NO_VIDEO) return null;
  const pwModule = process.env.PW_MODULE ?? resolve('.claude/skills/ai-match-monitor/recorder/node_modules/playwright-core');
  let chrome = process.env.CHROME_PATH ?? '';
  if (!chrome) {
    const cache = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', 'AppData/Local'), 'ms-playwright');
    if (existsSync(cache)) {
      const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
      for (const d of dirs) {
        const exe = join(cache, d, 'chrome-win64', 'chrome.exe');
        if (existsSync(exe)) {
          chrome = exe;
          break;
        }
      }
    }
  }
  if (!existsSync(pwModule) || !chrome || !existsSync(chrome)) {
    console.log(`녹화 생략 — playwright-core(${pwModule}) 또는 chromium(${chrome || '없음'})을 찾지 못함`);
    return null;
  }
  return { pwModule, chrome };
}

async function startRecorder(code: string): Promise<Recorder | null> {
  const found = findRecorder();
  if (!found) return null;
  const pw = createRequire(import.meta.url)(found.pwModule) as PwModule;
  const browser = await pw.chromium.launch({ executablePath: found.chrome, args: ['--use-gl=swiftshader'] });
  const size = { width: 1600, height: 900 };
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: join(OUT, 'video'), size } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT_HTTP}/?ws=ws://localhost:${PORT_WS}`);
  await page.getByPlaceholder('닉네임 (1~16자)').fill('관전 카메라');
  await page.getByRole('button', { name: '관전', exact: true }).click();
  await page.getByPlaceholder('예: DFV7MV').fill(code);
  await page.getByRole('button', { name: '관전 시작' }).click();
  await page.waitForTimeout(2500);
  await page.mouse.move(size.width - 5, 5); // hover 툴팁이 화면을 가리지 않게
  return {
    shot: async (name) => {
      await page.screenshot({ path: join(OUT, 'shots', name) });
    },
    stop: async () => {
      const v = page.video();
      await ctx.close();
      await browser.close();
      if (v) {
        const src = await v.path();
        renameSync(src, join(OUT, 'video', 'match.webm'));
      }
    },
  };
}

// ───────────────────────── 실행 ─────────────────────────
async function main(): Promise<void> {
  const srv = await startServer(PORT_WS);
  await serveDist();
  console.log(`server ws://localhost:${PORT_WS}, client http://localhost:${PORT_HTTP}`);

  const ws = new WebSocket(`ws://localhost:${PORT_WS}`);
  const send = (o: object) => ws.send(JSON.stringify(o));
  let code = '';
  const rec: { r: Recorder | null } = { r: null };
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));

  ws.on('message', async (buf) => {
    const m = JSON.parse(buf.toString()) as ServerMessage;
    if (m.type === 'welcome') {
      send({ type: 'lobby_create_private', map: { kind: 'random', size: SIZE }, maxPlayers: N, botCount: N - 1, botDifficulty: DIFF });
    } else if (m.type === 'room_state' && !code) {
      code = (m as { roomCode?: string }).roomCode ?? '';
      room = [...srv.lobby.rooms.values()][0];
      send({ type: 'lobby_start_now' });
    } else if (m.type === 'match_config' && room?.sim && !S) {
      S = room.sim.state;
      // 방장 자리도 봇이 조종 — 사람 없는 AI 전용 판
      for (const p of S.players) if (p) p.botControlled = true;
      // §23: 방장 자리(이 스크립트의 세션)도 봇 세력 이름으로 — 다른 봇과 같은 양식·고유
      for (const mem of room.members.values()) if (!mem.isBot) room.giveFactionName(mem.playerId);
      for (const mem of room.members.values()) nick.set(mem.playerId, mem.nickname);
      const sim = room.sim;
      const step = sim.step.bind(sim);
      sim.step = () => {
        const out = step();
        if (stopped) return out; // 종료 판정 뒤 남은 tick 은 기록하지 않는다
        for (const e of out.broadcast) {
          if (e.type === 'snapshot_delta') {
            for (const [fid, lm] of e.combatLoss ?? []) {
              lossByFlag.set(fid, (lossByFlag.get(fid) ?? 0) + lm);
              const o = flagOwner.get(fid) ?? 0;
              winCombatLoss.set(o, (winCombatLoss.get(o) ?? 0) + lm);
            }
            continue;
          }
          if (e.type === 'snapshot_full') continue;
          appendFileSync(RAW, JSON.stringify(e) + '\n');
          onEvent(e);
        }
        const t = S!.tick;
        // 1위 교체 — 히스테리시스: 새 1위가 10초 연속 1위이고 이전 1위보다 0.5%p(최소 10칸) 이상 앞설 때만 기록
        if (t >= TPM && t % 5 === 0) {
          const top = S!.players.filter((p) => p && p.alive).sort((a, b) => b.tiles - a.tiles || a.id - b.id)[0];
          if (!leaderId && top) leaderId = top.id;
          else if (top && top.id !== leaderId) {
            if (leaderCand !== top.id) {
              leaderCand = top.id;
              leaderCandSince = t;
            }
            const prev = S!.players[leaderId];
            const margin = Math.max(10, Math.ceil(S!.map.totalLandTiles / 200));
            if (t - leaderCandSince >= 50 && top.tiles - (prev?.alive ? prev.tiles : 0) >= margin) {
              line(t, '1위', `${P(top.id)}가 1위로 (${top.tiles}칸, ${pct(shareOf(top.tiles))}) — 이전 1위 ${P(leaderId)} ${prev?.tiles ?? 0}칸`);
              leaderId = top.id;
              leaderCand = 0;
            }
          } else leaderCand = 0;
        }
        if (t > 0 && t % (5 * TPM) === 0) {
          const r = report(t);
          writeFileSync(join(OUT, 'reports', `${pad(t / TPM)}min.md`), r + '\n');
          appendFileSync(LOG, '\n' + r + '\n');
          console.log('\n' + r);
          void rec.r?.shot(`${pad(t / TPM)}min.png`).catch(() => {});
        }
        if (sim.finished || (MAX_MIN && t >= MAX_MIN * TPM)) {
          stopped = true;
          setTimeout(done, 3000);
        }
        return out;
      };
      // 헤더
      const st = S;
      const roster = st.players.filter(Boolean).map((p) => `| ${P(p.id)} | ${nick.get(p.id) ?? ''} | ${temper(p.bot.aggressionPermille ?? 500)} (${p.bot.aggressionPermille}) | ${place(p.homeTileId)} |`);
      writeFileSync(
        LOG,
        [
          `# AI 전용 대전 로그 — ${new Date().toLocaleString('ko-KR')}`,
          '',
          `맵 ${SIZE} ${st.map.width}×${st.map.height} (육지 ${st.map.totalLandTiles}칸, 기지 ${st.map.baseTiles.length}개) · 시드 ${st.map.seed} · ${N}인 · 봇 난이도 ${DIFF} · 하드 타임아웃 ${clock(HARD_TIMEOUT_TICK)}`,
          '',
          '| 플레이어 | 이름 | 성향 (aggression ‰) | 수도 |',
          '|---|---|---|---|',
          ...roster,
          '',
          '표기: `[분:초] 분류 내용` · 깃발 = 병종#번호(병력, 태세, 위치) · 좌표 (x,y) · 전력 = 편 실효 전투값',
          '',
          '---',
          '',
        ].join('\n'),
      );
      writeFileSync(HL, `# 하이라이트 — 기지 함락·탈락·외교·1위 교체·승리 기준 변화만 (전체는 game-log.md)\n\n`);
      prevTiles = new Map(st.players.filter(Boolean).map((p) => [p.id, p.tiles]));
      console.log(`room ${code} started — ${N} bots, map ${st.map.width}x${st.map.height}`);
      try {
        rec.r = await startRecorder(code);
        if (rec.r) {
          console.log('recording…');
          await rec.r.shot('00min.png');
        }
      } catch (e) {
        console.log('recorder failed:', (e as Error).message);
      }
    }
  });
  ws.on('open', () => send({ type: 'hello', nickname: 'BOT 1', clientVersion: PROTOCOL_VERSION }));

  await finished;
  const t = S!.tick;
  const r = report(t, true);
  writeFileSync(join(OUT, 'reports', 'final.md'), r + '\n');
  appendFileSync(LOG, '\n' + r + '\n');
  appendFileSync(LOG, `\n누계: 출전 ${total.issued}회 · 교전 ${total.combats}회 · 패주 ${total.routed} · 기지 함락 ${total.baseCaps}회(수도 ${total.capitalCaps}) · 테크 ${total.techs}개 · 교전 시작/종료 짝 ${combatPairs.matched}/${combatPairs.started} (짝이 없는 교전은 개별 줄에 손실이 안 찍히지만, 구간 교전 손실 합계에는 포함)\n`);
  console.log('\n' + r);
  await rec.r?.shot('final.png').catch(() => {});
  await rec.r?.stop();
  console.log('outputs:', readdirSync(OUT).join(', '));
  ws.close();
  await srv.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
