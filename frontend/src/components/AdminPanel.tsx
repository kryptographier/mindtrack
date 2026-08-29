import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { generateSecretCode } from "../services/adminService";
import { listAdminChatSessions, revokeSecretCode, resumeChatSession, suspendChatSession } from "../services/adminChatService";
import type { ChatSession } from "../types/domain";

const EXPIRY_OPTIONS = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "6 hours", minutes: 360 },
  { label: "12 hours", minutes: 720 },
  { label: "24 hours", minutes: 1440 },
  { label: "7 days", minutes: 10080 },
];

const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AdminPanel() {
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generatedCodeId, setGeneratedCodeId] = useState<string | null>(null);
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  async function refreshSessions() {
    const result = await listAdminChatSessions();
    if (result.error) setError(result.error.message);
    else setSessions(result.data ?? []);
    setLoadingSessions(false);
  }

  useEffect(() => {
    void refreshSessions();
    const interval = window.setInterval(() => void refreshSessions(), 10000);
    return () => window.clearInterval(interval);
  }, []);

  async function handleGenerate() {
    setError(null);
    setGeneratedCode(null);
    setGeneratedCodeId(null);
    setGeneratedExpiresAt(null);
    setGenerating(true);
    const { data, error: genError } = await generateSecretCode(selectedExpiry);
    setGenerating(false);
    if (genError) return setError(genError.message);
    if (!data) return setError("Something went wrong. Please try again.");
    setGeneratedCode(data.plaintextCode);
    setGeneratedCodeId(data.id);
    setGeneratedExpiresAt(data.expiresAt);
  }

  async function handleRevokeCode() {
    if (!generatedCodeId) return;
    const { error: revokeError } = await revokeSecretCode(generatedCodeId);
    if (revokeError) return setError(revokeError.message);
    setGeneratedCode(null);
    setGeneratedCodeId(null);
    setGeneratedExpiresAt(null);
  }

  async function handleSessionAction(session: ChatSession) {
    setBusySessionId(session.id);
    const result = session.status === "suspended" ? await resumeChatSession(session.id) : await suspendChatSession(session.id);
    setBusySessionId(null);
    if (result.error) setError(result.error.message);
    await refreshSessions();
  }

  return (
    <div className="space-y-8 rounded-sm border border-line p-5">
      <section className="space-y-4">
        <div>
          <h3 className="font-journal text-lg text-ink">Private chat access</h3>
          <p className="mt-1 font-ui text-sm text-ink-soft">Generate a code with a server-enforced expiry. The first user to redeem it owns it until expiry.</p>
        </div>
        <select aria-label="Code expiry" value={selectedExpiry} onChange={(event) => setSelectedExpiry(Number(event.target.value))} disabled={generating} className="w-full rounded-sm border border-line bg-paper px-3 py-2 font-ui text-sm text-ink">
          {EXPIRY_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
        </select>
        {generatedCode && generatedExpiresAt && (
          <div role="status" className="rounded-sm border border-accent bg-paper-raised p-4">
            <p className="font-ui text-xs text-ink-soft">Share this code securely.</p>
            <p className="mt-1 select-all font-mono text-lg tracking-wide text-ink">{generatedCode}</p>
            <p className="mt-2 font-ui text-xs text-ink-soft">Expires {formatter.format(new Date(generatedExpiresAt))}. The user can re-enter it while valid.</p>
            <button type="button" onClick={() => void handleRevokeCode()} className="mt-3 font-ui text-xs text-danger hover:underline">Revoke code</button>
          </div>
        )}
        <button type="button" onClick={() => void handleGenerate()} disabled={generating} className="rounded-sm bg-accent px-4 py-2 font-ui text-sm text-paper transition-opacity disabled:opacity-60">
          {generating ? "Generating…" : "Generate code"}
        </button>
      </section>

      <section className="space-y-4 border-t border-line pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-journal text-lg text-ink">Active private sessions</h3>
            <p className="mt-1 font-ui text-sm text-ink-soft">Open, suspend, or resume live sessions.</p>
          </div>
          <button type="button" onClick={() => void refreshSessions()} className="font-ui text-xs text-ink-soft hover:text-accent">Refresh</button>
        </div>
        {loadingSessions && <p className="font-ui text-sm text-ink-soft">Loading…</p>}
        {!loadingSessions && sessions.length === 0 && <p className="font-ui text-sm text-ink-soft">No active private sessions.</p>}
        <ul className="space-y-3">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-sm border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-mono text-xs text-ink-soft">
                  <p>session: {session.id.slice(0, 8)}…</p>
                  <p>user: {session.user_id.slice(0, 8)}…</p>
                  <p>expires: {formatter.format(new Date(session.expires_at))}</p>
                  <p>status: {session.status}</p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/private/${session.id}`} className="rounded-sm border border-line px-3 py-1.5 font-ui text-xs text-ink hover:border-accent">Open chat</Link>
                  <button type="button" disabled={busySessionId === session.id} onClick={() => void handleSessionAction(session)} className="rounded-sm border border-line px-3 py-1.5 font-ui text-xs text-ink hover:border-accent disabled:opacity-60">
                    {busySessionId === session.id ? "Working…" : session.status === "suspended" ? "Resume" : "Suspend"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert" className="font-ui text-sm text-danger">{error}</p>}
    </div>
  );
}
