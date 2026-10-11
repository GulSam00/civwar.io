/**
 * QA 전용 (커밋 금지) — 실제 명령 경로(Simulation.enqueue → 1단계)로 거절 코드·희귀 이벤트를 하나씩 유발한다.
 * 모든 출력 메시지는 JSON 왕복 후 문서 스키마(qa-schema.ts)로 검사한다.
 * 실행: npx tsx server/scripts/qa-scenarios.ts
 */
import { ALLIANCE_CUTOFF_TICK, POSTURE, TERRAIN, UNIT, isClaimable, type C2S_GameCommand } from '@civwar/shared';
import { createGameState, makeFlag, setTileOwner, NEUTRAL, type GameState } from '../src/game/state.js';
import { IdleBot, Simulation } from '../src/game/tick.js';
import { generateMap } from '../src/map/generate.js';
import { minDistFromTerritory } from '../src/game/rules.js';
import { validateMessage } from './qa-schema.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
const schemaErrs: string[] = [];
const seen = new Map<string, number>();
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
}

function setup(seed = 4242, N = 4): { s: GameState; sim: Simulation } {
  const map = generateMap(seed, 72, 42, N);
  const s = createGameState(map, Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: false, connected: true })));
  return { s, sim: new Simulation(s, IdleBot) };
}
let seqC = 0;
function stepWith(sim: Simulation, cmds: [number, Record<string, unknown>][]): { acks: any[]; ev: any[] } {
  const seqs: number[] = [];
  for (const [pid, c] of cmds) {
    const clientSeq = ++seqC;
    seqs.push(clientSeq);
    sim.enqueue(pid, pid, { ...c, clientSeq } as unknown as C2S_GameCommand);
  }
  const out = sim.step();
  const msgs = [...out.broadcast, ...out.personal.map((p) => p.msg)].map((m) => JSON.parse(JSON.stringify(m)));
  for (const m of msgs) {
    seen.set(m.type, (seen.get(m.type) ?? 0) + 1);
    for (const e of validateMessage(m)) schemaErrs.push(`${m.type}: ${e}`);
  }
  const acks = seqs.map((q) => msgs.find((m) => m.type === 'cmd_ack' && m.clientSeq === q));
  return { acks, ev: msgs.filter((m) => m.type !== 'cmd_ack') };
}
const reason = (a: any) => (a?.accepted ? 'ACCEPT' : a?.reason);
function expect(name: string, a: any, want: string) {
  check(`${name} → ${want}`, reason(a) === want, `실제 ${reason(a)}`);
}

// 타일 찾기
function findTile(s: GameState, pred: (t: number) => boolean): number {
  for (let t = 0; t < s.owners.length; t++) if (pred(t)) return t;
  throw new Error('tile not found');
}

