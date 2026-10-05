import { Page, expect } from '@playwright/test';

import { Mailbox } from '../utils/mailbox';

/**
 * Local-only Supabase demo project constants (same well-known CLI defaults
 * as `rbac.po.ts` / `dues.po.ts`). Not secrets; only meaningful on
 * 127.0.0.1:54321.
 */
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export class AuthPageObject {
  private readonly page: Page;
  private readonly mailbox: Mailbox;

  constructor(page: Page) {
    this.page = page;
    this.mailbox = new Mailbox(page);
  }

  goToSignIn() {
    return this.page.goto('/auth/sign-in');
  }

  async signOut() {
    await this.page.click('[data-test="account-dropdown-trigger"]');
    await this.page.click('[data-test="account-dropdown-sign-out"]');
  }

  async signIn(params: { email: string; password: string }) {
    await this.page.waitForTimeout(1000);

    await this.page.fill('input[name="email"]', params.email);
    await this.page.fill('input[name="password"]', params.password);
    await this.page.click('button[type="submit"]');
  }

  /**
   * Creates a confirmed auth user via the Admin API. Public self sign-up is
   * disabled; tests that need a member account use this instead of the
   * removed `/auth/sign-up` form.
   */
  async createConfirmedUser(params: {
    email: string;
    password: string;
  }): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        email_confirm: true,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `createConfirmedUser failed for ${params.email}: ` +
          `${res.status} ${await res.text()}`,
      );
    }
  }

  async visitConfirmEmailLink(
    email: string,
    params: {
      deleteAfter: boolean;
    } = {
      deleteAfter: true,
    },
  ) {
    return expect(async () => {
      const res = await this.mailbox.visitMailbox(email, params);

      expect(res).not.toBeNull();
    }).toPass();
  }

  createRandomEmail() {
    const value = Math.random() * 10000000000;

    return `${value.toFixed(0)}@makerkit.dev`;
  }

  /**
   * Provisions a confirmed user (admin API) and signs them in, landing on
   * `path`. Same return contract as before so call sites that promote the
   * user afterward still receive the email.
   */
  async signUpFlow(path: string) {
    const email = this.createRandomEmail();
    const password = 'password';

    await this.createConfirmedUser({ email, password });
    await this.page.goto(`/auth/sign-in?next=${path}`);
    await this.signIn({ email, password });
    await this.page.waitForURL(`**${path}`);

    return email;
  }

  async updatePassword(password: string) {
    await this.page.fill('[name="password"]', password);
    await this.page.fill('[name="repeatPassword"]', password);
    await this.page.click('[type="submit"]');
  }
}
