// Fairness evaluation of preset map candidates (Voronoi-by-land-BFS from spawns)
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const GOLD = [0, 1000, 2300, 900, 300, 250, 0];
const cv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; const v = a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; return m ? Math.sqrt(v) / m : 0; };

function evalAt(m, t, N) {
  const W = m.width, H = m.height, n = W * H;
  const land = i => t[i] >= 1 && t[i] <= 5;
  const owner = new Int16Array(n).fill(-1), dist = new Int32Array(n).fill(-1);
  const q = [];
  m.spawns.slice(0, N).forEach((s, k) => { owner[s] = k; dist[s] = 0; q.push(s); });
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
  const spawnSet = new Set(m.spawns.slice(0, N));
  for (const b of m.bases) if (!spawnSet.has(b) && owner[b] >= 0) { bases[owner[b]]++; baseDist[owner[b]] = Math.min(baseDist[owner[b]], dist[b]); }
  const bd = baseDist.map(d => d === 1e9 ? 999 : d);
  return { cvTiles: cv(tiles), cvGold: cv(gold), cvFert: cv(fert), cvBaseDist: cv(bd), noBase: bases.filter(b => b === 0).length, minTiles: Math.min(...tiles), maxTiles: Math.max(...tiles) };
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
  const score = avg('cvTiles') * 2 + avg('cvGold') * 2 + avg('cvFert') + avg('cvBaseDist') * 0.5 + evs.reduce((s, e) => s + e.noBase, 0) * 0.15 + Math.abs(landRatio - 0.90) * 2 // v4.5: 목표 육지 0.90 (물 ≈ 10%);
  rows.push({ id: m.id, size: m.sizeClass, score, landRatio, cvTiles: avg('cvTiles'), cvGold: avg('cvGold'), cvFert: avg('cvFert'), cvBaseDist: avg('cvBaseDist'), noBase: evs.map(e => e.noBase).join('/'), range: evs.map(e => e.minTiles + '-' + e.maxTiles).join(' | ') });
}
for (const s of ['S', 'M', 'L']) {
  const r = rows.filter(x => x.size === s).sort((a, b) => a.score - b.score);
  console.log(`== ${s} (n=${r.length}) best 6 / worst 1`);
  for (const x of [...r.slice(0, 6), r[r.length - 1]]) console.log(x.id.padEnd(12), 'score', x.score.toFixed(3), 'land', x.landRatio.toFixed(3), 'cvT', x.cvTiles.toFixed(3), 'cvG', x.cvGold.toFixed(3), 'cvF', x.cvFert.toFixed(3), 'cvBD', x.cvBaseDist.toFixed(3), 'noBase', x.noBase, 'tiles', x.range);
}
