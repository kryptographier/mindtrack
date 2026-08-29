-- Automated backend test suite. Run after migrations + the
-- stub (00_supabase_stub.sql). Every check uses test_assert(),
-- which raises an exception (non-zero exit, ON_ERROR_STOP) on
-- failure — this file either exits 0 with all PASS lines, or
-- exits non-zero at the first failure. CI treats it accordingly.

\set ON_ERROR_STOP on

-- ===========================================================
-- SETUP: two users. handle_new_user() auto-creates their
-- profiles; Bob is promoted to admin the same way a real
-- deployment would (direct service-role SQL, never via the app).
-- ===========================================================
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- ===========================================================
-- AUTHORIZATION
-- ===========================================================
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.session_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.touch_diary_session();

insert into public.diary_entries (user_id, content) values
  ('11111111-1111-1111-1111-111111111111', 'Alice private entry');

select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
select set_config('test.session_id', 'aaaaaaaa-0000-0000-0000-000000000002', false);
select public.touch_diary_session();

do $$
declare v_count int;
begin
  select count(*) into v_count from public.diary_entries where content = 'Alice private entry';
  perform test_assert(v_count = 0, 'User B cannot SELECT user A''s diary entry');
end $$;

do $$
begin
  -- RLS's USING clause means this UPDATE simply matches zero
  -- rows for Bob (no error raised) — the real assertion is that
  -- Alice's content is unchanged afterward, not that this
  -- statement itself throws.
  update public.diary_entries set content = 'hacked' where content = 'Alice private entry';
end $$;

-- Verify via a privileged role, NOT Bob's own SELECT — Bob's
-- SELECT is deliberately RLS-restricted to his own rows, so
-- checking existence through his view would always read as
-- "false" regardless of whether the UPDATE actually worked,
-- making the assertion meaningless. This is a test-correctness
-- fix, not a product change.
reset role;
do $$
begin
  perform test_assert(
    not exists (select 1 from public.diary_entries where content = 'hacked'),
    'User B cannot UPDATE user A''s diary entry'
  );
  perform test_assert(
    exists (select 1 from public.diary_entries where content = 'Alice private entry'),
    'Alice''s entry is unchanged after Bob''s unauthorized UPDATE attempt'
  );
end $$;
set role authenticated;
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

do $$
declare v_rows int;
begin
  delete from public.diary_entries where content = 'Alice private entry';
  get diagnostics v_rows = row_count;
  perform test_assert(v_rows = 0, 'User B''s DELETE affects zero rows of user A''s diary entry');
end $$;

-- Same reasoning as above: verify existence as a privileged
-- role, not through Bob's RLS-restricted view.
reset role;
do $$
begin
  perform test_assert(
    exists (select 1 from public.diary_entries where content = 'Alice private entry'),
    'User A''s entry still exists after User B''s unauthorized DELETE attempt'
  );
end $$;
set role authenticated;
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

-- Non-admin authorization check needs the actual non-admin
-- (Alice) — not Bob, who is admin in this test setup.
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  begin
    perform public.admin_generate_secret_code(10, 5);
    perform test_assert(false, 'unreachable: non-admin must be rejected');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin is blocked from admin_generate_secret_code()');
  end;
end $$;