// ───────── 1. 깃발 발령·재지정·회수·태세 거절 ─────────
{
  const { s, sim } = setup();
  const home = s.players[1].homeTileId;
  const near = (t: number, d: number) => s.graph.distance(home, t) === d && isClaimable(s.map.terrain[t]) && s.owners[t] === NEUTRAL && !s.map.isBase[t];
  const n5 = findTile(s, (t) => near(t, 5));
  const n6 = findTile(s, (t) => near(t, 6));
  const water = findTile(s, (t) => s.map.terrain[t] === TERRAIN.DEEP);
  const far = findTile(s, (t) => isClaimable(s.map.terrain[t]) && minDistFromTerritory(s, 1, t) > 40);
  const neutralBase = findTile(s, (t) => !!s.map.isBase[t] && s.owners[t] === NEUTRAL);
  const ownNonBase = findTile(s, (t) => s.owners[t] === 1 && !s.map.isBase[t]);
  const issue = (anchor: number, troops = 40, extra: Record<string, unknown> = {}) => ({ type: 'cmd_flag_issue', unit: UNIT.SWORD, troops, anchorTileId: anchor, originBaseTileId: null, ...extra });

  let r = stepWith(sim, [
    [1, issue(n5, 39)],
    [1, issue(water)],
    [1, issue(far)],
    [1, issue(n5, 100000)],
    [1, issue(n5, 40, { originBaseTileId: ownNonBase })],
    [1, issue(n5, 40, { originBaseTileId: neutralBase })],
    [1, issue(n5, 40, { unit: 5 })],
    [1, issue(99999999)],
    [9, issue(n5)],
  ]);
  expect('issue troops 39', r.acks[0], 'TOO_SMALL');
  expect('issue 깊은 물', r.acks[1], 'WATER');
  expect('issue 거리 > 40', r.acks[2], 'OUT_OF_RANGE');
  expect('issue 병력 과대', r.acks[3], 'INSUFFICIENT');
  expect('issue originBase=비기지', r.acks[4], 'NOT_BASE');
  expect('issue originBase=중립 기지', r.acks[5], 'NOT_OWNED_BASE');
  expect('issue unit 5 (sim 직접 — WS 에선 형식 검증이 먼저)', r.acks[6], 'BAD_UNIT');
  expect('issue tileId 범위 밖', r.acks[7], 'BAD_REQUEST');
  expect('없는 playerId 9', r.acks[8], 'NOT_IN_GAME');

  r = stepWith(sim, [[1, issue(n5)], [1, issue(n6)], [1, issue(n5)], [1, issue(n5)], [1, issue(water, 39)]]);
  expect('발령 1', r.acks[0], 'ACCEPT');
  check('발령 ack 에 flagId·posture(ATTACK=0)', r.acks[0]?.flagId === 1 && r.acks[0]?.posture === 0, JSON.stringify(r.acks[0]));
  const fi = r.ev.find((e) => e.type === 'flag_issued' && e.flagId === 1);
  check('flag_issued 동반 + 중립 앵커 targetOwnerId 0', fi?.targetOwnerId === 0 && fi?.posture === 0, JSON.stringify(fi));
  expect('발령 2', r.acks[1], 'ACCEPT');
  expect('발령 3', r.acks[2], 'ACCEPT');
  expect('4번째 발령 (cap 3)', r.acks[3], 'NO_SLOT');
  expect('cap 초과 + 물 + 39 → 순서상 NO_SLOT 먼저', r.acks[4], 'NO_SLOT');
  const delta = r.ev.find((e) => e.type === 'snapshot_delta');
  check('새 깃발 첫 tick 델타 flagMoves·flagStats·flagFlags', [1, 2, 3].every((id) => delta.flagStats.some((x: any) => x[0] === id) && delta.flagFlags.some((x: any) => x[0] === id) && delta.flagMoves.some((x: any) => x[0] === id)), JSON.stringify({ m: delta.flagMoves, st: delta.flagStats, ff: delta.flagFlags }));

  r = stepWith(sim, [
    [1, { type: 'cmd_flag_retarget', flagId: 999, anchorTileId: n6 }],
    [2, { type: 'cmd_flag_retarget', flagId: 1, anchorTileId: n6 }],
    [2, { type: 'cmd_flag_recall', flagId: 1 }],
    [2, { type: 'cmd_set_posture', flagId: 1, posture: 1 }],
    [1, { type: 'cmd_flag_retarget', flagId: 1, anchorTileId: n6 }],
    [1, { type: 'cmd_flag_retarget', flagId: 1, anchorTileId: n5 }],
    [1, { type: 'cmd_set_posture', flagId: 2, posture: 0 }],
    [1, { type: 'cmd_set_posture', flagId: 2, posture: 1 }],
    [1, { type: 'cmd_set_posture', flagId: 2, posture: 0 }],
    [1, { type: 'cmd_flag_recall', flagId: 3 }],
    [1, { type: 'cmd_flag_retarget', flagId: 3, anchorTileId: n6 }],
    [1, { type: 'cmd_flag_recall', flagId: 3 }],
    [1, { type: 'cmd_flag_retarget', flagId: 2, anchorTileId: water }],
  ]);
  expect('retarget 없는 flagId', r.acks[0], 'NO_FLAG');
  expect('남의 깃발 retarget', r.acks[1], 'NO_FLAG');
  expect('남의 깃발 recall', r.acks[2], 'NO_FLAG');
  expect('남의 깃발 set_posture', r.acks[3], 'NO_FLAG');
  expect('retarget', r.acks[4], 'ACCEPT');
  expect('경직 중 재재지정', r.acks[5], 'LOCKED');
  expect('같은 태세', r.acks[6], 'SAME_POSTURE');
  expect('태세 전환', r.acks[7], 'ACCEPT');
  expect('쿨타임 중 전환', r.acks[8], 'POSTURE_COOLDOWN');
  expect('recall', r.acks[9], 'ACCEPT');
  expect('귀환 중 retarget', r.acks[10], 'RETURNING');
  expect('귀환 중 recall', r.acks[11], 'RETURNING');
  expect('retarget 물 앵커', r.acks[12], 'WATER');
  const pc = r.ev.find((e) => e.type === 'flag_posture_changed');
  check('flag_posture_changed cooldownUntilTick = t+25, auto:false', pc && pc.cooldownUntilTick === pc.tick + 25 && pc.auto === false, JSON.stringify(pc));
  check('set_posture ack.posture = 새 태세', r.acks[7]?.posture === 1, JSON.stringify(r.acks[7]));
  check('recall ack 에 flagId/posture (문서: 회수도 포함)', r.acks[9]?.flagId === 3 && r.acks[9]?.posture !== undefined, JSON.stringify(r.acks[9]));
  const rt = r.ev.find((e) => e.type === 'flag_retargeted');
  check('flag_retargeted resumeTick = t+15', rt?.resumeTick === rt?.tick + 15, JSON.stringify(rt));

  // 테크 (v4.3: nodeId — 0 MIL-1, 1 MIL-2A, 15 MOB-1, 5 ECO-1, 3 MIL-3A)
  s.players[1].goldMilli = 100_000;
  r = stepWith(sim, [
    [1, { type: 'cmd_buy_tech', nodeId: 1 }],
    [1, { type: 'cmd_buy_tech', nodeId: 0 }],
  ]);
  expect('테크 선행(부모) 미보유', r.acks[0], 'PREREQ_MISSING');
  expect('테크 골드 부족(100 < 160)', r.acks[1], 'INSUFFICIENT');
  s.players[1].goldMilli = 10_000_000;
  r = stepWith(sim, [[1, { type: 'cmd_buy_tech', nodeId: 15 }], [1, { type: 'cmd_buy_tech', nodeId: 15 }], [1, { type: 'cmd_buy_tech', nodeId: 5 }], [1, { type: 'cmd_buy_tech', nodeId: 3 }]]);
  expect('테크 구매', r.acks[0], 'ACCEPT');
  expect('이미 보유한 노드', r.acks[1], 'ALREADY_OWNED');
  expect('T3 부모(MIL-2A) 미보유', r.acks[3], 'PREREQ_MISSING');
  const tp = r.ev.filter((e) => e.type === 'tech_purchased');
  check('cost = floor(base × (1000 + 60×구매수)/1000): 160 → 169', tp[0]?.cost === 160 && tp[1]?.cost === 169, JSON.stringify(tp));
  check('tech_purchased.nodeId·techMask', tp[0]?.nodeId === 15 && tp[1]?.techMask === ((1 << 15) | (1 << 5)), JSON.stringify(tp));
  check('cmd_buy_tech 성공 ack 에 flagId/posture 없음', r.acks[0] && !('flagId' in r.acks[0]), JSON.stringify(r.acks[0]));
}

