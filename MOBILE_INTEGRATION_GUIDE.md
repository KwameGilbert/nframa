# Mobile App Integration Guide

**Last Updated:** 2026-09-28  
**API Base URL:** `https://api.nframa.local/api/v1` (development)  
**API Docs:** `https://api.nframa.local/docs` (Swagger UI)

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

### Token Management

All authenticated endpoints require the `Authorization: Bearer <accessToken>` header.

**Token Lifecycle:**
- `accessToken` expires after **15 minutes**
- `refreshToken` is long-lived (e.g., days/weeks)
- Before each API call, check token expiry; refresh if needed
- On logout, clear both tokens and all user data

### Get New Tokens

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "new.jwt.token",
    "refreshToken": "new.refresh.token",
    "expiresIn": 900
  }
}
```

**Response (401):**
```json
{
  "success": false,
  "error": "Invalid or expired refresh token"
}
```

Clear stored tokens and prompt re-login if 401.

---

## Rider Sign-Up & Sign-In

### Flow Overview

```
Sign-Up (Email/Phone)
  ↓
Send OTP Code
  ↓
Verify Code → Create Account
  ↓
Store Tokens
  ↓
Show "Complete Profile" Screen
  ↓
Update User Profile
  ↓
Ready to Use App
```

### 1. Sign-Up: Send OTP (Email)

```http
POST /auth/send-code
Content-Type: application/json

{
  "email": "rider@example.com",
  "codeType": "signup"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Code sent to rider@example.com",
  "data": {
    "codeSentTo": "rider@example.com",
    "codeExpiresIn": 600
  }
}
```

**Response (429) - Rate Limited:**
```json
{
  "success": false,
  "error": "Too many attempts. Try again in 15 minutes.",
  "RateLimit": "5",
  "RateLimit-Policy": "5 requests per 15 minutes"
}
```

### 2. Sign-Up: Verify Code & Create Account

```http
POST /auth/signup/verify
Content-Type: application/json

{
  "email": "rider@example.com",
  "code": "123456",
  "password": "SecurePassword123!",
  "role": "rider"
}
```

**Response (201) - Account Created:**
```json
{
  "success": true,
  "message": "Signed up as a rider with a verification code",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "fullName": null,
      "email": "rider@example.com",
      "role": "rider",
      "isPhoneVerified": false,
      "isEmailVerified": true,
      "isProfileComplete": false,
      "lastActiveAt": "2026-09-28T10:30:00Z"
    }
  }
}
```

**Response (400) - Invalid Code:**
```json
{
  "success": false,
  "error": "Invalid or expired verification code"
}
```

**Response (409) - Account Exists:**
```json
{
  "success": false,
  "error": "An account with this email already exists"
}
```

### 3. Sign-In: Email & Password

```http
POST /auth/login
Content-Type: application/json

{
  "email": "rider@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Signed in with email and password",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "fullName": "John Doe",
      "email": "rider@example.com",
      "role": "rider",
      "isPhoneVerified": true,
      "isEmailVerified": true,
      "isProfileComplete": true,
      "lastActiveAt": "2026-09-28T10:30:00Z"
    }
  }
}
```

**Response (401):**
```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

### 4. Update Rider Profile

```http
PATCH /users/{userId}
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "fullName": "John Doe",
  "dateOfBirth": "1990-05-15"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "User updated successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "fullName": "John Doe",
    "email": "rider@example.com",
    "phoneCountryCode": null,
    "phoneNumber": null,
    "dateOfBirth": "1990-05-15",
    "role": "rider",
    "isPhoneVerified": false,
    "isEmailVerified": true,
    "isProfileComplete": false,
    "lastActiveAt": "2026-09-28T10:30:00Z"
  }
}
```

---

## Driver Sign-Up & Sign-In

### Flow Overview

```
Sign-Up (Email/Phone)
  ↓
Send OTP Code → Verify Code
  ↓
Create Account → Create Driver Profile
  ↓
Store Tokens
  ↓
Show "Upload Documents" Screen
  ↓
Get Available Document Types
  ↓
Upload Each Required Document
  ↓
Documents Under Review
  ↓
[Admin Reviews] → Approved / Rejected
  ↓
If Approved: Driver Ready to Accept Rides
```

### 1. Driver Sign-Up (Same as Rider)

Use the same endpoints as riders, but with `"role": "driver"`.

### 2. Create Driver Profile

After sign-up, drivers must create their profile before uploading documents.

```http
POST /driver
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
  "message": "Driver profile created successfully",
  "data": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "code": "DRV-ABC123456",
    "status": "active",
    "verificationStatus": "unverified",
    "createdAt": "2026-09-28T10:30:00Z",
    "updatedAt": "2026-09-28T10:30:00Z"
  }
}
```

