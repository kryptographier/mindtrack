# MindTrack — Threat Model

Status: Phase 1 draft. Mitigations described here will be implemented and
tested in Phases 2–7; this document will be updated if implementation reveals
a gap between design and reality.

For each threat: **Attack → Impact → Mitigation → Residual risk.**

## 1. Unauthenticated attacker
- **Attack:** Direct calls to Supabase REST/RPC endpoints without a valid session.
- **Impact:** Could read/write any table if RLS were missing or misconfigured.
- **Mitigation:** RLS enabled on every table containing user data; default-deny
  policies; anon key alone grants no row access without a valid `auth.uid()`.
- **Residual risk:** A policy bug could still leak data; mitigated by explicit
  cross-user access tests in CI (Phase 8), not eliminated by design alone.

## 2. Authenticated malicious/curious user (the other legitimate user)
- **Attack:** User A tries to read/modify/delete User B's diary or mood entries.
- **Impact:** Total loss of the app's core privacy guarantee.
- **Mitigation:** Every RLS policy scopes to `user_id = auth.uid()`, derived
  server-side from the verified JWT — never from a client-supplied `user_id`.
- **Residual risk:** None known if policies are correct; enforced by automated
  IDOR tests (Section 28 of your spec) before Phase 9 sign-off.

## 3. Cross-user diary access via IDOR
- **Attack:** Changing a diary entry ID in the URL/request to another user's ID.
- **Impact:** Same as above.
- **Mitigation:** RLS makes the row simply not exist for the wrong user,
  regardless of ID guessing; application never trusts client-supplied ownership
  fields.
- **Residual risk:** Low; covered by the same test suite as #2.

## 4. Privilege escalation (normal user → admin)
- **Attack:** Client sends `role: "admin"` or similar in a request body.
- **Impact:** Access to secret-code generation, chat initiation, session
  termination for other users.
- **Mitigation:** `role` lives only in the `profiles` table, settable only by
  a service-role migration/admin action, never writable by the authenticated
  user themselves; all admin-gated RPCs call a `SECURITY DEFINER is_admin()`
  check against that column, never a client-supplied flag.
- **Residual risk:** A bug in `is_admin()` would be severe; it will be one of
  the most heavily tested functions in the codebase.

## 5. Secret-code brute force
- **Attack:** Repeated guesses against the redemption endpoint.
- **Impact:** Unauthorized chat access.
- **Mitigation:** Codes are cryptographically random (CSPRNG, not `Math.random`),
  only a hash is stored, `max_attempts` enforced atomically per code, plus a
  per-identity/IP rate limit on the redemption Edge Function.
- **Residual risk:** Rate limiting at the Edge Function layer is
  application-level, not a network-layer WAF (out of scope for $0 budget);
  documented as a known limitation.

## 6. Stolen session (token theft)
- **Attack:** Access/refresh token exfiltrated via XSS, a compromised device,
  or a leaked log.
- **Impact:** Attacker acts as the legitimate user until expiry.
- **Mitigation:** Short access-token lifetime, refresh-token reuse detection
  (Supabase default), no tokens ever placed in URLs or localStorage-adjacent
  logs, strict XSS prevention (below) to reduce the exfiltration vector itself.
- **Residual risk:** A fully compromised device defeats any session design;
  documented, not solvable at $0 with a client-side-only app.

## 7. XSS via diary or chat content
- **Attack:** `<script>` or event-handler payloads stored as entry/message content.
- **Impact:** Session/token theft, UI manipulation.
- **Mitigation:** React's default escaping for all rendered content; no
  `dangerouslySetInnerHTML` anywhere in the diary or chat UI; Zod validation
  and length limits on all text input server-side, not just client-side.
- **Residual risk:** None expected if `dangerouslySetInnerHTML` is never
  introduced; enforced by a lint rule and a dedicated XSS payload test.

## 8. Injection (SQL / query manipulation)
- **Attack:** Malicious input designed to alter a query's logic.
- **Impact:** Data exposure or corruption.
- **Mitigation:** Exclusively parameterized queries via the Supabase SDK / PostgREST;
  no raw string concatenation into SQL anywhere in Edge Functions.
- **Residual risk:** Low; verified by injection-payload tests in Phase 8.

## 9. Browser/device compromise
- **Attack:** Malware, a compromised browser extension, or physical device access.
- **Impact:** Full account takeover regardless of app-level protections.
- **Mitigation:** Out of scope for a client-side web app; minimized by not
  persisting sensitive plaintext (diary drafts, chat content) in localStorage.
- **Residual risk:** Explicitly acknowledged as unsolvable at the application
  layer; documented, not hidden.

## 10. Infrastructure leakage (logs, backups, provider-side copies)
- **Attack:** N/A (not attacker-driven) — data persists longer than the UI implies.
- **Impact:** "Deleted" data may still exist in Supabase's transient logs or
  (on paid tiers) backups.
- **Mitigation:** No message/diary content is ever written to application logs;
  Free tier has no backups to begin with, which is documented as a fact, not a
  guarantee of erasure.
- **Residual risk:** Cannot claim cryptographic erasure; `SECURITY.md` states
  this plainly per your explicit requirement not to overclaim.

## 11. Chat endpoint abuse
- **Attack:** Flooding the message-send endpoint, or calling admin-only chat
  endpoints as a normal user.
- **Impact:** Quota exhaustion, unauthorized chat initiation.
- **Mitigation:** Rate limiting on message send; every chat RPC re-validates
  session validity, participant identity, and role server-side per call.
- **Residual risk:** Low; covered by chat abuse tests in Phase 8.

## 12. Replay attacks
- **Attack:** Re-submitting a previously valid secret code, OTP, or message-read
  acknowledgment.
- **Impact:** Reuse of an already-consumed authorization or resurrection of a
  deleted message.
- **Mitigation:** One-time redemption enforced atomically at the DB layer for
  secret codes; message deletion is atomic and idempotent (a second ack is a
  no-op, not a re-creation).
- **Residual risk:** None expected given atomic transactions; verified by the
  explicit "two tabs / duplicate ack" test in Phase 8.

## 13. Race conditions (concurrent reads/deletes, duplicate requests, reconnects)
- **Attack:** Two tabs racing to read/delete the same ephemeral message, or a
  network retry duplicating a write.
- **Impact:** Inconsistent state, resurrected messages, or double-processing.
- **Mitigation:** All state-changing chat operations use a single atomic
  `UPDATE ... WHERE <preconditions> RETURNING` (or an equivalent transaction),
  making the operation safe to retry and safe under concurrent execution.
- **Residual risk:** Low; explicitly tested per Section 23 of your spec.

---

This document will be revisited at the end of Phase 7 (security hardening) as
a hostile-reviewer checklist, per your Section 67 requirement, before any
claim of completion is made.