// ───────── 2. 동맹 ─────────
{
  const { s, sim } = setup(4242, 4);
  let r = stepWith(sim, [
    [1, { type: 'cmd_ally_propose', targetPlayerId: 1 }],
    [1, { type: 'cmd_ally_propose', targetPlayerId: 7 }],
    [1, { type: 'cmd_ally_propose', targetPlayerId: 2 }],
    [1, { type: 'cmd_ally_propose', targetPlayerId: 2 }],
    [3, { type: 'cmd_ally_respond', proposalId: 1, accept: true }],
    [2, { type: 'cmd_ally_propose', targetPlayerId: 1 }],
  ]);
  expect('자기 자신에게 제안', r.acks[0], 'BAD_TARGET');
  expect('없는 플레이어', r.acks[1], 'BAD_TARGET');
  expect('제안', r.acks[2], 'ACCEPT');
  expect('같은 상대 중복', r.acks[3], 'ALLY_PENDING');
  expect('내게 온 것 아닌 제안 응답', r.acks[4], 'NO_PROPOSAL');
  expect('상호 제안 → 즉시 성립', r.acks[5], 'ACCEPT');
  const evTypes = r.ev.map((e) => e.type);
  check('상호 제안: ally_proposed → ally_formed → ally_proposal_closed(formed)', evTypes.includes('ally_formed') && r.ev.some((e) => e.type === 'ally_proposal_closed' && e.reason === 'formed'), evTypes.join(','));
  r = stepWith(sim, [
    [1, { type: 'cmd_ally_propose', targetPlayerId: 2 }],
    [1, { type: 'cmd_ally_break', allyPlayerId: 2 }],
    [1, { type: 'cmd_ally_break', allyPlayerId: 3 }],
    [1, { type: 'cmd_flag_issue', unit: 1, troops: 40, anchorTileId: s.players[2].homeTileId, originBaseTileId: null }],
    [3, { type: 'cmd_ally_propose', targetPlayerId: 4 }],
    [4, { type: 'cmd_ally_respond', proposalId: 2, accept: false }],
  ]);
  expect('이미 동맹', r.acks[0], 'ALREADY_ALLIED');
  expect('300 tick 전 파기', r.acks[1], 'MIN_DURATION');
  expect('동맹 아닌 상대 파기', r.acks[2], 'NOT_ALLIED');
  const ally = reason(r.acks[3]);
  check('동맹 땅 앵커 발령 → ALLIED (또는 OUT_OF_RANGE 가 먼저)', ally === 'ALLIED' || ally === 'OUT_OF_RANGE', `실제 ${ally}`);
  expect('제안(3→4)', r.acks[4], 'ACCEPT');
  expect('거절 응답 = accepted:true', r.acks[5], 'ACCEPT');
  check('declined → ally_proposal_closed(declined)', r.ev.some((e) => e.type === 'ally_proposal_closed' && e.reason === 'declined'), '');
  // 1-3, 1-4 로 동맹 상한 → 5번째 없음, ALLY_LIMIT 은 1 이 이미 2개일 때
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 3 }]]);
  r = stepWith(sim, [[3, { type: 'cmd_ally_propose', targetPlayerId: 1 }]]);
  expect('1-3 성립', r.acks[0], 'ACCEPT');
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 4 }]]);
  expect('동맹 2개 보유 중 3번째 제안', r.acks[0], 'ALLY_LIMIT');
  // 생존자 1,2,3,4 중 4 는 동맹 없음 → lockout 아님. 4 를 탈락시켜 lockout 유발 + ELIMINATED
  for (let t = 0; t < s.owners.length; t++) if (s.owners[t] === 4) setTileOwner(s, t, 1);
  r = stepWith(sim, [[4, { type: 'cmd_ally_propose', targetPlayerId: 1 }]]);
  expect('탈락 처리 tick 의 명령(탈락은 12단계)', r.acks[0], 'ALLY_LIMIT');
  const pe = r.ev.find((e) => e.type === 'player_eliminated');
  check('player_eliminated byPlayerId = 마지막으로 빼앗은 플레이어(1)', pe?.playerId === 4 && pe?.byPlayerId === 1, JSON.stringify(pe));
  r = stepWith(sim, [[4, { type: 'cmd_ally_propose', targetPlayerId: 1 }]]);
  expect('탈락자 명령', r.acks[0], 'ELIMINATED');
  const lk = r.ev.find((e) => e.type === 'alliance_lockout');
  check('생존자 전원 동맹 → alliance_lockout(countdown, forceDissolveTick = t+150)', lk?.phase === 'countdown' && lk.forceDissolveTick === lk.tick + 150, JSON.stringify(lk));
  let dissolved: any = null;
  let broken = 0;
  for (let i = 0; i < 160 && !dissolved; i++) {
    r = stepWith(sim, []);
    dissolved = r.ev.find((e) => e.type === 'alliance_lockout' && e.phase === 'dissolved');
    broken += r.ev.filter((e) => e.type === 'ally_broken' && e.reason === 'lockout').length;
  }
  check('lockout dissolved + ally_broken(lockout) ×2 + freezeUntilTick = t+300', dissolved && broken === 2 && dissolved.freezeUntilTick === dissolved.tick + 300, JSON.stringify(dissolved) + ` broken=${broken}`);
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 2 }]]);
  expect('freeze 중 제안', r.acks[0], 'ALLY_FROZEN');
  const full = (sim as any).state && s;
  void full;
  for (let i = 0; i < 300; i++) stepWith(sim, []);
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 2 }]]);
  expect('freeze 후 제안', r.acks[0], 'ACCEPT');
  let exp: any = null;
  for (let i = 0; i < 155 && !exp; i++) exp = stepWith(sim, []).ev.find((e) => e.type === 'ally_proposal_closed' && e.reason === 'expired');
  check('제안 150 tick 만료 → ally_proposal_closed(expired)', !!exp, JSON.stringify(exp));
  // cutoff
  s.tick = ALLIANCE_CUTOFF_TICK - 1;
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 2 }]]);
  expect(`t=${ALLIANCE_CUTOFF_TICK} 제안`, r.acks[0], 'ALLY_CUTOFF');
}

