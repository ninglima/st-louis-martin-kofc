-- Fix round 1, finding 2: dues_periods.recorded_by / voided_by were
-- `on delete set null`, but that "cascade" is an UPDATE, and the
-- dues_periods_guard trigger (20260928120000_dues_model.sql) rejects any
-- UPDATE to an already-existing row other than voiding it. So deleting a
-- user who recorded or voided a dues period would fail with "dues periods
-- are immutable" instead of nulling the column, which the old constraint
-- definition misleadingly promised. Per the RBAC spec, users are
-- deactivated rather than deleted, so the audit trail is kept intact by
-- refusing the delete outright: on delete restrict.

alter table public.dues_periods
  drop constraint dues_periods_recorded_by_fkey,
  add constraint dues_periods_recorded_by_fkey
    foreign key (recorded_by) references auth.users(id) on delete restrict;

alter table public.dues_periods
  drop constraint dues_periods_voided_by_fkey,
  add constraint dues_periods_voided_by_fkey
    foreign key (voided_by) references auth.users(id) on delete restrict;
