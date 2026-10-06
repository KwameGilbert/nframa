---
paths:
  - "src/config/notificationTypes.ts"
  - "src/services/notification.service.ts"
  - "src/services/notificationEvents.service.ts"
  - "src/services/expo.service.ts"
  - "src/services/webPush.service.ts"
  - "src/services/pushReceipts.service.ts"
  - "src/models/pushDevice.model.ts"
  - "src/models/notification.model.ts"
  - "src/controllers/device.controller.ts"
  - "src/controllers/notification.controller.ts"
  - "src/routes/device.routes.ts"
  - "src/routes/notification.routes.ts"
  - "src/schemas/device.schema.ts"
  - "src/schemas/notification.schema.ts"
  - "src/database/migrations/20261004100000_create_push_devices_table.ts"
  - "src/database/migrations/20261004100100_create_notifications_table.ts"
  - "src/database/migrations/20261006100000_create_push_receipts_table.ts"
  - "tests/notifications.test.ts"
  - "tests/devices.test.ts"
---

# Push Notifications

## Device Registration

Devices are registered to send push notifications to users. The system supports three platforms: **ios** and **android** (via Expo) and **web** (via Web Push API). `src/models/pushDevice.model.ts` manages the `pushDevices` table; tokens and web push keys are never returned to clients or logged (marked with `excludedColumns`).

- **Cap:** Up to **10 devices per account** (`MAX_DEVICES_PER_USER`). Registering an 11th drops the one **seen longest ago** (by `updatedAt`). An upsert on the token means a phone shared between accounts moves to the newer owner.
- **Stale cleanup:** A device not seen for **45 days** (setting `push.deviceStaleDays`) stops getting pushes and is removed from the table. This is a background process (usually nightly).
- **Token refresh:** A device registered with the same token updates its `updatedAt` but doesn't create a new row. The audit trail records it only if the device is new to the account or its owner changed, never on every refresh (apps re-register on launch and token changes).
- **Web push:** A web subscription's endpoint must be the **https URL exactly as the browser gives it** (no port, no user info, no rewrite), on a known push service (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, checked via `isAllowedWebPushHost`). The `p256dh` and `auth` keys must be **87 and 22 base64url characters** respectively.
- **Sign-out:** To stop pushes to a device at sign-out, pass it to `POST /auth/logout` in the request body; it's removed before the next push delivery to that token. Otherwise, the device stays registered until the 45-day stale timeout or the user unregisters it manually.

## Inbox Model

The notification inbox is user-owned, kept for **90 days** (setting `notifications.retentionDays`), and implements **seq-based read markers**. Every row has an auto-incrementing `seq` column (the primary key, paired with `userId`), and notifications are delivered in reverse `seq` order (newest first).

- **Read tracking:** `readAt` is `NULL` for unread, and the first time it's set (via `POST /notifications/{id}/read`) it's idempotent — reading it again changes nothing and returns the same first `readAt`.
- **Unread count:** Queried as `COUNT(*) WHERE userId = $1 AND readAt IS NULL`. It reflects the whole inbox, not just the current page or filter.
- **Pruning:** Done by batch delete every day or when a user deletes their account (soft-delete), removing all their `notifications` rows. No individual rows survive the 90-day horizon.
- **Type filtering:** Some notification types don't land in the inbox (marked `inbox: false` in `config/notificationTypes.ts`): `trip.driverArrived`, `sos.deskAlert`, and `report.deskUrgent` are push-only. Filtering by one of these returns a **400**, with the message "type that is unknown or never kept in the inbox".

## Notification Types

**22 notification types** span four Android channels (trips, safety, account, wallet), each with a priority (high/normal), time-to-live in seconds, whether it lands in the inbox, and lock-screen visibility. Defined in `src/config/notificationTypes.ts` as the `NOTIFICATION_TYPES` object.

- **Channel:** Groups notifications on Android (separate notification drawer sections and sound/vibration settings per channel).
- **Priority:** "high" = time-sensitive (trip acceptance, SOS), "normal" = informational (completed trips, balance updates).
- **TTL (time-to-live):** How long a push provider (FCM, APNs, APNs via Expo) keeps trying to deliver (e.g., 30 minutes for a trip request, 24 hours for a settlement).
- **Inbox:** true = stored in `notifications` table, false = push-only (the moment is the message).
- **Lock-screen visibility:** "full" = title and body shown on lock screen, "private" = generic text (`PRIVATE_PUSH`: "You have a new update. Open the app to view it."), so sensitive details don't leak.

