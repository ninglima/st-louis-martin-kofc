import { describe, expect, it } from 'vitest';

import { isProblem, KIND_LABELS, TRACKING_LABELS } from './tracking';

describe('tracking labels', () => {
  it('labels every state and flags problems', () => {
    expect(TRACKING_LABELS.clicked).toBe('Clicked');
    expect(TRACKING_LABELS.dry_run).toBe('Dry run');
    expect(isProblem('bounced')).toBe(true);
    expect(isProblem('complained')).toBe(true);
    expect(isProblem('failed')).toBe(true);
    expect(TRACKING_LABELS.suppressed).toBe('Suppressed');
    expect(isProblem('suppressed')).toBe(true);
    expect(isProblem('opened')).toBe(false);
    expect(KIND_LABELS.after_30).toBe('30 days after');
  });
});
