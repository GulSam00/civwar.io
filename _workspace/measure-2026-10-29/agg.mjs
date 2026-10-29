import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2];
const rows = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pq = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const f = (x, d = 1) => x.toFixed(d);
console.log('arm | 판 | 패주/판 | 교전/판 | 교전 중간값 s (판 평균) | p90 | 패주 귀환 비율 % | 환급률 % | 종료 분 | 타임아웃 | 탈락/판');
for (const arm of ['A', 'B', 'C', 'D']) {
  const r = rows.filter((x) => x.arm === arm);
  const endsTot = r.map((x) => Object.values(x.ends).reduce((a, b) => a + b, 0));
  const rr = r.map((x, i) => ((x.ends.routed_returned ?? 0) * 100) / endsTot[i]);
  console.log([arm, r.length, f(mean(r.map((x) => x.routs))), f(mean(r.map((x) => x.combats))), f(mean(r.map((x) => x.grpMed))), f(mean(r.map((x) => x.grpP90))), f(mean(rr)), f(mean(r.map((x) => x.refundPct))), f(mean(r.map((x) => x.endMin))), r.filter((x) => x.reason === 'timeout').length, f(mean(r.map((x) => x.elim)), 2)].join(' | '));
}
// 짝지은 비교 (같은 시드): A 대비 각 arm 의 패주 수 차
for (const arm of ['B', 'C', 'D']) {
  const d = [];
  for (const a of rows.filter((x) => x.arm === 'A')) { const b = rows.find((x) => x.arm === arm && x.seed === a.seed); if (b) d.push(b.routs - a.routs); }
  console.log(`paired routs ${arm}-A: mean ${f(mean(d))}, ${arm}<A in ${d.filter((x) => x < 0).length}/${d.length}`);
}
// 깃발 병력/상한 (현행 A 만)
console.log('\n깃발/상한, (대기+깃발)/상한 — arm A, 분 구간 x 영토 순위');
const S = rows.filter((x) => x.arm === 'A').flatMap((x) => x.samples);
for (const [lo, hi] of [[1, 10], [10, 20], [20, 33]]) for (const [rl, rh, nm] of [[1, 3, '상위3'], [4, 10, '4위 이하'], [1, 10, '전체']]) {
  const s = S.filter(([m, , , rk]) => m >= lo && m < hi && rk >= rl && rk <= rh);
  const fl = s.map((x) => x[1]), tot = s.map((x) => x[2]);
  console.log(`${lo}-${hi}분 ${nm}: 깃발/상한 중간 ${f(med(fl), 2)} p90 ${f(pq(fl, 0.9), 2)} | 총/상한 중간 ${f(med(tot), 2)} p90 ${f(pq(tot, 0.9), 2)} | 총>1 비율 ${f((tot.filter((x) => x > 1).length * 100) / tot.length)}% (n=${s.length})`);
}
