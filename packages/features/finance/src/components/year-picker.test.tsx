import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/home/hosting-costs',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { YearPicker } from './year-picker';

describe('YearPicker', () => {
  it('shows the fraternal year label, not the bare start year, with the Select closed', () => {
    const { container } = render(
      <YearPicker year={2026} options={[2026, 2025]} />,
    );

    const trigger = container.querySelector('[data-test="year-picker"]');

    expect(trigger?.textContent).toContain('2026–27');
    expect(screen.getByText('2026–27')).toBeTruthy();
  });
});
