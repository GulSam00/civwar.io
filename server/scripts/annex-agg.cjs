// annex-eval 출력(jsonl) 집계: node annex-agg.cjs file1 file2 ...
const fs = require('fs');
const rows = [];
for (const f of process.argv.slice(2)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) rows.push(JSON.parse(l));
const m = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0) / rows.length;
const win = rows.filter((r) => r.reason === 'threshold').length;
console.log(`games ${rows.length} | elim/game ${m('elims').toFixed(2)} | endMin ${m('endMin').toFixed(2)} | oneBaseEnd ${m('oneBaseEnd').toFixed(2)} | minAlive% ${m('minAlivePct').toFixed(2)} | weakest@20 ${m('weakest20Pct').toFixed(2)} | top1 ${m('top1').toFixed(1)} | top2 ${m('top2').toFixed(1)} | bottom4 ${m('bottom4').toFixed(1)} | lastBaseSec ${m('lastBaseSec').toFixed(0)} | hitShare% ${(rows.filter(r=>r.lastBaseHitShare!=null).reduce((a,r)=>a+r.lastBaseHitShare,0)/Math.max(1,rows.filter(r=>r.lastBaseHitShare!=null).length)).toFixed(1)} | bountyT ${m('bountyT').toFixed(0)} bountyG ${m('bountyG').toFixed(0)} | threshold ${win}/${rows.length}`);

const hr = rows.flatMap((r) => r.heirRank ?? []);
if (hr.length) console.log(`  heir rank at elimination (n=${hr.length}): mean ${(hr.reduce((a, b) => a + b, 0) / hr.length).toFixed(2)}, rank1 ${hr.filter((x) => x === 1).length}, rank<=3 ${hr.filter((x) => x <= 3).length}, rank>=6 ${hr.filter((x) => x >= 6).length}`);
