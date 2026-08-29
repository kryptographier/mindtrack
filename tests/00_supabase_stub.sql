-- Minimal stand-in for the parts of Supabase's `auth` schema our
-- migrations depend on, so they can be validated against a plain
-- local Postgres instance. NOT part of the real migration set.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- In real Supabase, auth.uid() reads the JWT claim `sub`.
-- Here we read a settable session variable instead.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- In real Supabase, auth.jwt() returns the full decoded JWT as
-- jsonb. Here we build a minimal jsonb object from session vars.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('session_id', current_setting('test.session_id', true));
$$;

-- Fail-fast assertion helper for the automated test suite.
-- Unlike a bare `raise notice`, this actually aborts the script
-- with a non-zero exit code on failure, which is what lets CI
-- treat "the tests ran" and "the tests passed" as different
-- things instead of requiring a human to read NOTICE output.
create or replace function test_assert(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
  raise notice 'PASS: %', message;
end;
$$;
