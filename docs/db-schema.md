# Nframa — Database Schema Plan

**Status:** proposed (no migrations written yet)
**Sources:** `docs/frontend/nframa_system_documentation.md` (Rider & Driver mobile apps) and `docs/frontend/api-spec.md` (Admin dashboard — identical to `docs/api-spec.md`). Both are reference material; where they conflict with sound data modeling, this plan says so and picks the sound option.

---

## 1. Global conventions

- **Naming:** tables and columns are **camelCase** (`walletTransactions.balanceAfterPesewas`), matching the TypeScript codebase so no snake↔camel mapping layer is needed. Practical consequence: Postgres folds unquoted identifiers to lowercase, so every camelCase identifier must be double-quoted — Knex's query builder quotes automatically, but any hand-written `knex.raw` SQL must quote `"camelCase"` identifiers explicitly.
- **Phone numbers are always two columns, never one combined string:** a `...CountryCode` column (numeric calling code, digits only, no `+` — e.g. `"233"`) alongside the number itself (the **national significant number only** — no country code, no leading trunk `0`, e.g. `"201234567"` for a Ghanaian number locally written `020 123 4567`). Full E.164 for outbound SMS/OTP is reconstructed at the API/service layer as `` `+${countryCode}${number}` ``; normalizing whatever format the client submits (`0201234567`, `+233201234567`, …) into these two parts also happens there — never stored redundantly. Applies to `users.phoneCountryCode`/`phoneNumber` and `riderProfiles.emergencyContactCountryCode`/`emergencyContactPhone`.
- **Primary keys:** `uuid` (`gen_random_uuid()`, pgcrypto is built into PG 17). The mobile doc already specifies uuid ids.
- **Human-facing codes:** the frontends display prefixed ids (`TRP-7210`, `VER-5031`, `SUS-0048`, …). These are **not** primary keys — each table that needs one gets a `code text UNIQUE` column fed by a per-entity Postgres sequence (`'TRP-' || nextval(...)`). APIs expose both `id` and `code`; lookups by code are indexed.
- **Money:** stored as **integer pesewas** (`bigint`, columns suffixed `Pesewas`). Exact arithmetic, no float drift; serialization to GHS numbers (`26.5`) happens in the API layer. The admin spec explicitly invites this ("Flag if the backend team prefers minor units — the frontend will adapt").
- **Time:** `timestamptz` everywhere; API returns ISO 8601 (already a CLAUDE.md rule). Every table gets `createdAt` / `updatedAt` (`DEFAULT now()`; `updatedAt` maintained by the app).
- **Enum-ish fields:** `text` + `CHECK` constraints, not native PG enums — adding a value is a trivial constraint swap in a Knex migration instead of an `ALTER TYPE` dance. Stored values are camelCase strings (`inTransit`, `awaitingReview`); display casing ("In Transit") is presentation.
- **Soft delete:** `deletedAt timestamptz` on the tables the admin spec lets admins "permanently delete" but where history matters for finance/compliance (`users`, `verificationApplications`, `supportTickets`). The spec raises this exact question three times; soft delete + PII scrubbing is the recommended answer. Trips, ledger rows, audit logs, SOS alerts are **never** deletable (the spec's own standing rules).
- **Status transitions** (e.g. dispute `open → underReview → resolved`) are enforced in the service layer; the DB stores the current status plus the timestamps of each transition.

---

## 2. Entity map — where each frontend concept lands

| Frontend concept (doc) | Table(s) |
|---|---|
| Rider / Car Owner accounts, phone OTP login | `users`, `riderProfiles`, `carOwnerProfiles`, `otpCodes`, `authSessions` |
| Default commute ("Home to Work") | `savedCommutes` |
| Vehicle (make/model, plate, seats, photos) | `vehicles`, `files` |
| Driver verification (docs, timeline, approve/reject) | `verificationApplications`, `verificationDocuments`, `verificationEvents` |
| Corridors / Route Management | `routes`, `routeAssignments`, `operatingCities` |
| Driver "Commutes" (one-off + recurring Mon–Fri) | `schedules` |
| A concrete departure (Trip/Schedule entity, `TRIP-7745`) | `trips` |
| Rider reservation / driver Requests inbox / admin "Scheduled Trips" rows | `bookings` |
| QR boarding + Boarding & QR logs | `boardingScans` (+ `qrToken` on `bookings`) |
| Trip Update Failures | `tripUpdateFailures` |
| Ratings (`averageRating`, completed-trip rating) | `ratings` |
| Reports & Misconduct / Trip Disputes | `misconductReports`, `tripDisputes` |
| Rider wallet (cash + service credits), car owner wallet (available + pending) | `walletAccounts`, `walletTransactions` |
| Transit Pass ("14 of 20 rides left") | `transitPasses` |
| Top-up, payment methods, auto-refill | `paymentMethods`, `walletTransactions`, auto-refill fields on `riderProfiles` |
| Withdrawal Requests / Approval Queue | `withdrawalRequests`, `payoutApprovals`, `payoutAccounts` |
| Refunds & Credits | `refundRequests` |
| SOS desk + incident notes | `sosAlerts`, `sosAlertNotes` |
| Support tickets + replies, Broadcast Studio | `supportTickets`, `ticketReplies`, `broadcasts` |
| Admin users, roles, suspensions | `adminUsers`, `roles`, `suspensionCases`, `oneTimeTokens` |
| Financial Audit Logs + Activity Logs + Overview "recent actions" | `auditLogs` (one table, filtered by `module`) |
| Platform Settings + change log + cities | `platformSettings`, `settingsChangeLogs`, `operatingCities` |

~38 tables. Overview/stat-tile numbers, trends, "Payout ready" wallet status, `assignedCarOwners` counts, driver net earnings etc. are **derived at query time** (or cached), never stored — see §11.

---

## 3. Identity & access

### `users` — shared identity for riders and car owners

One person = one row, keyed by phone. Role is **not** a column — it's the existence of a `riderProfiles` / `carOwnerProfiles` row, so the same phone can hold both a rider and a car-owner account without duplicating identity (the OTP request's `appType` selects which profile the session acts as).

