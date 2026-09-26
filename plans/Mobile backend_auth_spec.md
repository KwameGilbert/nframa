# Nframa Driver App - Backend API Specification (Auth & Verification)

This document outlines the API endpoints required by the mobile client for authentication, driver verification, profile management, and commute management.

---

## 1. Authentication Endpoints

### 1.1. Request OTP

Initiates the login or registration flow by sending a One-Time Password (OTP) to the driver's phone number.

- **Endpoint:** `POST /api/auth/send-otp`
- **Description:** Sends an SMS OTP to the provided phone number.
- **Request Body:**
  ```json
  {
    "phoneNumber": "+233500000000" // string, required
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "OTP sent successfully"
  }
  ```

### 1.2. Verify OTP

Verifies the OTP and returns the authentication token and driver profile.

- **Endpoint:** `POST /api/auth/verify-otp`
- **Description:** Validates the OTP. If it's a new user, they are created with an "unverified" status.
- **Request Body:**
  ```json
  {
    "phoneNumber": "+233500000000", // string, required
    "code": "123456" // string, required
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "isNewUser": true, // boolean, true if user just registered
    "token": "jwt_token_here",
    "driver": {
      // See Driver Profile Schema below
    }
  }
  ```

### 1.3. Social Login (OAuth)

Handles login via third-party providers (Google, Apple, Facebook).

- **Endpoint:** `POST /api/auth/social`
- **Description:** Authenticates the user using a token provided by the OAuth provider.
- **Request Body:**
  ```json
  {
    "provider": "google", // string, enum: "google" | "apple" | "facebook"
    "providerToken": "id_token_or_access_token" // string, required
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "isNewUser": false,
    "token": "jwt_token_here",
    "driver": {
      // See Driver Profile Schema below
    }
  }
  ```

---

## 2. Driver Verification Logic & Endpoints

### Verification Workflow Logic:

1. **Unverified State:** When a new driver registers, their status defaults to `unverified`.
2. **Submission:** The driver uploads identity documents, vehicle documents, and photos via the mobile app.
3. **Pending State:** Once submitted to the backend via the `/api/driver/verification` endpoint, the driver's `verificationStatus` is updated to `pending`. At this point, the driver cannot accept rides until approved by an admin.
4. **Admin Action (Backend):** An admin reviews the documents.
   - If **Approved**, the status becomes `approved`.
   - If **Rejected**, the status becomes `rejected` and a `rejectionReason` is provided so the driver knows what to fix.

### 2.1. Submit Verification Documents

Submits the comprehensive set of required documents and vehicle information for administrator approval.
_(Note: Commute details are explicitly excluded here and should be handled by the Commute endpoint after or during verification)._

- **Endpoint:** `POST /api/driver/verification`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body (JSON with URLs):**
  ```json
  {
    // Personal & Identity
    "dateOfBirth": "1990-01-01",
    "contactPhone": "+233500000000",
    "selfiePhoto": "https://url.to/selfie.jpg",
    "ghanaCardNumber": "GHA-123456789-0",
    "licenseDoc": "https://url.to/license-doc.pdf",

    // Vehicle Information
    "vehicleMake": "Toyota",
    "vehicleModel": "Corolla",
    "vehicleMakeModel": "Toyota Corolla",
    "vehicleYear": "2018",
    "vehicleColor": "Silver",
    "plateNumber": "ABC-1234",
    "availableSeats": "3 seats", // Default: "3 seats"

    // Vehicle Photos & Documents
    "vehiclePhoto": "https://url.to/vehicle.jpg",
    "vehiclePhotoFront": "https://url.to/vehicle-front.jpg",
    "vehiclePhotoBack": "https://url.to/vehicle-back.jpg",
    "vehiclePhotoLeftSide": "https://url.to/vehicle-left.jpg",
    "vehiclePhotoRightSide": "https://url.to/vehicle-right.jpg",
    "vehicleRegistrationDoc": "https://url.to/reg-doc.pdf",
    "insuranceDoc": "https://url.to/insurance.pdf",
    "roadworthyDoc": "https://url.to/roadworthy.pdf"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Verification submitted successfully",
    "driver": {
      // Driver profile with verificationStatus updated to "pending"
    }
  }
  ```

---

## 3. Profile & Commute Endpoints

### 3.1. Get Driver Profile

Retrieves the full profile of the authenticated driver, including verification status, performance stats, and settings.

- **Endpoint:** `GET /api/driver/profile`
- **Headers:** `Authorization: Bearer <token>`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "driver": {
      // See Driver Profile Schema below
    }
  }
  ```

### 3.2. Update Driver Profile

Updates basic information and preferences for the authenticated driver. Covers fields from both the Edit Profile and Profile Details screens.

- **Endpoint:** `PUT /api/driver/profile`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body (Partial Updates Allowed):**
  ```json
  {
    "fullName": "John Doe",
    "phoneNumber": "+233501234567",
    "email": "johndoe@example.com",
    "address": "Tema Community 25", // Residential Address
    "dateOfBirth": "1990-01-01",
    "language": "English",
    "avatarUrl": "https://example.com/avatar.jpg"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "driver": {
      // Updated Driver Profile Schema
    }
  }
  ```

### 3.3. Create / Update Default Commute

Creates or updates the default commuting route and schedule for the driver.

- **Endpoint:** `PUT /api/driver/commute`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:**
  ```json
  {
    "commuteStart": "Tema", // Default Start Location
    "commuteEnd": "Accra CBD", // Default Destination
    "commuteRoute": "Tema ➔ Accra CBD",
    "defaultTime": "06:45 AM", // Default Departure Time
    "defaultDays": "Mon - Fri", // Schedule Days
    "availableSeats": "3 seats" // Seat Capacity
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Commute preferences saved successfully",
    "commute": {
      "id": "commute_123",
      "commuteStart": "Tema",
      "commuteEnd": "Accra CBD",
      "commuteRoute": "Tema ➔ Accra CBD",
      "defaultTime": "06:45 AM",
      "defaultDays": "Mon - Fri",
      "availableSeats": "3 seats"
    }
  }
  ```

---

## 4. Data Schemas

### Driver Profile Schema

This is the unified driver object returned upon successful authentication or profile fetching.

```ts
{
  "id": "string", // Unique UUID for the driver
  "fullName": "string",
  "phoneNumber": "string", // Unique, serves as main identifier
  "email": "string", // Optional
  "address": "string", // Optional, Residential Address
  "dateOfBirth": "string", // Optional, Format: YYYY-MM-DD
  "language": "string", // Default: "English"
  "avatarUrl": "string", // Optional URL to profile photo

  // Operational Status
  "verificationStatus": "string", // Enum: "unverified" | "pending" | "approved" | "rejected"
  "isOnline": "boolean", // Default false
  "activeVehicleId": "string", // Optional

  // Performance Metrics
  "rating": 5.0, // number, Default: 5.0
  "totalTrips": 0, // number, Default: 0

  // Optional nested document object
  "verificationDocs": {
    // Contains the fields from the Verification Documents Payload
    // Plus system fields:
    "status": "string", // Enum: "unverified" | "pending" | "approved" | "rejected"
    "rejectionReason": "string" // Optional, populated by admin if rejected
  }
}
```
