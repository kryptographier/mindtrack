import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/authContext";
import { emailSchema, otpCodeSchema } from "../lib/validation";

const RESEND_COOLDOWN_SECONDS = 60; // mirrors Supabase Auth's own OTP resend cooldown

type Step = "email" | "code";

export function LoginPage() {
  const { session, sendOtp, verifyOtp, sessionExpiredReason } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (session) {
    return <Navigate to="/journal" replace />;
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }

    setSubmitting(true);
    const { error: sendError } = await sendOtp(parsed.data);
    setSubmitting(false);

    if (sendError) {
      setError(sendError);
      return;
    }

    setStep("code");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter the 6-digit code");
      return;
    }

    setSubmitting(true);
    const { error: verifyError } = await verifyOtp(email, parsed.data);
    setSubmitting(false);

    if (verifyError) {
      setError(verifyError);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setError(null);
    setSubmitting(true);
    const { error: sendError } = await sendOtp(email);
    setSubmitting(false);
    if (sendError) {
      setError(sendError);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="font-journal text-3xl text-ink">MindTrack</h1>
          <p className="mt-2 font-ui text-sm text-ink-soft">Your private journal.</p>
        </div>

        {sessionExpiredReason && (
          <div
            role="status"
            className="mb-6 rounded-sm border border-line bg-paper-raised px-4 py-3 font-ui text-sm text-ink-soft"
          >
            {sessionExpiredReason === "idle"
              ? "You were signed out after a period of inactivity."
              : "Your session reached its time limit. Please sign in again."}
          </div>
        )}

        {step === "email" && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block font-ui text-sm text-ink-soft">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-sm border border-line bg-paper px-3 py-2.5 font-ui text-ink focus-visible:border-accent"
                placeholder="you@example.com"
                disabled={submitting}
              />
            </div>
            {error && (
              <p role="alert" className="font-ui text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-sm bg-accent px-4 py-2.5 font-ui text-sm text-paper transition-opacity disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <p className="font-ui text-sm text-ink-soft">
              If that email is registered, a 6-digit code has been sent to <strong>{email}</strong>.
            </p>
            <div>
              <label htmlFor="code" className="mb-1.5 block font-ui text-sm text-ink-soft">
                Verification code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-sm border border-line bg-paper px-3 py-2.5 font-mono text-lg tracking-widest text-ink focus-visible:border-accent"
                placeholder="000000"
                disabled={submitting}
              />
            </div>
            {error && (
              <p role="alert" className="font-ui text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-sm bg-accent px-4 py-2.5 font-ui text-sm text-paper transition-opacity disabled:opacity-60"
            >
              {submitting ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || submitting}
              className="w-full font-ui text-xs text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="w-full font-ui text-xs text-ink-soft underline-offset-2 hover:underline"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
