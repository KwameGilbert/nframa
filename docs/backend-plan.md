# Nframa Backend — Production-Grade NestJS Scaffold (Phase 0)

## Context

Nframa is a fixed-route ("corridor") ride platform — Bolt-like, but with predetermined origins/destinations. This repo (`C:\Users\kwame\code\nframa`, currently containing only `api-spec.md`) becomes its backend API.

`api-spec.md` is a frontend-derived contract and is **reference material only** — the backend is designed on its own terms, and the real contract handed to the frontend team later will be the Swagger/OpenAPI docs this app generates. That makes first-class OpenAPI tooling a hard requirement of the scaffold.

Decisions confirmed with the user:
- **NestJS app at repo root** (single app, not a monorepo)
- **PostgreSQL + Knex.js** (query builder — explicit SQL, knex migrations/seeds; no ORM)
- **Scaffold only** — production infrastructure, no auth or domain modules yet (those are later phases)
- **Include:** Docker (compose + prod Dockerfile), GitHub Actions CI, git hooks (husky/lint-staged/commitlint), Redis + BullMQ wiring

## Stack

Versions verified against npm (2026-09-01): `@nestjs/core` 12.0.1, `@nestjs/swagger` 12.0.1, `@nestjs/config` 12.0.0, `@nestjs/terminus` 12.0.0, `@nestjs/bullmq` 12.0.0, `@nestjs/throttler` 6.5.0, `knex` 3.3.0.

- **NestJS 12** on Express, TypeScript `strict: true`
- Node 24 LTS baseline (`engines: >=24`, Docker/CI on `node:24-alpine`; local machine runs Node 26.5 + pnpm 11.17, both compatible), **pnpm**
- PostgreSQL 17 (via `pg` driver + Knex 3), Redis 7 (ioredis) + BullMQ
- pino structured logging (`nestjs-pino`), Jest with `@swc/jest`, supertest for e2e
- ESLint 9 flat config + typescript-eslint + Prettier

## Target structure

```
nframa/
├── src/
│   ├── main.ts                     # bootstrap: pipes, filter, helmet, CORS, versioning, swagger, shutdown hooks
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.validation.ts       # zod schema → typed, fail-fast env validation
│   │   └── configuration.ts        # namespaced config (app, database, redis, swagger, throttle)
│   ├── common/
│   │   ├── filters/all-exceptions.filter.ts
│   │   └── middleware/request-id.middleware.ts
│   ├── database/
│   │   ├── database.module.ts      # @Global(), exports KNEX_CONNECTION
│   │   ├── knex.provider.ts        # pool from config; destroyed on shutdown
│   │   └── knex.health.ts          # custom terminus indicator (SELECT 1)
│   ├── queues/
│   │   └── queues.module.ts        # BullMQ root wiring from config (no jobs yet)
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts    # GET /health/live, GET /health/ready
├── database/
│   ├── migrations/                 # empty for now — machinery only
│   └── seeds/
├── test/
│   ├── app.e2e-spec.ts             # health + error-envelope e2e
│   └── jest-e2e.config.ts
├── docs/api-spec.md                # moved from repo root (reference)
├── knexfile.ts                     # CLI config, same env source as the app
├── docker-compose.yml              # postgres:17-alpine + redis:7-alpine, healthchecks, volumes
├── Dockerfile                      # multi-stage, non-root, prod deps only
├── .github/workflows/ci.yml
├── .env.example  .nvmrc  .dockerignore  .gitignore
├── eslint.config.mjs  .prettierrc  commitlint.config.mjs  .husky/
├── nest-cli.json  tsconfig.json  tsconfig.build.json  package.json
└── README.md
```

## Design details

