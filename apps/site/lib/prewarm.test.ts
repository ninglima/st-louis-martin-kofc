import { describe, expect, it, vi } from 'vitest';

import { createPrewarmer } from './prewarm';

const origin = 'https://kofc-15256.org';

describe('createPrewarmer', () => {
  it('warms once for the first portal link, then never again', () => {
    const fetchVersion = vi.fn();
    const prewarm = createPrewarmer({ fetchVersion, pageOrigin: origin });

    prewarm('/auth/sign-in?next=/home/checkout');
    prewarm('/home');

    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it('ignores site links, look-alikes, other origins and missing hrefs', () => {
    const fetchVersion = vi.fn();
    const prewarm = createPrewarmer({ fetchVersion, pageOrigin: origin });

    prewarm('/who-we-are');
    prewarm('/homework');
    prewarm('https://kofc.org/home');
    prewarm(null);

    expect(fetchVersion).not.toHaveBeenCalled();
  });

  it('warms for an absolute link on this origin', () => {
    const fetchVersion = vi.fn();
    createPrewarmer({ fetchVersion, pageOrigin: origin })(`${origin}/home`);

    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });
});
