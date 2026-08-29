import { createClient } from "@supabase/supabase-js";

// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are public by
// design — see .env.example. The real security boundary is
// Postgres RLS + the SECURITY DEFINER functions in
// supabase/migrations, not secrecy of this client configuration.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly in development rather than silently talking to
  // nothing. In production this indicates a broken build step.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your project's values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persisted only so a refresh doesn't force re-login; the
    // token itself is short-lived and re-validated server-side
    // on every diary/chat query (see docs/architecture.md
    // section 5). This is not where the security boundary is.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    // Every diary/mood/chat response carries private content.
    // Note: a Cache-Control header on the REQUEST does not
    // control browser caching — that's governed by the SERVER's
    // response headers, which we don't control here. The actual
    // client-side lever is the Fetch API's `cache` option, which
    // tells the browser not to consult or populate its HTTP
    // cache for this request at all, regardless of what
    // PostgREST's response headers say.
    fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
  },
});
