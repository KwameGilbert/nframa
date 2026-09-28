# Mobile App Integration Guide

**Last Updated:** 2026-09-28
**API Docs:** `/docs` (Swagger UI, generated from the same code this guide is based on — treat it as the source of truth if anything here ever looks stale)

Every response has the shape `{ "success": true, "message": "...", "data": ... }` on success, or `{ "success": false, "error": "..." }` on failure. `data` is `null` when there's nothing to return (e.g. delete, logout).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Rider Sign-Up & Sign-In](#rider-signup--signin)
3. [Driver Sign-Up & Sign-In](#driver-signup--signin)
4. [Driver Verification Documents](#driver-verification-documents)
5. [Driver Approval & Verification Status](#driver-approval--verification-status)
6. [Admin Document Review](#admin-document-review)
7. [Error Codes & Handling](#error-codes--handling)
8. [Rate Limiting](#rate-limiting)

---

## Authentication

**There is no separate "sign up" endpoint.** Riders and drivers sign up and sign in through the same two-step phone OTP flow: `POST /auth/login/otp` (send a code) then `POST /auth/login/verify` (verify it). If no account exists yet for that phone number, verifying the code **creates the account automatically** — the response tells you this happened via `isNewUser: true`.

Email + password login (`POST /auth/login`) only works for accounts that already have a password set. Riders/drivers never get one automatically — this path is mainly for admins (who are provisioned with a password) or any account that has gone through `/auth/password/forgot` to set one.

### Token Management

All authenticated endpoints require the `Authorization: Bearer <accessToken>` header.

- `accessToken` expires after **15 minutes**
- `refreshToken` is valid for **30 days** and is **single-use** — every refresh call revokes the one sent and issues a new pair
- On logout, clear both tokens and all cached user data

### Refresh Tokens

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "q3J8b1xN0pZ4mW7tE2vY9cR5kL6hG1sD8fA3uQ0iO4nB7xT2eV5wC9zM1yK6jH3g"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Tokens refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "new-refresh-token-string"
  }
}
```

**Response (401):**
```json
{
  "success": false,
  "error": "Invalid, expired, or already-used refresh token"
}
```
Clear stored tokens and send the user to sign-in.

**Response (403):**
```json
{
  "success": false,
  "error": "Account is suspended or deleted, or the admin account is not active — the session is revoked"
}
```

### Get the Signed-In Account

Use this to restore session state on app launch, or to refresh what the account can do after something changes server-side.

```http
GET /auth/me
Authorization: Bearer <accessToken>
```

**Response (200):** Same `user` shape documented under [Sign-In: Phone OTP](#2-verify-code--sign-in-or-sign-up) below.

### Log Out

```http
POST /auth/logout
Content-Type: application/json

{
  "refreshToken": "q3J8b1xN0pZ4mW7tE2vY9cR5kL6hG1sD8fA3uQ0iO4nB7xT2eV5wC9zM1yK6jH3g"
}
```

**Response (200):** always succeeds, even if the token was already invalid.
```json
{
  "success": true,
  "message": "Logged out successfully",
  "data": null
}
```

---

## Rider Sign-Up & Sign-In

### Flow Overview

```
Request OTP (phone)
  ↓
Verify OTP
  ├─ No account existed → account created automatically, isNewUser: true
  └─ Account existed → isNewUser: false
  ↓
Store accessToken + refreshToken
  ↓
If isNewUser (or user.profile is null): POST /rider to create the rider profile
  ↓
Optionally PATCH /users/{id} to fill in fullName, dateOfBirth, etc.
  ↓
Ready to use the app
```

### 1. Request OTP (Phone)

```http
POST /auth/login/otp
Content-Type: application/json

{
  "phoneCountryCode": "+233",
  "phoneNumber": "541436414",
  "role": "rider"
}
```

**`role` is required only when this phone number has no account yet** (i.e. this will be a signup). Omit it for an existing account — it's ignored if present.

**Response (200):**
```json
{
  "success": true,
  "message": "Verification code sent",
  "data": null
}
```

**Response (400) — role missing for a new number:**
```json
{
  "success": false,
  "error": "role is required to sign up"
}
```

**Response (429) — Rate Limited:**
```json
{
  "success": false,
  "error": "Too many requests — try again later (see the RateLimit headers for when)"
}
```
See [Rate Limiting](#rate-limiting) — this endpoint allows 5 codes per phone number per 15 minutes.

### 2. Verify Code → Sign In or Sign Up

Send the **same identifier** used above, plus the 6-digit code. The code expires after **5 minutes** and allows **5 wrong attempts** before it's locked.

```http
POST /auth/login/verify
Content-Type: application/json

{
  "phoneCountryCode": "+233",
  "phoneNumber": "541436414",
  "role": "rider",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "q3J8b1xN0pZ4mW7tE2vY9cR5kL6hG1sD8fA3uQ0iO4nB7xT2eV5wC9zM1yK6jH3g",
    "isNewUser": true,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "fullName": null,
      "email": null,
      "phoneCountryCode": "+233",
      "phoneNumber": "541436414",
      "dateOfBirth": null,
      "status": "active",
      "profilePicture": null,
      "oauthProvider": null,
      "role": "rider",
      "isPhoneVerified": true,
      "isEmailVerified": false,
      "isProfileComplete": false,
      "lastActiveAt": "2026-09-28T10:30:00Z",
      "createdAt": "2026-09-28T10:30:00Z",
      "updatedAt": "2026-09-28T10:30:00Z",
      "deletedAt": null,
      "profile": null,
      "adminRole": null,
      "permissions": {}
    }
  }
}
```

**`isNewUser: true`** only when this call just created the account. **`user.profile` is `null`** until a rider profile has been created (step 3) — use this, not `isNewUser`, to decide whether to show the "complete profile" flow, since a returning user who never finished onboarding will also have `profile: null`.

**Response (400) — bad/expired code:**
```json
{
  "success": false,
  "error": "Invalid verification code"
}
```
Other possible messages: `"No pending verification code for this identifier"`, `"Verification code has expired"`, `"Too many attempts, request a new code"`.

**Response (403):**
```json
{
  "success": false,
  "error": "Account is suspended or deleted, or the admin account is not active"
}
```

### 3. Create Rider Profile

Required once, right after the first successful sign-up (when `user.profile` is `null`).

```http
POST /rider
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Rider profile created successfully",
  "data": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-09-28T10:31:00Z"
  }
}
```

### 4. Fill In Profile Details (Optional)

```http
PATCH /users/{userId}
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "fullName": "John Doe",
  "dateOfBirth": "1995-04-12"
}
```

All fields are optional but at least one is required. Accepted fields: `fullName`, `email`, `phoneCountryCode`, `phoneNumber`, `dateOfBirth`, `profilePicture`.

**Response (200):** the full updated user object (same shape as `user` above, without `profile`/`adminRole`/`permissions`).

---

## Driver Sign-Up & Sign-In

### Flow Overview

```
Request OTP (phone, role: "driver") → Verify OTP
  ↓
