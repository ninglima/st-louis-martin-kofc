'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
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
import { Input } from '@kit/ui/input';

import {
  SaveDuesLevelSchema,
  type SaveDuesLevelValues,
  priceChangeNotice,
} from '../schemas';
import { saveDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';

function defaults(level: AdminDuesLevel | null): SaveDuesLevelValues {
  return level
    ? {
        slug: level.slug,
        name: level.name,
        amount: (level.amountCents / 100).toFixed(2),
        selfService: level.selfService,
        sortOrder: String(level.sortOrder),
      }
    : { slug: null, name: '', amount: '', selfService: true, sortOrder: '0' };
}

/** Add (`level` null) or edit one dues level. A changed price applies to
 * payments made from then on; the database keeps earlier payments whole. */
export function DuesLevelFormDialog({
  level,
}: {
  level: AdminDuesLevel | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(SaveDuesLevelSchema),
    defaultValues: defaults(level),
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults(level));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const notice = priceChangeNotice(
    level?.amountCents ?? null,
    form.watch('amount'),
  );

  const onSubmit = (values: SaveDuesLevelValues) => {
    startTransition(async () => {
      const result = await saveDuesLevelAction(values);

      if (result.success) {
        toast.success(level ? 'Dues level saved.' : 'Dues level added.');
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
          level ? (
            <Button
              variant="outline"
              size="sm"
              data-test="edit-dues-level"
              aria-label={`Edit ${level.name}`}
            >
              Edit
            </Button>
          ) : (
            <Button data-test="add-dues-level">Add level</Button>
          )
        }
      />

      <DialogContent data-test="dues-level-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {level ? `Edit ${level.name}` : 'Add a dues level'}
          </DialogTitle>
          <DialogDescription>
            Members see the name and amount at checkout.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input data-test="dues-level-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (dollars)</FormLabel>
                  <FormControl>
                    <Input
                      data-test="dues-level-amount"
                      inputMode="decimal"
                      placeholder="58.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {notice ? (
                    <p
                      className="text-muted-foreground text-sm"
                      data-test="dues-level-price-notice"
                    >
                      {notice}
                    </p>
                  ) : null}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="selfService"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      data-test="dues-level-self-service"
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <FormLabel>
                    Members choose it themselves (otherwise the Financial
                    Secretary assigns it)
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order</FormLabel>
                  <FormControl>
                    <Input
                      data-test="dues-level-order"
                      inputMode="numeric"
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
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="dues-level-save"
                disabled={isPending}
              >
                {level ? 'Save' : 'Add level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
