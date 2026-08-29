# MindTrack — Database

Schema implemented in `supabase/migrations/0001`–`0006`, verified by running
every migration against a real Postgres instance with a stubbed `auth` schema
and exercising the security-critical paths (see `tests/db_tests.sql`
and the results below). This is not a theoretical schema — it has been run.

## Tables

| Table | Purpose | Client access |
|---|---|---|
| `profiles` | One row per user; holds the *only* authorization field (`role`) | SELECT own row only. No insert/update/delete — provisioned by trigger, role changed only by direct service-role SQL. |
| `app_settings` | Tunable thresholds (idle timeouts, max lifetimes) | None directly. Read via `get_setting_int()`, written via `admin_update_setting()`. |
| `session_activity` | Tracks each diary session's `created_at`/`last_activity_at` for app-level idle/max-lifetime enforcement | None directly. Read/written only via `touch_diary_session()` / `is_diary_session_valid()`. |
| `diary_entries` | Journal entries | Full CRUD, scoped to own rows + valid diary session. |
| `mood_entries` | Mood log | SELECT/INSERT/DELETE, scoped to own rows + valid diary session. No UPDATE — moods are logged, not edited. |
| `rate_limits` | Generic fixed-window counters for custom RPCs | None directly. Used internally by `check_rate_limit()`. |
| `secret_codes` | Admin-issued, hashed, one-time chat authorization codes | SELECT (admin only, via policy). No direct mutation — only via `admin_generate_secret_code()` / `admin_revoke_secret_code()` / `redeem_secret_code()`. |
| `chat_sessions` | Temporary chat sessions with their own expiry | SELECT (participants only). No direct mutation. |
| `ephemeral_messages` | Chat messages, deleted atomically on read | SELECT (participants + valid session only). No direct mutation — only via `send_message()` / `read_and_delete_message()` / `end_chat_session()`. |

## Why so many tables have *no* client-writable policy

This is deliberate, not an oversight. Every table where correctness depends on
several conditions being true **together** (ownership *and* session validity;
admin role *and* rate limit *and* code hash match) is written through a single
`SECURITY DEFINER` Postgres function that checks all of them atomically in one
transaction. If we exposed direct `INSERT`/`UPDATE` policies instead, we'd need
to express the same multi-condition logic in RLS `WITH CHECK` clauses, which is
harder to get right and easier to accidentally weaken later. Functions also let
us do things RLS can't: derive a message's `recipient_id` server-side instead
of trusting a client-supplied value, or roll a rate-limit check and a table
write into one atomic unit.

## RLS is necessary but not sufficient — the GRANT gap

