# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`devEngines.packageManager` enforces it); scripts are in `package.json`. Two that aren't obvious: `pnpm migrate*` and `pnpm seed*` run knex through `tsx` because `knexfile.ts` is TypeScript, and `pnpm test <text>` runs only test files whose path contains the text (`pnpm test users` also matches `adminUsers`; `pnpm test tests/users.test.ts` is exactly one file).

All variables must be in camelCase, never snake_case.

Don't execute prompts/plans just like that, break it into parts. As much as possible, always rewrite prompt and optimized to use as minimum usage tokens as possible while doing the best work possible. Between all available models and its version From Fable, Opus, Haiku, to Sonnet and any other avaiable one to always make sure usage lasts as long as possible switch between models and version depending on the difficulty, complexity, and demand of the work for the best results while optmizing to save usage while giving the best results without compromising quality of work.

**KISS (Keep It Simple, Stupid)**: Avoid over-engineering. A simple solution that works is better than a complex one. When adding features, make sure they are necessary and don't add unnecessary layers of abstraction.

**DRY (Don't Repeat Yourself)**: Avoid code duplication. Extract common logic into reusable methods, functions, or services. If the same code exists in two places, refactor it into one place. For example, if multiple query methods need the same data joins or transformations, have them call a shared method rather than duplicating the logic.

**Docs/schema must track every structural change**: whenever a route's request or response shape changes — a field added/removed/renamed, a response nested differently, a new route added, a route's path or params changed — update the zod schema (`src/schemas/*.schema.ts`), the OpenAPI doc (`src/docs/*.docs.ts`, including its `description`/`.meta({ example })` text), and any route comment referencing the old shape, in the same change. A schema/doc that still describes the old shape is worse than no doc — it actively misleads whoever reads it next (including future you). This is not optional cleanup; treat a route change as incomplete until `src/docs/*.docs.ts` and the schemas agree with what the controller actually returns and what routes actually validate.

All commits must first be tested and stagged and requires confirmation from usr first.

Spawn one agent to plan if there already isnt a plan yet, one to execute the plan and another to review what has been done and compare to the plan that was initially done, if there is anything wrong about the execution take it back to the executor to work on or fix.

`.husky/pre-commit` runs `pnpm build` only (a type build): it does **not** run the tests, so run the affected tests yourself before committing. `lint-staged` is installed but not wired into the hook.

Run tests for the modules you are working on. Test your changes thoroughly and make sure they work as expected. No need to run all the tests even if you didnt touch that module so only run tests on modules that are affected in changes you make

Never co author claude in git commits, just make the commit directly.

**Run `pnpm migrate` / `pnpm migrate:rollback` automatically only when necessary.** Write and edit migration files as needed, but leave running them to the user — they run migrations themselves.

The app does **not** migrate on boot — a new migration's table doesn't exist until the user runs `pnpm migrate`, so routes that need it 500 until then. If a migration file's **content** changes after Knex already recorded it as applied (tracked by filename, not content), `migrate:latest` won't pick up the change — that still needs an explicit `migrate:rollback` + `migrate` from the user.

Never edit an already migrated migration script.

Postgres must be reachable at the host/port/credentials in `.env.development` for the app to boot or for migrations to run (`db/knex` connects on startup-adjacent calls, not lazily in a way that tolerates a missing DB for most routes). `docker-compose.yml` provides a Postgres 17 container (`nframa`/`nframa`/`nframa` on port 5432), but note the dev machine this was built on already had a **native** Postgres bound to 5432, so the compose file and `.env.development` may not agree with each other — check both before assuming the DB connection works.

## Architecture

Module notes (trips and fares, wallet and payments, payment methods and payouts, email, real-time, file storage, settings, tests) live in `.claude/rules/` and load only when you work on matching files. When you change one of those areas, update its rules file the same way you would this one.

Express 5 + TypeScript (strict, ESM/`NodeNext`) + Knex/Postgres + Zod, with `"type": "module"` — all relative imports need explicit `.js` extensions even though source files are `.ts`.

### Request pipeline (`src/app.ts`)

`src/app.ts` builds the Express app and exports it without listening; `src/index.ts` loads env, sets process handlers, and serves it (plus Socket.IO). Tests import `app` directly. Middleware order matters and is easy to break: `captureResponseBody` → `httpLogger` → `helmet` → `cors` → `express.json()` → `router` (all app routes) → `notFoundHandler` → `errorHandler`. `notFoundHandler`/`errorHandler` **must** stay after every route registration — if a router gets mounted after them, every request 404s before reaching its handler (this has happened before in this codebase). `express.json()` has a `verify` hook that keeps the unparsed body on `req.rawBody` (a `Buffer`): webhook signatures are computed over the exact bytes received, which re-serializing `req.body` wouldn't reproduce.

Socket.IO is attached to the raw `http.Server`, not to the Express `app` — `app.listen` won't work once Socket.IO is involved; it's `httpServer.listen`.

### Layering: routes → validate → controller → model → db

- **`src/routes/*.routes.ts`** — `validate({ body?, query?, params? })` + a controller per path; every route needs `authenticate` plus a permission check (see Auth).
- **`src/middlewares/validate.ts`** — takes zod schemas per request part. On success, stores the parsed result on `req.validated.{body,query,params}` — **controllers must read from `req.validated`, not `req.body`/`req.query`/`req.params` directly** (for `body`/`params` this is a style choice; for `query` it's load-bearing, since Express 5 makes `req.query` a getter-only property and assigning to it throws at runtime, so validated/coerced query values have nowhere else to go).
- **`src/controllers/*.controller.ts`** — no direct DB access. Calls a model, then `sendSuccess(res, message, data?)`/`sendCreated(res, message, data)` (`src/utils/response.ts`) — every response is `{ success, message, data }` (errors: `{ success: false, error }` from `errorHandler`), so always pass a human-readable message like "User created successfully", or throws `AppError`/one of its static factories (`AppError.notFound()`, `.conflict()`, `.badRequest()`, `.unauthorized()`, `.forbidden()`) for anything that isn't a success. Express 5 auto-forwards rejected promises from `async` route handlers to error middleware, so no try/catch or wrapper is needed around a throwing async controller.
- **`src/models/BaseModel.ts`** — a subclass declares `tableName` and optionally `excludedColumns` (columns silently stripped from every returned row — e.g. `UserModel` excludes `passwordHash`/`passwordSalt`). Note: `insert`/`updateById` are typed strictly against the model's row type, so a subclass whose validated _input_ shape doesn't structurally match the row (e.g. optional/nullable mismatches) can't override those methods directly — add a differently-named method instead (see `UserModel.createUser`/`updateUser`) that casts and delegates to `this.insert`/`this.updateById`.
- **`src/schemas/*.schema.ts`** — zod schemas, reused for both request validation and (via `src/docs/*.docs.ts`) OpenAPI generation. A resource typically needs separate create/update schemas rather than deriving update via `.partial()` of create — they can legitimately allow different fields (e.g. `updateUserSchema` accepts `dateOfBirth`/`profilePicture`, which aren't collected at creation).

### Errors and logging

- **`src/config/logger.ts`** exports one root Pino `logger` plus `createLogger(type)`, a child-logger factory (`"http" | "error" | "socket" | "process" | "app"`). Everything funnels through this one instance — don't instantiate pino elsewhere.
- Console output is intentionally minimal: just `METHOD URL STATUS` per request (via `pino-http`'s `customSuccessMessage`/`customErrorMessage`) plus full error lines. Full detail (headers, timing, request/response bodies) goes only to files under `logs/app/` (everything) and `logs/error/` (errors only), rotated daily via `pino-roll` and capped at 10MB/day. `src/middlewares/httpLogger.ts`'s `captureResponseBody` middleware is what makes response bodies loggable — it patches `res.json` to stash the payload before sending; a route using `res.send`/`res.end` directly won't have its response body captured. Logged bodies are trimmed: `/webhooks/*` request bodies to the event name, the `/trips/board` request's `code`, and a response's `data.boardingCode`.
- `errorHandler` (`src/middlewares/errorHandler.ts`) is the single place a failed request gets logged at `error` level — don't add additional error-logging elsewhere in the request path, or errors get logged twice.

### API docs (`src/docs/`)

OpenAPI spec generated via `@asteasolutions/zod-to-openapi`, reusing the same zod schemas used for validation (no separate/duplicate schema definitions). One `*.docs.ts` file per resource registers its paths against a shared `registry` (`src/docs/registry.ts`); `src/docs/openapi.ts` imports all of them and generates the final document. Served at `GET /docs` (Swagger UI) and `GET /openapi.json` (raw spec) via `src/routes/docs.routes.ts`. Always sort the docs groups in alphabetical order with the exception of health which can stay as is

Examples/descriptions live on the zod schemas themselves via zod's native `.meta({ description, example })` (zod-to-openapi reads it; no import-order dependency on `extendZodWithOpenApi`). Document every 2xx response with `successResponse(message, dataSchema?)` and every non-2xx with `errorResponse(description)` from `registry.ts`, so each carries the shared envelope. Every error response must also carry an example that fits its status and endpoint: `withErrorExamples` (`src/docs/registry.ts`, applied in `openapi.ts`) derives one when none is given — the 400 from the operation's first required body field, query or path param, the 409 table and 403 permission module from the path (`RESOURCES`), the rest from `DEFAULT_ERROR_EXAMPLES` — and you pass the exact message as `errorResponse(description, example)` whenever the API returns a specific one (e.g. `Commute not found: <uuid>`). Response schemas are docs-only — responses aren't validated at runtime, so keep them in sync with the table columns by hand.

### Auth

- Login is `/auth/login` (email + password, bcrypt via `bcryptjs`) or `/auth/login/otp` → `/auth/login/verify` (SMS/email code; phone signup creates the account on verify). A code requested by phone is also emailed to the account's address when it has one (`sendOtp`'s `alsoEmail`, from `requestLoginOtp`): the same code, stored against the phone, so either copy signs in. It is skipped for a deleted account that is signing up again (the old row's email may not belong to the new owner of the number), and the request only fails when every copy failed. Every login path and `/auth/refresh` goes through `assertAccountActive` in `auth.controller.ts` (not soft-deleted, `users.status` active, and for admins `adminUsers.status` active). The one exception is phone sign-up: a soft-deleted rider/driver who signs up again with the same number (role required) gets the same row back on verify (`userModel.reactivate`: `deletedAt` cleared, the new role, a clean profile, every old session revoked in the same transaction, `isNewUser: true`); `status` is never touched, so a suspension survives. Since the number may have been recycled to someone else, the same transaction resets the driver side (`carOwnerProfiles` unverified with no Ghana card/address/terms, verification documents soft-deleted, commutes inactive, vehicles retired); wallet, ledger and trips stay with the account. Deleted admins, email identifiers and password login stay refused. An OTP code is single-use even under concurrency (`consumeOtp` errors when `consumeAllPending` updates no rows): a double-tapped verify gets 200 + 400 "No pending verification code for this identifier" (the 400 counts toward the verify limit), and two simultaneous sign-ups of one new number get 200 + 400 rather than a 409.
- Every route except `/auth/*`, `/health`, `/` and the docs requires `authenticate`. Admin access is RBAC: each admin has one role (`adminUsers.roleId`), each role has per-module `create/read/update/delete` grants in `rolePermissions` (one row per role+module; the module list is `MODULES` in `src/config/permissions.ts`). Checks live in `src/middlewares/authorize.ts`: `requirePermission(module, action)` for admin-only routes, `requireSelfOrPermission(getOwnerId, module, action)` when the owner's id is in the request (after `validate()`), and `assertSelfOrPermission` / `assertPermission` from the controller when the owner or module is only known after loading the record (vehicles; users, where admin accounts need `roles` instead of `users`). New routes need one of these — `authenticate` alone lets any signed-in user through.
- Permissions are read from the DB per request (memoized on `req.permissions`), only for admins whose user row and admin record are active — so role edits and suspensions apply immediately, not when the 15-minute token expires. `superadmin` is a system role (`roles.isSystem`): it can't be edited or deleted through the API, and the seed re-grants it every module (re-run `pnpm seed` after adding one). Admins can't change their own role/status.
- Changing a user's email/phone needs the `users: update` permission even on your own account (`updateUser` enforces it): they're login identifiers, and an unverified change would turn a stolen access token into a permanent takeover via password reset.
- Emails are lowercased by `emailSchema` (`src/schemas/common.schema.ts`) — use it for any email field, or lookups will miss.
- Rate limits are in `src/middlewares/rateLimit.ts`. Per-account limiters read `req.validated`, so they must sit after `validate()` (or after `authenticate` for the per-user one). Counters are in-memory — they reset on restart and aren't shared across instances. Behind a proxy, `TRUST_PROXY` must be set or every client shares the proxy's IP bucket.

### Database

Knex, not an ORM — query builder only, models hand-write queries. `knexfile.ts` at the repo root is a thin re-export of `src/database/knexConfig.ts` (the real config), split that way because Knex's CLI expects a root-level `knexfile.ts`, but `tsconfig.json`'s `rootDir: "src"` won't let application code import anything outside `src/`. Connection is built from discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` env vars (not a `DATABASE_URL` string). Migrations live in `src/database/migrations/`; `db-schema.sql` there is a reference/documentation dump from an earlier NestJS iteration of this project, not something Knex runs — treat it as a schema reference when writing new migrations, not as ground truth (it has at least one syntax error: MySQL-style inline `ENUM(...)`, which isn't valid Postgres).

`src/database/knex.ts` overrides pg's `DATE` parser to return the raw `YYYY-MM-DD` string instead of a JS `Date` (which would serialize with a time and can shift the day across timezones).

Write `jsonb` columns with `JSON.stringify(value)` (see `settingModel`): pg sends a JS string as raw text and a JS array as a Postgres array literal, neither of which is valid JSON. Reads come back already parsed.

### Activity logs

Every controller action that changes something (and every auth action) ends with `logActivity(req, { module, action, description, targetType, targetId, before?, after? })` from `src/services/activityLog.service.ts`, after its response is sent — a new create/update/delete handler without it is missing from the audit trail. `before` and `after` must be the record in the same shape (normally what the endpoint returns — load `before` with the same model method), or `changedFields` compares mismatched shapes. Only actions that went through are recorded: requests refused by `authenticate`/`requirePermission`/`validate` or a controller check never reach the call. The exception is failed sign-ins and password resets, which `auth.controller.ts` records as `error` entries (via `recordRefusal`) against the account they targeted. The actor defaults to `req.auth`; auth actions pass `actorId` once the account is proven. Writes are fire-and-forget, so call `flushActivityLogs()` before reading entries (tests do). Passwords, tokens, hashes and OTP codes are redacted from what's stored. Read via `GET /admin/activity-logs` (`activityLogs: read`); there is deliberately no way to edit or delete entries through the API. Test requests carry an `X-Request-Id` prefixed per test file, which is how cleanup finds and deletes that file's entries.

### Environment

`.env.${NODE_ENV}` is loaded explicitly (via `dotenv`'s `config({ path: ... })`), not a bare `.env` — `NODE_ENV` itself is set by the `dev`/`start` npm scripts via `cross-env` (needed for Windows compatibility). `.env.example` is intentionally the only `.env*` file not gitignored.

### Known gaps / stale pieces

- `typescript` is pinned to `^6.x`, not the newer `7.x` line, because `typescript-eslint` doesn't yet support TypeScript 7's new architecture.