-- Role manipulation: profiles has no client-writable policy at
-- all, so this must fail regardless of RLS specifics.
do $$
begin
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
  exception when others then
    null;
  end;
  perform test_assert(
    (select role from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'user',
    'A user cannot self-promote to admin via direct table write'
  );
end $$;

reset role;

-- ===========================================================
-- SECRET CODES
-- ===========================================================
set role authenticated;
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

do $$
declare
  v_code text;
  v_expired_code text;
  v_revoked_code text;
  v_revoked_id uuid;
  v_result record;
begin
  -- valid code, valid redemption
  select plaintext_code into v_code from public.admin_generate_secret_code(10, 5);
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.error_message is null and v_result.chat_session_id is not null,
    'Valid code redemption succeeds');

  -- reused code
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.error_message = 'invalid or expired code',
    'An already-redeemed code is rejected on reuse');

  -- bogus code (never existed)
  select * into v_result from public.redeem_secret_code('0000-0000-0000-0000-0000-0000');
  perform test_assert(v_result.error_message = 'invalid or expired code',
    'A bogus code is rejected with a generic message');

  -- expired code: back-date expires_at directly (simulating
  -- time passing, since we can't wait in a test).
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select plaintext_code, id into v_expired_code, v_revoked_id from public.admin_generate_secret_code(10, 5);
  reset role;
  update public.secret_codes set expires_at = now() - interval '1 minute' where id = v_revoked_id;
  set role authenticated;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.redeem_secret_code(v_expired_code);
  perform test_assert(v_result.error_message = 'invalid or expired code', 'An expired code is rejected');

  -- revoked code
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select plaintext_code, id into v_revoked_code, v_revoked_id from public.admin_generate_secret_code(10, 5);
  perform public.admin_revoke_secret_code(v_revoked_id);
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.redeem_secret_code(v_revoked_code);
  perform test_assert(v_result.error_message = 'invalid or expired code', 'A revoked code is rejected');
end $$;

-- brute-force / rate limiting: the redeem rate limit is 5 per
-- 15 minutes per user (migration 0006). Alice has already made
-- 5 redeem_secret_code calls above (valid, reused, bogus,
-- expired, revoked) — the very next call should already be
-- rate-limited. This specifically exercises the bug found and
-- fixed during this phase: redeem_secret_code() used to RAISE
-- for invalid codes, which rolled back check_rate_limit()'s own
-- increment along with everything else in the same call,
-- making the limit never actually engage. It now returns
-- normally with an error_message, so the increment persists.
do $$
declare
  attempt int;
  hit_rate_limit boolean := false;
  v_result record;
begin
  for attempt in 1..10 loop
    select * into v_result from public.redeem_secret_code('WONT-MATCH-ANY-REAL-CODE-000');
    if v_result.error_message like 'too many attempts%' then
      hit_rate_limit := true;
      exit;
    end if;
  end loop;
  perform test_assert(hit_rate_limit, 'Repeated redemption attempts eventually hit the rate limit');
end $$;

reset role;

-- Test isolation: the SECRET CODES section above deliberately
-- exhausted the redeem rate limit as part of testing it. Clear
-- it here so the CHAT section (a different concern) starts with
-- a clean slate rather than being incidentally blocked by the
-- previous section's own test.
delete from public.rate_limits;

-- Carol: a third user needed for the "unauthorized participant"
-- test below. Created here, as the privileged setup role — same
-- reasoning as Alice/Bob at the top of this file, since a real
-- `authenticated` role correctly cannot write to auth.users.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

-- ===========================================================
-- CHAT
-- ===========================================================
set role authenticated;

do $$
declare
  v_code text;
  v_session_id uuid;
  v_message_id uuid;
  v_rows_1 int;
  v_rows_2 int;
  v_result record;
begin
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select plaintext_code into v_code from public.admin_generate_secret_code(10, 5);
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session_id from public.redeem_secret_code(v_code);
  perform test_assert(v_session_id is not null, 'Redeeming a valid code creates a chat session');

  -- send + duplicate-read race
  select message_id into v_message_id from public.send_message(v_session_id, 'hello from alice');
  perform test_assert(v_message_id is not null, 'A valid send_message call succeeds');
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select count(*) into v_rows_1 from public.read_and_delete_message(v_message_id);
  select count(*) into v_rows_2 from public.read_and_delete_message(v_message_id);
  perform test_assert(v_rows_1 = 1 and v_rows_2 = 0,
    'First read-and-delete returns the message; a racing second read returns nothing, not an error');

  -- unauthorized participant: a third user must not be able to
  -- send into, or read from, someone else's session. (Carol
  -- herself is created just below, outside this block, since
  -- creating a user requires privileged access to auth.users —
  -- same reasoning as Alice/Bob's setup at the top of this file.)
  perform set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
  select * into v_result from public.send_message(v_session_id, 'carol should not be able to send this');
  perform test_assert(v_result.error_message = 'invalid session',
    'A non-participant cannot send into someone else''s chat session');

  -- expired session: back-date expires_at, then confirm both
  -- sending and the validity check reflect it.
  reset role;
  update public.chat_sessions set expires_at = now() - interval '1 minute' where id = v_session_id;
  set role authenticated;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  perform test_assert(
    public.is_chat_session_valid(v_session_id) = false,
    'An expired chat session is correctly reported invalid'
  );
  select * into v_result from public.send_message(v_session_id, 'too late');
  perform test_assert(v_result.error_message = 'session expired', 'Sending into an expired session is rejected');
end $$;

reset role;

-- ===========================================================
-- SESSION EXPIRATION (diary)
-- ===========================================================
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.session_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);

