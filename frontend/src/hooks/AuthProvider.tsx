import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../types/domain";
import { AuthContext } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiredReason, setSessionExpiredReason] = useState<"idle" | "lifetime" | null>(
    null,
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("id, email, role, created_at")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setProfile((data as Profile) ?? null));
  }, [session]);

  async function sendOtp(email: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    // Generic message regardless of outcome specifics, to avoid
    // account-enumeration signals (see docs/architecture.md
    // section 4). Rate-limit errors from Supabase Auth are the
    // one thing worth surfacing distinctly, so the person isn't
    // confused about why nothing arrived.
    if (error) {
      if (error.status === 429) {
        return { error: "Too many attempts. Please wait a moment before trying again." };
      }
      return { error: "Something went wrong. Please try again." };
    }
    return { error: null };
  }

  async function verifyOtp(email: string, code: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      if (error.status === 429) {
        return { error: "Too many attempts. Please wait a moment before trying again." };
      }
      return { error: "That code didn't work. It may be incorrect or expired." };
    }
    setSessionExpiredReason(null);
    return { error: null };
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
    setSessionExpiredReason(null);
  }

  async function forceSignOutExpired(reason: "idle" | "lifetime"): Promise<void> {
    await supabase.auth.signOut();
    setSessionExpiredReason(reason);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        sessionExpiredReason,
        sendOtp,
        verifyOtp,
        signOut,
        forceSignOutExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
