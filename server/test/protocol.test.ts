import { describe, expect, it } from 'vitest';
import { rleDecode, rleEncode } from '@civwar/shared';
import { parseClientMessage } from '../src/net/validate.js';

describe('RLE', () => {
  it('왕복', () => {
    const a = new Uint8Array([0, 0, 0, 1, 1, 6, 0]);
    expect(rleEncode(a)).toEqual([0, 3, 1, 2, 6, 1, 0, 1]);
    expect([...rleDecode(rleEncode(a), 7)]).toEqual([...a]);
  });
});

describe('입력 검증', () => {
  it('잘못된 JSON / 타입', () => {
    expect(parseClientMessage('{').ok).toBe(false);
    expect(parseClientMessage('[]').ok).toBe(false);
    expect(parseClientMessage('{"type":"nope"}').ok).toBe(false);
  });
  it('cmd_* 형식 오류는 clientSeq 를 돌려줘 BAD_REQUEST ack 가 가능', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'cmd_buy_tech', clientSeq: 7, axis: 9, tier: 1 }));
    expect(r).toMatchObject({ ok: false, clientSeq: 7 });
  });
  it('정상/비정상 메시지', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'cmd_buy_tech', clientSeq: 1, axis: 0, tier: 1 })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'lobby_create_private', targetPlayers: 8 })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'lobby_create_private', targetPlayers: 13 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'cmd_flag_issue', clientSeq: 1, unit: 1, troops: 1.5, anchorTileId: 3 })).ok).toBe(false);
  });
});
