import { describe, expect, it } from 'vitest';
import { HARD_TIMEOUT_TICK, SNAPSHOT_FULL_INTERVAL, isClaimable, rleDecode, type S2C_SnapshotFull, type ServerMessage } from '@civwar/shared';
import { generateMapForPlayers } from '../src/map/generate.js';
import { NEUTRAL, createGameState, setTileOwner } from '../src/game/state.js';
import { Simulation } from '../src/game/tick.js';

function makeSim(seed = 4242, N = 8) {
  const map = generateMapForPlayers(seed, N);
  const setup = Array.from({ length: N }, (_, i) => ({ playerId: i + 1, isBot: i > 0, connected: true }));
  return new Simulation(createGameState(map, setup));
}

const types = (msgs: ServerMessage[]) => msgs.map((m) => m.type);

describe('Simulation', () => {
  it('초기 상태: 스폰 블록 소유, 수도 = 기지', () => {
    const sim = makeSim();
    const p1 = sim.state.players[1];
    expect(p1.tiles).toBeGreaterThan(0);
    expect(p1.troopsMilli).toBe(150_000);
    expect(p1.baseTiles).toContain(p1.homeTileId);
  });

  it('매 tick snapshot_delta, 25 tick 마다 snapshot_full', () => {
    const sim = makeSim();
    for (let t = 1; t <= SNAPSHOT_FULL_INTERVAL * 2; t++) {
      const ts = types(sim.step().broadcast);
      expect(ts).toContain('snapshot_delta');
      expect(ts.includes('snapshot_full')).toBe(t % SNAPSHOT_FULL_INTERVAL === 0);
    }
  });

  it('snapshot_full.owners RLE 왕복', () => {
    const sim = makeSim();
    let full: S2C_SnapshotFull | undefined;
    for (let i = 0; i < 25; i++) for (const m of sim.step().broadcast) if (m.type === 'snapshot_full') full = m;
    const owners = rleDecode(full!.owners, sim.state.map.topology.tileCount());
    expect(Buffer.from(owners).equals(Buffer.from(sim.state.owners))).toBe(true);
  });

  it('병력 재생·골드 수입이 돈다 (playerDeltas 5 tick 주기)', () => {
    const sim = makeSim();
    const p = sim.state.players[1];
    const g0 = p.goldMilli;
    let deltas = 0;
    for (let i = 0; i < 50; i++) {
      for (const m of sim.step().broadcast) if (m.type === 'snapshot_delta' && m.playerDeltas.length) deltas++;
    }
    expect(p.troopsMilli).toBeGreaterThan(150_000);
    expect(p.goldMilli).toBeGreaterThan(g0);
    expect(p.goldEarnedMilli).toBe(p.goldMilli - g0);
    expect(deltas).toBe(10);
  });

  it('결정론: 같은 시드·같은 입력 → 같은 출력', () => {
    const a = makeSim(9);
    const b = makeSim(9);
    for (let i = 0; i < 120; i++) {
      if (i === 10) {
        a.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, axis: 1, tier: 1 });
        b.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, axis: 1, tier: 1 });
      }
      expect(JSON.stringify(a.step())).toBe(JSON.stringify(b.step()));
    }
  });

  it('테크 구매: 수락·선행 위반·골드 부족', () => {
    const sim = makeSim();
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, axis: 3, tier: 2 });
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 2, axis: 1, tier: 1 });
    let out = sim.step();
    const acks = out.personal.map((p) => p.msg);
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 1, accepted: false, reason: 'TECH_ORDER' });
    expect(acks).toContainEqual({ type: 'cmd_ack', clientSeq: 2, accepted: false, reason: 'INSUFFICIENT' });
    sim.state.players[1].goldMilli = 1_000_000;
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 3, axis: 1, tier: 1 });
    out = sim.step();
    expect(out.personal.map((p) => p.msg)).toContainEqual({ type: 'cmd_ack', clientSeq: 3, accepted: true });
    expect(out.broadcast.find((m) => m.type === 'tech_purchased')).toMatchObject({ playerId: 1, axis: 1, tier: 1, cost: 450 });
    expect(sim.state.players[1].tech[1]).toBe(1);
  });

  it('깃발 명령: 물 앵커는 WATER 로 거절 (2차 — NOT_IMPLEMENTED 소멸)', () => {
    const sim = makeSim();
    sim.enqueue(1, 1, { type: 'cmd_flag_issue', clientSeq: 5, unit: 1, troops: 50, anchorTileId: 0, originBaseTileId: null });
    const out = sim.step();
    expect(out.personal[0].msg).toMatchObject({ type: 'cmd_ack', clientSeq: 5, accepted: false, reason: 'WATER' });
  });

  it('입력 큐 정렬: (recvSeq, connId, clientSeq)', () => {
    const sim = makeSim();
    sim.state.players[1].goldMilli = 10_000_000;
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 2, axis: 0, tier: 2 });
    sim.enqueue(1, 1, { type: 'cmd_buy_tech', clientSeq: 1, axis: 0, tier: 1 });
    const acks = sim.step().personal.map((p) => p.msg);
    expect(acks[0]).toMatchObject({ clientSeq: 2, accepted: false, reason: 'TECH_ORDER' });
    expect(acks[1]).toMatchObject({ clientSeq: 1, accepted: true });
  });

  it('threshold 승리 (60% 이상) — game_over 는 마지막 메시지', () => {
    const sim = makeSim();
    const st = sim.state;
    const need = Math.ceil((st.map.totalLandTiles * 60) / 100);
    let k = st.players[1].tiles;
    for (let t = 0; t < st.owners.length && k < need; t++) {
      if (st.owners[t] === NEUTRAL && isClaimable(st.map.terrain[t])) {
        setTileOwner(st, t, 1);
        k++;
      }
    }
    const out = sim.step();
    expect(out.broadcast.at(-1)).toMatchObject({ type: 'game_over', winnerId: 1, reason: 'threshold' });
    expect(sim.finished).toBe(true);
  });

  it('탈락 + last_standing', () => {
    const sim = makeSim();
    const st = sim.state;
    for (let t = 0; t < st.owners.length; t++) if (st.owners[t] > 1) setTileOwner(st, t, 1);
    const out = sim.step();
    expect(out.broadcast.filter((m) => m.type === 'player_eliminated').length).toBe(7);
    expect(out.broadcast.at(-1)).toMatchObject({ type: 'game_over', winnerId: 1, reason: 'last_standing' });
  });

  it(`하드 타임아웃 (${HARD_TIMEOUT_TICK} tick) + threshold_update + endgame_rush`, () => {
    const sim = makeSim(5, 8);
    let last: ServerMessage | undefined;
    let thresholdUpdates = 0;
    let rush = 0;
    while (!sim.finished) {
      const out = sim.step();
      for (const m of out.broadcast) {
        if (m.type === 'threshold_update') thresholdUpdates++;
        if (m.type === 'endgame_rush') rush++;
      }
      last = out.broadcast.at(-1);
    }
    expect(sim.state.tick).toBe(HARD_TIMEOUT_TICK);
    expect(last).toMatchObject({ type: 'game_over', reason: 'timeout' });
    expect(thresholdUpdates).toBe(11); // 16분 ~ 26분, 분당 1회
    expect(rush).toBe(1);
  });
});
