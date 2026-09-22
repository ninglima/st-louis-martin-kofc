'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
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
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { CreateUserSchema, type CreateUserFormValues } from '../schemas/user.schema';
import { createUserAction } from '../server/user-actions';

export interface RoleOption {
  id: string;
  name: string;
}

function buildDefaultValues(roles: RoleOption[]): CreateUserFormValues {
  return {
    email: '',
    role_id: roles[0]?.id ?? '',
    mode: 'invite',
    password: '',
  };
}

/**
 * Create-user dialog. Mode drives which fields are relevant: "invite" sends
 * a Supabase invite email (requires SMTP to be configured -- the sandbox
 * mailer is rate-limited and not viable in production, hence the hint),
 * "password" sets a password directly and forces a rotation on first sign-in
 * (see `UsersService.createUserWithPassword`).
 */
export function CreateUserDialog({
  roles,
  trigger,
}: {
  roles: RoleOption[];
  trigger: React.ReactElement;
}) {
  const t = useTranslations('rbac');
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: buildDefaultValues(roles),
  });

  // Re-seed the form every time the dialog opens, so a cancelled create
  // never leaks into the next time this same dialog instance is opened.
  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(roles));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mode = useWatch({ control: form.control, name: 'mode' });

  const onSubmit = (values: CreateUserFormValues) => {
    startTransition(async () => {
      const loadingToast = toast.loading('Creating user…');

      // createUserAction never throws for an expected failure -- it returns
      // a result, because Next.js redacts thrown Server Action error
      // messages in production. Inspecting the result (rather than relying
      // on toast.promise's `error` callback) is what lets the real message
      // reach the admin.
      const result = await createUserAction(values);

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success('User created.');
        // Only close on success -- a refused create must leave the dialog
        // open so the admin can see why and retry without losing their
        // edits.
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger render={trigger} />

      <DialogContent data-test="create-user-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('users.createUser')}</DialogTitle>
          <DialogDescription>
            Invite a member by email, or set a password directly.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      data-test="user-email"
                      type="email"
                      placeholder="member@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger data-test="user-role" className="w-full">
                        <SelectValue placeholder="Select a role">
                          {(value: string | null) =>
                            roles.find((role) => role.id === value)?.name ??
                            'Select a role'
                          }
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mode</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger data-test="user-mode" className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            value === 'password'
                              ? t('users.passwordMode')
                              : t('users.inviteMode')
                          }
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="invite">
                        {t('users.inviteMode')}
                      </SelectItem>
                      <SelectItem value="password">
                        {t('users.passwordMode')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <If condition={mode === 'invite'}>
              <p
                className="text-muted-foreground text-xs"
                data-test="invite-smtp-hint"
              >
                {t('users.smtpHint')}
              </p>
            </If>

            <If condition={mode === 'password'}>
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        data-test="user-password"
                        type="password"
                        placeholder="At least 8 characters"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </If>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                data-test="cancel-create-user"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="submit-create-user"
                disabled={isPending}
              >
                {t('users.createUser')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
