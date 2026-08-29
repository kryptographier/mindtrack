import { supabase } from "../lib/supabaseClient";

import type { ChatSession } from "../types/domain";
import type { FriendlyError } from "./diaryService";

function toFriendlyError(
  error: { message: string } | null,
): FriendlyError | null {
  if (!error) return null;

  return {
    message: "Something went wrong. Please try again.",
  };
}

/**
 * Redeem a persistent secret chat code.
 *
 * The code itself does not expire. The database RPC decides whether
 * it is valid/revoked and either returns the existing active session
 * or creates a new session.
 */
export async function redeemCode(code: string): Promise<{
  sessionId: string | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase.rpc(
    "redeem_secret_code",
    {
      p_code: code.trim(),
    },
  );

  if (error) {
    console.error("redeem_secret_code failed:", error);

    return {
      sessionId: null,
      error: toFriendlyError(error),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return {
      sessionId: null,
      error: {
        message: "Something went wrong. Please try again.",
      },
    };
  }

  if (row.error_message) {
    return {
      sessionId: null,
      error: {
        message: row.error_message,
      },
    };
  }

  if (!row.chat_session_id) {
    return {
      sessionId: null,
      error: {
        message: "Something went wrong. Please try again.",
      },
    };
  }

  return {
    sessionId: row.chat_session_id,
    error: null,
  };
}

/**
 * Admin-only list of currently active chat sessions.
 */
export async function listActiveSessionsAsAdmin(): Promise<{
  data: ChatSession[] | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select(
      "id, user_id, admin_id, created_at, expires_at, last_activity_at, status",
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  return {
    data: data as ChatSession[] | null,
    error: toFriendlyError(error),
  };
}

/**
 * Send an ephemeral chat message.
 *
 * The actual message is written server-side by the RPC and is
 * automatically subject to the chat-session validity checks.
 */
export async function sendChatMessage(
  sessionId: string,
  content: string,
): Promise<{
  error: FriendlyError | null;
}> {
  const { error } = await supabase.rpc(
    "send_chat_message",
    {
      p_session_id: sessionId,
      p_content: content,
    },
  );

  return {
    error: toFriendlyError(error),
  };
}

/**
 * Atomically read and delete an incoming ephemeral message.
 *
 * This is intentionally retained because useChatMessages.ts relies
 * on it to prevent the same incoming message being consumed twice.
 */
export async function readAndDeleteMessage(
  messageId: string,
): Promise<{
  data: {
    content: string;
    senderId: string;
    createdAt: string;
  } | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase.rpc(
    "read_and_delete_message",
    {
      p_message_id: messageId,
    },
  );

  if (error) {
    return {
      data: null,
      error: toFriendlyError(error),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return {
      data: null,
      error: null,
    };
  }

  return {
    data: {
      content: row.content,
      senderId: row.sender_id,
      createdAt: row.created_at,
    },
    error: null,
  };
}

/**
 * Check whether the chat session is still valid.
 *
 * The database remains the authority on expiry.
 */
export async function isChatSessionValid(
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "is_chat_session_valid",
    {
      p_session_id: sessionId,
    },
  );

  if (error) {
    return false;
  }

  return Boolean(data);
}

/**
 * End a chat session explicitly.
 */
export async function endChatSession(
  sessionId: string,
): Promise<{
  error: FriendlyError | null;
}> {
  const { error } = await supabase.rpc(
    "end_chat_session",
    {
      p_session_id: sessionId,
    },
  );

  return {
    error: toFriendlyError(error),
  };
}
