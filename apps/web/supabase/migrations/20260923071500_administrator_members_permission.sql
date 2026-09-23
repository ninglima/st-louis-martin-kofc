-- The Administrator role is described in 20260922033217_rbac.sql as "Full
-- access to every section", but the grant beside that description is a fixed
-- list of sections written before `members` existed. So on any database built
-- from migrations alone -- a fresh local stack, a new environment, the
-- production project on its first deploy -- the one role that is supposed to
-- reach everything is the role that cannot open /home/members, and cannot
-- import the roster either. The section has to be clicked in by hand through
-- /home/settings/roles before the feature works at all.
--
-- Granted here rather than by editing the seed: 20260922033217_rbac.sql is
-- already applied everywhere, so a change to it would never run again.
--
-- `on conflict do nothing` makes this a no-op wherever somebody has already
-- added the section through the Roles screen, and keeps their choice of verbs
-- rather than resetting it.
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, 'members', true, true
from public.roles r
where r.slug = 'administrator'
on conflict (role_id, section) do nothing;
