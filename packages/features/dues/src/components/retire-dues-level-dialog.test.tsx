import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Form } from '@kit/ui/form';

import { RetireDuesLevelSchema } from '../schemas';
import type { AdminDuesLevel } from '../types';
import { RetireLevelFields } from './retire-dues-level-dialog';

vi.mock('../server/dues-level-actions', () => ({
  retireDuesLevelAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const honorary: AdminDuesLevel = {
  slug: 'honorary',
  name: 'Honorary',
  amountCents: 1900,
  selfService: false,
  sortOrder: 5,
  active: true,
  memberCount: 3,
  changedAt: null,
  changedByEmail: null,
};

const regular: AdminDuesLevel = {
  ...honorary,
  slug: 'regular',
  name: 'Regular',
  amountCents: 5000,
  selfService: true,
};

function Harness({ level }: { level: AdminDuesLevel }) {
  const form = useForm({
    resolver: zodResolver(RetireDuesLevelSchema),
    defaultValues: {
      slug: level.slug,
      memberCount: level.memberCount,
      moveTo: '',
    },
  });

  // FormField/FormItem read the form context, so the fields need <Form>.
  return (
    <Form {...form}>
      <RetireLevelFields form={form} level={level} targets={[regular]} />
    </Form>
  );
}

describe('RetireLevelFields', () => {
  it('says how many members are on the level and asks where to move them', () => {
    const html = renderToStaticMarkup(<Harness level={honorary} />);

    expect(html).toContain('3 members are on Honorary.');
    expect(html).toContain('data-test="retire-move-to"');
  });

  it('hides the target when nobody is on the level', () => {
    const html = renderToStaticMarkup(
      <Harness level={{ ...honorary, memberCount: 0 }} />,
    );

    expect(html).toContain('No members are on Honorary.');
    expect(html).not.toContain('data-test="retire-move-to"');
  });

  it('says "1 member is", not "1 members are"', () => {
    const html = renderToStaticMarkup(
      <Harness level={{ ...honorary, memberCount: 1 }} />,
    );

    expect(html).toContain('1 member is on Honorary.');
  });
});
