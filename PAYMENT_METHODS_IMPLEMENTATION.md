# Payment Methods & Payouts - Complete Implementation Summary

## What Was Built

### 1. **Unified Payment Methods System**
- Single `paymentMethods` table for both riders and drivers
- Three payment types: card, mobile_money, bank_account
- Support for dual providers: Hubtel (primary) and Paystack (fallback)
- Tokenization with verification flow (OTP/challenge)
- Status tracking: pending → verified → active
- Primary method selection

### 2. **Driver Payout System**
- `payoutMethods` table linking verified payment methods to driver payouts
- Automatic and manual payout triggering
- Configurable frequency (daily, weekly, monthly)
- Minimum threshold-based auto payouts
- Payout history tracking with status progression

### 3. **Provider Integration**
**Hubtel Service** (`src/services/hubtel.service.ts`):
- Card tokenization
- Mobile money tokenization  
- Bank account tokenization with validation
- Fund transfer via provider API

**Paystack Service** (Enhanced `src/services/paystack.service.ts`):
- Card tokenization
- Mobile money tokenization
- Fund transfer support
- Webhook signature verification (existing)

**Payment Service** (`src/services/payment.service.ts`):
- Abstraction layer selecting Hubtel or Paystack based on `PAYMENT_PROVIDER` env
- Automatic fallback to secondary provider on failure
- Unified tokenization and transfer interface

### 4. **Models** (all in `src/models/`)

**PaymentMethodModel**:
- `create()` - add new payment method
- `listByUser(userId, verified?)` - list with pagination
- `setAsPrimary(id, userId)` - set as primary
- `requestVerification(id, token)` - generate verification challenge
- `verify(id)` - confirm verification
- `softDelete(id)` - mark as inactive
- `adminListAll(filters)` / `adminUpdate(id, updates)` - admin functions

**PayoutMethodModel**:
- `create()` - link payment method for payouts
- `listByDriver(driverId)` - get driver's payout methods
- `getPrimary(driverId)` - get primary method
- `setPrimary(id, driverId)` - set as primary
- `setAutomatic()` - configure automatic payouts
- `recordPayout()` - update last payout timestamp
- `listForAutomaticPayout()` - find eligible for scheduled payouts

**PayoutHistoryModel**:
- `record()` - create payout entry
- `listByDriver()` - payout history with filtering
- `updateStatus()` - track payout state changes
- `getStats()` - aggregate payout metrics
- `adminListAll()` - admin global view

### 5. **Controllers** (in `src/controllers/`)

**paymentMethod.controller.ts**:
- User: create, list, get, update, verify, delete payment methods
- Admin: list all, force-update/verify users' methods
- Authorization: self-access or users permission

**payout.controller.ts**:
- Driver: add payout methods, enable auto-pay, trigger manual payout
- Driver: view payout history and statistics
- Admin: view driver payouts, trigger admin payouts, view history/stats
- Authorization: driver-only for own payouts, payouts permission for admin

### 6. **Routes** (in `src/routes/`)

**paymentMethod.routes.ts**:
```
POST   /payment-methods                    - Add method
GET    /payment-methods                    - List methods
GET    /payment-methods/:id                - Get details
PATCH  /payment-methods/:id                - Update method
POST   /payment-methods/:id/verify         - Verify with OTP
DELETE /payment-methods/:id                - Remove method
GET    /payment-methods/admin/users        - Admin: list all
PATCH  /payment-methods/admin/users/:userId/:id - Admin: update
```

**payout.routes.ts**:
```
POST   /payouts/methods                    - Driver: Add payout method
GET    /payouts/methods                    - Driver: List methods
PATCH  /payouts/methods/:id                - Driver: Update settings
POST   /payouts/methods/:id/trigger        - Driver: Manual payout
GET    /payouts/history                    - Driver: View history
GET    /payouts/stats                      - Driver: View stats
GET    /payouts/admin/users/:driverId/methods         - Admin: List methods
GET    /payouts/admin/history              - Admin: View all history
GET    /payouts/admin/users/:driverId/history         - Admin: View driver history
POST   /payouts/admin/users/:driverId/trigger         - Admin: Trigger payout
GET    /payouts/admin/users/:driverId/stats           - Admin: View stats
```

### 7. **Schemas** (in `src/schemas/`)

**paymentMethod.schema.ts**:
- `createPaymentMethodSchema` - type, provider, token, metadata
- `verifyPaymentMethodSchema` - verification token input
- `updatePaymentMethodSchema` - display name, isPrimary
- Response schemas for OpenAPI documentation

**payout.schema.ts**:
- `createPayoutMethodSchema` - link payment method, auto settings
- `updatePayoutMethodSchema` - auto enable/disable, thresholds
- `triggerPayoutSchema` - optional manual amount
- Response schemas with pagination

### 8. **Databases**

**Migrations**:
- `20261003_create_payment_methods_table.ts` - Payment methods with verification
- `20261003_create_payout_methods_table.ts` - Driver payout configuration
- `20261003_create_payout_history_table.ts` - Payout attempt log
- `20261003_grant_payouts_to_superadmin.ts` - Super admin permission

