-- =========================================================
-- 0010: deployment-ready private chat lifecycle
-- =========================================================

alter table public.secret_codes add column if not exists redeemed_by uuid references auth.users(id);
alter table public.chat_sessions add column if not exists secret_code_id uuid references public.secret_codes(id);
alter table public.chat_sessions drop constraint if exists chat_sessions_status_check;
alter table public.chat_sessions add constraint chat_sessions_status_check check (status in ('active', 'suspended', 'ended', 'expired'));
create index if not exists secret_codes_redeemed_by_idx on public.secret_codes(redeemed_by);
create index if not exists chat_sessions_secret_code_idx on public.chat_sessions(secret_code_id);

-- ---------------------------------------------------------
-- Expiring, reusable, first-user-bound secret codes.
-- ---------------------------------------------------------

drop function if exists public.admin_generate_secret_code();
drop function if exists public.admin_generate_secret_code(integer);

create function public.admin_generate_secret_code(p_expires_in_minutes integer)
returns table(id uuid, plaintext_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_raw bytea; v_code text; v_hash text; v_id uuid; v_expires_at timestamptz;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_expires_in_minutes is null or p_expires_in_minutes < 1 or p_expires_in_minutes > 10080 then raise exception 'invalid expiry'; end if;
  if not public.check_rate_limit('generate_code:' || auth.uid()::text, 10, interval '1 hour') then raise exception 'too many codes generated recently, please wait'; end if;
  v_raw := extensions.gen_random_bytes(12);
  v_code := upper(encode(v_raw, 'hex'));
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4) || '-' || substr(v_code, 17, 4) || '-' || substr(v_code, 21, 4);
  v_hash := encode(extensions.digest(v_code::text, 'sha256'::text), 'hex');
  v_expires_at := now() + make_interval(mins => p_expires_in_minutes);
  insert into public.secret_codes(code_hash, created_by, expires_at, max_attempts, attempt_count, used_at, revoked_at, redeemed_by)
  values(v_hash, auth.uid(), v_expires_at, 999999, 0, null, null, null)
  returning secret_codes.id into v_id;
  return query select v_id, v_code, v_expires_at;
end;
$$;
revoke all on function public.admin_generate_secret_code(integer) from public;
grant execute on function public.admin_generate_secret_code(integer) to authenticated;

-- ---------------------------------------------------------
-- Same code can reopen the same user's chat until code expiry.
-- ---------------------------------------------------------

drop function if exists public.redeem_secret_code(text);

