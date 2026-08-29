import { supabase } from "../lib/supabaseClient";
import type { DiaryEntry, Mood } from "../types/domain";

// Centralized here per the "centralized API logic" requirement —
// components call these, never supabase.from(...) directly, so
// there's exactly one place that knows the diary_entries shape.

export interface FriendlyError {
  message: string;
}

function toFriendlyError(error: { message: string } | null): FriendlyError | null {
  if (!error) return null;
  // Never surface raw Postgres/PostgREST error text to the UI —
  // see docs/architecture.md and SECURITY.md on error handling.
  return { message: "Something went wrong. Please try again." };
}

export async function listDiaryEntries(): Promise<{
  data: DiaryEntry[] | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase
    .from("diary_entries")
    .select("id, user_id, title, content, mood, created_at, updated_at")
    .order("created_at", { ascending: false });

  return { data: data as DiaryEntry[] | null, error: toFriendlyError(error) };
}

export async function createDiaryEntry(input: {
  title: string | null;
  content: string;
  mood: Mood | null;
}): Promise<{ data: DiaryEntry | null; error: FriendlyError | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return { data: null, error: { message: "You're not signed in." } };
  }

  const { data, error } = await supabase
    .from("diary_entries")
    // user_id is included because the column is NOT NULL, but RLS's
    // WITH CHECK (user_id = auth.uid()) is what actually prevents
    // writing it as anyone else — this is not the security boundary.
    .insert({ user_id: userId, title: input.title, content: input.content, mood: input.mood })
    .select("id, user_id, title, content, mood, created_at, updated_at")
    .single();

  return { data: data as DiaryEntry | null, error: toFriendlyError(error) };
}

export async function updateDiaryEntry(
  id: string,
  input: { title: string | null; content: string; mood: Mood | null },
): Promise<{ data: DiaryEntry | null; error: FriendlyError | null }> {
  const { data, error } = await supabase
    .from("diary_entries")
    .update({ title: input.title, content: input.content, mood: input.mood })
    .eq("id", id)
    .select("id, user_id, title, content, mood, created_at, updated_at")
    .single();

  return { data: data as DiaryEntry | null, error: toFriendlyError(error) };
}

export async function deleteDiaryEntry(id: string): Promise<{ error: FriendlyError | null }> {
  const { error } = await supabase.from("diary_entries").delete().eq("id", id);
  return { error: toFriendlyError(error) };
}
