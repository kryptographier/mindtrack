import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { readAndDeleteMessage } from "../services/chatService";

export interface DisplayMessage {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  mine: boolean;
}

/**
 * Subscribes to new ephemeral_messages rows addressed to the
 * current user for this session, and for each one calls
 * read_and_delete_message() — the atomic "mark read then
 * delete" RPC (see supabase/migrations/0005). A null result is
 * expected and silently ignored: it means another tab already
 * consumed this exact message, not an error (see
 * docs/architecture.md section 7 on the race-condition design).
 *
 * Sent messages are appended locally by the caller immediately
 * on send — the sender already knows what they sent and does
 * not need a round trip to see their own message rendered.
 */
export function useChatMessages(sessionId: string, myUserId: string | null) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  function appendSent(content: string) {
    if (!myUserId) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}-${Math.random()}`,
        content,
        senderId: myUserId,
        createdAt: new Date().toISOString(),
        mine: true,
      },
    ]);
  }

  useEffect(() => {
    if (!myUserId) return;

    const channel = supabase
      .channel(`chat:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ephemeral_messages",
          filter: `recipient_id=eq.${myUserId}`,
        },
        async (payload) => {
          const row = payload.new as { id: string; session_id: string };
          // Defensive extra check even though RLS already scopes
          // visibility — a user could in principle have more than
          // one chat session; don't cross-render between them.
          if (row.session_id !== sessionId) return;
          if (seenIds.current.has(row.id)) return;
          seenIds.current.add(row.id);

          const { data } = await readAndDeleteMessage(row.id);
          if (!data) return; // already consumed by another tab

          setMessages((prev) => [
            ...prev,
            {
              id: row.id,
              content: data.content,
              senderId: data.senderId,
              createdAt: data.createdAt,
              mine: false,
            },
          ]);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, myUserId]);

  return { messages, appendSent };
}
