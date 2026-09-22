'use client';

import { useTransition } from 'react';

import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@kit/ui/alert-dialog';
import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';

import { deleteRoleAction } from '../server/role-actions';
import type { RoleWithPermissions } from '../server/roles.service';
import { SECTIONS } from '../types/sections';
import { RoleFormDialog } from './role-form-dialog';

/**
 * Compact, human-readable summary of what a role can reach, e.g.
 * "Home, Payments (manage), Payment Settings (manage)". Driven by SECTIONS
 * so the summary never lists a section that no longer exists.
 */
function summarizePermissions(role: RoleWithPermissions): string {
  const granted = SECTIONS.map((section) => {
    const grant = role.permissions.find((p) => p.section === section.key);

    if (!grant || (!grant.can_view && !grant.can_manage)) {
      return null;
    }

    return grant.can_manage ? `${section.label} (manage)` : section.label;
  }).filter((label): label is string => label !== null);

  return granted.length > 0 ? granted.join(', ') : 'No permissions granted';
}

export function RolesManager({
  roles,
  canManage,
}: {
  roles: RoleWithPermissions[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-y-4">
      <If condition={canManage}>
        <div className="flex justify-end">
          <RoleFormDialog
            trigger={<Button data-test="create-role">Create role</Button>}
          />
        </div>
      </If>

      <div className="flex flex-col gap-y-3">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

function RoleCard({
  role,
  canManage,
}: {
  role: RoleWithPermissions;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const loadingToast = toast.loading(`Deleting ${role.name}…`);

      // The service already turns the on-delete-restrict foreign key
      // violation into "This role still has users assigned. Reassign them
      // first." -- and the database trigger may add "System roles cannot be
      // deleted" or "This change would leave no active administrator".
      // deleteRoleAction returns those as `{ success: false, error }`
      // rather than throwing, because Next.js redacts thrown Server Action
      // error messages in production -- reading `result.error` is what
      // lets the real message reach the toast verbatim.
      const result = await deleteRoleAction({ id: role.id });

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success(`${role.name} deleted.`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card data-test={`role-card-${role.slug}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-y-1">
            <CardTitle className="flex flex-wrap items-center gap-x-2">
              {role.name}
              <If condition={role.is_system}>
                <Badge variant="outline">System</Badge>
              </If>
              <If condition={role.is_default}>
                <Badge className={badgeExtras.info}>Default</Badge>
              </If>
            </CardTitle>
            <CardDescription>
              {role.slug} · {role.user_count}{' '}
              {role.user_count === 1 ? 'member' : 'members'}
            </CardDescription>
          </div>

          <If condition={canManage}>
            <div className="flex items-center gap-x-2">
              <RoleFormDialog
                role={role}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    data-test={`edit-role-${role.slug}`}
                  >
                    Edit
                  </Button>
                }
              />

              {/* Both seeded roles are system roles, so Delete never
                  appears for them -- that is correct, not a bug. */}
              <If condition={!role.is_system}>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="destructive"
                        size="sm"
                        data-test="delete-role"
                        disabled={isPending}
                      >
                        Delete
                      </Button>
                    }
                  />

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. Members currently assigned this
                        role must be reassigned before it can be deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        data-test="confirm-delete-role"
                        disabled={isPending}
                        onClick={onDelete}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </If>
            </div>
          </If>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-y-2">
        <If condition={role.description}>
          <p className="text-muted-foreground text-sm">{role.description}</p>
        </If>

        <p className="text-sm">
          <span className="text-muted-foreground">Grants: </span>
          {summarizePermissions(role)}
        </p>
      </CardContent>
    </Card>
  );
}
