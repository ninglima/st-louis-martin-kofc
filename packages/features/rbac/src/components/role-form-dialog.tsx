'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
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
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

import { RoleSchema, type RoleFormValues } from '../schemas/role.schema';
import { saveRoleAction } from '../server/role-actions';
import type { RoleWithPermissions } from '../server/roles.service';
import { SECTIONS, sectionSupportsVerb } from '../types/sections';

function buildDefaultValues(role?: RoleWithPermissions): RoleFormValues {
  return {
    id: role?.id,
    slug: role?.slug ?? '',
    name: role?.name ?? '',
    description: role?.description ?? '',
    is_default: role?.is_default ?? false,
    permissions: SECTIONS.map((section) => {
      const existing = role?.permissions.find((p) => p.section === section.key);

      return {
        section: section.key,
        can_view: existing?.can_view ?? false,
        can_manage: existing?.can_manage ?? false,
      };
    }),
  };
}

/**
 * Create/edit dialog for a role, including the permission grid.
 *
 * The grid is driven entirely by `SECTIONS`: a section only gets a checkbox
 * for the verbs it declares in `verbs`, so e.g. `payment_settings` (manage
 * only) never renders a View checkbox. Checking Manage force-checks and
 * disables View, mirroring the `manage implies view` rule encoded in
 * `hasPermission` and in the database's `kit.has_permission()`.
 */
export function RoleFormDialog({
  role,
  trigger,
}: {
  role?: RoleWithPermissions;
  trigger: React.ReactElement;
}) {
  const t = useTranslations('rbac');
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isSystemRole = Boolean(role?.is_system);

  const form = useForm({
    resolver: zodResolver(RoleSchema),
    defaultValues: buildDefaultValues(role),
  });

  // Re-seed the form every time the dialog opens, so a cancelled edit never
  // leaks into the next time this same dialog instance is opened.
  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(role));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const permissions = useWatch({ control: form.control, name: 'permissions' });

  const onSubmit = (values: RoleFormValues) => {
    startTransition(async () => {
      const loadingToast = toast.loading(
        role ? 'Saving role…' : 'Creating role…',
      );

      // saveRoleAction never throws for an expected failure (bad
      // permissions, a refused trigger) -- it returns a result, because
      // Next.js redacts thrown Server Action error messages in production.
      // Inspecting the result (rather than relying on toast.promise's
      // `error` callback) is what lets the real message reach the admin.
      const result = await saveRoleAction(values);

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success(role ? 'Role updated.' : 'Role created.');
        // Only close on success -- a refused save must leave the dialog
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

      <DialogContent
        data-test="role-form-dialog"
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {role ? t('roles.editRole', { name: role.name }) : t('roles.create')}
          </DialogTitle>
          <DialogDescription>
            Choose what this role can view and manage across the site.
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
                    <Input
                      data-test="role-name-input"
                      disabled={isSystemRole}
                      placeholder="Treasurer"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input
                      data-test="role-slug-input"
                      disabled={Boolean(role)}
                      placeholder="treasurer"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      data-test="role-description-input"
                      disabled={isSystemRole}
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_default"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-x-2 space-y-0">
                  <div className="flex flex-col gap-y-0.5">
                    <FormLabel>Default role</FormLabel>
                    <span className="text-muted-foreground text-xs">
                      Assigned automatically to new members
                    </span>
                  </div>
                  <FormControl>
                    <Switch
                      data-test="role-is-default-switch"
                      checked={field.value}
                      disabled={isSystemRole}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-y-2">
              <h3 className="text-sm font-medium">Permissions</h3>

              <div className="flex flex-col gap-y-2">
                {SECTIONS.map((section, index) => {
                  const manageChecked = Boolean(
                    permissions?.[index]?.can_manage,
                  );

                  return (
                    <div
                      key={section.key}
                      className="flex flex-col gap-y-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-x-4"
                    >
                      <div className="flex flex-col gap-y-0.5">
                        <span className="text-sm font-medium">
                          {t(`sections.${section.key}`)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {section.description}
                        </span>
                      </div>

                      <div className="flex items-center gap-x-4">
                        {sectionSupportsVerb(section.key, 'view') && (
                          <FormField
                            control={form.control}
                            name={`permissions.${index}.can_view`}
                            render={({ field }) => (
                              <FormItem className="flex items-center gap-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    data-test={`perm-${section.key}-view`}
                                    checked={manageChecked ? true : field.value}
                                    disabled={manageChecked}
                                    onCheckedChange={(checked) =>
                                      field.onChange(Boolean(checked))
                                    }
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal">
                                  {t('verbs.view')}
                                </FormLabel>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {sectionSupportsVerb(section.key, 'manage') && (
                          <FormField
                            control={form.control}
                            name={`permissions.${index}.can_manage`}
                            render={({ field }) => (
                              <FormItem className="flex items-center gap-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    data-test={`perm-${section.key}-manage`}
                                    checked={field.value}
                                    onCheckedChange={(checked) => {
                                      const isChecked = Boolean(checked);
                                      field.onChange(isChecked);

                                      if (isChecked) {
                                        form.setValue(
                                          `permissions.${index}.can_view`,
                                          true,
                                          { shouldDirty: true },
                                        );
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal">
                                  {t('verbs.manage')}
                                </FormLabel>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                data-test="cancel-role"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" data-test="save-role" disabled={isPending}>
                {role ? 'Save changes' : t('roles.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
