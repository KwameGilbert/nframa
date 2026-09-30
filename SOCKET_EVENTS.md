# Socket.IO Real-Time Events

**Last Updated:** 2026-09-30

Every Socket.IO connection must authenticate using the **same `accessToken`** from REST login. Pass it in the connection handshake via `auth: { token: accessToken }`, not a header or query string.

```js
import { io } from "socket.io-client";
const socket = io(baseUrl, {
  auth: { token: accessToken },
  transports: ["websocket"],
});
```

An access token expires after 15 minutes. For long-lived connections, refresh the token periodically (`POST /auth/refresh`) and reconnect with the new one, or connections will fail when the token expires and cannot be renewed.

---

## Event Payloads & Emitters

Each event is **push-only** — the server emits, the client listens. There are no inbound socket events; all driver actions are REST calls.

| Event | Emitted By | Sent To | Payload |
|---|---|---|---|
| `user:suspended` | `PATCH /users/:id/status` (admin only, suspend action) | The suspended account | `{ reason: string \| null }` |
| `driver:verification_status_changed` | Admin document review or driver approval endpoint | The driver | `{ userId, verificationStatus, previousStatus }` |
| `trip:requested` | `POST /trips` (rider request) | **Driver** who owns the commute | `{ tripId, commuteId, tripDate, status }` (status: `pending` or `accepted` for auto-accept drivers) |
| `trip:cancelled` | `POST /trips/:id/cancel` | The **other party** (driver if rider cancelled, rider if driver cancelled) | `{ tripId, commuteId, tripDate, status: "cancelled", cancelledBy, reason }` |
| `trip:accepted` | `PATCH /trips/:id/accept` (driver accepts) | **Rider only** (driver sees the change in their own REST response) | `{ tripId, commuteId, tripDate, status: "accepted" }` |
| `trip:declined` | `PATCH /trips/:id/decline` (driver declines) | **Rider only** | `{ tripId, commuteId, tripDate, status: "declined", reason }` |
| `trip:driver_arrived` | `POST /trips/:id/arrived` (driver marks arrival) | **Rider only**, once per trip | `{ tripId, commuteId, tripDate, status: "accepted", arrivedAt }` |
| `trip:boarded` | `POST /trips/board` (driver scans boarding code) | **Rider only** | `{ tripId, commuteId, tripDate, status: "boarded", boardedAt, waitMinutes, waitCharge }` |
| `trip:completed` | `POST /trips/:id/complete` (driver completes trip) | **Rider only** | `{ tripId, commuteId, tripDate, status: "completed", completedAt }` |
| `trip:no_show` | `POST /trips/:id/no-show` (driver reports no-show) | **Rider only** | `{ tripId, commuteId, tripDate, status: "no_show", reason }` |

---

## Event Details by Use Case

### Driver Verification (automatic polling replacement)

**Event:** `driver:verification_status_changed`

Fired whenever a driver's overall `verificationStatus` changes — either automatically (after a document is reviewed) or from an explicit admin approval (`PATCH /admin/driver/:userId/verification`).

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "verificationStatus": "approved",
  "previousStatus": "pending"
}
```

**Use case:** A driver app's pending-review screen currently polls `GET /driver/:userId` every 30 seconds. Replace that with a listener for this event, which fires whenever the status changes. This replaces 2,880 daily REST calls per driver with 1 socket event.

### Rider Requests → Driver Dispatch

**Event:** `trip:requested`

Sent to the driver when a rider requests a seat on one of their commutes.

```json
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "pending"
}
```

**Mobile app action:** On receipt, fetch `GET /trips/:tripId` to get the full trip detail (pickup, drop-off, fare, rider info, etc.), then display the dispatch modal.

**Status note:** `status` is `pending` when the driver must answer, or `accepted` if the driver has `autoAcceptBookings` on — but the response doesn't say whether the rider sees a boarding code yet; call `GET /trips/:tripId` to know the full trip state.

### Trip Lifecycle → Rider Updates

**Events:** `trip:accepted`, `trip:declined`, `trip:driver_arrived`, `trip:boarded`, `trip:completed`, `trip:no_show`

These events go to the **rider only** when the driver takes an action. The driver sees the change synchronously in their own `PATCH` or `POST` response, so they don't need a socket event.

```json
// trip:accepted
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "accepted"
}

