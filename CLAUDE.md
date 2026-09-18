# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`devEngines.packageManager` enforces this).

```bash
pnpm dev              # dev server (tsx watch, NODE_ENV=development)
pnpm build            # tsc compile to dist/
pnpm start            # run compiled dist/index.js (NODE_ENV=production)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .
pnpm lint:fix
pnpm format           # prettier --write .
pnpm format:check

pnpm migrate          # knex migrate:latest (via tsx, since knexfile.ts is TS)
pnpm migrate:rollback
pnpm migrate:make <name>
pnpm seed
pnpm seed:make <name>
```

There is no real test suite yet (`pnpm test` is a stub that just echoes, so the pre-commit hook doesn't fail on every commit). `lint-staged` is installed but not wired into `.husky/pre-commit` yet — the hook currently just runs `pnpm test`.

**Never run `pnpm migrate` / `pnpm migrate:rollback` automatically.** Write and edit migration files as needed, but leave running them to the user — they run migrations themselves.

Postgres must be reachable at the host/port/credentials in `.env.development` for the app to boot or for migrations to run (`db/knex` connects on startup-adjacent calls, not lazily in a way that tolerates a missing DB for most routes). `docker-compose.yml` provides a Postgres 17 container (`nframa`/`nframa`/`nframa` on port 5432), but note the dev machine this was built on already had a **native** Postgres bound to 5432, so the compose file and `.env.development` may not agree with each other — check both before assuming the DB connection works.

## Architecture

Express 5 + TypeScript (strict, ESM/`NodeNext`) + Knex/Postgres + Zod, with `"type": "module"` — all relative imports need explicit `.js` extensions even though source files are `.ts`.

### Request pipeline (`src/index.ts`)

Middleware order matters and is easy to break: `captureResponseBody` → `httpLogger` → `helmet` → `cors` → `express.json()` → `router` (all app routes) → `notFoundHandler` → `errorHandler`. `notFoundHandler`/`errorHandler` **must** stay after every route registration — if a router gets mounted after them, every request 404s before reaching its handler (this has happened before in this codebase).

Socket.IO is attached to the raw `http.Server`, not to the Express `app` — `app.listen` won't work once Socket.IO is involved; it's `httpServer.listen`.

### Layering: routes → validate → controller → model → db

- **`src/routes/*.routes.ts`** — one file per resource, wires `validate({ body?, query?, params? })` + a controller function onto each path. Aggregated in `src/routes/index.ts`.
- **`src/middlewares/validate.ts`** — takes zod schemas per request part. On success, stores the parsed result on `req.validated.{body,query,params}` — **controllers must read from `req.validated`, not `req.body`/`req.query`/`req.params` directly** (for `body`/`params` this is a style choice; for `query` it's load-bearing, since Express 5 makes `req.query` a getter-only property and assigning to it throws at runtime, so validated/coerced query values have nowhere else to go).
- **`src/controllers/*.controller.ts`** — no direct DB access. Calls a model, then `sendSuccess`/`sendCreated` (`src/utils/response.ts`) or throws `AppError`/one of its static factories (`AppError.notFound()`, `.conflict()`, `.badRequest()`, `.unauthorized()`, `.forbidden()`) for anything that isn't a success. Express 5 auto-forwards rejected promises from `async` route handlers to error middleware, so no try/catch or wrapper is needed around a throwing async controller.
- **`src/models/BaseModel.ts`** — abstract generic base (`findById`, `insert`, `updateById`, `deleteById`) that concrete models extend. A subclass declares `tableName` and optionally `excludedColumns` (columns silently stripped from every returned row — e.g. `UserModel` excludes `passwordHash`/`passwordSalt`). Note: `insert`/`updateById` are typed strictly against the model's row type, so a subclass whose validated _input_ shape doesn't structurally match the row (e.g. optional/nullable mismatches) can't override those methods directly — add a differently-named method instead (see `UserModel.createUser`/`updateUser`) that casts and delegates to `this.insert`/`this.updateById`.
- **`src/schemas/*.schema.ts`** — zod schemas, reused for both request validation and (via `src/docs/*.docs.ts`) OpenAPI generation. A resource typically needs separate create/update schemas rather than deriving update via `.partial()` of create — they can legitimately allow different fields (e.g. `updateUserSchema` accepts `dateOfBirth`/`profilePicture`, which aren't collected at creation).

### Errors and logging

- **`src/config/logger.ts`** exports one root Pino `logger` plus `createLogger(type)`, a child-logger factory (`"http" | "error" | "socket" | "process" | "app"`). Everything funnels through this one instance — don't instantiate pino elsewhere.
- Console output is intentionally minimal: just `METHOD URL STATUS` per request (via `pino-http`'s `customSuccessMessage`/`customErrorMessage`) plus full error lines. Full detail (headers, timing, request/response bodies) goes only to files under `logs/app/` (everything) and `logs/error/` (errors only), rotated daily via `pino-roll` and capped at 10MB/day. `src/middlewares/httpLogger.ts`'s `captureResponseBody` middleware is what makes response bodies loggable — it patches `res.json` to stash the payload before sending; a route using `res.send`/`res.end` directly won't have its response body captured.
- `errorHandler` (`src/middlewares/errorHandler.ts`) is the single place a failed request gets logged at `error` level — don't add additional error-logging elsewhere in the request path, or errors get logged twice.

### API docs (`src/docs/`)

OpenAPI spec generated via `@asteasolutions/zod-to-openapi`, reusing the same zod schemas used for validation (no separate/duplicate schema definitions). One `*.docs.ts` file per resource registers its paths against a shared `registry` (`src/docs/registry.ts`); `src/docs/openapi.ts` imports all of them and generates the final document. Served at `GET /docs` (Swagger UI) and `GET /openapi.json` (raw spec) via `src/routes/docs.routes.ts`.

### Database

Knex, not an ORM — query builder only, models hand-write queries. `knexfile.ts` at the repo root is a thin re-export of `src/database/knexConfig.ts` (the real config), split that way because Knex's CLI expects a root-level `knexfile.ts`, but `tsconfig.json`'s `rootDir: "src"` won't let application code import anything outside `src/`. Connection is built from discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` env vars (not a `DATABASE_URL` string). Migrations live in `src/database/migrations/`; `db-schema.sql` there is a reference/documentation dump from an earlier NestJS iteration of this project, not something Knex runs — treat it as a schema reference when writing new migrations, not as ground truth (it has at least one syntax error: MySQL-style inline `ENUM(...)`, which isn't valid Postgres).

### Environment

`.env.${NODE_ENV}` is loaded explicitly (via `dotenv`'s `config({ path: ... })`), not a bare `.env` — `NODE_ENV` itself is set by the `dev`/`start` npm scripts via `cross-env` (needed for Windows compatibility). `.env.example` is intentionally the only `.env*` file not gitignored.

### Known gaps / stale pieces

- `.github/workflows/ci.yml` predates this Express rewrite — it still runs `pnpm test:e2e` (no such script exists) and spins up a Redis service that nothing in the app currently uses.
- No auth/session layer yet — the `users` table and CRUD exist, but there's no password hashing, login, or token/session handling.
- `typescript` is pinned to `^6.x`, not the newer `7.x` line, because `typescript-eslint` doesn't yet support TypeScript 7's new architecture.