| column | type | notes |
|---|---|---|
| `id` | uuid PK | used in QR payloads, JWT `sub` |
| `phoneCountryCode` | text NOT NULL | numeric calling code, no `+` (e.g. `"233"`) |
| `phoneNumber` | text NOT NULL | national significant number only, no leading `0` (e.g. `"201234567"`) — uniqueness is the composite `UNIQUE (phoneCountryCode, phoneNumber)`, not this column alone, since a national number can repeat across countries |
| `fullName` | text | |
| `email` | text UNIQUE NULL | |
| `status` | text CHECK | `active` / `suspended` — account-wide; maintained by suspend/reinstate |
| `isProfileComplete` | boolean DEFAULT false | drives the rider onboarding push |
| `lastActiveAt` | timestamptz | admin "lastActive" |
| `passwordChangedAt`, `lastLoginLocation`, `deviceCount` | — | the admin `security` block is login telemetry; derive from `authSessions` instead of storing (see §11) |
| `createdAt`, `updatedAt`, `deletedAt` | timestamptz | `deletedAt` = soft delete + scrub PII |

### `riderProfiles`

| column | type | notes |
|---|---|---|
| `userId` | uuid PK FK→users | 1:1 |
| `code` | text UNIQUE | `RID-#####` |
| `emergencyContactName` | text NULL | doc lists name only; phone added for practicality |
| `emergencyContactCountryCode` | text NULL | same numeric-calling-code convention as `users.phoneCountryCode` |
| `emergencyContactPhone` | text NULL | national significant number only, same convention as `users.phoneNumber`; nullable together with the above — enforced at the service layer, not a DB CHECK |
| `autoRefillEnabled` | boolean DEFAULT false | wallet auto-refill toggle |
| `autoRefillThresholdPesewas` | bigint DEFAULT 1500 | "below GH₵15" |
| `autoRefillAmountPesewas` | bigint NULL | how much to charge when triggered |

### `carOwnerProfiles`

| column | type | notes |
|---|---|---|
| `userId` | uuid PK FK→users | 1:1 |
| `code` | text UNIQUE | `CAR-####` |
| `verificationStatus` | text CHECK | `unverified` / `pending` / `approved` / `rejected` / `expiring` — denormalized from the latest `verificationApplications` row (kept in sync by the verification service) so user lists don't join applications |
| `ghanaCardNumber` | text NULL | `GHA-…` |
| `address` | text NULL | |
| `isOnline` | boolean DEFAULT false | "Go Online" shift toggle |
| `autoAcceptBookings` | boolean DEFAULT false | Requests inbox auto-accept |
| `termsAcceptedAt` | timestamptz NULL | post-approval `/acceptance` step |

### `savedCommutes` — rider default commute

Own table (not columns on the profile) so "Home to Work" can later coexist with other saved corridors; exactly one `isDefault` per rider (partial unique index).

`id` uuid PK · `riderUserId` FK→users · `label` text ("Home to Work") · `startAddress` text · `startLat`/`startLng` numeric(9,6) · `endAddress` · `endLat`/`endLng` · `days` smallint[] (ISO 1–7) · `departTime` time · `isActive` bool · `isDefault` bool

### `vehicles`

