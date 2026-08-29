-- =========================================================
-- 0007: Scheduled cleanup
-- =========================================================
-- session_activity and rate_limits grow indefinitely as written
-- (flagged in docs/database.md during Phase 2). This adds a
-- single cleanup function that deletes rows that are no longer
-- useful to anything: expired session-tracking rows, stale
-- rate-limit windows, and old ended/expired chat sessions along
-- with any orphaned messages. Diary entries, mood entries, and
-- profiles are NEVER touched here — this function only removes
-- bookkeeping data, never user content.
--
-- Restricted to service_role: this is not something any
-- authenticated user, including the admin, should be able to
-- trigger via the client API. It's invoked by the `cleanup`
-- Edge Function (supabase/functions/cleanup), itself gated by a
-- shared secret and called only from a scheduled GitHub Action.

create function public.cleanup_expired_records()
returns table (
  session_activity_deleted bigint,
  rate_limits_deleted bigint,
  chat_sessions_deleted bigint,
  messages_deleted bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_activity_deleted bigint;
  v_rate_limits_deleted bigint;
  v_chat_sessions_deleted bigint;
  v_messages_deleted bigint;
begin
  -- Diary session tracking: safe to remove well after both the
  -- idle timeout and max lifetime could plausibly matter. 48
  -- hours is a generous margin beyond the 12-hour default max
  -- lifetime, not a security boundary — the row's absence just
  -- means the next touch_diary_session() call re-creates it.
  delete from public.session_activity
    where last_activity_at < now() - interval '48 hours';
  get diagnostics v_session_activity_deleted = row_count;

  -- Rate limit windows: once a window is more than 24 hours old
  -- it can never affect a future check_rate_limit() call (every
  -- window used in this codebase is much shorter than that).
  delete from public.rate_limits
    where window_start < now() - interval '24 hours';
  get diagnostics v_rate_limits_deleted = row_count;

  -- Ephemeral messages belonging to sessions that are no longer
  -- active: end_chat_session() already purges these on a clean
  -- end, but this is the backstop for sessions that simply
  -- expired without either participant explicitly ending them.
  delete from public.ephemeral_messages
    where session_id in (
      select id from public.chat_sessions
      where status != 'active' and last_activity_at < now() - interval '24 hours'
    );
  get diagnostics v_messages_deleted = row_count;

  -- Old ended/expired chat session rows themselves: kept for a
  -- day for any admin-visible history, then removed. They carry
  -- no message content by this point (see above).
  delete from public.chat_sessions
    where status != 'active' and last_activity_at < now() - interval '24 hours';
  get diagnostics v_chat_sessions_deleted = row_count;

  return query select
    v_session_activity_deleted,
    v_rate_limits_deleted,
    v_chat_sessions_deleted,
    v_messages_deleted;
end;
$$;

-- Deliberately NOT granted to authenticated or anon — only the
-- service_role (used exclusively by the cleanup Edge Function,
-- never the browser client) may call this.
revoke all on function public.cleanup_expired_records() from public, authenticated, anon;
grant execute on function public.cleanup_expired_records() to service_role;