create function public.redeem_secret_code(p_code text)
returns table(chat_session_id uuid, error_message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text; v_code record; v_session record; v_session_id uuid;
  v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  if auth.uid() is null then return query select null::uuid, 'not authenticated'::text; return; end if;
  if p_code is null or btrim(p_code) = '' then return query select null::uuid, 'invalid or expired code'::text; return; end if;
  if not public.check_rate_limit('redeem_code:' || auth.uid()::text, 10, interval '15 minutes') then return query select null::uuid, 'too many attempts, please wait before trying again'::text; return; end if;
  if not public.check_rate_limit('redeem_code:global', 50, interval '1 hour') then return query select null::uuid, 'too many attempts, please wait before trying again'::text; return; end if;

  v_hash := encode(extensions.digest(upper(btrim(p_code))::text, 'sha256'::text), 'hex');
  select id, created_by, expires_at, revoked_at, redeemed_by into v_code
  from public.secret_codes where code_hash = v_hash for update;

  if not found or v_code.revoked_at is not null or v_code.expires_at <= now() then
    return query select null::uuid, 'invalid or expired code'::text; return;
  end if;

  if v_code.redeemed_by is null then
    update public.secret_codes set redeemed_by = auth.uid(), attempt_count = attempt_count + 1 where id = v_code.id;
  elsif v_code.redeemed_by <> auth.uid() then
    return query select null::uuid, 'invalid or expired code'::text; return;
  else
    update public.secret_codes set attempt_count = attempt_count + 1 where id = v_code.id;
  end if;

  select * into v_session
  from public.chat_sessions
  where secret_code_id = v_code.id and user_id = auth.uid() and status = 'active'
  order by created_at desc limit 1 for update;

  if found then
    if now() >= v_session.expires_at or now() - v_session.last_activity_at > (v_idle_minutes || ' minutes')::interval then
      update public.chat_sessions set status = 'expired' where id = v_session.id;
    else
      update public.chat_sessions set last_activity_at = now() where id = v_session.id;
      return query select v_session.id, null::text; return;
    end if;
  end if;

  if exists (select 1 from public.chat_sessions where secret_code_id = v_code.id and user_id = auth.uid() and status = 'suspended') then
    return query select null::uuid, 'private session is suspended'::text; return;
  end if;

  insert into public.chat_sessions(user_id, admin_id, secret_code_id, created_at, expires_at, last_activity_at, status)
  values(auth.uid(), v_code.created_by, v_code.id, now(), v_code.expires_at, now(), 'active')
  returning id into v_session_id;
  return query select v_session_id, null::text;
end;
$$;
revoke all on function public.redeem_secret_code(text) from public;
grant execute on function public.redeem_secret_code(text) to authenticated;

-- Use CREATE OR REPLACE: these functions are referenced by RLS policies.
create or replace function public.is_chat_session_valid(p_session_id uuid)
returns boolean
language plpgsql security definer stable set search_path = public
as $$
declare v_row record; v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  select * into v_row from public.chat_sessions where id = p_session_id;
  if not found then return false; end if;
  if v_row.user_id <> auth.uid() and v_row.admin_id <> auth.uid() then return false; end if;
  if v_row.status <> 'active' then return false; end if;
  if now() >= v_row.expires_at then return false; end if;
  if now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then return false; end if;
  return true;
end;
$$;
revoke all on function public.is_chat_session_valid(uuid) from public;
grant execute on function public.is_chat_session_valid(uuid) to authenticated;

create or replace function public.touch_chat_session(p_session_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_row record; v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  select * into v_row from public.chat_sessions where id = p_session_id for update;
  if not found then return false; end if;
  if v_row.user_id <> auth.uid() and v_row.admin_id <> auth.uid() then return false; end if;
  if v_row.status <> 'active' then return false; end if;
  if now() >= v_row.expires_at or now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then
    update public.chat_sessions set status = 'expired' where id = p_session_id;
    return false;
  end if;
  update public.chat_sessions set last_activity_at = now() where id = p_session_id;
  return true;
end;
$$;
revoke all on function public.touch_chat_session(uuid) from public;
grant execute on function public.touch_chat_session(uuid) to authenticated;

-- The canonical message RPC is send_message(), defined in migration 0005.
-- Remove only the accidental frontend-facing alias if it exists.
drop function if exists public.send_chat_message(uuid, text);

-- Ending is different from navigating back to Journal: ending revokes the code.
drop function if exists public.end_chat_session(uuid);
create function public.end_chat_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_row record;
begin
  select * into v_row from public.chat_sessions where id = p_session_id for update;
  if not found or (v_row.user_id <> auth.uid() and v_row.admin_id <> auth.uid()) then raise exception 'invalid session'; end if;
  update public.chat_sessions set status = 'ended', ended_at = now() where id = p_session_id and status in ('active', 'suspended');
  if v_row.secret_code_id is not null then update public.secret_codes set revoked_at = coalesce(revoked_at, now()) where id = v_row.secret_code_id; end if;
  delete from public.ephemeral_messages where session_id = p_session_id;
end;
$$;
revoke all on function public.end_chat_session(uuid) from public;
grant execute on function public.end_chat_session(uuid) to authenticated;

create or replace function public.admin_suspend_chat_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.chat_sessions set status = 'suspended' where id = p_session_id and status = 'active' and admin_id = auth.uid();
end;
$$;
revoke all on function public.admin_suspend_chat_session(uuid) from public;
grant execute on function public.admin_suspend_chat_session(uuid) to authenticated;

create or replace function public.admin_resume_chat_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_row record;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select * into v_row from public.chat_sessions where id = p_session_id and admin_id = auth.uid() for update;
  if not found then raise exception 'invalid session'; end if;
  if v_row.status <> 'suspended' then return; end if;
  if v_row.expires_at <= now() then update public.chat_sessions set status = 'expired' where id = p_session_id; return; end if;
  update public.chat_sessions set status = 'active', last_activity_at = now() where id = p_session_id;
end;
$$;
revoke all on function public.admin_resume_chat_session(uuid) from public;
grant execute on function public.admin_resume_chat_session(uuid) to authenticated;

create or replace function public.admin_revoke_secret_code(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.secret_codes set revoked_at = coalesce(revoked_at, now()) where id = p_id and created_by = auth.uid();
end;
$$;
revoke all on function public.admin_revoke_secret_code(uuid) from public;
grant execute on function public.admin_revoke_secret_code(uuid) to authenticated;

-- Realtime Postgres Changes requires the table in this publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ephemeral_messages') then
    alter publication supabase_realtime add table public.ephemeral_messages;
  end if;
end;
$$;