Common types: `trip.{requested,accepted,declined,cancelled,driverArrived,completed,noShow}`, `sos.{statusChanged,deskAlert}`, `report.{created,statusChanged,deskUrgent}`, `account.{suspended,reactivated,passwordChanged,contactChanged,adminAccess}`, `driver.verification`, `wallet.{topUp,topUpFailed}`, `review.received`, `payout.methodChanged`, `paymentMethod.reviewed`.

## Dispatcher (notification.service.ts)

The `deliverNotification` function drives the system: it takes a user ID, notification type, and a content builder, then:

1. Builds the message (title, body, and allowed-list data fields from `PUSH_DATA_KEYS`).
2. Creates an inbox row (if `inbox: true` for this type).
3. Emits the `notification:new` socket event to the user's room with the notification and updated unreadCount.
4. Delivers pushes to every device.

- **At-most-once:** Delivery starts only after the database commit (a side-effect after `sendSuccess`). Callers `void notifyX(...)` after the response, never inside a transaction, so delivery failure can't touch the response.
- **Post-commit only:** Called after `sendSuccess` with a non-awaited `void` (like `logActivity`). Tests use `flushNotifications()` to wait for pending deliveries.
- **Never rejects:** Failures are caught and logged at warn level (credentials wrong, provider down, etc.), so they don't escape to the controller. A missing or suspended account is silently skipped.
- **Content source:** Notification text can be built sync (`{ title, body, data }`) or async (a function returning the same). Builders run inside delivery, so build errors are logged instead of escaping.

## PRIVATE_PUSH (Sensitive Content)

Types marked `lockScreen: "private"` show only the generic text on the lock screen and notification center, keeping details safe. The specific text lives only in the inbox row.

- **Data filtering:** A private push's `status` field is omitted from the payload (it would give away the outcome the generic text hides).
- **Text:** Always "Nframa" (title) and "You have a new update. Open the app to view it." (body).

Examples: `sos.statusChanged` (the next status), `report.statusChanged` (underReview/resolved/dismissed).

## HTTP Logging & Redaction

Push tokens and web-push endpoints are secrets (a stolen token lets anyone send notifications to a user). HTTP logs must redact them:

- `POST /devices` and `POST /devices/unregister` request bodies carry the token or endpoint — redacted in `logs/app/`.
- Response bodies never carry them (the API's view excludes token/webKeys via `excludedColumns`).
- `src/middlewares/httpLogger.ts` uses `captureResponseBody` to stash response payloads before sending; when logging a response body to a device endpoint, redact any `token` or `endpoint` fields.
- Audit trail entries for device changes (recorded in `logActivity`) blank the token and keys before storing, so they never reach `/admin/activity-logs` or exports.

Similarly redact **VAPID keys** and **push provider credentials** from logs.

## Knex Logging Config

To avoid logging sensitive SQL when queries fail: set `compileSqlOnError: false` in Knex's config. This makes error logs show parameter placeholders instead of interpolated tokens.

## Socket Events

New notifications arrive live as a socket event (see SOCKET_KEYS.md):

- **`notification:new`:** Emitted to `user:{userId}` room. Payload: `{ notification, unreadCount }`. Fired after the inbox row is written and before pushes are sent (so the app sees it before the push lands).

## Permission Filtering for Desk Alerts

Some notifications go only to admins with the right role:

- **`sos.deskAlert`** (high priority, no inbox): Emitted to the `admin:safety` room (admins with `sos: read`).
- **`report.deskUrgent`** (high priority, no inbox): Emitted to the `admin:reports` room (admins with `reports: read`).

These are never stored in a user's inbox; they're real-time alerts for the safety and reports desks.

## Test Conventions & Mocking

- Mock the whole `src/services/notification.service.ts` in `tests/setup.ts` (like email and SMS mocking). Tests check `deliverNotification` was called with the right args and payload shape rather than exercising real Expo/web-push calls.
- Test notification types (channels, priorities, TTLs, inbox status) separately in a dedicated test file (e.g., `tests/notificationTypes.test.ts`).
- Mock device cleanup logic separately; it's a background task and belongs in a scheduled-job test, not a main test.
- Mock `socket.service.ts` the same way (tests check `emitToUser` was called with `'notification:new'` and the right payload).
- For integration tests involving real Expo or web-push credentials, use env-var stubs (`EXPO_PUSH_TOKEN_PREFIX`, etc.) and mock the providers (Vitest's `vi.mock` + MSW for HTTP stubs).