Account created if new (isNewUser: true)
  ↓
Store tokens
  ↓
POST /driver — create driver profile (if user.profile is null)
  ↓
POST /vehicles — register their vehicle
  ↓
Get document types → Upload each required document
  ↓
Documents under review (see Driver Verification Documents below)
  ↓
Admin approves → driver.verificationStatus becomes "approved"
  ↓
Ready to accept rides
```

### 1. Request OTP & Verify — Same as Riders

Use the exact endpoints from [Rider Sign-Up & Sign-In](#rider-signup--signin) above, with `"role": "driver"` instead of `"rider"`.

The `user.profile` field, once a driver profile exists, will be the **flat** driver profile shape (not the nested one document endpoints return — see note below):
```json
"profile": {
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "code": "DR-7KQ2MX",
  "verificationStatus": "unverified",
  "ghanaCardNumber": null,
  "address": null,
  "isOnline": false,
  "autoAcceptBookings": false,
  "termsAcceptedAt": null
}
```

> **Important:** `GET /auth/me` and login responses return this **flat** profile shape under `user.profile`. The dedicated driver endpoints (`GET /driver/{userId}`, `POST /driver`, etc.) return a **differently-shaped, nested** object — see the next section. Don't assume they match; read each response's actual `data` shape.

### 2. Create Driver Profile

```http
POST /driver
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "ghanaCardNumber": "GHA-123456789-0",
  "address": "12 Oxford St, Osu, Accra"
}
```

`ghanaCardNumber` and `address` are both optional and can be added later via `PATCH /driver/{userId}`.

**Response (201) — note the `driver` wrapper:**
```json
{
  "success": true,
  "message": "Driver profile created successfully",
  "data": {
    "driver": {
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "code": "DR-7KQ2MX",
      "verificationStatus": "unverified",
      "ghanaCardNumber": "GHA-123456789-0",
      "address": "12 Oxford St, Osu, Accra",
      "isOnline": false,
      "autoAcceptBookings": false,
      "termsAcceptedAt": null,
      "user": { "id": "550e8400-...", "fullName": null, "role": "driver", "...": "..." },
      "vehicles": [],
      "documents": []
    }
  }
}
```

Every driver-returning endpoint (`POST /driver`, `GET /driver/{userId}`, `GET /drivers/code/{code}`, `GET /drivers/phone/{code}/{number}`, `PATCH /driver/{userId}`) uses this **same nested shape**: `{ driver: { ...profile fields, user, vehicles, documents } }`.

**Response (409) — profile already exists:**
```json
{
  "success": false,
  "error": "..."
}
```

### 3. Get / Update Driver Profile

```http
GET /driver/{userId}
Authorization: Bearer <accessToken>
```
Returns the same `{ driver: {...} }` shape as above. A driver can always read their own profile; reading someone else's needs `users: read`.

```http
PATCH /driver/{userId}
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "isOnline": true,
  "autoAcceptBookings": false
}
```
All fields optional (`ghanaCardNumber`, `address`, `isOnline`, `autoAcceptBookings`), at least one required. Same `{ driver: {...} }` response shape.

### 4. Register a Vehicle

```http
POST /vehicles
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "carOwnerUserId": "550e8400-e29b-41d4-a716-446655440000",
  "make": "Toyota",
  "model": "Corolla",
  "year": 2020,
  "color": "Silver",
  "plate": "GR 1234-21",
  "seats": 4
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Vehicle created successfully",
  "data": {
    "id": "a1b2c3d4-...",
    "carOwnerUserId": "550e8400-...",
    "make": "Toyota",
    "model": "Corolla",
    "year": 2020,
    "color": "Silver",
    "plate": "GR 1234-21",
    "seats": 4,
    "status": "active",
    "isVerified": false,
    "verificationDate": null,
    "createdAt": "2026-09-28T10:32:00Z",
    "updatedAt": "2026-09-28T10:32:00Z"
  }
}
```

`isVerified` is separate from document verification — it reflects an admin checking the vehicle's registration/roadworthiness documents.

---

## Driver Verification Documents

### Document Flow

```
1. GET /document-types — see what's needed
   ↓
