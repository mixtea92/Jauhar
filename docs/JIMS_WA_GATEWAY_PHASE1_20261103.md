# JIMS WhatsApp Approval Gateway — Phase 1 (staging only)
Date: 3 November 2026

## Purpose
Enable official Meta WhatsApp Business Cloud API notifications and (in a later secured phase) direct CEO/BOD PV decisions via WhatsApp.
**This phase is not a functioning WhatsApp approval system.** No financial approval is changed by the webhook, and no outgoing messages exist yet.

## Current deployment
- Supabase staging project: `pjrvxkrodkscucxdidqv` (NEVER production `npaozikolbwlvnztvoef`).
- Supabase Edge Function: `jims-wa-gateway`, `verify_jwt=false` because Meta is a third party, but **GET challenge verifies shared verify token and POST requires a valid HMAC SHA-256 signature**.
- Private tables: `private.jims_wa_approval_requests`, `private.jims_wa_webhook_events`.
- Existing PV approval logic, JIMS roles, JR requirement, approval rounds, and payment flow unchanged.
- No secrets or office phone number committed to Git.
- Outbound messaging, action handling and financial approvals are **disabled/unimplemented**.

## Meta onboarding — user-owned setup
1. Log in to https://developers.facebook.com/apps/ using an authorized JAUHAR business administrator.
2. Create or choose the JAUHAR Meta Business Portfolio and create a business WhatsApp app/use case.
3. Start testing with **Meta-provided test number**, not the existing office number.
4. Record WhatsApp Business Account ID and Phone Number ID in the **private** business admin console.
5. Set webhook URL in Meta WhatsApp configuration to the staging function's URL:
   `https://pjrvxkrodkscucxdidqv.supabase.co/functions/v1/jims-wa-gateway`.
6. In **Supabase staging Edge Function secrets** set `JIMS_WA_VERIFY_TOKEN` (a random shared string) and `JIMS_WA_META_APP_SECRET` (Meta app secret). Enter them only into secure settings, NEVER chat, GitHub or the Vite frontend.
7. Subscribe to WhatsApp `messages` webhooks. GET verification works only after the token secret exists; POST returns a paused receipt after signature verification.
8. Obtain recipient opt-in for CEO/BOD internal alerts.
9. Check whether the **office number is already in WhatsApp Business App**; determine eligibility for Coexistence, or plan a deliberate migration with backups and notice. Do NOT delete the app or migrate as part of Phase 1.

## Next phase — before any live approval
- Register office number/Meta Cloud API, verify ownership and test messaging.
- Server-side transactional template dispatch with idempotency, rates, delivery retries and an approved Meta template.
- Verified mapping between recipient phone and active JIMS CEO/BOD user.
- One-time, expiring request bound to voucher ID, tier-policy revision, approval round, authority, and current state; reject replay/stale requests.
- Second factor from a separate authenticator (TOTP) required after clicking WhatsApp button; verify independently.
- Return/Reject must collect a reason, without loosening existing JR checks or authorization.
- Add **server-side authorized execution** of existing JIMS approval rules and immutable audit log. Do not spoof `auth.uid()` or expose service keys to browsers.
- End-to-end UAT using T03/T04/T06 (CEO final), T05/T07/T08/T09 (CEO→BOD; with R1/legacy differences), authorization mismatch, stale approvals, duplicate webhooks, replay, lost/stolen phone and expired actions.
- Only then propose go-live with explicit sign-off.

## Current test results
- Staging private schema and two tables exist; no approval requests or webhook events yet.
- `anon` and `authenticated` cannot SELECT private requests.
- E.164 format constraint verified on a dummy +60 example.
- Edge Function listed ACTIVE in Supabase staging, but connectivity and Meta verification remain pending credentials.