// ───────── 3. 동맹 BREAKING → cooldown_elapsed, lockout cancelled ─────────
{
  const { s, sim } = setup(4242, 3);
  stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 2 }], [2, { type: 'cmd_ally_propose', targetPlayerId: 1 }]]);
  for (let i = 0; i < 300; i++) stepWith(sim, []);
  let r = stepWith(sim, [[1, { type: 'cmd_ally_break', allyPlayerId: 2 }]]);
  expect('300 tick 후 파기', r.acks[0], 'ACCEPT');
  const bs = r.ev.find((e) => e.type === 'ally_break_started');
  check('ally_break_started breakAtTick = t+150', bs?.breakAtTick === bs?.tick + 150, JSON.stringify(bs));
  r = stepWith(sim, [[1, { type: 'cmd_ally_propose', targetPlayerId: 3 }], [3, { type: 'cmd_ally_propose', targetPlayerId: 1 }]]);
  r = stepWith(sim, [[1, { type: 'cmd_ally_break', allyPlayerId: 2 }]]);
  expect('BREAKING 재파기', r.acks[0], 'NOT_ALLIED');
  let cancelled: any = null;
  let cool: any = null;
  for (let i = 0; i < 160; i++) {
    const ev = stepWith(sim, []).ev;
    cancelled ??= ev.find((e) => e.type === 'alliance_lockout' && e.phase === 'cancelled');
    cool ??= ev.find((e) => e.type === 'ally_broken' && e.reason === 'cooldown_elapsed');
  }
  check('BREAKING 해제 → ally_broken(cooldown_elapsed) + lockout cancelled', !!cool && !!cancelled, JSON.stringify({ cool, cancelled }));
  void s;
}

