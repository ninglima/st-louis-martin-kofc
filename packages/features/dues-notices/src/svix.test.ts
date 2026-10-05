import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifySvixSignature } from './svix';

const rawKey = Buffer.from('super-secret-key-for-tests');
const secret = `whsec_${rawKey.toString('base64')}`;
const sign = (id: string, ts: string, body: string, key: Buffer = rawKey) =>
  `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;

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

  it('rejects a secret whose decoded key is shorter than 16 bytes', () => {
    const shortKey = Buffer.from('short-key'); // 9 bytes
    const shortSecret = `whsec_${shortKey.toString('base64')}`;
    const good = sign('msg_1', ts, body, shortKey);

    expect(
      verifySvixSignature({
        secret: shortSecret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp 301 seconds in the future', () => {
    const good = sign('msg_1', ts, body);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: Number(ts) - 301,
      }),
    ).toBe(false);
  });

  it('accepts a timestamp exactly 300 seconds old', () => {
    const good = sign('msg_1', ts, body);
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: Number(ts) + 300,
      }),
    ).toBe(true);
  });

  it('rejects an empty id', () => {
    const good = sign('', ts, body);
    expect(
      verifySvixSignature({
        secret,
        id: '',
        timestamp: ts,
        signature: good,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
  });

  it('rejects a signature that only carries an unknown version', () => {
    const good = sign('msg_1', ts, body);
    const v2Only = good.replace('v1,', 'v2,');
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: v2Only,
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
  });

  it('rejects an empty signature header', () => {
    expect(
      verifySvixSignature({
        secret,
        id: 'msg_1',
        timestamp: ts,
        signature: '',
        body,
        nowSeconds: 1790000100,
      }),
    ).toBe(false);
  });
});
