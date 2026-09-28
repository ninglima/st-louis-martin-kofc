import { describe, expect, it } from 'vitest';

import { DuesService } from './dues.service';

const ROW = {
  member_id: 'm1',
  dues_level: 'honorary',
  level_name: 'Honorary',
  amount_cents: 1900,
  accepted_on: null,
  is_student: false,
  paid_through: null,
  dues_status: 'no_record',
};

function fakeClient(level: { self_service: boolean; active: boolean } | null) {
  const seen = { levelSlug: null as unknown };

  const client = {
    rpc: async () => ({ data: [ROW], error: null }),
    from: () => ({
      select: () => ({
        eq: (_column: string, value: unknown) => {
          seen.levelSlug = value;
          return {
            maybeSingle: async () => ({ data: level, error: null }),
          };
        },
      }),
    }),
  };

  return { seen, client: client as never };
}

describe('DuesService.mySummary', () => {
  it("adds the assigned level's self-service and active flags, even when inactive", async () => {
    const { seen, client } = fakeClient({ self_service: false, active: false });

    const summary = await new DuesService(client).mySummary();

    expect(seen.levelSlug).toBe('honorary');
    expect(summary).toMatchObject({
      duesLevel: 'honorary',
      levelSelfService: false,
      levelActive: false,
    });
  });

  it('returns null with no member row', async () => {
    const client = {
      rpc: async () => ({ data: [], error: null }),
    } as never;

    expect(await new DuesService(client).mySummary()).toBeNull();
  });
});
