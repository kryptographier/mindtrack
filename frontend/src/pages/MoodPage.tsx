import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deleteMoodEntry, listMoodEntries, logMood } from "../services/moodService";
import { redeemCode } from "../services/chatService";
import { moodNoteSchema, secretCodeSchema } from "../lib/validation";
import { MoodBadge } from "../components/MoodBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MOOD_OPTIONS, type Mood, type MoodEntry } from "../types/domain";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const SECRET_CODE_PATTERN = /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){5}$/;

export function MoodPage() {
  const navigate = useNavigate();
  const [mood, setMood] = useState<Mood | "">("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<MoodEntry[] | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<MoodEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { void refreshHistory(); }, []);

  async function refreshHistory() {
    const { data, error } = await listMoodEntries();
    if (error) return setSubmitError(error.message);
    setHistory(data ?? []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setNoteError(null);

    const possibleCode = note.trim();
    const isCodeShape = secretCodeSchema.safeParse(possibleCode).success && SECRET_CODE_PATTERN.test(possibleCode);

    // Code redemption is intentionally checked BEFORE mood validation.
    // A user can enter a private-chat code without selecting a mood,
    // and a code-shaped value must never silently become diary data.
    if (isCodeShape) {
      setSubmitting(true);
      const { sessionId, error: redeemError } = await redeemCode(possibleCode);
      setSubmitting(false);
      if (sessionId) {
        setMood("");
        setNote("");
        navigate(`/private/${sessionId}`, { replace: true });
        return;
      }
      setSubmitError(redeemError?.message ?? "That private chat code is invalid or expired.");
      return;
    }

    if (!mood) {
      setSubmitError("Select how you're feeling first.");
      return;
    }

    const noteResult = moodNoteSchema.safeParse(note || undefined);
    if (!noteResult.success) {
      setNoteError(noteResult.error.issues[0]?.message ?? "Note is too long");
      return;
    }

    setSubmitting(true);
    const { error } = await logMood({ mood, note: noteResult.data ?? null });
    setSubmitting(false);
    if (error) return setSubmitError(error.message);

    setMood("");
    setNote("");
    await refreshHistory();
  }

  async function handleDeleteMood() {
    if (!deletingEntry) return;
    setDeleting(true);
    const { error } = await deleteMoodEntry(deletingEntry.id);
    setDeleting(false);
    if (error) {
      setSubmitError(error.message);
      setDeletingEntry(null);
      return;
    }
    setDeletingEntry(null);
    await refreshHistory();
  }

  return (
    <div className="space-y-10">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="font-journal text-xl text-ink">How are you feeling?</h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">Select your mood</legend>
          {MOOD_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-3 rounded-sm border border-line px-4 py-2.5 font-ui text-sm text-ink transition-colors hover:border-accent">
              <input type="radio" name="mood" value={opt.value} checked={mood === opt.value} onChange={() => setMood(opt.value)} className="accent-accent" />
              {opt.label}
            </label>
          ))}
        </fieldset>

        <div>
          <label htmlFor="mood-note" className="mb-1.5 block font-ui text-sm text-ink-soft">Note (optional)</label>
          <input id="mood-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-line bg-paper px-3 py-2 font-ui text-sm text-ink focus-visible:border-accent" />
          {noteError && <p role="alert" className="mt-1 font-ui text-sm text-danger">{noteError}</p>}
        </div>

        {submitError && <p role="alert" className="font-ui text-sm text-danger">{submitError}</p>}
        <button type="submit" disabled={submitting} className="rounded-sm bg-accent px-4 py-2 font-ui text-sm text-paper transition-opacity disabled:opacity-60">
          {submitting ? "Working…" : "Save"}
        </button>
      </form>

      <div>
        <h3 className="font-journal text-lg text-ink">History</h3>
        {history === null && <p className="mt-3 font-ui text-sm text-ink-soft">Loading…</p>}
        {history?.length === 0 && <p className="mt-3 font-ui text-sm text-ink-soft">No moods logged yet.</p>}
        <ul className="mt-4 space-y-3">
          {history?.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 border-l-2 border-line pl-4">
              <MoodBadge mood={entry.mood} />
              {entry.note && <span className="min-w-0 flex-1 font-ui text-sm text-ink">{entry.note}</span>}
              <span className="ml-auto shrink-0 font-ui text-xs text-ink-soft">{dateTimeFormatter.format(new Date(entry.created_at))}</span>
              <button type="button" onClick={() => setDeletingEntry(entry)} aria-label="Delete mood entry" className="shrink-0 font-ui text-xs text-ink-soft transition-colors hover:text-danger">Delete</button>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog open={deletingEntry !== null} title="Delete this mood?" description="This mood entry will be permanently deleted." confirmLabel={deleting ? "Deleting…" : "Delete"} onConfirm={handleDeleteMood} onCancel={() => { if (!deleting) setDeletingEntry(null); }} />
    </div>
  );
}
