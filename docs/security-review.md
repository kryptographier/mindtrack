# MindTrack — Phase 9 Security Review

Two things live in this document: a formal walk through the OWASP Top 10
(2021 edition, the current stable list), and a direct answer to every
question in the original brief's hostile-reviewer checklist. Both are
answered against what has actually been built and tested in this repository
— not what was intended, and not "should be fine." Where something hasn't
been verified against a real Supabase project, that's stated plainly rather
than implied to be covered.

## OWASP Top 10 (2021) review

### A01: Broken Access Control
**Risk:** A user reading, modifying, or deleting another user's data; a
non-admin performing admin actions.
**Mitigation:** RLS enabled with default-deny policies on every table
containing user data (`supabase/migrations/0001`–`0006`). Ownership is
always derived from `auth.uid()` server-side, never a client-supplied field.
Admin checks (`is_admin()`) read a `role` column with no client-writable
path at all.
**Verified:** `tests/db_tests.sql` — cross-user SELECT/UPDATE/DELETE all
confirmed blocked; non-admin blocked from `admin_generate_secret_code()`,
`admin_revoke_secret_code()`, `admin_update_setting()`; direct role
self-promotion confirmed blocked.
**Residual risk:** RLS policy bugs are the single highest-impact failure
mode in this architecture, since there's no other access-control layer
behind it. Every policy has a corresponding negative test, but that test
suite is not exhaustive against every possible query shape.

### A02: Cryptographic Failures
**Risk:** Secrets stored in recoverable form; weak randomness; sensitive
data in transit unencrypted.
**Mitigation:** No passwords exist anywhere in this system. Secret codes are
hashed with SHA-256 before storage (`digest(code, 'sha256')`); only the hash
is ever persisted. Code generation uses `gen_random_bytes()`
(`pgcrypto`, OS-backed CSPRNG), not `random()` or any predictable source.
Supabase enforces HTTPS/TLS for all API traffic; GitHub Pages serves over
HTTPS by default.
**Verified:** Code generation and hashing logic tested directly; a
guessed/bogus code is provably rejected (`tests/db_tests.sql`).
**Residual risk:** GitHub Pages cannot serve `Strict-Transport-Security`
(see below, and `SECURITY.md`) — HTTPS is used, but HSTS enforcement is not
configurable from this hosting target.

### A03: Injection
**Risk:** SQL injection via user-supplied content.
**Mitigation:** All database access goes through the Supabase SDK /
PostgREST / parameterized `plpgsql` functions. No raw string concatenation
into SQL exists anywhere in this codebase.
**Verified:** `tests/db_tests.sql` inserts a SQL-injection-shaped payload
(`'; DROP TABLE public.diary_entries; --`) as diary content and confirms
both that it's stored as literal text and that the table still exists
afterward.
**Residual risk:** Low. This class of bug would require introducing raw SQL
string-building somewhere, which the current codebase never does.

### A04: Insecure Design
**Risk:** A security property that was never designed in, only patched on.
**Mitigation:** Session expiration, secret-code lifecycle, and ephemeral
message deletion were all designed server-side from the start (see
`docs/architecture.md`), specifically because Supabase's Pro-only idle
timeout feature was identified as a gap *during planning*, not discovered
late.
**Verified:** See A01, and the session-expiration and chat-lifecycle tests
in `tests/db_tests.sql`.
**Residual risk:** The rate-limiting rollback bug (see A07 and
`docs/database.md`) is a concrete example of a *design* gap that testing
caught, not a late patch — it's listed here as evidence the process worked,
not swept under "insecure design doesn't apply to us."

### A05: Security Misconfiguration
**Risk:** Defaults left in an unsafe state (verbose errors, permissive
CORS, exposed admin interfaces).
**Mitigation:** Error messages are generic everywhere client-facing
(`toFriendlyError()` in every frontend service file; deliberately generic
Postgres exception messages like `'invalid or expired code'`). A real,
concrete misconfiguration was caught and fixed during Phase 7: Supabase Edge
Functions default to requiring a JWT (`verify_jwt = true`), and the
`keepalive` function's scheduled caller sends none — this would have 401'd
silently in production. Fixed via `supabase/config.toml`.
**Verified:** Confirmed via Supabase's own documentation (Aug 2026); the fix
is in place, but the *actual* scheduled call has never run against a real
deployed function (see "What's genuinely unverified" in `README.md`).
**Residual risk:** Real. This class of bug — "looks right, never actually
invoked against the real service" — is exactly why the README's unverified
section exists and isn't cosmetic.

