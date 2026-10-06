import { describe, expect, it } from 'vitest';

import { renderBrandedEmail } from './branded-layout';

describe('renderBrandedEmail', () => {
  const html = renderBrandedEmail({
    title: 'Your council dues are due',
    bodyHtml: '<p>Dear John,</p><p>Your renewal is $50.00.</p>',
    ctaLabel: 'Pay dues',
    ctaUrl: 'https://council.example.org/home/checkout',
    footerHtml:
      'To stop these reminders, reply to this email and let the Financial Secretary know.',
    preheader: 'Your council dues are due',
  });

  it('includes the council brand mark and subtitle', () => {
    expect(html).toContain(
      'https://kofc-15256.org/images/brand/kofc_r_hz_rgb_pos.png',
    );
    expect(html).toContain(
      'Knights of Columbus St. Louis Martin Council #15256',
    );
  });

  it('renders the title, body, and blue CTA', () => {
    expect(html).toContain('Your council dues are due');
    expect(html).toContain('Dear John,');
    expect(html).toContain('Your renewal is $50.00.');
    expect(html).toContain('href="https://council.example.org/home/checkout"');
    expect(html).toContain('Pay dues');
    expect(html).toContain('background-color: #003595');
  });

  it('escapes title, CTA label, URL, footer, and preheader', () => {
    const unsafe = renderBrandedEmail({
      title: 'A <b>title</b>',
      bodyHtml: '<p>safe</p>',
      ctaLabel: 'Pay <script>',
      ctaUrl: 'https://x.org/" onclick="alert(1)',
      footerHtml: 'stop <b>now</b>',
      preheader: 'pre <i>',
    });

    expect(unsafe).toContain('A &lt;b&gt;title&lt;/b&gt;');
    expect(unsafe).toContain('Pay &lt;script&gt;');
    expect(unsafe).toContain(
      'href="https://x.org/&quot; onclick=&quot;alert(1)"',
    );
    expect(unsafe).toContain('stop &lt;b&gt;now&lt;/b&gt;');
    expect(unsafe).toContain('pre &lt;i&gt;');
    expect(unsafe).toContain('<p>safe</p>');
  });
});
