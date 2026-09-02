# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The backend API for **Nframa**, a Ghana-based ride platform like Bolt except trips run on fixed, admin-defined routes ("corridors") with set origins and destinations — no free-form rider-to-driver matching. Two user types: Riders (commuters) and Car Owners (drivers). The admin dashboard frontend lives in a separate repo.

Two documents govern the work here:

- **`docs/backend-plan.md`** — the standing architecture record: stack decisions, module design, and what each scaffold piece is for. Update it when architecture changes.
- **`docs/api-spec.md`** — a contract derived from the frontend's mock data. It is **reference material only, not binding**: the backend is designed on its own terms, and the real contract handed to the frontend team is the OpenAPI document this app generates (`pnpm openapi:export`).

## Stack

NestJS 12 (Express) · TypeScript strict · PostgreSQL 17 via **Knex 3** (query builder — deliberately no ORM) · Redis 7 + BullMQ · pino logging · Jest (`@swc/jest`) + supertest · pnpm · Node ≥ 24.

## Commands

```
docker compose up -d          # local Postgres + Redis (app runs on host)
pnpm start:dev                # watch mode
pnpm build                    # compile to dist/
pnpm lint                     # eslint (flat config) — `pnpm lint:fix` to autofix
pnpm typecheck                # tsc --noEmit
pnpm test                     # unit tests (colocated *.spec.ts)
pnpm test -- knex.provider    # single unit test by name/path pattern
pnpm test:e2e                 # e2e suite in test/ (needs docker compose up)
pnpm db:migrate               # run knex migrations (also a DB-connectivity smoke test)
pnpm db:rollback              # roll back last batch
pnpm db:migrate:make <name>   # new TS migration in database/migrations/
pnpm db:seed                  # run seeds in database/seeds/
pnpm openapi:export           # write openapi.json (the frontend-facing contract)
```

Copy `.env.example` → `.env` before first run. Env is zod-validated at boot; a missing/malformed variable kills startup on purpose.

## Architecture

Modular monolith. Cross-cutting infrastructure lives in `src/config`, `src/common`, `src/database`, `src/queues`, `src/health`; domain modules (users, trips, verification, routes, finance, safety, support, administration, settings — none built yet) will each get their own module folder under `src/`.

Rules that hold across the codebase:

- **Database access is Knex, injected via the `KNEX_CONNECTION` token** from the global `DatabaseModule` (`src/database/`). Write explicit SQL/query-builder code; there are no entities or repositories to generate. `knexfile.ts` at the repo root drives the migration CLI and loads the *same* zod-validated env as the app, so the app and migrations can never disagree about the connection.
- **No `process.env` outside `src/config/`.** Everything reads namespaced config (`configService.get('database.url')` style) backed by the zod schema in `src/config/env.validation.ts`.
- **Every non-2xx response uses one envelope**, produced by the global filter in `src/common/filters/all-exceptions.filter.ts`: `{ "error": { "code", "message", "details" } }` with stable machine codes. Unknown errors become 500 `INTERNAL` and are logged with stack; internals never leak to clients.
- **Routes are URI-versioned under `/v1`** (`app.enableVersioning`). Health endpoints (`/health/live`, `/health/ready`) are version-neutral — they're for Docker/CI/orchestrators, not API consumers.
- **Swagger** is served at `/docs`, gated by `SWAGGER_ENABLED` (on in dev, off by default in prod). The `@nestjs/swagger` CLI plugin is enabled in `nest-cli.json`, so DTO metadata is inferred — don't hand-annotate what the plugin already infers.
- **BullMQ** is wired at the root (`src/queues/`) with its Redis connection from config; queues/processors are registered per-domain as they're needed.
- **Migrations run as an explicit release step** (`pnpm db:migrate`), never on app boot — the Dockerfile CMD only starts the server.

## Conventions

- Conventional commits enforced by commitlint (husky `commit-msg` hook); lint-staged runs eslint+prettier on staged files at pre-commit.
- package.json scripts must stay cross-platform (Windows dev machine) — no bash-isms.
- Money is GHS; timestamps in API responses are ISO 8601 — formatting is the frontend's job.
