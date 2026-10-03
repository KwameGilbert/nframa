---
paths:
  - "src/services/email*"
  - "src/services/resend*"
  - "tests/email*"
  - "tests/helpers/outbox.ts"
---

# Email

Two layers. `src/services/resend.service.ts` is the only file that knows Resend or `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (`sendViaResend({ to, subject, html })`, throws on any failure). `src/services/email.service.ts` is what the rest of the app calls: it owns the branded `layout`, the templates, and `escapeHtml` (anything a person or admin typed — names, reasons, labels — must go through it before it is put in a mail). Never import `resend.service` from a controller.

- **`sendOtpEmail`** (sign-in and password-reset codes, from `auth.controller.ts`) throws on failure: someone is waiting for the code, so the request should fail with it.
- **Notifications** are a courtesy on top of the response and the socket event. Call them `void`, after `sendSuccess`, like `logActivity`: they look up the user's email, do nothing if there isn't one, and log (never throw) on failure. What sends what:
  - *Account and security* — `sendAccountStatusEmail` (suspended/reactivated, `user.controller.ts`), `sendPasswordChangedEmail` (reset and change, `auth.controller.ts`), `sendContactChangedEmail` (email or phone changed in `updateUser`; goes to the **previous** email, and only when the value really changed), `sendAccountDeletedEmail` (inside `softDeleteAccount`, so users and admins), `sendAdminAccessEmail` (admin access granted, or role/status changed, `adminUser.controller.ts`; never contains a password).
  - *Drivers* — `sendDriverVerificationEmail` (approved/rejected/expiring only, both places a driver's status changes in `verification.controller.ts`), `sendPayoutMethodEmail` (a payout method added or removed: where earnings go is the first thing an account thief changes).
  - *Money* — `sendTopUpEmail` (inside `confirmTopUp`, only for the call that credited, so repeats send one), `sendTopUpFailedEmail` (a reversal or amount mismatch), `sendPaymentMethodReviewEmail` (staff verified/rejected a payment method), `sendReviewEmail` (a review, with the tip if there is one).
  - *Trips* — `sendTripEmail(userId, event, trip, cancelledBy?)` mirrors the `trip:*` socket events that matter: requested (driver), accepted, declined, cancelled (the other side; both when support cancels), no-show, and completed (rider's receipt, driver's earnings). Not boarded or driver-arrived (minutes apart, real-time), and not the lazy sweep's settlements, which have no event either.
  - *Safety* — `sendSosEmail` (alert received, then each status staff move it to). Emergency contacts have only phone numbers, so they get nothing.
  - Not emailed on purpose: per-document verification results (the driver-level mail already covers a rejection, and a second one would duplicate it), and a payout/payment method removed as a side effect of removing its payment method.
- Keep colours in templates out of the all-digit form (`#111827`): tests read the code out of a mail by its six digits (`tests/helpers/outbox.ts`), and a test checks the OTP mail has exactly one six-digit number.
