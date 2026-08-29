-- =========================================================
-- 0005: Secret codes (admin-issued temporary chat authorization)
-- =========================================================

create table public.secret_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  max_attempts int not null default 5,
  attempt_count int not null default 0,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.secret_codes enable row level security;

-- SELECT only — creation/revocation/redemption all go through
-- the SECURITY DEFINER functions below.
grant select on public.secret_codes to authenticated;

-- Only the admin can see the (hashed, never plaintext) code
-- list, e.g. to revoke one. This is fine with a single admin;
-- if a second admin is ever added, scope this to created_by.
create policy "secret_codes_admin_select"
  on public.secret_codes for select
  using (public.is_admin());

-- No insert/update/delete policies for the client at all —
-- every mutation goes through the SECURITY DEFINER functions
-- below, which independently re-check admin status.

-- ---------------------------------------------------------
-- admin_generate_secret_code(): creates a cryptographically
-- random code, stores only its SHA-256 hash, and returns the
-- plaintext exactly once. Never logged, never placed in a URL.
--
-- p_expires_in_minutes is a plain integer, not an `interval`,
-- deliberately: a text value bound to an `interval` parameter
-- over PostgREST's RPC wire protocol does NOT implicitly cast
-- (confirmed by testing the realistic case — a properly-typed
-- text parameter, not an untyped SQL literal — against the
-- migrated schema; only the misleading untyped-literal test
-- appears to work). An integer avoids the ambiguity entirely.
-- ---------------------------------------------------------
create function public.admin_generate_secret_code(
  p_expires_in_minutes int default 15,
  p_max_attempts int default 5
)
returns table (id uuid, plaintext_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
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

  if p_expires_in_minutes <= 0 or p_expires_in_minutes > 24 * 60 then
    raise exception 'expiry must be between 1 minute and 24 hours';
  end if;

  if not public.check_rate_limit('generate_code:' || auth.uid()::text, 10, interval '1 hour') then
    raise exception 'too many codes generated recently, please wait';
  end if;

  -- 12 bytes = 96 bits of entropy from a CSPRNG (gen_random_bytes
  -- is backed by the OS random source via pgcrypto). Formatted
  -- as uppercase hex in dash-separated groups for readability;
  -- this is not a guessable pattern like "1234" or "LOVE".
  v_raw := gen_random_bytes(12);
  v_code := upper(encode(v_raw, 'hex'));
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' ||
            substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4) || '-' ||
            substr(v_code, 17, 4) || '-' || substr(v_code, 21, 4);
  v_hash := encode(digest(v_code, 'sha256'), 'hex');
  v_expires_at := now() + (p_expires_in_minutes || ' minutes')::interval;

  insert into public.secret_codes (code_hash, created_by, expires_at, max_attempts)
  values (v_hash, auth.uid(), v_expires_at, p_max_attempts)
  returning secret_codes.id into v_id;

  return query select v_id, v_code, v_expires_at;
end;
$$;

revoke all on function public.admin_generate_secret_code(int, int) from public;
grant execute on function public.admin_generate_secret_code(int, int) to authenticated;

-- ---------------------------------------------------------
-- admin_revoke_secret_code(): immediately invalidates a code.
-- ---------------------------------------------------------
create function public.admin_revoke_secret_code(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.secret_codes
    set revoked_at = now()
    where id = p_id and revoked_at is null;
end;
$$;

revoke all on function public.admin_revoke_secret_code(uuid) from public;
grant execute on function public.admin_revoke_secret_code(uuid) to authenticated;

-- ---------------------------------------------------------
-- redeem_secret_code(): validates a code and, if valid, creates
-- the temporary chat_session. All checks happen server-side in
-- one atomic transaction; the frontend never determines validity.
--
-- IMPORTANT — why this returns an error_message column instead
-- of raising an exception for invalid/expired/rate-limited
-- codes: an uncaught exception rolls back the ENTIRE
-- transaction, including any writes already made earlier in
-- the SAME function call. check_rate_limit() durably increments
-- a counter as its side effect — but if this function later
-- raised an exception for an invalid code, that raise would
-- roll back the increment right along with everything else,
-- silently erasing the rate limit's own bookkeeping on every
-- failed guess. This was caught by actually running repeated
-- failed-redemption attempts against the real migrated schema
-- and observing the limit never engaged (see
-- tests/db_tests.sql and docs/database.md) — not found by
-- reading the code. Returning normally, with the failure
-- encoded as data, lets the transaction commit and the rate
-- limit's counter genuinely persist.
--
-- Note on brute force: because lookup is by exact SHA-256 hash
-- match, an attacker who does not know the code cannot cause a
-- row-level "near miss" to accumulate attempts against any real
-- code — every wrong guess simply matches no row. The real
-- brute-force defense is therefore the rate limiting below
-- (per-user AND a global bucket, to blunt multi-account abuse),
-- combined with the code's 96 bits of entropy. attempt_count /
-- max_attempts on the row are retained for admin visibility and
-- as defense in depth, not as the primary control.
-- ---------------------------------------------------------
create function public.redeem_secret_code(p_code text)
returns table (chat_session_id uuid, error_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row record;
  v_session_id uuid;
  v_chat_max_minutes int := public.get_setting_int('chat_max_lifetime_minutes', 30);
begin
  if auth.uid() is null then
    return query select null::uuid, 'not authenticated'::text;
    return;
  end if;

  if not public.check_rate_limit('redeem_code:' || auth.uid()::text, 5, interval '15 minutes') then
    return query select null::uuid, 'too many attempts, please wait before trying again'::text;
    return;
  end if;

  if not public.check_rate_limit('redeem_code:global', 20, interval '1 hour') then
    return query select null::uuid, 'too many attempts, please wait before trying again'::text;
    return;
  end if;

  v_hash := encode(digest(p_code, 'sha256'), 'hex');

  select * into v_row from public.secret_codes where code_hash = v_hash for update;

  if not found
     or v_row.revoked_at is not null
     or v_row.used_at is not null
     or now() > v_row.expires_at
     or v_row.attempt_count >= v_row.max_attempts
  then
    if found then
      update public.secret_codes set attempt_count = attempt_count + 1 where id = v_row.id;
    end if;
    -- Deliberately generic: does not reveal whether the code
    -- existed, expired, was revoked, or was already used.
    return query select null::uuid, 'invalid or expired code'::text;
    return;
  end if;

  update public.secret_codes
    set used_at = now(), attempt_count = attempt_count + 1
    where id = v_row.id;

  insert into public.chat_sessions (user_id, admin_id, created_at, expires_at, last_activity_at, status)
  values (auth.uid(), v_row.created_by, now(), now() + (v_chat_max_minutes || ' minutes')::interval, now(), 'active')
  returning chat_sessions.id into v_session_id;

  return query select v_session_id, null::text;
end;
$$;

revoke all on function public.redeem_secret_code(text) from public;
grant execute on function public.redeem_secret_code(text) to authenticated;
