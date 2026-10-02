'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { type UseFormReturn, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { formatAmountCents } from '../lib/format-amount';
import { RetireDuesLevelSchema, type RetireDuesLevelValues } from '../schemas';
import { retireDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';

function membersSentence(count: number, name: string): string {
  if (count === 0) return `No members are on ${name}.`;
  if (count === 1) return `1 member is on ${name}.`;

  return `${count} members are on ${name}.`;
}

/** The dialog body, exported so it can be rendered in tests without a
 * portal. The target select appears only when there are members to move. */
export function RetireLevelFields({
  form,
  level,
  targets,
}: {
  form: UseFormReturn<RetireDuesLevelValues>;
  level: AdminDuesLevel;
  targets: AdminDuesLevel[];
}) {
  return (
    <div className="flex flex-col gap-y-4">
      <p data-test="retire-member-count">
        {membersSentence(level.memberCount, level.name)}
      </p>

      {level.memberCount > 0 ? (
        <FormField
          control={form.control}
          name="moveTo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Move them to</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-test="retire-move-to" className="w-full">
                    <SelectValue placeholder="Choose a level">
                      {(value: string | null) => {
                        const target = targets.find((t) => t.slug === value);

                        return target
                          ? `${target.name} — ${formatAmountCents(target.amountCents)}`
                          : 'Choose a level';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.slug} value={target.slug}>
                      {target.name} — {formatAmountCents(target.amountCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}

/** Retire a level, moving its members in the same step. Retired levels
 * disappear from checkout and can be restored later. */
export function RetireDuesLevelDialog({
  level,
  levels,
}: {
  level: AdminDuesLevel;
  levels: AdminDuesLevel[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const targets = levels.filter((l) => l.active && l.slug !== level.slug);

  const form = useForm({
    resolver: zodResolver(RetireDuesLevelSchema),
    defaultValues: {
      slug: level.slug,
      memberCount: level.memberCount,
      moveTo: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        slug: level.slug,
        memberCount: level.memberCount,
        moveTo: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (values: RetireDuesLevelValues) => {
    startTransition(async () => {
      const result = await retireDuesLevelAction(values);

      if (result.success) {
        toast.success(`${level.name} retired.`);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-test="retire-dues-level"
            aria-label={`Retire ${level.name}`}
          >
            Retire
          </Button>
        }
      />

      <DialogContent
        data-test="retire-dues-level-dialog"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Retire {level.name}</DialogTitle>
          <DialogDescription>
            It will no longer be offered at checkout. Recorded dues are kept,
            and you can restore it later.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <RetireLevelFields form={form} level={level} targets={targets} />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="retire-submit"
                disabled={isPending}
              >
                {level.memberCount > 0
                  ? `Retire and move ${level.memberCount} ${level.memberCount === 1 ? 'member' : 'members'}`
                  : 'Retire level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
