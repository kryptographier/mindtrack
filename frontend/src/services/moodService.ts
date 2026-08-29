import { supabase } from "../lib/supabaseClient";

import type { Mood, MoodEntry } from "../types/domain";

import type { FriendlyError } from "./diaryService";

function toFriendlyError(
  error: { message: string } | null,
): FriendlyError | null {
  if (!error) return null;

  return {
    message: "Something went wrong. Please try again.",
  };
}

export async function listMoodEntries(): Promise<{
  data: MoodEntry[] | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase
    .from("mood_entries")
    .select("id, user_id, mood, note, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return {
    data: data as MoodEntry[] | null,
    error: toFriendlyError(error),
  };
}

export async function logMood(input: {
  mood: Mood;
  note: string | null;
}): Promise<{
  data: MoodEntry | null;
  error: FriendlyError | null;
}> {
  const { data: userData } = await supabase.auth.getUser();

  const userId = userData.user?.id;

  if (!userId) {
    return {
      data: null,
      error: {
        message: "You're not signed in.",
      },
    };
  }

  const { data, error } = await supabase
    .from("mood_entries")
    .insert({
      user_id: userId,
      mood: input.mood,
      note: input.note,
    })
    .select("id, user_id, mood, note, created_at")
    .single();

  return {
    data: data as MoodEntry | null,
    error: toFriendlyError(error),
  };
}

export async function deleteMoodEntry(
  id: string,
): Promise<{
  error: FriendlyError | null;
}> {
  const { error } = await supabase
    .from("mood_entries")
    .delete()
    .eq("id", id);

  return {
    error: toFriendlyError(error),
  };
}