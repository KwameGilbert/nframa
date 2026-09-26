import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry.js";
import "./health.docs.js";
import "./auth.docs.js";
import "./user.docs.js";
import "./adminUser.docs.js";
import "./role.docs.js";
import "./rolePermission.docs.js";
import "./driverProfile.docs.js";
import "./riderProfile.docs.js";
import "./vehicle.docs.js";
import "./setting.docs.js";
import "./verification.docs.js";

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Nframa API",
    version: "1.0.0",
    description: [
      "**Authentication:** log in via `/auth/login` (email + password) or `/auth/login/otp` → `/auth/login/verify` (SMS/email code). Send the returned `accessToken` as `Authorization: Bearer <token>`; it expires after 15 minutes, so exchange the `refreshToken` at `/auth/refresh` for a new pair.",
      "",
      "**Permissions:** admin access is per module (`settings`, `roles`, `users`) with `create` / `read` / `update` / `delete` actions, granted through the admin's role (see Roles). `roles` also covers admin accounts (`/admin`, and admin users under `/users`); `users` covers riders, drivers and vehicles; `settings` covers `/settings`. Endpoints that need one say so, e.g. *Needs roles: update*; without it you get `403`. Riders and drivers can always act on their own records. `superadmin` is a system role with every permission and can't be edited or deleted.",
      "",
      '**Responses:** successful responses have the body `{ "success": true, "message": "...", "data": ... }` — `data` is `null` when there is nothing to return (deletes, logout). Errors have the body `{ "success": false, "error": "..." }`.',
      "",
      "**Rate limits:** auth endpoints return `429` when a limit is hit; the `RateLimit` / `RateLimit-Policy` response headers show the limit and when it resets.",
      "",
      "**Emails** are case-insensitive — they're lowercased on the way in.",
    ].join("\n"),
  },
});