### 1. HTTP conventions (main.ts + common/)
- **URI versioning** — `app.enableVersioning({ type: URI, defaultVersion: '1' })` → all routes under `/v1/...` (health endpoints excluded via version-neutral).
- **Global ValidationPipe** — `whitelist: true, forbidNonWhitelisted: true, transform: true` (class-validator/class-transformer).
- **Global exception filter** (`all-exceptions.filter.ts`) producing one consistent envelope on every non-2xx:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
  ```
  Maps HttpExceptions to stable machine codes (`NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHORIZED`, ...); unknown errors → 500 `INTERNAL`, logged with stack, never leaking internals. (Kept from the spec's conventions because it's a good standard, not because the spec demands it.)
- **helmet**, CORS from config, `enableShutdownHooks()`.
- **Request-ID middleware** — accepts/generates `x-request-id`, attached to logs and responses.
- **nestjs-pino** — structured JSON logs, request logging with redaction (authorization header etc.), `pino-pretty` transport in dev only.
- **@nestjs/throttler** — global in-memory rate limit (per-route/Redis storage deferred until auth exists).

### 2. Config (src/config/)
- `@nestjs/config` global module. Env validated with **zod** at boot — malformed/missing env kills startup with a readable error.
- Namespaced config factories (`app`, `database`, `redis`, `swagger`, `throttle`) consumed via `configService.get('database.url')` style; no raw `process.env` anywhere outside `config/`.
- `.env.example` documenting every variable (PORT, NODE_ENV, DATABASE_URL, REDIS_URL, CORS_ORIGINS, SWAGGER_ENABLED, ...).

### 3. Database layer (Knex — no ORM)
- Hand-rolled provider (no `nest-knexjs` dependency): `KNEX_CONNECTION` injection token created in `database.module.ts` from config (pool min/max, `pg` driver). Marked `@Global()`; pool destroyed in `onApplicationShutdown`.
- `knexfile.ts` at root drives the CLI, loading the **same** zod-validated env, so app and migrations can never disagree about the connection. TS migrations/seeds under `database/migrations` and `database/seeds`.
- Scripts: `db:migrate`, `db:rollback`, `db:migrate:make`, `db:seed`, `db:seed:make`.
- **No domain tables yet** — running `db:migrate` with zero migrations still creates knex's bookkeeping tables, which doubles as a connectivity smoke test.

### 4. Redis + BullMQ (src/queues/)
- `@nestjs/bullmq` root registration with connection from config. No queues/processors registered yet — this phase only proves the wiring so later phases (notifications, document-expiry sweeps, payout jobs) drop in without infra work.

### 5. Health (@nestjs/terminus)
- `GET /health/live` — process up.
- `GET /health/ready` — custom Knex indicator (`SELECT 1`) + Redis ping. Terminus has no Knex built-in, hence the small custom indicator in `database/knex.health.ts`.
- Version-neutral (not under `/v1`), used by Docker/CI/orchestrator healthchecks.

### 6. Swagger / OpenAPI (the future frontend contract)
- `@nestjs/swagger` with the **CLI plugin** enabled in `nest-cli.json` (auto-infers DTO metadata, less annotation noise).
- Served at `/docs` gated by `SWAGGER_ENABLED` (on in dev, off by default in prod).
- `openapi:export` script boots the app context and writes `openapi.json` — the artifact the user will hand the frontend team.

### 7. Testing
- Unit: Jest + `@swc/jest` (fast), specs colocated `*.spec.ts`.
- e2e (`test/`): boots the real Nest app with supertest — asserts `/health/live` 200, and that an unknown route returns 404 wrapped in the error envelope (locks the filter contract). Ready e2e against dockerized Postgres/Redis runs locally and in CI services.

### 8. Tooling & hooks
- ESLint 9 flat config (`typescript-eslint` recommended-type-checked) + Prettier.
- husky: `pre-commit` → lint-staged (eslint --fix + prettier on staged files); `commit-msg` → commitlint (conventional commits).
- Scripts kept cross-platform (Windows dev machine): no bash-isms in package.json scripts.

### 9. Docker
- `docker-compose.yml`: `postgres:17-alpine` + `redis:7-alpine`, named volumes, healthchecks, ports 5432/6379 — local dev deps only (app runs on host via `start:dev`).
- `Dockerfile`: multi-stage (deps → build → runtime on `node:24-alpine`), non-root user, prod deps + `dist/` + `database/` (migrations) + `knexfile` only. CMD runs the app; migrations run as an explicit release step (`db:migrate`), not on boot.

### 10. CI (.github/workflows/ci.yml)
- On push/PR to `main`: pnpm + Node 24 with caching → `lint` → `typecheck` → `test` → e2e (with `postgres` + `redis` service containers) → `build`. Single job, fail-fast, ~2–3 min.

### 11. Docs
- `README.md`: prerequisites, quickstart (compose up → env → migrate → start:dev), script reference, project-structure tour, migration workflow.
- Move `api-spec.md` → `docs/api-spec.md` (kept as reference; README notes it is non-binding).
- Copy this plan into the repo as `docs/backend-plan.md` — the standing record of the scaffold's architecture decisions, kept updated as later phases land.

## Implementation order

1. **Run `/init`** — generate the repo's `CLAUDE.md` (user-requested first step; refreshed again at the end of the scaffold once real commands/structure exist to document).
2. Copy this plan to `docs/backend-plan.md`, move `api-spec.md` → `docs/api-spec.md`.
3. Scaffold per the sections above: package.json/tooling → config → HTTP conventions → database → queues → health → swagger → tests → Docker → CI → README.
4. Run the full verification checklist below; update `CLAUDE.md` with the final commands/architecture.

## Explicitly out of scope (later phases)
Auth/JWT/RBAC, all domain modules (users, trips, verification, routes, finance, safety, support, administration, settings), any domain migrations, WebSocket/SSE, OpenTelemetry, deployment manifests.

## Phase 1 — data model

The full database schema plan (entities derived from `docs/frontend/nframa_system_documentation.md` and the admin `api-spec.md`) lives in `docs/db-schema.md` — ~38 tables across identity, catalog, verification, trips, finance, safety, support, and audit/settings, with global conventions (uuid PKs + prefixed display codes, integer-pesewa money, text+CHECK enums, soft delete where compliance demands it) and a proposed migration order.

## Verification (end-to-end)

1. `pnpm install` — clean install, hooks set up via `prepare`.
2. `docker compose up -d` → both containers healthy.
3. `cp .env.example .env` → `pnpm db:migrate` succeeds (knex bookkeeping tables created — proves DB connectivity + CLI config).
4. `pnpm start:dev` →
   - `GET /health/live` and `/health/ready` return 200 (ready proves Postgres + Redis reachable from the app),
   - `GET /docs` renders Swagger UI,
   - `GET /v1/nope` returns 404 in the `{ "error": ... }` envelope with an `x-request-id` header.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build` — all green.
6. `pnpm openapi:export` writes `openapi.json`.
7. `docker build .` completes; image runs and serves `/health/live`.
8. A test commit with a bad message is rejected by commitlint; staged lint runs on pre-commit.
