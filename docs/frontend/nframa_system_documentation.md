# Nframa Deep-Dive System Documentation

**Target Audience:** Backend Engineering Team, Project Management, Frontend Architects  
**Scope:** Exhaustive feature breakdown, screen flow mapping, Zod-schema derived data contracts, and complete API endpoint documentation for the Nframa Ecosystem (Riders App & Driver App).

---

## 1. Ecosystem Architecture & Core Business Logic

Nframa is a dual-sided marketplace tailored for **Scheduled Corridor Commuting**. Unlike traditional ride-hailing models which calculate dynamic origin-to-destination routes per user, Nframa allows drivers to define fixed "Corridors" (e.g., *Tema ➔ Accra CBD*). Riders then purchase seats on these pre-scheduled commutes.

### The 2-Hour Freeze Rule (Critical Business Logic)
To maintain platform reliability, the system enforces a strict editing and cancellation freeze for drivers. **If a scheduled commute is within 2 hours of its departure time, the driver cannot cancel, edit the time, or modify the route.** The UI explicitly locks these actions or issues severe warnings.

---

## 2. Nframa Riders App (Demand Side)

The Rider app is optimized for rapid booking, wallet management, and secure QR-code based boarding.

### 2.1 Rider Authentication & Profile Flow
1. **Login/Signup Screen:** Accepts a `phoneNumber`.
2. **OTP Screen:** 4-digit verification. If `isNewUser` is true, the user is pushed to Profile Completion.
3. **Complete Profile Screen:** Captures `fullName`, `email`, and an optional `emergencyContactName`.
4. **Setup Default Commute:** A critical onboarding step where the rider defines their primary corridor (e.g., *Home to Work*).

### 2.2 Rider App Tabs & Features
* **Home Dashboard (`/(tabs)/home`):**
  * Displays the **Active Transit Pass** (e.g., "14 of 20 rides left").
  * Displays the **Next Upcoming Commute** card, showing the confirmed trip and a 1-tap button to view the QR payload.
* **Routes / Discovery (`/(tabs)/routes`):**
  * A map-centric interface allowing riders to search corridors.
  * Filters available driver schedules by departure time and available seats.
* **Rides (`/(tabs)/rides`):**
  * **Upcoming:** Lists all confirmed reservations. Selecting a ride reveals the specific QR code payload (`NFR-USERID-SCHEDULEID`) used for boarding.
  * **History:** Lists completed and cancelled trips. Cancellation flows support standardized reasons (e.g., "Personal Emergency", "Vehicle Breakdown").
* **Wallet (`/(tabs)/wallet`):**
  * **Top Up:** Supports 1-Tap quick presets (+GH₵20, 50, 100).
  * **Auto-Refill:** A toggle allowing the system to auto-charge a default payment method when the balance falls below GH₵15.
  * **Payment Methods:** Users can bind multiple cards (Visa/Mastercard) or Mobile Money numbers (MTN, Telecel) and set a default.

---

## 3. Nframa Driver App (Supply Side)

The Driver app operates as an executive productivity dashboard, focusing on shift pacing, route management, and passenger boarding validation.

### 3.1 Driver Vetting & Authentication Flow
1. **Login & OTP:** Phone-based entry.
2. **Document Upload Verification (`/verification`):** 
   Drivers are required to submit extensive documentation:
   * **Personal:** Selfie, Ghana Card (Front/Back).
   * **Vehicle:** Make/Model, License Plate, 4-angle vehicle photos.
   * **Certifications:** Driver's License, Vehicle Insurance, Roadworthy certificates.
3. **Pending Review:** The driver cannot access the dashboard until the backend updates their `verificationStatus` from `pending` to `approved`.
4. **Terms Acceptance (`/acceptance`):** Post-approval legal agreement.

### 3.2 Driver App Tabs & Features
* **Home Dashboard (`/(tabs)/home`):**
  * **Shift Status Hero:** An animated "Go Online" gradient pulse card. When online, it transforms to display "Today's Net Earnings".
  * **Quick Actions:** Scan QR, Schedule Commute, Earnings, and Requests tiles.
  * **Active Trip Card:** If a commute is active, this card takes over, showing the Origin ➔ Destination timeline, passenger count, and the primary "Scan QR" CTA.
