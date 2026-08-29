# MindTrack — Deployment Guide

Every step below is compatible with the $0 requirement. Where a step has a
free-tier caveat, it's called out inline rather than left as a surprise.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign up, create a **new
   organization** and a **new project** on the **Free** plan.
2. Note the **Project URL** and **anon/public key** (Settings → API) — these
   are public by design and go into the frontend's `.env`.
3. Note the **service-role key** from the same page — this is a genuine
   secret. It is used only for the `cleanup` Edge Function's environment,
   never the frontend, never committed to git.

## 2. Configure authentication (Email OTP)

1. Dashboard → Authentication → Sign In / Providers → Email: ensure **Email
   OTP** is enabled (it is by default). Leave password-based sign-in off —
   this app never uses it.
2. Dashboard → Authentication → Emails → Templates → edit the **Magic Link**
   template to include `{{ .Token }}` so users receive a 6-digit code rather
   than a clickable link (see `docs/architecture.md` section 4).
3. Dashboard → Authentication → Rate Limits: review the defaults; the
   built-in OTP send/verify limits are sufficient for two users and don't
   need to be loosened.

## 3. Configure custom SMTP (Brevo)

Supabase's own default sender only delivers to organization members and is
capped at ~2 emails/hour — not usable for two independent real users (see
`docs/architecture.md` section 3 for why Resend's no-domain option doesn't
work here either).

1. Create a free [Brevo](https://www.brevo.com) account (300 emails/day,
   permanent free tier, no card required).
2. In Brevo, add and verify a **sender email address** you control (a plain
   inbox — no domain needed) via the 6-digit code Brevo emails to it.
3. In Brevo, get your SMTP credentials (Settings → SMTP & API).
4. Supabase Dashboard → Authentication → Emails → SMTP Settings: enable
   custom SMTP, enter Brevo's host/port/username/password, and set the
   "From" address to the sender you verified in step 2.
5. Send yourself a test OTP to confirm delivery before moving on.

## 4. Apply database migrations

Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies every file in `supabase/migrations/` in order. Verify in the
Table Editor that `profiles`, `diary_entries`, `mood_entries`, `secret_codes`,
`chat_sessions`, `ephemeral_messages`, `app_settings`, `session_activity`, and
`rate_limits` all exist, and that RLS shows as enabled on each.

## 5. Promote the admin account — a manual, deliberate step

There is no signup flow, button, or API endpoint that grants the admin role —
by design (see `SECURITY.md`). After both people have signed in at least
once (so their `profiles` rows exist), run this **once**, directly in the
Supabase SQL Editor, logged in as the project owner:

```sql
update public.profiles set role = 'admin' where email = 'the-admin-persons-email@example.com';
```

Everyone else remains `role = 'user'` by default.

## 6. Deploy the Edge Functions

```bash
supabase functions deploy keepalive
supabase functions deploy cleanup
supabase secrets set CLEANUP_SECRET=$(openssl rand -hex 32)
```

Save the generated `CLEANUP_SECRET` value — you'll need the same value again
in step 8.

## 7. Configure the frontend's environment

Copy `.env.example` to `frontend/.env` and fill in the **public** values only
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) for local development. This
file is gitignored and never committed.

## 8. Create the GitHub repository and configure secrets/variables

1. Push this repository to a new GitHub repo.
2. Settings → Secrets and variables → Actions → **Variables** tab, add:
   - `SUPABASE_PROJECT_URL` — your project's URL (public, so a variable, not
     a secret)
   - `SUPABASE_ANON_KEY` — your project's anon/public key (also public by
     design — see `docs/architecture.md`). Used by `.github/workflows/deploy.yml`
     to build the frontend.
3. Settings → Secrets and variables → Actions → **Secrets** tab, add:
   - `CLEANUP_SECRET` — the exact same value generated in step 6

## 9. Enable GitHub Pages

1. Settings → Pages → Source: **GitHub Actions**.
2. The deploy workflow (added in a later step, if not already present)
   builds the frontend with `VITE_BASE_PATH=/<your-repo-name>/` so the app
   resolves correctly at `https://<you>.github.io/<repo-name>/` — see the
   GitHub Pages SPA routing notes in `frontend/index.html` and
   `frontend/public/404.html`.

## 10. Deploy and test

1. Push to `main`. `.github/workflows/ci.yml` runs lint/typecheck/tests/build
   automatically. Confirm it passes.
2. Once deployed, open the live GitHub Pages URL and:
   - Sign in with each person's real email; confirm the OTP arrives via
     Brevo and login succeeds.
   - Create a diary entry, log a mood, confirm both persist after a refresh.
   - As the admin, generate a secret code (Settings page); as the other
     user, redeem it (Settings → "Have a code? Enter private chat") and
     confirm the terminal chat works both directions.
   - **Specifically test a direct navigation/refresh on `/journal`,
     `/mood`, and `/settings`** — this is exactly the GitHub Pages SPA
     routing fix from Phase 3, and it's cheap to verify once but expensive
     to debug blind later if it silently regressed.

## 11. Confirm the keep-alive and cleanup schedules

Both `.github/workflows/keepalive.yml` and `.github/workflows/cleanup.yml`
run on a daily cron once merged to `main`. You can also trigger either
manually from the Actions tab (`workflow_dispatch`) right after deployment
to confirm they succeed rather than waiting a full day to find out.

## What's intentionally not automated

Migration deployment (`supabase db push`) and the admin-promotion SQL are
deliberately manual steps, not part of CI/CD. Automating them would require
storing a Supabase database password or an equally privileged token in
GitHub Actions secrets for a two-person app — added attack surface without
a corresponding benefit at this scale (see the "don't overengineer"
principle in `docs/architecture.md`).
