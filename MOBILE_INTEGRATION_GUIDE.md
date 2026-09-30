# Mobile App Integration Guide

**Last Updated:** 2026-09-30
**API Docs:** `/docs` (Swagger UI, generated from the same code this guide is based on — treat it as the source of truth if anything here ever looks stale)

Every response has the shape `{ "success": true, "message": "...", "data": ... }` on success, or `{ "success": false, "error": "..." }` on failure. `data` is `null` when there's nothing to return (e.g. delete, logout).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Rider Sign-Up & Sign-In](#rider-signup--signin)
3. [Driver Sign-Up & Sign-In](#driver-signup--signin)
4. [Driver Verification Documents](#driver-verification-documents)
5. [Driver Approval & Verification Status](#driver-approval--verification-status)
6. [Trips (Rider Booking)](#trips-rider-booking)
7. [Trips (Driver Side)](#trips-driver-side)
8. [Real-Time Events (Socket.IO)](#real-time-events-socketio)
9. [Admin Document Review](#admin-document-review)
10. [Error Codes & Handling](#error-codes--handling)
11. [Rate Limiting](#rate-limiting)

---

## Authentication

**There is no separate "sign up" endpoint.** Riders and drivers sign up and sign in through the same two-step phone OTP flow: `POST /auth/login/otp` (send a code) then `POST /auth/login/verify` (verify it). If no account exists yet for that phone number, verifying the code **creates the account automatically** — the response tells you this happened via `isNewUser: true`.

**A deleted rider or driver account can sign up again** with the same phone number, exactly like a new number (`role` required). Verifying the code brings back the same account (same `id`) as the role chosen now, with a clean profile — `fullName`, `email`, `dateOfBirth`, `profilePicture` and any password are cleared — and `isNewUser: true`, so show onboarding. Every session from before the deletion is signed out. Any earlier driver profile is reset — back to `verificationStatus: "unverified"` with no Ghana card number or address — its verification documents are deleted, its commutes paused and its vehicles retired, so a driver goes through onboarding and verification again. The wallet balance, transactions and trips stay with the account. `user.profile` can still be non-null (the reset driver profile, or an earlier rider profile), so check it rather than assuming `null`. A suspended account stays suspended (403) even after deletion.

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
  ├─ Deleted rider/driver account → same account reactivated with a clean profile, isNewUser: true
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

**`role` is required only when this phone number has no account yet, or its rider/driver account was deleted** (i.e. this will be a signup). Omit it for an existing account — it's ignored if present.

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

**`isNewUser: true`** only when this call just created the account (or re-registered a deleted one). **`user.profile` is `null`** until a rider profile has been created (step 3) — use this, not `isNewUser`, to decide whether to show the "complete profile" flow, since a returning user who never finished onboarding will also have `profile: null`.

**Response (400) — bad/expired code:**

```json
{
  "success": false,
  "error": "Invalid verification code"
}
```

Other possible messages: `"No pending verification code for this identifier"` (also what the second of two simultaneous verifies with the same code gets — each code works once), `"Verification code has expired"`, `"Too many attempts, request a new code"`.

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
{
  "success": false,
  "error": "You already submitted a Driver's License. Delete it first to submit a new one."
}
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

| Status         | Meaning                            | Driver Action                    |
| -------------- | ---------------------------------- | -------------------------------- |
| `PENDING`      | Just uploaded, awaiting review     | Wait                             |
| `UNDER_REVIEW` | Admin is actively reviewing        | Wait                             |
| `VERIFIED`     | ✅ Accepted                        | None — done, unless it expires   |
| `REJECTED`     | ❌ Rejected — reason is in `notes` | Delete, fix the issue, re-upload |
| `EXPIRED`      | Passed its `expiresAt` date        | Delete and upload a fresh copy   |

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

| Status       | Meaning                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `unverified` | No documents submitted yet                                                                                                |
| `pending`    | Documents awaiting/under review, **or** every document is verified and the driver is waiting for an admin to approve them |
| `approved`   | ✅ An admin has approved the driver — the only way this status is ever set                                                |
| `rejected`   | At least one document was rejected                                                                                        |
| `expiring`   | Was approved, but a document is now expired                                                                               |

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

Returns the full `{ driver: {...} }` shape from earlier, including `verificationStatus` and the nested `documents` array — poll this (or `GET /driver/verification`) to reflect status changes in the UI, or use the `driver:verification_status_changed` socket event below to avoid polling entirely.

---

## Trips (Rider Booking)

A trip is one rider's seat on one date's run of a driver's commute. Riders find commutes near them, request a seat from a pickup to a drop-off along the commute's route, and pay from their wallet. All dates are service dates in Ghana time (UTC+0), `YYYY-MM-DD`.

### Trip Statuses

| Status      | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `pending`   | Requested, waiting for the driver. Takes no seat and holds no money. Expires at `expiresAt`.         |
| `accepted`  | Seat confirmed. The trip's `totalAmount` is **held** in the rider's wallet (not charged yet).        |
| `boarded`   | The driver scanned the rider on board; the hold became the charge.                                   |
| `completed` | Trip finished.                                                                                       |
| `declined`  | The driver said no. Nothing was held.                                                                |
| `cancelled` | Cancelled by the rider or driver (`cancelledBy`). Any hold is released; nobody is charged.           |
| `no_show`   | The rider didn't turn up. The hold is released.                                                      |
| `expired`   | The driver didn't answer a pending request in time (`trips.requestExpiryMinutes`, or by the pickup). |

**Holds:** while a trip is `accepted`, its total is reserved: `GET /wallet` shows it in `heldAmount`, and `availableBalance` (`balance - heldAmount`) is what the rider can still spend. The `balance` itself only drops when the rider boards. A request needs `availableBalance` at least the trip's total.

### 1. Find Commutes

**Riders only.**

```http
GET /trips/available?lat=5.6224&lng=-0.1737&date=2026-10-01&page=1&limit=20
Authorization: Bearer <accessToken>
```

Returns commutes whose start is within `trips.availabilityRadiusKm` (default 5 km) of `lat`/`lng`, running on `date`'s weekday, with an approved driver, a seat left, and (for today) not yet departed. `date` must be from today to `trips.bookingWindowDays` (default 7) ahead, or you get `400`. Nearest start first.

**Response (200):**

```json
{
  "success": true,
  "message": "Available trips retrieved successfully",
  "data": {
    "items": [
      {
        "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
        "driver": { "id": "550e8400-...", "firstName": "Kwame", "profilePicture": null },
        "vehicle": { "make": "Toyota", "model": "Corolla", "color": "Silver" },
        "startAddress": "Accra Mall, Tetteh Quarshie, Accra",
        "startLat": 5.6224,
        "startLng": -0.1737,
        "endAddress": "Oxford Street, Osu, Accra",
        "endLat": 5.556,
        "endLng": -0.182,
        "departureAt": "2026-10-01T07:30:00.000Z",
        "seatsLeft": 2,
        "distanceToStartMeters": 850,
        "distanceMeters": 9620,
        "durationSeconds": 962
      }
    ],
    "pagination": { "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 }
  }
}
```

No price per commute: once the rider picks a pickup and drop-off, call `POST /fares/estimate` with them.

### 2. Request a Seat

**Riders only** (with a rider profile).

```http
POST /trips
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "pickup": { "address": "Airport Junction, Accra", "lat": 5.6051, "lng": -0.1757 },
  "dropoff": { "address": "Danquah Circle, Osu, Accra", "lat": 5.5635, "lng": -0.1806 }
}
```

The pickup and drop-off must each be within `trips.routeToleranceKm` (default 1 km) of the line from the commute's start to its end, with the pickup first in the direction of travel. The pickup time is worked out from the commute's departure (`scheduledPickupAt`); it must still be ahead. The price comes from the driving route between pickup and drop-off: `fare` (what the driver earns) plus `platformFee` and `bookingFee` makes `totalAmount`.

- If the driver accepts bookings automatically, the trip comes back `accepted` ("Trip booked successfully"): the seat is taken and `totalAmount` is held.
- Otherwise it comes back `pending` ("Trip requested successfully") until the driver answers, or it expires at `expiresAt`.

**Response (201):** the trip, in the same shape as `GET /trips/{id}` below.

**Errors:**

| Status | `error`                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| 400    | `Create your rider profile before requesting trips`                          |
| 400    | `You can't book your own commute`                                            |
| 400    | `This commute doesn't run on 2026-10-01`                                     |
| 400    | `The date can't be in the past` / `Trips can be booked at most 7 days ahead` |
| 400    | `Pickup is more than 1 km from the commute's route` (or `Drop-off is ...`)   |
| 400    | `Drop-off must come after pickup in the commute's direction of travel`       |
| 400    | `This trip's pickup time has already passed`                                 |
| 403    | `Only riders can request trips`                                              |
| 404    | `Commute not found: <id>`                                                    |
| 409    | `This commute is not taking bookings` (paused, or the driver isn't approved) |
| 409    | `Insufficient wallet balance` — top up first                                 |
| 409    | `You already have a trip at that time` (another commute overlapping in time) |
| 409    | `You already have a trip on this commute for that date`                      |
| 409    | `This commute is full` (no seat left on that date)                           |
| 503    | `Fares are not configured`                                                   |

### 3. List My Trips

```http
GET /trips?when=upcoming&status=accepted&page=1&limit=20
Authorization: Bearer <accessToken>
```

Riders get their own trips; drivers get the trips on their commutes. `when=upcoming` (default): `pending`, `accepted` or `boarded` and not over yet (boarded, or the drop-off still ahead), soonest first. `when=past`: everything else, newest first. `status` is optional. Each item is the trip plus `commute` (`startAddress`, `endAddress`, `departureAt`), `driver` (`fullName`, `profilePicture`) and `rider` (`firstName`, `profilePicture`); the boarding code is only in `GET /trips/{id}`.

### 4. Get a Trip

```http
GET /trips/{id}
Authorization: Bearer <accessToken>
```

For the trip's rider or driver.

**Response (200):**

```json
{
  "success": true,
  "message": "Trip retrieved successfully",
  "data": {
    "id": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
    "commuteId": "3f2b8c1e-...",
    "riderUserId": "4d1a55bb-...",
    "driverUserId": "550e8400-...",
    "tripDate": "2026-10-01",
    "status": "accepted",
    "pickup": { "address": "Airport Junction, Accra", "lat": 5.6051, "lng": -0.1757 },
    "dropoff": { "address": "Danquah Circle, Osu, Accra", "lat": 5.5635, "lng": -0.1806 },
    "pickupProgress": 0.25,
    "dropoffProgress": 0.9,
    "distanceMeters": 6000,
    "durationSeconds": 600,
    "scheduledPickupAt": "2026-10-01T07:34:00.000Z",
    "scheduledDropoffAt": "2026-10-01T07:44:26.000Z",
    "expiresAt": null,
    "fare": 22,
    "platformFee": 2.2,
    "bookingFee": 1,
    "totalAmount": 25.2,
    "driverEarnings": 22,
    "waitCharge": 0,
    "waitMinutes": null,
    "heldAmount": 25.2,
    "fareBreakdown": {
      "currency": "GHS",
      "base": 5,
      "distance": 12,
      "time": 5,
      "wait": 0,
      "fare": 22,
      "platformFee": 2.2,
      "bookingFee": 1,
      "total": 25.2,
      "driverEarnings": 22
    },
    "boardingCode": "TR-7KQ2MX",
    "acceptedAt": "2026-09-30T13:02:11.000Z",
    "arrivedAt": null,
    "boardedAt": null,
    "completedAt": null,
    "cancelledAt": null,
    "cancelledBy": null,
    "cancellationReason": null,
    "createdAt": "2026-09-30T13:02:11.000Z",
    "updatedAt": "2026-09-30T13:02:11.000Z",
    "commute": {
      "startAddress": "Accra Mall, Tetteh Quarshie, Accra",
      "startLat": 5.6224,
      "startLng": -0.1737,
      "endAddress": "Oxford Street, Osu, Accra",
      "endLat": 5.556,
      "endLng": -0.182,
      "departureAt": "2026-10-01T07:30:00.000Z"
    },
    "driver": { "fullName": "Kwame Mensah", "profilePicture": null, "phone": "+233241234567" },
    "rider": { "fullName": "Ama Owusu", "profilePicture": null, "phone": null },
    "vehicle": { "make": "Toyota", "model": "Corolla", "color": "Silver", "plate": "GR 1234-21" },
    "seatsLeft": 1,
    "otherCommuters": [{ "firstName": "Kofi", "profilePicture": null }],
    "stops": [
      {
        "type": "pickup",
        "address": "Airport Junction, Accra",
        "lat": 5.6051,
        "lng": -0.1757,
        "scheduledAt": "2026-10-01T07:34:00.000Z",
        "isYou": true
      },
      {
        "type": "pickup",
        "address": "37 Military Hospital",
        "lat": 5.588,
        "lng": -0.178,
        "scheduledAt": "2026-10-01T07:38:00.000Z",
        "isYou": false
      },
      {
        "type": "dropoff",
        "address": "Danquah Circle, Osu, Accra",
        "lat": 5.5635,
        "lng": -0.1806,
        "scheduledAt": "2026-10-01T07:44:26.000Z",
        "isYou": true
      },
      {
        "type": "dropoff",
        "address": "Oxford Street, Osu, Accra",
        "lat": 5.556,
        "lng": -0.182,
        "scheduledAt": "2026-10-01T07:46:00.000Z",
        "isYou": false
      }
    ]
  }
}
```

What each viewer sees:

- `boardingCode` — the rider only (show it as a QR/code for the driver to scan). `null` for the driver.
- `driver.phone` — the rider only, once the trip is `accepted` (or later). `rider.phone` — the driver only, once `accepted`. `vehicle.plate` — once `accepted`.
- `otherCommuters` — the other riders with a confirmed seat on this run: first name and photo only.
- `stops` — every confirmed rider's pickup and drop-off in route order, without names; `isYou` marks this trip's own.
- Until the rider's own trip is `accepted`, the rider sees no other riders: `otherCommuters` is empty and `stops` holds only their own pickup and drop-off.

### 5. Cancel a Trip

```http
POST /trips/{id}/cancel
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "reason": "Plans changed" }
```

`reason` is optional (the body can be empty). The rider can cancel a `pending` or `accepted` trip; the driver can cancel an `accepted` one. Cancelling an accepted trip frees the seat and releases the hold: nothing is charged. Returns the updated trip (`200`). Other statuses answer `409` (`Can't cancel a trip that is boarded`, `... that is cancelled`, ...); anyone else gets `403` (`Only the trip's rider or driver can cancel it`).

---

## Trips (Driver Side)

Drivers get `trip:requested` for every new request on their commutes. A `pending` request waits for the driver to accept or decline it until `expiresAt`; drivers who turned on `autoAcceptBookings` get requests already `accepted`. `GET /trips` lists the trips on the driver's commutes; `GET /trips/{id}` shows one (never with the boarding code: the driver scans it from the rider's phone).

### 1. Accept a Request

```http
PATCH /trips/{id}/accept
Authorization: Bearer <accessToken>
```

**The trip's driver only.** Gives the rider the seat and holds the trip's `totalAmount` in the rider's wallet, in one step: two accepts can never hand out the same seat or hold the money twice. Returns the trip (`200`, "Trip accepted successfully") in the `GET /trips/{id}` shape, now with `rider.phone`. The rider gets `trip:accepted`.

**Errors:**

| Status | `error`                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| 403    | `Only the trip's driver can accept it`                                                      |
| 404    | `Trip not found: <id>`                                                                      |
| 409    | `Can't accept a trip that is accepted` (or `declined`, `cancelled`, `expired`, ...)         |
| 409    | `This commute is not taking bookings` (the commute is paused, or your approval was revoked) |
| 409    | `This commute is full` (no seat left on that date)                                          |
| 409    | `The rider's wallet no longer covers this trip` (the request stays pending; decline it)     |

### 2. Decline a Request

```http
PATCH /trips/{id}/decline
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "reason": "Car is full of family today" }
```

**The trip's driver only**, and only a `pending` request (to drop an `accepted` rider, cancel with `POST /trips/{id}/cancel`). `reason` is optional (the body can be empty) and is shown to the rider as `cancellationReason`. Nothing was held, so no money moves. Returns the trip (`200`, "Trip declined successfully", `status: "declined"`, `cancelledBy: "driver"`). The rider gets `trip:declined`. Errors: `403` `Only the trip's driver can decline it`, `404`, `409` `Can't decline a trip that is accepted` (or any other non-pending status).

### 3. Manifest: a Commute's Trips on a Date

```http
GET /commutes/{id}/trips?date=2026-10-01&status=accepted&page=1&limit=20
Authorization: Bearer <accessToken>
```

**The commute's driver** (or an admin with `commutes: read`). `date` defaults to today and can be any date; `status` is optional. Items are soonest pickup first. The rider's phone is included only for the commute's driver (not an admin), once the trip is `accepted` (or `boarded`, `completed`); no boarding code ever appears here. `stops` is the route sheet for the date: every accepted or boarded rider's pickup and drop-off in route order with their first name (it ignores `status` and pagination).

**Response (200):**

```json
{
  "success": true,
  "message": "Commute trips retrieved successfully",
  "data": {
    "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
    "date": "2026-10-01",
    "departureAt": "2026-10-01T07:30:00.000Z",
    "capacity": 3,
    "seatsLeft": 2,
    "stops": [
      {
        "type": "pickup",
        "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
        "firstName": "Ama",
        "address": "Airport Junction, Accra",
        "lat": 5.6051,
        "lng": -0.1757,
        "scheduledAt": "2026-10-01T07:34:00.000Z"
      },
      {
        "type": "dropoff",
        "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
        "firstName": "Ama",
        "address": "Danquah Circle, Osu, Accra",
        "lat": 5.5635,
        "lng": -0.1806,
        "scheduledAt": "2026-10-01T07:44:26.000Z"
      }
    ],
    "items": [
      {
        "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
        "status": "accepted",
        "tripDate": "2026-10-01",
        "rider": {
          "id": "4d1a55bb-...",
          "fullName": "Ama Owusu",
          "profilePicture": null,
          "phone": "+233201234567"
        },
        "pickup": { "address": "Airport Junction, Accra", "lat": 5.6051, "lng": -0.1757 },
        "dropoff": { "address": "Danquah Circle, Osu, Accra", "lat": 5.5635, "lng": -0.1806 },
        "scheduledPickupAt": "2026-10-01T07:34:00.000Z",
        "scheduledDropoffAt": "2026-10-01T07:44:26.000Z",
        "totalAmount": 25.2,
        "driverEarnings": 22,
        "heldAmount": 25.2
      }
    ],
    "pagination": { "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 }
  }
}
```

Errors: `403` `Missing permission: read on commutes` (not your commute), `404` `Commute not found: <id>`.

### 4. Editing a Commute That Has Bookings

`PATCH /commutes/{id}` refuses (`409` `This commute has upcoming trips: pause it or cancel them before changing its route or schedule`) to change the start or end coordinates, `departureTime` or `recurrenceDays` while the commute has any `pending`, `accepted` or `boarded` trip from today on: those riders booked that route and time. Sending the current values again is fine (days in any order). The address text, `capacity` and `isActive` can always change: pause with `{ "isActive": false }` to stop new bookings, then cancel or decline the remaining trips before moving the route. Lowering `capacity` below the seats already taken keeps the accepted riders; `seatsLeft` reads `0` until enough seats free up. A commute with any trips at all can't be deleted (`409` `This commute has trips: pause it instead of deleting it`).

---

## Real-Time Events (Socket.IO)

The backend accepts Socket.IO connections on the same host as the REST API (no separate URL — just drop any path segment like `/v1` from your API base URL). Connections must authenticate the same way REST does, using the **same access token**.

### Connecting

```js
import { io } from "socket.io-client";

const socket = io(baseUrl, {
  auth: { token: accessToken },
  transports: ["websocket"],
});
```

The token goes in the `auth` payload of the handshake — **not** a header, **not** a query string. An access token expires after 15 minutes same as on REST; there's currently no automatic reconnect-with-refreshed-token behavior, so a long-lived connection should reconnect with a fresh token after refreshing it via `POST /auth/refresh`.

**Connection rejected** (`connect_error` fires) if the token is missing, invalid, or expired — same failure modes as a REST 401.

Every authenticated connection is placed in a room private to that account (`user:{yourUserId}`) — you don't join anything yourself, and you'll only ever receive events addressed to your own account.

### `user:suspended`

Fired when an admin suspends the connected account (`PATCH /users/{id}/status` with `status: "suspended"`). Not fired on reactivation.

```json
{ "reason": "Repeated ride cancellations" }
```

`reason` is whatever the admin entered when suspending (nullable — an admin can suspend without giving one). Treat receipt of this event as a forced sign-out: the account's sessions are already revoked server-side, so any subsequent REST call will start failing once the current access token expires.

### `driver:verification_status_changed`

Fired whenever a driver's overall `verificationStatus` changes — either automatically (a document gets reviewed) or from an admin's explicit approval/rejection (`PATCH /admin/driver/{userId}/verification`). Only fires on an actual change, never redundantly.

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "verificationStatus": "approved",
  "previousStatus": "pending"
}
```

Both `verificationStatus` and `previousStatus` are one of the [verification status values](#verification-status-values) above. This is a direct replacement for polling `GET /driver/{userId}` — **note**: the current driver app polls `pending-review.tsx` every 30 seconds for this exact information; switching that screen to listen for this event instead of polling is separate, not-yet-done frontend work that this event enables.

### `trip:requested`

Sent to the **driver** when a rider requests a seat on one of their commutes (`POST /trips`). `status` is `pending` when the driver still has to answer, or `accepted` if they accept bookings automatically.

```json
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "pending"
}
```

### `trip:cancelled`

Sent to the **other party** when a trip is cancelled (`POST /trips/{id}/cancel`): to the driver when the rider cancels, to the rider when the driver cancels.

```json
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "cancelled",
  "cancelledBy": "rider",
  "reason": "Plans changed"
}
```

`reason` is `null` when none was given. Refetch `GET /trips/{id}` for the full trip.

### `trip:accepted`

Sent to the **rider** when the driver accepts their request (`PATCH /trips/{id}/accept`). The seat is confirmed and the total is now held. Not sent for requests accepted automatically (the `POST /trips` response already says `accepted`).

```json
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "accepted"
}
```

### `trip:declined`

Sent to the **rider** when the driver declines their request (`PATCH /trips/{id}/decline`). Nothing was held, so nothing is released.

```json
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "declined",
  "reason": "Car is full of family today"
}
```

`reason` is `null` when the driver gave none.

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
{
  "success": false,
  "error": "Cannot approve driver: missing required document(s): National ID, Driver's License"
}
```

---

## Error Codes & Handling

| Code      | Meaning                                      | Retry?              | Action                                                     |
| --------- | -------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| 200 / 201 | Success                                      | —                   | Use `data`                                                 |
| 400       | Validation error                             | No                  | Fix the request                                            |
| 401       | Missing/invalid/expired access token         | Refresh, then retry | Call `/auth/refresh`; if that fails, send to sign-in       |
| 403       | Forbidden, or account suspended/deleted      | No                  | Show the error message; sign out if the account is blocked |
| 404       | Not found                                    | No                  | Check the ID being used                                    |
| 409       | Conflict (duplicate, already exists/deleted) | No                  | Show the message, adjust the request                       |
| 429       | Rate limited                                 | Yes, after waiting  | See [Rate Limiting](#rate-limiting)                        |
| 500       | Server error                                 | Yes, with backoff   | Retry a couple of times, then surface a generic error      |

---

## Rate Limiting

All limits are **per 15-minute window** and apply in addition to a generous per-IP flood guard (100 requests/IP on most auth endpoints, 300/IP on refresh — these exist mainly to stop abuse, not to affect normal use).

| Endpoint                             | Limit              | Counts               |
| ------------------------------------ | ------------------ | -------------------- |
| `POST /auth/login/otp`               | 5 per phone/email  | Every request        |
| `POST /auth/login/verify`            | 10 per phone/email | Failed attempts only |
| `POST /auth/login`                   | 10 per email       | Failed attempts only |
| `POST /auth/password/forgot`         | 5 per email        | Every request        |
| `POST /auth/password/reset`          | 10 per email       | Failed attempts only |
| `POST /auth/password/change`         | 5 per account      | Failed attempts only |
| `POST /auth/refresh`                 | 300 per IP         | Every request        |
| `POST /trips`                        | 30 per account     | Every request        |
| `GET /trips`, `GET /trips/available` | 300 per account    | Every request        |
| `PATCH /trips/{id}/accept`           | 120 per account    | Every request        |
| `PATCH /trips/{id}/decline`          | 120 per account    | Every request        |
| `GET /commutes/{id}/trips`           | 120 per account    | Every request        |

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

| Method | Path                                        | Auth       | Purpose                                              |
| ------ | ------------------------------------------- | ---------- | ---------------------------------------------------- |
| POST   | `/auth/login/otp`                           | —          | Request a sign-up/sign-in code                       |
| POST   | `/auth/login/verify`                        | —          | Verify code, get tokens (creates account if new)     |
| POST   | `/auth/login`                               | —          | Email + password sign-in (accounts with a password)  |
| POST   | `/auth/refresh`                             | —          | Exchange refresh token for a new pair                |
| GET    | `/auth/me`                                  | ✓          | Get the signed-in account                            |
| POST   | `/auth/logout`                              | —          | Revoke a refresh token                               |
| POST   | `/auth/password/forgot`                     | —          | Email a reset code                                   |
| POST   | `/auth/password/reset`                      | —          | Set new password with the reset code                 |
| POST   | `/auth/password/change`                     | ✓          | Change password while signed in                      |
| POST   | `/rider`                                    | ✓          | Create rider profile                                 |
| GET    | `/rider/{userId}`                           | ✓          | Get rider profile                                    |
| POST   | `/driver`                                   | ✓          | Create driver profile                                |
| GET    | `/driver/{userId}`                          | ✓          | Get driver profile (with vehicles/documents)         |
| PATCH  | `/driver/{userId}`                          | ✓          | Update driver profile / go online                    |
| POST   | `/vehicles`                                 | ✓          | Register a vehicle                                   |
| PATCH  | `/users/{id}`                               | ✓          | Update account details (fullName, dateOfBirth, etc)  |
| GET    | `/trips/available`                          | ✓ (rider)  | Find commutes near a point on a date                 |
| POST   | `/trips`                                    | ✓ (rider)  | Request a seat on a commute                          |
| GET    | `/trips`                                    | ✓          | List my trips (rider) or my commutes' trips (driver) |
| GET    | `/trips/{id}`                               | ✓          | Get a trip                                           |
| POST   | `/trips/{id}/cancel`                        | ✓          | Cancel a trip                                        |
| PATCH  | `/trips/{id}/accept`                        | ✓ (driver) | Accept a pending request                             |
| PATCH  | `/trips/{id}/decline`                       | ✓ (driver) | Decline a pending request                            |
| GET    | `/commutes/{id}/trips`                      | ✓ (driver) | A commute's trips on a date (manifest)               |
| PATCH  | `/commutes/{id}`                            | ✓ (driver) | Edit or pause a commute                              |
| GET    | `/document-types`                           | ✓          | List document types to upload                        |
| POST   | `/driver/verification/{documentTypeId}`     | ✓          | Upload a document                                    |
| GET    | `/driver/verification`                      | ✓          | Get own documents with history                       |
| GET    | `/verification/{documentId}/history`        | ✓          | Get one document's history                           |
| DELETE | `/verification/{documentId}`                | ✓          | Delete (soft) a document                             |
| GET    | `/admin/driver/verification/pending`        | ✓ (admin)  | List documents awaiting review                       |
| PATCH  | `/admin/verification/document/{documentId}` | ✓ (admin)  | Review a document                                    |
| PATCH  | `/admin/driver/{userId}/verification`       | ✓ (admin)  | Approve/change driver status                         |

---

**Questions or discrepancies?** Cross-check against the live Swagger UI at `/docs` — it's generated directly from the backend's request/response schemas, so it can never drift from what the API actually does the way a hand-written doc can.
