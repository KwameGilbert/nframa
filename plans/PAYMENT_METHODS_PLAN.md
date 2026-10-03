# Payment Methods & Payouts Implementation Plan

## Overview
Unified payment method system for riders (payment) and drivers (payouts). Supports card, mobile money, and bank account with Hubtel/Paystack abstraction layer.

## Database Schema

### `paymentMethods` Table
```
id: UUID
userId: UUID (FK users.id)
userRole: 'rider' | 'driver' (denormalized from users.role)
type: 'card' | 'mobile_money' | 'bank_account'
provider: 'hubtel' | 'paystack'
tokenizedReference: string (provider's token/reference)
displayName: string (last 4 digits, phone, or account number)
isVerified: boolean
verificationStatus: 'pending' | 'verified' | 'failed'
verificationToken?: string (one-time token for OTP/challenge)
verificationAttempts: int
verificationFailedAt?: timestamp
verificationCompletedAt?: timestamp
isActive: boolean
isPrimary: boolean (default payment/payout method)
createdAt: timestamp
updatedAt: timestamp
verifiedAt?: timestamp
metadata: jsonb (card expiry, bank name, mobile operator, etc.)
```

### `payoutMethods` Table (subset of paymentMethods for drivers)
Links to paymentMethods but tracks payout-specific settings:
```
id: UUID
paymentMethodId: UUID (FK paymentMethods.id)
driverUserId: UUID (FK users.id)
isAutomatic: boolean (auto-payout when threshold met)
minimumThreshold: numeric (GHS - trigger auto payout)
payoutFrequency: 'daily' | 'weekly' | 'monthly' (if automatic)
lastPayoutAt?: timestamp
nextScheduledPayout?: timestamp
createdAt: timestamp
updatedAt: timestamp
```

### `payoutHistory` Table
```
id: UUID
driverUserId: UUID
payoutMethodId: UUID
amount: numeric
currency: char(3) = 'GHS'
status: 'pending' | 'processing' | 'completed' | 'failed'
providerReference: string (Hubtel/Paystack reference)
failureReason?: string
initiatedBy: UUID (user or system)
initiatedAt: timestamp
completedAt?: timestamp
metadata: jsonb
createdAt: timestamp
```

## Services Layer

### PaystackService (Enhanced)
- `tokenizeCard(cardDetails)` → token
- `tokenizeMobileMoney(phone, provider)` → token
- `verifyToken(token)` → boolean
- `transferFunds(reference, amount, metadata)` → result

### HubtelService (New)
- `tokenizeCard(cardDetails)` → token
- `tokenizeMobileMoney(phone, operator)` → token
- `tokenizeBankAccount(account, bank)` → token
- `verifyToken(token)` → boolean
- `transferFunds(reference, amount, metadata)` → result
- `validateBankAccount(account, bank)` → boolean

### PaymentService (Abstraction)
- Routes all payment operations to Hubtel or Paystack based on `PAYMENT_PROVIDER` env
- Methods:
  - `tokenize(type, details)` → token
  - `verify(token)` → boolean
  - `transfer(reference, amount, metadata)` → result
  - Fallback: if primary fails, try secondary provider

## Models

### PaymentMethodModel
- `create(userId, type, provider, tokenizedReference, metadata)`
- `findById(id)` with verification status
- `listByUser(userId, verified?: boolean)`
- `update(id, updates)` - audit logged
- `verify(id, verificationToken)` 
- `setAsPrimary(id, userId)`
- `delete(id)` - soft delete (isActive = false)
- `requestVerification(id)` - generates challenge/OTP
- Admin: `getAll(filters)`, `updateUserMethod(userId, methodId, updates)`

### PayoutMethodModel
- `create(paymentMethodId, driverUserId, isAutomatic, threshold, frequency)`
- `findByDriver(driverUserId)`
- `setPrimary(driverUserId, payoutMethodId)`
- `setAutomatic(id, isAutomatic, threshold, frequency)`
- Admin: `listAll(filters)`, `manuallyTriggerPayout(driverUserId)`