### A06: Vulnerable and Outdated Components
**Risk:** Shipping a dependency with a known CVE.
**Mitigation:** `react-router-dom` was upgraded v6→v7 specifically to
resolve an open-redirect CVE with no v6 patch. `npm audit --omit=dev`
reports zero vulnerabilities in the actual shipped bundle. CI
(`.github/workflows/ci.yml`) runs this on every push as a hard gate.
**Verified:** `npm ls --omit=dev --all` confirms `vite`/`vitest`/`esbuild`
(the source of the remaining dev-only findings) don't appear in the
production dependency tree at all.
**Residual risk:** Dependency status is a snapshot in time; CI re-checks on
every push, but nothing re-checks a dependency that silently gains a new CVE
between pushes. Acceptable for a two-person app; would need a scheduled
audit job at larger scale.

### A07: Identification and Authentication Failures
**Risk:** Weak session handling, ineffective rate limiting, brute-forceable
credentials.
**Mitigation:** Passwordless email OTP via Supabase Auth. Application-level
idle/max-lifetime session enforcement (since the Pro feature isn't
available) verified server-side on every request, not just at login. Secret
codes have 96 bits of entropy plus rate limiting.
**Verified — and this is the most important line in this whole review:**
the rate limiter was **tested and found broken**, then fixed. Repeated
failed secret-code guesses against the real migrated schema showed the
limit never engaged, because the original `redeem_secret_code()` raised an
exception for invalid codes, which rolled back the *entire* transaction —
including the rate-limit counter increment that had happened moments
earlier in the same call. Fixed by returning an `error_message` field
instead of raising, so the transaction commits and the counter persists.
Re-verified: 10 repeated bad guesses now correctly trigger
`'too many attempts, please wait before trying again'`
(`tests/db_tests.sql`). This is flagged prominently because it's exactly the
kind of bug that passes a code review and fails only under actual
adversarial testing.
**Residual risk:** OTP delivery itself (via Brevo) has never been tested
against a real inbox — see `README.md`.

### A08: Software and Data Integrity Failures
**Risk:** Unsigned/unverified updates, insecure deserialization, CI/CD
pipeline compromise.
**Mitigation:** No custom deserialization anywhere (Supabase SDK/PostgREST
handles all serialization). CI installs dependencies via `npm ci` (uses the
lockfile exactly, no version drift) rather than `npm install`.
**Verified:** N/A — this category is largely about supply-chain integrity,
which for a project this size reduces to "use lockfiles and don't run
unpinned scripts," which is already the case.
**Residual risk:** GitHub Actions' own supply chain (the action versions
pinned in the workflows, e.g. `actions/checkout@v4`) is trusted as-is; no
additional pinning to commit SHAs was done, which is a reasonable tradeoff
at this scale but a stricter posture would pin further.

### A09: Security Logging and Monitoring Failures
**Risk:** No visibility into attacks in progress; sensitive data leaking
into logs.
**Mitigation:** Explicitly documented as *not logging* message contents,
diary contents, OTPs, passwords, or secret codes anywhere (`SECURITY.md`,
and no code path in this repo writes any of those to a log). Supabase's own
platform-level logs (Edge Function invocation logs, Auth logs) exist
independent of this application.
**Verified:** Manual code review confirms no `console.log`/`raise notice`
of sensitive values anywhere in the codebase (the only `raise notice` calls
are in test files, logging test outcomes, never user content).
**Residual risk:** This is the weakest-covered OWASP category for this
project, honestly. There is no active *monitoring* or alerting — a two-person
app with $0 budget has no equivalent of a SIEM, and building one would
violate the "don't overengineer" constraint. The residual risk is real:
an ongoing attack would only be noticed if it caused a visible symptom
(rate-limit errors, a paused Supabase project), not through active
detection.

### A10: Server-Side Request Forgery (SSRF)
**Risk:** The server making an attacker-controlled outbound request.
**Mitigation:** This application makes no outbound HTTP requests based on
user input anywhere. The `cleanup` and `keepalive` Edge Functions call fixed,
hardcoded Supabase RPCs; the frontend calls a fixed Supabase URL. Brevo SMTP
is configured server-side in the Supabase dashboard, not driven by any
request parameter.
**Verified:** N/A by construction — there's no code path that takes a URL
from user input and fetches it.
**Residual risk:** Essentially none, given the architecture.

---

## Hostile-reviewer pass

Answering each question from the original brief directly.

**Can an unauthenticated attacker access diary data?**
No. RLS requires `auth.uid()` to match `user_id`; an unauthenticated request
has no `auth.uid()` at all, so it matches nothing. Verified in
`tests/db_tests.sql`.

**Can User A access User B's diary? Modify it? Delete it?**
No to all three. Verified directly (`tests/db_tests.sql`): cross-user
SELECT returns zero rows, UPDATE affects zero rows, DELETE affects zero
rows, and existence checks via a privileged role confirm the target row is
genuinely untouched in all three cases.

