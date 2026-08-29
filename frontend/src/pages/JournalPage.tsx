import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDiaryEntries } from "../services/diaryService";
import { MoodBadge } from "../components/MoodBadge";
import type { DiaryEntry } from "../types/domain";

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function excerpt(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length > 160 ? trimmed.slice(0, 160) + "…" : trimmed;
}

export function JournalPage() {
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDiaryEntries().then(({ data, error: err }) => {
      if (err) setError(err.message);
      else setEntries(data ?? []);
    });
  }, []);

  if (error) {
    return <p className="font-ui text-sm text-danger">{error}</p>;
  }

  if (entries === null) {
    return <p className="font-ui text-sm text-ink-soft">Loading…</p>;
  }

  return (
    <div className="space-y-8">
      <Link
        to="/journal/new"
        className="inline-block rounded-sm border border-line px-4 py-2 font-ui text-sm text-ink-soft transition-colors hover:border-accent hover:text-ink"
      >
        + New entry
      </Link>

      {entries.length === 0 && (
        <div className="border-l-2 border-line pl-6">
          <p className="font-journal text-lg text-ink-soft">
            Nothing written yet. When you're ready, start a new entry.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            to={`/journal/${entry.id}`}
            className="group block border-l-2 border-line pl-6 transition-colors hover:border-accent"
          >
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-journal text-sm text-ink-soft">
                {dateFormatter.format(new Date(entry.created_at))}
              </p>
              {entry.mood && <MoodBadge mood={entry.mood} />}
            </div>
            {entry.title && (
              <h3 className="mt-1 font-journal text-lg text-ink group-hover:text-accent">
                {entry.title}
              </h3>
            )}
            <p className="mt-1 font-journal text-ink-soft">{excerpt(entry.content)}</p>
            <p className="mt-2 font-ui text-xs text-ink-soft">
              {timeFormatter.format(new Date(entry.created_at))}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
