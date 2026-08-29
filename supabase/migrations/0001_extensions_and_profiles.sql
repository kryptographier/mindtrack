-- =========================================================
-- 0001: Extensions + profiles + admin authorization helper
-- =========================================================
-- pgcrypto gives us gen_random_bytes() (CSPRNG) and digest()
-- (SHA-256) for secret-code hashing later. Both are already
-- available on Supabase Postgres; this just ensures the
-- extension is enabled.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- profiles
-- One row per auth.users row. Holds the ONLY authorization-
-- relevant field (`role`) in the entire schema. This table is
-- never writable by the authenticated client — role can only
-- be changed by a service-role/admin action, never by the app.
-- ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- RLS restricts WHICH ROWS a role can see once it has some
-- base privilege on the table — it does not grant that
-- privilege itself. Without this GRANT, `authenticated` would
-- get "permission denied" before RLS is even evaluated.
grant select on public.profiles to authenticated;

-- Users may read their own profile (for UI purposes only —
-- this is NEVER the security boundary; every admin-gated
-- function re-checks role server-side independently).
create policy "profiles_select_own"
  on public.profiles
  for select
  using (id = auth.uid());

-- No insert/update/delete policies exist for the authenticated
-- role at all. Combined with RLS being enabled, this means the
-- client can NEVER modify profiles, including its own role.
-- Row creation happens only via the trigger below (as the
-- table owner), and role changes happen only via direct
-- service-role SQL performed by the project owner (documented
-- in docs/deployment.md), never through the app.

-- ---------------------------------------------------------
-- Auto-provision a profile row whenever a new auth user is
-- created (e.g. after their first successful OTP verification).
-- Always role = 'user'. There is no code path that lets a
-- client request the 'admin' role.
-- ---------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------
-- is_admin(): the single source of truth for admin checks.
-- SECURITY DEFINER so it can read profiles regardless of the
-- caller's own RLS visibility, STABLE because it has no side
-- effects and depends only on the current transaction's
-- snapshot. Every admin-gated policy/function in later
-- migrations calls this — never a client-supplied flag.
-- ---------------------------------------------------------
create function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
