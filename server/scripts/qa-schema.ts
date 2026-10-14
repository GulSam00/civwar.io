/**
 * QA 전용 — _workspace/02_backend_protocol.md (프론트 신뢰 소스) 를 손으로 옮긴 런타임 스키마.
 * shared/src/protocol.ts 가 아니라 "문서"를 기준으로 한다: 문서와 실제 JSON 이 다르면 FAIL.
 * 필드 규칙: 'int' | 'num' | 'str' | 'bool' | 'int|null' | ['enum', ...values] | 함수(커스텀 검사)
 * 키 이름 끝 '?' = 옵셔널.
 */
type Rule = string | readonly unknown[] | ((v: unknown, path: string, errs: string[]) => void);
type Shape = Record<string, Rule>;

const isInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function checkRule(rule: Rule, v: unknown, path: string, errs: string[]): void {
  if (typeof rule === 'function') return rule(v, path, errs);
  if (Array.isArray(rule)) {
    if (rule[0] !== 'enum') throw new Error('bad rule');
    if (!rule.slice(1).includes(v as never)) errs.push(`${path}: enum 위반 ${JSON.stringify(v)} ∉ ${JSON.stringify(rule.slice(1))}`);
    return;
  }
  const ok =
    rule === 'int' ? isInt(v) :
    rule === 'num' ? isNum(v) :
    rule === 'str' ? typeof v === 'string' :
    rule === 'bool' ? typeof v === 'boolean' :
    rule === 'int|null' ? v === null || isInt(v) :
    rule === 'str|null' ? v === null || typeof v === 'string' :
    rule === 'any' ? true : (() => { throw new Error(`rule ${rule}`); })();
  if (!ok) errs.push(`${path}: ${rule} 기대, 실제 ${JSON.stringify(v)?.slice(0, 60)}`);
}

export function obj(shape: Shape) {
  return (v: unknown, path: string, errs: string[]) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return void errs.push(`${path}: object 기대`);
    const o = v as Record<string, unknown>;
    const known = new Set<string>();
    for (const [k0, rule] of Object.entries(shape)) {
      const opt = k0.endsWith('?');
      const k = opt ? k0.slice(0, -1) : k0;
      known.add(k);
      if (!(k in o)) {
        if (!opt) errs.push(`${path}.${k}: 누락 (문서 필수)`);
        continue;
      }
      checkRule(rule, o[k], `${path}.${k}`, errs);
    }
    for (const k of Object.keys(o)) if (!known.has(k)) errs.push(`${path}.${k}: 문서에 없는 여분 필드`);
  };
}
export function arr(item: Rule, len?: number) {
  return (v: unknown, path: string, errs: string[]) => {
    if (!Array.isArray(v)) return void errs.push(`${path}: array 기대`);
    if (len !== undefined && v.length !== len) errs.push(`${path}: 길이 ${len} 기대, 실제 ${v.length}`);
    v.forEach((x, i) => checkRule(item, x, `${path}[${i}]`, errs));
  };
}
export function tuple(...items: Rule[]) {
  return (v: unknown, path: string, errs: string[]) => {
    if (!Array.isArray(v) || v.length !== items.length) return void errs.push(`${path}: 길이 ${items.length} 튜플 기대, 실제 ${JSON.stringify(v)}`);
    items.forEach((r, i) => checkRule(r, v[i], `${path}[${i}]`, errs));
  };
}
const range = (lo: number, hi: number) => (v: unknown, path: string, errs: string[]) => {
  if (!isInt(v) || (v as number) < lo || (v as number) > hi) errs.push(`${path}: 정수 ${lo}..${hi} 기대, 실제 ${JSON.stringify(v)}`);
};

