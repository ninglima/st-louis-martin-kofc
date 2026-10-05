import type { ManagedUser } from '../server/users.service';

export type UserStatusFilter = 'all' | 'active' | 'inactive';

/** The role filter's value for users who have no role assigned. */
export const NO_ROLE = 'none';

export interface UserFilter {
  /** Matched against any part of the email, ignoring case. */
  q: string;
  /** A role id, `NO_ROLE`, or '' for every role. */
  role: string;
  status: UserStatusFilter;
}

/** Reads `?q=&role=&status=`; anything missing or unknown means "no filter". */
export function parseUserFilter(params: {
  q?: string | null;
  role?: string | null;
  status?: string | null;
}): UserFilter {
  const status = params.status;

  return {
    q: params.q ?? '',
    role: params.role ?? '',
    status: status === 'active' || status === 'inactive' ? status : 'all',
  };
}

export function filterUsers(
  users: ManagedUser[],
  filter: UserFilter,
): ManagedUser[] {
  const q = filter.q.trim().toLowerCase();

  return users.filter((user) => {
    if (q && !(user.email ?? '').toLowerCase().includes(q)) return false;

    if (filter.role === NO_ROLE && user.role_id !== null) return false;
    if (filter.role && filter.role !== NO_ROLE && user.role_id !== filter.role)
      return false;

    if (filter.status === 'active' && !user.is_active) return false;
    if (filter.status === 'inactive' && user.is_active) return false;

    return true;
  });
}
