// cleanup: deletes stale bookkeeping rows (session_activity,
// rate_limits, old ended/expired chat data) via the
// service-role-only cleanup_expired_records() RPC. Called once
// a day by .github/workflows/cleanup.yml.
//
// This function performs privileged writes, so — unlike
// keepalive — it cannot simply be left open. verify_jwt is
// disabled in supabase/config.toml (there's no user session to
// attach a JWT from in a scheduled job), so the gate here is an
// explicit shared-secret check: the caller must send the same
// secret configured as this function's CLEANUP_SECRET env var,
// in the X-Cleanup-Secret header. No match, no work performed —
// not even a hint about why, beyond a generic 401.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("CLEANUP_SECRET");
  const providedSecret = req.headers.get("X-Cleanup-Secret");

  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Deliberately uses the service-role key — never the anon key
  // — and only here, inside a function gated by the check above.
  // This key is never sent to, or accessible from, the browser.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabaseAdmin.rpc("cleanup_expired_records");

  if (error) {
    // Internal detail stays server-side (in Supabase's own
    // function logs), matching the app-wide error-handling rule
    // of never surfacing raw database errors.
    return new Response(JSON.stringify({ error: "cleanup failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ status: "ok", result: data }), {
    headers: { "content-type": "application/json" },
  });
});
