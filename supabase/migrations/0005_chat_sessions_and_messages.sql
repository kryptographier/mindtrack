-- =========================================================
-- 0005: Chat sessions + ephemeral messages
-- =========================================================
-- Chat sessions are created only by redeem_secret_code()
-- (migration 0006). This migration defines the tables and the
-- functions that enforce their lifecycle: idle/max-lifetime
-- expiration, and atomic read-then-delete message handling.

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  admin_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ended', 'expired'))
);

create index on public.chat_sessions (user_id);
create index on public.chat_sessions (admin_id);

create table public.ephemeral_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  recipient_id uuid not null references auth.users (id),
  content text not null check (char_length(content) <= 4000),
  created_at timestamptz not null default now()
  -- No `read_at` column: a message is atomically deleted in the
  -- same statement that would otherwise mark it read (see
  -- read_and_delete_message() below and docs/database.md for
  -- why this is equivalent to, and safer than, a separate
  -- mark-then-delete pair under concurrent/racing clients).
);

create index on public.ephemeral_messages (session_id);
create index on public.ephemeral_messages (recipient_id);

-- NOTE: RLS is enabled and policies are created further below,
-- AFTER is_chat_session_valid() is defined — the messages
-- policy calls that function, so it must exist first.

-- ---------------------------------------------------------
-- is_chat_session_valid(): read-only check used by RLS. Does
-- NOT extend the session — only touch_chat_session() (called
-- from send_message(), i.e. real activity) does that.
-- ---------------------------------------------------------
create function public.is_chat_session_valid(p_session_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_row record;
  v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  select * into v_row from public.chat_sessions where id = p_session_id;

  if not found then
    return false;
  end if;

  if v_row.user_id != auth.uid() and v_row.admin_id != auth.uid() then
    return false;
  end if;

  if v_row.status != 'active' then
    return false;
  end if;

  if now() > v_row.expires_at then
    return false;
  end if;

  if now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_chat_session_valid(uuid) from public;
grant execute on function public.is_chat_session_valid(uuid) to authenticated;

-- ---------------------------------------------------------
-- touch_chat_session(): called internally by send_message().
-- Marks the session expired (rather than silently doing
-- nothing) once either limit is crossed, so subsequent reads
-- via is_chat_session_valid() fail fast and consistently.
-- ---------------------------------------------------------
create function public.touch_chat_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  select * into v_row from public.chat_sessions where id = p_session_id for update;

  if not found then
    return false;
  end if;

  if v_row.user_id != auth.uid() and v_row.admin_id != auth.uid() then
    return false;
  end if;

  if v_row.status != 'active' then
    return false;
  end if;

  if now() > v_row.expires_at or now() - v_row.last_activity_at > (v_idle_minutes || ' minutes')::interval then
    update public.chat_sessions set status = 'expired' where id = p_session_id;
    return false;
  end if;

  update public.chat_sessions set last_activity_at = now() where id = p_session_id;
  return true;
end;
$$;

revoke all on function public.touch_chat_session(uuid) from public;
grant execute on function public.touch_chat_session(uuid) to authenticated;

-- ---------------------------------------------------------
-- RLS: now that is_chat_session_valid() exists, the policies
-- that depend on it can be created.
-- ---------------------------------------------------------
alter table public.chat_sessions enable row level security;
alter table public.ephemeral_messages enable row level security;

-- SELECT only — every mutation goes through SECURITY DEFINER
-- functions (redeem_secret_code, send_message,
-- read_and_delete_message, end_chat_session), which run as the
-- function owner and so don't need these grants themselves.
grant select on public.chat_sessions to authenticated;
grant select on public.ephemeral_messages to authenticated;

-- Only participants can see a session's metadata, and only
-- while there's a point in doing so.
create policy "chat_sessions_select_participant"
  on public.chat_sessions for select
  using (user_id = auth.uid() or admin_id = auth.uid());

-- No insert/update/delete policies — all mutations go through
-- SECURITY DEFINER functions so expiration/participant checks
-- can't be bypassed by a direct client write.

-- Messages are visible only to their sender/recipient, and only
-- while the owning session is genuinely valid right now.
create policy "messages_select_participant"
  on public.ephemeral_messages for select
  using (
    (sender_id = auth.uid() or recipient_id = auth.uid())
    and public.is_chat_session_valid(session_id)
  );

-- No insert/update/delete policies for messages either — see
-- send_message() and read_and_delete_message() below.

-- ---------------------------------------------------------
-- send_message(): the only way a message row can be created.
-- Validates session, derives recipient server-side (never
-- trusts a client-supplied recipient_id), rate limits, and
-- refreshes session activity as a side effect of real use.
--
-- Returns an error_message column instead of raising for
-- expected failures, for the same reason as redeem_secret_code()
-- (see that function's comment in migration 0006): raising here
-- would roll back the ENTIRE transaction, including
-- check_rate_limit()'s counter increment and, worse,
-- touch_chat_session()'s own write when it detects and marks a
-- session expired — undoing the very state change meant to
-- record that expiration.
-- ---------------------------------------------------------
create function public.send_message(p_session_id uuid, p_content text)
returns table (message_id uuid, error_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_recipient uuid;
  v_new_message_id uuid;
begin
  if auth.uid() is null then
    return query select null::uuid, 'not authenticated'::text;
    return;
  end if;

  if p_content is null or char_length(p_content) = 0 then
    return query select null::uuid, 'message cannot be empty'::text;
    return;
  end if;

  if char_length(p_content) > 4000 then
    return query select null::uuid, 'message too long'::text;
    return;
  end if;

  if not public.check_rate_limit('send_message:' || auth.uid()::text, 30, interval '1 minute') then
    return query select null::uuid, 'sending too fast, please slow down'::text;
    return;
  end if;

  select * into v_row from public.chat_sessions where id = p_session_id;
  if not found or (v_row.user_id != auth.uid() and v_row.admin_id != auth.uid()) then
    return query select null::uuid, 'invalid session'::text;
    return;
  end if;

  if not public.touch_chat_session(p_session_id) then
    return query select null::uuid, 'session expired'::text;
    return;
  end if;

  v_recipient := case when v_row.user_id = auth.uid() then v_row.admin_id else v_row.user_id end;

  insert into public.ephemeral_messages (session_id, sender_id, recipient_id, content)
  values (p_session_id, auth.uid(), v_recipient, p_content)
  returning id into v_new_message_id;

  return query select v_new_message_id, null::text;
end;
$$;

revoke all on function public.send_message(uuid, text) from public;
grant execute on function public.send_message(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- read_and_delete_message(): atomic DELETE ... RETURNING,
-- scoped to `recipient_id = auth.uid()`. This is the entire
-- "mark read then delete" lifecycle in one statement: under
-- two racing tabs, only the first DELETE finds and returns the
-- row; the second finds zero rows and returns nothing — no
-- error, no resurrection, no double-processing.
-- ---------------------------------------------------------
create function public.read_and_delete_message(p_message_id uuid)
returns table (content text, sender_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
    delete from public.ephemeral_messages
    where id = p_message_id and recipient_id = auth.uid()
    returning ephemeral_messages.content, ephemeral_messages.sender_id, ephemeral_messages.created_at;
end;
$$;

revoke all on function public.read_and_delete_message(uuid) from public;
grant execute on function public.read_and_delete_message(uuid) to authenticated;

-- ---------------------------------------------------------
-- end_chat_session(): either participant can end their own
-- session. Also purges any remaining unread messages, which
-- minimizes how long ephemeral content persists once a
-- conversation is deliberately closed.
-- ---------------------------------------------------------
create function public.end_chat_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select * into v_row from public.chat_sessions where id = p_session_id for update;

  if not found or (v_row.user_id != auth.uid() and v_row.admin_id != auth.uid()) then
    raise exception 'invalid session';
  end if;

  update public.chat_sessions
    set status = 'ended', ended_at = now()
    where id = p_session_id and status = 'active';

  delete from public.ephemeral_messages where session_id = p_session_id;
end;
$$;

revoke all on function public.end_chat_session(uuid) from public;
grant execute on function public.end_chat_session(uuid) to authenticated;
