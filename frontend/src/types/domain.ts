// Domain types mirroring the database schema.
export type Mood = "great" | "good" | "okay" | "low" | "difficult";

export const MOOD_OPTIONS: readonly { value: Mood; label: string }[] = [
  { value: "great", label: "Great" },
  { value: "good", label: "Good" },
  { value: "okay", label: "Okay" },
  { value: "low", label: "Low" },
  { value: "difficult", label: "Difficult" },
];

export interface Profile {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
}

export interface DiaryEntry {
  id: string;
  user_id: string;
  title: string | null;
  content: string;
  mood: Mood | null;
  created_at: string;
  updated_at: string;
}

export interface MoodEntry {
  id: string;
  user_id: string;
  mood: Mood;
  note: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  admin_id: string;
  secret_code_id: string | null;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
  ended_at: string | null;
  status: "active" | "suspended" | "ended" | "expired";
}

export interface ChatMessage {
  content: string;
  sender_id: string;
  created_at: string;
}
