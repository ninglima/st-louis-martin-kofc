import { Page, expect } from '@playwright/test';

import { SUPABASE_SERVICE_ROLE_KEY } from './dues.po';

const SUPABASE_URL = 'http://127.0.0.1:54321';

function serviceRoleHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export class DuesLevelsPageObject {
  constructor(private readonly page: Page) {}

  goTo() {
    return this.page.goto('/home/settings/dues-levels');
  }

  row(slug: string) {
    return this.page.locator(
      `[data-test="dues-level-row"][data-slug="${slug}"]`,
    );
  }

  rowByName(name: string) {
    return this.page
      .locator('[data-test="dues-level-row"]')
      .filter({ hasText: name });
  }

  async slugOf(name: string): Promise<string> {
    const slug = await this.rowByName(name).getAttribute('data-slug');

    if (!slug) {
      throw new Error(`no dues level row named ${name}`);
    }

    return slug;
  }

  async fillLevel(values: {
    name?: string;
    amount?: string;
    selfService?: boolean;
    order?: string;
  }) {
    if (values.name !== undefined) {
      await this.page.fill('[data-test="dues-level-name"]', values.name);
    }
    if (values.amount !== undefined) {
      await this.page.fill('[data-test="dues-level-amount"]', values.amount);
    }
    if (values.selfService !== undefined) {
      const box = this.page.locator('[data-test="dues-level-self-service"]');
      const checked = (await box.getAttribute('aria-checked')) === 'true';

      if (checked !== values.selfService) {
        await box.click();
      }
    }
    if (values.order !== undefined) {
      await this.page.fill('[data-test="dues-level-order"]', values.order);
    }
  }

  async addLevel(values: { name: string; amount: string; order: string }) {
    await this.page.click('[data-test="add-dues-level"]');
    await this.fillLevel({ ...values, selfService: false });
    await this.page.click('[data-test="dues-level-save"]');
    await expect(this.rowByName(values.name)).toBeVisible();
  }

  async retire(slug: string, moveToName: string | null) {
    await this.row(slug).locator('[data-test="retire-dues-level"]').click();

    if (moveToName) {
      await this.page.click('[data-test="retire-move-to"]');
      await this.page
        .getByRole('option', { name: new RegExp(`^${moveToName} — `) })
        .click();
    }

    await this.page.click('[data-test="retire-submit"]');
    await expect(
      this.row(slug).locator('[data-test="dues-level-status"]'),
    ).toHaveText('Retired');
  }

  /** Seeds a roster member on a level through the officer's own session
   * (the members table is closed to the service role, and the roster import
   * is not what this suite tests). */
  async seedMemberOnLevel(
    officer: { email: string; password: string },
    slug: string,
  ): Promise<string> {
    const login = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: serviceRoleHeaders(),
        body: JSON.stringify(officer),
      },
    );

    if (!login.ok) {
      throw new Error(`seedMemberOnLevel: sign-in ${login.status}`);
    }

    const { access_token } = (await login.json()) as { access_token: string };
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    };
    const number = String(9_960_000 + (Date.now() % 39_000));

    const upsert = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/member_upsert_from_roster`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p: {
            membership_number: number,
            first_name: 'Level',
            last_name: `Tester${number}`,
            primary_email: `level.${number}@example.com`,
          },
        }),
      },
    );

    if (!upsert.ok) {
      throw new Error(
        `seedMemberOnLevel: ${upsert.status} ${await upsert.text()}`,
      );
    }

    const memberId = (await upsert.json()) as string;
    const set = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/set_member_dues_level`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_member_id: memberId, p_level: slug }),
      },
    );

    if (!set.ok) {
      throw new Error(`seedMemberOnLevel: ${set.status} ${await set.text()}`);
    }

    return memberId;
  }

  async memberLevel(memberId: string): Promise<string> {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=dues_level&id=eq.${memberId}`,
      { headers: serviceRoleHeaders() },
    );

    return ((await res.json()) as { dues_level: string }[])[0]!.dues_level;
  }
}