2. POST /driver/verification/{documentTypeId} — upload each one
   ↓
3. Document status: PENDING
   ↓
4. [Admin Review]
   ├─ UNDER_REVIEW (admin is checking it)
   ├─ VERIFIED ✓ — accepted
   ├─ REJECTED ✗ — see `notes` for why; delete and re-upload
   └─ EXPIRED — delete and re-upload with a fresh document
   ↓
5. Driver's overall verificationStatus updates automatically after every review
   (see Driver Approval & Verification Status below)
```

### Get Document Types

Any signed-in user can list this — it's reference data for building the upload UI.

```http
GET /document-types
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Document types retrieved successfully",
  "data": [
    {
      "id": 1,
      "code": "NATIONAL_ID",
      "name": "National ID",
      "description": "Valid government-issued ID",
      "hasExpiry": false,
      "isRequired": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

Show a "required" badge for `isRequired: true` types — a driver can't be approved without submitting one of each.

### Upload a Document

```http
POST /driver/verification/{documentTypeId}
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

file: <binary>
```

- Formats: JPEG, PNG, WEBP, PDF
- Max size: **10 MB**
- Field name **must be `file`**

**Response (201):**
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "documentTypeId": 2,
    "fileUrl": "https://storage.example.com/verification/550e8400.../file.jpg",
    "status": "PENDING",
    "expiresAt": "2027-09-28T23:59:59Z",
    "notes": null,
    "uploadedAt": "2026-09-28T10:30:00Z",
    "verifiedAt": null,
    "verifiedBy": null,
    "deletedAt": null,
    "createdAt": "2026-09-28T10:30:00Z",
    "updatedAt": "2026-09-28T10:30:00Z"
  }
}
```

**Response (400):**
```json
{ "success": false, "error": "Invalid document type, missing/unsupported file, or file too large" }
```

**Response (409) — already submitted:**
```json
{ "success": false, "error": "You already submitted a Driver's License. Delete it first to submit a new one." }
```
If the existing document was already deleted (see below), uploading again **replaces** it instead of conflicting — same document `id`, fresh content, full history preserved.

### Get Driver's Own Documents

```http
GET /driver/verification
Authorization: Bearer <accessToken>
```

**Response (200):** array of documents, each with its `history` (status change log) nested in:
```json
{
  "success": true,
  "message": "Documents retrieved successfully",
  "data": [
    {
      "id": "a1b2c3d4-...",
      "userId": "550e8400-...",
      "documentTypeId": 2,
      "fileUrl": "https://storage.example.com/...",
      "status": "VERIFIED",
      "expiresAt": "2027-09-28T23:59:59Z",
      "notes": "Looks good",
      "uploadedAt": "2026-09-28T10:30:00Z",
      "verifiedAt": "2026-09-28T10:45:00Z",
      "verifiedBy": "admin-user-id",
      "deletedAt": null,
      "createdAt": "2026-09-28T10:30:00Z",
      "updatedAt": "2026-09-28T10:45:00Z",
      "history": [
        {
          "id": "hist-1",
          "documentId": "a1b2c3d4-...",
          "previousStatus": null,
          "newStatus": "PENDING",
          "changedBy": null,
          "notes": null,
          "changedAt": "2026-09-28T10:30:00Z",
          "createdAt": "2026-09-28T10:30:00Z"
        },
        {
          "id": "hist-2",
          "documentId": "a1b2c3d4-...",
          "previousStatus": "PENDING",
          "newStatus": "VERIFIED",
          "changedBy": "admin-id",
          "notes": "Looks good",
          "changedAt": "2026-09-28T10:45:00Z",
          "createdAt": "2026-09-28T10:45:00Z"
        }
      ]
    }
  ]
}
```

Only **non-deleted** documents are returned here — a deleted document simply disappears from this list until it's replaced.

**Document Status Reference:**

| Status | Meaning | Driver Action |
|--------|---------|----------------|
| `PENDING` | Just uploaded, awaiting review | Wait |
| `UNDER_REVIEW` | Admin is actively reviewing | Wait |
| `VERIFIED` | ✅ Accepted | None — done, unless it expires |
| `REJECTED` | ❌ Rejected — reason is in `notes` | Delete, fix the issue, re-upload |
| `EXPIRED` | Passed its `expiresAt` date | Delete and upload a fresh copy |

### Get a Document's History

```http
GET /verification/{documentId}/history
Authorization: Bearer <accessToken>
```
The document's own driver can always see it; anyone else needs `verification: read`.

**Response (200):** array of history entries (same shape as the `history` field above), newest first.

**Response (404):**
```json
{ "success": false, "error": "Document not found: {documentId}" }
```

### Delete a Document

Lets a driver remove and later re-upload (replace) a document — e.g. after a rejection, or to update an expiring one. This is a **soft delete**: the document's full history is preserved, and re-uploading the same type reuses the same document `id`.

```http
DELETE /verification/{documentId}
Authorization: Bearer <accessToken>
```

The document's own driver can delete it; an admin with `verification: delete` can delete any driver's document.

**Response (200):**
```json
{ "success": true, "message": "Document deleted successfully", "data": null }
```

**Response (404):**
```json
{ "success": false, "error": "Document not found: {documentId}" }
```

**Response (409) — already deleted:**
```json
{ "success": false, "error": "Document is already deleted" }
```

---

## Driver Approval & Verification Status

### Verification Status Values

| Status | Meaning |
|--------|---------|
| `unverified` | No documents submitted yet |
| `pending` | Documents awaiting/under review, **or** every document is verified and the driver is waiting for an admin to approve them |
| `approved` | ✅ An admin has approved the driver — the only way this status is ever set |
| `rejected` | At least one document was rejected |
| `expiring` | Was approved, but a document is now expired |

**Approval is never automatic.** Even once every required document type is submitted and verified, the driver stays `pending` until an admin explicitly approves them via the admin endpoint below. Show this clearly in the UI — "all documents verified, waiting on final approval" is a distinct, expected state.

### Requirements to Become `approved`

1. A document has been submitted for **every** `isRequired: true` document type (see `GET /document-types`)
2. Every submitted document's status is `VERIFIED`
3. None of them are past their `expiresAt`

If any of these fail, the admin's approval attempt is rejected with a message naming exactly what's missing/wrong — that message is safe to show directly to a driver support agent, but not usually surfaced to the driver's own app (they should rely on document statuses instead).

### Get Current Driver Status

```http
GET /driver/{userId}
Authorization: Bearer <accessToken>
```
Returns the full `{ driver: {...} }` shape from earlier, including `verificationStatus` and the nested `documents` array — poll this (or `GET /driver/verification`) to reflect status changes in the UI.

---

## Admin Document Review

**Admin-only.** Not for the driver-facing app, but documented here so the picture is complete — a driver support/back-office tool would use these.

### List Pending Documents

```http
GET /admin/driver/verification/pending
Authorization: Bearer <accessToken>
```
Requires `verification: read`. Returns every `PENDING`/`UNDER_REVIEW` document across all drivers, each with the submitting driver's name, email and phone attached.

### Review a Document

```http
PATCH /admin/verification/document/{documentId}
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "status": "VERIFIED",
  "notes": "Clear and valid"
}
```
`status` is one of `PENDING`, `UNDER_REVIEW`, `VERIFIED`, `REJECTED`. Requires `verification: update`. Updating a document's status also recalculates the driver's overall `verificationStatus` automatically (see above) — but never sets it to `approved`.

### Approve/Change a Driver's Overall Status

```http
PATCH /admin/driver/{userId}/verification
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "verificationStatus": "approved",
  "notes": "All documents verified, approved for service"
}
```
Requires `verification: update`. This is the **only** endpoint that can set a driver to `approved` — see [requirements above](#requirements-to-become-approved). Returns the full `{ driver: {...} }` shape.

**Response (400) — not ready for approval:**
```json
{ "success": false, "error": "Cannot approve driver: missing required document(s): National ID, Driver's License" }
```

---

## Error Codes & Handling

| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| 200 / 201 | Success | — | Use `data` |
| 400 | Validation error | No | Fix the request |
| 401 | Missing/invalid/expired access token | Refresh, then retry | Call `/auth/refresh`; if that fails, send to sign-in |
| 403 | Forbidden, or account suspended/deleted | No | Show the error message; sign out if the account is blocked |
| 404 | Not found | No | Check the ID being used |
| 409 | Conflict (duplicate, already exists/deleted) | No | Show the message, adjust the request |
| 429 | Rate limited | Yes, after waiting | See [Rate Limiting](#rate-limiting) |
| 500 | Server error | Yes, with backoff | Retry a couple of times, then surface a generic error |

---

## Rate Limiting

All limits are **per 15-minute window** and apply in addition to a generous per-IP flood guard (100 requests/IP on most auth endpoints, 300/IP on refresh — these exist mainly to stop abuse, not to affect normal use).

| Endpoint | Limit | Counts |
|----------|-------|--------|
| `POST /auth/login/otp` | 5 per phone/email | Every request |
| `POST /auth/login/verify` | 10 per phone/email | Failed attempts only |
| `POST /auth/login` | 10 per email | Failed attempts only |
| `POST /auth/password/forgot` | 5 per email | Every request |
| `POST /auth/password/reset` | 10 per email | Failed attempts only |
| `POST /auth/password/change` | 5 per account | Failed attempts only |
| `POST /auth/refresh` | 300 per IP | Every request |

**Response (429):**
```json
{
  "success": false,
  "error": "Too many requests — try again later (see the RateLimit headers for when)"
}
```
Standard `RateLimit` / `RateLimit-Policy` response headers (draft-8 format) tell you the limit and reset time — read those rather than hardcoding the table above, in case limits change server-side.

---

## Quick Reference: All Endpoints Used Above

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/login/otp` | — | Request a sign-up/sign-in code |
| POST | `/auth/login/verify` | — | Verify code, get tokens (creates account if new) |
| POST | `/auth/login` | — | Email + password sign-in (accounts with a password) |
| POST | `/auth/refresh` | — | Exchange refresh token for a new pair |
| GET | `/auth/me` | ✓ | Get the signed-in account |
| POST | `/auth/logout` | — | Revoke a refresh token |
| POST | `/auth/password/forgot` | — | Email a reset code |
| POST | `/auth/password/reset` | — | Set new password with the reset code |
| POST | `/auth/password/change` | ✓ | Change password while signed in |
| POST | `/rider` | ✓ | Create rider profile |
| GET | `/rider/{userId}` | ✓ | Get rider profile |
| POST | `/driver` | ✓ | Create driver profile |
| GET | `/driver/{userId}` | ✓ | Get driver profile (with vehicles/documents) |
| PATCH | `/driver/{userId}` | ✓ | Update driver profile / go online |
| POST | `/vehicles` | ✓ | Register a vehicle |
| PATCH | `/users/{id}` | ✓ | Update account details (fullName, dateOfBirth, etc) |
| GET | `/document-types` | ✓ | List document types to upload |
| POST | `/driver/verification/{documentTypeId}` | ✓ | Upload a document |
| GET | `/driver/verification` | ✓ | Get own documents with history |
| GET | `/verification/{documentId}/history` | ✓ | Get one document's history |
| DELETE | `/verification/{documentId}` | ✓ | Delete (soft) a document |
| GET | `/admin/driver/verification/pending` | ✓ (admin) | List documents awaiting review |
| PATCH | `/admin/verification/document/{documentId}` | ✓ (admin) | Review a document |
| PATCH | `/admin/driver/{userId}/verification` | ✓ (admin) | Approve/change driver status |

---

**Questions or discrepancies?** Cross-check against the live Swagger UI at `/docs` — it's generated directly from the backend's request/response schemas, so it can never drift from what the API actually does the way a hand-written doc can.
