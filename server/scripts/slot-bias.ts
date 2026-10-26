/**
 * 슬롯·플레이어 id 편향 측정 (§32) — 봇 자가대전을 돌려 "스폰 슬롯별" / "playerId별" 평균 최종 점유율과 그 변동계수(CV)를 낸다.
 *
 * 실행: npx tsx server/scripts/slot-bias.ts [games=100] [seed0=5000] [size=M] [N=10]
 * 환경 변수 (진단용):
 *   MODE=A|B        A = 전원 성향 500‰ 고정 (기본), B = 기본 성향 배정
 *   SHUFFLE=0|1     1 = 매 판 플레이어→슬롯을 shuffledSlots(seed) 순열로 배정 (기본 0 = 옛 동작, playerId p → 슬롯 p-1)
 *   TECH=default|legacy|fixed0..3   default = createGameState 기본(시드 기반 균형 배정), legacy = (playerId-1)%4 (§32 이전), fixedK = 전원 K번 목록
 *   LEGACY_TIE=1    봇 앵커 동률을 §32 이전처럼 tileId 최소로 (위·왼쪽 편향 재현)
 *   FLIP=v|h        맵을 세로/가로로 뒤집어 시뮬레이션 (tileId 순서 의존 진단)
 *   DUMP=path       (seed,id,slot,x,y,share,win) JSON 줄을 추가 기록
 *   REVERSE_IDS=1   playerId 를 슬롯 순서와 반대로 (id N ↔ 슬롯 0) — 순서 의존 확인용
 * 잡음 바닥: 판마다 라벨을 무작위로 섞어 같은 CV 를 구한 값 (공정해도 판 수가 적으면 0 이 아니다).
 */
import { appendFileSync } from 'node:fs';
import { HARD_TIMEOUT_TICK, MAP_SIZE_PRESETS, type MapSizeClass } from '@civwar/shared';
import { CivBot, botDiag } from '../src/game/bot.js';
import { createGameState, type PlayerSetup } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';
import { generateMap, type GeneratedMap } from '../src/map/generate.js';
import { TerrainGraph } from '../src/topology/square.js';
import { shuffledSlots } from '../src/map/slots.js';

const games = Number(process.argv[2] ?? 100);
const seed0 = Number(process.argv[3] ?? 5000);
const size = (process.argv[4] ?? 'M') as MapSizeClass;
const N = Number(process.argv[5] ?? 10);
const MODE = process.env.MODE ?? 'A';
const SHUFFLE = process.env.SHUFFLE === '1';
const TECH = process.env.TECH ?? 'default';

/** 진단: 맵을 세로(v)/가로(h) 로 뒤집는다 — 스폰 순서·소유자 번호는 그대로. 시뮬레이션의 tileId 순서 의존을 가려낸다 */
function flipMap(m: GeneratedMap, mode: string): GeneratedMap {
  const W = m.width;
  const H = m.height;
  const f = (t: number) => {
    const x = t % W;
    const y = Math.floor(t / W);
    return (mode === 'v' ? H - 1 - y : y) * W + (mode === 'h' ? W - 1 - x : x);
  };
  const mapArr = <T extends Uint8Array | Int32Array>(a: T): T => {
    const r = new (a.constructor as new (n: number) => T)(a.length);
    for (let t = 0; t < a.length; t++) r[f(t)] = a[t];
    return r;
  };
  const terrain = mapArr(m.terrain);
  return {
    ...m,
    terrain,
    isBase: mapArr(m.isBase),
    initialOwners: mapArr(m.initialOwners),
    waterDist: mapArr(m.waterDist),
    baseTiles: m.baseTiles.map(f).sort((a, b) => a - b),
    spawns: m.spawns.map((sp) => ({ playerId: sp.playerId, tileId: f(sp.tileId), homeTileId: f(sp.homeTileId) })),
    graph: new TerrainGraph(m.topology, terrain),
  };
}

botDiag.legacyTie = process.env.LEGACY_TIE === '1';
const cv = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m;
};

const noiseAcc: number[][] = [];
const bySlot: number[][] = Array.from({ length: N }, () => []);
const byId: number[][] = Array.from({ length: N }, () => []);
const winSlot = new Array(N).fill(0);
const winId = new Array(N).fill(0);
const P = MAP_SIZE_PRESETS[size];
for (let k = 0; k < games; k++) {
  const seed = seed0 + k;
  let map = generateMap(seed, P.w, P.h, N);
  if (process.env.FLIP) map = flipMap(map, process.env.FLIP);
  const slotOfId = SHUFFLE ? shuffledSlots(seed, N) : Array.from({ length: N }, (_, i) => i);
  if (process.env.REVERSE_IDS === '1') slotOfId.reverse();
  const setup: PlayerSetup[] = Array.from({ length: N }, (_, i) => ({
    playerId: i + 1,
    isBot: true,
    connected: true,
    spawnSlot: slotOfId[i],
    ...(MODE === 'A' ? { aggressionPermille: 500 } : {}),
    ...(TECH.startsWith('fixed') ? { techStyle: Number(TECH.slice(5)) } : TECH === 'legacy' ? { techStyle: i % 4 } : {}),
  }));
  const state = createGameState(map, setup);
  const sim = new Simulation(state, CivBot);
  while (!sim.finished && state.tick < HARD_TIMEOUT_TICK + 10) sim.step();
  const land = map.totalLandTiles;
  const shares = state.players.slice(1).map((p) => (p.tiles * 100) / land);
  const winner = state.result?.winnerId ?? null;
  for (let i = 0; i < N; i++) {
    byId[i].push(shares[i]);
    bySlot[slotOfId[i]].push(shares[i]);
  }
  if (process.env.DUMP) {
    for (let i = 0; i < N; i++) {
      const t = map.spawns[slotOfId[i]].homeTileId;
      appendFileSync(process.env.DUMP, JSON.stringify({ seed, id: i + 1, slot: slotOfId[i], x: t % P.w, y: Math.floor(t / P.w), share: shares[i], win: winner === i + 1 }) + '\n');
    }
  }
  if (winner) (winId[winner - 1]++, winSlot[slotOfId[winner - 1]]++);
  // 잡음 바닥: 이 판의 점유율을 무작위 라벨에 놓는다
  const lab = shuffledSlots(seed ^ 0x1234, N);
  for (let i = 0; i < N; i++) (noiseAcc[lab[i]] ??= []).push(shares[i]);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(' ');
const slotMeans = bySlot.map(mean);
const idMeans = byId.map(mean);
console.log(`slot-bias: games ${games} seed0 ${seed0} ${size} N=${N} MODE=${MODE} SHUFFLE=${SHUFFLE ? 1 : 0} TECH=${TECH}${process.env.LEGACY_TIE === '1' ? ' LEGACY_TIE' : ''}${process.env.FLIP ? ' FLIP=' + process.env.FLIP : ''}${process.env.REVERSE_IDS === '1' ? ' REVERSE_IDS' : ''}`);
console.log(`slot share % [0..]: ${f(slotMeans)}  CV ${cv(slotMeans).toFixed(3)}`);
console.log(`id   share % [1..]: ${f(idMeans)}  CV ${cv(idMeans).toFixed(3)}`);
console.log(`slot wins: ${winSlot.join(' ')}   id wins: ${winId.join(' ')}`);
console.log(`noise-floor CV ${cv(noiseAcc.map(mean)).toFixed(3)}`);
