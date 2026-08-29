import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "../types/domain";

export interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True after the app force-signed the user out due to diary
   *  session expiration (idle or max-lifetime), so the login
   *  screen can show a plain explanation instead of a silent
   *  bounce. Server-enforced — see docs/architecture.md section 5. */
  sessionExpiredReason: "idle" | "lifetime" | null;
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  forceSignOutExpired: (reason: "idle" | "lifetime") => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