**Schema Features**:
- Unique constraint on (userId, tokenizedReference) for payment methods
- Unique constraint on (paymentMethodId, driverId) for payout methods
- Partial unique index for one active SOS per user (from previous work)
- Proper FK cascades and indexing for performance

### 9. **OpenAPI Documentation**

**paymentMethod.docs.ts**:
- All user endpoints with request/response schemas
- Admin endpoints with permission requirements
- Error examples for 400, 403, 404, 409

**payout.docs.ts**:
- All driver and admin endpoints documented
- Payout status and initiation types
- Statistics and history filtering

### 10. **Tests**

**tests/paymentMethods.test.ts** (11 tests):
- Create card/mobile money payment methods
- List and get payment methods
- Update display name and set primary
- Verify with OTP
- Soft delete
- Access control (user isolation)
- Admin listing
- Uniqueness constraint enforcement

**tests/payouts.test.ts** (11 tests):
- Add payout method with verified payment method
- Prevent unverified payment methods
- List payout methods
- Set as primary
- Enable automatic payouts
- View history and statistics
- Manual payout triggering
- Admin endpoints for drivers
- Role-based restrictions (drivers only)

### 11. **Activity Logging**
All operations logged with:
- Payment method add/update/delete/verify
- Payout method configuration changes
- Payout initiation (manual or automatic)
- Payout success/failure with reasons
- Admin overrides tracked

### 12. **Configuration**
- New "payouts" module added to `MODULES` in `src/config/permissions.ts`
- Supports read/update/delete actions on payouts module
- Super admin automatically granted all payout permissions

## Environment Variables Required

```env
# Payment Provider (hubtel or paystack, defaults to paystack)
PAYMENT_PROVIDER=paystack

# Hubtel Configuration
HUBTEL_API_KEY=your_hubtel_key
HUBTEL_API_URL=https://api.hubtel.com

# Paystack Configuration (existing)
PAYSTACK_SECRET_KEY=your_paystack_key
PAYSTACK_FALLBACK_EMAIL_DOMAIN=example.com

# Optional
PAYSTACK_CALLBACK_URL=https://yourapp.com/payment-callback
```

## Key Design Decisions

1. **Single Payment Methods Table**: Unified table for riders and drivers reduces duplication; role context determines usage
2. **Provider Abstraction**: PaymentService layer allows switching providers via env without code changes
3. **Tokenization Required**: All payment methods must be tokenized with provider before use; never storing raw card/account data
4. **Verification Flow**: OTP/challenge from provider ensures customer controls account
5. **Wallet-Based Payouts**: Drivers paid from wallet; admin can trigger automatic or manual payouts
6. **Soft Deletes**: Payment methods marked inactive rather than deleted for audit trail
7. **Activity Logging**: All payout operations tracked for compliance/debugging
8. **State Machine**: Payout history tracks status progression (pending → processing → completed/failed)

## How to Use

### For Drivers

**Add Payment Method (e.g., Mobile Money)**:
```bash
POST /payment-methods
{
  "type": "mobile_money",
  "provider": "hubtel",
  "tokenizedReference": "<token-from-hubtel>",
  "metadata": {
    "phoneNumber": "+233541234567",
    "operator": "mtn"
  }
}
```

**Verify with OTP**:
```bash
POST /payment-methods/:id/verify
{ "verificationToken": "123456" }
```

**Add Payout Method**:
```bash
POST /payouts/methods
{
  "paymentMethodId": "<payment-method-id>",
  "isAutomatic": true,
  "minimumThreshold": 50.00,
  "payoutFrequency": "daily"
}
```

**Trigger Manual Payout**:
```bash
POST /payouts/methods/:id/trigger
```

**View Payout Stats**:
```bash
GET /payouts/stats
```

### For Admins

**View All Payment Methods**:
```bash
GET /payment-methods/admin/users?verified=true
```

**Force Verify Method**:
```bash
PATCH /payment-methods/admin/users/:userId/:methodId
{ "isVerified": true, "verificationStatus": "verified" }
```

**Trigger Driver Payout**:
```bash
POST /payouts/admin/users/:driverId/trigger
```

**View Payout History**:
```bash
GET /payouts/admin/users/:driverId/history?status=completed&page=1
```

## Testing

Run tests:
```bash
pnpm test paymentMethods    # Payment method tests
pnpm test payouts           # Payout system tests
```

All tests create/clean up their own data via the cleanup system.

## Migrations

User must run migrations before features work:
```bash
pnpm migrate
```

This creates the three new tables and grants payouts permission to super admin.

## Next Steps (Not Implemented)

- Automatic payout scheduler (would need a cron job or background worker)
- Webhook handling for Hubtel/Paystack transfer status updates
- Rate limiting on payment method creation
- PCI compliance (don't store raw card numbers anywhere)
- Multi-currency support (currently GHS only)
- Payment method expiry tracking (e.g., card expiration)
- Fraud detection/velocity checks