// ───────── 4. 전투 거절 (IN_COMBAT / DISENGAGING / ROUTED) + 대표 전투 #7 ─────────
{
  const { s, sim } = setup(4242, 4);
  const open = (avoid: number[]) => findTile(s, (c) => {
    const d = s.graph.disk(c, 3);
    return d.length === 25 && d.every((x) => isClaimable(s.map.terrain[x]) && s.owners[x] === NEUTRAL && !s.map.isBase[x]) && avoid.every((a) => s.graph.distance(a, c) > 10);
  });
  const c1 = open([]);
  const c2 = open([c1]);
  s.map.terrain[c1] = TERRAIN.PLAIN;
  s.map.terrain[c1 + 1] = TERRAIN.PLAIN;
  s.map.terrain[c2] = TERRAIN.PLAIN;
  s.map.terrain[c2 + 1] = TERRAIN.HILLS;
  const mk = (id: number, owner: number, unit: number, pos: number, posture: number) => {
    const f = makeFlag({ id, ownerId: owner, slotIndex: 0, unit: unit as 0, troopsMilli: 1_000_000, initialTroops: 1000, posTileId: pos, anchorTileId: pos, originTileId: s.players[owner].homeTileId });
    f.posture = posture as 0;
    f.state = 'ENGAGED';
    f.targetOwnerId = posture === POSTURE.DEFEND ? 254 : NEUTRAL;
    s.flags.push(f);
  };
  mk(1, 1, UNIT.SWORD, c1, POSTURE.ATTACK);
  mk(2, 2, UNIT.SPEAR, c1 + 1, POSTURE.DEFEND);
  mk(3, 3, UNIT.SWORD, c2, POSTURE.ATTACK);
  mk(4, 4, UNIT.SPEAR, c2 + 1, POSTURE.DEFEND);
  s.nextFlagId = 5;
  let r = stepWith(sim, []);
  check('교전 개시 tick 1 → combat_started ×2', r.ev.filter((e) => e.type === 'combat_started').length === 2, r.ev.map((e) => e.type).join(','));
  r = stepWith(sim, [
    [1, { type: 'cmd_set_posture', flagId: 1, posture: 1 }],
    [4, { type: 'cmd_flag_recall', flagId: 4 }],
  ]);
  expect('전투 중 태세 전환', r.acks[0], 'IN_COMBAT');
  expect('전투 중 회수 → 이탈 대기로 수락', r.acks[1], 'ACCEPT');
  const ds = r.ev.find((e) => e.type === 'flag_disengage_started');
  check('flag_disengage_started untilTick = t+15', ds?.untilTick === ds?.tick + 15, JSON.stringify(ds));
  r = stepWith(sim, [[4, { type: 'cmd_set_posture', flagId: 4, posture: 0 }]]);
  // v4.2 [A-62]: 회수로 이탈 대기 중인 깃발은 이미 RETURNING → RETURNING 이 DISENGAGING 보다 먼저 (재지정 이탈 대기는 여전히 DISENGAGING)
  expect('이탈 대기(회수) 중 태세 전환', r.acks[0], 'RETURNING');
  let dg: any = null;
  let t17 = { a: 0, d: 0 };
  const hist: string[] = [];
  for (let i = 0; i < 20 && !dg; i++) {
    const ev = stepWith(sim, []).ev;
    dg = ev.find((e) => e.type === 'flag_disengaged' && e.flagId === 4);
    hist.push(s.tick + ':' + Math.floor((s.flags.find((f) => f.id === 3)?.troopsMilli ?? 0) / 1000) + '/' + Math.floor((s.flags.find((f) => f.id === 4)?.troopsMilli ?? 0) / 1000));
    if (dg) {
      const f3 = s.flags.find((f) => f.id === 3);
      const f4 = s.flags.find((f) => f.id === 4);
      t17 = { a: Math.floor((f3?.troopsMilli ?? 0) / 1000), d: Math.floor((f4?.troopsMilli ?? 0) / 1000) };
    }
  }
  check('flag_disengaged(broke_away) at untilTick', dg?.reason === 'broke_away' && dg.tick === ds?.untilTick, JSON.stringify(dg));
  check('GDD 4.15 대표 전투 #7 (창 언덕 즉시 회수): 3초 후 수비 ≈780 / 공격 ≈814 (−220 / −186)', Math.abs(t17.d - 780) <= 2 && Math.abs(t17.a - 814) <= 2, `서버 수비 ${t17.d} / 공격 ${t17.a}  이력(tick:공/수) ${hist.join(' ')}`);
  let routed: any = null;
  for (let i = 0; i < 150 && !routed; i++) routed = stepWith(sim, []).ev.find((e) => e.type === 'flag_routed' && e.flagId === 1);
  check('검→창 평원: 공격 깃발 패주 flag_routed', !!routed, JSON.stringify(routed));
  r = stepWith(sim, [
    [1, { type: 'cmd_flag_retarget', flagId: 1, anchorTileId: c1 + 2 }],
    [1, { type: 'cmd_flag_recall', flagId: 1 }],
    [1, { type: 'cmd_set_posture', flagId: 1, posture: 1 }],
  ]);
  expect('패주 깃발 retarget', r.acks[0], 'ROUTED');
  expect('패주 깃발 recall', r.acks[1], 'ROUTED');
  expect('패주 깃발 set_posture', r.acks[2], 'ROUTED');
}

