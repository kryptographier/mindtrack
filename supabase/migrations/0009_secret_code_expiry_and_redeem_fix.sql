create extension if not exists pgcrypto with schema extensions;

drop function if exists public.admin_generate_secret_code();
drop function if exists public.admin_generate_secret_code(integer);

create function public.admin_generate_secret_code(
  p_expires_in_minutes integer
)
returns table (
  id uuid,
  plaintext_code text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_raw bytea;
  v_code text;
  v_hash text;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_expires_in_minutes is null
     or p_expires_in_minutes < 1
     or p_expires_in_minutes > 10080 then
    raise exception 'invalid expiry';
  end if;

  if not public.check_rate_limit(
    'generate_code:' || auth.uid()::text,
    10,
    interval '1 hour'
  ) then
    raise exception 'too many codes generated recently, please wait';
  end if;

  v_raw := extensions.gen_random_bytes(12);

  v_code := upper(encode(v_raw, 'hex'));

  v_code :=
      substr(v_code, 1, 4) || '-' ||
      substr(v_code, 5, 4) || '-' ||
      substr(v_code, 9, 4) || '-' ||
      substr(v_code, 13, 4) || '-' ||
      substr(v_code, 17, 4) || '-' ||
      substr(v_code, 21, 4);

  v_hash := encode(
    extensions.digest(v_code::text, 'sha256'::text),
    'hex'
  );

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
    now() + make_interval(mins => p_expires_in_minutes),
    999999,
    0,
    null,
    null
  )
  returning secret_codes.id into v_id;

  return query
    select v_id, v_code;
end;
$function$;

revoke all on function public.admin_generate_secret_code(integer)
from public;

grant execute on function public.admin_generate_secret_code(integer)
to authenticated;


drop function if exists public.redeem_secret_code(text);

create function public.redeem_secret_code(
  p_code text
)
returns table (
  chat_session_id uuid,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hash text;
  v_code_id uuid;
  v_created_by uuid;
  v_expires_at timestamptz;
  v_chat_session_id uuid;
begin
  if auth.uid() is null then
    return query
      select null::uuid, 'not authenticated'::text;
    return;
  end if;

  if p_code is null or btrim(p_code) = '' then
    return query
      select null::uuid, 'invalid code'::text;
    return;
  end if;

  v_hash := encode(
    extensions.digest(
      upper(btrim(p_code))::text,
      'sha256'::text
    ),
    'hex'
  );

  select
    id,
    created_by,
    expires_at
  into
    v_code_id,
    v_created_by,
    v_expires_at
  from public.secret_codes
  where code_hash = v_hash
  for update;

  if v_code_id is null then
    return query
      select null::uuid, 'invalid code'::text;
    return;
  end if;

  if exists (
    select 1
    from public.secret_codes
    where id = v_code_id
      and revoked_at is not null
  ) then
    return query
      select null::uuid, 'code has been revoked'::text;
    return;
  end if;

  if exists (
    select 1
    from public.secret_codes
    where id = v_code_id
      and used_at is not null
  ) then
    return query
      select null::uuid, 'code has already been used'::text;
    return;
  end if;

  if v_expires_at is not null and v_expires_at <= now() then
    return query
      select null::uuid, 'code has expired'::text;
    return;
  end if;

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
    v_created_by,
    now(),
    v_expires_at,
    now(),
    'active'
  )
  returning id into v_chat_session_id;

  update public.secret_codes
  set used_at = now()
  where id = v_code_id;

  return query
    select v_chat_session_id, null::text;
end;
$function$;

revoke all on function public.redeem_secret_code(text)
from public;

grant execute on function public.redeem_secret_code(text)
to authenticated;
