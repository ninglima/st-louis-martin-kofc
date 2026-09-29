'use client';

import { useState, useTransition } from 'react';

import { usePathname, useSearchParams } from 'next/navigation';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
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

import {
  NO_ROLE,
  type UserFilter,
  type UserStatusFilter,
  filterUsers,
  parseUserFilter,
} from '../lib/user-filter';
import { assignRoleAction, setUserActiveAction } from '../server/user-actions';
import type { ManagedUser } from '../server/users.service';
import { CreateUserDialog, type RoleOption } from './create-user-dialog';

/**
 * The role Select's value for "every role". A Select item can't carry the
 * empty string -- Base UI reads that as "nothing selected" -- so the two are
 * kept apart and translated where the filter is read and written.
 */
const ANY_ROLE = '__any__';

const STATUS_LABELS: Record<UserStatusFilter, string> = {
  all: 'Any status',
  active: 'Active',
  inactive: 'Inactive',
};

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState<UserFilter>(() =>
    parseUserFilter({
      q: searchParams.get('q'),
      role: searchParams.get('role'),
      status: searchParams.get('status'),
    }),
  );

  // Every user is already on the page, so filtering happens here and the
  // address bar is only kept in step (for reloads and shared links) with
  // `history.replaceState`, which Next.js syncs without a server round trip.
  const updateFilter = (next: Partial<UserFilter>) => {
    const merged = { ...filter, ...next };
    const params = new URLSearchParams();

    if (merged.q) params.set('q', merged.q);
    if (merged.role) params.set('role', merged.role);
    if (merged.status !== 'all') params.set('status', merged.status);

    const query = params.toString();

    window.history.replaceState(
      null,
      '',
      query ? `${pathname}?${query}` : pathname,
    );
    setFilter(merged);
  };

  const visibleUsers = filterUsers(users, filter);
  const isFiltered =
    filter.q !== '' || filter.role !== '' || filter.status !== 'all';

  const roleLabel = (value: string | null) => {
    if (value === null || value === ANY_ROLE) return 'Any role';
    if (value === NO_ROLE) return 'No role';

    return roles.find((role) => role.id === value)?.name ?? 'Any role';
  };

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="users-search">Search users</Label>

            <Input
              id="users-search"
              data-test="users-search"
              className="w-72"
              placeholder="Email address"
              value={filter.q}
              onChange={(event) => updateFilter({ q: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="users-role">Role</Label>

            <Select
              value={filter.role === '' ? ANY_ROLE : filter.role}
              onValueChange={(next) =>
                updateFilter({
                  role: next === ANY_ROLE || !next ? '' : String(next),
                })
              }
            >
              <SelectTrigger
                id="users-role"
                data-test="users-role"
                className="w-48"
              >
                <SelectValue>{roleLabel}</SelectValue>
              </SelectTrigger>

              <SelectContent>
                <SelectItem value={ANY_ROLE}>Any role</SelectItem>

                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}

                <SelectItem value={NO_ROLE}>No role</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="users-status">Status</Label>

            <Select
              value={filter.status}
              onValueChange={(next) =>
                updateFilter({
                  status: parseUserFilter({ status: next }).status,
                })
              }
            >
              <SelectTrigger
                id="users-status"
                data-test="users-status"
                className="w-40"
              >
                <SelectValue>
                  {(value: string | null) =>
                    STATUS_LABELS[parseUserFilter({ status: value }).status]
                  }
                </SelectValue>
              </SelectTrigger>

              <SelectContent>
                {(Object.keys(STATUS_LABELS) as UserStatusFilter[]).map(
                  (option) => (
                    <SelectItem key={option} value={option}>
                      {STATUS_LABELS[option]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <If condition={canManage}>
          <CreateUserDialog
            roles={roles}
            trigger={
              <Button data-test="create-user">{t('users.createUser')}</Button>
            }
          />
        </If>
      </div>

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
          {visibleUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              roles={roles}
              canManage={canManage}
              isSelf={user.id === currentUserId}
            />
          ))}

          <If condition={visibleUsers.length === 0}>
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                <div
                  className="flex items-center gap-3"
                  data-test="users-empty"
                >
                  {isFiltered
                    ? 'No users match these filters.'
                    : 'No users yet.'}

                  <If condition={isFiltered}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-test="users-clear-filters"
                      onClick={() =>
                        updateFilter({ q: '', role: '', status: 'all' })
                      }
                    >
                      Clear filters
                    </Button>
                  </If>
                </div>
              </TableCell>
            </TableRow>
          </If>
        </TableBody>
      </Table>

      <p className="text-muted-foreground text-sm" data-test="users-count">
        Showing {visibleUsers.length} of {users.length}{' '}
        {users.length === 1 ? 'user' : 'users'}
      </p>
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
