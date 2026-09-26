# Authentication API Specification (Nframa Admin System)

> **Version:** 1.0.0  
> **Base Path:** `/api/v1/auth`  
> **Headers:** `Content-Type: application/json`  
> **Auth Header:** `Authorization: Bearer <access_token>`

---

## Overview

This document specifies all authentication endpoints, request payloads, and response structures for the Nframa Mobility Admin System. It covers:

1. **Password Login**
2. **OTP Login (Email 2FA / Security Code)**
3. **Forgot Password Flow (3-Step Recovery)**
4. **Token Refresh & Lifecycle**
5. **Current User Profile (`/me`)**
6. **Change Password (Authenticated)**
7. **Logout**
8. **Standard Error Schema**

---

## 1. Password Login

Authenticates an admin user using their email address and password.

- **Endpoint:** `POST /api/v1/auth/login/password`
- **Auth Required:** No

### Request Body

```json
{
  "email": "a.buabeng@nframa.com",
  "password": "SuperSecretPassword123!",
  "rememberMe": true
}
```

### Response (200 OK)

```json
{
  "success": true,
  "message": "Authentication successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "d9f8e7c6-b5a4-3210-9876-fedcba543210",
    "tokenType": "Bearer",
    "expiresIn": 86400,
    "user": {
      "id": "ADM-99482",
      "name": "Akosua Buabeng",
      "email": "a.buabeng@nframa.com",
      "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=256&auto=format&fit=crop",
      "role": "Super Admin",
      "department": "Executive Operations",
      "lastActive": "Just now",
      "permissions": ["*"],
      "permittedModules": [
        "overview",
        "users",
        "trip-operations",
        "verification",
        "route-management",
        "finance",
        "safety",
        "support",
        "administration",
        "settings"
      ]
    }
  }
}
```

### Errors

- **401 Unauthorized:** Invalid email or password.
- **423 Locked:** Account suspended or locked due to too many failed attempts.

---

## 2. OTP Code Request & Login (2FA)

### 2.1 Request OTP Code

Generates and sends a 6-digit security verification code to the specified email address.

- **Endpoint:** `POST /api/v1/auth/otp/request`
- **Auth Required:** No

#### Request Body

```json
{
  "email": "a.buabeng@nframa.com"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "message": "OTP security code sent to your email address.",
  "data": {
    "email": "a.buabeng@nframa.com",
    "expiresInSeconds": 300
  }
}
```

---

### 2.2 Verify OTP & Login

Authenticates an admin user using the 6-digit OTP code sent to their email.

- **Endpoint:** `POST /api/v1/auth/login/otp`
- **Auth Required:** No

#### Request Body

```json
{
  "email": "a.buabeng@nframa.com",
  "otp": "123456"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "message": "OTP verification successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "e8d7c6b5-a432-1098-7654-fedcba543210",
    "tokenType": "Bearer",
    "expiresIn": 86400,
    "user": {
      "id": "ADM-99482",
      "name": "Akosua Buabeng",
      "email": "a.buabeng@nframa.com",
      "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=256&auto=format&fit=crop",
      "role": "Super Admin",
      "department": "Executive Operations",
      "lastActive": "Just now",
      "permissions": ["*"]
    }
  }
}
```

### Errors

- **400 Bad Request:** OTP code must be 6 digits.
- **401 Unauthorized:** Invalid or expired OTP code.

---

## 3. Forgot Password Recovery Flow (3 Steps)

### Step 1: Request Password Reset Code

Sends a 6-digit security code to the admin's email for password recovery.

- **Endpoint:** `POST /api/v1/auth/password/forgot`
- **Auth Required:** No

#### Request Body

```json
{
  "email": "a.buabeng@nframa.com"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "message": "Security reset code sent to your email.",
  "data": {
    "email": "a.buabeng@nframa.com",
    "expiresInSeconds": 600
  }
}
```

---

### Step 2: Verify Reset Code

Validates the 6-digit code and issues a temporary `resetToken`.

