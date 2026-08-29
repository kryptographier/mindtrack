import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createDiaryEntry,
  deleteDiaryEntry,
  listDiaryEntries,
  updateDiaryEntry,
} from "../services/diaryService";
import { diaryContentSchema, diaryTitleSchema } from "../lib/validation";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MOOD_OPTIONS, type Mood } from "../types/domain";

type SaveState = "idle" | "saving" | "saved" | "error";

export function EntryEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === "new" || id === undefined;

  const [loading, setLoading] = useState(!isNew);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<Mood | "">("");
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; content?: string }>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const savedTimeoutRef = useRef<number>();

  useEffect(() => {
    if (isNew) return;
    // No dedicated "get one entry" endpoint yet — reuse the list
    // and find it client-side; RLS still means only this user's
    // rows are ever returned, so this can't leak another entry.
    listDiaryEntries().then(({ data }) => {
      const found = data?.find((e) => e.id === id);
      if (found) {
        setTitle(found.title ?? "");
        setContent(found.content);
        setMood(found.mood ?? "");
      }
      setLoading(false);
    });
  }, [id, isNew]);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) window.clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  async function handleSave() {
    const titleResult = diaryTitleSchema.safeParse(title || undefined);
    const contentResult = diaryContentSchema.safeParse(content);

    const nextFieldErrors: { title?: string; content?: string } = {};
    if (!titleResult.success) nextFieldErrors.title = titleResult.error.issues[0]?.message;
    if (!contentResult.success) nextFieldErrors.content = contentResult.error.issues[0]?.message;
    setFieldErrors(nextFieldErrors);
    if (!titleResult.success || !contentResult.success) return;

    setSaveState("saving");
    setSaveError(null);

    const payload = {
      title: titleResult.data ?? null,
      content: contentResult.data,
      mood: (mood || null) as Mood | null,
    };

    const { data: result, error } = isNew
      ? await createDiaryEntry(payload)
      : await updateDiaryEntry(id!, payload);

    if (error || !result) {
      setSaveState("error");
      setSaveError(error?.message ?? "Couldn't save your entry. Please try again.");
      return;
    }

    setSaveState("saved");
    savedTimeoutRef.current = window.setTimeout(() => setSaveState("idle"), 2000);

    if (isNew) {
      navigate(`/journal/${result.id}`, { replace: true });
    }
  }

  async function handleDelete() {
    if (!id) return;
    const { error } = await deleteDiaryEntry(id);
    if (error) {
      setSaveError("Couldn't delete this entry. Please try again.");
      setConfirmDeleteOpen(false);
      return;
    }
    navigate("/journal", { replace: true });
  }

  if (loading) {
    return <p className="font-ui text-sm text-ink-soft">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        aria-label="Entry title"
        className="w-full border-none bg-transparent font-journal text-2xl text-ink placeholder:text-ink-soft/60 focus-visible:outline-none"
      />
      {fieldErrors.title && (
        <p role="alert" className="font-ui text-sm text-danger">
          {fieldErrors.title}
        </p>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write what's on your mind…"
        aria-label="Entry content"
        rows={16}
        className="w-full resize-none border-none bg-transparent font-journal text-lg leading-relaxed text-ink placeholder:text-ink-soft/60 focus-visible:outline-none"
      />
      {fieldErrors.content && (
        <p role="alert" className="font-ui text-sm text-danger">
          {fieldErrors.content}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="font-ui text-xs text-ink-soft">Mood:</span>
        {MOOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMood(mood === opt.value ? "" : opt.value)}
            aria-pressed={mood === opt.value}
            className={`rounded-sm border px-2.5 py-1 font-ui text-xs transition-colors ${
              mood === opt.value
                ? "border-accent text-ink"
                : "border-line text-ink-soft hover:border-accent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="rounded-sm bg-accent px-4 py-2 font-ui text-sm text-paper transition-opacity disabled:opacity-60"
          >
            {saveState === "saving" ? "Saving…" : "Save entry"}
          </button>
          <span role="status" className="font-ui text-xs text-ink-soft">
            {saveState === "saved" && "Saved"}
          </span>
          {saveError && (
            <span role="alert" className="font-ui text-xs text-danger">
              {saveError}
            </span>
          )}
        </div>
        {!isNew && (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="font-ui text-sm text-ink-soft transition-colors hover:text-danger"
          >
            Delete
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete this entry?"
        description="This can't be undone."
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
