import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { RoleFormValues } from '../schemas/role.schema';
import { sectionSupportsVerb } from '../types/sections';

type RbacClient = SupabaseClient<Database>;

export interface RoleWithPermissions {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_default: boolean;
  permissions: Array<{ section: string; can_view: boolean; can_manage: boolean }>;
  user_count: number;
}

export class RolesService {
  constructor(private client: RbacClient) {}

  async listRoles(): Promise<RoleWithPermissions[]> {
    const { data: roles, error } = await this.client
      .from('roles')
      .select('id, slug, name, description, is_system, is_default')
      .order('name');

    if (error) {
      throw new Error(`Failed to load roles: ${error.message}`);
    }

    const { data: grants } = await this.client
      .from('role_permissions')
      .select('role_id, section, can_view, can_manage');

    const { data: assignments } = await this.client
      .from('user_roles')
      .select('role_id');

    return (roles ?? []).map((role) => ({
      ...role,
      permissions: (grants ?? [])
        .filter((g) => g.role_id === role.id)
        .map(({ section, can_view, can_manage }) => ({ section, can_view, can_manage })),
      user_count: (assignments ?? []).filter((a) => a.role_id === role.id).length,
    }));
  }

  /**
   * Drops grants for verbs the section does not define, so a malformed payload
   * cannot store a permission the UI would never show.
   */
  private sanitize(permissions: RoleFormValues['permissions']) {
    return permissions
      .filter((p) => sectionSupportsVerb(p.section, 'view') || sectionSupportsVerb(p.section, 'manage'))
      .map((p) => ({
        section: p.section,
        can_view: sectionSupportsVerb(p.section, 'view') ? p.can_view : false,
        can_manage: sectionSupportsVerb(p.section, 'manage') ? p.can_manage : false,
      }));
  }

  async createRole(values: RoleFormValues): Promise<string> {
    if (values.is_default) {
      await this.client.from('roles').update({ is_default: false }).eq('is_default', true);
    }

    const { data, error } = await this.client
      .from('roles')
      .insert({
        slug: values.slug,
        name: values.name,
        description: values.description || null,
        is_default: values.is_default,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create role: ${error?.message}`);
    }

    await this.replacePermissions(data.id, values);

    return data.id;
  }

  async updateRole(id: string, values: RoleFormValues): Promise<void> {
    if (values.is_default) {
      await this.client.from('roles').update({ is_default: false }).eq('is_default', true);
    }

    const { error } = await this.client
      .from('roles')
      .update({
        name: values.name,
        description: values.description || null,
        is_default: values.is_default,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update role: ${error.message}`);
    }

    await this.replacePermissions(id, values);
  }

  /**
   * Reconciles role_permissions for one role against a new desired set.
   *
   * IMPORTANT ORDERING: this upserts the new rows *before* deleting the
   * stale ones. A delete-then-insert split across two PostgREST calls runs
   * as two separate transactions; deleting first would, for a moment,
   * commit a state where the role (e.g. Administrator) holds none of its
   * permissions at all. The `prevent_admin_lockout_permissions` constraint
   * trigger checks the active-admin count at COMMIT of *each* statement
   * (deferrable initially deferred only defers within one transaction, and
   * each PostgREST call is its own transaction) -- so a standalone DELETE
   * that transiently zeroes out `users.manage` on Administrator would raise
   * "This change would leave no active administrator" and the role would
   * become permanently uneditable.
   *
   * Upserting first never removes a grant, so it can only raise if the new
   * payload itself changes an existing row's can_manage from true to
   * false (e.g. someone genuinely tries to strip users.manage from the
   * last admin) -- which is exactly when we want it to raise. The
   * follow-up delete then only ever removes rows that are no longer in
   * the desired set, none of which were relied on to keep the trigger
   * satisfied.
   */
  private async replacePermissions(roleId: string, values: RoleFormValues) {
    const rows = this.sanitize(values.permissions)
      .filter((p) => p.can_view || p.can_manage)
      .map((p) => ({ role_id: roleId, ...p }));

    if (rows.length > 0) {
      const { error } = await this.client
        .from('role_permissions')
        .upsert(rows, { onConflict: 'role_id,section' });

      if (error) {
        throw new Error(`Failed to save permissions: ${error.message}`);
      }
    }

    const keepSections = rows.map((r) => r.section);

    let deleteQuery = this.client
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);

    if (keepSections.length > 0) {
      deleteQuery = deleteQuery.not(
        'section',
        'in',
        `(${keepSections.join(',')})`,
      );
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      throw new Error(`Failed to save permissions: ${deleteError.message}`);
    }
  }

  async deleteRole(id: string): Promise<void> {
    const { error } = await this.client.from('roles').delete().eq('id', id);

    if (error) {
      // Surfaces the trigger's message and the on-delete-restrict violation
      // in a form a human can act on.
      throw new Error(
        error.message.includes('violates foreign key')
          ? 'This role still has users assigned. Reassign them first.'
          : error.message,
      );
    }
  }
}
