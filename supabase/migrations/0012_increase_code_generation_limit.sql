-- =========================================================
-- 0012: increase private-code generation rate limit
-- =========================================================

-- Keep the protection against abuse, but allow normal admin testing and
-- operation without hitting the previous 10-codes-per-hour ceiling.

drop function if exists public.admin_generate_secret_code(integer);

create function public.admin_generate_secret_code(p_expires_in_minutes integer)
returns table(id uuid, plaintext_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_raw bytea;
  v_code text;
  v_hash text;
  v_id uuid;
  v_expires_at timestamptz;
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
    30,
    interval '1 hour'
  ) then
    raise exception 'too many codes generated recently, please wait';
  end if;

  v_raw := extensions.gen_random_bytes(12);
  v_code := upper(encode(v_raw, 'hex'));
  v_code := substr(v_code, 1, 4) || '-' ||
            substr(v_code, 5, 4) || '-' ||
            substr(v_code, 9, 4) || '-' ||
            substr(v_code, 13, 4) || '-' ||
            substr(v_code, 17, 4) || '-' ||
            substr(v_code, 21, 4);

  v_hash := encode(
    extensions.digest(v_code::text, 'sha256'::text),
    'hex'
  );

  v_expires_at := now() + make_interval(mins => p_expires_in_minutes);

  insert into public.secret_codes(
    code_hash,
    created_by,
    expires_at,
    max_attempts,
    attempt_count,
    used_at,
    revoked_at,
    redeemed_by
  )
  values(
    v_hash,
    auth.uid(),
    v_expires_at,
    999999,
    0,
    null,
    null,
    null
  )
  returning secret_codes.id into v_id;

  return query
    select v_id, v_code, v_expires_at;
end;
$$;

revoke all on function public.admin_generate_secret_code(integer) from public;
grant execute on function public.admin_generate_secret_code(integer) to authenticated;