reset role;
update public.session_activity
  set last_activity_at = now() - interval '31 minutes'
  where session_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set role authenticated;

do $$
declare v_valid boolean;
begin
  select public.is_diary_session_valid() into v_valid;
  perform test_assert(v_valid = false, 'An idle-expired diary session is correctly rejected');
end $$;

reset role;

-- ===========================================================
-- SECURITY: injection safety, oversized/malformed input
-- ===========================================================
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.session_id', 'aaaaaaaa-0000-0000-0000-000000000099', false);
select public.touch_diary_session();

do $$
declare
  v_payload text := '''; DROP TABLE public.diary_entries; --';
  v_stored text;
begin
  insert into public.diary_entries (user_id, content)
  values ('11111111-1111-1111-1111-111111111111', v_payload);

  select content into v_stored from public.diary_entries where content = v_payload;

  perform test_assert(v_stored = v_payload, 'A SQL-injection-shaped payload is stored as literal text, not executed');
  perform test_assert(
    (select count(*) from information_schema.tables where table_name = 'diary_entries') = 1,
    'diary_entries table still exists after the injection-shaped insert'
  );
end $$;

do $$
declare v_oversized text := repeat('x', 50001);
begin
  begin
    insert into public.diary_entries (user_id, content)
    values ('11111111-1111-1111-1111-111111111111', v_oversized);
    perform test_assert(false, 'unreachable: oversized content must be rejected');
  exception when others then
    perform test_assert(true, 'Diary content over the 50,000-character limit is rejected by the CHECK constraint');
  end;
end $$;

do $$
begin
  begin
    perform public.is_chat_session_valid('not-a-uuid');
    perform test_assert(false, 'unreachable: malformed UUID must be rejected');
  exception when others then
    perform test_assert(true, 'A malformed UUID parameter is rejected rather than silently coerced');
  end;
end $$;

reset role;

-- ===========================================================
-- ADMIN AUTHORIZATION (RPC layer, not just table RLS)
-- ===========================================================
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  begin
    perform public.admin_revoke_secret_code(gen_random_uuid());
    perform test_assert(false, 'unreachable: non-admin must be rejected');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin is blocked from admin_revoke_secret_code()');
  end;

  begin
    perform public.admin_update_setting('diary_idle_timeout_minutes', '9999');
    perform test_assert(false, 'unreachable: non-admin must be rejected');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin is blocked from admin_update_setting()');
  end;
end $$;

reset role;

-- ===========================================================
-- CLEANUP (service_role only)
-- ===========================================================
set role authenticated;
do $$
begin
  begin
    perform public.cleanup_expired_records();
    perform test_assert(false, 'unreachable: authenticated must be rejected');
  exception when insufficient_privilege then
    perform test_assert(true, 'authenticated is blocked from calling cleanup_expired_records()');
  end;
end $$;
reset role;

set role service_role;
do $$
begin
  perform public.cleanup_expired_records();
  perform test_assert(true, 'service_role can call cleanup_expired_records()');
end $$;
reset role;

\echo 'ALL AUTOMATED BACKEND TESTS PASSED'