Enabling `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and writing policies is
**not enough by itself**. Postgres checks base table privileges (`GRANT`)
*before* it ever evaluates a row-security policy — a role with RLS-permitting
policies but no `GRANT` still gets `permission denied`, and (more dangerously,
in the opposite misconfiguration) a role with a `GRANT` but a missing or overly
broad policy can see more than intended. Every migration in this repo now
explicitly grants the minimum privilege the `authenticated` role needs
(frequently `SELECT` only, with all writes forced through functions) — this was
caught by actually running the migrations against a test database rather than
assuming the SQL was correct by inspection; see the verification run below.

## A bug found during frontend integration (Phase 5) — and a correction

`admin_generate_secret_code()` originally took its expiry as a Postgres
`interval` parameter. An initial local test with a plain SQL string
(`'15 minutes'`) appeared to work; a second test, using a `PREPARE`/`EXECUTE`
with the parameter explicitly typed as `text` and no cast, failed. At the
time this was written up as "confirmed the interval parameter is broken."

That conclusion was **not fully justified**, and it's worth being honest about
why: PostgREST's own source shows it looks up each RPC parameter's real
Postgres type from `pg_proc` when the parameter name matches, and only
defaults to `text` for *unmatched* keys. That strongly suggests PostgREST
generates SQL with an explicit cast to the function's actual declared type —
closer to the first (dismissed) test than the second ("realistic") one. The
second test's `PREPARE(text)` forced a plain-`text` binding with no cast,
which may not accurately represent what PostgREST actually sends over the
wire. Confirming this precisely would require testing against a real
Supabase/PostgREST instance, which is not available in this environment.

**What we're keeping anyway:** the function parameter was changed from
`interval` to a plain `p_expires_in_minutes int`. This isn't reverted, because
an integer is unambiguous under *any* plausible binding strategy — it removes
the question entirely rather than resolving it by argument. But the original
`interval` version was not necessarily broken, and this section exists so a
future maintainer sees the actual state of the evidence rather than an
overconfident claim.

**Action item for deployment:** the first real smoke test against a live
Supabase project should specifically exercise a scalar RPC call with a
non-trivial parameter type (this codebase now avoids the question by using
`int`/`uuid`/`text` everywhere, but the underlying uncertainty about
PostgREST's cast behavior for less common types, like `interval` or arrays,
remains unresolved and worth confirming for future RPC parameters).

## Verification (not just written — run)

`tests/00_supabase_stub.sql` stubs the parts of Supabase's `auth` schema our
migrations depend on (`auth.users`, `auth.uid()`, `auth.jwt()`) so the real
migrations can be applied to a plain local Postgres and exercised.
`tests/db_tests.sql` is the automated backend test suite: every check uses a
`test_assert()` helper that raises (non-zero exit) on failure, so CI can gate
on the exit code rather than a human reading NOTICE output. It covers
authorization (cross-user access, role manipulation, admin RPC gating),
secret codes (valid/reused/bogus/expired/revoked/rate-limited), chat
(session creation, unauthorized participants, expiration, the
duplicate-read race), diary session expiration, and security (injection-safe
storage, oversized input, malformed UUIDs, service-role-only cleanup).

This suite is what caught a real, significant bug during Phase 7: repeated
invalid secret-code guesses never actually triggered the rate limit, because
`redeem_secret_code()` raised an exception for invalid codes, and an
uncaught exception rolls back the *entire* transaction — including the
`check_rate_limit()` increment that had just happened moments earlier in the
same call. Every failed guess was silently erasing its own rate-limit count.
Both `redeem_secret_code()` and `send_message()` were restructured to return
an `error_message` column for expected failures instead of raising, so the
transaction commits normally and the rate-limit bookkeeping actually
persists. See the comments in `supabase/migrations/0006_secret_codes.sql`
and `0005_chat_sessions_and_messages.sql` for the full explanation. This is
exactly the kind of bug that reading the code would not have caught —
running repeated failed attempts against the real migrated schema is what
surfaced it.

This suite runs in CI (`.github/workflows/ci.yml`) against a real Postgres
service container on every push, not just locally during development.

## Data lifecycle notes

- **Diary/mood entries** persist until the user deletes them. Deletion is a
  normal `DELETE`, subject to the caveats in `SECURITY.md` about Supabase Free
  tier having no downloadable backups (nothing to reconcile against, but also
  no safety net).
- **Secret codes**: plaintext exists only in the return value of
  `admin_generate_secret_code()` for a single call — never persisted, never
  logged. The stored `code_hash` is useless without the original plaintext.
- **Ephemeral messages**: a message row's entire lifetime is from `send_message()`
  to the recipient's next `read_and_delete_message()` call, or until
  `end_chat_session()` purges anything unread. There is no soft-delete state —
  once gone, the row is gone from this database. (Residual-copy caveats — browser
  memory, provider-side transient logs — are documented in `SECURITY.md`, not
  claimed away here.)
- **Session activity / rate limit rows**: cleaned up daily by
  `cleanup_expired_records()` (migration 0007), invoked via the `cleanup`
  Edge Function on a GitHub Actions schedule (`.github/workflows/cleanup.yml`).
  Restricted to `service_role` — no authenticated user, including the admin,
  can trigger it through the client API. Diary entries, mood entries, and
  profiles are never touched by this job.
