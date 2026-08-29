-- =========================================================
-- 0002: Configurable settings + diary session expiration
-- =========================================================
-- Why this migration exists: Supabase's dashboard-level idle
-- timeout / time-boxed session feature is Pro-plan-only (verified
-- Aug 2026, see docs/architecture.md section 3). This migration
-- implements the equivalent enforcement ourselves, entirely
-- server-side, so it works on the Free plan.

-- ---------------------------------------------------------
-- app_settings: tunable values, admin-writable only, never
-- directly readable or writable by the client. Functions read
-- it internally via SECURITY DEFINER.
-- ---------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value text not null
);

alter table public.app_settings enable row level security;
-- No policies at all: RLS enabled + zero policies = default
-- deny for every role except the table owner / SECURITY
-- DEFINER functions. The client cannot read or write this
-- table under any circumstances.

insert into public.app_settings (key, value) values
  ('diary_idle_timeout_minutes', '30'),
  ('diary_max_lifetime_hours', '12'),
  ('chat_idle_timeout_minutes', '10'),
  ('chat_max_lifetime_minutes', '30');

create function public.get_setting_int(p_key text, p_default int)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select value::int from public.app_settings where key = p_key),
    p_default
  );
$$;

-- Admin-only way to change a setting. Never exposed to the
-- diary/chat client UI beyond an admin settings screen (Phase 5).
create function public.admin_update_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.app_settings set value = p_value where key = p_key;
  if not found then
    raise exception 'unknown setting key';
  end if;
end;
$$;

revoke all on function public.admin_update_setting(text, text) from public;
grant execute on function public.admin_update_setting(text, text) to authenticated;

-- ---------------------------------------------------------
-- session_activity: one row per active diary session (keyed
-- by the JWT's session_id claim, which Supabase Auth issues
-- and rotates on sign-in). Never directly accessible to the
-- client — only through the functions below.
-- ---------------------------------------------------------
create table public.session_activity (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

alter table public.session_activity enable row level security;
-- No policies: default deny for direct client access, exactly
-- like app_settings above.

create index on public.session_activity (user_id);

-- ---------------------------------------------------------
-- touch_diary_session(): called by the frontend right after
-- establishing a session, and periodically thereafter (a
-- heartbeat) or alongside meaningful user actions. This is
-- where "activity" is recorded — but note that this function
-- ALSO enforces the absolute max-lifetime cap, so no amount of
-- heartbeat spam can extend a session past its hard limit.
-- Returns false (without updating anything) if the session is
-- already expired.
-- ---------------------------------------------------------
create function public.touch_diary_session()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_row record;
  v_idle_minutes int := public.get_setting_int('diary_idle_timeout_minutes', 30);
  v_max_hours int := public.get_setting_int('diary_max_lifetime_hours', 12);
begin
  v_session_id := (auth.jwt() ->> 'session_id')::uuid;
  if v_session_id is null or auth.uid() is null then
    return false;
  end if;

  select * into v_row from public.session_activity where session_id = v_session_id;

  if not found then
    insert into public.session_activity (session_id, user_id, created_at, last_activity_at)
    values (v_session_id, auth.uid(), now(), now());
    return true;
  end if;

  if v_row.user_id != auth.uid() then
    -- Should never happen (session_id is unique per login), but
    -- fail closed rather than silently trusting it.
    return false;
  end if;

  if now() - v_row.created_at > (v_max_hours || ' hours')::interval then
    return false; -- absolute lifetime exceeded; do not extend
  end if;

  if now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then
    return false; -- idle timeout exceeded; do not extend
  end if;

  update public.session_activity
    set last_activity_at = now()
    where session_id = v_session_id;

  return true;
end;
$$;

revoke all on function public.touch_diary_session() from public;
grant execute on function public.touch_diary_session() to authenticated;

-- ---------------------------------------------------------
-- is_diary_session_valid(): READ-ONLY check with no side
-- effects, used inside RLS policies (Migration 0003). Deciding
-- whether to expose data must not itself extend the session —
-- only an explicit touch_diary_session() call does that.
-- ---------------------------------------------------------
create function public.is_diary_session_valid()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_session_id uuid;
  v_row record;
  v_idle_minutes int := public.get_setting_int('diary_idle_timeout_minutes', 30);
  v_max_hours int := public.get_setting_int('diary_max_lifetime_hours', 12);
begin
  v_session_id := (auth.jwt() ->> 'session_id')::uuid;
  if v_session_id is null or auth.uid() is null then
    return false;
  end if;

  select * into v_row from public.session_activity where session_id = v_session_id;

  if not found then
    return false; -- must call touch_diary_session() first
  end if;

  if v_row.user_id != auth.uid() then
    return false;
  end if;

  if now() - v_row.created_at > (v_max_hours || ' hours')::interval then
    return false;
  end if;

  if now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_diary_session_valid() from public;
grant execute on function public.is_diary_session_valid() to authenticated;