Separate table (photos + future multi-vehicle) even though today each owner has one.

`id` uuid PK · `carOwnerUserId` FK→users · `make` text · `model` text · `year` int NULL · `color` text · `plate` text UNIQUE ("GW-1234-24") · `seats` smallint · `status` text CHECK (`active`/`retired`) — photos live in `files` (`purpose = 'vehiclePhoto'`, `ownerId` = vehicle id).

### `suspensionCases`

The admin spec's rich suspension form. Reinstating **closes** the case (sets `reinstatedAt`) rather than deleting it — the API's "suspension cleared entirely" view is simply "no open case", and history survives.

`id` uuid PK · `code` text UNIQUE (`SUS-00##`) · `userId` FK→users · `reason` text · `reviewStatus` text CHECK (`appealPending` / `underReview` / `actionRequired` / `escalated` / `noAppeal` / `cleared`) · `restrictions` text · `notes` text · `suspendedByAdminId` FK→adminUsers NULL (NULL = "System") · `suspendedAt` · `reinstatedAt` NULL · `reinstatedByAdminId` NULL
Partial unique index: one open case (`reinstatedAt IS NULL`) per user.

### `adminUsers`, `roles`

Admins are a separate realm (email + password/OTP, not phone) — separate table, no overlap with `users`.

**`adminUsers`:** `id` uuid PK · `code` text UNIQUE (`ADM-####`) · `name` · `email` text UNIQUE · `passwordHash` text (argon2/bcrypt) · `avatarFileId` FK→files NULL · `roleId` FK→roles · `department` text NULL · `status` text CHECK (`active`/`suspended`/`invited`) · `lastLoginAt` NULL

**`roles`:** `id` uuid PK · `slug` text UNIQUE (`support-admin`) · `name` text UNIQUE · `description` text · `permittedModules` jsonb (array of nav module ids)

Using a real FK (`roleId`) instead of the frontend's name-string matching **dissolves two problems the spec flags**: renaming a role can't orphan admins, and assigning a nonexistent role is impossible. Role deletion is blocked while admins reference it (FK `RESTRICT` — the spec's required 409). `permissionsCount` is `jsonb_array_length`, never stored. Server-side enforcement of `permittedModules` per endpoint (the spec's "must not be UI-only" warning) is a guard concern, not schema.

### Auth plumbing

**`otpCodes`:** `id` · `identifier` text (phone or email) · `channel` CHECK (`sms`/`email`) · `purpose` CHECK (`riderLogin` / `driverLogin` / `adminLogin` / `passwordReset`) · `codeHash` text · `expiresAt` · `consumedAt` NULL · `attemptCount` smallint — index `(identifier, purpose, createdAt)`. Codes hashed, single-use, attempt-limited. For phone-based OTP, `identifier` is the concatenation `phoneCountryCode + phoneNumber` (no separators, no `+`) so it matches `users` directly — a derived matching key, not itself a place the phone-splitting convention above needs to apply.

**`oneTimeTokens`:** the admin forgot-password flow's step-2 `resetToken` (and later invite-activation links). `id` · `subjectType` CHECK (`admin`/`user`) · `subjectId` uuid · `kind` CHECK (`passwordReset`/`adminInvite`) · `tokenHash` UNIQUE · `expiresAt` · `consumedAt` NULL

**`authSessions`:** refresh-token sessions for both realms. `id` · `subjectType` CHECK (`user`/`admin`) · `subjectId` uuid · `refreshTokenHash` UNIQUE · `userAgent` text · `ipAddress` inet · `lastUsedAt` · `expiresAt` · `revokedAt` NULL — powers "revoke other sessions on password reset" and the admin UI's `devices` / `loginLocation` telemetry.

### `files`

Generic upload registry (S3-style object storage; DB stores the pointer): `id` uuid PK · `ownerType` CHECK (`user`/`admin`/`vehicle`) · `ownerId` uuid · `purpose` text (`verificationDocument` / `selfie` / `ghanaCardFront` / `ghanaCardBack` / `vehiclePhoto` / `avatar`) · `storageKey` text · `mimeType` · `sizeBytes` bigint · `createdAt`. The admin spec's requested per-document `fileUrl` is a signed URL minted from `storageKey` at read time — never stored.

---

## 4. Routes & catalog

### `routes` — the admin-managed fixed corridors

`id` uuid PK · `code` text UNIQUE (`RTE-####`) · `name` ("Accra–Tema Express") · `corridor` text ("Accra–Tema" — grouping/filter label, see open question §12) · `originName` · `originLat`/`originLng` NULL · `destinationName` · `destinationLat`/`destinationLng` NULL · `cityId` FK→operatingCities NULL · `distanceKm` numeric(6,2) · `baseFarePesewas` bigint · `perKmRatePesewas` bigint · `status` CHECK (`active`/`inactive`/`underReview`)

