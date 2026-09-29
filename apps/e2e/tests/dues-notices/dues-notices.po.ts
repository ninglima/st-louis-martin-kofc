import { APIRequestContext, Locator, Page } from '@playwright/test';

export class DuesNoticesPageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  goTo(query?: string) {
    return this.page.goto(
      query ? `/home/dues-notices?${query}` : '/home/dues-notices',
    );
  }

  statusCard() {
    return this.page.locator('[data-test="dues-notices-status"]');
  }

  noticeRows() {
    return this.page.locator('[data-test="dues-notice-row"]');
  }

  /** Rows whose visible text includes the member's full name -- the same
   * "filter by the seeded member's own name, never a bare count" pattern
   * `dues.spec.ts`/`finance.spec.ts` use against a long-lived database. */
  rowsForMember(name: string) {
    return this.noticeRows().filter({ hasText: name });
  }

  trackingBadge(row: Locator) {
    return row.locator('[data-test="tracking-badge"]');
  }

  unreachableCard() {
    return this.page.locator('[data-test="dues-notices-unreachable"]');
  }

  memberNoticesCard() {
    return this.page.locator('[data-test="member-notices"]');
  }

  memberNoticeItems() {
    return this.memberNoticesCard().locator('li');
  }

  memberNoticesOptOut() {
    return this.page.locator('[data-test="member-notices-opt-out"]');
  }

  followUpRow(name: string) {
    return this.page
      .locator('[data-test="finance-follow-up-row"]')
      .filter({ hasText: name });
  }

  lastNoticeCell(row: Locator) {
    return row.locator('[data-test="last-notice"]');
  }
}

/**
 * Posts to the daily job endpoint (Task 3, `apps/portal/app/api/jobs/
 * dues-notices/route.ts`) through the router at the stack's baseURL
 * (`http://localhost:3000`, `playwright.config.ts`) rather than the portal
 * container directly -- the portal has no published port in `compose.yaml`,
 * and its `proxy.ts` origin lock (`checkOriginAuth`) 404s any request
 * missing the `x-origin-auth` header the router's `forward.ts` adds. Going
 * through Playwright's `request` fixture (already configured with that same
 * baseURL) gets that header for free; the job endpoint's own auth is the
 * `Authorization: Bearer <secret>` header set here.
 */
export function postDuesNoticesJob(request: APIRequestContext, bearer: string) {
  return request.post('/api/jobs/dues-notices', {
    headers: { authorization: `Bearer ${bearer}` },
  });
}
