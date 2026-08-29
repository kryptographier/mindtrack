# MindTrack — Security

This document describes what MindTrack actually protects against, how, and
where the honest limits of that protection are. Nothing here claims the
system is "100% secure" — that claim isn't meaningful, and specific,
falsifiable statements are more useful than a blanket assurance.

## Authentication model

- Passwordless email OTP via Supabase Auth. No passwords are stored by this
  application (Supabase Auth itself never stores plaintext passwords either,
  since none are used).
- No SMS: confirmed during architecture planning (`docs/architecture.md`)
  that no genuinely free SMS path exists for this stack, so SMS OTP was
  excluded entirely rather than silently assumed free.
- OTP delivery uses a custom SMTP provider (Brevo, free tier) rather than
  Supabase's default sender, because the default sender only delivers to
  members of the Supabase organization — which would not reach two
  independent real users. See `docs/architecture.md` section 3.
- Login responses are deliberately generic ("if this email is registered, a
  code has been sent") to avoid confirming which emails have accounts.

## Authorization model

- **Row Level Security (RLS) is enabled on every table containing user or
  application data**, with default-deny policies. A role with no matching
  policy sees nothing, not everything.
- The `authenticated` role additionally requires an explicit `GRANT` on each
  table before RLS policies are even evaluated — Postgres checks base table
  privileges first. Every migration grants only the minimum needed (often
  `SELECT` only, with all writes forced through functions). This exact gap
  (RLS policies present, but no underlying `GRANT`) was caught during Phase 2
  by actually running the migrations against a test database — see
  `docs/database.md`.
- Admin authorization (`is_admin()`) checks a `role` column in `profiles`
  that is **never client-writable** — no insert/update/delete policy exists
  for that table at all. The only way to become admin is a direct,
  service-role-only SQL statement performed by the project owner during
  deployment (see `docs/deployment.md`), never through any application code
  path.
- Ownership checks (`user_id = auth.uid()`) are derived from the verified
  JWT server-side, never from a client-supplied field. A request that tries
  to set its own `user_id`, `role`, `admin_id`, `sender_id`, or `recipient_id`
  is either rejected outright (most of these columns have no client-writable
  path) or silently overridden by server-side logic (e.g. `send_message()`
  computes `recipient_id` itself).

## Session expiration (a Free-tier workaround, not a Pro feature)

Supabase Auth's dashboard-level idle-timeout / time-boxed-session feature is
**Pro-plan-only** (confirmed against Supabase's own documentation, August
2026). MindTrack implements the equivalent itself:

- A `session_activity` table tracks each diary session's `created_at` and
  `last_activity_at`.
- `touch_diary_session()` (called on real user interaction, throttled to
  once/minute) extends the idle window but can never extend past the
  absolute `diary_max_lifetime_hours` cap — no amount of activity spam
  bypasses the hard limit.
- `is_diary_session_valid()` is a read-only check used inside every relevant
  RLS policy. Deciding whether to expose data does not itself extend the
  session.
- The chat session works the same way with its own (shorter) thresholds,
  with real "activity" defined narrowly as sending a message, matching a
  chat session's inherently short, conversational nature.
- **The frontend's countdown display is cosmetic.** Every actual data access
  is re-validated server-side; a stolen or replayed JWT past its idle window
  is rejected by Postgres regardless of what the client believes.

## Secret codes

- Generated server-side using `pgcrypto`'s `gen_random_bytes()` (OS-backed
  CSPRNG), 96 bits of entropy, formatted as dash-separated hex — not a
  guessable pattern.
- Only a SHA-256 hash is ever stored. Plaintext exists only in the single
  RPC response at generation time; never logged, never placed in a URL,
  never written to `localStorage`.
- Redemption is one atomic transaction checking hash match, expiry,
  revocation, and one-time use together, with a generic failure message
  ("invalid or expired code") that doesn't reveal which check failed.
- Brute force is primarily mitigated by the code's entropy plus rate
  limiting (both per-user and a global bucket, to blunt multi-account
  abuse) — not by the `max_attempts`/`attempt_count` columns, because an
  attacker who doesn't know the code can't cause a "near miss" against any
  specific row (lookup is by exact hash match). This reasoning is documented
  in `supabase/migrations/0006_secret_codes.sql`.

## Ephemeral chat

- Message "read" and "delete" are the same atomic SQL statement
  (`DELETE ... WHERE recipient_id = auth.uid() RETURNING ...`), not a
  mark-then-delete pair. Under two racing tabs, exactly one delete succeeds;
  the other returns nothing, silently and without error. Verified against a
  real migrated schema in `tests/db_tests.sql` (CHECK 5).