**Can User A set `is_admin=true` (or otherwise modify their own role)?**
No. `profiles` has no client-writable INSERT/UPDATE/DELETE policy at all.
Verified: a direct `UPDATE public.profiles SET role = 'admin'` as the
non-admin user is rejected (permission denied), and the role is confirmed
unchanged afterward.

**Can an attacker brute-force secret codes?**
Meaningfully throttled, not eliminated. 96 bits of entropy makes guessing
infeasible on its own; rate limiting (5 attempts/15 min per user, 20/hour
global) was tested and — after the fix described under A07 above — actually
engages. An attacker would first need a valid authenticated session, which
itself requires passing Supabase Auth's own OTP verification.

**Can an expired secret code be reused? A revoked code? Can a code be
replayed?**
No to all three, verified directly: expired codes, revoked codes, and
already-used codes are all rejected with the same generic
`'invalid or expired code'` message (deliberately not distinguishing which
condition failed).

**Can an expired chat session retrieve or send messages?**
No. `is_chat_session_valid()` and `send_message()`'s internal check both
reject expired sessions; verified by back-dating a session's `expires_at`
and confirming both the validity check and a subsequent send attempt are
rejected.

**Can deleted messages be retrieved? Can two tabs resurrect a deleted
message?**
No. `read_and_delete_message()` is a single atomic `DELETE ... RETURNING`;
verified directly that a second, racing call against the same message ID
returns nothing (not an error, not the message again).

**Can XSS execute through diary or chat content?**
No, verified by actually rendering a malicious payload
(`<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`) through the
real `JournalPage` component and confirming it appears only as escaped text
in the DOM, with no real `<script>` or `<img>` element created
(`frontend/src/pages/JournalPage.xss.test.tsx`).

**Can database injection occur?**
No, verified by inserting an injection-shaped payload as diary content and
confirming the table still exists and the payload is stored as literal
text, not executed.

**Are private values stored in URLs?**
No. OTP verification uses a code entered into a form field, not a magic-link
query parameter (Section 13 of the original brief was followed exactly for
this reason). Secret codes are entered into a form field. No code path in
this repo constructs a URL containing a token, code, or content.

**Are secrets exposed in the frontend bundle?**
No — verified directly by grepping the actual built `dist/` output for
`service_role`/`SERVICE_ROLE` and confirming zero matches, both locally and
as an automated CI/deploy step (`.github/workflows/ci.yml` and `deploy.yml`).

**Are service-role keys exposed anywhere the browser can reach?**
No. The service-role key exists only as a Supabase Edge Function secret,
read via `Deno.env.get(...)` inside the `cleanup` function, never passed to
or derivable by the frontend.

**Are secrets in Git?**
`.gitignore` excludes `.env` and related files. A CI job
(`secret-scan` in `ci.yml`) greps every tracked file for common secret
patterns and confirms `.env` is never tracked. Verified locally by
initializing a real git repo and running the exact scan against this
codebase.

**Are private responses cached?**
Mitigated via the Fetch API's `cache: "no-store"` option on every Supabase
request (`frontend/src/lib/supabaseClient.ts`) — and this is flagged
honestly as a *correction*: an earlier attempt used a request-side
`Cache-Control` header, which has no actual effect on browser caching
(caching is governed by the response, not the request). Fixed to use the
option that actually works.

**Can error messages reveal sensitive information?**
No client-facing error in this codebase exposes a raw Postgres error,
schema detail, or stack trace — every service-layer function scrubs errors
to a generic message before returning them to the UI.

**Can the admin API be called by a normal user?**
No — every admin-gated RPC independently re-checks `is_admin()` server-side,
verified directly for `admin_generate_secret_code()`,
`admin_revoke_secret_code()`, and `admin_update_setting()`.

**Can the chat API be abused (spam, flooding)?**
Rate-limited (`send_message()`, 30 messages/minute per user), and — same
fix as the secret-code rate limiter — restructured to return rather than
raise on failure, so the limit's own bookkeeping isn't erased by later
validation failures in the same call.

**Can rate limits be bypassed trivially?**
Not trivially. The specific bypass that *was* trivially possible (the
rollback bug) has been found and fixed. A determined attacker with multiple
disposable accounts could still spread load across the global bucket up to
its own limit — documented as a known, bounded residual risk, not claimed
away.

## What Phase 9 did not do

This review was performed by reasoning about and testing the code in this
repository against a local Postgres instance. It was **not** performed
against a live, deployed Supabase project, a real GitHub Pages deployment,
or by an independent third-party security reviewer. Those remain genuinely
open items — see `README.md`'s "What's genuinely unverified" section, which
this document does not repeat but fully endorses.
