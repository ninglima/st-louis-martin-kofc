import { renderBrandedEmail } from '@kit/email/branded-layout';
import { escapeHtml } from '@kit/email/html';

const SUBJECT = 'You have been invited to the council portal';

export function renderMemberInvite(input: {
  firstName: string;
  url: string;
}): { subject: string; html: string; text: string } {
  const name = input.firstName.trim() || 'Brother Knight';
  const text = [
    `Hello ${name},`,
    '',
    'You have been invited to create an account with Knights of Columbus St. Louis Martin Council #15256.',
    'Follow this link to accept the invite and choose a password:',
    input.url,
  ].join('\n');

  const html = renderBrandedEmail({
    title: 'You have been invited',
    preheader:
      'You have been invited to join Knights of Columbus St. Louis Martin Council #15256',
    bodyHtml: `<p style="font-size:14px;line-height:24px;margin:16px 0;color:rgb(0,0,0);">Hello ${escapeHtml(name)},</p>
<p style="font-size:14px;line-height:24px;margin:16px 0;color:rgb(0,0,0);">You have been invited to create an account with Knights of Columbus St. Louis Martin Council #15256. Follow this link to accept the invite and choose a password.</p>`,
    ctaLabel: 'Accept invite',
    ctaUrl: input.url,
  });

  return { subject: SUBJECT, html, text };
}

/** The confirm route reads `callback` as an absolute URL and keeps its path. */
export function memberInviteConfirmUrl(
  siteUrl: string,
  tokenHash: string,
  verificationType: string,
): string {
  const params = new URLSearchParams({
    token_hash: tokenHash,
    type: verificationType,
    callback: `${siteUrl}/update-password`,
  });

  return `${siteUrl}/auth/confirm?${params.toString()}`;
}