// trip:boarded (with timing/wait info)
{
  "tripId": "7c1e9a52-3b4d-4f6e-8a90-1b2c3d4e5f60",
  "commuteId": "3f2b8c1e-6d4a-4e9b-9a57-1c0d8e2f7b34",
  "tripDate": "2026-10-01",
  "status": "boarded",
  "boardedAt": "2026-10-01T07:42:05.000Z",
  "waitMinutes": 12,
  "waitCharge": 3.5
}
```

**Mobile app action:** Update local trip state (e.g. `useTripStore` in the driver app, or the rider's trip list in the rider app). Refetch `GET /trips/:tripId` if you need full detail beyond the event payload.

### Trip Cancellation → Opposite Party

**Event:** `trip:cancelled`

Sent to whichever party **didn't** cancel (driver gets it when rider cancels, rider gets it when driver cancels).

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

**Mobile app action:** Remove the trip from the active list if the user is viewing it. Refetch if needed for confirmation.

---

## Connection Lifecycle

### Connecting

```js
const socket = io("https://api.example.com", {
  auth: { token: accessToken },
  transports: ["websocket"],
});

socket.on("connect", () => console.log("Connected"));
socket.on("disconnect", (reason) => console.log("Disconnected:", reason));
socket.on("connect_error", (error) => console.error("Connection error:", error));
```

### Reconnection & Token Expiry

- If a token expires (15 minutes), the connection doesn't fail immediately, but the **next refresh request** will reject it with 401.
- Best practice: **before** the token expires, exchange it at `POST /auth/refresh` and reconnect with the new token. This avoids a dropped connection.
- Alternatively, let the connection fail (Socket.IO will retry), then reconnect manually after refreshing.

### Automatic Reconnection

Socket.IO Client's default reconnection strategy:
- Tries to reconnect with exponential backoff
- Reconnects until `reconnectionAttempts` is exhausted (default: `Infinity`, so retries forever)

To customize:

```js
const socket = io(baseUrl, {
  auth: { token: accessToken },
  transports: ["websocket"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5, // stop after 5 attempts
});
```

---

## Rooms & Broadcast Behavior

Every authenticated connection automatically joins a **private room** keyed on the user's ID: `user:{userId}`. Events are addressed to this room, so:

- A driver's events go only to **that driver's** socket connections (if they're logged in on multiple devices, they see the event on all of them).
- A rider's events go only to **that rider's** connections.
- There are no shared/broadcast events.

---

## Error Handling

### Connection Rejected (401, 403, etc.)

```js
socket.on("connect_error", (error) => {
  // error.data.content.error contains the server's message
  if (error.data?.status === 401) {
    // Expired or invalid token — refresh and reconnect
    const newToken = await refreshToken();
    socket.auth = { token: newToken };
    socket.connect();
  }
});
```

### Events Not Arriving

- Verify the token is current (not older than 15 minutes without a refresh).
- Check that `socketService.isConnected()` returns `true` before expecting events.
- Verify you're listening for the right event name (case-sensitive: `trip:requested`, not `trip:request`).

---

## Testing & Development

### Mocking Events (for mobile app testing without a backend)

Many mobile frameworks mock socket events for testing. In a React Native app with `socketService.ts`:

```js
// In tests/setup.ts
jest.mock("@/services/socketService", () => ({
  socketService: {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    isConnected: () => true,
  },
}));
```

Then emit test events manually in your test:

```js
test("handles incoming trip request", () => {
  socketService.on("trip:requested", (payload) => {
    expect(payload.tripId).toBe("test-trip-id");
  });
  
  // Simulate the server event
  socketService.on.mock.calls[0][1]({
    tripId: "test-trip-id",
    commuteId: "...",
    tripDate: "...",
    status: "pending",
  });
});
```

---

## Summary: Event -> Action Mapping for Mobile Apps

| Event | Mobile Action |
|---|---|
| `user:suspended` | Log out; show reason if provided |
| `driver:verification_status_changed` | Update pending-review screen; stop polling if status is `approved` |
| `trip:requested` | Fetch full trip via `GET /trips/:tripId`; show dispatch modal |
| `trip:cancelled` | Remove from active list; show cancellation reason if user needs to see it |
| `trip:accepted` | Update trip state to "accepted"; hold is now active in rider's wallet |
| `trip:declined` | Update trip state to "declined"; nothing was charged (pending request) |
| `trip:driver_arrived` | Update trip state; notify rider that driver is here |
| `trip:boarded` | Update trip state; money is now charged (charge + wait charge if any) |
| `trip:completed` | Update trip state; hide from active list; add to completed history |
| `trip:no_show` | Update trip state; release rider's hold; show message if needed |