- **Endpoint:** `POST /api/v1/auth/password/verify-code`
- **Auth Required:** No

#### Request Body

```json
{
  "email": "a.buabeng@nframa.com",
  "resetCode": "123456"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "message": "Code verified. Proceed to set a new password.",
  "data": {
    "resetToken": "rst_99887766554433221100"
  }
}
```

---

### Step 3: Reset Password

Sets a new password using the `resetToken`.

- **Endpoint:** `POST /api/v1/auth/password/reset`
- **Auth Required:** No

#### Request Body

```json
{
  "resetToken": "rst_99887766554433221100",
  "newPassword": "NewSecurePassword2026!",
  "confirmPassword": "NewSecurePassword2026!"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "message": "Password updated successfully. You can now sign in with your new credentials."
}
```

---

## 4. Token Refresh

Exchanges a valid refresh token for a new access token.

- **Endpoint:** `POST /api/v1/auth/refresh-token`
- **Auth Required:** No

### Request Body

```json
{
  "refreshToken": "d9f8e7c6-b5a4-3210-9876-fedcba543210"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "new_refresh_token_string_here",
    "expiresIn": 86400
  }
}
```

---

## 5. Get Current User Profile (`/me`)

Fetches authenticated user information, role details, and assigned module permissions.

- **Endpoint:** `GET /api/v1/auth/me`
- **Auth Required:** Yes (`Bearer <access_token>`)

### Request Headers

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "ADM-99482",
    "name": "Akosua Buabeng",
    "email": "a.buabeng@nframa.com",
    "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=256&auto=format&fit=crop",
    "role": "Super Admin",
    "department": "Executive Operations",
    "status": "Active",
    "lastLogin": "2026-09-23T19:30:00Z",
    "permissions": ["*"],
    "permittedModules": [
      "overview",
      "users",
      "trip-operations",
      "verification",
      "route-management",
      "finance",
      "safety",
      "support",
      "administration",
      "settings"
    ],
    "modulePermissions": {
      "overview": { "create": true, "read": true, "update": true, "delete": true },
      "finance": { "create": true, "read": true, "update": true, "delete": true },
      "administration": { "create": true, "read": true, "update": true, "delete": true }
    }
  }
}
```

---

## 6. Change Password (Authenticated User)

Allows an authenticated admin to change their password while logged in.

- **Endpoint:** `POST /api/v1/auth/change-password`
- **Auth Required:** Yes (`Bearer <access_token>`)

### Request Body

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "BrandNewPassword2026!",
  "confirmPassword": "BrandNewPassword2026!"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "message": "Password changed successfully."
}
```

---

## 7. Logout

Revokes active tokens and invalidates the session server-side.

- **Endpoint:** `POST /api/v1/auth/logout`
- **Auth Required:** Yes (`Bearer <access_token>`)

### Request Body

```json
{
  "refreshToken": "d9f8e7c6-b5a4-3210-9876-fedcba543210"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "message": "Logged out successfully."
}
```

---

## 8. Standard Error Schema

All error responses return a standardized JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "The email or password you entered is incorrect.",
    "details": null,
    "timestamp": "2026-09-23T19:37:06Z"
  }
}
```

### Common HTTP Status Codes

| Code  | Status                | Description                                                  |
| :---- | :-------------------- | :----------------------------------------------------------- |
| `200` | OK                    | Request succeeded.                                           |
| `400` | Bad Request           | Validation failure (e.g. missing fields, short password).    |
| `401` | Unauthorized          | Missing/invalid authentication token or invalid credentials. |
| `403` | Forbidden             | Account disabled or insufficient role permissions.           |
| `404` | Not Found             | Target account/token not found.                              |
| `422` | Unprocessable Entity  | Logic error (e.g. new password matches old password).        |
| `429` | Too Many Requests     | Rate limit exceeded (e.g. OTP resend throttling).            |
| `500` | Internal Server Error | Unexpected backend error.                                    |
