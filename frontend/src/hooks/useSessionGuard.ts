import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./authContext";

const ACTIVITY_THROTTLE_MS = 60_000; // touch at most once/minute of real activity
const CHECK_INTERVAL_MS = 30_000; // poll validity every 30s to catch expiry promptly

/**
 * This hook is UX plumbing, not the security boundary. Real
 * enforcement lives in Postgres (touch_diary_session /
 * is_diary_session_valid, see supabase/migrations/0002) — every
 * actual data query is re-validated there regardless of what
 * this hook does. What this hook DOES do:
 *
 * 1. Turns real user interaction (click/keydown/scroll/touch)
 *    into a throttled call to touch_diary_session(), which is
 *    the only thing that extends the server-recorded idle
 *    window. A backgrounded tab that receives no interaction
 *    will NOT keep extending the session.
 * 2. Polls is_diary_session_valid() (read-only, no side effect)
 *    so the UI can react promptly and sign the user out with an
 *    honest explanation the moment the server considers the
 *    session expired — rather than only discovering it the next
 *    time a query happens to fail.
 */
export function useSessionGuard(): void {
  const { session, forceSignOutExpired } = useAuth();
  const lastTouchRef = useRef<number>(0);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function touchNow() {
      lastTouchRef.current = Date.now();
      const { data, error } = await supabase.rpc("touch_diary_session");
      if (!error && data === false && !cancelled) {
        await forceSignOutExpired("idle");
      }
    }

    async function checkValidity() {
      const { data, error } = await supabase.rpc("is_diary_session_valid");
      if (!error && data === false && !cancelled) {
        await forceSignOutExpired("idle");
      }
    }

    // Establish/touch immediately on session start.
    void touchNow();

    function onActivity() {
      if (Date.now() - lastTouchRef.current >= ACTIVITY_THROTTLE_MS) {
        void touchNow();
      }
    }

    const events: (keyof WindowEventMap)[] = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    const interval = window.setInterval(() => void checkValidity(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      events.forEach((evt) => window.removeEventListener(evt, onActivity));
      window.clearInterval(interval);
    };
  }, [session, forceSignOutExpired]);
}
