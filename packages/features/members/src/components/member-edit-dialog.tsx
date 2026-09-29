'use client';

import { useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

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
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

import {
  MEMBER_EDIT_LABELS,
  MemberEditSchema,
  changedFields,
} from '../lib/member-edit';
import type { MemberEditField, MemberEditValues } from '../lib/member-edit';
import {
  loadMemberForEditAction,
  updateMemberAction,
} from '../server/members-actions';

type TextField = Exclude<MemberEditField, 'bad_address'>;

/** The one error line, rendered in exactly one of two places -- see below. */
function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="text-destructive text-sm"
      data-test="member-edit-error"
    >
      {message}
    </p>
  );
}

const SECTIONS: { title: string; note?: string; fields: TextField[] }[] = [
  {
    title: 'Name',
    fields: ['prefix', 'first_name', 'middle_name', 'last_name', 'suffix'],
  },
  {
    title: 'Contact',
    note: 'Clearing a field here lets the next roster import fill it again.',
    fields: [
      'primary_email',
      'email_secondary',
      'phone_cell',
      'phone_residence',
      'phone_business',
    ],
  },
  {
    title: 'Address',
    note: 'Clearing a field here lets the next roster import fill it again.',
    // No `secondary_address` field: the roster import stores it as a JSON
    // string (roster-import.service.ts, toPayload), so a text box would show
    // raw JSON rather than an editable address. It stays untouched in the
    // form values, so `changedFields` never sends it.
    fields: [
      'address_line1',
      'address_line2',
      'city',
      'state',
      'postal_code',
      'country',
    ],
  },
];

/**
 * Edits one member's name, contact details and address. The values are
 * fetched when the dialog opens, never before, so decrypted details reach
 * the browser only for the member being edited. Save sends only the fields
 * that changed; `member_update` validates again and logs the change.
 */
export function MemberEditDialog({
  memberId,
  trigger,
}: {
  memberId: string;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [membershipNumber, setMembershipNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const initial = useRef<MemberEditValues | null>(null);

  const form = useForm<MemberEditValues>({
    resolver: zodResolver(MemberEditSchema),
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);

    if (!next) return;

    setError(null);
    setMembershipNumber(null);
    initial.current = null;

    startLoading(async () => {
      const result = await loadMemberForEditAction({ memberId });

      if (!result.success) {
        setError(result.error);

        return;
      }

      initial.current = result.member.values;
      setMembershipNumber(result.member.membershipNumber);
      form.reset(result.member.values);
    });
  };

  const onSubmit = (values: MemberEditValues) => {
    if (!initial.current) return;

    const changes = changedFields(initial.current, values);

    // A stale error from a previous failed save must not still be on screen
    // for a retry that hasn't answered yet.
    setError(null);

    startSaving(async () => {
      const result = await updateMemberAction({ memberId, changes });

      if (!result.success) {
        setError(result.error);

        return;
      }

      toast.success('Member updated.');
      setOpen(false);
      router.refresh();
    });
  };

  const ready = initial.current !== null && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />

      <DialogContent
        data-test="member-edit-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            Edit member{membershipNumber ? ` #${membershipNumber}` : ''}
          </DialogTitle>
          <DialogDescription>
            Changes are saved to the member record. The member&apos;s sign-in
            email is not changed.
          </DialogDescription>
        </DialogHeader>

        {/*
          No form is on screen yet (still loading, or the load itself
          failed), so the error is shown here. Once the form is up, it moves
          next to Save below -- never both at once.
        */}
        <If condition={!ready}>
          <If condition={error}>
            {(message) => <ErrorMessage message={message} />}
          </If>
        </If>

        <If condition={loading}>
          <p className="text-muted-foreground text-sm">Loading…</p>
        </If>

        <If condition={ready}>
          <Form {...form}>
            <form
              className="flex flex-col gap-y-6"
              onSubmit={form.handleSubmit(onSubmit)}
              // The browser's own validation (e.g. the email input type)
              // would race zod's, and report differently. zod is the one
              // source of truth on screen; the database stays the authority.
              noValidate
            >
              {SECTIONS.map((section) => (
                <fieldset key={section.title} className="flex flex-col gap-y-3">
                  <legend className="font-heading text-sm font-semibold">
                    {section.title}
                  </legend>

                  <If condition={section.note}>
                    {(note) => (
                      <p className="text-muted-foreground text-xs">{note}</p>
                    )}
                  </If>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.fields.map((name) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{MEMBER_EDIT_LABELS[name]}</FormLabel>
                            <FormControl>
                              <Input
                                data-test={`member-edit-${name}`}
                                type={name.includes('email') ? 'email' : 'text'}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>

                  <If condition={section.title === 'Address'}>
                    <FormField
                      control={form.control}
                      name="bad_address"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2">
                          <FormControl>
                            <Checkbox
                              data-test="member-edit-bad_address"
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <FormLabel>
                            Bad address (mail to this address is returned)
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </If>
                </fieldset>
              ))}

              {/* Next to Save, so a failed save is visible without scrolling
                  back to the top of a long form. */}
              <If condition={error}>
                {(message) => <ErrorMessage message={message} />}
              </If>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-test="member-edit-save"
                  disabled={!form.formState.isDirty || saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </If>
      </DialogContent>
    </Dialog>
  );
}
