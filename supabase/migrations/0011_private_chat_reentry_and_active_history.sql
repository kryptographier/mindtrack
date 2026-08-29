-- =========================================================
-- 0011: private chat re-entry + active-only admin history
-- =========================================================

-- Re-entering a still-valid code must return the user's existing active
-- session instead of creating a second session. Suspended sessions remain
-- blocked, while expired/ended/revoked codes remain invalid.
create or replace function public.redeem_secret_code(p_code text)
returns table(chat_session_id uuid, error_message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text; v_code record; v_session record; v_session_id uuid;
  v_idle_minutes int := public.get_setting_int('chat_idle_timeout_minutes', 10);
begin
  if auth.uid() is null then
    return query select null::uuid, 'not authenticated'::text;
    return;
  end if;
  if p_code is null or btrim(p_code) = '' then
    return query select null::uuid, 'invalid or expired code'::text;
    return;
  end if;
  if not public.check_rate_limit('redeem_code:' || auth.uid()::text, 10, interval '15 minutes') then
    return query select null::uuid, 'too many attempts, please wait before trying again'::text;
    return;
  end if;
  if not public.check_rate_limit('redeem_code:global', 50, interval '1 hour') then
    return query select null::uuid, 'too many attempts, please wait before trying again'::text;
    return;
  end if;

  v_hash := encode(extensions.digest(upper(btrim(p_code))::text, 'sha256'::text), 'hex');
  select id, created_by, expires_at, revoked_at, redeemed_by
    into v_code
    from public.secret_codes
   where code_hash = v_hash
   for update;

  if not found or v_code.revoked_at is not null or v_code.expires_at <= now() then
    return query select null::uuid, 'invalid or expired code'::text;
    return;
  end if;

  -- A code is permanently bound to its first redeemer until the code expires
  -- or is revoked. Another authenticated user must never be able to claim it.
  if v_code.redeemed_by is null then
    update public.secret_codes
       set redeemed_by = auth.uid(), attempt_count = attempt_count + 1
     where id = v_code.id;
  elsif v_code.redeemed_by <> auth.uid() then
    return query select null::uuid, 'invalid or expired code'::text;
    return;
  else
    update public.secret_codes
       set attempt_count = attempt_count + 1
     where id = v_code.id;
  end if;

  -- Re-entry while active returns the exact same session. Visiting Journal or
  -- Mood does not end the private session; only explicit End, expiry, or an
  -- administrator suspension changes its availability.
  select * into v_session
    from public.chat_sessions
   where secret_code_id = v_code.id
     and user_id = auth.uid()
     and status = 'active'
   order by created_at desc
   limit 1
   for update;

  if found then
    if now() >= v_session.expires_at then
      update public.chat_sessions set status = 'expired' where id = v_session.id;
      return query select null::uuid, 'invalid or expired code'::text;
      return;
    end if;

    -- A valid code re-entry is activity on the chat session, so it refreshes
    -- the idle window rather than treating time spent navigating the app as
    -- an automatic session termination.
    update public.chat_sessions
       set last_activity_at = now()
     where id = v_session.id;
    return query select v_session.id, null::text;
    return;
  end if;

  if exists (
    select 1
      from public.chat_sessions
     where secret_code_id = v_code.id
       and user_id = auth.uid()
       and status = 'suspended'
  ) then
    return query select null::uuid, 'private session is suspended'::text;
    return;
  end if;

  insert into public.chat_sessions(
    user_id, admin_id, secret_code_id, created_at, expires_at, last_activity_at, status
  )
  values(
    auth.uid(), v_code.created_by, v_code.id, now(), v_code.expires_at, now(), 'active'
  )
  returning id into v_session_id;

  return query select v_session_id, null::text;
end;
$$;
revoke all on function public.redeem_secret_code(text) from public;
grant execute on function public.redeem_secret_code(text) to authenticated;
