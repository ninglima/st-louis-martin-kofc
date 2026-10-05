import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DuesStatusBadge } from './dues-status-badge';

describe('DuesStatusBadge', () => {
  it.each([
    ['current', 'Current'],
    ['due_soon', 'Due soon'],
    ['due', 'Due'],
    ['lapsed', 'Lapsed'],
    ['no_record', 'No record'],
  ] as const)('labels %s as %s', (status, label) => {
    const html = renderToStaticMarkup(<DuesStatusBadge status={status} />);
    expect(html).toContain(label);
    expect(html).toContain(`data-status="${status}"`);
  });
});
