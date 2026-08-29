-- =========================================================
-- 0007: Persistent secret chat codes
--
-- Secret codes:
--   - do not expire
--   - can be reused
--   - always reopen the same active chat session
--   - have no visible history in the admin UI
--
-- Security remains server-side.
-- =========================================================

-- Remove the old expiry requirement.
alter table public.secret_codes
  alter column expires_at drop not null;

-- Existing codes are made persistent.
update public.secret_codes
set expires_at = null;

-- The old "used once" model is no longer applicable.
-- Existing used_at values are cleared so old codes can also
-- participate in the persistent-code model.
update public.secret_codes
set used_at = null;

-- ---------------------------------------------------------
-- Replace admin_generate_secret_code()
-- ---------------------------------------------------------

drop function if exists public.admin_generate_secret_code(int, int);

create function public.admin_generate_secret_code()
returns table (
  id uuid,
  plaintext_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw bytea;
  v_code text;
  v_hash text;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if not public.check_rate_limit(
    'generate_code:' || auth.uid()::text,
    10,
    interval '1 hour'
  ) then
    raise exception 'too many codes generated recently, please wait';
  end if;

  -- 12 bytes = 96 bits of cryptographic randomness.
  v_raw := gen_random_bytes(12);

  v_code := upper(encode(v_raw, 'hex'));

  v_code :=
      substr(v_code, 1, 4) || '-' ||
      substr(v_code, 5, 4) || '-' ||
      substr(v_code, 9, 4) || '-' ||
      substr(v_code, 13, 4) || '-' ||
      substr(v_code, 17, 4) || '-' ||
      substr(v_code, 21, 4);

  v_hash := encode(digest(v_code, 'sha256'), 'hex');

  insert into public.secret_codes (
    code_hash,
    created_by,
    expires_at,
    max_attempts,
    attempt_count,
    used_at,
    revoked_at
  )
  values (
    v_hash,
    auth.uid(),
    null,
    999999,
    0,
    null,
    null
  )
  returning secret_codes.id into v_id;

  return query
    select v_id, v_code;
end;
$$;

revoke all on function public.admin_generate_secret_code() from public;

grant execute
on function public.admin_generate_secret_code()
to authenticated;


-- ---------------------------------------------------------
-- Replace redeem_secret_code()
--
-- The same code always resolves to the same active session.
-- If there is no active session yet, one is created.
-- ---------------------------------------------------------

drop function if exists public.redeem_secret_code(text);

create function public.redeem_secret_code(p_code text)
returns table (
  chat_session_id uuid,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row record;
  v_session_id uuid;
  v_existing_session_id uuid;
  v_chat_max_minutes int :=
    public.get_setting_int(
      'chat_max_lifetime_minutes',
      30
    );
begin
  if auth.uid() is null then
    return query
      select
        null::uuid,
        'not authenticated'::text;

    return;
  end if;

  -- Rate-limit attempts, but do not make the code itself
  -- single-use.
  if not public.check_rate_limit(
    'redeem_code:' || auth.uid()::text,
    10,
    interval '15 minutes'
  ) then
    return query
      select
        null::uuid,
        'too many attempts, please wait before trying again'::text;

    return;
  end if;

  if not public.check_rate_limit(
    'redeem_code:global',
    50,
    interval '1 hour'
  ) then
    return query
      select
        null::uuid,
        'too many attempts, please wait before trying again'::text;

    return;
  end if;

  v_hash := encode(
    digest(p_code, 'sha256'),
    'hex'
  );

  select *
  into v_row
  from public.secret_codes
  where code_hash = v_hash
  for update;

  -- Invalid or revoked code.
  if not found
     or v_row.revoked_at is not null
  then
    return query
      select
        null::uuid,
        'invalid or expired code'::text;

    return;
  end if;

  /*
   * Find an existing active chat between this user and the
   * admin who created the code.
   *
   * This is what makes entering the same code later reopen
   * the existing conversation instead of creating another one.
   */
  select cs.id
  into v_existing_session_id
  from public.chat_sessions cs
  where cs.user_id = auth.uid()
    and cs.admin_id = v_row.created_by
    and cs.status = 'active'
  order by cs.created_at desc
  limit 1;

  if v_existing_session_id is not null then
    update public.chat_sessions
    set last_activity_at = now()
    where id = v_existing_session_id;

    return query
      select
        v_existing_session_id,
        null::text;

    return;
  end if;

  /*
   * No active session exists, so create one.
   *
   * The code itself does not expire. The chat session may still
   * have its normal application lifetime, controlled by
   * chat_max_lifetime_minutes.
   */
  insert into public.chat_sessions (
    user_id,
    admin_id,
    created_at,
    expires_at,
    last_activity_at,
    status
  )
  values (
    auth.uid(),
    v_row.created_by,
    now(),
    now() + (v_chat_max_minutes || ' minutes')::interval,
    now(),
    'active'
  )
  returning chat_sessions.id
  into v_session_id;

  return query
    select
      v_session_id,
      null::text;
end;
$$;

revoke all on function public.redeem_secret_code(text) from public;

grant execute
on function public.redeem_secret_code(text)
to authenticated;
