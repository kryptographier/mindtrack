# MindTrack

A private, two-person journal application. Free to operate (Supabase Free +
GitHub Pages + GitHub Actions + Brevo free tier), security-focused, and
honest about its own limitations rather than overclaiming.

## Status: Phases 1–9 complete.

This was built and verified in phases, with real tests run at each step
rather than assumed correct from code review. Specifically:

- **Backend** (Postgres + RLS + Supabase Auth): every migration has been
  applied to a real local Postgres instance and exercised by
  `tests/db_tests.sql` — 24 assertions covering cross-user access,
  admin authorization, secret-code lifecycle (including a real rate-limiting
  bug found and fixed — see `docs/database.md`), chat session lifecycle, and
  injection/oversized-input safety. All currently pass.
- **Frontend** (React + TypeScript + Vite): typecheck, lint, unit tests
  (including a real rendering-based XSS-safety test), and production build
  all pass together.
- **CI** (`.github/workflows/ci.yml`): runs all of the above against a real
  Postgres service container on every push — not yet exercised against
  actual GitHub Actions infrastructure (only validated locally), so treat
  the first real CI run as itself a verification step, not a formality.
- **Deployment workflow** (`.github/workflows/deploy.yml`) and the daily
  keep-alive/cleanup schedules are written and YAML-validated, but **not yet
  run against a real Supabase project** — see "What's genuinely unverified"
  below.

## What's genuinely unverified

Being direct about this rather than letting phase-by-phase progress imply
more confidence than is warranted:

- **No real Supabase project has ever been created for this app.** Every
  backend test ran against a local Postgres instance with a hand-written
  stub of Supabase's `auth` schema (`tests/00_supabase_stub.sql`). This is
  good evidence the SQL is correct, but it is not the same as confirming
  behavior against Supabase's actual hosted Postgres, PostgREST version, and
  Auth service.
- **No RPC call has ever gone through a real PostgREST instance.** A
  parameter-casting question that came up during Phase 5 (documented
  honestly, including a partial self-correction, in `docs/database.md`)
  could not be fully resolved without one. The `int`/`uuid`/`text` parameter
  types used throughout are the standard, well-documented pattern — but "the
  first real smoke test against a live Supabase project" is still an
  outstanding action item, not a completed one.
- **Brevo SMTP delivery has never been tested end to end.** The architecture
  decision (Phase 1) is based on verified documentation about Brevo's free
  tier, not a live send.
- **The GitHub Pages SPA routing fix has never been deployed and clicked
  through on a real GitHub Pages URL.** It was fixed once already after an
  incorrect first attempt (Phase 3) using the canonical technique — but
  "canonical technique, applied correctly" and "confirmed working in
  production" are different claims. `docs/deployment.md` step 10 flags this
  as a specific thing to test immediately after first deploy.

- **Phase 9** (`docs/security-review.md`): a formal OWASP Top 10 review and
  a direct, question-by-question answer to every item in the original
  brief's hostile-reviewer checklist. Performed against this repository's
  actual code and test results — not a live deployment (see below).

## Not yet done at all

- An independent third-party security review. Phase 9's review was
  performed by reasoning about and testing this codebase against a local
  Postgres instance — thorough, but not a substitute for a second set of
  eyes that didn't write the code.
- Dark mode, accessibility audit pass (WCAG 2.2 AA), and responsive testing
  across the full breakpoint range are implemented per the design system
  but not yet systematically verified screen-by-screen.

## Where to start reading

1. `docs/architecture.md` — system design, and the verified free-tier
   constraints that shaped it (several assumptions in the original brief
   turned out to be wrong, and are corrected here with sources).
2. `docs/database.md` — schema, access model, and the bugs found while
   actually testing it.
3. `SECURITY.md` — what's protected, how, and the honest residual risks.
4. `docs/threat-model.md` — attack/impact/mitigation per threat category.
5. `docs/deployment.md` — the actual steps to stand this up, including
   which steps are deliberately manual rather than automated.

## Repository layout

```
frontend/           React + TypeScript + Vite app
supabase/
  migrations/       Ordered SQL migrations (the real backend)
  functions/        Edge Functions (keepalive, cleanup)
  config.toml       Per-function JWT verification settings
tests/
  00_supabase_stub.sql   Local stand-in for Supabase's auth schema
  db_tests.sql           Automated backend test suite
.github/workflows/  CI, deploy, and scheduled jobs
docs/               Architecture, database, deployment documentation
SECURITY.md         Security model and honest limitations
```
