import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import {
  endChatSession,
  isChatSessionValid,
  sendChatMessage,
} from "../services/chatService";
import { useChatMessages } from "../hooks/useChatMessages";
import { chatMessageSchema } from "../lib/validation";
import type { ChatSession } from "../types/domain";

const CHECK_INTERVAL_MS = 15_000; // shorter than diary's — chat sessions are short-lived by design

type Status = "loading" | "active" | "expired" | "ended" | "not_found";

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "00:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PrivateChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<ChatSession | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [countdownLabel, setCountdownLabel] = useState("--:--");
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, appendSent } = useChatMessages(sessionId ?? "", myUserId);

  // Load the session row once. RLS scopes this to participants
  // only — a non-participant or bogus id simply returns no row,
  // which we treat as "not found" rather than distinguishing why.
  useEffect(() => {
    if (!sessionId) return;

    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));

    supabase
      .from("chat_sessions")
      .select("id, user_id, admin_id, created_at, expires_at, last_activity_at, ended_at, status")
      .eq("id", sessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          setStatus("not_found");
          return;
        }
        setSession(data as ChatSession);
        setStatus(data.status === "active" ? "active" : data.status === "ended" ? "ended" : "expired");
      });
  }, [sessionId]);

  // Cosmetic countdown, ticking every second from the session's
  // expires_at. This is display only — the actual enforcement is
  // the periodic is_chat_session_valid() check below and, more
  // fundamentally, the server-side checks inside every RPC.
  useEffect(() => {
    if (!session || status !== "active") return;
    const tick = () => {
      const remaining = new Date(session.expires_at).getTime() - Date.now();
      setCountdownLabel(formatCountdown(remaining));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [session, status]);

  // Real enforcement: poll the server's own validity check. Chat
  // "activity" that extends the session is sending a message
  // (touch_chat_session runs inside send_message on the server) —
  // unlike the diary's idle timer, merely having the tab open
  // does not keep a chat session alive, which matches a chat
  // session's inherently short, conversational nature.
  useEffect(() => {
    if (!sessionId || status !== "active") return;
    const interval = window.setInterval(async () => {
      const valid = await isChatSessionValid(sessionId);
      if (!valid) setStatus("expired");
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [sessionId, status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    if (!sessionId) return;
    const parsed = chatMessageSchema.safeParse(draft);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? "Message is invalid");
      return;
    }
    setInputError(null);

    const { error } = await sendChatMessage(sessionId, parsed.data);
    if (error) {
      if (error.message.toLowerCase().includes("expired")) {
        setStatus("expired");
      } else {
        setInputError(error.message);
      }
      return;
    }

    appendSent(parsed.data);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleEnd() {
    if (sessionId) await endChatSession(sessionId);
    navigate("/journal", { replace: true });
  }

  function roleLabel(senderId: string): string {
    if (!session) return "user";
    return senderId === session.admin_id ? "admin" : "user";
  }

  if (status === "loading") {
    return <p className="p-8 font-mono text-sm text-term-text">Connecting…</p>;
  }

  if (status === "not_found") {
    return (
      <div className="terminal flex min-h-screen flex-col items-center justify-center bg-term-bg px-4">
        <p className="font-mono text-sm text-term-text">This private session doesn't exist.</p>
        <button
          type="button"
          onClick={() => navigate("/journal")}
          className="mt-4 font-mono text-sm text-term-accent hover:underline"
        >
          Return to journal
        </button>
      </div>
    );
  }

  if (status === "expired" || status === "ended") {
    return (
      <div className="terminal flex min-h-screen flex-col items-center justify-center bg-term-bg px-4">
        <div className="w-full max-w-md border border-term-line p-4 font-mono text-sm text-term-text">
          <p>PRIVATE SESSION</p>
          <p className="mt-1 text-term-dim">status: {status}</p>
          <p className="mt-4">
            {status === "expired" ? "This session has ended." : "The session was ended."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/journal")}
          className="mt-4 font-mono text-sm text-term-accent hover:underline"
        >
          [ Return to journal ]
        </button>
      </div>
    );
  }

  return (
    <div className="terminal flex h-screen flex-col bg-term-bg">
      <div className="border-b border-term-line px-4 py-3 font-mono text-xs text-term-dim">
        <p className="text-term-text">MINDTRACK / PRIVATE SESSION</p>
        <p>status: connected</p>
        <p>expires: {countdownLabel}</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className="mb-4">
            <p className="font-mono text-xs text-term-accent">
              {roleLabel(m.senderId)}@private:~$
              <span className="ml-2 text-term-dim">{timeFormatter.format(new Date(m.createdAt))}</span>
            </p>
            <p className="whitespace-pre-wrap font-mono text-sm text-term-text">{m.content}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-term-line p-3">
        {inputError && <p className="mb-2 font-mono text-xs text-danger">{inputError}</p>}
        <div className="flex items-end gap-2">
          <span className="pb-2 font-mono text-sm text-term-accent">$</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Message"
            placeholder="type message…"
            className="flex-1 resize-none border-none bg-transparent font-mono text-sm text-term-text placeholder:text-term-dim focus-visible:outline-none"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleEnd}
        className="border-t border-term-line px-4 py-2 text-left font-mono text-xs text-term-dim hover:text-danger"
      >
        End session
      </button>
    </div>
  );
}
