---
paths:
  - "src/**/wallet*"
  - "src/**/paystack*"
  - "src/**/transaction*"
  - "src/**/*webhook*"
  - "src/utils/money.ts"
  - "tests/wallet*"
  - "tests/helpers/paystack.ts"
---

# Wallet and payments

Riders top up a GHS wallet through Paystack (`src/services/paystack.service.ts`, plain `fetch`, the only file that knows Paystack or `PAYSTACK_SECRET_KEY`). Money is `numeric(12,2)`; models convert it to numbers, and `src/utils/money.ts` has `roundMoney`/`toPesewas` (Paystack counts in pesewas).

- **Ledger rule:** `walletModel` (`src/models/wallet.model.ts`) is the only code that changes a balance. `record()` locks the wallet row and writes the `transactions` row in one `db.transaction`, so a wallet's balance always equals the signed sum of its successful transactions. It deliberately lets a debit go below zero — callers that must not overdraw check `getAvailableBalance` first. Wallets are created on first use; `GET /wallet` reads zeros for an account without one.
- **Balance vs hold:** `heldAmount` is money reserved for accepted trips (from the trips phase); `availableBalance = balance - heldAmount` is what can be spent.
- **Top-ups:** `POST /wallet/topup` records a `pending` transaction whose `providerReference` is the Paystack reference, then returns Paystack's checkout URL (`wallet.minTopUp`/`wallet.maxTopUp` settings bound the amount; min above max answers 503). Starting and verifying top-ups share a per-account rate limit (`walletPaymentLimit`). It's credited by `confirmTopUp` (`src/services/wallet.service.ts`), called from the webhook and from `POST /wallet/topup/:reference/verify`: it re-verifies with Paystack (never trusting a webhook body), requires success with the recorded amount and currency (a mismatch or a reversal marks it `failed`, logged as `wallet.topup_failed` plus a warn line for mismatches; Paystack's `failed`/`abandoned` leave it pending, since the payer can retry on the same reference), then `walletModel.settleTopUp()` locks the transaction row and credits only if it is still pending — so repeated or simultaneous deliveries credit once.
- **Webhook:** `POST /webhooks/paystack` is public; `verifyPaystackSignature` checks `x-paystack-signature` (HMAC-SHA512 of `req.rawBody`) before anything else. Every correctly signed event it handled gets 200 (unknown references and other events included), or Paystack retries it forever — except when Paystack itself can't be reached to re-verify a `charge.success`: that answers 502 on purpose, so Paystack retries later. The HTTP log (`httpLogger`) records only the event name of `/webhooks/*` bodies, never the payer's email, phone or card details; the audit trail blanks `data` the same way.
- **Env:** `PAYSTACK_SECRET_KEY` (optional; without it payment routes return 503), `PAYSTACK_FALLBACK_EMAIL_DOMAIN` (Paystack needs an email; phone-only accounts send `<userId>@<domain>`, default `example.com`), `PAYSTACK_CALLBACK_URL` (optional redirect after paying). Tests mock the network calls in `tests/setup.ts` (`tests/helpers/paystack.ts` controls what they return) and keep the real signature check.