const POSTURE = ['enum', 0, 1] as const;
const UNIT = ['enum', 0, 1, 2] as const;
const FLAG_STATE = ['enum', 'MARCHING', 'ENGAGED', 'RETURNING', 'IDLE'] as const;
const DIFF = ['enum', 'EASY', 'NORMAL', 'HARD'] as const;
/** 문서 §6.1 */
export const DOC_REJECT = ['ELIMINATED', 'INSUFFICIENT', 'BAD_REQUEST', 'NOT_IN_GAME', 'PREREQ_MISSING', 'ALREADY_OWNED', 'RATE_LIMITED', 'NO_SLOT', 'BAD_UNIT', 'WATER', 'ALLIED', 'OUT_OF_RANGE', 'TOO_SMALL', 'NO_FLAG', 'RETURNING', 'LOCKED', 'NOT_BASE', 'NOT_OWNED_BASE', 'ROUTED', 'IN_COMBAT', 'DISENGAGING', 'POSTURE_COOLDOWN', 'SAME_POSTURE', 'BAD_TARGET', 'ALLY_LIMIT', 'ALLY_CUTOFF', 'ALLY_FROZEN', 'ALREADY_ALLIED', 'ALLY_PENDING', 'NO_PROPOSAL', 'NOT_ALLIED', 'MIN_DURATION'] as const;
/** 문서 §6.2 */
export const DOC_ERROR = ['BAD_MESSAGE', 'BAD_VERSION', 'NOT_HELLO', 'ALREADY_HELLO', 'BAD_NICKNAME', 'BAD_TARGET_PLAYERS', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_IN_PROGRESS', 'ALREADY_IN_ROOM', 'NOT_IN_ROOM', 'NOT_HOST', 'NOT_LOBBY', 'RATE_LIMITED', 'BAD_ROOM_OPTIONS', 'MAP_NOT_FOUND', 'NOT_ENOUGH_PLAYERS'] as const;

const mapChoice = (v: unknown, path: string, errs: string[]) => {
  const m = v as Record<string, unknown>;
  if (m?.kind === 'random') obj({ kind: 'str', size: ['enum', 'S', 'M', 'L'], water: obj({ waterMode: ['enum', 'BORDER_ONLY', 'SHALLOW_QUOTA'], shallowPermille: range(0, 1000) }) })(v, path, errs);
  else if (m?.kind === 'preset') obj({ kind: 'str', mapId: 'str' })(v, path, errs);
  else errs.push(`${path}.kind: random|preset 기대`);
};

const flagSnap = obj({
  id: 'int', ownerId: range(1, 12), slotIndex: range(0, 6), unit: UNIT, posture: POSTURE, troops: 'int', posTileId: 'int', anchorTileId: 'int',
  targetOwnerId: (v, p, e) => { if (!isInt(v) || !((v as number) <= 12 || v === 254)) e.push(`${p}: 0..12|254 기대 ${v}`); },
  state: FLAG_STATE, targetTileId: 'int|null', progressPct: range(0, 99), stalled: 'bool', inCombat: 'bool', routed: 'bool', blocked: 'bool',
  disengaging: 'bool', postureCooldownUntilTick: 'int', disengageUntilTick: 'int|null', breakaway: 'bool', halted: 'bool', returnBaseTileId: 'int|null',
  pendingPosture: (v, p, e) => { if (v !== null && v !== 0 && v !== 1) e.push(`${p}: 0|1|null 기대 ${v}`); }, // v4.4 §21
});
/** v4.4 §21 */
const production = obj({
  playerId: range(1, 12),
  regions: arr(obj({ baseTileId: 'int|null', tiles: 'int', prodPm: range(0, 1000), troopsPerSecMilli: 'int', goldGrossPerSecMilli: 'int', goldNetPerSecMilli: 'int' })),
});

export const DOC_SCHEMA: Record<string, Shape> = {
  welcome: {
    sessionId: 'str', playerToken: 'str', serverTick: 'int', protocolVersion: 'int', tickMs: 'int', resumed: 'bool',
    officialMaps: arr(obj({ id: 'str', name: obj({ ko: 'str', en: 'str' }), sizeClass: ['enum', 'S', 'M', 'L'], players: obj({ min: 'int', recommendedMin: 'int', recommendedMax: 'int', max: 'int' }), checksum: 'str' })),
  },
  room_state: {
    roomId: 'str', roomCode: 'str', isPublic: 'bool', phase: ['enum', 'LOBBY', 'COUNTDOWN', 'IN_GAME', 'GAME_OVER'], hostId: 'int|null',
    settings: obj({
      map: mapChoice, maxPlayers: range(2, 12), botCount: range(0, 11), botDifficulty: DIFF, mapMaxPlayers: range(2, 12),
      recommended: tuple('int', 'int'),
      pacingNote: (v, p, e) => { if (typeof v !== 'string' || !/^(guaranteed|timeout_likely|estimate:\d+)$/.test(v)) e.push(`${p}: pacingNote 형식 ${v}`); },
      expectedPlayers: 'int',
    }),
    players: arr(obj({ playerId: range(1, 12), sessionId: 'str|null', nickname: 'str', isBot: 'bool', isHost: 'bool', ready: 'bool', status: ['enum', 'LOBBY_WAITING', 'PLAYING', 'ELIMINATED_SPECTATING', 'DISCONNECTED'] })),
    spectatorCount: 'int', countdownMs: 'int|null', autoStartMs: 'int|null',
  },
  room_list: {
    serverTime: 'int',
    rooms: arr(obj({
      roomId: 'str', phase: ['enum', 'LOBBY', 'COUNTDOWN', 'IN_GAME', 'GAME_OVER'], map: mapChoice,
      mapName: (v, p, e) => { if (v !== null && (typeof v !== 'object' || typeof (v as any).ko !== 'string')) e.push(`${p}: {ko,en}|null`); },
      width: 'int', height: 'int', humans: 'int', bots: 'int', maxPlayers: range(2, 12), spectatorCount: 'int', elapsedMs: 'int', autoStartMs: 'int|null', joinable: 'bool', spectatable: 'bool',
    })),
  },
  match_config: {
    seed: 'int', topology: ['enum', 'square'], width: 'int', height: 'int', totalLandTiles: 'int', tickMs: 'int', hardTimeoutTick: 'int',
    endgameRush: obj({ tick: 'int', costMultPermille: 'int' }),
    thresholdCurve: obj({ startPct: 'num', decayStartTick: 'int', decayPerMinPermille: 'int', floorPct: 'num', scale: 'int' }),
    mapSource: ['enum', 'random', 'preset'], 'mapId?': 'str', botDifficulty: DIFF, constants: (v, p, e) => { if (typeof v !== 'object' || !v) e.push(`${p}: object`); },
  },
  map_init: { terrain: arr('int'), spawns: arr(obj({ playerId: 'int', tileId: 'int', homeTileId: 'int' })), bases: arr('int'), baseNames: arr('str') },
  snapshot_full: {
    tick: 'int', owners: arr('int'),
    players: arr(obj({ id: 'int', tiles: 'int', troops: 'int', gold: 'int', goldWeight: 'int', upkeepPm: range(0, 700), techMask: range(0, 0xffffffff), techCount: range(0, 32), flagCap: range(3, 7), alive: 'bool', connected: 'bool' })),
    flags: arr(flagSnap),
    bases: arr(obj({ tileId: 'int', ownerId: 'int', hpPct: range(0, 100), prodPm: range(0, 1000) })),
    alliances: arr(obj({ a: 'int', b: 'int', state: ['enum', 'ACTIVE', 'BREAKING'], sinceTick: 'int', breakAtTick: 'int|null' })),
    thresholdPct: 'num', ticksRemaining: 'int', endgameRushActive: 'bool',
    allyProposals: arr(obj({ proposalId: 'int', fromPlayerId: 'int', toPlayerId: 'int', expireTick: 'int' })),
    allianceFreezeUntilTick: 'int|null', lockoutDissolveTick: 'int|null',
    production: arr(production),
  },
  snapshot_delta: {
    tick: 'int', tileChanges: arr(tuple('int', 'int')),
    playerDeltas: arr(obj({ id: 'int', tiles: 'int', troops: 'int', gold: 'int', goldWeight: 'int', upkeepPm: 'int', techMask: range(0, 0xffffffff) })),
    flagMoves: arr(tuple('int', 'int')), flagStats: arr(tuple('int', 'int', FLAG_STATE)), flagProgress: arr(tuple('int', range(0, 99))),
    flagTargets: arr(tuple('int', 'int|null')), baseHp: arr(tuple('int', range(0, 100))), flagsGone: arr('int'), 'thresholdPct?': 'num',
    flagFlags: arr(tuple('int', POSTURE, range(0, 255), 'int')),
    flagReturnBase: arr(tuple('int', 'int|null')),
    baseProd: arr(tuple('int', range(0, 1000))),
    production: arr(production),
  },
  cmd_ack: { clientSeq: 'int', accepted: 'bool', 'reason?': ['enum', ...DOC_REJECT], 'flagId?': 'int', 'posture?': POSTURE },
  error: { code: ['enum', ...DOC_ERROR], message: 'str' },
  pong: { clientTime: 'num', serverTime: 'int', tick: 'int' },
  tech_purchased: { tick: 'int', playerId: 'int', nodeId: range(0, 31), cost: 'int', newFlagCap: range(3, 7), techMask: range(0, 0xffffffff) },
  threshold_update: { tick: 'int', thresholdPct: 'num' },
  endgame_rush: { tick: 'int', costMultPermille: 'int' },
  player_eliminated: { tick: 'int', playerId: 'int', byPlayerId: 'int|null', annexedTiles: 'int' },
  bot_takeover: { tick: 'int', playerId: 'int' },
  player_reconnected: { tick: 'int', playerId: 'int' },
  emote_broadcast: { tick: 'int', playerId: 'int', code: range(0, 15) },
  game_over: { finalTick: 'int', winnerId: 'int|null', reason: ['enum', 'last_standing', 'threshold', 'timeout'], standings: arr(obj({ rank: 'int', playerId: 'int', tiles: 'int', troops: 'int', goldEarned: 'int', alive: 'bool' })) },
  flag_issued: { tick: 'int', flagId: 'int', playerId: 'int', slotIndex: 'int', unit: UNIT, posture: POSTURE, troops: 'int', originTileId: 'int', anchorTileId: 'int', targetOwnerId: 'int', etaTick: 'int', engageEtaTick: 'int' },
  flag_retargeted: { tick: 'int', flagId: 'int', anchorTileId: 'int', targetOwnerId: 'int', posture: POSTURE, resumeTick: 'int', etaTick: 'int', engageEtaTick: 'int', auto: 'bool' },
  flag_recalled: { tick: 'int', flagId: 'int', returnTileId: 'int' },
  flag_engaged: { tick: 'int', flagId: 'int', posture: POSTURE, 'frontTileCount?': 'int', 'guardTileCount?': 'int' },
  flag_stalled: { tick: 'int', flagId: 'int', tileId: 'int|null' },
  flag_progress_lost: { tick: 'int', flagId: 'int', tileId: 'int', cause: ['enum', 'captured_by_other', 'target_lost', 'decayed'] },
  flag_idle: { tick: 'int', flagId: 'int', reason: ['enum', 'front_cleared', 'guard_lost', 'allied'], autoRecallTick: 'int' },
  flag_ended: { tick: 'int', flagId: 'int', reason: ['enum', 'exhausted', 'recalled', 'attrited', 'eliminated', 'routed_returned'], refunded: 'int' },
  combat_started: { tick: 'int', groupKey: 'int', flagIds: arr('int'), sides: arr(obj({ sideKey: 'int', ownerIds: arr('int'), troops: 'int', power: 'int' })) },
  combat_ended: { tick: 'int', groupKey: 'int', winnerSideKey: 'int|null', routedFlagIds: arr('int') },
  flag_routed: { tick: 'int', flagId: 'int', returnTileId: 'int' },
  flag_posture_changed: { tick: 'int', flagId: 'int', posture: POSTURE, cooldownUntilTick: 'int', auto: 'bool', targetOwnerId: 'int' },
  flag_blocked: { tick: 'int', flagId: 'int', byFlagIds: arr('int') },
  flag_unblocked: { tick: 'int', flagId: 'int' },
  flag_disengage_started: { tick: 'int', flagId: 'int', untilTick: 'int', auto: 'bool' },
  flag_disengaged: { tick: 'int', flagId: 'int', reason: ['enum', 'broke_away', 'combat_over'] },
  base_captured: { tick: 'int', tileId: 'int', fromPlayerId: 'int', toPlayerId: 'int', newHpPct: 'int', newProdPm: range(0, 1000) },
  ally_proposed: { tick: 'int', proposalId: 'int', fromPlayerId: 'int', toPlayerId: 'int', expireTick: 'int' },
  ally_proposal_closed: { tick: 'int', proposalId: 'int', reason: ['enum', 'declined', 'expired', 'formed', 'invalidated'] },
  ally_formed: { tick: 'int', a: 'int', b: 'int' },
  ally_break_started: { tick: 'int', a: 'int', b: 'int', byPlayerId: 'int', breakAtTick: 'int' },
  ally_broken: { tick: 'int', a: 'int', b: 'int', reason: ['enum', 'cooldown_elapsed', 'lockout', 'eliminated'] },
  alliance_lockout: { tick: 'int', phase: ['enum', 'countdown', 'cancelled', 'dissolved'], reason: ['enum', 'all_allied'], forceDissolveTick: 'int|null', freezeUntilTick: 'int|null' },
};

/** 문서 대비 shape 검사. 반환 = 위반 목록 */
export function validateMessage(m: unknown): string[] {
  const errs: string[] = [];
  const o = m as Record<string, unknown>;
  const shape = DOC_SCHEMA[o?.type as string];
  if (!shape) return [`문서에 없는 메시지 type=${String(o?.type)}`];
  obj({ type: 'str', ...shape })(m, String(o.type), errs);
  // 의미 검사
  if (o.type === 'flag_engaged') {
    if (o.posture === 0 && (!('frontTileCount' in o) || 'guardTileCount' in o)) errs.push('flag_engaged: ATTACK 이면 frontTileCount 만');
    if (o.posture === 1 && (!('guardTileCount' in o) || 'frontTileCount' in o)) errs.push('flag_engaged: DEFEND 이면 guardTileCount 만');
  }
  if (o.type === 'cmd_ack') {
    if (o.accepted === true && 'reason' in o) errs.push('cmd_ack: accepted 인데 reason');
    if (o.accepted === false && !('reason' in o)) errs.push('cmd_ack: 거절인데 reason 없음');
    if (o.accepted === false && ('flagId' in o || 'posture' in o)) errs.push('cmd_ack: 거절인데 flagId/posture');
  }
  if (o.type === 'combat_ended') {
    const r = o.routedFlagIds as number[];
    if (new Set(r).size !== r.length) errs.push('combat_ended.routedFlagIds 중복');
  }
  return errs;
}
