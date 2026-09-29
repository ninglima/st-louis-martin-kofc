import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySvixSignature } from './svix';

const rawKey = Buffer.from('super-secret-key-for-tests');
const secret = `whsec_${rawKey.toString('base64')}`;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac('sha256', rawKey).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('verifySvixSignature', () => {
  const body = '{"type":"email.delivered"}';
  const ts = '1790000000';

  it('accepts a valid signature, including among several', () => {
    const good = sign('msg_1', ts, body);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(true);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: `v1,Zm9v ${good}`,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, or an old timestamp', () => {
    const good = sign('msg_1', ts, body);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body: body + ' ',
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret: `whsec_${Buffer.from('other').toString('base64')}`,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: 1790000301,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: 'abc',
        signature: good,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
  });
});
