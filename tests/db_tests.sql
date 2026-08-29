\set ON_ERROR_STOP on

-- ===========================================================
-- SETUP
-- ===========================================================
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.session_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.touch_diary_session();
insert into public.diary_entries (user_id, content) values ('11111111-1111-1111-1111-111111111111', 'Alice private entry');
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
do $$ begin perform test_assert(not exists (select 1 from public.diary_entries where content = 'Alice private entry'), 'RLS hides Alice diary data from Carol'); end $$;
reset role;

-- ===========================================================
-- SECRET CODE LIFECYCLE
-- ===========================================================
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  begin
    perform public.admin_generate_secret_code(60);
    perform test_assert(false, 'unreachable: non-admin cannot generate a code');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin cannot generate secret codes');
  end;
end $$;

select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_code_id uuid; v_session uuid; v_session_again uuid; v_result record;
begin
  select plaintext_code, id into v_code, v_code_id from public.admin_generate_secret_code(120);
  perform test_assert(v_code is not null and v_code_id is not null, 'Admin generates a code with an expiry');
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  perform test_assert(v_session is not null, 'First redemption creates a session');
  select chat_session_id into v_session_again from public.redeem_secret_code(v_code);
  perform test_assert(v_session_again = v_session, 'Same user can re-enter the same code and reopen the same active session');
  select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.chat_session_id is null and v_result.error_message = 'invalid or expired code', 'A different user cannot steal a bound code');
  select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  perform public.admin_revoke_secret_code(v_code_id);
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.chat_session_id is null and v_result.error_message = 'invalid or expired code', 'Revoked code cannot be redeemed');
end $$;

select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_id uuid; v_result record;
begin
  select plaintext_code, id into v_code, v_id from public.admin_generate_secret_code(60);
  reset role;
  update public.secret_codes set expires_at = now() - interval '1 second' where id = v_id;
  set role authenticated;
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.error_message = 'invalid or expired code', 'Expired code is rejected by the database');
end $$;

-- ===========================================================
-- CHAT MESSAGE CONTRACT + PARTICIPANT SECURITY
-- ===========================================================
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_session uuid; v_message uuid; v_rows int; v_result record;
begin
  select plaintext_code into v_code from public.admin_generate_secret_code(60);
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  perform test_assert(v_session is not null, 'Chat session exists for message tests');
  select message_id into v_message from public.send_message(v_session, 'hello from alice');
  perform test_assert(v_message is not null, 'Canonical send_message RPC succeeds');
  select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select count(*) into v_rows from public.read_and_delete_message(v_message);
  perform test_assert(v_rows = 1, 'Recipient can atomically read and delete a message');
  select count(*) into v_rows from public.read_and_delete_message(v_message);
  perform test_assert(v_rows = 0, 'A consumed message cannot be read twice');
  select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
  select * into v_result from public.send_message(v_session, 'unauthorized');
  perform test_assert(v_result.error_message = 'invalid session', 'Non-participant cannot send to another chat');
end $$;

-- ===========================================================
-- SESSION BACK/JOURNAL SEMANTICS + EXPLICIT END
-- ===========================================================
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_code_id uuid; v_session uuid; v_status text; v_revoked boolean; v_result record;
begin
  select plaintext_code, id into v_code, v_code_id from public.admin_generate_secret_code(120);
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  perform test_assert(v_session is not null, 'Session created for back-navigation test');
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  perform test_assert(v_session is not null, 'Code remains usable while the session is active');
  perform public.end_chat_session(v_session);
  select status into v_status from public.chat_sessions where id = v_session;
  perform test_assert(v_status = 'ended', 'Explicit End session marks the session ended');
  reset role;
  select (revoked_at is not null) into v_revoked from public.secret_codes where id = v_code_id;
  perform test_assert(v_revoked, 'Explicit End session revokes the associated code');
  set role authenticated;
  select * into v_result from public.redeem_secret_code(v_code);
  perform test_assert(v_result.chat_session_id is null and v_result.error_message = 'invalid or expired code', 'Ended session code cannot be reused');
end $$;

-- ===========================================================
-- ADMIN SUSPEND / RESUME
-- ===========================================================
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_session uuid; v_result record; v_status text;
begin
  select plaintext_code into v_code from public.admin_generate_secret_code(120);
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  perform public.admin_suspend_chat_session(v_session);
  select status into v_status from public.chat_sessions where id = v_session;
  perform test_assert(v_status = 'suspended', 'Admin can suspend an active session');
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select * into v_result from public.send_message(v_session, 'blocked while suspended');
  perform test_assert(v_result.error_message is not null, 'Suspended session rejects messages');
  select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  perform public.admin_resume_chat_session(v_session);
  select status into v_status from public.chat_sessions where id = v_session;
  perform test_assert(v_status = 'active', 'Admin can resume a suspended session');
end $$;

-- ===========================================================
-- EXPIRY / IDLE ENFORCEMENT
-- ===========================================================
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
do $$
declare v_code text; v_session uuid; v_result record;
begin
  select plaintext_code into v_code from public.admin_generate_secret_code(60);
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select chat_session_id into v_session from public.redeem_secret_code(v_code);
  reset role;
  update public.chat_sessions set expires_at = now() - interval '1 second' where id = v_session;
  set role authenticated;
  select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  perform test_assert(public.is_chat_session_valid(v_session) = false, 'Expired session is invalid');
  select * into v_result from public.send_message(v_session, 'too late');
  perform test_assert(v_result.error_message = 'session expired', 'Expired session rejects messages');
end $$;

-- ===========================================================
-- ADMIN RPC AUTHORIZATION
-- ===========================================================
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform public.admin_suspend_chat_session(gen_random_uuid());
    perform test_assert(false, 'unreachable: non-admin cannot suspend');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin cannot suspend sessions');
  end;
  begin
    perform public.admin_resume_chat_session(gen_random_uuid());
    perform test_assert(false, 'unreachable: non-admin cannot resume');
  exception when others then
    perform test_assert(sqlerrm = 'not authorized', 'Non-admin cannot resume sessions');
  end;
end $$;
reset role;
\echo 'ALL AUTOMATED BACKEND TESTS PASSED'