// ───────── 5. 진척도 감소 decayed / flag_stalled (AP 0 깃발을 인위 구성) ─────────
{
  const { s, sim } = setup(4242, 4);
  const home = s.players[1].homeTileId;
  const X = findTile(s, (t) => s.owners[t] === NEUTRAL && isClaimable(s.map.terrain[t]) && s.graph.distance(home, t) === 2);
  // v4.2: 공격 = 깃발 옆 칸 → X 에 인접한 내 땅 칸에 세운다 (수도 칸이면 옆 칸이 전부 내 땅이라 IDLE)
  const P = s.graph.neighbors(X).find((n) => s.owners[n] === 1)!;
  const f = makeFlag({ id: 1, ownerId: 1, slotIndex: 0, unit: 1, troopsMilli: 100_000, initialTroops: 0, posTileId: P, anchorTileId: X, originTileId: home });
  f.state = 'ENGAGED';
  f.progressMilli = 100;
  f.targetTileId = X;
  s.flags.push(f);
  s.nextFlagId = 2;
  let dec: any = null;
  let stl: any = null;
  const pcts: number[] = [];
  for (let i = 0; i < 30; i++) {
    const ev = stepWith(sim, []).ev;
    dec ??= ev.find((e) => e.type === 'flag_progress_lost' && e.cause === 'decayed');
    stl ??= ev.find((e) => e.type === 'flag_stalled');
    const d = ev.find((e) => e.type === 'snapshot_delta');
    const p = d.flagProgress.find((x: any) => x[0] === 1);
    if (i < 6) pcts.push(p ? p[1] : -1);
  }
  check('progress 100 → 20/tick 감소, 5 tick 째 decayed, targetTileId 유지', dec?.tick === 5 && dec.tileId === X && s.flags[0]?.targetTileId === X, JSON.stringify(dec) + ` flagProgress ${pcts}`);
  check('AP 0 ENGAGED 공격 깃발 25 tick → flag_stalled(tileId=targetTileId)', stl && stl.tileId === X && stl.tick === 26, JSON.stringify(stl));
}