- **What this does NOT guarantee**: no copy ever existing anywhere. Browser
  memory, OS-level caches, screenshots, screen recordings, compromised
  devices, malicious browser extensions, and transient provider-side
  infrastructure logs are all outside this application's control. MindTrack
  minimizes persistence as much as is reasonably possible at the application
  layer; it does not and cannot claim messages are "impossible to recover."

## Rate limiting

- Supabase Auth's own configurable limits cover OTP send/verify.
- A generic `check_rate_limit()` Postgres function (fixed-window counter)
  covers every custom RPC this app adds: secret-code generation and
  redemption, chat message sending. Each is checked atomically as part of
  the same transaction that performs the action, not as a separate
  best-effort step.

## XSS and injection

- All diary/mood/chat content is rendered through React's default escaping.
  `dangerouslySetInnerHTML` is never used, and an ESLint rule
  (`react/no-danger`, set to `error`) enforces this automatically rather
  than relying on code review alone.
- All database access goes through the Supabase SDK / PostgREST, which
  parameterizes queries; no raw string concatenation into SQL exists
  anywhere in this codebase.
- Every text input has a server-side length limit (`CHECK` constraints or
  in-function validation), independent of the client-side Zod validation —
  the client-side checks are for user experience, not security.

## Dependency status

- `react-router-dom` was upgraded from v6 to v7 during Phase 3 specifically
  to resolve an open-redirect CVE (GHSA-wrjc-x8rr-h8h6) that has no v6 patch.
- `npm audit --omit=dev` — the dependencies actually shipped in the
  production bundle — reports **zero vulnerabilities**. Confirmed by
  inspecting the full production dependency tree (`npm ls --omit=dev --all`):
  neither `vite`, `vitest`, nor `esbuild` appear in it at all.
- The full `npm audit` (including dev tooling) currently reports 5 findings —
  1 critical, 1 high, 3 moderate — all of them in `vite`/`vitest`/`esbuild`
  and only reachable through the local development server or the Vitest UI
  server, never through the deployed static site:
  - Vite path-traversal in optimized-deps `.map` handling
  - Vite `server.fs.deny` bypass on Windows
  - `launch-editor` NTLMv2 hash disclosure (Windows-specific)
  - esbuild dev-server CORS issue (any website can read dev-server responses)
  - Vitest UI server arbitrary file read/execute when the UI server is running
  None of these require action for the deployed product; they matter only to
  whoever is running `npm run dev` or the Vitest UI locally, and only while
  those specific dev tools are open. Not fixed yet because the fix requires a
  Vite/Vitest major-version bump; tracked as a known, monitored dev-tooling
  issue. CI (`.github/workflows/ci.yml`) runs `npm audit --omit=dev` as a
  hard gate and the full `npm audit` as a non-blocking report, so a
  regression in production dependencies fails the build while dev-only
  findings stay visible without blocking every push.

## Privacy

- No analytics, no third-party trackers, no session replay, no advertising
  SDKs. Nothing is sent to any service other than Supabase and the chosen
  email provider (Brevo, for OTP delivery only).
- No service worker exists in this codebase, so there is no offline cache of
  sensitive responses to worry about.
- Diary/chat API responses are requested with the Fetch API's
  `cache: "no-store"` option, which tells the browser not to consult or
  populate its HTTP cache for these requests, independent of whatever
  caching headers Supabase's own responses might carry.

## GitHub Pages header limitation (an honest gap, not a workaround)

GitHub Pages cannot serve custom HTTP response headers. There is no way to
configure `Strict-Transport-Security`, `X-Content-Type-Options`,
`Permissions-Policy`, or a complete `Content-Security-Policy` from this
hosting target. The only mechanism available is a
`<meta http-equiv="Content-Security-Policy">` tag (see `frontend/index.html`),
which **cannot** express `frame-ancestors`, `report-uri`, or a `Strict-
Transport-Security` equivalent. This is a real, structural limitation of the
free hosting choice — not something this document pretends is otherwise
covered.

## Database backups

Supabase Free tier provides no downloadable backups and no point-in-time
recovery. Deleted data is not being reconciled against a backup because
there isn't one — this cuts both ways: nothing to restore from if a mistake
happens, but also nothing lingering in a backup after a deliberate deletion
either (aside from the residual-copy caveats already noted for ephemeral
chat, and standard operational logs on Supabase's own infrastructure that
this application has no visibility into or control over).

## Formal security review (Phase 9)

The formal OWASP Top 10 review and the hostile-reviewer question-by-question
pass are in `docs/security-review.md`. The single most important finding in
that review: a rate-limiting bypass was found by actually testing repeated
failed secret-code guesses against the real migrated schema (not by reading
the code), and fixed. That document also states plainly what a local
Postgres test suite cannot verify — real deployment behavior — rather than
letting the completed review imply more confidence than is warranted.
