// Fairness evaluation of preset map candidates.
// v4.9 (§30): 선정 지표를 면적 균등(보로노이 칸수·골드·비옥지)에서 "노출도 균등"으로 교체 — §28.4 에서 면적은 결과를 설명하지 못했다.
//   expo = CV²(nR3) + CV²(nnR) + CV²(l20) + 0.5·CV²(blocked+1)  (사용 스폰 N개 사이의 변동, 권장 인원 평균). 낮을수록 좋다.
//   기존 면적 지표(cvTiles·cvGold·cvFert·cvBaseDist)는 참고용으로 출력하고 점수 가중은 낮춘다.
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const TOP = Number(process.argv[3] ?? 6); // 크기별로 출력할 상위 후보 수
const GOLD = [0, 1000, 2300, 900, 300, 250, 0];
const cv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; const v = a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; return m ? Math.sqrt(v) / m : 0; };

// N 인 판이 쓰는 스폰 칸 (presetSpawnIndices 와 같은 규칙: spawnSets[N] 우선, 없으면 앞 N개)
function spawnTiles(m, N) { const set = m.spawnSets && m.spawnSets[String(N)]; return set ? set.map(i => m.spawns[i]) : m.spawns.slice(0, N); }
const cv2 = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m ? a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length / (m * m) : 0; };
const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
function exposure(m, t, N) {
  const W = m.width, H = m.height, R = 20;
  const land = (x, y) => x >= 0 && y >= 0 && x < W && y < H && t[y * W + x] >= 1 && t[y * W + x] <= 5;
  const sp = spawnTiles(m, N);
  const rows = sp.map(s => {
    const y = (s / W) | 0, x = s % W; let l20 = 0, blocked = 0;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) { const rem = R - Math.abs(yy - y); for (let xx = Math.max(0, x - rem); xx <= Math.min(W - 1, x + rem); xx++) if (land(xx, yy)) l20++; }
    for (const [dy, dx] of DIRS8) for (let k = 1; k <= R; k++) if (!land(x + dx * k, y + dy * k)) { blocked++; break; }
    return { l20, blocked };
  });
  const dist = (a, b) => Math.abs(((a / W) | 0) - ((b / W) | 0)) + Math.abs((a % W) - (b % W));
  const nR3 = [], nn = [];
  sp.forEach((s, i) => { const d = sp.map((u, j) => j === i ? 1e9 : dist(s, u)).sort((a, b) => a - b); const k = Math.min(3, d.length - 1 || 1); nn.push(d[0]); nR3.push(d.slice(0, k).reduce((x, y) => x + y, 0) / k); });
  return cv2(nR3) + cv2(nn) + cv2(rows.map(r => r.l20)) + 0.5 * cv2(rows.map(r => r.blocked + 1));
}

function evalAt(m, t, N) {
  const W = m.width, H = m.height, n = W * H;
  const land = i => t[i] >= 1 && t[i] <= 5;
  const owner = new Int16Array(n).fill(-1), dist = new Int32Array(n).fill(-1);
  const q = [];
  spawnTiles(m, N).forEach((s, k) => { owner[s] = k; dist[s] = 0; q.push(s); });
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (!land(j) || dist[j] >= 0) continue;
      dist[j] = dist[c] + 1; owner[j] = owner[c]; q.push(j);
    }
  }
  const tiles = Array(N).fill(0), gold = Array(N).fill(0), fert = Array(N).fill(0), bases = Array(N).fill(0), baseDist = Array(N).fill(1e9);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) { tiles[owner[i]]++; gold[owner[i]] += GOLD[t[i]]; if (t[i] === 2) fert[owner[i]]++; }
  const spawnSet = new Set(spawnTiles(m, N));
  for (const b of m.bases) if (!spawnSet.has(b) && owner[b] >= 0) { bases[owner[b]]++; baseDist[owner[b]] = Math.min(baseDist[owner[b]], dist[b]); }
  const bd = baseDist.map(d => d === 1e9 ? 999 : d);
  return { expo: exposure(m, t, N), cvTiles: cv(tiles), cvGold: cv(gold), cvFert: cv(fert), cvBaseDist: cv(bd), noBase: bases.filter(b => b === 0).length, minTiles: Math.min(...tiles), maxTiles: Math.max(...tiles) };
}

const rows = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const t = []; for (let i = 0; i < m.terrain.length; i += 2) for (let k = 0; k < m.terrain[i + 1]; k++) t.push(m.terrain[i]);
  if (t.length !== m.width * m.height) { console.error('bad rle', f); continue; }
  const P = m.players, Ns = [...new Set([P.recommendedMin, P.recommendedMax])];
  const evs = Ns.map(N => evalAt(m, t, N));
  const avg = k => evs.reduce((s, e) => s + e[k], 0) / evs.length;
  const landRatio = t.filter(x => x >= 1 && x <= 5).length / t.length;
  const score = avg('expo') * 20 + avg('cvTiles') * 0.3 + avg('cvGold') * 0.3 + avg('cvFert') * 0.15 + avg('cvBaseDist') * 0.5 + evs.reduce((s, e) => s + e.noBase, 0) * 0.15 + Math.abs(landRatio - 0.90) * 2; // v4.5: 목표 육지 0.90 (물 ≈ 10%); v4.9: 노출도 균등 가중 20
  rows.push({ id: m.id, size: m.sizeClass, score, landRatio, expo: avg('expo'), cvTiles: avg('cvTiles'), cvGold: avg('cvGold'), cvFert: avg('cvFert'), cvBaseDist: avg('cvBaseDist'), noBase: evs.map(e => e.noBase).join('/'), range: evs.map(e => e.minTiles + '-' + e.maxTiles).join(' | ') });
}
for (const s of ['S', 'M', 'L']) {
  const r = rows.filter(x => x.size === s).sort((a, b) => a.score - b.score);
  console.log(`== ${s} (n=${r.length}) best ${TOP} / worst 1`);
  for (const x of [...r.slice(0, TOP), r[r.length - 1]]) console.log(x.id.padEnd(12), 'score', x.score.toFixed(3), 'expo', x.expo.toFixed(4), 'land', x.landRatio.toFixed(3), 'cvT', x.cvTiles.toFixed(3), 'cvG', x.cvGold.toFixed(3), 'cvF', x.cvFert.toFixed(3), 'cvBD', x.cvBaseDist.toFixed(3), 'noBase', x.noBase, 'tiles', x.range);
}
