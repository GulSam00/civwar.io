/** [QA 커밋 금지] 공식 맵 × 인원 × 난이도: 클라이언트 생성 전 추정(번들 파일) == 서버 pacingNote */
import { estimatePacing, landOfTerrain } from '../src/ui/pacing.js';
import { MapCatalog } from '../../server/src/map/presets.js';
import { pacingNote } from '../../server/src/room/settings.js';
import { readFileSync, readdirSync } from 'node:fs';
const cat = MapCatalog.loadDir();
let n = 0, mis = 0;
const dir = 'server/maps/official';
for (const info of cat.list()) {
  const m = cat.get(info.id)!;
  for (let N = 2; N <= m.players.max; N++) for (const d of ['EASY', 'NORMAL', 'HARD'] as const) {
    n++;
    const s = pacingNote({ map: { kind: 'preset', mapId: m.id }, maxPlayers: N, botCount: N - 1, botDifficulty: d }, N, cat);
    const c = estimatePacing({ land: landOfTerrain(m.terrain, m.width, m.height), players: N, defaultSetup: false });
    if (s !== c) { mis++; console.log(m.id, N, d, s, c); }
  }
}
console.log({ checks: n, mismatch: mis, serverMaps: cat.list().map((x) => x.id).join(',') });
