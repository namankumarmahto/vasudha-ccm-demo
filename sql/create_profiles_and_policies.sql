-- create_profiles_and_policies.sql
-- Creates profiles table with approved flag and example policies.
-- Run in Supabase SQL Editor or with supabase CLI.

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  username text unique,
  email text, -- optional duplicate of auth email for easier queries
  phone text,
  role text default 'buyer',
  approved boolean default false,
  created_at timestamptz default now()
);

create unique index if not exists profiles_username_idx on public.profiles(username);

-- RLS example (enable RLS manually if you need it)
-- Enable RLS:
-- alter table public.profiles enable row level security;

-- Allow authenticated users to insert their own profile (example)
-- create policy "profiles_insert_authenticated" on public.profiles
--   for insert
--   with check ( auth.uid() = id );

-- Allow users to select their own profile
-- create policy "profiles_select_own" on public.profiles
--   for select using ( auth.uid() = id );

-- Allow users to update only their own profile
-- create policy "profiles_update_own" on public.profiles
--   for update using ( auth.uid() = id ) with check ( auth.uid() = id );

-- Allow admins (role = 'admin' in profiles) to select/update all
-- create policy "profiles_admin_full_access" on public.profiles
--   for all
--   using ( exists (
--     select 1 from public.profiles p2
--     where p2.id = auth.uid() and p2.role = 'admin' and p2.approved = true
--   ));

-- NOTE: The auth.uid() Postgres function is provided by Supabase edge functions (or postgres extension).
-- If you enable RLS, test carefully and adjust policies. For testing you may leave RLS disabled.
