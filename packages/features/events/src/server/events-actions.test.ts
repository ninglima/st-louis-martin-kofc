import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  signup: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => {
    void fn();
  },
}));
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (fn: (input: never) => unknown) => fn,
}));
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({}),
}));
vi.mock('@kit/event-emails/config', () => ({
  readEventEmailsConfig: () => ({}),
}));
vi.mock('@kit/event-emails/server/dispatch', () => ({
  dispatchEventEmails: m.dispatch,
}));
vi.mock('./events.service', () => ({
  EventsService: class {
    signup = m.signup;
  },
}));

import { signupAction } from './events-actions';

const SHIFT = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';

describe('signupAction', () => {
  beforeEach(() => {
    m.signup.mockReset().mockResolvedValue(undefined);
    m.dispatch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches queued emails after a successful sign-up', async () => {
    m.dispatch.mockResolvedValue({});
    await expect(signupAction({ shiftId: SHIFT })).resolves.toMatchObject({
      success: true,
    });
    expect(m.dispatch).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when the dispatch rejects', async () => {
    m.dispatch.mockRejectedValue(new Error('boom'));
    await expect(signupAction({ shiftId: SHIFT })).resolves.toMatchObject({
      success: true,
    });
  });

  it('still succeeds when the dispatch throws synchronously', async () => {
    m.dispatch.mockImplementation(() => {
      throw new Error('sync boom');
    });
    await expect(signupAction({ shiftId: SHIFT })).resolves.toMatchObject({
      success: true,
    });
  });

  it('does not dispatch when the sign-up fails', async () => {
    m.signup.mockRejectedValue(new Error('full'));
    await expect(signupAction({ shiftId: SHIFT })).resolves.toMatchObject({
      success: false,
    });
    expect(m.dispatch).not.toHaveBeenCalled();
  });
});
