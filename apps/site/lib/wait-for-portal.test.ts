import { describe, expect, it } from 'vitest';

import { waitForPortal } from './wait-for-portal';

function fakeClock() {
  let time = 0;

  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe('waitForPortal', () => {
  it('is ready as soon as /version returns 200', async () => {
    const clock = fakeClock();
    const statuses = [503, 503, 200];

    const result = await waitForPortal({
      ...clock,
      fetchVersion: async () => statuses.shift() ?? 200,
    });

    expect(result).toBe('ready');
    expect(clock.now()).toBe(2000);
  });

  it('treats a network error as not ready yet', async () => {
    const clock = fakeClock();
    let calls = 0;

    const result = await waitForPortal({
      ...clock,
      fetchVersion: async () => {
        calls++;
        if (calls === 1) throw new TypeError('network');
        return 200;
      },
    });

    expect(result).toBe('ready');
  });

  it('gives up after 30 seconds', async () => {
    const clock = fakeClock();

    const result = await waitForPortal({
      ...clock,
      fetchVersion: async () => 503,
    });

    expect(result).toBe('timeout');
    expect(clock.now()).toBeGreaterThanOrEqual(30000);
  });
});