### PayoutHistoryModel
- `record(driverUserId, payoutMethodId, amount, status, providerRef, initiatedBy)`
- `findByDriver(userId, filters)` - paginated
- `getStats(driverUserId)` - total paid, failed, pending
- Admin: `listAll(filters)`

## Controllers

### PaymentMethodController
**User endpoints** (`/payment-methods`):
- `POST /` - create & tokenize (request OTP verification)
- `GET /` - list user's methods
- `GET /:id` - detail with verification status
- `PATCH /:id` - update (name, isPrimary)
- `POST /:id/verify` - submit verification token (OTP)
- `POST /:id/reverify` - request new verification
- `DELETE /:id` - soft delete

**Admin endpoints** (`/admin/payment-methods`):
- `GET /users/:userId` - list user's methods
- `GET /users/:userId/:id` - get details
- `PATCH /users/:userId/:id` - force update/verify
- `DELETE /users/:userId/:id` - admin delete

### PayoutMethodController
**Driver endpoints** (`/payouts/methods`):
- `POST /` - add payout method (link existing payment method)
- `GET /` - list driver's payout methods
- `PATCH /:id` - update (isPrimary, autoPaySettings)
- `DELETE /:id` - remove
- `POST /:id/manual` - trigger immediate payout (if verified)
- `GET /history` - payout history with pagination
- `GET /stats` - payout statistics

**Admin endpoints** (`/admin/payouts`):
- `GET /methods/:driverId` - list driver's payout methods
- `PATCH /methods/:driverId/:id` - update settings
- `GET /history/:driverId` - payout history
- `GET /history` - all payouts (with filters)
- `POST /trigger/:driverId` - admin-triggered payout
- `GET /stats/:driverId` - driver's stats

## Routes & Authorization

### Payment Methods
- Own methods: read/write with `requireSelfOrPermission`
- Admin access: `users:read` permission for viewing others, `payments:admin` for editing

### Payouts
- Own payouts: `users:read` on own, `requireSelfOrPermission`
- Admin: new permission `payouts:read`, `payouts:admin`

## Verification Flow

1. User adds payment method → `POST /payment-methods` with details
2. Endpoint tokenizes with provider (card/mobile/bank)
3. Response includes verification status + challenge type
4. For card: provider sends OTP/3D challenge
5. For mobile: SMS with OTP
6. For bank: account name verification or micro-deposit (later)
7. User submits: `POST /payment-methods/:id/verify` with token
8. Service validates with provider
9. On success: `isVerified = true`, `verificationCompletedAt` set

## Payout Triggers

### Manual
- Driver calls `POST /payouts/methods/:id/manual`
- Requires: method verified, balance > 0, not rate-limited
- Creates `payoutHistory` entry, calls transfer

### Automatic (if enabled on payout method)
- Cron job (daily/weekly/monthly) checks `payoutMethods` where `isAutomatic = true`
- If driver's wallet balance ≥ `minimumThreshold`:
  - Create payout entry
  - Transfer funds
  - Update `lastPayoutAt`, `nextScheduledPayout`

## Activity Logging

- Payment method add/update/delete
- Payment method verification attempt (success/failure)
- Payout method configuration change
- Payout triggered (manual or automatic)
- Payout success/failure

## Testing Strategy

### Payment Methods
- Tokenization with Hubtel/Paystack mocks
- Verification OTP flow
- User vs admin CRUD
- Listing with filters (verified/active)
- Primary method selection
- Soft delete

### Payouts
- Driver adds/configures payout methods
- Manual payout trigger
- Auto-payout eligibility check
- Payout history tracking
- Admin-triggered payouts
- Rate limiting on manual payouts

### Integration
- Provider fallback (primary fails → try secondary)
- Concurrent payment method creation
- Payout while driver is on trip (balance lock check)

## Implementation Order

1. Migrations (3 tables)
2. Hubtel service
3. Enhanced Paystack service
4. Payment service abstraction
5. PaymentMethod model
6. PayoutMethod model
7. PayoutHistory model
8. Payment method routes/controller
9. Payout routes/controller
10. Verification flow
11. Payout job/scheduler
12. Tests (payment methods + payouts)
13. OpenAPI docs
14. Activity logging integration
