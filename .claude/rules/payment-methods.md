---
paths:
  - "src/**/paymentMethod*"
  - "src/**/payout*"
  - "tests/paymentMethods*"
  - "tests/payoutMethods*"
---

# Payment methods and payout methods

Riders and drivers save how they pay or get paid, and drivers choose where earnings go. This is **management only for now**: no provider (Paystack, Hubtel) is called, nothing is tokenized, charged or paid out. Trips still debit the wallet, and top-ups still go through Paystack as in `wallet-payments.md`; these tables are where the provider integration will attach later.

- **`paymentMethods`** (`/payment-methods`, `paymentMethod.model.ts`): `card`, `mobile_money` or `bank_account`, riders and drivers. A card is only _described_ (brand, last four, expiry): the create schema is a strict object, so a full card number or CVV answers 400 rather than being ignored. Mobile money and bank details are stored in `metadata` in full (the provider will need them) but **every response and audit entry goes through `paymentMethodView`, which masks them to the last four digits**; `httpLogger` and the activity log's `redact` blank the request body's `phoneNumber`/`accountNumber`. `provider` and `tokenizedReference` are nullable placeholders for the integration and are in the model's `excludedColumns` with `identifier` (a normalized key; a partial unique index on active rows makes saving the same method twice a 409).
- **Immutable details:** only the label and `isPrimary` can be edited. Changing a number means removing the method and saving a new one, which starts `pending` again, so an unverified detail can never sit on a verified method. Remove is a soft delete (`isActive`), and also deletes any payout method built on it.
- **Verification and primary:** a method starts `pending`; until the provider verifies them, staff set `verificationStatus` (`PATCH /admin/payment-methods/:id`, `users: update`). Only a verified method can be primary; one primary per person (partial unique index), the first method staff verify becomes it if there is none, and un-verifying clears it.
- **`payoutMethods`** (`/payout-methods`, `payoutMethod.model.ts`): drivers only. Points at one of the driver's own _verified_ mobile money or bank accounts (never a card) with `isAutomatic`, `minimumThreshold`, `payoutFrequency`; no scheduler reads them yet. The first becomes primary (partial unique index per driver), and removing the primary promotes the newest remaining. `payoutHistory` (the later payout log) exists but nothing writes to it.
- **Permissions:** own records need only `authenticate`; the controllers only ever load the caller's rows (404 for anyone else's). Staff payment-method routes use `users`; staff payout-method routes (`/admin/payout-methods`) use the `payouts` module. Both `/admin/payment-methods` and `/admin/payout-methods` are registered **before** `adminUserRouter`, whose `/admin/:userId` would otherwise swallow them.
