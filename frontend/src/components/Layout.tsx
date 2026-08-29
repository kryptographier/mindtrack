import type { ReactNode } from "react";

import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/authContext";
import { useSessionGuard } from "../hooks/useSessionGuard";

const todayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date());

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "font-ui text-sm tracking-wide transition-colors",
    isActive ? "text-ink border-b border-accent" : "text-ink-soft hover:text-ink",
    "pb-1",
  ].join(" ");
}

export function Layout({ children }: { children: ReactNode }) {
  useSessionGuard();

  const { signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center">
          <div className="flex items-baseline gap-3">
            <span className="font-journal text-lg tracking-tight">MindTrack</span>

            <span className="hidden font-ui text-xs text-ink-soft sm:inline">
              {todayLabel}
            </span>
          </div>
        </div>

        <nav className="mx-auto mt-4 flex max-w-3xl gap-6" aria-label="Main">
          <NavLink to="/journal" className={navLinkClass}>
            Journal
          </NavLink>

          <NavLink to="/mood" className={navLinkClass}>
            Mood
          </NavLink>

          <NavLink to="/settings" className={navLinkClass}>
            Settings
          </NavLink>

          <button
            type="button"
            onClick={handleSignOut}
            className="ml-auto font-ui text-sm text-ink-soft transition-colors hover:text-danger"
          >
            Log out
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}