`assignedCarOwners` is `COUNT(*)` over `routeAssignments` — never stored (the spec says the same).

### `routeAssignments`

Which car owners serve which route — needed by the spec's route-delete question ("block while car owners are assigned", FK `RESTRICT`) and it's where `AppUser.vehicle.corridor` really comes from.

`id` · `routeId` FK→routes · `carOwnerUserId` FK→users · `assignedAt` · `unassignedAt` NULL — partial unique `(routeId, carOwnerUserId) WHERE "unassignedAt" IS NULL`.

### `operatingCities`

`id` uuid PK · `name` text UNIQUE · `createdAt`. Deleting a city that routes reference: FK `RESTRICT` (the spec's open question — resolved toward blocking, consistent with every other orphan-guard in the app).

---

## 5. Verification

### `verificationApplications`

`id` uuid PK · `code` text UNIQUE (`VER-####`) · `carOwnerUserId` FK→users · `vehicleId` FK→vehicles · `status` CHECK (`pending` / `approved` / `rejected` / `expiring` / `resubmitted`) · `priority` CHECK (`low`/`medium`/`high`) — computed by a scheduled job (wait-time + document expiry proximity), never admin-set · `submittedAt` · `reviewerAdminId` NULL · `decidedAt` NULL · `rejectionReason` text NULL · `deletedAt` NULL (soft delete)

Business rules (service layer, worth recording): any single document rejection ⇒ application `rejected`; application `approved` only when **all** required documents are approved; a BullMQ sweep flips applications/documents to `expiring`/`expiringSoon` as `expiryDate` approaches (the spec says nothing in the frontend ever sets these — it must be a backend job).

### `verificationDocuments`

One row **per submitted version** — a resubmission inserts a new row pointing at the one it replaces, which gives the UI's `previousRejectionReason` and a full history for free. "Current" docs = latest per type (no row referencing them via `replacesDocumentId`).

`id` uuid PK · `applicationId` FK · `type` CHECK (`drivingLicence` / `registration` / `insurance` / `roadworthy` / `selfie` / `ghanaCardFront` / `ghanaCardBack` / `vehiclePhoto`) — the admin reviews the first four; the driver app uploads the rest · `fileId` FK→files · `issueDate` date NULL · `expiryDate` date NULL · `status` CHECK (`pendingReview` / `approved` / `rejected` / `expiringSoon` / `resubmitted`) · `reviewerAdminId` NULL · `reviewedAt` NULL · `rejectionReasonCode` CHECK (`unverifiable`/`mismatch`/`expired`/`illegible`/`other`) NULL · `rejectionNotes` text NULL — structured reason + notes, exactly the improvement the spec asks for · `checks` jsonb (pipeline check labels) · `replacesDocumentId` self-FK NULL

### `verificationEvents` — the timeline / activity log

Append-only. `id` · `applicationId` FK · `label` text · `detail` text NULL (e.g. sent-notification HTML body) · `tone` CHECK (`success`/`danger`/`warning`/`info`/`neutral`) · `actorType` CHECK (`admin`/`carOwner`/`system`) · `actorAdminId` NULL · `createdAt`

The "Notify Car Owner" action writes a row here (and enqueues delivery) — no separate notifications table needed yet.

---

## 6. Scheduling, trips, bookings

The three docs use "schedule/commute/trip" loosely. The model that makes them all work:

```
schedules (driver's template, possibly recurring)
   └── trips (one concrete departure on a date)   ← TRP-xxxx, driver's Active Trip, admin's live board
          └── bookings (one rider's seat(s))       ← rider's "commute leg", driver's Requests inbox,
                 └── boardingScans                    admin's "Scheduled Trips" rows
```

### `schedules`

`id` uuid PK · `carOwnerUserId` FK · `routeId` FK · `vehicleId` FK · `departTime` time NOT NULL · `recurrenceDays` smallint[] NULL (ISO 1–7; NULL = one-off) · `oneOffDate` date NULL · `startsOn` date · `endsOn` date NULL · `seatsOffered` smallint · `status` CHECK (`active`/`paused`/`cancelled`)
CHECK: exactly one of `recurrenceDays` / `oneOffDate` is set.

A BullMQ job materializes upcoming `trips` from active schedules on a rolling horizon (e.g. 7 days ahead). The **2-hour freeze rule** is enforced against `trips.departureAt` in the service layer — schema just guarantees the timestamp exists.

### `trips`

Route facts are **snapshotted** at creation (origin/destination/corridor/fare) so later route edits can't rewrite history.

| column | type | notes |
|---|---|---|
| `id` / `code` | uuid PK / text UNIQUE | `TRP-####` |
| `scheduleId` | FK NULL | NULL for ad-hoc one-offs |
| `routeId`, `carOwnerUserId`, `vehicleId` | FK | |
| `originName`, `originDetail`, `destinationName`, `destinationDetail`, `corridor` | text | snapshots (`originSub`/`destinationSub`) |
| `departureAt` | timestamptz | freeze-rule anchor |
| `seatsTotal` | smallint | available = `seatsTotal − SUM(confirmed booking seats)`, computed under a row lock at booking time — not stored, can't drift |
| `farePesewas` | bigint | per seat, snapshotted from route pricing |
| `status` | text CHECK | `scheduled` / `inTransit` / `completed` / `cancelled` (admin's "Disputed" badge is derived: completed + open dispute) |
| `startedAt`, `completedAt` | timestamptz NULL | |
| `cancelledAt`, `cancelledByType` CHECK (`rider`/`carOwner`/`system`/`admin`), `cancelledById` uuid NULL, `cancelReason` text | | cancellation is a state transition **on the trip** — the admin mock's "new CancelledTrip record" is just this row viewed through the cancelled-trips endpoint |
| `lastLat`, `lastLng`, `positionUpdatedAt` | numeric/timestamptz NULL | last-known live position for the dispatch map; a full `tripPositions` history table can come later if telemetry needs it |

Indexes: `(status, departureAt)`, `(carOwnerUserId, departureAt)`, `(routeId)`.

### `bookings`

| column | type | notes |
|---|---|---|
| `id` / `code` | uuid PK / text UNIQUE | `BKG-####` (admin's `SCH-`/`CMP-`/`CNL-` ids are views over trips+bookings, not tables) |
| `tripId`, `riderUserId` | FK | UNIQUE together |
| `seats` | smallint DEFAULT 1 | |
| `status` | text CHECK | `requested` → `confirmed` (driver accept / auto-accept) → `boarded` (QR scan) → `completed`; or `rejected` / `cancelled` / `noShow` |
| `farePesewas` | bigint | snapshot: trip fare × seats |
| `paidWith` | text CHECK NULL | `walletCash` / `walletCredit` / `transitPass` |
| `transitPassId` | FK NULL | when paid by pass |
| `qrToken` | text UNIQUE | random opaque token encoded in the QR. The doc's `NFR-USERID-SCHEDULEID` payload is **guessable/forgeable** — a rider who knows a user id could mint a valid QR. Keep the display format if the frontend insists, but validate against this server-issued token |
| `confirmedAt`, `boardedAt`, `cancelledAt` | timestamptz NULL | |
| `cancelledBy` CHECK (`rider`/`carOwner`/`system`/`admin`) NULL, `cancelReason` text NULL | | standardized reasons ("Personal Emergency", …) stay text |

Index: `(riderUserId, status)`, `(tripId, status)`.

### `boardingScans`

Append-only log (admin's Boarding & QR page — including failed scans, which is why it's not just `bookings.boardedAt`).
`id` · `code` (`QR-####`) · `tripId` FK · `bookingId` FK NULL (NULL when the scan matched nothing) · `scannedByUserId` FK (the driver) · `payloadRaw` text · `result` CHECK (`valid` / `invalidFare` / `duplicate` / `noMatch`) · `scannedAt`

### `tripUpdateFailures`

`id` · `code` (`FLR-####`) · `tripId` FK · `failureType` CHECK (`gpsTimeout` / `statusSyncError` / `paymentWebhookFailed`) · `details` jsonb · `occurredAt` · `resolved` bool DEFAULT false · `resolvedByAdminId` NULL · `resolvedAt` NULL

### `ratings`

`id` · `tripId` FK · `bookingId` FK · `raterUserId` FK · `rateeUserId` FK · `score` smallint CHECK 1–5 · `comment` text NULL · `createdAt` — UNIQUE `(bookingId, raterUserId)`. `averageRating` / `tripsCompleted` on user lists are aggregates (denormalize onto profiles later only if measured slow).

### `misconductReports` (governs a **person**)

`id` · `code` (`MIS-###`) · `tripId` FK · `reportedByUserId` FK (rider) · `againstUserId` FK (car owner) · `category` text (dynamic filter → free text, curated picklist in app) · `description` text · `severity` CHECK (`high`/`medium`/`low`) · `status` CHECK (`open` → `investigating` → `resolved`/`dismissed`) · `reportedAt` · `resolvedAt` NULL · `handledByAdminId` NULL

### `tripDisputes` (fixes a **trip**)

`id` · `code` (`DSP-###`) · `tripId` FK · `bookingId` FK NULL · `raisedByUserId` FK · `category` text · `amountPesewas` bigint NULL (non-monetary disputes) · `status` CHECK (`open` → `underReview` → `resolved`, or `underReview` → `escalated` → `resolved`) · `openedAt` · `resolvedAt` NULL · `resolutionNotes` text NULL

---

## 7. Finance

Ledger-first: **balances are the sum of an append-only ledger**, cached on the account row for reads. Every money movement is a `walletTransactions` row; nothing edits or deletes one (corrections are reversal entries).

### `walletAccounts`

One row per (user, bucket) — this cleanly models the docs' four distinct balances:

`id` uuid PK · `userId` FK→users · `accountType` CHECK (`riderCash` / `riderCredit` / `ownerAvailable` / `ownerPending`) · `balancePesewas` bigint DEFAULT 0 (cache; authoritative value = ledger sum, reconciled by a job) · UNIQUE `(userId, accountType)`

Admin wallet statuses are derived, not stored: "Suspended" = user status; "Restricted" = open suspension case with payout restriction; "Setup required" = no `payoutAccounts` row; "Payout ready" = available ≥ threshold — exactly the cross-module linkage the spec asks to be real rather than drifting.

### `walletTransactions`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `accountId` | FK→walletAccounts | |
| `amountPesewas` | bigint | signed (negative = out) |
| `balanceAfterPesewas` | bigint | running balance for statements |
| `type` | text CHECK | `topup` / `tripPayment` / `tripEarning` / `commission` / `pendingRelease` / `payout` / `payoutFee` / `refund` / `serviceCredit` / `passPurchase` / `adjustment` / `reversal` |
| `referenceType` / `referenceId` | text / uuid NULL | `booking` / `trip` / `withdrawalRequest` / `refundRequest` / `transitPass` |
| `gateway`, `gatewayReference`, `gatewayStatus` | text NULL | PSP linkage for top-ups & payouts (dedicated gateway table later if integration grows) |
| `createdByAdminId` | FK NULL | manual adjustments |
| `note` | text NULL | |
| `idempotencyKey` | text UNIQUE NULL | webhook/retry safety |
| `createdAt` | timestamptz | |

A completed trip settles as paired entries: rider `tripPayment` (−fare), owner `ownerPending` `tripEarning` (+fare) and `commission` (−fare × settings %, percentage snapshotted in `note`/metadata at trip time), then a `pendingRelease` pair moves pending → available on the platform's settlement cadence. Rider wallet counts on the admin page (`payments`, `adjustments`) are `COUNT(*)` by type.

### `paymentMethods` (rider funding)

`id` · `userId` FK · `kind` CHECK (`card`/`momo`) · `provider` text (`visa`/`mastercard`/`mtn`/`telecel`/`at`) · `maskedDetails` text ("024•••1148", "•••• 4242") · `gatewayToken` text (tokenized at the PSP — **raw PANs/full numbers are never stored**, prohibited data) · `isDefault` bool — partial unique: one default per user.

### `payoutAccounts` (car owner destinations)

`id` · `carOwnerUserId` FK · `method` CHECK (`mobileMoney`/`bankAccount`) · `provider` text · `accountName` text · `maskedDetails` text · `gatewayToken` text NULL · `isDefault` bool

### `transitPasses`

`id` · `code` · `riderUserId` FK · `ridesTotal` smallint · `ridesUsed` smallint DEFAULT 0 · `routeId` FK NULL (scope — or NULL = any corridor) · `status` CHECK (`active`/`exhausted`/`expired`/`cancelled`) · `validFrom` / `validUntil` NULL · `purchaseTransactionId` FK→walletTransactions NULL
The product itself (pricing tiers, corridor scoping, expiry policy) is under-documented — see §12.

### `withdrawalRequests`

`id` · `code` (`WD-####`) · `carOwnerUserId` FK · `payoutAccountId` FK · `amountPesewas` · `feePesewas` · `netPesewas` · `status` CHECK (`awaitingReview` / `processing` / `paid` / `failed` / `reversed`) · `risk` CHECK (`low`/`medium`/`high`) — computed at submission · `requestedAt` · `processedAt` NULL · `gatewayReference` NULL

### `payoutApprovals`

The spec keeps Withdrawal Requests (visibility) and Approval Queue (decision) as separate surfaces with "different lifecycles" — but as **mock fixtures** they're unlinked, which a real backend must not copy. Model the queue item as a review record with a hard FK to the request; segregation of duties is preserved (different permission on the decision endpoint), and an approval can never reference a nonexistent payout.

`id` · `code` (`APQ-###`) · `withdrawalRequestId` FK UNIQUE · `eligibility` CHECK (`eligible` / `policyReview` / `dutyConflict`) — computed on queue entry · `outcome` CHECK (`awaitingApproval` / `approved` / `rejected`) · `enteredQueueAt` · `reviewedByAdminId` NULL · `decidedAt` NULL

The eligibility/outcome gate ("only eligible + awaiting rows are decidable") is enforced server-side, per the spec's explicit ask.

### `refundRequests`

`id` · `code` (`RFC-###`) · `type` CHECK (`refund`/`serviceCredit`) · `riderUserId` FK · `sourceType` CHECK (`trip`/`dispute`) · `sourceId` uuid · `amountPesewas` · `reason` text · `requestedByAdminId` FK · `status` CHECK (`pendingReview` / `completed` / `processed` / `rejected`) · `decidedByAdminId` NULL · `decidedAt` NULL
(`processed` vs `completed` ambiguity — §12.)

---

## 8. Safety

### `sosAlerts` — never deleted, transitions only

`id` · `code` (`SOS-####`) · `tripId` FK · `riderUserId` FK (the commuter; phone/vehicle details join through trip/booking — not duplicated) · `locationText` text · `lat`/`lng` NULL · `triggerReason` text · `priority` CHECK (`critical`/`medium`/`low`) · `status` CHECK (`active` → `dispatched` → `resolved`, or `active` → `resolved`) · `triggeredAt` · `dispatchedAt` NULL · `resolvedAt` NULL · `resolvedByAdminId` NULL
The Settings `sosTimeoutMinutes` auto-escalation is a BullMQ delayed job, not schema.

### `sosAlertNotes`

`id` · `alertId` FK · `authorAdminId` FK · `message` text (plain) · `createdAt` — append-only.

---

## 9. Support

### `supportTickets`

`id` · `code` (`TCK-####`) · `userId` FK→users NULL · `reporterName` / `reporterRole` CHECK (`rider`/`carOwner`) — snapshot columns because the admin console can log a phoned-in ticket for someone it may only later link to a real account · `category` CHECK (the 6 fixed values) · `subject` · `description` · `priority` CHECK (`high`/`medium`/`low`) · `status` CHECK (`open` → `inProgress` → `resolved`, or `open` → `resolved`) · `region` text · `assignedToAdminId` FK NULL · `resolvedAt` NULL · `deletedAt` NULL

Reply auto-transition (open + reply ⇒ inProgress + auto-assign) is service-layer.

### `ticketReplies`

`id` · `ticketId` FK · `authorType` CHECK (`admin`/`user`) · `authorAdminId` NULL / `authorUserId` NULL (CHECK: exactly one set) · `messageHtml` text · `createdAt`

### `broadcasts`

`id` · `code` (`BRD-####`) · `title` · `channel` CHECK (`inApp`/`email`/`push`/`sms`) · `message` text (HTML for in-app/email; plain for push/SMS — length limits validated server-side per channel) · `audience` CHECK (`allRiders`/`allCarOwners`/`everyone`) · `status` CHECK (`draft`/`scheduled`/`sent`) · `scheduledFor` timestamptz NULL (the type models scheduling even though the UI doesn't yet — cheap to support now) · `sentAt` NULL · `reach` int DEFAULT 0 (recipient count stamped at send) · `createdByAdminId` FK
`sent` immutability (no edit/delete) is a service guard; duplicate = insert a new `draft`.

---

## 10. Audit, settings

### `auditLogs` — one table, three consumers

Serves Administration → Activity Logs (`ACL-`), Finance → Financial Audit Logs (`FAL-`, filter `module = 'finance'`), and the Overview "recent actions" feed. Written **as a side effect of every consequential mutation** (a small interceptor/service, not per-feature goodwill) — the spec's own recommendation, twice.

`id` · `code` · `actorAdminId` FK NULL (NULL = system) · `module` text (`users`/`verification`/`finance`/`tripOperations`/`safety`/`support`/`administration`/`settings`) · `action` text ("Approved payout") · `targetType` / `targetId` · `targetLabel` text (name snapshot — survives target deletion) · `referenceCode` text (`APQ-201`) · `result` CHECK (`success`/`rejected`/`failed`) · `ipAddress` inet NULL · `metadata` jsonb · `createdAt`
Append-only; indexes on `(module, createdAt)`, `(actorAdminId, createdAt)`.

### `platformSettings` — single row

`id` smallint PK CHECK (`id = 1`) · `baseFarePesewas` · `perKmRatePesewas` · `perMinRatePesewas` · `platformCommissionPct` numeric(5,2) · `maxSurgeMultiplier` numeric(4,2) · `autoPayoutThresholdPesewas` · `momoEnabled` bool · `bankTransferEnabled` bool · `sosTimeoutMinutes` smallint · `autoNotifyPolice` bool · `ghanaCardMandatory` bool · `licenceExpiryNoticeDays` smallint · `minDriverAge` smallint CHECK (≥ 18) · `updatedByAdminId` FK · `updatedAt`

These are platform **defaults**; `routes` carries its own `baseFarePesewas`/`perKmRatePesewas`, so route pricing overrides global (resolves the overlap between Settings and Route Management — and leaves a clean path to per-city pricing later, per the spec's open question).

### `settingsChangeLogs`

`id` · `code` (`CFG-##`) · `adminId` FK · `summary` text · `changes` jsonb (`[{field, old, new}]` — the diff-based log the spec asks for) · `createdAt` — written automatically by the settings update.

---

## 11. Deliberately **not** stored (derived at query time)

- All Overview/stat-tile numbers, trends, donut breakdowns, cash-flow charts — aggregate queries (materialize/cache per-minute later if slow).
- `seatsAvailable` on trips, `assignedCarOwners` on routes, `permissionsCount` on roles, per-role admin counts.
- `tripsCompleted`, `averageRating` on users (aggregate over trips/ratings; denormalize only if measured slow).
- Wallet display statuses (`Payout ready` / `Restricted` / `Setup required`), trip "Disputed" badge, rider "Active/Suspended" wallet status.
- The admin `security` block (`devices`, `loginLocation`, `passwordChanged`) — from `authSessions` + `users`.
- Filter-option lists (corridors, joined months, suspension reasons, …) — `SELECT DISTINCT` with indexes.
- Balances are *cached* on `walletAccounts` but the ledger is authoritative.

## 12. Open questions (carried from the docs + new ones)

1. **Hard vs soft delete** for users / verification applications / tickets — this plan assumes **soft delete + PII scrub**; confirm with product (raised 3× in the admin spec).
2. **Pesewas vs decimal GHS** — plan says integer pesewas; the admin frontend adapts at the serializer.
3. **`processed` vs `completed`** refund status — modeled as two stages (decision vs money settled); confirm.
4. **Transit pass product** — pricing, corridor scope, expiry are undocumented; `transitPasses` is a best-guess shape.
5. **Corridor as first-class table?** — currently a label on `routes`. If corridors ever get their own lifecycle (fares per corridor, corridor-level assignment), promote to a `corridors` table; today it would be a table with one meaningful column.
6. **QR payload** `NFR-USERID-SCHEDULEID` is forgeable — plan uses a server-issued random `qrToken`; frontend QR content should carry it.
7. **Same phone as both rider and car owner** — supported by the users+profiles split; confirm product actually wants this (vs. one role per phone).
8. **Trip materialization horizon** for recurring schedules (7 days? 14?) and what happens on schedule edit vs already-materialized trips.
9. **Eligibility computation** for `payoutApprovals` (`policyReview` / `dutyConflict`) — rules undefined in the docs.
10. **Verification `priority` formula** — undefined; assumed job-computed from wait time + expiry proximity.
11. **Phone country-code scope** — confirm with product whether `phoneCountryCode` is effectively fixed to Ghana (`"233"`) at launch or the platform expects other countries soon; affects whether phone-input validation/normalization (e.g. via `libphonenumber-js`) needs to support arbitrary countries from day one or can hardcode Ghana's national-number format rules.

## 13. Proposed migration order

Each numbered group = one or two Knex migrations, ordered by FK dependency; seeds follow the same order.

1. **Extensions + identity:** `users`, `riderProfiles`, `carOwnerProfiles`, `savedCommutes`, `files`, `vehicles`
2. **Admin & auth:** `roles`, `adminUsers`, `otpCodes`, `oneTimeTokens`, `authSessions`, `suspensionCases`
3. **Catalog:** `operatingCities`, `routes`, `routeAssignments`
4. **Verification:** `verificationApplications`, `verificationDocuments`, `verificationEvents`
5. **Trips:** `schedules`, `trips`, `bookings`, `boardingScans`, `tripUpdateFailures`, `ratings`, `misconductReports`, `tripDisputes`
6. **Finance:** `walletAccounts`, `walletTransactions`, `paymentMethods`, `payoutAccounts`, `transitPasses`, `withdrawalRequests`, `payoutApprovals`, `refundRequests`
7. **Safety & support:** `sosAlerts`, `sosAlertNotes`, `supportTickets`, `ticketReplies`, `broadcasts`
8. **Audit & settings:** `auditLogs`, `platformSettings` (+ seed the single row), `settingsChangeLogs`
