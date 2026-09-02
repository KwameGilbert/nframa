# Nframa Admin — Backend API Specification

This document is the contract handed to the backend team to implement the real API behind the Nframa Admin dashboard. It is being built **page by page**, in the same order the frontend rebuild covers each page — see `CLAUDE.md` for the full page/module inventory and rebuild history.

Every mock data shape referenced here comes directly from the frontend's `features/{module}/types.ts` and `mocks.ts` files, so it reflects exactly what each page actually renders — not a guess at what a "typical" endpoint should look like.

## How to read this document

For each page, you'll find:
- **Endpoint(s)** — method + path.
- **Auth** — who can call it (see [Authentication](#authentication) below; refined further once the Administration/Roles module's doc page is written).
- **Request** — path params, query params, and full request body (if any).
- **Response** — the full response body, field-by-field, plus a realistic example payload.

## Conventions (provisional — will firm up as we go)

- **Base URL:** `https://api.nframa.com/v1` (placeholder — replace with the real host).
- **Format:** JSON in, JSON out. `Content-Type: application/json`.
- **Auth:** Bearer token in the `Authorization: Bearer <token>` header, issued by the login endpoint (see [Authentication](#1-authentication)). Every endpoint below requires a valid admin session unless stated otherwise.
- **Errors:** every non-2xx response returns:
  ```json
  {
    "error": {
      "code": "string",       // machine-readable, e.g. "NOT_FOUND", "VALIDATION_ERROR"
      "message": "string",    // human-readable, safe to show in a toast
      "details": {}            // optional, e.g. field-level validation errors
    }
  }
  ```
- **Money:** all currency fields are Ghanaian Cedi (GHS), returned as **numbers in whole cedis** (no subunits), matching how the frontend currently formats them (`GH₵ 12,480`). Flag if the backend team prefers minor units (pesewas) instead — the frontend will adapt.
- **Dates/timestamps:** to be finalized — the current frontend mock uses pre-formatted relative/short strings (`"10m ago"`, `"May 8"`) rather than ISO timestamps. Recommend the real API return proper ISO 8601 (`"2026-08-26T10:32:00Z"`) and let the frontend format them client-side; noted per-endpoint below where this applies.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Overview](#2-overview)
3. [User Management](#3-user-management)
4. [Trip Operations](#4-trip-operations)
5. [Verification](#5-verification)
6. [Route Management](#6-route-management)
7. [Finance](#7-finance)
8. [Safety](#8-safety)
9. [Support](#9-support)
10. [Administration](#10-administration)
11. [Settings](#11-settings)

---

## 1. Authentication

The login screen (`/`, pre-session) covers sign-in and the full forgot-password recovery flow. There is no separate "logout" page to document yet (a session-clearing action lives in the app shell's profile menu, not its own page) — it'll be added when we get to that part of the shell.

Two sign-in methods are offered on the same screen (a **Password** / **OTP code** toggle), plus a 3-step **forgot password** flow (request code → verify code → set new password) reached via "Forgot password?". The frontend currently mocks all of this with no real token — the shapes below are what the real backend should return so the frontend's session handling doesn't need to change.

### 1.1 Sign in with password

**Endpoint:** `POST /auth/login`

**Auth:** None (this is how a session starts).

**Request body**

```jsonc
{
  "email": "a.buabeng@nframa.com",   // string, required
  "password": "••••••••••••",         // string, required
  "rememberMe": true                    // boolean, optional (default false) — should extend the
                                         // session/refresh-token lifetime; exact duration TBD with
                                         // backend team.
}
```

**Response — `200 OK`**

```jsonc
{
  "token": "eyJhbGciOi...",        // string — bearer access token, sent as `Authorization: Bearer <token>` on every subsequent request
  "refreshToken": "8f3a1c...",     // string — used to silently renew the access token once it expires
  "expiresIn": 3600,                // number — access token lifetime in seconds
  "user": {
    "id": "ADM-99482",
    "name": "Akosua Buabeng",
    "email": "a.buabeng@nframa.com",
    "avatar": "https://.../photo.jpg",   // string, URL
    "role": "Super Admin",                // string — see role note below
    "department": "Executive Operations", // string
    "lastActive": "Just now",             // string — see Conventions note on timestamps; recommend ISO 8601 here too
    "permissions": ["*"]                   // string[] — currently unused beyond the sidebar's role-based
                                            // module visibility (see role note below); reserved for
                                            // finer-grained permission checks later.
  }
}
```

**Errors:**
- `401 UNAUTHORIZED` — wrong email/password. Use a generic message ("Invalid email or password") rather than revealing which field was wrong, to avoid confirming whether an email is registered.
- `403 FORBIDDEN` — account exists but is suspended/invited-not-yet-active (see the Administration → Admin Users module's `Active`/`Suspended`/`Invited` statuses) — a suspended or not-yet-activated admin shouldn't be able to sign in at all.

**Note on `role`:** the frontend's current `AdminUser.role` type is a fixed 6-value union (`Super Admin` / `Operations` / `Finance` / `Verification` / `Support` / `Safety`). This predates the Administration module's Roles & Permissions feature, where roles are now admin-creatable free text with a per-role `permittedModules` list that drives which sidebar sections that admin sees (matched by exact role **name** string, not an enum). Recommend the backend treat `role` as a plain string matching a real `RoleDefinition.name`, not a fixed enum — this will need a small frontend type change to catch up, flagging it now so the backend contract doesn't get built around the stale union.

### 1.2 Request OTP sign-in code

The "OTP code" tab's first step — send a one-time code to the admin's email as an alternative to a password.

**Endpoint:** `POST /auth/otp/request`

**Auth:** None.

**Request body**

```jsonc
{
  "email": "a.buabeng@nframa.com"   // string, required
}
```

**Response — `200 OK`**

```jsonc
{
  "message": "A 6-digit code has been sent to your email.",  // string, shown to the admin
  "otpExpiresInSeconds": 300                                    // number, optional — how long the code is valid for
}
```

Recommend this always returns `200` regardless of whether the email is registered (generic message, no `404`), to avoid leaking which emails have admin accounts. The mock UI currently shows a fixed demo code (`123456`) inline — the real version obviously must not do that.

**Errors:** none expected beyond the standard 400 (malformed email) — this endpoint shouldn't reveal account existence via its error either.

### 1.3 Verify OTP & sign in

**Endpoint:** `POST /auth/otp/verify`

**Auth:** None.

**Request body**

```jsonc
{
  "email": "a.buabeng@nframa.com",   // string, required
  "otp": "123456"                     // string, required, 6 digits
}
```

**Response — `200 OK`**

Identical shape to [1.1's response](#11-sign-in-with-password) — `{ token, refreshToken, expiresIn, user }`. A successful OTP verification is a full sign-in, same as password.

**Errors:**
- `400 INVALID_OTP` — wrong or expired code. Message should be generic enough not to distinguish "wrong code" from "expired code" (reduces guessability), e.g. "Invalid or expired code."

### 1.4 Request password reset code

Step 1 of "Forgot password?" — the admin enters their email and a reset code is emailed to them.

**Endpoint:** `POST /auth/password/forgot`

**Auth:** None.

**Request body**

```jsonc
{
  "email": "a.buabeng@nframa.com"   // string, required
}
```

**Response — `200 OK`**

```jsonc
{
  "message": "If that email is associated with an admin account, a reset code has been sent."
}
```

Recommend this **always** returns `200` with this generic message whether or not the email exists — a different response for "email not found" would let someone enumerate valid admin accounts.

### 1.5 Verify password reset code

Step 2 — the admin enters the 6-digit code that was emailed to them (labeled "forgot password otp" in the page flow).

**Endpoint:** `POST /auth/password/forgot/verify`

**Auth:** None.

**Request body**

```jsonc
{
  "email": "a.buabeng@nframa.com",   // string, required
  "code": "123456"                    // string, required, 6 digits
}
```

**Response — `200 OK`**

```jsonc
{
  "resetToken": "9c2e7f1a-...",   // string — short-lived, single-use token authorizing step 3
  "expiresIn": 600                  // number — seconds this resetToken is valid for
}
```

**Recommended change from the current mock:** the frontend today just flips to step 3 on any 6-digit input, with no token — step 3's "set new password" call would otherwise need to re-send the raw `email` + `code` pair, which is weaker (nothing stops someone from calling the reset endpoint directly with a guessed code, since verifying and resetting would be two independent, unlinked calls). Issuing a one-time `resetToken` here that step 3 must present instead ties the two steps together and makes the code single-use. This is a small forward-looking addition the frontend will adopt to match — flagging it so the backend builds the safer version from the start rather than the frontend's current code-only mock.

**Errors:**
- `400 INVALID_CODE` — wrong or expired code, same generic-message reasoning as OTP verify above.

### 1.6 Reset password

Step 3 — the admin sets and confirms a new password.

**Endpoint:** `POST /auth/password/reset`

**Auth:** None (authorized instead by the `resetToken` from step 2).

**Request body**

```jsonc
{
  "resetToken": "9c2e7f1a-...",   // string, required — from 1.5's response
  "newPassword": "NewPass1234"      // string, required, min 6 characters (matches the frontend's
                                     // current client-side rule — worth confirming/raising the
                                     // minimum with the backend team, 6 is on the low side)
}
```

`confirmPassword` is validated client-side only (the two fields must match before submit) — no need for the backend to receive it.

**Response — `200 OK`**

```jsonc
{
  "message": "Password updated successfully."
}
```

**Open question for the backend team:** should resetting the password revoke any other active sessions/tokens for that admin? Recommended (a password reset usually implies "assume the old password was compromised"), but calling it out since the mock has no session-revocation concept at all today.

**Errors:**
- `400 INVALID_RESET_TOKEN` — token missing, expired, already used, or doesn't match `email` from step 2.
- `422 VALIDATION_ERROR` — password too short (`details.newPassword`).

---

## 2. Overview

The Overview page (`/overview`, the app's default landing page after login) is a single read-only dashboard: headline stat tiles, a 7-day trip-activity chart, a verification-queue breakdown donut, and a recent-account-actions feed. It has no filters, no pagination, and no mutations — one endpoint returns everything the page needs in one call.

### 2.1 Get overview snapshot

Returns every data point the Overview page renders.

**Endpoint:** `GET /overview/snapshot`

**Auth:** Any authenticated admin.

**Request**

- Path params: none
- Query params: none
- Body: none (GET request)

**Response — `200 OK`**

```jsonc
{
  "stats": {
    "activeRiders": 1284,          // number — count of rider accounts currently active
    "activeCarOwners": 326,        // number — count of car owner accounts currently active
    "tripsToday": 148,             // number — trips completed or in progress today
    "revenue": 12480,              // number — platform revenue today, in GHS (see Conventions)
    "openIncidents": 3,            // number — unresolved Safety module SOS/incident alerts
    "pendingVerification": 24,     // number — verification applications awaiting a decision
    "openTickets": 17              // number — open support tickets across all channels
  },
  "trends": {
    // Period-over-period deltas — ONLY for the 4 headline tiles (activeRiders, activeCarOwners,
    // tripsToday, revenue). The other 3 stats (openIncidents, pendingVerification, openTickets)
    // are shown without a trend on the frontend, so no trend data is needed for them.
    "activeRiders":   { "direction": "up",   "value": "12.5%" },
    "activeCarOwners": { "direction": "up",   "value": "4.8%" },
    "tripsToday":      { "direction": "down", "value": "3.1%" },
    "revenue":         { "direction": "up",   "value": "18.6%" }
    // direction: "up" | "down"
    // value: string, pre-formatted percentage (e.g. "12.5%") — comparison period (day-over-day?
    // week-over-week?) needs to be confirmed with the backend team; frontend just displays the string.
  },
  "tripActivity": [
    // Last 7 days of trip activity, oldest first, for the "Completed vs. Canceled" line chart.
    // Always exactly 7 points, one per day.
    { "date": "May 8",  "completed": 118, "canceled": 38 },
    { "date": "May 9",  "completed": 132, "canceled": 72 },
    { "date": "May 10", "completed": 141, "canceled": 75 },
    { "date": "May 11", "completed": 149, "canceled": 60 },
    { "date": "May 12", "completed": 130, "canceled": 63 },
    { "date": "May 13", "completed": 128, "canceled": 52 },
    { "date": "May 14", "completed": 161, "canceled": 55 }
    // date: string — currently a pre-formatted short label ("May 8"). Recommend the real API
    // return an ISO date ("2026-05-08") instead and let the frontend format it — see Conventions.
    // completed: number — trips completed that day.
    // canceled: number — trips canceled that day.
  ],
  "verificationQueue": [
    // Pending verification applications broken down by document type, for the donut chart.
    // The sum of "count" across this array should equal stats.pendingVerification.
    { "label": "New Car Owner",     "count": 12 },
    { "label": "Driver Documents",  "count": 6 },
    { "label": "Vehicle Documents", "count": 4 },
    { "label": "Insurance",         "count": 2 }
    // label: string — document/category name, shown as the donut segment's legend label.
    // count: number — pending applications in that category.
  ],
  "recentActions": [
    // Most-recent-first feed of recent account actions (suspensions, activations, verification
    // decisions, etc.) across Users/Verification. Frontend currently shows all items returned
    // with no client-side pagination — recommend the backend cap this at a fixed page size
    // (e.g. the 5 most recent) rather than returning an unbounded history.
    {
      "id": "1",
      "name": "Kofi Asare",
      "action": "Rider account activated",
      "timestamp": "10m ago",
      "tone": "success"
    },
    {
      "id": "2",
      "name": "Akosua Boateng",
      "action": "Car owner verified",
      "timestamp": "28m ago",
      "tone": "success"
    },
    {
      "id": "3",
      "name": "Yaw Mensah",
      "action": "Driver document rejected",
      "timestamp": "1h ago",
      "tone": "danger"
    },
    {
      "id": "4",
      "name": "Abena Ofori",
      "action": "Rider suspended",
      "timestamp": "2h ago",
      "tone": "danger"
    },
    {
      "id": "5",
      "name": "Selorm Adjei",
      "action": "Car owner activated",
      "timestamp": "3h ago",
      "tone": "success"
    }
    // id: string — unique id for the action/event (for React key purposes; no detail endpoint
    // currently links off this id, but returning a real underlying record id is still recommended
    // in case a future round adds click-through).
    // name: string — the affected account's display name.
    // action: string — human-readable description of what happened.
    // timestamp: string — currently a pre-formatted relative string ("10m ago"). Recommend ISO
    // 8601 from the API with the frontend computing the relative label — see Conventions.
    // tone: "success" | "danger" — drives the icon/color (checkmark vs. X). Maps roughly to
    // "positive account action" (activated/verified) vs. "negative account action"
    // (suspended/rejected).
  ]
}
```

**Error responses:** standard [error envelope](#conventions-provisional--will-firm-up-as-we-go). No endpoint-specific error cases beyond the standard 401 (not authenticated) — this is a pure read with no inputs to validate.

**Notes for the backend team:**
- This is one aggregate/dashboard endpoint by design — it mirrors the frontend's single `useOverviewSnapshot()` query. If computing all of this in one query is expensive, consider having the backend materialize/cache this snapshot (e.g. refreshed every minute) rather than the frontend calling multiple endpoints and re-assembling it — the page has no need for real-time-to-the-second numbers.
- `stats.pendingVerification` is also used to conditionally show a banner ("N verification applications are waiting on review") — no separate flag needed, the frontend just checks `> 0`.

---

## 3. User Management

`/users` has 3 tabs sharing one list-plus-detail-drawer setup: **Riders**, **Car Owners**, and **Suspended** (any role, shown together once suspended). Every row's actions (View / Edit / Suspend-or-Reinstate / Delete) open the same detail drawer or a confirm dialog — there's no separate "create user" flow, since rider/car-owner accounts are created through the rider/car-owner mobile apps' own onboarding, not the admin console.

### Shared `AppUser` shape

Returned by every endpoint below that returns a user object (in a list or singly):

```jsonc
{
  "id": "CAR-2035",                   // string — e.g. "RID-10023" for riders, "CAR-2031" for car owners
  "name": "Kwame Oppong",
  "role": "Car Owner",                  // "Rider" | "Car Owner"
  "phone": "+233 20 107 1148",
  "email": "kwame.oppong@gmail.com",
  "status": "Suspended",                // "Active" | "Suspended"
  "joined": "Jan 8, 2025",              // string — recommend ISO 8601 instead; see Conventions
  "lastActive": "10m ago",              // string — recommend ISO 8601 instead; see Conventions
  "tripsCompleted": 40,
  "averageRating": 4.5,
  "vehicle": {                          // present only when role === "Car Owner"
    "model": "Hyundai Accent",
    "color": "White",
    "plate": "GS 1234-25",
    "seats": 3,
    "corridor": "Accra–Tema"
  },
  "verification": "Approved",           // present only when role === "Car Owner"
                                          // "Approved" | "Pending" | "Rejected" | "Expiring" — owned
                                          // by the Verification module's approve/reject workflow;
                                          // read-only here, never set through a Users endpoint.
  "security": {
    "passwordChanged": "Apr 18, 2025",    // string — recommend ISO 8601
    "loginLocation": "Accra, Ghana",
    "devices": 1
  },
  "suspension": {                       // present only when status === "Suspended"
    "reason": "Documents rejected",
    "suspendedOn": "Aug 4, 2026",         // string — recommend ISO 8601
    "suspendedBy": "Nana Addo",           // the admin (or "System") who suspended the account
    "caseId": "SUS-0048",
    "reviewStatus": "Appeal pending",     // "Appeal pending" | "Under review" | "Action required" | "Escalated" | "No appeal" | "Cleared"
    "restrictions": "Matching and payouts blocked",
    "notes": "Insurance document could not be verified. New document submitted for review."
  }
}
```

### 3.1 List users

**Endpoint:** `GET /users`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `tab` | `riders` \| `car-owners` \| `suspended` | Required. `riders`/`car-owners` return only `status: "Active"` accounts of that role; `suspended` returns every suspended account regardless of role. |
| `search` | string | Optional — matches name, id, or phone (case-insensitive, partial match). |
| `page` | number | Optional, default `1`. |
| `pageSize` | number | Optional, default `8` (matches the frontend's current page size). |
| `verification` | string | Optional, **car-owners tab only** — one of `Approved`/`Pending`/`Rejected`/`Expiring`. |
| `corridor` | string | Optional, **car-owners tab only** — exact corridor match. |
| `rating` | string | Optional, **riders/car-owners tabs** — one of `4.8+` / `4.5-4.7` / `below-4.5` (fixed buckets, not a raw number threshold). |
| `trips` | string | Optional, **riders tab only** — one of `50+` / `20-49` / `under-20`. |
| `joinedMonth` | string | Optional, **riders tab only** — e.g. `"Jan 2025"`, matched against the account's join month. |
| `role` | `Rider` \| `Car Owner` | Optional, **suspended tab only** — filter suspended accounts by role. |
| `reviewStatus` | string | Optional, **suspended tab only** — one of the 6 `reviewStatus` values above. |
| `reason` | string | Optional, **suspended tab only** — exact suspension-reason match. |

Recommend real server-side pagination/filtering, as specified above — the current frontend mock fetches the *entire* tab's list and filters/paginates client-side, which only works because the mock dataset is small; a real user base shouldn't be fetched whole on every tab switch.

**Response — `200 OK`**

```jsonc
{
  "items": [ /* AppUser[], see shared shape above */ ],
  "page": 1,
  "pageSize": 8,
  "total": 14,        // total matching rows after filtering, before pagination — drives the Pagination component
  "totalPages": 2
}
```

### 3.2 Get user stats

The 4 stat tiles above the tabs (Total Riders / Total Car Owners / Active Accounts / Suspended) currently come from fetching all three tabs' full lists and taking `.length` on each — fine for a small mock, wasteful with real pagination. Recommend a dedicated stats endpoint instead.

**Endpoint:** `GET /users/stats`

**Auth:** Any authenticated admin.

**Request:** no params.

**Response — `200 OK`**

```jsonc
{
  "totalRiders": 14,      // count of all Rider accounts, any status
  "totalCarOwners": 10,   // count of all Car Owner accounts, any status
  "activeAccounts": 19,   // count of accounts (either role) with status "Active"
  "suspended": 5          // count of accounts (either role) with status "Suspended"
}
```

### 3.3 Get filter options

`corridor`, `joinedMonth`, and `reason` are dynamic dropdowns whose options come from the actual data rather than a fixed list — this app's standing convention for any filter over a free-text-ish field. With real server-side pagination, the frontend can no longer derive these itself from whatever page of rows it happens to have loaded, so they need their own endpoint.

**Endpoint:** `GET /users/filter-options`

**Auth:** Any authenticated admin.

**Request:** no params.

**Response — `200 OK`**

```jsonc
{
  "corridors": ["Accra–Tema", "Achimota–Airport", "Adenta–Airport", "Kasoa–Accra", "Madina–Osu", "Tema–Accra"],
  // distinct vehicle.corridor values across all Car Owner accounts, sorted alphabetically
  "joinedMonths": ["Apr 2025", "Feb 2025", "Jan 2025", "Mar 2025", "May 2025"],
  // distinct join-month buckets across all Rider accounts — recommend the backend sort these
  // chronologically rather than alphabetically (alphabetical sort puts "Apr" before "Jan",
  // which reads oddly in a date filter dropdown)
  "suspensionReasons": ["Documents rejected", "Insurance expired", "Payment dispute", "Repeated cancellations", "Terms violation"]
  // distinct suspension.reason values across currently-suspended accounts, sorted alphabetically
}
```

`rating` (`4.8+`/`4.5-4.7`/`below-4.5`) and `trips` (`50+`/`20-49`/`under-20`) are fixed buckets, not data-derived — no endpoint needed for those, they stay hardcoded on the frontend same as today.

### 3.4 Get user by id

Powers the detail drawer (View/Edit/Suspend modes) at `/users/:tab/:userId`.

**Endpoint:** `GET /users/:id`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

The [shared `AppUser` shape](#shared-appuser-shape) for that one user.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

### 3.5 Update user

Powers the drawer's Edit mode. Deliberately narrow — this accepts only the fields a real admin-facing edit form should expose, not every field on the record.

**Endpoint:** `PATCH /users/:id`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "name": "Kwame Oppong",
  "phone": "+233 20 107 1148",
  "email": "kwame.oppong@gmail.com",
  "vehicle": {                            // optional — only send for Car Owner accounts
    "model": "Hyundai Accent",
    "color": "White",
    "plate": "GS 1234-25",
    "seats": 3,
    "corridor": "Accra–Tema"
  },
  "suspensionCase": {                     // optional — only meaningful while the account is
                                            // currently suspended; lets an admin revise an
                                            // open case's details without closing it
    "reason": "Documents rejected",
    "reviewStatus": "Under review",
    "restrictions": "Matching and payouts blocked",
    "notes": "Updated: replacement insurance document received, pending verification."
  }
}
```

**Deliberately excluded from this endpoint**, and why:
- `id`, `status` — identifier, and status changes go through the dedicated [Suspend](#36-suspend-user)/[Reinstate](#37-reinstate-user) endpoints instead.
- `role` — an identity/onboarding attribute, not a generic field edit.
- `joined`, `lastActive` — system timestamps.
- `tripsCompleted`, `averageRating` — computed aggregates from real trip/rating records, not admin-set.
- `security` — telemetry the backend derives from real login/device events, never admin-set.
- `verification` — owned by the Verification module's own approve/reject workflow, not this form.
- `suspension.suspendedOn` / `.suspendedBy` / `.caseId` — facts fixed at the moment a suspension was created; not retroactively editable.

**Response — `200 OK`**

The updated [shared `AppUser` shape](#shared-appuser-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for a malformed email/phone (`details.email` / `details.phone`).

### 3.6 Suspend user

Powers the drawer's Suspend mode. Suspending is a form — reason, review status, restrictions and notes are all required up front — not a single-click status toggle, so every suspended account has a complete case record from the moment it's created rather than landing on the Suspended tab with blank case details.

**Endpoint:** `POST /users/:id/suspend`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "reason": "Documents rejected",                   // string, required
  "reviewStatus": "Appeal pending",                   // required — one of the 6 reviewStatus values
  "restrictions": "Matching and payouts blocked",     // string, required
  "notes": "Insurance document could not be verified."  // string, required
}
```

**Response — `200 OK`**

The updated [shared `AppUser` shape](#shared-appuser-shape), with `status: "Suspended"` and a fully populated `suspension` object. `suspendedOn` (now), `suspendedBy` (the *authenticated admin*, read from the session — not client-supplied) and `caseId` (next in the `SUS-00xx` sequence) are all system-assigned.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if the account is already suspended.

### 3.7 Reinstate user

**Endpoint:** `POST /users/:id/reinstate`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response — `200 OK`**

The updated [shared `AppUser` shape](#shared-appuser-shape), with `status: "Active"` and `suspension` cleared entirely — the case is closed, not left around in a resolved state for later editing.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if the account is already active.

### 3.8 Delete user

Available both from the table row and from inside the detail drawer's view mode (the same action, two entry points). Permanently removes the account.

**Endpoint:** `DELETE /users/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

**Open question for the backend team:** the frontend's confirm dialog currently warns this "permanently removes the account and all of its trip, verification and suspension history" — worth deciding with the backend team whether this should be a real hard delete or a soft-delete/anonymization (retaining trip and financial records for accounting/audit purposes elsewhere in the platform — Finance, Trip Operations — while scrubbing personal info). A mobility platform with financial transactions tied to a user usually can't cleanly hard-delete without breaking historical records in other modules.

---

## 4. Trip Operations

`/trip-operations` has 2 groups — **Live Operations** (5 pages: Trips Overview, Scheduled Trips, Active Trips, Boarding & QR, Trip Update Failures) and **Post-Trip Operations** (5 pages: Post-Trip Overview, Completed Trips, Cancelled Trips, Reports & Misconduct, Trip Disputes). A third group, Matching Operations, existed earlier in the rebuild but was removed entirely — this platform doesn't do rider-to-car-owner matching, so there's nothing to document there.

### Shared building blocks

Most trip-related records here carry the same core fields — who was on the trip, what vehicle, and the route:

```jsonc
"riderName": "Kofi Asare",
"carOwnerName": "Kwame Oppong",
"vehicleModel": "Hyundai Accent",
"plate": "GT 1007-23",
"pickup": "Tema Station",
"dropoff": "East Legon",
"corridor": "Accra–Tema"
```

**Cross-reference lookup:** Boarding & QR logs, Trip Update Failures, Misconduct Reports, and Trip Disputes each reference a trip by `tripId` rather than carrying the full trip record themselves. Their detail views enrich the record with the underlying trip's vehicle/pickup/dropoff/corridor via:

**Endpoint:** `GET /trip-operations/live-trips/:tripId`

**Response — `200 OK`:** the full `LiveTrip` shape (see [4.1.1](#411-get-live-operations-overview)), or **`404 NOT_FOUND`** if the trip has aged out of the live/active window. When `404`, the calling page falls back to showing only the fields the parent record already has directly (e.g. a misconduct report still shows `reportedBy`/`against` even with no trip match) — **recommend the real backend keep completed/cancelled trips permanently queryable by this same endpoint** (rather than only "currently live" trips) so this enrichment lookup reliably succeeds for older records too, not just ones still in progress.

---

### 4.1 Live Operations

#### 4.1.1 Get live operations overview

Powers Trips Overview (`/trip-operations/trips-overview`, the group's default landing page) — 4 stat tiles plus a searchable/filterable table of recent trips across every status (not just in-transit).

**Endpoint:** `GET /trip-operations/live-overview`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "stats": {
    "activeTrips": 9,           // count of trips currently "In Transit"
    "scheduledToday": 34,       // count of trips scheduled for today
    "qrScansToday": 58,         // count of boarding QR scans logged today
    "updateFailuresOpen": 6     // count of unresolved trip-update-failure records
  },
  "recentTrips": [
    {
      "id": "TRP-7210",
      "riderName": "Kofi Asare",
      "carOwnerName": "Kwame Oppong",
      "vehicleModel": "Hyundai Accent",
      "plate": "GT 1000-20",
      "pickup": "Tema Station",
      "dropoff": "East Legon",
      "corridor": "Accra–Tema",
      "distance": "3km",              // string, pre-formatted — recommend a raw number (km) instead, see Conventions
      "eta": "2m",                     // string, pre-formatted — recommend a raw number (minutes) instead
      "status": "In Transit",          // "Scheduled" | "In Transit" | "Completed" | "Cancelled" | "Disputed"
      "fare": 12,                      // number, GHS
      "startTime": "5m ago"            // string — recommend ISO 8601; see Conventions
    }
    // ...capped at the 10 most recent trips (any status) — this is a dashboard feed, not the
    // full trip ledger. Filtering/searching over this list currently happens entirely
    // client-side with no pagination on this page; 10 rows is small enough that's fine as-is.
  ]
}
```

**Note on `LiveTrip.status`:** `"Completed"`/`"Cancelled"`/`"Disputed"` trips still show up in this feed (it's "recent activity," not "in-progress only") even though those statuses have their own dedicated pages elsewhere (Completed Trips, Cancelled Trips, Trip Disputes) — this endpoint doesn't need to exclude them.

#### 4.1.2 List scheduled trips

Powers Scheduled Trips (`/trip-operations/scheduled-trips`) — upcoming trips booked ahead of departure.

**Endpoint:** `GET /trip-operations/scheduled-trips`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, car owner name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Scheduled` \| `Confirmed` \| `Cancelled` | Optional. |
| `corridor` | string | Optional, dynamic (see [Overview conventions](#conventions-provisional--will-firm-up-as-we-go) on dynamic filter values). |
| `carOwner` | string | Optional, exact car owner name match. |

Recommend server-side pagination/filtering here too, same reasoning as Users — the mock fetches all 15 fixture rows and paginates client-side.

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "SCH-6410",
      "riderName": "Abena Ofori",
      "carOwnerName": "Esi Danso",
      "vehicleModel": "Kia Picanto",
      "plate": "GT 1300-20",
      "pickup": "Osu Oxford St",
      "dropoff": "Madina Market",
      "corridor": "Madina–Osu",
      "scheduledTime": "Today, 06:00",   // string, pre-formatted — recommend ISO 8601; see Conventions
      "seats": 1,
      "status": "Confirmed"                // "Scheduled" | "Confirmed" | "Cancelled"
    }
  ],
  "page": 1,
  "pageSize": 8,
  "total": 15,
  "totalPages": 2
}
```

#### 4.1.3 Reschedule a scheduled trip

The only "edit" in this module — an upcoming trip's time/seat count, the one thing an admin would realistically correct before it happens. Nothing else about a trip is admin-editable (see the "no delete anywhere in this module" reasoning below).

**Endpoint:** `PATCH /trip-operations/scheduled-trips/:id`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "scheduledTime": "Today, 07:30",   // string — recommend ISO 8601 datetime instead of the mock's formatted string
  "seats": 2                          // number, required
}
```

**Response — `200 OK`:** the updated `ScheduledTrip` (see [4.1.2](#412-list-scheduled-trips)).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if the trip is already `Cancelled` (a cancelled trip can't be rescheduled — the row action doesn't even render for one in the frontend, but the backend should still guard it).

#### 4.1.4 Force cancel a scheduled trip

**Endpoint:** `POST /trip-operations/scheduled-trips/:id/force-cancel`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "reason": "Car owner failed to confirm pickup; passenger rebooked."   // string, required
}
```

**Response — `200 OK`:** the newly-created `CancelledTrip` record (see [4.2.3](#423-list-cancelled-trips)) with `cancelledBy: "Admin"`. The trip is removed from the scheduled queue — this is a state transition, not a soft flag, so it also disappears from [4.1.2](#412-list-scheduled-trips)'s results afterward.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if already `Cancelled`.

#### 4.1.5 List active trips

Powers Active Trips (`/trip-operations/active-trips`) — the live dispatch board, table plus map, for trips currently `"In Transit"` only.

**Endpoint:** `GET /trip-operations/active-trips`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, car owner name, or trip id. |
| `corridor` | string | Optional. |
| `carOwner` | string | Optional. |
| `fare` | `under20` \| `20to40` \| `over40` | Optional — fixed fare buckets, not a raw amount. |

No pagination on this page currently (the whole in-transit set is expected to be small enough to show at once) — flag with the backend team if that assumption might not hold at real scale.

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "TRP-7205",
      "riderName": "Selorm Adjei",
      "carOwnerName": "Michael Addo",
      "vehicleModel": "Toyota Yaris",
      "plate": "GT 1035-22",
      "pickup": "Kasoa Toll",
      "dropoff": "Circle",
      "corridor": "Kasoa–Accra",
      "distance": "7km",
      "eta": "9m",
      "status": "In Transit",
      "fare": 26.5,
      "startTime": "20m ago"
      // no lat/lng on any trip in the current mock — the frontend derives an approximate map
      // marker position by jittering the trip's *corridor's* fixed midpoint coordinate, since
      // there's no real per-trip GPS to plot. Recommend the real API return the trip's actual
      // live position (and pickup/dropoff coordinates) once real vehicle telemetry exists —
      // e.g. { "currentPosition": { "lat": 5.614, "lng": -0.186 } } — so the map reflects
      // reality instead of an approximation.
    }
  ]
}
```

#### 4.1.6 Force cancel a live (in-transit) trip

Used by both Trips Overview's and Active Trips' row actions — same underlying operation on the same `LiveTrip` records, triggered from two pages.

**Endpoint:** `POST /trip-operations/live-trips/:id/force-cancel`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "reason": "Vehicle breakdown reported mid-route; rider transferred to a replacement."   // string, required
}
```

**Response — `200 OK`:** the newly-created `CancelledTrip` record (see [4.2.3](#423-list-cancelled-trips)) with `cancelledBy: "Admin"`. The trip is removed from the live/active board — it will no longer appear in [4.1.1](#411-get-live-operations-overview)'s `recentTrips` as `"In Transit"`, nor in [4.1.5](#415-list-active-trips).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if the trip isn't currently `"In Transit"`.

**Standing rule for this whole module (documented once, applies throughout):** there is **no delete** and **no other edit** anywhere in Trip Operations. A trip record — live, scheduled, completed, or cancelled — is operational/historical data, not something an admin arbitrarily edits or removes. The one corrective action offered is Force Cancel, and it's itself non-destructive: it files a *new* `CancelledTrip` record rather than erasing the original.

#### 4.1.7 List boarding & QR logs

Powers Boarding & QR (`/trip-operations/boarding-qr`) — station QR boarding scan history.

**Endpoint:** `GET /trip-operations/boarding-qr-logs`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches commuter name, car owner name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Valid Scan` \| `Invalid Fare` \| `Duplicate Scan` | Optional. |
| `corridor` | string | Optional. |
| `carOwner` | string | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "QR-9100",
      "tripId": "TRP-7210",              // cross-references 4.1's shared lookup endpoint
      "commuterName": "Emmanuel Paintsil",
      "carOwnerName": "Kwame Oppong",
      "corridor": "Accra–Tema",
      "scanTime": "8:02 AM",              // string — recommend ISO 8601
      "status": "Valid Scan"              // "Valid Scan" | "Invalid Fare" | "Duplicate Scan"
    }
  ],
  "page": 1, "pageSize": 8, "total": 40, "totalPages": 5
}
```

No mutation on this page — scan logs are read-only history, same reasoning as the module-wide "no delete/edit" rule above.

#### 4.1.8 List trip update failures

Powers Trip Update Failures (`/trip-operations/trip-update-failures`) — telemetry/status-sync failures needing manual attention.

**Endpoint:** `GET /trip-operations/trip-update-failures`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, trip id, or failure id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `failureType` | `GPS timeout` \| `Status sync error` \| `Payment webhook failed` | Optional. |
| `resolved` | `resolved` \| `unresolved` | Optional. |
| `rider` | string | Optional, exact rider name match. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "FLR-1021",
      "tripId": "TRP-7198",              // cross-references 4.1's shared lookup endpoint
      "riderName": "Yaw Mensah",
      "failureType": "GPS timeout",        // "GPS timeout" | "Status sync error" | "Payment webhook failed"
      "occurredAt": "12m ago",             // string — recommend ISO 8601
      "resolved": false
    }
  ],
  "page": 1, "pageSize": 8, "total": 14, "totalPages": 2
}
```

#### 4.1.9 Resolve a trip update failure

**Endpoint:** `POST /trip-operations/trip-update-failures/:id/resolve`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response — `200 OK`:** the updated record, with `resolved: true`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if already resolved.

---

### 4.2 Post-Trip Operations

#### 4.2.1 Get post-trip overview

Powers Post-Trip Overview (`/trip-operations/post-trip-overview`, the group's default landing page) — 4 stat tiles plus 3 "recent activity" panels. No filters on this page (it's a dashboard, not a table).

**Endpoint:** `GET /trip-operations/post-trip-overview`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "stats": {
    "completedToday": 42,
    "cancelledToday": 7,
    "openDisputes": 3,
    "openReports": 5
  },
  "recentCompleted": [ /* CompletedTrip[], see 4.2.2 — a short recent slice, not the full list */ ],
  "recentCancelled": [ /* CancelledTrip[], see 4.2.3 */ ],
  "recentDisputes": [ /* TripDispute[], see 4.2.6, filtered to non-Resolved statuses only ("open disputes") */ ]
}
```

#### 4.2.2 List completed trips

Powers Completed Trips (`/trip-operations/completed-trips`) — finished trips with fare and rider rating. Read-only.

**Endpoint:** `GET /trip-operations/completed-trips`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, car owner name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `corridor` | string | Optional. |
| `rating` | `4.8+` \| `4.5-4.7` \| `below-4.5` | Optional — fixed buckets. |
| `carOwner` | string | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "CMP-3301",
      "riderName": "Maame Mensah",
      "carOwnerName": "Naana Agyemang",
      "vehicleModel": "Honda Civic",
      "plate": "GT 1210-24",
      "pickup": "East Legon",
      "dropoff": "Airport Terminal 3",
      "corridor": "Achimota–Airport",
      "completedAt": "Today, 09:14",   // string — recommend ISO 8601
      "fare": 34.5,                      // number, GHS
      "rating": 4.8                       // number — rider's rating of the trip
    }
  ],
  "page": 1, "pageSize": 8, "total": 26, "totalPages": 4
}
```

#### 4.2.3 List cancelled trips

Powers Cancelled Trips (`/trip-operations/cancelled-trips`). Read-only — the only way a trip *lands* here as `cancelledBy: "Admin"` is via the two force-cancel endpoints above ([4.1.4](#414-force-cancel-a-scheduled-trip)/[4.1.6](#416-force-cancel-a-live-in-transit-trip)); rider/car-owner-initiated and system-timeout cancellations happen in the rider/car-owner apps, not this console.

**Endpoint:** `GET /trip-operations/cancelled-trips`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, car owner name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `cancelledBy` | `Rider` \| `Car Owner` \| `System` \| `Admin` | Optional. |
| `corridor` | string | Optional. |
| `carOwner` | string | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "CNL-4310",
      "riderName": "Benjamin Addo",
      "carOwnerName": "Kofi Osei",
      "vehicleModel": "Nissan Sentra",
      "plate": "GT 1150-21",
      "pickup": "Spintex Rd",
      "dropoff": "Circle",
      "corridor": "Spintex–Osu",
      "cancelledAt": "Just now",           // string — recommend ISO 8601
      "cancelledBy": "Admin",                // "Rider" | "Car Owner" | "System" | "Admin"
      "reason": "Vehicle breakdown reported mid-route; rider transferred to a replacement."
    }
  ],
  "page": 1, "pageSize": 8, "total": 31, "totalPages": 4
}
```

#### 4.2.4 List misconduct reports

Powers Reports & Misconduct (`/trip-operations/reports-misconduct`) — rider-filed misconduct reports against car owners. See CLAUDE.md's plain-terms distinction: **misconduct reports govern a person** (behavior, can lead to account consequences), as opposed to disputes ([4.2.6](#426-list-trip-disputes)) which **fix a trip** (money/facts).

**Endpoint:** `GET /trip-operations/misconduct-reports`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches reporter name, subject name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `severity` | `High` \| `Medium` \| `Low` | Optional. |
| `status` | `Open` \| `Investigating` \| `Resolved` \| `Dismissed` | Optional. |
| `category` | string | Optional, dynamic. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "MIS-201",
      "tripId": "TRP-7188",                // cross-references 4.1's shared lookup endpoint
      "reportedBy": "Efua Owusu",            // the rider who filed the report
      "against": "Francis R. Mensah",        // the car owner the report is about
      "category": "Unsafe driving",
      "description": "Driver was speeding and ran a red light on the Tema corridor.",
      "severity": "High",                     // "High" | "Medium" | "Low"
      "status": "Open",                        // "Open" | "Investigating" | "Resolved" | "Dismissed"
      "reportedAt": "1h ago"                   // string — recommend ISO 8601
    }
  ],
  "page": 1, "pageSize": 8, "total": 18, "totalPages": 3
}
```

#### 4.2.5 Update misconduct report status

Status only moves forward: `Open` → `Investigating` → `Resolved` **or** `Dismissed`. Both `Resolved` and `Dismissed` are terminal — no row action renders past either in the frontend.

**Endpoint:** `PATCH /trip-operations/misconduct-reports/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "Investigating"   // "Investigating" | "Resolved" | "Dismissed" — see the allowed-transition
                                // rule above; the backend should reject an out-of-order transition
                                // (e.g. "Open" straight to "Dismissed") even though the frontend
                                // only ever sends valid ones
}
```

**Response — `200 OK`:** the updated `MisconductReport`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid status transition.

#### 4.2.6 List trip disputes

Powers Trip Disputes (`/trip-operations/trip-disputes`) — fare, route and damage disputes raised after a trip completes. See the "Disputes fix a trip" distinction in [4.2.4](#424-list-misconduct-reports) above.

**Endpoint:** `GET /trip-operations/trip-disputes`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name, car owner name, or trip id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Open` \| `Under Review` \| `Resolved` \| `Escalated` | Optional. |
| `category` | string | Optional, dynamic. |
| `carOwner` | string | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "DSP-810",
      "tripId": "TRP-7175",               // cross-references 4.1's shared lookup endpoint
      "riderName": "Nii Lante",
      "carOwnerName": "Akua Amankwah",
      "category": "Fare discrepancy",
      "amount": 18,                         // number, GHS, optional — omitted for non-monetary
                                              // disputes (e.g. a route-length complaint with no
                                              // refund amount attached)
      "status": "Open",                      // "Open" | "Under Review" | "Resolved" | "Escalated"
      "openedAt": "3h ago"                   // string — recommend ISO 8601
    }
  ],
  "page": 1, "pageSize": 8, "total": 12, "totalPages": 2
}
```

#### 4.2.7 Update trip dispute status

Status moves `Open` → `Under Review` → `Resolved`, or `Under Review` → `Escalated` → `Resolved`. `Resolved` is terminal.

**Endpoint:** `PATCH /trip-operations/trip-disputes/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "Under Review"   // "Under Review" | "Escalated" | "Resolved" — see the allowed-transition
                               // rule above; the backend should reject an out-of-order transition
                               // (e.g. "Open" straight to "Escalated" without passing through
                               // "Under Review" first)
}
```

**Response — `200 OK`:** the updated `TripDispute`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid status transition.

---

## 5. Verification

`/verification` covers Car Owner verification applications, across 4 status queues shown as tabs on one list page (**Pending** — which also includes `Resubmitted` applications, **Approved**, **Rejected**, **Expiring**), an application detail page, and a per-document review page with a zoomable document preview and an approve/reject form.

### Shared `VerificationApplication` shape

Returned in full by the get-by-id endpoint, and (documents/timeline included) after every mutation below — every mutation here changes documents or timeline, so returning the whole object keeps the frontend's cache trivially in sync.

```jsonc
{
  "id": "VER-5031",
  "ownerName": "Kwame Oppong",
  "vehicleModel": "Hyundai Accent",
  "vehicleYear": 2019,
  "vehicleColor": "White",
  "plate": "GS 1234-25",
  "phone": "+233 20 107 1148",
  "email": "kwame.oppong@gmail.com",
  "ghanaCard": "GHA-123456789-0",
  "address": "12 Spintex Road, Accra",
  "seats": 4,
  "corridor": "Accra–Tema",
  "status": "Pending",                // "Pending" | "Approved" | "Rejected" | "Expiring" | "Resubmitted"
  "priority": "High",                   // "Low" | "Medium" | "High" — see note below on how this is set
  "submitted": "Aug 12, 2026",           // string — recommend ISO 8601; see Conventions
  "reviewer": "Ama Mensah",              // optional — set once a decision has been made
  "decisionDate": "Aug 14, 2026",        // optional — string, recommend ISO 8601
  "rejectionReason": undefined,           // optional — set when status is "Rejected"
  "documents": [
    {
      "type": "driving-licence",          // "driving-licence" | "registration" | "insurance" | "roadworthy"
      "label": "Driving Licence",
      "issueDate": "Jan 10, 2024",         // string — recommend ISO 8601
      "expiryDate": "Jan 10, 2027",         // string — recommend ISO 8601
      "reviewer": "Ama Mensah",
      "status": "Pending review",           // "Approved" | "Pending review" | "Rejected" | "Expiring soon" | "Resubmitted"
      "fileName": "driving_licence_kwame.jpg",
      "fileSize": "1.2 MB",
      "submitted": "Aug 12, 2026",           // string — recommend ISO 8601
      "previousRejectionReason": undefined,    // optional — set if this document was rejected before and resubmitted
      "checks": ["Photo matches Ghana Card", "OCR details match application", "Document not expired"]
      // ^ checks: string[] — automated/manual verification checks already run against this
      // document (e.g. OCR/liveness matching). Read-only here; the admin doesn't edit this
      // list, it's populated by whatever verification pipeline runs when the document is
      // submitted by the car owner.
      //
      // NOTE FOR THE BACKEND TEAM: there is currently no file URL on this record. The
      // frontend's document preview is a client-rendered mock image (owner/vehicle/plate/
      // expiry overlaid on a placeholder), not the real uploaded file — there's nothing to
      // actually display yet. The real API needs to return a `fileUrl` (a signed, time-limited
      // URL to the actual uploaded image/PDF) per document so DocumentReviewPage can render
      // the real submission instead of a placeholder.
    }
    // ...one entry per required document type; always all 4 types (driving-licence,
    // registration, insurance, roadworthy) for a Car Owner application in the current mock.
  ],
  "timeline": [
    {
      "label": "Application submitted",
      "timestamp": "Aug 12, 2026, 9:04 AM",  // string — recommend ISO 8601
      "tone": "info",                          // Tone — success | danger | warning | info | neutral (shared app-wide type)
      "actor": "Kwame Oppong",                  // who performed the action — an admin name, the car
                                                  // owner's own name (e.g. a resubmission), or "System"
                                                  // for automated reminders
      "detail": undefined                        // optional — free-text/HTML detail, e.g. a sent
                                                  // notification's full message body (see 5.6)
    }
  ]
}
```

**Note on `priority`:** nothing in the frontend ever sets or edits this — it's presumably computed server-side (e.g. from how long an application has been waiting, or how soon a document expires) rather than admin-assigned. Worth confirming the actual computation rule with the backend team since the frontend has no logic for it either; it's a value to display and filter by, not one this frontend writes.

**Note on `status: "Expiring"`:** nothing in the frontend transitions an application into this status either — recommend a scheduled/backend job that flips an application (and its affected document, to `"Expiring soon"`) to this status automatically as a document's `expiryDate` approaches, rather than any admin action.

**Note on the reject/approve business rule** (carried over exactly from the current mock logic, since it's a real decision baked into the UI, not just a display detail): rejecting **any single document** immediately sets the whole application's `status` to `"Rejected"` — it isn't a per-document-only change. Approving a document only flips the whole application to `"Approved"` once **every** document is `"Approved"`. Worth confirming with the backend team that this "any one rejection fails the whole application" rule is actually the intended business logic, since it means a car owner with 3 good documents and 1 bad one is fully rejected, not partially approved.

### 5.1 List applications

Powers the list page's table (`/verification/:tab`, e.g. `/verification/pending`).

**Endpoint:** `GET /verification/applications`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `tab` | `pending` \| `approved` \| `rejected` \| `expiring` \| `all` | Required. `pending` includes both `Pending` and `Resubmitted` applications. `all` returns every application regardless of status (used for stats/filter-option derivation today — see [5.2](#52-get-verification-stats) for why that should move server-side instead). |
| `search` | string | Optional — matches owner name or application id. |
| `priority` | `Low` \| `Medium` \| `High` | Optional. |
| `corridor` | string | Optional, dynamic. |

No pagination on this page currently — recommend adding real `page`/`pageSize` params (same shape as every other list endpoint in this doc) once the applicant volume justifies it; the mock returns every matching row unpaginated.

**Response — `200 OK`**

```jsonc
{
  "items": [ /* VerificationApplication[] — full shape, including documents/timeline, per row */ ]
}
```

Returning full `documents`/`timeline` per row here is redundant for a list view (the table only shows an approved-count and doesn't need the whole document/timeline detail) — recommend a lighter list-item shape that omits `documents`/`timeline` (keeping just a `documentsApproved`/`documentsTotal` count pair) and reserves the full nested shape for [5.4](#54-get-application-by-id)'s single-record fetch, to avoid shipping every document/timeline entry for every row on every page load.

### 5.2 Get verification stats

The 4 stat tiles, the "Queue workload" panel, and "Recent decisions" panel above the table are all currently computed by fetching **every** application (`tab=all`) client-side — wasteful, and exactly the same pattern already flagged for Users. Recommend a dedicated endpoint instead.

**Endpoint:** `GET /verification/stats`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "pending": 12,      // count with status "Pending" or "Resubmitted"
  "approved": 48,
  "rejected": 6,
  "expiring": 4,
  "recentDecisions": [
    // the 5 most recently decided applications (any of Approved/Rejected), most-recent-first
    { "id": "VER-5031", "ownerName": "Kwame Oppong", "status": "Approved" }
    // a minimal shape — just enough for the sidebar list; not the full VerificationApplication
  ]
}
```

### 5.3 Get filter options

**Endpoint:** `GET /verification/filter-options`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "corridors": ["Accra–Tema", "Achimota–Airport", "Adenta–Airport", "Kasoa–Accra", "Madina–Osu", "Tema–Accra"]
  // distinct corridor values across all applications, sorted alphabetically — same
  // "derive dynamic options from real data" convention as Users' filter-options endpoint
}
```

`priority` is a fixed 3-value option list (`Low`/`Medium`/`High`), not data-derived — no endpoint needed for it.

### 5.4 Get application by id

Powers the Application Detail page (`/verification/:tab/:ownerId`) and, indirectly, the Document Review page (which fetches the same application and picks one document out of its `documents` array by `docType`).

**Endpoint:** `GET /verification/applications/:id`

**Auth:** Any authenticated admin.

**Response — `200 OK`:** the full [shared `VerificationApplication` shape](#shared-verificationapplication-shape), including `documents` and `timeline`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

### 5.5 Review a document

Powers the Document Review page's Approve/Reject actions. Rejecting requires a reason (selected from a fixed list, with optional free-text notes appended); approving needs nothing further.

**Endpoint:** `POST /verification/applications/:id/documents/:docType/review`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "decision": "reject",   // "approve" | "reject", required
  "reason": "Document details could not be verified — expiry date illegible in the uploaded scan."
  // required when decision is "reject"; the frontend composes this from a fixed reason
  // picklist (Document details could not be verified / Owner or vehicle details do not
  // match / Document has expired / Document is unreadable or incomplete / Other) plus an
  // optional free-text note, joined as "{reason label} — {notes}". Recommend the backend
  // accept a structured { "reasonCode": "unverifiable" | "mismatch" | "expired" | "illegible"
  // | "other", "notes"?: string } instead of one pre-joined string, so the reason is
  // queryable/reportable on its own rather than baked into free text — a small improvement
  // over what the current mock does.
}
```

**Response — `200 OK`:** the full updated [shared `VerificationApplication` shape](#shared-verificationapplication-shape) — the reviewed document's `status` (and, on reject, its `previousRejectionReason`), a new `timeline` entry (`actor` = the authenticated admin, from the session), and possibly the application's own `status`/`reviewer`/`decisionDate` if this decision completed or failed the whole application (see the reject/approve business rule noted above).

**Errors:** `404 NOT_FOUND` if `id` or `docType` doesn't exist on that application. `422 VALIDATION_ERROR` if `decision` is `"reject"` with no `reason`. `409 CONFLICT` if the document has already been decided (`Approved`/`Rejected`) and isn't awaiting re-review.

### 5.6 Notify car owner

Powers the "Notify Car Owner" drawer — a rich-text message composer, prepopulated with a status-appropriate default the admin can edit before sending. Sending is itself logged as a `timeline` entry, so it shows up the next time the Activity Log is opened — there's no separate "activity log" endpoint, since the log is just this same application's `timeline` field, already returned in full by [5.4](#54-get-application-by-id).

**Endpoint:** `POST /verification/applications/:id/notify`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "message": "<p>Hi Kwame Oppong, your application is currently under review...</p>"
  // string, required, HTML — authored in a rich-text editor (bold/italic/underline, lists,
  // links). Validated non-empty after stripping tags (the editor's "empty" output is
  // "<p><br></p>", not ""), so an admin can't submit a visually-blank message.
}
```

**Response — `200 OK`:** the full updated [shared `VerificationApplication` shape](#shared-verificationapplication-shape), with a new `timeline` entry — `label: "Notification sent to Car Owner"`, `tone: "info"`, `actor` = the authenticated admin, `detail` = the message HTML verbatim.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` if `message` is empty (after tag-stripping).

**Open question for the backend team:** the frontend describes this as "sent as an in-app notification" — worth confirming with the backend/product team whether it should also actually email/SMS the car owner, or if in-app-only is the intended real behavior; the mock has no real delivery channel to speak of either way.

### 5.7 Delete application

Available both from the list page's row actions and from a button on the Application Detail page's header.

**Endpoint:** `DELETE /verification/applications/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

**Same open question as Users' delete ([3.8](#38-delete-user)):** the frontend's confirm dialog says this "permanently removes the application, its submitted documents and its full activity log" — worth deciding whether a real backend should hard-delete or retain a soft-deleted/archived record, particularly since a rejected-and-deleted application could be relevant to a later dispute or compliance question about why a car owner was denied.

---

## 6. Route Management

`/route-management` is a single flat page (no sub-tabs) — full CRUD over the fixed routes car owners are matched against, with fare configuration and per-route coverage. No reference screenshot existed for this module; it was designed in-house, so there's no external design system driving its shape — the endpoints below just mirror what the one page actually needs.

### Shared `ManagedRoute` shape

```jsonc
{
  "id": "RTE-1043",
  "name": "Accra–Tema Express",
  "corridor": "Accra–Tema",
  "origin": "Accra Central",
  "destination": "Tema Station",
  "distanceKm": 28,
  "baseFare": 8,                    // number, GHS
  "perKmRate": 1.2,                  // number, GHS per km
  "assignedCarOwners": 14,            // number — count of car owners currently assigned to this
                                        // route. Computed/derived from real car-owner-to-corridor
                                        // assignments elsewhere in the platform, not a value an
                                        // admin ever sets directly — excluded from the create/update
                                        // request body below for that reason.
  "status": "Active",                  // "Active" | "Inactive" | "Under Review"
  "lastUpdated": "Aug 20, 2026"          // string — recommend ISO 8601; see Conventions. System-
                                          // stamped on every create/update, not admin-set.
}
```

### 6.1 List routes

**Endpoint:** `GET /route-management/routes`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches route name, id, origin, or destination. |
| `status` | `Active` \| `Inactive` \| `Under Review` | Optional. |
| `corridor` | string | Optional, dynamic. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |

The mock returns every route unpaginated and paginates/filters client-side, same as most other list pages in this doc — but unlike Users or Trip Operations, the number of fixed routes a platform operates is naturally small and bounded (routes are defined by an admin, not generated by user activity), so **it may be reasonable for the real backend to just return the full list in one call with no pagination at all** — worth a quick call with the backend team on whether route count will ever be large enough to justify paginating, before building it either way.

**Response — `200 OK`**

```jsonc
{
  "items": [ /* ManagedRoute[], see shared shape above */ ],
  "page": 1,
  "pageSize": 8,
  "total": 22,
  "totalPages": 3
}
```

If the backend team decides against pagination (see the note above), this can simply be `{ "items": [ /* ManagedRoute[] */ ] }` with no envelope — the frontend's stat tiles (Total Routes / Active Routes / Avg. Base Fare / Corridors Covered) and the `corridor` filter's dynamic options are currently both derived client-side from this same full list, which only works cleanly if the list isn't paginated. If it is paginated, those two would need to move to their own endpoints (a `/route-management/stats` and `/route-management/filter-options`, matching the pattern used for Users/Verification).

### 6.2 Create route

Powers the "Add route" button's drawer form.

**Endpoint:** `POST /route-management/routes`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "name": "Accra–Tema Express",
  "corridor": "Accra–Tema",
  "origin": "Accra Central",
  "destination": "Tema Station",
  "distanceKm": 28,
  "baseFare": 8,
  "perKmRate": 1.2,
  "status": "Active"   // "Active" | "Inactive" | "Under Review" — an admin can create a route
                          // directly into any of the 3 statuses, e.g. "Under Review" for one
                          // still being vetted before it goes live
}
```

`assignedCarOwners` (starts at `0` for a brand-new route) and `lastUpdated` are excluded — both are system-set, not part of what the form asks the admin for.

**Response — `201 Created`:** the newly-created [shared `ManagedRoute` shape](#shared-managedroute-shape), with a server-assigned `id`.

**Errors:** `422 VALIDATION_ERROR` for missing/invalid fields (e.g. negative `distanceKm`/`baseFare`/`perKmRate`).

### 6.3 Update route

Powers the drawer's Edit mode — the same field set as create, since every one of those fields is legitimately admin-correctable after the fact (unlike, say, Users' narrower edit set).

**Endpoint:** `PATCH /route-management/routes/:id`

**Auth:** Any authenticated admin.

**Request body:** identical shape to [6.2](#62-create-route)'s request body.

**Response — `200 OK`:** the updated [shared `ManagedRoute` shape](#shared-managedroute-shape), with `lastUpdated` refreshed.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for invalid fields.

### 6.4 Set route status

The table row's quick Activate/Deactivate action — a lightweight status-only toggle, distinct from a full edit through [6.3](#63-update-route). Only ever used to flip between `Active` and `Inactive` from this action; putting a route into `Under Review` is only done through the full edit form.

**Endpoint:** `POST /route-management/routes/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "Inactive"   // "Active" | "Inactive"
}
```

**Response — `200 OK`:** the updated [shared `ManagedRoute` shape](#shared-managedroute-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

### 6.5 Delete route

**Endpoint:** `DELETE /route-management/routes/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

**Open question for the backend team:** the frontend's confirm dialog already spells out the real operational concern here — "Car owners assigned to it will need to be reassigned to another route" — so unlike Users/Verification's delete (where the question was hard-delete vs. soft-delete for compliance reasons), the concern here is more concrete: **should deleting a route with car owners still assigned be blocked outright** (refusing the delete with a `409 CONFLICT` until they're reassigned — the same defensive pattern used elsewhere in this app whenever deleting one record would orphan another), **or does it proceed and reassign/unassign those car owners automatically?** The current mock doesn't model car-owner-to-route assignment at all, so it has no existing logic to carry over here — this is a real decision for the backend team to make, not something to infer from current behavior.

---

## 7. Finance

`/finance` has 4 sidebar entries: **Overview** (single page), **Wallets** (Rider Wallets, Car Owner Wallets), **Payouts** (Withdrawal Requests, Approval Queue), and **Refunds & Audit** (Refunds & Credits, Financial Audit Logs) — 7 pages total. Manual Adjustments, Settlement Runs, Reconciliation Exceptions, and Ledger Entries all existed earlier in the rebuild but were removed as standalone pages; nothing below documents them.

**Segregation of duties, carried over from the reference design (Finance 2):** Withdrawal Requests shows every submitted payout request read-only — the actual approve/reject decision happens on a separate page, Approval Queue, over a separate fixture list. This isn't an oversight; it mirrors a real control where "who can see a request" and "who can decide on it" are deliberately different surfaces.

### 7.1 Get finance overview

**Endpoint:** `GET /finance/overview`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "stats": {
    "riderBalances": 48210,             // number, GHS — total across all rider wallets
    "carOwnerAvailable": 31640,          // number, GHS — total available (payout-ready) car owner earnings
    "pendingEarnings": 9820,             // number, GHS — car owner earnings not yet available for payout
    "withdrawalRequests": 34,            // count of withdrawal requests (any status)
    "withdrawalRequestsAwaiting": 12,    // count still awaiting a decision
    "payoutsProcessed": 128400,          // number, GHS — total paid out
    "pendingRefunds": 5                  // count of refund/service-credit requests still "Pending review"
  },
  "walletPositions": {
    "riderAvailable": 41300,     // number, GHS
    "riderCredits": 6910,          // number, GHS — service credits (non-cash) balance
    "carOwnerAvailable": 31640,     // number, GHS
    "carOwnerPending": 9820,         // number, GHS
    "carOwnerTotal": 41460             // number, GHS — carOwnerAvailable + carOwnerPending
  },
  "withdrawalStatus": {
    "successful": 22,
    "pending": 8,
    "failed": 3,
    "reversed": 1
  },
  "recentActivity": [
    {
      "id": "ACT-8801",
      "time": "9:41 AM",              // string — recommend ISO 8601; see Conventions
      "account": "Kwame Oppong (Car Owner)",
      "event": "Withdrawal paid out",
      "amount": -450,                  // number, GHS — negative for money leaving the platform
                                          // (withdrawals/refunds), positive for money in
      "status": "Completed"             // "Completed" | "Processing" | "Recorded" | "Processed"
    }
    // ...a short recent feed, same "capped, not the full ledger" pattern as Overview's
    // recentActions and Trip Operations' recentTrips
  ],
  "cashFlowTrend": [
    { "date": "Aug 20", "inflow": 18400, "outflow": 11200 }
    // 7 days, oldest first — for the Cash Flow Trend area chart. inflow/outflow: number, GHS.
  ],
  "payoutsByChannel": [
    { "channel": "Mobile Money", "amount": 84200 },
    { "channel": "Bank account", "amount": 44200 }
    // sum of netPayout for "Paid" withdrawal requests, grouped by payoutMethod — recommend
    // the backend compute this the same way (a real aggregation), not a hardcoded number,
    // so it can never drift from the underlying withdrawal-requests data.
  ]
}
```

### 7.2 List rider wallets

**Endpoint:** `GET /finance/rider-wallets`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name or wallet id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Active` \| `Suspended` | Optional. |
| `balanceTier` | `none` \| `under100` \| `100plus` | Optional — fixed buckets over `totalBalance` (`none` = exactly 0, `under100` = 0 < x < 100, `100plus` = ≥ 100). |
| `adjustments` | `yes` \| `no` | Optional — whether the wallet has any recorded adjustments (`adjustments` count field is 0 or not). |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "RWL-7701",
      "riderName": "Kofi Asare",
      "cashBalance": 62,           // number, GHS
      "serviceCredits": 15,          // number, GHS
      "totalBalance": 77,             // number, GHS — cashBalance + serviceCredits
      "payments": 24,                   // count of payments made from this wallet
      "adjustments": 1,                  // count of manual adjustments ever applied to this wallet
      "lastActivity": "2h ago",             // string — recommend ISO 8601
      "status": "Active"                     // "Active" | "Suspended"
    }
  ],
  "page": 1, "pageSize": 8, "total": 14, "totalPages": 2
}
```

Read-only — no mutation exists for a rider wallet on this page.

### 7.3 List car owner wallets

**Endpoint:** `GET /finance/car-owner-wallets`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches car owner name or wallet id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Payout ready` \| `Active` \| `Restricted` \| `Setup required` | Optional. |
| `withdrawals` | `none` \| `some` \| `many` | Optional — fixed buckets over the `withdrawals` count (`none` = 0, `some` = 1–2, `many` = ≥ 3). |
| `earningsTier` | `none` \| `under500` \| `500plus` | Optional — fixed buckets over `totalWallet` (same boundary logic as rider wallets' `balanceTier`). |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "COW-4402",
      "carOwnerName": "Kwame Oppong",
      "availableEarnings": 620,      // number, GHS — ready to withdraw now
      "pendingEarnings": 140,          // number, GHS — not yet available
      "totalWallet": 760,               // number, GHS — availableEarnings + pendingEarnings
      "earnedThisPeriod": 980,           // number, GHS — gross earnings this period, before commission
      "commission": 98,                   // number, GHS — platform commission deducted this period
      "withdrawals": 3,                    // count of withdrawals ever made
      "walletStatus": "Payout ready"          // "Payout ready" | "Active" | "Restricted" | "Setup required"
    }
  ],
  "page": 1, "pageSize": 8, "total": 10, "totalPages": 2
}
```

Read-only — no mutation exists for a car owner wallet on this page either. (`walletStatus: "Restricted"` presumably reflects something decided elsewhere — e.g. a Users suspension or a Verification rejection — rather than being set from this page; worth confirming that cross-module link with the backend team so `Restricted` actually reflects real account state rather than drifting independently.)

### 7.4 List withdrawal requests

Read-only by design — see the segregation-of-duties note above. The decision happens in [7.5](#75-list-approval-queue)/[7.6](#76-decide-an-approval-queue-item), over a separate record.

**Endpoint:** `GET /finance/withdrawal-requests`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches car owner name or request id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Awaiting review` \| `Processing` \| `Paid` \| `Failed` \| `Reversed` | Optional. |
| `payoutMethod` | `Mobile Money` \| `Bank account` | Optional. |
| `risk` | `Low` \| `Medium` \| `High` | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "WD-9021",
      "carOwnerName": "Kwame Oppong",
      "payoutMethod": "Mobile Money",     // "Mobile Money" | "Bank account"
      "payoutAccount": "024•••1148",         // masked account/mobile number
      "amount": 500,                          // number, GHS — requested amount, before fee
      "fee": 5,                                 // number, GHS
      "netPayout": 495,                           // number, GHS — amount - fee
      "requestedAt": "Aug 24, 2026",                // string — recommend ISO 8601
      "status": "Awaiting review",                    // "Awaiting review" | "Processing" | "Paid" | "Failed" | "Reversed"
      "risk": "Low"                                     // "Low" | "Medium" | "High"
    }
  ],
  "page": 1, "pageSize": 8, "total": 34, "totalPages": 5
}
```

### 7.5 List approval queue

Powers Approval Queue — the actual reviewer-decision surface for payout requests, over its own fixture list (`ApprovalQueueItem`, not `WithdrawalRequest` — the two model different lifecycles even though they overlap conceptually; see the segregation-of-duties note above for why they're kept separate).

**Endpoint:** `GET /finance/approval-queue`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches car owner name or item id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `risk` | `Low` \| `Medium` \| `High` | Optional. |
| `eligibility` | `Eligible` \| `Policy review` \| `Duty conflict` | Optional. |
| `outcome` | `Awaiting Approval` \| `Approved` \| `Rejected` | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "APQ-201",
      "carOwnerName": "Kwame Oppong",
      "netPayout": 495,             // number, GHS
      "payoutAccount": "024•••1148",
      "reviewedBy": "—",              // string — the reviewing admin's name once decided, else a placeholder
      "queueAge": "3h",                 // string — recommend a raw duration/ISO timestamp of when it entered the queue instead
      "risk": "Low",                      // "Low" | "Medium" | "High"
      "eligibility": "Eligible",             // "Eligible" | "Policy review" | "Duty conflict"
      "outcome": "Awaiting Approval"           // "Awaiting Approval" | "Approved" | "Rejected"
    }
  ],
  "page": 1, "pageSize": 8, "total": 12, "totalPages": 2
}
```

**Note on `eligibility`:** `"Policy review"`/`"Duty conflict"` rows can't be actioned from this queue at all (see [7.6](#76-decide-an-approval-queue-item)) — they can only be viewed. Recommend confirming with the backend team what actually resolves one of those two states (a separate policy-review workflow? a different reviewer without the conflicting duty?), since nothing in this module currently changes `eligibility` — it's a value this frontend only ever reads.

### 7.6 Decide an approval queue item

Approve/reject a payout — gated to rows that are both `outcome: "Awaiting Approval"` **and** `eligibility: "Eligible"`; a `Policy review` or `Duty conflict` row shows no action at all, enforcing segregation of duties (an admin can't approve around a flagged policy or conflict issue from this screen).

**Endpoint:** `POST /finance/approval-queue/:id/decision`

**Auth:** Any authenticated admin. **Recommend the backend re-check the eligibility/outcome gate server-side too** — the frontend hides the buttons for ineligible rows, but a real backend shouldn't rely on the UI alone to enforce a segregation-of-duties rule this important.

**Request body**

```jsonc
{
  "outcome": "Approved"   // "Approved" | "Rejected"
}
```

**Response — `200 OK`:** the updated `ApprovalQueueItem`, with `reviewedBy` set to the authenticated admin (from the session, not client-supplied).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if `outcome` isn't `"Awaiting Approval"`, or `eligibility` isn't `"Eligible"`.

### 7.7 List refunds & credits

**Endpoint:** `GET /finance/refunds-credits`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches rider name or record id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `type` | `Refund` \| `Service Credit` | Optional. |
| `status` | `Pending review` \| `Completed` \| `Processed` \| `Rejected` | Optional. |
| `requestedBy` | string | Optional, dynamic — the admin/agent who filed the request. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "RFC-330",
      "type": "Refund",                      // "Refund" | "Service Credit"
      "riderName": "Abena Ofori",
      "sourceRecord": "TRP-7188",              // the trip/dispute this refund traces back to
      "amount": 18,                              // number, GHS
      "reason": "Fare dispute resolved in rider's favor",
      "requestedBy": "Ama Mensah",                 // the admin/agent who filed this request
      "status": "Pending review",                   // "Pending review" | "Completed" | "Processed" | "Rejected"
      "createdAt": "Aug 22, 2026"                    // string — recommend ISO 8601
    }
  ],
  "page": 1, "pageSize": 8, "total": 16, "totalPages": 2
}
```

**Note on `status`:** the only two values a decision through [7.8](#78-decide-a-refundcredit) ever produces are `"Completed"` (approve) and `"Rejected"` (reject) — `"Processed"` exists in the type and appears in seed data, but nothing in the frontend ever transitions a record into it. Worth clarifying with the backend team what distinguishes `"Processed"` from `"Completed"` (e.g. "the refund decision was made" vs. "the money has actually settled back to the rider"), since as written they read as two different stages of the same outcome, not two independent end states.

### 7.8 Decide a refund/credit

Gated to `"Pending review"` rows only.

**Endpoint:** `POST /finance/refunds-credits/:id/decision`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "Completed"   // "Completed" | "Rejected" — see the note above on "Processed"
}
```

**Response — `200 OK`:** the updated `RefundCredit`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if not currently `"Pending review"`.

### 7.9 List financial audit logs

Read-only, no reference screenshot — designed in-house as a chronological trail of every approval/rejection/correction made across the other Finance pages. Same "an audit trail entry isn't meant to be mutable" reasoning as Administration's Activity Logs — no row action beyond View exists here.

**Endpoint:** `GET /finance/audit-logs`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches actor, action, target, or reference. |
| `page` / `pageSize` | number | Optional, default `1` / `10` (this page uses a page size of 10, not 8, unlike every other Finance list). |
| `result` | `Success` \| `Rejected` \| `Failed` | Optional. |
| `actor` | string | Optional, dynamic. |
| `action` | string | Optional, dynamic. |

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "FAL-1102",
      "time": "9:41 AM",             // string — recommend ISO 8601
      "actor": "Ama Mensah",           // the admin who performed the action
      "action": "Approved payout",       // human-readable action description
      "target": "Kwame Oppong",             // who/what the action was performed on
      "reference": "APQ-201",                 // the underlying record id this log entry traces back to
      "result": "Success"                       // "Success" | "Rejected" | "Failed"
    }
  ],
  "page": 1, "pageSize": 10, "total": 40, "totalPages": 4
}
```

**Recommend this be populated automatically by the backend** whenever a decision is made through [7.6](#76-decide-an-approval-queue-item)/[7.8](#78-decide-a-refundcredit) (or any other Finance decision point), rather than being a separately-written record — a real audit log's integrity depends on every action writing to it as a side effect of the action itself, not as a second, skippable step the admin (or client code) has to remember to also do.

---

## 8. Safety

`/safety` is a single flat page (no sub-tabs) — the Emergency SOS Desk, monitoring panic-button and collision alerts with rapid dispatch. A second page, Response Units, existed earlier in the rebuild but was removed outright once it turned out the platform didn't need two Safety pages — nothing below documents it.

**No delete anywhere in this module.** An SOS alert is a safety incident record — arbitrarily deleting one would be the wrong instinct for a safety system, the same reasoning that keeps a `Sent` broadcast or a completed Settlement Run immutable elsewhere in this app. The only mutations are status transitions and appending an incident note; nothing here ever removes a record.

### Shared `SosAlert` shape

```jsonc
{
  "id": "SOS-4471",
  "tripId": "TRP-7188",
  "commuterName": "Efua Owusu",
  "commuterPhone": "+233 24 501 2277",
  "carOwnerName": "Francis R. Mensah",
  "carOwnerPhone": "+233 20 883 9911",
  "vehicleModel": "Nissan Sentra",
  "plate": "GT 1150-21",
  "location": "Spintex Rd, near Palace Mall",
  "triggerReason": "Panic button pressed",     // free text — e.g. "Panic button pressed", "Sudden deceleration detected"
  "priority": "Critical",                        // "Critical" | "Medium" | "Low"
  "status": "Active",                              // "Active" | "Dispatched" | "Resolved"
  "timestamp": "2m ago",                             // string — recommend ISO 8601; see Conventions
  "notes": [
    {
      "id": "NOTE-SOS-4471-1",
      "author": "Kwabena Duah",       // the operator who logged this note
      "message": "Called commuter — confirmed still in vehicle, driver appears agitated.",
      "timestamp": "1m ago"             // string — recommend ISO 8601
    }
  ]
  // notes: IncidentNote[] — a running call/verification log, plain text (not rich text —
  // these are short factual operator entries, not a message composed for an end user, so
  // this doesn't use the Quill editor Notify Car Owner/tickets/broadcasts use elsewhere).
}
```

### 8.1 List SOS alerts

**Endpoint:** `GET /safety/sos-alerts`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches commuter name, car owner name, location, or alert id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `priority` | `Critical` \| `Medium` \| `Low` | Optional. |
| `status` | `Active` \| `Dispatched` \| `Resolved` | Optional. |

Given the nature of this data (live emergency incidents), **recommend the real implementation push updates rather than relying on polling/refetch alone** — e.g. a WebSocket or server-sent-events channel that notifies the admin console the moment a new SOS alert fires, rather than an admin only finding out on the next page load or manual refresh. The current mock has no real-time mechanism at all; this is worth raising with the backend team given what this page is actually for.

**Response — `200 OK`**

```jsonc
{
  "items": [ /* SosAlert[], see shared shape above */ ],
  "page": 1, "pageSize": 8, "total": 11, "totalPages": 2
}
```

### 8.2 Get SOS alert by id

Powers the incident detail drawer — fetched reactively by id (not a snapshot of the row already on the page) specifically because adding an incident note from inside the open drawer needs to appear in the same drawer immediately, the same class of staleness bug already found and fixed for Support's ticket drawer.

**Endpoint:** `GET /safety/sos-alerts/:id`

**Auth:** Any authenticated admin.

**Response — `200 OK`:** the full [shared `SosAlert` shape](#shared-sosalert-shape), including `notes`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

### 8.3 Update alert status

Status only moves forward: `Active` → `Dispatched` → `Resolved`, or `Active` → `Resolved` directly (an operator can resolve without a unit ever being dispatched — e.g. a false alarm confirmed by phone). `Resolved` is terminal — no action renders past it in either the table or the drawer.

**Endpoint:** `POST /safety/sos-alerts/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "Dispatched"   // "Dispatched" | "Resolved" — the backend should reject an
                             // out-of-order transition (e.g. "Resolved" back to "Dispatched")
                             // even though the frontend only ever sends valid ones
}
```

**Response — `200 OK`:** the updated [shared `SosAlert` shape](#shared-sosalert-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid status transition.

### 8.4 Add an incident note

**Endpoint:** `POST /safety/sos-alerts/:id/notes`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "message": "Called commuter — confirmed still in vehicle, driver appears agitated."   // string, required
}
```

**Response — `200 OK`:** the updated [shared `SosAlert` shape](#shared-sosalert-shape), with the new note appended to `notes` (`id`/`author`/`timestamp` all system-assigned — `author` from the authenticated session, not client-supplied).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` if `message` is empty.

---

## 9. Support

`/support` covers two pages: **Tickets** (Open/Resolved views of one ticket list, reached via an in-page tab switch rather than separate sidebar entries — "Open" also includes `In Progress`) and **Broadcast Studio** (composing and sending notices to riders/car owners).

### Shared `SupportTicket` shape

```jsonc
{
  "id": "TCK-1091",
  "userName": "Kofi Asare",
  "userRole": "Rider",                  // "Rider" | "Car Owner"
  "category": "Fare & Billing",           // fixed picklist on create/edit — see 9.3/9.4;
                                            // one of: "Fare & Billing", "App Crash / GPS",
                                            // "Lost & Found", "Driver Conduct",
                                            // "Account & Security", "Route Navigation"
  "subject": "Double charging on Mobile Money payment",
  "description": "Full ticket body, as originally raised — not admin-editable after the fact.",
  "priority": "High",                      // "High" | "Medium" | "Low"
  "status": "Open",                          // "Open" | "In Progress" | "Resolved"
  "region": "Accra Greater Area",              // free text, admin-editable
  "createdAt": "5m ago",                          // string — recommend ISO 8601; see Conventions
  "assignedTo": "Kwabena Duah",                     // optional — the support agent currently
                                                      // working the ticket; free text, not a
                                                      // fixed agent picklist in the current mock.
                                                      // Unassigned (omitted) is normal for a
                                                      // freshly-opened ticket.
  "replies": [
    {
      "id": "RPL-TCK-1091-1",
      "author": "Kwabena Duah",
      "authorType": "Admin",         // "Admin" | "User" — drives which side of the chat thread
                                       // the bubble renders on
      "message": "<p>Thanks for reporting this — we're looking into the duplicate charge now.</p>",
      "timestamp": "3m ago"             // string — recommend ISO 8601
    }
  ]
  // replies: TicketReply[] — a two-sided conversation thread, oldest-first. `message` is
  // rich-text HTML from the reply composer's editor, rendered via dangerouslySetInnerHTML
  // (safe here since it always originates from this app's own editor — admin-authored — same
  // reasoning as Verification's notification log).
}
```

### 9.1 List support tickets

**Endpoint:** `GET /support/tickets`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `tab` | `open` \| `resolved` | Required. `open` includes both `Open` and `In Progress` tickets. |
| `search` | string | Optional — matches user name, subject, or ticket id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `priority` | `High` \| `Medium` \| `Low` | Optional. |
| `category` | string | Optional — one of the fixed category values. |
| `region` | string | Optional, dynamic. |

**Response — `200 OK`**

```jsonc
{
  "items": [ /* SupportTicket[] — recommend a lighter list shape that omits `replies` here,
              same reasoning as Verification's application list, reserving the full reply
              thread for the single-record fetch below */ ],
  "page": 1, "pageSize": 8, "total": 22, "totalPages": 3
}
```

### 9.2 Get ticket by id

Fetched reactively by id (not a snapshot of the row already on the page) — a reply sent from inside the open drawer needs to appear in that same drawer immediately, the exact staleness bug found and fixed here first before the same pattern was applied to Safety's alert drawer.

**Endpoint:** `GET /support/tickets/:id`

**Auth:** Any authenticated admin.

**Response — `200 OK`:** the full [shared `SupportTicket` shape](#shared-supportticket-shape), including `replies`.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

### 9.3 Create a ticket

Manually logs a ticket raised outside the app (e.g. a phoned-in report) — always starts `Open` and unassigned, the same lifecycle as a ticket a user raises themselves in-app (which presumably arrives through a different, user-facing endpoint not documented here, since this admin console only ever manually logs one).

**Endpoint:** `POST /support/tickets`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "userName": "Kofi Asare",
  "userRole": "Rider",              // "Rider" | "Car Owner"
  "category": "Fare & Billing",       // required, one of the fixed category values — always a
                                        // dropdown, never free text (a standing rule in this app
                                        // for any classificatory field)
  "subject": "Double charging on Mobile Money payment",
  "description": "Rider was charged twice for the same trip via Mobile Money.",
  "priority": "High",                    // "High" | "Medium" | "Low"
  "region": "Accra Greater Area"           // free text
}
```

**Response — `201 Created`:** the newly-created [shared `SupportTicket` shape](#shared-supportticket-shape), with `status: "Open"`, `assignedTo` omitted, and `replies: []`.

**Errors:** `422 VALIDATION_ERROR` for missing required fields.

### 9.4 Update a ticket

Powers the drawer's Edit mode. Deliberately narrow — `category`/`priority`/`region`/`assignedTo` are the parts of a ticket an admin actively triages; `userName`/`userRole`/`description`/`createdAt` (the ticket as originally raised) and `status` (its own [Start progress/Mark resolved flow](#95-update-ticket-status)) stay out.

**Endpoint:** `PATCH /support/tickets/:id`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "category": "Fare & Billing",
  "priority": "High",
  "region": "Accra Greater Area",
  "assignedTo": "Kwabena Duah"   // optional — omit/empty to unassign
}
```

**Response — `200 OK`:** the updated [shared `SupportTicket` shape](#shared-supportticket-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid category.

### 9.5 Update ticket status

Status only moves forward: `Open` → `In Progress` → `Resolved`, or `Open` → `Resolved` directly. `Resolved` is terminal.

**Endpoint:** `POST /support/tickets/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "status": "In Progress"   // "In Progress" | "Resolved"
}
```

**Response — `200 OK`:** the updated [shared `SupportTicket` shape](#shared-supportticket-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid status transition.

### 9.6 Reply to a ticket

Sending a reply does two things at once, deliberately mirroring how a real helpdesk behaves: the message is logged to the thread, **and** if the ticket was still `Open` it auto-transitions to `In Progress` and auto-assigns the replying admin if nobody was assigned yet — replying to a ticket that says "nobody's on this" would otherwise contradict itself.

**Endpoint:** `POST /support/tickets/:id/replies`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "message": "<p>Thanks for reporting this — we're looking into the duplicate charge now.</p>"
  // string, required, HTML from a rich-text editor. Validated non-empty after stripping tags
  // (the editor's "empty" output is "<p><br></p>", not ""), same convention as Verification's
  // Notify Car Owner message.
}
```

**Response — `200 OK`:** the updated [shared `SupportTicket` shape](#shared-supportticket-shape) — new reply appended (`author`/`authorType` = the authenticated admin, from the session), plus `status`/`assignedTo` updated per the auto-transition rule above if applicable.

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` if `message` is empty (after tag-stripping).

### 9.7 Delete a ticket

**Endpoint:** `DELETE /support/tickets/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

**Same open question as Users'/Verification's delete:** the confirm dialog says this "permanently removes the ticket and its full reply history" — worth confirming hard-delete vs. soft-delete/archive with the backend team, particularly since a support conversation could matter later for a pattern-of-complaints question about a specific rider or car owner.

---

### Shared `Broadcast` shape

```jsonc
{
  "id": "BRD-5210",
  "title": "Scheduled maintenance tonight",
  "channel": "In-App Notice",    // "In-App Notice" | "Email" | "Push Notification" | "SMS" —
                                    // determines the message format below
  "message": "<p>The app will be briefly unavailable tonight from 1–2 AM for maintenance.</p>",
  // string — rich-text HTML for "In-App Notice"/"Email" channels; **plain text** for
  // "Push Notification" (150-char budget) and "SMS" (160-char budget, the classic
  // single-segment limit) — those two channels have no formatting, just a character limit.
  // The backend should validate the length limit server-side for SMS/Push, not just trust
  // the frontend's client-side check.
  "audience": "Everyone",          // "All Riders" | "All Car Owners" | "Everyone"
  "status": "Sent",                  // "Sent" | "Scheduled" | "Draft"
  "sentAt": "Just now",                // string — recommend ISO 8601; "Not sent yet" for a
                                         // still-Draft broadcast
  "reach": 4200                          // number — count of recipients reached; 0 until Sent
}
```

### 9.8 List broadcasts

**Endpoint:** `GET /support/broadcasts`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches title or broadcast id. |
| `page` / `pageSize` | number | Optional, default `1` / `8`. |
| `status` | `Sent` \| `Scheduled` \| `Draft` | Optional. |
| `audience` | `All Riders` \| `All Car Owners` \| `Everyone` | Optional. |
| `channel` | `In-App Notice` \| `Email` \| `Push Notification` \| `SMS` | Optional. |

**Response — `200 OK`**

```jsonc
{
  "items": [ /* Broadcast[], see shared shape above */ ],
  "page": 1, "pageSize": 8, "total": 18, "totalPages": 3
}
```

### 9.9 Create a broadcast

**Endpoint:** `POST /support/broadcasts`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "title": "Scheduled maintenance tonight",
  "channel": "In-App Notice",
  "message": "<p>The app will be briefly unavailable tonight from 1–2 AM for maintenance.</p>",
  "audience": "Everyone"
}
```

**Response — `201 Created`:** the newly-created [shared `Broadcast` shape](#shared-broadcast-shape), with `status: "Sent"` and `sentAt`/`reach` system-set.

**Errors:** `422 VALIDATION_ERROR` for a missing title/message, or a message over the channel's character limit (SMS/Push).

**Open question for the backend team:** the composer's only button is "Send broadcast" — it always creates a `Sent` broadcast immediately. `BroadcastStatus` has `Draft` and `Scheduled` values, and both actually appear in seed data and via [9.12](#912-duplicate-a-broadcast)'s duplicate action (which always creates a `Draft`), but **nothing in the current UI lets an admin create a broadcast as a draft or schedule one for later send** — worth confirming with product whether the real create endpoint should accept an optional "save as draft" / "schedule for `scheduledFor`" mode, since the frontend doesn't exercise that path today despite the type modeling it.

### 9.10 Update a broadcast

A `Sent` broadcast is permanent notice history — same reasoning as Finance's Settlement Runs ("a completed run cannot be edited or rerun"). Only `Draft`/`Scheduled` broadcasts, which nobody has seen yet, can still be changed.

**Endpoint:** `PATCH /support/broadcasts/:id`

**Auth:** Any authenticated admin.

**Request body:** identical shape to [9.9](#99-create-a-broadcast)'s request body.

**Response — `200 OK`:** the updated [shared `Broadcast` shape](#shared-broadcast-shape).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. **`409 CONFLICT` if `status` is `"Sent"`** — enforced server-side (not just a hidden Edit button in the UI), matching the mock's own defense-in-depth: it throws even if somehow called on a Sent row.

### 9.11 Delete a broadcast

Same `Sent`-is-immutable rule as update.

**Endpoint:** `DELETE /support/broadcasts/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if `status` is `"Sent"`.

### 9.12 Duplicate a broadcast

Creates a fresh `Draft` copy of an existing broadcast — available on **any** status, including `Sent`, since duplicating doesn't touch the original (the "can't edit/delete a Sent broadcast" rule protects the original record, not the idea of reusing its content).

**Endpoint:** `POST /support/broadcasts/:id/duplicate`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response — `201 Created`:** a new [shared `Broadcast` shape](#shared-broadcast-shape) — `title` prefixed `"Copy of "`, same `channel`/`message`/`audience` as the source, `status: "Draft"`, `reach: 0`, `sentAt: "Not sent yet"`.

**Errors:** `404 NOT_FOUND` if the source `id` doesn't exist.

---

## 10. Administration

`/administration` has 3 pages reached via an in-page tab switch (`AdministrationTabs`), not separate sidebar entries: **Admin Users**, **Roles & Permissions**, **Activity Logs**.

### Shared shapes

```jsonc
// AdminUser
{
  "id": "ADM-1001",
  "name": "Ama Serwaa",
  "email": "a.serwaa@nframa.com",
  "role": "Support Admin",          // string, NOT a fixed enum — see the note below
  "status": "Invited",                 // "Active" | "Suspended" | "Invited"
  "lastLogin": "Never",                  // string — recommend ISO 8601, or null before first login
  "createdOn": "Just now"                  // string — recommend ISO 8601; system-stamped, not admin-set
}

// RoleDefinition
{
  "id": "support-admin",
  "name": "Support Admin",
  "description": "Manages support tickets and broadcast communications.",
  "permittedModules": ["overview", "support"],
  // navConfig module ids this role's admins see in the sidebar — see the sidebar-visibility
  // note below. "permissionsCount" (below) must always equal this array's length.
  "permissionsCount": 2
}

// ActivityLogEntry
{
  "id": "ACL-3301",
  "time": "9:41 AM",                // string — recommend ISO 8601
  "actor": "Ama Mensah",              // the admin who performed the action
  "action": "Approved payout",          // human-readable description
  "target": "Kwame Oppong",               // who/what the action was performed on
  "ipAddress": "41.66.203.118",             // the actor's IP at the time of the action
  "result": "Success",                        // "Success" | "Failed"
  "module": "Finance"                           // which feature area the action took place in
}
```

**Note on `AdminUser.role` / `RoleDefinition.name`:** `role` is a plain string, not a fixed enum — roles are admin-creatable through [10.7](#107-create-a-role), so the valid set is whatever currently exists in `RoleDefinition[]`, not a hardcoded list. **Recommend the backend validate `role` on every admin-user create/update against an existing `RoleDefinition.name`** (a foreign-key-style constraint) rather than accepting any string — the frontend already only ever offers a `<select>` sourced from the live roles list, but a raw API caller could otherwise assign a nonexistent role name, which would leave that admin's sidebar visibility silently broken (see the note below).

**Note on how `permittedModules` is actually used:** this isn't a cosmetic display list — `Sidebar.tsx` filters the navigation down to only the modules in the signed-in admin's role's `permittedModules`, matched by `role` name against `RoleDefinition.name`. If there's no match (a role with no corresponding definition, or the lookup still loading), the frontend **fails open and shows every module** rather than locking the admin out — this is explicitly a UI-only visibility filter in the current app, not real access control, since there's no backend to enforce a route guard against. **Worth flagging clearly to the backend team:** a real implementation should not treat `permittedModules` as UI-only — it should be enforced server-side on every relevant endpoint (a Support Admin's token shouldn't be able to call Finance endpoints just because the sidebar hides the link), otherwise the permission model is cosmetic rather than real.

### 10.1 List admin users

**Endpoint:** `GET /administration/admin-users`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches name, email, or admin id. |
| `role` | string | Optional, dynamic (from real roles). |
| `status` | `Active` \| `Suspended` \| `Invited` | Optional. |

No pagination in the current mock (the admin roster is expected to be small) — same judgment call as Route Management; worth confirming actual expected admin-account volume with the backend team before deciding whether to paginate.

**Response — `200 OK`**

```jsonc
{ "items": [ /* AdminUser[], see shared shape above */ ] }
```

### 10.2 Create an admin user (invite)

**Endpoint:** `POST /administration/admin-users`

**Auth:** Any authenticated admin. **Recommend restricting this to a subset of roles** (e.g. only Super Admin) once real permission enforcement exists — inviting new administrators is a sensitive action that probably shouldn't be available to every admin role.

**Request body**

```jsonc
{
  "name": "Ama Serwaa",
  "email": "a.serwaa@nframa.com",
  "role": "Support Admin",       // must match an existing RoleDefinition.name — see note above
  "password": "at-least-8-characters"
  // write-only: accepted here to be hashed and stored server-side, but AdminUser has no
  // `password` field, so it can never come back out on a GET. `confirmPassword` is a
  // client-side-only check (the two fields must match before submit); no need for the
  // backend to receive it.
}
```

**Response — `201 Created`:** the newly-created [shared `AdminUser` shape](#shared-shapes), with `status: "Invited"`, `lastLogin: "Never"`, `createdOn` system-stamped.

**Errors:** `422 VALIDATION_ERROR` for a missing/invalid field, a password under 8 characters, or an email already in use. `422` (or `404`) if `role` doesn't match an existing role.

**Open question for the backend team:** the frontend's button says "Send invite" — worth confirming whether this should actually send a real invitation email/link for the new admin to set their own password, rather than the admin who creates the account setting one on their behalf. The mock has no real email delivery to reflect either way.

### 10.3 Update an admin user

**Endpoint:** `PATCH /administration/admin-users/:id`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{
  "name": "Ama Serwaa",
  "email": "a.serwaa@nframa.com",
  "role": "Support Admin",
  "password": "optional-new-password"   // optional — omit/leave blank to keep the current
                                          // password. Same write-only/never-persisted-in-plain-
                                          // text reasoning as create; if provided, held to the
                                          // same length rule.
}
```

Unlike the general Users feature (where `role` is excluded from the edit form, owned by onboarding instead), `role` **is** editable here — reassigning an administrator's role is itself a normal admin action, not something owned by a separate workflow.

**Response — `200 OK`:** the updated [shared `AdminUser` shape](#shared-shapes).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for an invalid field.

### 10.4 Set admin user status

**Endpoint:** `POST /administration/admin-users/:id/status`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{ "status": "Suspended" }   // "Active" | "Suspended"
```

**Business rule:** a `"Super Admin"` can't be suspended from this action — the frontend simply doesn't render the Suspend button for that role. **Recommend the backend enforce this too**, not just hide the button, so a raw API call can't suspend the platform's only (or last remaining) Super Admin and potentially lock everyone out.

**Response — `200 OK`:** the updated [shared `AdminUser` shape](#shared-shapes).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `409 CONFLICT` if attempting to suspend a `"Super Admin"`.

### 10.5 Delete an admin user

**Endpoint:** `DELETE /administration/admin-users/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. **Recommend also blocking deletion of the last remaining `"Super Admin"`** (same reasoning as the suspend guard above) — the mock doesn't model this today since it's a single-admin-account demo, but a real platform should never end up with zero admins able to manage other admins.

### 10.6 List roles

**Endpoint:** `GET /administration/roles`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{ "items": [ /* RoleDefinition[], see shared shape above */ ] }
```

The per-role "N admins" count and the page's "Admins Assigned" stat tile are both currently computed client-side by cross-referencing this list against [10.1](#101-list-admin-users)'s full admin list — fine at this data volume (a handful of roles), same judgment call as Route Management's stats.

### 10.7 Create a role

Powers the "Add role" drawer — a name/description plus a checkbox grid of every `navConfig` module, driving which sidebar sections that role's admins see.

**Endpoint:** `POST /administration/roles`

**Auth:** Any authenticated admin. Same "should this be restricted to a subset of roles" note as [10.2](#102-create-an-admin-user-invite) — defining roles is at least as sensitive as inviting admins.

**Request body**

```jsonc
{
  "name": "Support Admin",
  "description": "Manages support tickets and broadcast communications.",
  "permittedModules": ["overview", "support"]   // array of navConfig module ids
}
```

`permissionsCount` is never sent — it's always `permittedModules.length`, computed server-side alongside the list that produced it so the two can never drift apart.

**Response — `201 Created`:** the newly-created [shared `RoleDefinition` shape](#shared-shapes).

**Errors:** `422 VALIDATION_ERROR` for a missing name, or a name that collides with an existing role.

### 10.8 Update a role

**Endpoint:** `PATCH /administration/roles/:id`

**Auth:** Any authenticated admin.

**Request body:** identical shape to [10.7](#107-create-a-role)'s request body.

**Response — `200 OK`:** the updated [shared `RoleDefinition` shape](#shared-shapes).

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. `422 VALIDATION_ERROR` for invalid fields.

**Open question for the backend team:** if a role's `name` is changed (not just its permissions), every `AdminUser.role` currently pointing at the old name needs to be updated too, or it silently orphans those admins from the role they were actually assigned (same class of problem the delete guard below exists to prevent). Recommend the rename either cascades to every assigned admin, or is blocked/warned the same way delete is — the current mock doesn't handle this case at all (a `RoleDefinition.id` is derived from the name at creation time and never changes, so a rename in the mock doesn't actually break the `AdminUser.role` string match, but a real backend's `id`/`name` handling may differ).

### 10.9 Delete a role

**Endpoint:** `DELETE /administration/roles/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist. **`409 CONFLICT` if any admin user is still assigned to this role** (`role` name match) — the mock already enforces this exact rule (refusing with a message naming how many admins are still assigned, surfaced via the app-wide error-toast wiring) rather than silently orphaning those accounts' role reference. Carry this over as-is; it's a real constraint, not just mock behavior worth relaxing.

### 10.10 Assign an admin to a role

A narrower, single-field variant of [10.3](#103-update-an-admin-user)'s update — reached from a role card's "Add admin to role" button rather than the admin's own edit form, but it's the exact same underlying change (one admin's `role` field), just a second entry point to it.

**Endpoint:** `POST /administration/admin-users/:id/role`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{ "role": "Support Admin" }   // must match an existing RoleDefinition.name
```

**Response — `200 OK`:** the updated [shared `AdminUser` shape](#shared-shapes).

**Errors:** `404 NOT_FOUND` if the admin `id` doesn't exist, or if `role` doesn't match an existing role.

### 10.11 List activity logs

Platform-wide, read-only admin action trail — no reference screenshot, designed in-house. Deliberately **view-only**: no edit or delete row action exists, since an audit trail entry isn't meant to be mutable (same reasoning as Finance's Financial Audit Logs).

**Endpoint:** `GET /administration/activity-logs`

**Auth:** Any authenticated admin.

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `search` | string | Optional — matches actor, action, or target. |
| `page` / `pageSize` | number | Optional, default `1` / `10`. |
| `result` | `Success` \| `Failed` | Optional. |
| `actor` | string | Optional, dynamic. |
| `module` | string | Optional, dynamic — the `navConfig` area the action occurred in. |

**Response — `200 OK`**

```jsonc
{
  "items": [ /* ActivityLogEntry[], see shared shape above */ ],
  "page": 1, "pageSize": 10, "total": 60, "totalPages": 6
}
```

**Recommend this be populated automatically as a side effect of every consequential admin action platform-wide** (not just within Administration) — the same recommendation already made for Finance's audit log, generalized: a real audit trail's completeness depends on every module's mutations writing to it, not on each feature remembering to also log itself.

---

## 11. Settings

`/settings` is a single flat page (no sub-tabs in the URL — the 5 tabs are an in-page switch over one form) — platform-wide configuration: Fare & Pricing, Payment Gateways, SOS & Safety, Verification Rules, and Regions & Cities, plus a read-only change log. This is the last module in the app; every page in `navConfig.ts` is now covered by this document.

**One important structural note:** all 5 tabs are fields on **one** form (`PlatformSettings`), saved together by a single "Save configuration" button — fields stay registered across tab switches, so an admin can change a fare rate on one tab and a safety toggle on another, then save both in one submission. This means there's **one** update endpoint for the whole object, not one per tab.

### Shared `PlatformSettings` shape

```jsonc
{
  // Fare & Pricing
  "baseFare": 8,                   // number, GHS, min 0
  "perKmRate": 1.2,                  // number, GHS, min 0
  "perMinRate": 0.15,                  // number, GHS, min 0
  "platformCommission": 15,              // number, percent, 0–100
  "maxSurgeMultiplier": 2.5,               // number, min 1

  // Payment Gateways
  "autoPayoutThreshold": 50,        // number, GHS, min 0 — balance level that triggers an automatic payout
  "momoEnabled": true,                // boolean — Mobile Money (MTN, Telecel, AT) rider collection + car owner payouts
  "bankTransferEnabled": true,          // boolean — direct bank transfer payouts

  // SOS & Safety
  "sosTimeoutMinutes": 3,           // number, min 0 — time before an SOS alert auto-escalates
  "autoNotifyPolice": true,           // boolean — dispatch live vehicle coordinates to police on panic activation

  // Verification Rules
  "ghanaCardMandatory": true,       // boolean — require NIA Ghana Card verification before car owner activation
  "licenseExpiryNoticeDays": 30,      // number, min 0 — how many days ahead of expiry to warn
  "minDriverAge": 21                    // number, min 18
}
```

### 11.1 Get platform settings

**Endpoint:** `GET /settings/platform`

**Auth:** Any authenticated admin.

**Response — `200 OK`:** the full [shared `PlatformSettings` shape](#shared-platformsettings-shape).

### 11.2 Update platform settings

**Endpoint:** `PUT /settings/platform`

**Auth:** Any authenticated admin. **Recommend restricting this to a subset of roles** (e.g. Super Admin only, or a dedicated "Settings" permission) once real permission enforcement exists — platform-wide fare/commission/safety configuration is about as sensitive an action as exists in this console.

**Request body:** the full [shared `PlatformSettings` shape](#shared-platformsettings-shape) — the whole object is sent and replaced on every save, not a partial patch (this matches the form's own "one form, one save button, spanning all 5 tabs" structure).

**Response — `200 OK`:** the updated [shared `PlatformSettings` shape](#shared-platformsettings-shape).

**Errors:** `422 VALIDATION_ERROR` for any field outside its valid range (see the shared shape's inline min/max notes).

**Recommend a real diff-based change-log entry, not one generic string.** The current mock writes exactly one fixed summary — `"Platform configuration updated"` — on every save, regardless of what actually changed or by how much. A real audit trail for platform-wide configuration should record what specifically changed (e.g. `"Base fare changed from GHS 8.00 to GHS 8.50"`, `"SOS auto-escalation to police disabled"`) so [11.6](#116-list-settings-change-logs)'s log is actually useful for understanding platform history, not just a timestamped list of "something changed."

**Open question for the backend team, worth raising even though it's outside this frontend's current scope:** every one of these settings is a single platform-wide value — fare rates apply identically everywhere, even though Regions & Cities ([11.3](#113-list-operating-cities)) manages a multi-city list. Is fare/commission configuration meant to stay global forever, or will it eventually need to vary per city/region? Not something to build now, but worth surfacing before the backend schema locks in a single global settings row that a later "per-city fares" feature would have to awkwardly migrate away from.

### 11.3 List operating cities

**Endpoint:** `GET /settings/cities`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{ "items": [ { "id": "city-1", "name": "Accra Metro" } ] }
```

### 11.4 Add an operating city

Simple add/remove list — no inline rename, deliberately kept out of scope.

**Endpoint:** `POST /settings/cities`

**Auth:** Any authenticated admin.

**Request body**

```jsonc
{ "name": "Tamale Metro" }   // string, required
```

**Response — `201 Created`:** the newly-created `OperatingCity`, with a server-assigned `id`.

**Errors:** `422 VALIDATION_ERROR` for an empty name, or one that duplicates an existing city.

### 11.5 Remove an operating city

**Endpoint:** `DELETE /settings/cities/:id`

**Auth:** Any authenticated admin.

**Request:** no body.

**Response:** `204 No Content`

**Errors:** `404 NOT_FOUND` if `id` doesn't exist.

**Open question for the backend team:** removing a city an active route ([Route Management, §6](#6-route-management)) or car owner corridor still references — should this be blocked (same `409`-style guard as Administration's role deletion) or does it proceed regardless? The current mock doesn't cross-reference cities against routes/corridors at all, so there's no existing behavior to carry over here.

### 11.6 List settings change logs

Read-only trail of configuration changes, matching the audit-log pattern used elsewhere in the app (Finance, Administration).

**Endpoint:** `GET /settings/change-logs`

**Auth:** Any authenticated admin.

**Response — `200 OK`**

```jsonc
{
  "items": [
    {
      "id": "CFG-12",
      "summary": "Platform configuration updated",   // see the diff-based-summary recommendation above
      "author": "Akosua Buabeng",
      "time": "Just now"                                // string — recommend ISO 8601; see Conventions
    }
  ]
}
```

Should be written automatically by [11.2](#112-update-platform-settings) as a side effect of every save — same "the log is a byproduct of the action, not a separate step" reasoning as every other audit trail in this app.