* **Commutes (`/(tabs)/commutes`):**
  * A calendar-based view of the driver's schedule. 
  * Allows creation of one-off or recurring (e.g., Mon-Fri) commutes.
  * Edits/Deletions here are bound by the 2-Hour Freeze rule.
* **Requests (`/(tabs)/requests`):**
  * An inbox for incoming rider reservations. Drivers can manually Accept/Reject, or enable auto-accept.
* **QR Scanner Component:**
  * Uses the device camera to scan a Rider's screen. If the decoded payload matches the active `scheduleId`, the rider is boarded.

---

## 4. Frontend Data Models (Zod Schema Requirements)

The frontend relies heavily on Zustand stores initialized with specific data shapes. The backend must serialize JSON exactly matching these properties.

### 4.1 Rider Entity
```json
{
  "id": "uuid",
  "fullName": "Ama Owusu",
  "phoneNumber": "+233201234567",
  "email": "ama@example.com",
  "isProfileComplete": true,
  "walletBalance": 145.50,
  "defaultCommute": {
    "startLocation": { "address": "Tema", "lat": 5.669, "lng": -0.016 },
    "endLocation": { "address": "Accra CBD", "lat": 5.556, "lng": -0.196 },
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "time": "07:00 AM",
    "isActive": true
  }
}
```

### 4.2 Driver & Verification Entity
```json
{
  "id": "uuid",
  "fullName": "Anthony Afriyie",
  "phoneNumber": "+233541234567",
  "verificationStatus": "approved", // "unverified" | "pending" | "approved" | "rejected"
  "isOnline": false,
  "verificationDocs": {
    "ghanaCardNumber": "GHA-123456789-0",
    "vehicleMakeModel": "Toyota Corolla",
    "plateNumber": "GW-1234-24",
    "availableSeats": "3 seats",
    "commuteRoute": "Tema ➔ Accra CBD"
  }
}
```

### 4.3 Trip / Schedule Entity
```json
{
  "id": "sch_999",
  "tripCode": "TRIP-7745",
  "status": "scheduled", // "scheduled" | "in_progress" | "completed"
  "origin": "Achimota Mall",
  "originSub": "Achimota, Accra",
  "destination": "East Legon",
  "destinationSub": "Boundary Road",
  "date": "2025-05-14",
  "time": "08:00 AM",
  "fareAmount": 55.0,
  "commutes": [ // Nested Rider legs
    {
      "id": "leg_1",
      "passengerName": "Ama Owusu",
      "status": "scheduled" // transitions to "in_progress" on QR scan
    }
  ]
}
```

---

## 5. Required API Endpoints

### 5.1 Authentication (Common)
* **`POST /api/v1/auth/request-otp`**
  * **Body:** `{ "phoneNumber": string, "appType": "RIDER" | "DRIVER" }`
* **`POST /api/v1/auth/verify-otp`**
  * **Body:** `{ "phoneNumber": string, "code": string }`
  * **Returns:** `{ "accessToken": string, "user": Rider | Driver, "isNewUser": boolean }`

### 5.2 Rider Profile & Wallet
* **`POST /api/v1/rider/profile`** (Complete Profile)
  * **Body:** `{ "fullName": string, "email": string }`
* **`POST /api/v1/rider/commute-setup`** (Set Default Route)
  * **Body:** `DefaultCommute` object.
* **`POST /api/v1/wallet/top-up`**
  * **Body:** `{ "amount": number, "method": "MOMO" | "CARD" }`
  * **Returns:** `{ "transactionId": string, "newBalance": number }`

### 5.3 Driver Vetting
* **`POST /api/v1/driver/verification`**
  * **Content-Type:** `multipart/form-data`
  * **Fields:** All properties from `VerificationDocsSchema` (including image files).

### 5.4 Scheduling & Execution
* **`POST /api/v1/schedules`** (Driver posts a route)
  * **Body:** `{ "origin": string, "destination": string, "isoDate": string, "departureTime": string, "availableSeats": number }`
* **`POST /api/v1/bookings`** (Rider reserves a seat)
  * **Body:** `{ "scheduleId": string }`
  * **Returns:** `{ "bookingId": string, "qrPayload": string }`
* **`POST /api/v1/trips/scan`** (Driver scans Rider QR)
  * **Body:** `{ "scheduleId": string, "qrPayload": string }`
  * **Returns:** `{ "success": true, "message": "Rider Boarded." }`
