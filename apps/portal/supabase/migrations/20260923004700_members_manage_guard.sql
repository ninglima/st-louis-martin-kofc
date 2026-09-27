-- Two guards the apply step cannot enforce for itself.

-- F1: `applyChunk` created a real, durable, sign-in-capable auth.users account
-- BEFORE the only permission check — the one inside member_upsert_from_roster —
-- ever ran. A grant revoked between the preview and a later chunk therefore
-- produced exactly the outcome the per-chunk re-check exists to prevent:
-- orphaned accounts for real members, created by a caller who was then denied.
-- A failed row is not rolled back and re-running does not clean them up.
--
-- The apply step needs to ask the question BEFORE it touches auth, and
-- kit.has_permission lives in a schema the client cannot reach. members_list
-- gates on 'view', which is the wrong verb. So: a thin wrapper, no side
-- effects, returning the same answer the upsert will give.
create or replace function public.members_can_manage()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select kit.has_permission('members', 'manage')
$$;

comment on function public.members_can_manage() is
  'Whether the caller may apply a roster import. Probed before any account is created so a denied chunk cannot leave orphaned auth users behind; the authoritative check remains inside member_upsert_from_roster.';

revoke all on function public.members_can_manage() from public, anon;
grant execute on function public.members_can_manage() to authenticated;

-- F2: nothing stopped two members being linked to one auth user, and
-- members_select_own is `user_id = auth.uid() or has_permission('members','view')`
-- -- so that one account could read the OTHER member's row through PostgREST,
-- decrypted name, number, email, city and state included, without holding
-- members.view.
--
-- The path is narrow but real: a member with no stored primary_email who was
-- given an account by hand is invisible to the planner's
-- `owned-by-another-member` guard, because that guard compares against stored
-- `members.primary_email` and theirs is null. A second member carrying the same
-- address next month is planned as a clean `create`, resolves the first
-- member's auth id, and quietly joins them together.
--
-- Partial, because `user_id` is nullable and most members have no account yet;
-- `unique` on a nullable column would allow this anyway in Postgres, but the
-- predicate states the intent. One membership number, one person, one account.
-- Verified before applying: public.members holds 0 rows and 0 duplicate
-- user_ids, so this cannot fail on existing data.
--
-- The effect is to turn a silent cross-member PII disclosure into a loud failed
-- row that names the member, which applyChunk already collects and reports.
create unique index if not exists members_user_id_uk
  on public.members (user_id)
  where user_id is not null;

comment on index public.members_user_id_uk is
  'One auth account per member. Without this, two members sharing a user_id let either account read the other member''s row through members_select_own.';

-- The non-unique index this replaces would now be redundant: a unique index
-- serves the same lookups. Dropped rather than left to be maintained twice on
-- every write.
drop index if exists public.members_user_id_idx;
