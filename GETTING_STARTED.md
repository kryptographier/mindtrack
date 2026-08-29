# Getting MindTrack online — a beginner's walkthrough

This guide assumes you have never used a terminal, git, or any of these
services before. It will take somewhere between 1 and 2 hours the first
time, mostly waiting for accounts to verify and pages to load. Every step
tells you exactly what to click or type and what you should see happen.

If you get stuck, check the **Troubleshooting** section at the very bottom
before trying again — the most common snags are listed there.

You will end up with:
- A live website (free) that you and one other person can use as a private
  journal
- A backend database (free) that only the two of you can access
- Automatic emails (free) for signing in

---

## What you'll need before starting

- A computer (Mac or Windows both work)
- An email address for yourself, and one for the other person
- About an hour where you can focus

You do **not** need to know how to code. You will copy and paste commands
exactly as shown.

---

## Part 1 — Install the tools

### 1.1 Install Node.js

Node.js lets your computer run the JavaScript tools this project needs.

1. Go to [nodejs.org](https://nodejs.org)
2. Click the big green button that says **LTS** (this means "long-term
   support" — the stable version)
3. Open the file you downloaded and click through the installer, accepting
   the defaults
4. When it's done, you need to open a **terminal** to check it worked:
   - **Mac**: press `Cmd + Space`, type `Terminal`, press Enter
   - **Windows**: press the Windows key, type `PowerShell`, press Enter
5. In the terminal window that opens, type this and press Enter:
   ```
   node --version
   ```
6. You should see something like `v22.x.x`. If you see an error instead,
   restart your computer and try again — this fixes it almost every time.

### 1.2 Install Git

Git is the tool that manages the project's code and lets you send it to
GitHub (a website that will host your code).

1. Go to [git-scm.com/downloads](https://git-scm.com/downloads)
2. Download the version for your operating system and install it, accepting
   all the defaults
3. In your terminal, type:
   ```
   git --version
   ```
4. You should see something like `git version 2.x.x`

**If you're on Windows:** installing Git also installs a program called
**Git Bash** — search for it in your Start menu. From here on, use Git Bash
instead of PowerShell for every command in this guide. It behaves the same
way as the Mac terminal and includes a tool (`openssl`) you'll need in
Part 6 that plain PowerShell doesn't have.

---

## Part 2 — Get an account on each service

You'll need four free accounts. Create all of them now so you're not
switching back and forth later.

### 2.1 GitHub (hosts your code and your website)

1. Go to [github.com](https://github.com) and click **Sign up**
2. Follow the prompts (email, password, username)
3. Once signed in, you'll see a dashboard — that's all you need for now

### 2.2 Supabase (your database and login system)

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign up — the easiest way is "Continue with GitHub" since you just made
   that account
3. You'll land on a dashboard listing your "organizations" — that's normal

### 2.3 Brevo (sends the login emails)

1. Go to [brevo.com](https://www.brevo.com) and sign up for a free account
2. You do **not** need a credit card
3. Verify your email address when Brevo asks you to (check your inbox)

### 2.4 Get the MindTrack code

1. Extract the `mindtrack.zip` file you were given, somewhere easy to find
   like your Desktop or Documents folder
2. In your terminal, navigate into it. Replace the path below with wherever
   you actually put it:
   ```
   cd Desktop/mindtrack
   ```
   (Tip: you can type `cd ` then drag the folder into the terminal window,
   and it will fill in the path for you.)

---

## Part 3 — Set up Supabase (your database)

### 3.1 Create the project

1. In Supabase, click **New project**
2. Give it a name like `mindtrack`
3. Generate a strong database password when asked — **save this somewhere**,
   like a password manager or a note you won't lose. You'll need it once
   more in Part 5.
4. Choose the region closest to you
5. Click **Create new project** and wait a minute or two while it sets up

### 3.2 Get your project's public keys

1. Once the project is ready, click the **Settings** gear icon (bottom
   left), then **API**
2. You'll see a **Project URL** (looks like `https://something.supabase.co`)
   — copy this somewhere
3. You'll see an **anon public** key (a long string of letters/numbers) —
   copy this too

These two values are meant to be public — don't worry about keeping them
secret, but you will need to type them in exactly, so copy carefully.

### 3.3 Turn on email sign-in with a code (not a link)

1. In the left sidebar, click **Authentication**, then **Sign In / Providers**
2. Find **Email** and make sure it's turned on (it usually is by default)
3. Click **Authentication** → **Emails** → **Templates**
4. Click on the **Magic Link** template
5. Find the button/link part of the template and change it so it shows
   `{{ .Token }}` instead of a link — this makes people receive a 6-digit
   code instead of a clickable link, which is what this app expects
6. Click **Save**

---

## Part 4 — Set up Brevo (sending emails)

Supabase's own free email sending is too limited for two separate people, so
we'll use Brevo instead — still completely free.

### 4.1 Verify a sender email address

1. In Brevo, go to **Settings** (top right, your account icon) → **Senders,
   Domains & Dedicated IPs**
2. Click **Add a sender**
3. Enter a name (e.g. "MindTrack") and an email address you personally
   control — this can be your regular Gmail address, it doesn't need to be
   a special domain
4. Brevo sends a 6-digit code to that email — check your inbox and enter it
   to verify

### 4.2 Get your SMTP credentials

1. Still in Brevo, go to **Settings** → **SMTP & API**
2. Click the **SMTP** tab
3. You'll see a **Login** (looks like an email address) and you can generate
   an **SMTP key** (click **Generate a new SMTP key**, give it a name, and
   copy the key it shows you — you can't see it again later, so copy it now)

### 4.3 Connect Brevo to Supabase

1. Back in Supabase: **Authentication** → **Emails** → scroll to **SMTP
   Settings**
2. Turn on **Enable Custom SMTP**
3. Fill in:
   - **Sender email**: the address you verified in step 4.1
   - **Sender name**: MindTrack
   - **Host**: `smtp-relay.brevo.com`
   - **Port**: `587`
   - **Username**: the SMTP login from step 4.2
   - **Password**: the SMTP key from step 4.2
4. Click **Save**

### 4.4 Test it

1. Still in Supabase, find a way to send a test OTP — the easiest way is to
   wait until Part 9 when the real app is running and try signing in with
   your own email
2. If it doesn't arrive within a minute, check your spam folder first

---

## Part 5 — Load the database structure

This step takes the empty Supabase project and creates all the tables
(diary entries, moods, etc.) the app needs.

### 5.1 Install the Supabase command-line tool

In your terminal:
```
npm install -g supabase
```
Wait for it to finish (a minute or so).

### 5.2 Log in

```
supabase login
```
This opens your browser — click **Authorize** there, then come back to the
terminal.

### 5.3 Find your project reference

1. In the Supabase dashboard, go to **Settings** → **General**
2. Copy the **Reference ID** (a short string of letters/numbers)

### 5.4 Link and push

In your terminal, still inside the `mindtrack` folder:
```
supabase link --project-ref PASTE-YOUR-REFERENCE-ID-HERE
```
It will ask for the database password you saved in step 3.1 — paste it in.

Then:
```
supabase db push
```
You'll see a list of migration files scroll by. When it finishes without a
red error message, your database is ready.

**How to check it worked:** in the Supabase dashboard, click **Table
Editor** on the left. You should see tables named `profiles`,
`diary_entries`, `mood_entries`, `secret_codes`, `chat_sessions`, and a few
others.

---

## Part 6 — Deploy the two small background functions

These are two tiny helper programs: one keeps the free database from
"falling asleep," the other tidies up old data automatically.

In your terminal:
```
supabase functions deploy keepalive
supabase functions deploy cleanup
```

Now create a secret password for the cleanup function to use. Run this to
generate a random one:
```
openssl rand -hex 32
```
Copy whatever it prints out, then run (pasting that value in place of the
placeholder below):
```
supabase secrets set CLEANUP_SECRET=paste-the-random-value-here
```
**Write this value down** — you'll need the exact same one again in Part 8.

---

## Part 7 — Make one of you the admin

One person needs to be able to generate the codes that let the two of you
open the private chat. This step has to be done by hand, on purpose — the
app deliberately has no button anywhere that can create an admin account,
for security reasons.

**Come back to this step after Part 9**, once the site is live and you've
both signed in at least once — the admin-promotion command needs your
account to already exist.

1. In the Supabase dashboard, click **SQL Editor** on the left
2. Click **New query**
3. Paste this in, replacing the email with the actual admin person's email:
   ```sql
   update public.profiles set role = 'admin' where email = 'the-admin-persons-email@example.com';
   ```
4. Click **Run**
5. You should see "Success, 1 row affected"

---

## Part 8 — Put the code on GitHub

### 8.1 Create a new repository

1. On GitHub, click the **+** icon (top right) → **New repository**
2. Name it `mindtrack` (or anything you like)
3. Leave it **Private** if you want only the two of you to see the source
   code (this doesn't affect whether the *website* is public — it will be)
4. Don't check any of the boxes about README/gitignore
5. Click **Create repository**

### 8.2 Send your code there

GitHub will show you some commands after creating the repo. In your
terminal, inside the `mindtrack` folder, type these one at a time (replace
the URL with the one GitHub shows you):
```
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/mindtrack.git
git push -u origin main
```
The first time, it may open a browser window asking you to sign in to
GitHub to confirm — do that, then come back to the terminal.

**How to check it worked:** refresh the GitHub page for your repository —
you should see all the project's files and folders listed.

### 8.3 Add your secret values to GitHub

1. On your repository's GitHub page, click **Settings** (top, not your
   account settings — the repository's own settings)
2. In the left sidebar: **Secrets and variables** → **Actions**
3. Click the **Variables** tab, then **New repository variable**, and add
   two of these, one at a time:
   - Name: `SUPABASE_PROJECT_URL` — Value: the Project URL from step 3.2
   - Name: `SUPABASE_ANON_KEY` — Value: the anon public key from step 3.2
4. Click the **Secrets** tab, then **New repository secret**, and add:
   - Name: `CLEANUP_SECRET` — Value: the exact same random string you made
     up in Part 6

### 8.4 Turn on GitHub Pages

1. Still in repository **Settings**, click **Pages** in the left sidebar
2. Under **Source**, choose **GitHub Actions**
3. That's it — nothing to save, it takes effect immediately

---

## Part 9 — Watch it deploy

1. On your repository's GitHub page, click the **Actions** tab
2. You should see workflows running or queued (they started automatically
   when you pushed in step 8.2)
3. Click into the one called **Deploy to GitHub Pages** and watch it — a
   green checkmark means success, a red X means something went wrong (see
   Troubleshooting below)
4. Once it's green, go back to **Settings** → **Pages** — you'll see a
   message like "Your site is live at `https://your-username.github.io/mindtrack/`"
5. Open that link — you should see the MindTrack login screen

---

## Part 10 — Try it out

1. Enter your email, click **Send code**
2. Check your inbox (and spam folder) for a 6-digit code from the address
   you set up in Brevo
3. Enter the code, click **Verify**
4. You should land on the (empty) journal page
5. Have the other person do the same with their email
6. Now go back to **Part 7** above and run the admin SQL command for
   whichever of you should be the admin
7. As the admin: go to **Settings**, generate a private chat code, and send
   it to the other person through some other channel (text message, etc.)
8. As the other person: go to **Settings** → "Have a code? Enter private
   chat", type it in, and confirm the terminal-style chat works

**One more specific thing to test:** while on the Journal page, press your
browser's refresh button. It should reload the Journal page correctly, not
show a "404 Not Found" error. Do the same on the Mood and Settings pages.
This specifically checks that GitHub Pages is handling the app's internal
navigation correctly.

---

## Troubleshooting

**"command not found" when typing `node`, `git`, or `supabase`**
Close your terminal window completely and open a new one — the tools
sometimes need a fresh terminal to be recognized after installing.

**The login email never arrives**
Double-check Part 4.3 — the SMTP username/password are easy to mix up with
your regular Brevo login. Check the spam folder. In Brevo, go to
**Transactional** → **Logs** to see if it actually tried to send and what
error (if any) it got.

**GitHub Actions shows a red X**
Click into the failed step to see the error message. The most common cause
is a typo in one of the repository variables/secrets from step 8.3 — check
those values character-by-character against Part 3.2 and Part 6.

**The site loads but refreshing any page other than the homepage shows a
404 error**
This means the GitHub Pages routing fix isn't active — double check that
`Settings → Pages → Source` is set to **GitHub Actions** (step 8.4), not
"Deploy from a branch."

**`supabase db push` shows an error about the password**
You'll need the *database* password from step 3.1, not your Supabase
account password — they're different things. If you've genuinely lost it,
you can reset it from **Settings** → **Database** in the Supabase dashboard.

**Nothing happens after "Send code" and there's no error either**
Open your browser's developer console (right-click the page → Inspect →
Console tab) and look for a red error message. Check that
`SUPABASE_PROJECT_URL` and `SUPABASE_ANON_KEY` (step 8.3) exactly match what
Supabase shows you (step 3.2) — a single missing character is the most
common cause.

---

## You're done

From here on, the two daily background jobs (keeping the database awake and
cleaning up old data) run automatically — you don't need to do anything.
If you ever want to change something in the app, edit the code, then run:
```
git add -A
git commit -m "describe what you changed"
git push
```
and GitHub will automatically rebuild and redeploy the site.
