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

export function useChatMessages(sessionId: string, myUserId: string | null) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  function appendIncoming(id: string, data: { content: string; senderId: string; createdAt: string }) {
    if (seenIds.current.has(id)) return;
    seenIds.current.add(id);
    setMessages((prev) => [...prev, { id, content: data.content, senderId: data.senderId, createdAt: data.createdAt, mine: false }]);
  }

  function appendSent(content: string) {
    if (!myUserId) return;
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}-${Math.random()}`,
      content,
      senderId: myUserId,
      createdAt: new Date().toISOString(),
      mine: true,
    }]);
  }

  useEffect(() => {
    if (!myUserId || !sessionId) return;
    let cancelled = false;

    const consume = async (messageId: string) => {
      if (cancelled || seenIds.current.has(messageId)) return;
      const { data } = await readAndDeleteMessage(messageId);
      if (!data || cancelled) return;
      appendIncoming(messageId, data);
    };

    const channel = supabase
      .channel(`chat:${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "ephemeral_messages",
        filter: `recipient_id=eq.${myUserId}`,
      }, async (payload) => {
        const row = payload.new as { id: string; session_id: string };
        if (row.session_id !== sessionId) return;
        await consume(row.id);
      })
      .subscribe(async (subscriptionStatus) => {
        if (subscriptionStatus !== "SUBSCRIBED" || cancelled) return;

        // Reconcile messages that arrived while this page was not open.
        // The subscription is established first so an insert cannot fall
        // into the gap between the initial query and the WebSocket join.
        const { data } = await supabase
          .from("ephemeral_messages")
          .select("id")
          .eq("session_id", sessionId)
          .eq("recipient_id", myUserId)
          .order("created_at", { ascending: true });

        for (const row of data ?? []) await consume(row.id);
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, myUserId]);

  return { messages, appendSent };
}