console.log('\n=== qa-scenarios ===');
// ───────── 6. 귀환 중(RETURNING) 깃발이 추격당해 교전 → 다시 빠질 수 있는가 (GDD 4.15 g "재교전 … 명령을 다시 내리고 3초") ─────────
{
  const { s, sim } = setup(4242, 4);
  const c = findTile(s, (x) => {
    const d = s.graph.disk(x, 3);
    return d.length === 25 && d.every((y) => isClaimable(s.map.terrain[y]) && s.owners[y] === NEUTRAL && !s.map.isBase[y]);
  });
  const mk = (id: number, owner: number, unit: number, pos: number, posture: number, st: 'ENGAGED' | 'RETURNING') => {
    const f = makeFlag({ id, ownerId: owner, slotIndex: 0, unit: unit as 0, troopsMilli: 1_000_000, initialTroops: 1000, posTileId: pos, anchorTileId: pos, originTileId: s.players[owner].homeTileId });
    f.posture = posture as 0;
    f.state = st;
    if (st === 'RETURNING') { f.returnTileId = s.players[owner].homeTileId; f.nextTileId = f.posTileId; }
    s.flags.push(f);
    return f;
  };
  const ret = mk(1, 1, UNIT.SPEAR, c, POSTURE.DEFEND, 'RETURNING');
  mk(2, 2, UNIT.CAVALRY, c + 1, POSTURE.ATTACK, 'ENGAGED');
  s.nextFlagId = 3;
  stepWith(sim, []);
  check('[전제] 귀환 중 깃발이 공격 깃발과 인접 → 교전(inCombat, RETURNING)', ret.inCombat && ret.state === 'RETURNING', `inCombat=${ret.inCombat} state=${ret.state}`);
  const r = stepWith(sim, [[1, { type: 'cmd_flag_recall', flagId: 1 }], [1, { type: 'cmd_flag_retarget', flagId: 1, anchorTileId: s.players[1].homeTileId }]]);
  // v4.2 [A-62]: 귀환 취소 불가 — 명령은 전부 RETURNING 거절, 대신 서버가 자동 이탈 대기 (QA I-2 → 사용자 결정으로 대체)
  check('v4.2 [A-62] 교전 중 귀환 깃발 명령 → RETURNING 거절, 자동 이탈 대기 중', reason(r.acks[0]) === 'RETURNING' && reason(r.acks[1]) === 'RETURNING' && ret.disengageUntilTick !== null, `recall ${reason(r.acks[0])}, retarget ${reason(r.acks[1])}, disengageUntilTick=${ret.disengageUntilTick}`);
  let moved = false;
  const p0 = ret.posTileId;
  for (let i = 0; i < 40; i++) { stepWith(sim, []); if (ret.posTileId !== p0) moved = true; }
  check('[관찰] 40 tick 동안 귀환 깃발 이동 여부', true, `moved=${moved}, troops=${Math.floor(ret.troopsMilli / 1000)}, routed=${ret.routed}`);
}
console.log('\n--- 6 ---');
for (const r of results.slice(-3)) console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name} — ${r.detail}`);

// ───────── 요약 (섹션 6 포함) ─────────
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\n문서 스키마 위반 ${schemaErrs.length}`);
for (const e of [...new Set(schemaErrs)].slice(0, 20)) console.log('  ' + e);
console.log(`수신 type: ${[...seen.keys()].sort().join(', ')}`);
console.log(`\n${results.length - fail}/${results.length} 통과`);
