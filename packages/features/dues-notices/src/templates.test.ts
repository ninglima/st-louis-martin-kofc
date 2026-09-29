import { describe, expect, it } from 'vitest';

import { renderNotice } from './templates';

const base = {
  noticeId: 'n1',
  memberId: 'm1',
  firstName: 'John',
  email: 'john@example.com',
  kind: 'before_30' as const,
  cycleDate: '2026-11-14',
  firstDues: false,
  levelName: 'Regular',
  amountCents: 5000,
};

describe('renderNotice', () => {
  it('reminds before the due date with the last covered day and the amount', () => {
    const n = renderNotice(base, 'https://council.example.org');
    expect(n.subject).toBe('Your council dues renew soon');
    expect(n.text).toContain('paid through November 13, 2026');
    expect(n.text).toContain('$50.00');
    expect(n.text).toContain('https://council.example.org/home/checkout');
    expect(n.html).toContain(
      'href="https://council.example.org/home/checkout"',
    );
  });

  it('says dues are due on the due date, and past due after', () => {
    expect(
      renderNotice({ ...base, kind: 'due_date' }, 'https://x.org').subject,
    ).toBe('Your council dues are due');
    expect(
      renderNotice({ ...base, kind: 'after_30' }, 'https://x.org').subject,
    ).toBe('Your council dues are past due');
  });

  it('welcomes a new member owing first dues', () => {
    const n = renderNotice(
      { ...base, kind: 'due_date', firstDues: true },
      'https://x.org',
    );
    expect(n.text).toContain('first dues');
    expect(n.text).not.toContain('paid through');
  });

  it('escapes names in HTML', () => {
    const n = renderNotice(
      { ...base, firstName: `O'Brien <b>` },
      'https://x.org',
    );
    expect(n.html).toContain('O&#39;Brien &lt;b&gt;');
    expect(n.html).not.toContain('<b>');
    expect(n.text).toContain(`O'Brien <b>`);
  });

  it('tells members how to stop reminders', () => {
    expect(renderNotice(base, 'https://x.org').text).toContain(
      'reply to this email',
    );
  });
});
