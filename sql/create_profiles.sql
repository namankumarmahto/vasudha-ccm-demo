-- create_profiles.sql
-- Run this in Supabase SQL editor (or via supabase CLI) to create profiles table
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  username text unique,
  phone text,
  role text,
  created_at timestamptz default now()
);

create unique index if not exists profiles_username_idx on public.profiles(username);
