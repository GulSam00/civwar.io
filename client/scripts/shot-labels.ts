/**
 * 영토 이름 전/후 비교 스크린샷 (2026-10-19). 봇 전용 판을 빠르게 N tick 돌려 둔 뒤, 같은 방을 두 클라이언트 빌드로 동시에 관전해 캡처한다.
 *   npx tsx client/scripts/shot-labels.ts <before dist> <after dist> <출력 접두사> [tick=4500] [WS=8095] [HTTP=5185]
 * 사전 조건: playwright-core(.claude/skills/ai-match-monitor/recorder) + ms-playwright chromium. 끝나면 서버·브라우저를 모두 닫는다.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@civwar/shared';
import { startServer } from '../../server/src/net/server.js';

const [BEFORE, AFTER, OUT] = [process.argv[2], process.argv[3], process.argv[4]];
const TICKS = Number(process.argv[5] ?? 4500);
const PORT_WS = Number(process.argv[6] ?? 8095);
const PORT_HTTP = Number(process.argv[7] ?? 5185);
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve(dist: string, port: number): Promise<Server> {
  return new Promise((res) => {
    const s = createServer((req, rsp) => {
      let p = join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]));
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, 'index.html');
      rsp.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(rsp);
    }).listen(port, () => res(s));
  });
}

async function main(): Promise<void> {
  const srv = await startServer(PORT_WS);
  const http1 = await serve(resolve(BEFORE), PORT_HTTP);
  const http2 = await serve(resolve(AFTER), PORT_HTTP + 1);
  const ws = new WebSocket(`ws://localhost:${PORT_WS}`);
  const send = (o: object) => ws.send(JSON.stringify(o));
  let code = '';
  let started = false;
  const ready = new Promise<string>((ok) => {
    ws.on('open', () => send({ type: 'hello', nickname: 'BOT 1', clientVersion: PROTOCOL_VERSION }));
    ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString()) as ServerMessage;
      if (m.type === 'welcome') send({ type: 'lobby_create_private', map: { kind: 'random', size: 'M' }, maxPlayers: 10, botCount: 9, botDifficulty: 'NORMAL' });
      else if (m.type === 'room_state' && !code) {
        code = (m as { roomCode?: string }).roomCode ?? '';
        send({ type: 'lobby_start_now' });
      } else if (m.type === 'match_config' && !started) {
        started = true;
        const room = [...srv.lobby.rooms.values()][0];
        const S = room.sim!.state;
        for (const p of S.players) if (p) p.botControlled = true;
        for (let i = 0; i < TICKS && !room.sim!.finished; i++) room.sim!.step(); // 앞으로 빨리 감기 (브로드캐스트 없이)
        console.log('fast-forwarded to tick', S.tick);
        ok(code);
      }
    });
  });
  const roomCode = await ready;

  const pw = createRequire(import.meta.url)(resolve('.claude/skills/ai-match-monitor/recorder/node_modules/playwright-core')) as { chromium: { launch(o: object): Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()!;
  const browser = await pw.chromium.launch({ executablePath: join(cache, dir, 'chrome-win64', 'chrome.exe'), args: ['--use-gl=swiftshader'] });
  for (const [port, name] of [[PORT_HTTP, 'before'], [PORT_HTTP + 1, 'after']] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/?ws=ws://localhost:${PORT_WS}`);
    await page.getByPlaceholder('닉네임 (1~16자)').fill('관전 카메라');
    await page.getByRole('button', { name: '관전', exact: true }).click();
    await page.getByPlaceholder('예: DFV7MV').fill(roomCode);
    await page.getByRole('button', { name: '관전 시작' }).click();
    await page.waitForTimeout(4000);
    await page.mouse.move(1595, 5);
    await page.screenshot({ path: `${OUT}_${name}.png` });
    console.log('shot', name);
    await ctx.close();
  }
  await browser.close();
  ws.close();
  http1.close();
  http2.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
