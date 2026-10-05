import { describe, expect, it } from 'vitest';

import { ColdStartSimulator } from './cold-start';

describe('ColdStartSimulator', () => {
  it('delays the first request, then nothing while warm', () => {
    const simulator = new ColdStartSimulator(5000, 60000);

    expect(simulator.delayFor(1000)).toBe(5000);
    simulator.markWarm(6000);
    expect(simulator.delayFor(7000)).toBe(0);
  });

  it('goes cold again after the idle window', () => {
    const simulator = new ColdStartSimulator(5000, 60000);

    simulator.markWarm(0);
    expect(simulator.delayFor(60001)).toBe(5000);
  });

  it('is off when no delay is configured', () => {
    expect(new ColdStartSimulator(0, 60000).delayFor(0)).toBe(0);
  });
});
