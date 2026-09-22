'use client';

import { useTransition } from 'react';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { assignRoleAction, setUserActiveAction } from '../server/user-actions';
import type { ManagedUser } from '../server/users.service';
import { CreateUserDialog, type RoleOption } from './create-user-dialog';

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(dateString));
}

export function UsersManager({
  users,
  roles,
  canManage,
  currentUserId,
}: {
  users: ManagedUser[];
  roles: RoleOption[];
  canManage: boolean;
  currentUserId: string;
}) {
  const t = useTranslations('rbac');

  return (
    <div className="flex flex-col gap-y-4">
      <If condition={canManage}>
        <div className="flex justify-end">
          <CreateUserDialog
            roles={roles}
            trigger={
              <Button data-test="create-user">{t('users.createUser')}</Button>
            }
          />
        </div>
      </If>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              roles={roles}
              canManage={canManage}
              isSelf={user.id === currentUserId}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UserRow({
  user,
  roles,
  canManage,
  isSelf,
}: {
  user: ManagedUser;
  roles: RoleOption[];
  canManage: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations('rbac');
  const [isRolePending, startRoleTransition] = useTransition();
  const [isStatusPending, startStatusTransition] = useTransition();

  const onRoleChange = (roleId: string) => {
    startRoleTransition(async () => {
      const loadingToast = toast.loading('Updating role…');

      // assignRoleAction never throws for an expected failure -- it returns
      // a result, because Next.js redacts thrown Server Action error
      // messages in production. Inspecting the result is what lets the
      // trigger's real message (e.g. a lockout guard) reach the admin.
      const result = await assignRoleAction({ userId: user.id, roleId });

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success('Role updated.');
      } else {
        toast.error(result.error);
      }
    });
  };

  const onToggleActive = () => {
    const nextActive = !user.is_active;

    startStatusTransition(async () => {
      const loadingToast = toast.loading(
        nextActive ? 'Reactivating…' : 'Deactivating…',
      );

      const result = await setUserActiveAction({
        userId: user.id,
        active: nextActive,
      });

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success(nextActive ? 'User reactivated.' : 'User deactivated.');
      } else {
        toast.error(result.error);
      }
    });
  };

  const roleControl = canManage ? (
    <Select
      value={user.role_id ?? undefined}
      onValueChange={(value) => {
        if (value) {
          onRoleChange(value);
        }
      }}
      disabled={isSelf || isRolePending}
    >
      <SelectTrigger
        data-test={`user-role-select-${user.id}`}
        size="sm"
        className="w-40"
      >
        <SelectValue placeholder={user.role_name ?? '—'}>
          {(value: string | null) =>
            roles.find((role) => role.id === value)?.name ??
            user.role_name ??
            '—'
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <span>{user.role_name ?? '—'}</span>
  );

  const toggleButton = canManage ? (
    <Button
      variant="outline"
      size="sm"
      data-test={`toggle-user-active-${user.id}`}
      disabled={isSelf || isStatusPending}
      onClick={onToggleActive}
    >
      {user.is_active ? t('users.deactivate') : t('users.reactivate')}
    </Button>
  ) : null;

  return (
    <TableRow data-test={`user-row-${user.id}`}>
      <TableCell>{user.email ?? '—'}</TableCell>
      <TableCell>
        <If condition={canManage && isSelf} fallback={roleControl}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-block">{roleControl}</span>}
              />
              <TooltipContent>{t('users.cannotEditSelf')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </If>
      </TableCell>
      <TableCell>
        <Badge
          variant={user.is_active ? 'default' : 'outline'}
          className={user.is_active ? badgeExtras.success : undefined}
        >
          {user.is_active ? t('users.active') : t('users.inactive')}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {formatDate(user.created_at)}
      </TableCell>
      <TableCell>
        <If condition={canManage && isSelf} fallback={toggleButton}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-block">{toggleButton}</span>}
              />
              <TooltipContent>{t('users.cannotEditSelf')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </If>
      </TableCell>
    </TableRow>
  );
}
