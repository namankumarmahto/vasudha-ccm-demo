-- alter_profiles.sql
-- Adds management fields to profiles so admin can approve/block registrations
alter table if exists public.profiles
  add column if not exists approved boolean default false,
  add column if not exists blocked boolean default false,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

-- optional: show current rows (manual inspect in Supabase)
-- select id, username, full_name, approved, blocked, terms_version, terms_accepted_at from public.profiles limit 50;
