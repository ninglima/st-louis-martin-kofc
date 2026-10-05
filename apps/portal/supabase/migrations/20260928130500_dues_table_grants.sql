-- Dues tables follow the repo's revoke-all-then-grant convention. Final
-- review M3.
--
-- `20260928120000_dues_model` left Supabase's default table privileges in
-- place, so anon and authenticated held TRUNCATE, REFERENCES, TRIGGER and
-- MAINTAIN on both dues tables. TRUNCATE in particular bypasses RLS and the
-- row-level `dues_periods_guard`. None of them is needed: every dues read and
-- write goes through the security-definer functions, and the only direct
-- table access is authenticated SELECT on dues_levels (RLS policy
-- `dues_levels_select`), which is granted back.

revoke all on public.dues_periods from anon, authenticated;
revoke all on public.dues_levels  from anon, authenticated;

grant select on public.dues_levels to authenticated;
