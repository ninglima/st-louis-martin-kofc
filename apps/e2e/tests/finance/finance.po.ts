import { Page, expect } from '@playwright/test';

export class FinancePageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Optional `query` lets callers land on e.g. `/home?tab=bogus` for the
   * unknown-tab-falls-back-to-overview scenario, without a second method
   * that just special-cases the query string.
   */
  goToHome(query?: string) {
    return this.page.goto(query ? `/home?${query}` : '/home');
  }

  goToHostingCosts() {
    return this.page.goto('/home/hosting-costs');
  }

  /**
   * Opens a `@kit/ui/select` trigger and picks the option by visible text --
   * the same pattern as `DuesPageObject.selectOption` in `dues.po.ts`.
   * `@kit/ui` builds its `Select` on Base UI, not Radix: the listbox renders
   * into a portal rather than inline, so the option has to be found by role
   * across the whole page instead of scoped under the trigger.
   */
  async selectOption(triggerSelector: string, optionName: string) {
    await this.page.click(triggerSelector);
    await this.page
      .getByRole('option', { name: optionName, exact: true })
      .click();
  }

  hostingCostRows() {
    return this.page.locator('[data-test="hosting-cost-row"]');
  }

  /**
   * The dollar figure inside `finance-hosting-to-date`, read the way the
   * task brief asks (`Number(text.replace(/[^0-9.]/g, ''))`), but scoped to
   * the value itself rather than the whole card. The card also renders an
   * optional "Projected for the year: $…" sub-line
   * (`finance-hosting-projection`) right below it -- reading the card's
   * whole `innerText` would run that second dollar figure's digits straight
   * into this one once the regex strips everything but digits and dots.
   * `.text-2xl` is the value `<div>`'s own class in `HeadlineCards`'
   * `Figure`/hosting-to-date markup; scoped under the card's `data-test` it
   * cannot collide with the other headline cards, which carry their own
   * `data-test` hooks.
   */
  async hostingToDateDollars(): Promise<number> {
    const text = await this.page
      .locator('[data-test="finance-hosting-to-date"] .text-2xl')
      .innerText();

    return Number(text.replace(/[^0-9.]/g, ''));
  }

  /**
   * Fills and submits `HostingCostFormDialog`'s add form, acknowledging the
   * overlap warning if the covered dates collide with an existing bill for
   * the same provider -- expected on a rerun against the same long-lived
   * local database, since this always books "today" and the days just
   * before it.
   *
   * The dialog's Save button doubles as "Save anyway" once the warning
   * shows (same `data-test="hosting-cost-save"`, per
   * `hosting-cost-form-dialog.tsx`), so acknowledging is a second click on
   * the same locator. The first click's outcome is asynchronous (it awaits
   * an overlap-check server action before deciding whether to show the
   * warning or save outright), so this races the warning becoming visible
   * against the dialog just closing, rather than guessing which one wins.
   */
  async addHostingCost(params: {
    providerName: string;
    amount: string;
    paidOn: string;
    coversFrom: string;
    coversTo: string;
    note?: string;
  }): Promise<void> {
    await this.page.click('[data-test="hosting-cost-add"]');

    const dialog = this.page.locator('[data-test="hosting-cost-dialog"]');
    await expect(dialog).toBeVisible();

    await this.selectOption(
      '[data-test="hosting-cost-provider"]',
      params.providerName,
    );
    await this.page.fill('[data-test="hosting-cost-amount"]', params.amount);
    await this.page.fill('[data-test="hosting-cost-paid-on"]', params.paidOn);
    await this.page.fill(
      '[data-test="hosting-cost-covers-from"]',
      params.coversFrom,
    );
    await this.page.fill(
      '[data-test="hosting-cost-covers-to"]',
      params.coversTo,
    );

    if (params.note) {
      await this.page.fill('[data-test="hosting-cost-note"]', params.note);
    }

    const overlapWarning = this.page.locator(
      '[data-test="hosting-cost-overlap-warning"]',
    );

    await this.page.click('[data-test="hosting-cost-save"]');

    await Promise.race([
      overlapWarning.waitFor({ state: 'visible' }),
      dialog.waitFor({ state: 'hidden' }),
    ]);

    if (await overlapWarning.isVisible().catch(() => false)) {
      await this.page.click('[data-test="hosting-cost-save"]');
      await dialog.waitFor({ state: 'hidden' });
    }
  }

  /**
   * Runs "Repeat last bill" for the given provider slug via
   * `RepeatLastBill`'s dropdown + confirm dialog, and returns the new
   * period's inclusive start date, parsed out of `hosting-repeat-preview`'s
   * text (e.g. "Add Supabase $25.00 for 2026-09-29 – 2026-10-05?"). The
   * caller needs that date to know which fraternal year the new row landed
   * in -- see the doc comment on `fraternalYearOf` in `finance.spec.ts`.
   */
  async repeatLastBill(providerSlug: string): Promise<string> {
    await this.page.click('[data-test="hosting-repeat-last"]');
    await this.page.click(`[data-test="hosting-repeat-last-${providerSlug}"]`);

    const preview = this.page.locator('[data-test="hosting-repeat-preview"]');
    await expect(preview).toBeVisible();

    const text = await preview.innerText();
    const start = /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];

    if (!start) {
      throw new Error(
        `repeatLastBill: no ISO date found in preview text "${text}"`,
      );
    }

    await this.page.click('[data-test="hosting-repeat-confirm"]');
    await expect(preview).toBeHidden();

    return start;
  }

  /**
   * Switches the `year-picker` Select to the fraternal year with this
   * label (e.g. "2026–27" -- `fraternalYearLabel`, duplicated in
   * `finance.spec.ts` for the same reason `dues.po.ts` duplicates
   * `addDaysIso`/`chicagoToday`: independent of the code under test).
   */
  selectYear(label: string): Promise<void> {
    return this.selectOption('[data-test="year-picker"]', label);
  }

  /**
   * Picks the first real month option in `ForecastChart`'s `<select
   * id="forecast-month-select">`, inside the `collection-forecast` card.
   * This is a plain native `<select>` (unlike every other dropdown in the
   * finance UI, which is a `@kit/ui/select` built on Base UI), so
   * Playwright's own `selectOption` works directly against it -- no need
   * for the click-and-find-a-role-option dance `selectOption` above does.
   * Index 0 is the "Select a month" placeholder (value `""`); the
   * component's own `onChange` only navigates when the value is truthy, so
   * picking index 1 is what actually lands on a `month=` URL.
   */
  selectFirstForecastMonth(): Promise<string[]> {
    return this.page
      .locator('[data-test="collection-forecast"] select')
      .selectOption({ index: 1 });
  }
}
