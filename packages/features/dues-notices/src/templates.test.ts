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

  it('gives due_date and after_30 renewals their own body wording', () => {
    const due = renderNotice({ ...base, kind: 'due_date' }, 'https://x.org');
    expect(due.text).toContain(
      'Your dues were paid through November 13, 2026 and are now due.',
    );
    expect(due.text).toContain('Your renewal is $50.00 (Regular).');

    const overdue = renderNotice(
      { ...base, kind: 'after_30' },
      'https://x.org',
    );
    expect(overdue.text).toContain(
      'Your dues were paid through November 13, 2026 and are now past due.',
    );
    expect(overdue.text).toContain('Your renewal is $50.00 (Regular).');
  });

  it('handles a year rollover in the last covered day', () => {
    const n = renderNotice(
      { ...base, cycleDate: '2027-01-01' },
      'https://x.org',
    );
    expect(n.text).toContain('paid through December 31, 2026');
  });

  it('welcomes a new member owing first dues', () => {
    const n = renderNotice(
      { ...base, kind: 'due_date', firstDues: true },
      'https://x.org',
    );
    expect(n.text).toContain('first dues');
    expect(n.text).not.toContain('paid through');
  });

  it('tells a first-dues member who is past due, without the welcome line', () => {
    const n = renderNotice(
      { ...base, kind: 'after_30', firstDues: true },
      'https://x.org',
    );
    expect(n.text).toContain('first dues');
    expect(n.text).toContain('past due');
    expect(n.text).not.toContain('Welcome');
  });

  it('tells a first-dues member their dues will be due soon, for the (unreachable) before_30 case', () => {
    const n = renderNotice(
      { ...base, kind: 'before_30', firstDues: true },
      'https://x.org',
    );
    expect(n.text).toContain('first dues');
    expect(n.text).toContain('due soon');
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

  it('escapes the level name in HTML', () => {
    const n = renderNotice(
      { ...base, levelName: `Family <b>&</b>` },
      'https://x.org',
    );
    expect(n.html).toContain('Family &lt;b&gt;&amp;&lt;/b&gt;');
    expect(n.html).not.toContain('<b>&</b>');
    expect(n.text).toContain('Family <b>&</b>');
  });

  it('keeps the plain text free of HTML entities', () => {
    const n = renderNotice(
      { ...base, firstName: `O'Brien & Sons <b>`, levelName: `A & B` },
      'https://x.org',
    );
    expect(n.text).not.toContain('&amp;');
    expect(n.text).not.toContain('&lt;');
    expect(n.text).not.toContain('&#39;');
    expect(n.text).toContain(`O'Brien & Sons <b>`);
    expect(n.text).toContain('A & B');
  });

  it('tells members how to stop reminders', () => {
    expect(renderNotice(base, 'https://x.org').text).toContain(
      'reply to this email',
    );
  });

  it('wraps HTML in the branded council layout with a Pay dues CTA', () => {
    const n = renderNotice(base, 'https://council.example.org');
    expect(n.html).toContain(
      'https://kofc-15256.org/images/brand/kofc_r_hz_rgb_pos.png',
    );
    expect(n.html).toContain(
      'Knights of Columbus St. Louis Martin Council #15256',
    );
    expect(n.html).toContain('background-color: #003595');
    expect(n.html).toContain('Pay dues');
    expect(n.html).toContain(
      'href="https://council.example.org/home/checkout"',
    );
  });
});
