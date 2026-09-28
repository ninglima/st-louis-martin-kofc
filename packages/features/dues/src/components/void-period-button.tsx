'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type * as z from 'zod';

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
import { Textarea } from '@kit/ui/textarea';

import { VoidPeriodSchema } from '../schemas';
import { voidDuesPeriodAction } from '../server/dues-actions';

type VoidPeriodValues = z.infer<typeof VoidPeriodSchema>;

/**
 * Voids one dues period. Irreversible -- `void_dues_period` only ever sets
 * `voided_at`, never deletes the row -- so a reason is required and shown
 * with the struck-through row from then on.
 */
export function VoidPeriodButton({ periodId }: { periodId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(VoidPeriodSchema),
    defaultValues: { periodId, reason: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({ periodId, reason: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (values: VoidPeriodValues) => {
    startTransition(async () => {
      const result = await voidDuesPeriodAction(values);

      if (result.success) {
        toast.success('Dues period voided.');
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
          <Button variant="outline" size="sm" data-test="void-period">
            Void
          </Button>
        }
      />

      <DialogContent data-test="void-period-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this dues period</DialogTitle>
          <DialogDescription>
            This cannot be undone. The period stays on the record, struck
            through, with the reason you give.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      data-test="void-period-reason"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                data-test="cancel-void-period"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="void-period-submit"
                disabled={isPending}
              >
                Void period
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
