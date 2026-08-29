-- =========================================================
-- 0013: admin private-code generation status
-- =========================================================
-- Expose the current generation-window usage to the admin UI without
-- exposing the rate_limits table itself. Reading status does not consume
-- a generation attempt.

create or replace function public.admin_code_generation_status()
returns table(remaining_count integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
  v_limit constant integer := 30;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select window_start, count
    into v_window_start, v_count
    from public.rate_limits
   where bucket = 'generate_code:' || auth.uid()::text;

  if not found then
    return query select v_limit, null::timestamptz;
    return;
  end if;

  if now() - v_window_start > interval '1 hour' then
    return query select v_limit, null::timestamptz;
    return;
  end if;

  return query
    select greatest(v_limit - v_count, 0), v_window_start + interval '1 hour';
end;
$$;

revoke all on function public.admin_code_generation_status() from public;
grant execute on function public.admin_code_generation_status() to authenticated;