**Response (409) - Profile Already Exists:**
```json
{
  "success": false,
  "error": "Driver profile already exists for this user"
}
```

---

## Driver Verification Documents

### Document Flow

```
1. Get Available Document Types
   ↓
2. Upload Document (JPEG, PNG, WEBP, PDF, max 10MB)
   ↓
3. Document Status: PENDING
   ↓
4. [Admin Review Process]
   ├─ UNDER_REVIEW (admin is checking it)
   ├─ VERIFIED ✓ (accepted)
   │  └─ If has expiry → auto-refresh yearly
   ├─ REJECTED ✗ (with notes explaining why)
   │  └─ Driver can delete and re-upload
   └─ EXPIRED (document passed expiry date)
      └─ Driver must replace with new one
   ↓
5. Driver Status Updates Based on All Docs
   ├─ unverified: no docs submitted
   ├─ pending: awaiting review or all verified & awaiting admin approval
   ├─ approved: admin approved driver (only happens manually, see below)
   ├─ rejected: one or more docs rejected
   └─ expiring: approved but some docs expiring soon
```

### Get Document Types

List all document types available for drivers to submit. Each shows whether it expires and if it's required.

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
    },
    {
      "id": 2,
      "code": "DRIVERS_LICENSE",
      "name": "Driver's License",
      "description": "Current driving license",
      "hasExpiry": true,
      "isRequired": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": 3,
      "code": "VEHICLE_REGISTRATION",
      "name": "Vehicle Registration",
      "description": "Current vehicle registration certificate",
      "hasExpiry": true,
      "isRequired": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": 4,
      "code": "VEHICLE_INSURANCE",
      "name": "Vehicle Insurance",
      "description": "Active vehicle insurance policy",
      "hasExpiry": true,
      "isRequired": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": 5,
      "code": "VEHICLE_ROADWORTHINESS",
      "name": "Vehicle Roadworthiness Certificate",
      "description": "Current roadworthiness/fitness certificate",
      "hasExpiry": true,
      "isRequired": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

**Mark Required Fields in UI:**
- Show a badge/asterisk on `isRequired: true` documents
- Drivers must submit all required types before they can be approved

### Upload Document

Submit a document image/PDF for a specific document type.

```http
POST /driver/verification/{documentTypeId}
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

file: <binary file data>
```

**Supported Formats:**
- JPEG (image/jpeg)
- PNG (image/png)
- WEBP (image/webp)
- PDF (application/pdf)
- **Max Size:** 10 MB

**Response (201) - Upload Successful:**
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "documentTypeId": 2,
    "fileUrl": "https://storage.nframa.local/verification/550e8400.../file.jpg",
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

**Response (400) - File Error:**
```json
{
  "success": false,
  "error": "Invalid document type, missing/unsupported file, or file too large"
}
```

**Response (409) - Already Submitted:**
```json
{
  "success": false,
  "error": "You already submitted a Driver's License. Delete it first to submit a new one."
}
```

### Get Driver's Documents

Retrieve all documents the driver has submitted, with full status history.

```http
GET /driver/verification
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Documents retrieved successfully",
  "data": [
    {
      "id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "documentTypeId": 2,
      "fileUrl": "https://storage.nframa.local/verification/550e8400.../file.jpg",
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
          "documentId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
          "previousStatus": null,
          "newStatus": "PENDING",
          "changedBy": null,
          "notes": null,
          "changedAt": "2026-09-28T10:30:00Z",
          "createdAt": "2026-09-28T10:30:00Z"
        },
        {
          "id": "hist-2",
          "documentId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
          "previousStatus": "PENDING",
          "newStatus": "UNDER_REVIEW",
          "changedBy": "admin-id",
          "notes": "Checking document authenticity",
          "changedAt": "2026-09-28T10:35:00Z",
          "createdAt": "2026-09-28T10:35:00Z"
        },
        {
          "id": "hist-3",
          "documentId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
          "previousStatus": "UNDER_REVIEW",
          "newStatus": "VERIFIED",
          "changedBy": "admin-id",
          "notes": "Looks good",
          "changedAt": "2026-09-28T10:45:00Z",
          "createdAt": "2026-09-28T10:45:00Z"
        }
      ]
    },
    {
      "id": "b2c3d4e5-f6g7-h8i9-j0k1-l2m3n4o5p6q7",
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "documentTypeId": 1,
      "fileUrl": "https://storage.nframa.local/verification/550e8400.../national-id.jpg",
      "status": "REJECTED",
      "expiresAt": null,
      "notes": "ID photo is blurry. Please resubmit with a clear image.",
      "uploadedAt": "2026-09-28T09:00:00Z",
      "verifiedAt": null,
      "verifiedBy": null,
      "deletedAt": null,
      "createdAt": "2026-09-28T09:00:00Z",
      "updatedAt": "2026-09-28T10:20:00Z",
      "history": [
        {
          "id": "hist-4",
          "documentId": "b2c3d4e5-f6g7-h8i9-j0k1-l2m3n4o5p6q7",
          "previousStatus": null,
          "newStatus": "PENDING",
          "changedBy": null,
          "notes": null,
          "changedAt": "2026-09-28T09:00:00Z",
          "createdAt": "2026-09-28T09:00:00Z"
        },
        {
          "id": "hist-5",
          "documentId": "b2c3d4e5-f6g7-h8i9-j0k1-l2m3n4o5p6q7",
          "previousStatus": "PENDING",
          "newStatus": "REJECTED",
          "changedBy": "admin-id",
          "notes": "ID photo is blurry. Please resubmit with a clear image.",
          "changedAt": "2026-09-28T10:20:00Z",
          "createdAt": "2026-09-28T10:20:00Z"
        }
      ]
    }
  ]
}
```

**Document Status Codes:**

| Status | Meaning | Action |
|--------|---------|--------|
| **PENDING** | Just uploaded, awaiting admin review | Wait or check back later |
| **UNDER_REVIEW** | Admin is currently reviewing | Wait for final decision |
| **VERIFIED** | ✅ Accepted, approved | Done with this type (unless expires) |
| **REJECTED** | ❌ Rejected with reason in `notes` | Delete and re-upload with corrections |
| **EXPIRED** | Document passed its expiry date | Delete and upload a fresh copy |
| **DELETED** | Driver deleted (soft-delete) | Can re-upload same type |

### Delete a Document

If a document is rejected or you want to resubmit, delete it first.

```http
DELETE /verification/{documentId}
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Document deleted successfully",
  "data": null
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Document not found: {documentId}"
}
```

**Response (409) - Already Deleted:**
```json
{
  "success": false,
  "error": "Document is already deleted"
}
```

---

## Driver Approval & Verification Status

### Driver Verification Status States

| Status | Meaning | Next Action |
|--------|---------|-------------|
| **unverified** | No documents submitted yet | Start uploading documents |
| **pending** | Documents under review OR all verified but waiting for admin approval | Wait for admin decision; all required types must be submitted & verified |
| **approved** | ✅ Admin approved (only by manual action) | Ready to accept rides |
| **rejected** | ❌ One or more documents rejected | Fix rejected docs and re-submit |
| **expiring** | ✅ Approved but some docs expiring soon | Renew expiring documents soon |

### How Approval Works

**Automatic (Happens After Admin Reviews Docs):**
1. Admin reviews each document (VERIFIED, REJECTED, etc.)
2. Driver status auto-updates:
   - If ANY doc is REJECTED → `rejected`
   - If ANY doc is EXPIRED → `expiring`
   - If docs are PENDING or UNDER_REVIEW → `pending`
   - If ALL docs VERIFIED + none expired → `pending` (waits for admin approval)

**Manual Approval (Admin Action):**
1. All required document types must be submitted
2. All submitted documents must be VERIFIED
3. No documents can be EXPIRED
4. Admin manually approves via admin dashboard → Status becomes `approved`

### Get Current Driver Status

```http
GET /driver/{userId}
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Driver profile retrieved successfully",
  "data": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "code": "DRV-ABC123456",
    "status": "active",
    "verificationStatus": "approved",
    "createdAt": "2026-09-28T10:30:00Z",
    "updatedAt": "2026-09-28T14:00:00Z",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "fullName": "John Doe",
      "email": "john@example.com",
      "role": "driver",
      "isPhoneVerified": true,
      "isEmailVerified": true,
      "isProfileComplete": true,
      "lastActiveAt": "2026-09-28T14:00:00Z"
    },
    "documents": [
      {
        "id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
        "documentTypeId": 1,
        "status": "VERIFIED",
        "expiresAt": null
      },
      {
        "id": "c3d4e5f6-g7h8-i9j0-k1l2-m3n4o5p6q7r8",
        "documentTypeId": 2,
        "status": "VERIFIED",
        "expiresAt": "2027-09-28T23:59:59Z"
      }
    ],
    "vehicles": [
      {
        "id": "v1",
        "plate": "ACC-001",
        "make": "Toyota",
        "model": "Corolla",
        "year": 2020
      }
    ]
  }
}
```

---

## Admin Document Review

**Admin-only endpoints for reviewing driver documents and managing the verification queue.**

### List Pending Documents (Admin)

Retrieve all documents awaiting or currently under review by admins, with driver details.

```http
GET /admin/driver/verification/pending
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Pending documents retrieved",
  "data": [
    {
      "id": "doc-id-1",
      "userId": "driver-id",
      "documentTypeId": 2,
      "fileUrl": "https://storage.nframa.local/...",
      "status": "PENDING",
      "expiresAt": null,
      "notes": null,
      "uploadedAt": "2026-09-28T10:30:00Z",
      "verifiedAt": null,
      "verifiedBy": null,
      "deletedAt": null,
      "createdAt": "2026-09-28T10:30:00Z",
      "updatedAt": "2026-09-28T10:30:00Z",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phoneNumber": "0501234567",
      "documentTypeCode": "DRIVERS_LICENSE",
      "documentTypeName": "Driver's License"
    }
  ]
}
```

**Requires:** `verification: read` permission

### Update Document Verification Status (Admin)

Approve, reject, or request changes to a document. Updates driver status automatically.

```http
PATCH /admin/verification/document/{documentId}
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "status": "VERIFIED",
  "notes": "Looks good, clear image"
}
```

**Status Values:**
- `PENDING` — Back to pending (awaiting review)
- `UNDER_REVIEW` — Currently reviewing (for internal tracking)
- `VERIFIED` — Approved ✅
- `REJECTED` — Reject with reason in notes ❌

**Response (200):**
```json
{
  "success": true,
  "message": "Document status updated successfully",
  "data": {
    "id": "doc-id-1",
    "userId": "driver-id",
    "documentTypeId": 2,
    "status": "VERIFIED",
    "notes": "Looks good, clear image",
    "verifiedAt": "2026-09-28T14:00:00Z",
    "verifiedBy": "admin-id",
    "updatedAt": "2026-09-28T14:00:00Z"
  }
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Document not found: {documentId}"
}
```

**Requires:** `verification: update` permission

---

## Error Codes & Handling

### Common HTTP Status Codes

| Code | Reason | Retry? | Action |
|------|--------|--------|--------|
| **200** | Success | — | Use data from response |
| **201** | Resource created | — | Use data from response |
| **400** | Bad request (validation) | No | Fix the request and retry |
| **401** | Unauthorized (invalid/expired token) | Yes | Refresh token; if refresh fails, ask user to re-login |
| **403** | Forbidden (permission denied) | No | User doesn't have access to this resource |
| **404** | Not found | No | Resource doesn't exist; check ID |
| **409** | Conflict (duplicate, already exists) | No | Fix the conflict and retry |
| **429** | Rate limited | Yes | Wait before retrying; show user the rate limit policy |
| **500** | Server error | Yes | Retry with exponential backoff |

### Rate Limiting

Authentication endpoints are rate-limited to prevent brute force attacks.

**Limits:**
- Sign-up/sign-in: **5 attempts per 15 minutes**
- Send OTP: **3 attempts per hour per email/phone**

**Response (429):**
```json
{
  "success": false,
  "error": "Too many attempts. Try again in 15 minutes.",
  "RateLimit": "5",
  "RateLimit-Policy": "5 requests per 15 minutes"
}
```

**Headers in Response:**
- `RateLimit` — max requests allowed in the window
- `RateLimit-Policy` — human-readable policy (e.g., "5 requests per 15 minutes")

**Mobile Implementation:**
- Parse `RateLimit-Policy` from 429 responses
- Show user: "Too many attempts. Try again in 15 minutes."
- Disable login/sign-up forms for the duration

---

## Best Practices

### Token Management
```kotlin
// Pseudocode for mobile app
class AuthManager {
    fun isTokenExpired(): Boolean {
        return (expiresAt - now) < 60 // Refresh if < 1 min left
    }
    
    suspend fun getValidToken(): String {
        if (isTokenExpired()) {
            return refreshToken()
        }
        return accessToken
    }
}
```

### Handle Rejected Documents
```
When status = "REJECTED":
1. Show document preview
2. Display notes (reason for rejection)
3. Offer "Delete & Re-upload" button
4. Help user fix the issue:
   - "Image is blurry" → Use camera's focus
   - "Information is cut off" → Frame entire document
   - "Expired" → Get new document from authority
```

### Show Document Status
```
UI States:
- PENDING: "⏳ Awaiting Review"
- UNDER_REVIEW: "🔍 Being Reviewed"
- VERIFIED: "✅ Approved"
- REJECTED: "❌ Rejected: [show notes]"
- EXPIRED: "⚠️ Expired: Please renew"
- DELETED: "🗑️ Deleted"
```

### Long Polling for Status
```kotlin
// Check document status periodically (every 30 seconds)
// while on verification screen
launch {
    while (isActive) {
        delay(30_000) // 30 seconds
        val docs = api.getDriverDocuments()
        updateUI(docs)
    }
}
```

---

## Testing Credentials (Development Only)

```
Email: test-driver@nframa.local
Password: TestPassword123!
OTP Code (all environments): 123456
```

---

## Support

- **API Status:** `https://api.nframa.local/health`
- **Report Issues:** Use in-app feedback or email dev-support@nframa.local
- **Docs:** Swagger UI at `https://api.nframa.local/docs`
