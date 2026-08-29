import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { endChatSession, isChatSessionValid, sendChatMessage } from "../services/chatService";
import { useChatMessages } from "../hooks/useChatMessages";
import { chatMessageSchema } from "../lib/validation";
import type { ChatSession } from "../types/domain";

const CHECK_INTERVAL_MS = 15_000;
type Status = "loading" | "active" | "suspended" | "expired" | "ended" | "not_found";
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "00:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
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

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setMyUserId(data.user?.id ?? null);
    });
    void supabase
      .from("chat_sessions")
      .select("id, user_id, admin_id, secret_code_id, created_at, expires_at, last_activity_at, ended_at, status")
      .eq("id", sessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          setStatus("not_found");
          return;
        }
        const next = data as ChatSession;
        setSession(next);
        setStatus(next.status === "active" ? "active" : next.status === "suspended" ? "suspended" : next.status === "ended" ? "ended" : "expired");
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!session || status !== "active") return;
    const tick = () => setCountdownLabel(formatCountdown(new Date(session.expires_at).getTime() - Date.now()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [session, status]);

  useEffect(() => {
    if (!sessionId || status !== "active") return;
    const interval = window.setInterval(async () => {
      const valid = await isChatSessionValid(sessionId);
      if (!valid) {
        const { data } = await supabase.from("chat_sessions").select("status").eq("id", sessionId).maybeSingle();
        setStatus(data?.status === "suspended" ? "suspended" : "expired");
      }
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [sessionId, status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    if (!sessionId || status !== "active") return;
    const parsed = chatMessageSchema.safeParse(draft);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? "Message is invalid");
      return;
    }
    setInputError(null);
    const { error } = await sendChatMessage(sessionId, parsed.data);
    if (error) {
      setInputError(error.message);
      if (error.message.toLowerCase().includes("expired") || error.message.toLowerCase().includes("suspended")) {
        setStatus(error.message.toLowerCase().includes("suspended") ? "suspended" : "expired");
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
    return senderId === session?.admin_id ? "admin" : "user";
  }

  if (status === "loading") return <p className="p-8 font-mono text-sm text-term-text">Connecting…</p>;

  if (status === "not_found") {
    return (
      <div className="terminal flex min-h-screen flex-col items-center justify-center bg-term-bg px-4">
        <p className="font-mono text-sm text-term-text">This private session doesn't exist.</p>
        <button type="button" onClick={() => navigate("/journal")} className="mt-4 font-mono text-sm text-term-accent hover:underline">Return to journal</button>
      </div>
    );
  }

  if (status === "expired" || status === "ended" || status === "suspended") {
    return (
      <div className="terminal flex min-h-screen flex-col items-center justify-center bg-term-bg px-4">
        <div className="w-full max-w-md border border-term-line p-4 font-mono text-sm text-term-text">
          <p>PRIVATE SESSION</p>
          <p className="mt-1 text-term-dim">status: {status}</p>
          <p className="mt-4">
            {status === "suspended" ? "This session is temporarily suspended by the administrator." : status === "expired" ? "This session has expired." : "The session was ended."}
          </p>
        </div>
        <button type="button" onClick={() => navigate("/journal")} className="mt-4 font-mono text-sm text-term-accent hover:underline">[ Return to journal ]</button>
      </div>
    );
  }

  return (
    <div className="terminal flex h-screen flex-col bg-term-bg">
      <div className="border-b border-term-line px-4 py-3 font-mono text-xs text-term-dim">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-term-text">MINDTRACK / PRIVATE SESSION</p>
            <p>status: connected</p>
            <p>expires: {countdownLabel}</p>
          </div>
          <button type="button" onClick={() => navigate("/journal")} className="text-term-accent hover:underline">[ Journal ]</button>
        </div>
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
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown} rows={1} aria-label="Message" placeholder="type message…" className="flex-1 resize-none border-none bg-transparent font-mono text-sm text-term-text placeholder:text-term-dim focus-visible:outline-none" />
        </div>
      </div>

      <button type="button" onClick={handleEnd} className="border-t border-term-line px-4 py-2 text-left font-mono text-xs text-term-dim hover:text-danger">
        End session (revokes code)
      </button>
    </div>
  );
}
