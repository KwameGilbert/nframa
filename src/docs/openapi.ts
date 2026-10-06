import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry, withErrorExamples } from "./registry.js";
import "./health.docs.js";
import "./activityLog.docs.js";
import "./adminUser.docs.js";
import "./auth.docs.js";
import "./device.docs.js";
import "./driverCommute.docs.js";
import "./driverProfile.docs.js";
import "./emergencyContact.docs.js";
import "./fare.docs.js";
import "./notification.docs.js";
import "./paymentMethod.docs.js";
import "./payout.docs.js";
import "./report.docs.js";
import "./review.docs.js";
import "./riderProfile.docs.js";
import "./role.docs.js";
import "./rolePermission.docs.js";
import "./setting.docs.js";
import "./sosIncident.docs.js";
import "./trip.docs.js";
import "./user.docs.js";
import "./vehicle.docs.js";
import "./verification.docs.js";
import "./wallet.docs.js";

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = withErrorExamples(
  generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Nframa API",
      version: "1.0.0",
      description: [
        "**Authentication:** log in via `/auth/login` (email + password) or `/auth/login/otp` → `/auth/login/verify` (SMS/email code). Send the returned `accessToken` as `Authorization: Bearer <token>`; it expires after 15 minutes, so exchange the `refreshToken` at `/auth/refresh` for a new pair.",
        "",
        "**Permissions:** admin access is per module (`activityLogs`, `admin`, `commutes`, `payouts`, `reports`, `roles`, `settings`, `sos`, `trips`, `users`, `verification`) with `create` / `read` / `update` / `delete` actions, granted through the admin's role (see Roles). `roles` covers role/permission definitions (`/roles`, `/roles/:id/permissions`) — not admin accounts, which are their own module; `admin` covers admin accounts (`/admin`, and admin users reached through `/users`); `users` covers riders, drivers, vehicles, emergency contacts and review moderation (`DELETE /reviews/:id`), including `GET /users`, `/drivers` and its code/phone lookups; `commutes` covers driver commutes/routes (`/commutes`); `settings` covers `/settings`; `trips` covers rider trips (`/trips`); `verification` covers driver verification documents (`/document-types`, `/driver/verification`, `/admin/driver/verification/pending`, `/verification/:id/history`); `payouts` covers drivers' payout settings (`/admin/payout-methods`); `reports` covers staff handling of trip misconduct and safety reports (`/admin/reports`: the queue, a report's detail and moving it through review), while a rider or driver filing, reading or withdrawing their own report needs no permission; `sos` covers the safety desk (`/admin/safety/incidents`: the SOS dispatch queue, status changes and cancelling, and receiving the live `admin:safety` socket events), while a person raising or cancelling their own SOS alert needs no permission; payment methods (`/admin/payment-methods`) fall under `users`; `activityLogs` covers the audit trail (`/admin/activity-logs`), where only `read` matters. Endpoints that need one say so, e.g. *Needs roles: update*; without it you get `403`. Riders and drivers can always act on their own records. `superadmin` is a system role with every permission and can't be edited or deleted.",
        "",
        '**Responses:** successful responses have the body `{ "success": true, "message": "...", "data": ... }` — `data` is `null` when there is nothing to return (deletes, logout). Errors have the body `{ "success": false, "error": "..." }`.',
        "",
        "**Rate limits:** auth endpoints return `429` when a limit is hit; the `RateLimit` / `RateLimit-Policy` response headers show the limit and when it resets.",
        "",
        "**Emails** are case-insensitive — they're lowercased on the way in.",
      ].join("\n"),
    },
  }),
);
