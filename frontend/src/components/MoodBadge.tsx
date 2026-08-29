import type { Mood } from "../types/domain";

const MOOD_LABELS: Record<Mood, string> = {
  great: "Great",
  good: "Good",
  okay: "Okay",
  low: "Low",
  difficult: "Difficult",
};

const MOOD_DOT_CLASS: Record<Mood, string> = {
  great: "bg-mood-great",
  good: "bg-mood-good",
  okay: "bg-mood-okay",
  low: "bg-mood-low",
  difficult: "bg-mood-difficult",
};

export function MoodBadge({ mood }: { mood: Mood }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-ui text-xs text-ink-soft">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${MOOD_DOT_CLASS[mood]}`} />
      {MOOD_LABELS[mood]}
    </span>
  );
}
