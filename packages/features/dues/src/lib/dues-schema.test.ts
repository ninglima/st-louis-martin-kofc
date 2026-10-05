import { afterEach, describe, expect, it, vi } from 'vitest';

import { isMissingDuesSchemaError, readDuesIfDeployed } from './dues-schema';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isMissingDuesSchemaError', () => {
  it.each(['42883', '42P01', 'PGRST202', 'PGRST205'])(
    'treats %s as a missing dues schema',
    (code) => {
      expect(isMissingDuesSchemaError({ code, message: 'x' })).toBe(true);
    },
  );

  it.each([
    ['a permission error', { code: '42501' }],
    ['a PostgREST row error', { code: 'PGRST116' }],
    ['a numeric code', { code: 42883 }],
    ['an error without a code', new Error('boom')],
    ['null', null],
    ['a string', '42883'],
  ])('does not treat %s as a missing schema', (_label, error) => {
    expect(isMissingDuesSchemaError(error)).toBe(false);
  });
});

describe('readDuesIfDeployed', () => {
  it('returns the value when the read succeeds', async () => {
    await expect(readDuesIfDeployed(async () => null)).resolves.toEqual({
      deployed: true,
      value: null,
    });
  });

  it('reports not deployed when the RPC is missing from the schema cache', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      readDuesIfDeployed(async () => {
        throw {
          code: 'PGRST202',
          message: 'Could not find the function public.my_dues_summary',
        };
      }),
    ).resolves.toEqual({ deployed: false });
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('re-throws any other error', async () => {
    const error = { code: '42501', message: 'permission denied' };

    await expect(
      readDuesIfDeployed(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
