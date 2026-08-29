import { supabase } from "../lib/supabaseClient";
import type { ChatSession } from "../types/domain";
import type { FriendlyError } from "./diaryService";

function friendly(error: { message: string } | null): FriendlyError | null {
  return error ? { message: "Something went wrong. Please try again." } : null;
}

export async function listAdminChatSessions(): Promise<{
  data: ChatSession[] | null;
  error: FriendlyError | null;
}> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { data: null, error: { message: "Not authenticated." } };

  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, user_id, admin_id, secret_code_id, created_at, expires_at, last_activity_at, ended_at, status")
    .in("status", ["active", "suspended"])
    .eq("admin_id", userId)
    .order("created_at", { ascending: false });

  return { data: data as ChatSession[] | null, error: friendly(error) };
}

export async function revokeSecretCode(codeId: string): Promise<{ error: FriendlyError | null }> {
  const { error } = await supabase.rpc("admin_revoke_secret_code", { p_id: codeId });
  return { error: friendly(error) };
}

export async function suspendChatSession(sessionId: string): Promise<{ error: FriendlyError | null }> {
  const { error } = await supabase.rpc("admin_suspend_chat_session", { p_session_id: sessionId });
  return { error: friendly(error) };
}

export async function resumeChatSession(sessionId: string): Promise<{ error: FriendlyError | null }> {
  const { error } = await supabase.rpc("admin_resume_chat_session", { p_session_id: sessionId });
  return { error: friendly(error) };
}
