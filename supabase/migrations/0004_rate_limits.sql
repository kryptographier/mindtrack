-- =========================================================
-- 0004: Generic rate limiting for custom RPCs
-- =========================================================
-- Supabase Auth already rate-limits its own endpoints (OTP
-- send/verify) via configurable settings — see
-- docs/architecture.md. This table covers OUR custom RPCs
-- (secret-code generation/redemption, chat message sending),
-- which are not covered by Supabase's built-in auth limiter.
--
-- Fixed-window counter, scoped by an arbitrary "bucket" string
-- (e.g. 'redeem_code:' || auth.uid(), or 'redeem_code:' || ip
-- if ever fronted by an Edge Function that has IP access).

create table public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies: default deny. Only SECURITY DEFINER functions
-- touch this table.

-- ---------------------------------------------------------
-- check_rate_limit(bucket, max_count, window): atomically
-- increments the counter for `bucket` and returns true if the
-- action is allowed, false if the limit has been exceeded
-- within the current window. Resets the window automatically
-- once it has elapsed.
-- ---------------------------------------------------------
create function public.check_rate_limit(
  p_bucket text,
  p_max_count int,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  -- Lock the row (or its future insertion point) to make the
  -- check-then-increment atomic under concurrent calls.
  select * into v_row from public.rate_limits where bucket = p_bucket for update;

  if not found then
    insert into public.rate_limits (bucket, window_start, count)
    values (p_bucket, now(), 1);
    return true;
  end if;

  if now() - v_row.window_start > p_window then
    update public.rate_limits
      set window_start = now(), count = 1
      where bucket = p_bucket;
    return true;
  end if;

  if v_row.count >= p_max_count then
    return false;
  end if;

  update public.rate_limits
    set count = count + 1
    where bucket = p_bucket;
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, int, interval) from public;
-- Intentionally NOT granted to `authenticated` — this is an
-- internal helper called by other SECURITY DEFINER functions
-- (which run as the function owner, so they can call it
-- regardless of grants to `authenticated`).
