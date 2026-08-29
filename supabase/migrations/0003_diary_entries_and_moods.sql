-- =========================================================
-- 0003: Diary entries + mood entries
-- =========================================================

create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 200),
  content text not null check (char_length(content) <= 50000),
  mood text check (mood in ('great', 'good', 'okay', 'low', 'difficult')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.diary_entries (user_id, created_at desc);

create table public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mood text not null check (mood in ('great', 'good', 'okay', 'low', 'difficult')),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index on public.mood_entries (user_id, created_at desc);

-- Keep updated_at accurate without trusting the client to set it.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger diary_entries_set_updated_at
  before update on public.diary_entries
  for each row
  execute function public.set_updated_at();

alter table public.diary_entries enable row level security;
alter table public.mood_entries enable row level security;

-- Base table privileges — RLS policies below then restrict
-- these to the caller's own rows plus a valid diary session.
grant select, insert, update, delete on public.diary_entries to authenticated;
grant select, insert, delete on public.mood_entries to authenticated;

-- ---------------------------------------------------------
-- diary_entries policies
-- Ownership (user_id = auth.uid()) AND a valid, non-expired
-- diary session are both required. Session validity is a
-- read-only check (Migration 0002) — it does not extend
-- anything, it only gates access.
-- ---------------------------------------------------------
create policy "diary_select_own"
  on public.diary_entries for select
  using (user_id = auth.uid() and public.is_diary_session_valid());

create policy "diary_insert_own"
  on public.diary_entries for insert
  with check (user_id = auth.uid() and public.is_diary_session_valid());

create policy "diary_update_own"
  on public.diary_entries for update
  using (user_id = auth.uid() and public.is_diary_session_valid())
  with check (user_id = auth.uid());

create policy "diary_delete_own"
  on public.diary_entries for delete
  using (user_id = auth.uid() and public.is_diary_session_valid());

-- ---------------------------------------------------------
-- mood_entries policies (mirrors diary_entries; no update
-- policy since moods are logged, not edited, per the spec —
-- delete is still allowed for correcting mistakes)
-- ---------------------------------------------------------
create policy "mood_select_own"
  on public.mood_entries for select
  using (user_id = auth.uid() and public.is_diary_session_valid());

create policy "mood_insert_own"
  on public.mood_entries for insert
  with check (user_id = auth.uid() and public.is_diary_session_valid());

create policy "mood_delete_own"
  on public.mood_entries for delete
  using (user_id = auth.uid() and public.is_diary_session_valid());
