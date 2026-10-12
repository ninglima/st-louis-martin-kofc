'use client';

import { useActionState } from 'react';

import { toast } from 'sonner';

import { Button } from '@kit/ui/button';

import {
  emailPacketAction,
  emailWorksheetAction,
} from '../server/report-actions';

type MailResult =
  | { success: true; sentTo: string }
  | { success: false; error: string };

async function emailWorksheet(
  _previous: MailResult | null,
  formData: FormData,
): Promise<MailResult> {
  return deliver(emailWorksheetAction(formData));
}

async function emailPacket(
  _previous: MailResult | null,
  formData: FormData,
): Promise<MailResult> {
  return deliver(emailPacketAction(formData));
}

async function deliver(pending: Promise<MailResult>): Promise<MailResult> {
  const result = await pending;

  if (result.success) {
    toast.success(`The report was sent to ${result.sentTo}.`);
  } else {
    toast.error(`The report was not sent. ${result.error}`);
  }

  return result;
}

function EmailResult({ state }: { state: MailResult | null }) {
  if (!state) return null;

  if (state.success) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        The report was sent to {state.sentTo}.
      </p>
    );
  }

  return (
    <p className="text-destructive text-sm" role="alert">
      The report was not sent. {state.error}
    </p>
  );
}

export function EmailWorksheetForm({
  month,
  emailBlocker,
}: {
  month: string;
  emailBlocker: string | null;
}) {
  const [state, action, pending] = useActionState(emailWorksheet, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="month" value={month} />
      <Button
        type="submit"
        data-test="email-worksheet"
        disabled={emailBlocker !== null || pending}
      >
        Email to me
      </Button>
      {emailBlocker ? (
        <p className="text-muted-foreground text-sm">{emailBlocker}</p>
      ) : (
        <EmailResult state={state} />
      )}
    </form>
  );
}

export function EmailPacketForm({
  id,
  emailBlocker,
}: {
  id: string;
  emailBlocker: string | null;
}) {
  const [state, action, pending] = useActionState(emailPacket, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        data-test="email-packet"
        disabled={emailBlocker !== null || pending}
      >
        Email to me
      </Button>
      {emailBlocker ? null : <EmailResult state={state} />}
    </form>
  );
}
