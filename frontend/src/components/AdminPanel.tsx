import { useState } from "react";

import { generateSecretCode } from "../services/adminService";

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

export function AdminPanel() {
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState(60);
  const [generatedExpiry, setGeneratedExpiry] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setGeneratedCode(null);
    setGeneratedExpiry(null);
    setGenerating(true);

    const { data, error: genError } =
      await generateSecretCode(selectedExpiry);

    setGenerating(false);

    if (genError) {
      setError(genError.message);
      return;
    }

    if (!data) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setGeneratedCode(data.plaintextCode);
    setGeneratedExpiry(selectedExpiry);
  }

  function expiryLabel(minutes: number): string {
    const option = EXPIRY_OPTIONS.find(
      (item) => item.minutes === minutes,
    );

    if (option) return option.label;

    if (minutes < 60) {
      return `${minutes} minutes`;
    }

    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `${hours} ${hours === 1 ? "hour" : "hours"}`;
    }

    return `${minutes} minutes`;
  }

  return (
    <div className="space-y-6 rounded-sm border border-line p-5">
      <div>
        <h3 className="font-journal text-lg text-ink">
          Private chat access
        </h3>

        <p className="mt-1 font-ui text-sm text-ink-soft">
          Generate a private-chat code with a fixed expiration time.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="secret-code-expiry"
          className="block font-ui text-sm text-ink"
        >
          Code expires after
        </label>

        <select
          id="secret-code-expiry"
          value={selectedExpiry}
          onChange={(event) =>
            setSelectedExpiry(Number(event.target.value))
          }
          disabled={generating}
          className="w-full rounded-sm border border-line bg-paper px-3 py-2 font-ui text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {EXPIRY_OPTIONS.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {generatedCode && (
        <div
          role="status"
          className="rounded-sm border border-accent bg-paper-raised p-4"
        >
          <p className="font-ui text-xs text-ink-soft">
            Share this code securely.
          </p>

          <p className="mt-1 select-all font-mono text-lg tracking-wide text-ink">
            {generatedCode}
          </p>

          {generatedExpiry !== null && (
            <p className="mt-2 font-ui text-xs text-ink-soft">
              Expires in {expiryLabel(generatedExpiry)}.
            </p>
          )}

          <p className="mt-1 font-ui text-xs text-ink-soft">
            The code can only be redeemed once.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="rounded-sm bg-accent px-4 py-2 font-ui text-sm text-paper transition-opacity disabled:opacity-60"
      >
        {generating ? "Generating…" : "Generate code"}
      </button>

      {error && (
        <p
          role="alert"
          className="font-ui text-sm text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
