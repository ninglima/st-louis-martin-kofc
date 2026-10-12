'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Textarea } from '@kit/ui/textarea';

import { centsToDollarsInput } from '../lib/money';
import { PaymentPacketFormSchema } from '../schemas';
import {
  deletePaymentPacketAction,
  savePaymentPacketAction,
} from '../server/report-actions';
import type { PaymentPacket } from '../types';

function dollarsOrEmpty(cents: number | null): string {
  return cents === null ? '' : centsToDollarsInput(cents);
}

export function PaymentPacketForm({
  editing,
  month,
}: {
  editing: PaymentPacket | null;
  month: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      ...(editing ? { id: editing.id } : {}),
      label: String(data.get('label') ?? ''),
      supreme: String(data.get('supreme') ?? ''),
      state: String(data.get('state') ?? ''),
      note: String(data.get('note') ?? ''),
    };
    const parsed = PaymentPacketFormSchema.safeParse(input);

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? 'Check the packet details.';
      setError(message);
      toast.error(message);
      return;
    }

    startTransition(async () => {
      const result = await savePaymentPacketAction(parsed.data);

      if (result.success) {
        setError(null);
        toast.success('Payment packet saved');
        if (!editing) form.reset();
        return;
      }

      setError(result.error);
      toast.error(result.error);
    });
  };

  const onDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;

    startTransition(async () => {
      const result = await deletePaymentPacketAction({ id: editing.id });

      if (result.success) {
        toast.success('Payment packet deleted');
        router.replace(`${pathname}?month=${encodeURIComponent(month)}`);
        return;
      }

      setError(result.error);
      toast.error(result.error);
    });
  };

  return (
    <div className="flex max-w-md flex-col gap-y-4">
      <form className="flex flex-col gap-y-4" onSubmit={onSave}>
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

        <div className="flex flex-col gap-y-1">
          <Label htmlFor="packet-label">Label</Label>
          <Input
            id="packet-label"
            name="label"
            data-test="packet-label"
            defaultValue={editing?.label ?? ''}
            placeholder="Supreme, January 2027"
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <Label htmlFor="packet-supreme">Supreme total</Label>
          <Input
            id="packet-supreme"
            name="supreme"
            data-test="packet-supreme"
            inputMode="decimal"
            placeholder="25.00"
            defaultValue={editing ? dollarsOrEmpty(editing.supremeCents) : ''}
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <Label htmlFor="packet-state">State total</Label>
          <Input
            id="packet-state"
            name="state"
            data-test="packet-state"
            inputMode="decimal"
            placeholder="25.00"
            defaultValue={editing ? dollarsOrEmpty(editing.stateCents) : ''}
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <Label htmlFor="packet-note">Note</Label>
          <Textarea
            id="packet-note"
            name="note"
            data-test="packet-note"
            rows={2}
            defaultValue={editing?.note ?? ''}
          />
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" data-test="packet-save" disabled={pending}>
          Save
        </Button>
      </form>

      {editing ? (
        <form onSubmit={onDelete}>
          <input type="hidden" name="id" value={editing.id} />
          <Button
            type="submit"
            variant="destructive"
            data-test="packet-delete"
            disabled={pending}
          >
            Delete
          </Button>
        </form>
      ) : null}
    </div>
  );
}
