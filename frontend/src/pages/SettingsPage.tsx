import { useAuth } from "../hooks/authContext";
import { AdminPanel } from "../components/AdminPanel";

export function SettingsPage() {
  const { profile } = useAuth();

  return (
    <div className="space-y-6">
      <h2 className="font-journal text-xl text-ink">Settings</h2>

      <div className="rounded-sm border border-line px-4 py-3">
        <p className="font-ui text-xs text-ink-soft">
          Signed in as
        </p>

        <p className="font-ui text-sm text-ink">
          {profile?.email ?? "…"}
        </p>
      </div>

      {profile?.role === "admin" && <AdminPanel />}
    </div>
  );
}
