import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type RbacClient = SupabaseClient<Database>;

/** Effectively permanent; Supabase has no true "ban forever" value. */
const BAN_FOREVER = '876000h';

export interface ManagedUser {
  id: string;
  email: string | null;
  created_at: string;
  is_active: boolean;
  role_id: string | null;
  role_name: string | null;
}

export class UsersService {
  constructor(private adminClient: RbacClient) {}

  async listUsers(): Promise<ManagedUser[]> {
    const { data, error } = await this.adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const { data: assignments } = await this.adminClient
      .from('user_roles')
      .select('user_id, role_id, roles(name)');

    return data.users.map((u) => {
      const assignment = (assignments ?? []).find((a) => a.user_id === u.id) as
        | { role_id: string; roles: { name: string } | null }
        | undefined;

      const bannedUntil = u.banned_until;

      return {
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        is_active: !bannedUntil || new Date(bannedUntil) < new Date(),
        role_id: assignment?.role_id ?? null,
        role_name: assignment?.roles?.name ?? null,
      };
    });
  }

  async inviteUser(
    email: string,
    roleId: string,
    invitedBy: string,
  ): Promise<void> {
    const { data, error } =
      await this.adminClient.auth.admin.inviteUserByEmail(email);

    if (error || !data.user) {
      throw new Error(`Failed to invite user: ${error?.message}`);
    }

    await this.assignRole(data.user.id, roleId, invitedBy);
  }

  async createUserWithPassword(
    email: string,
    password: string,
    roleId: string,
    createdBy: string,
  ): Promise<void> {
    const { data, error } = await this.adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // Forces a rotation on first sign-in, so a password the admin knows
      // does not stay valid indefinitely.
      user_metadata: { must_change_password: true },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create user: ${error?.message}`);
    }

    await this.assignRole(data.user.id, roleId, createdBy);
  }

  /** Runs after the on_auth_user_created trigger has made the accounts row. */
  async assignRole(
    userId: string,
    roleId: string,
    assignedBy: string,
  ): Promise<void> {
    const { error } = await this.adminClient
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: roleId, assigned_by: assignedBy },
        { onConflict: 'user_id' },
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    const { error } = await this.adminClient.auth.admin.updateUserById(
      userId,
      {
        ban_duration: active ? 'none' : BAN_FOREVER,
      },
    );

    if (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }
}
