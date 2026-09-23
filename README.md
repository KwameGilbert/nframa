# Nframa Backend API

Production-grade NestJS backend for Nframa, a fixed-route ride platform (like Bolt, but trips run on admin-defined corridors with set origins/destinations).

## Prerequisites

- **Node 24+** (check `engines` in `package.json`)
- **pnpm** (specified in `packageManager`)
- **PostgreSQL 17** + **Redis 7** (local or via `docker-compose`)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start Postgres + Redis locally
docker compose up -d

# Create and seed the database
cp .env.example .env
pnpm db:migrate

# Run the dev server
pnpm start:dev
```

Server listens on `http://localhost:3000` (configurable via `PORT` in `.env`).

## Key Commands

```bash
# Development
pnpm start:dev          # Watch mode
pnpm start:debug        # Debug mode
pnpm build              # Compile to dist/

# Quality
pnpm lint               # Run oxlint
pnpm lint:fix           # Auto-fix
pnpm typecheck          # TypeScript check
pnpm test               # Unit tests
pnpm test:watch         # Watch mode
pnpm test:cov           # Coverage report

# Database
pnpm db:migrate         # Run all pending migrations
pnpm db:rollback        # Undo the last batch
pnpm db:migrate:make    # Create a new migration
pnpm db:seed            # Run seeders

# API
pnpm openapi:export     # Write openapi.json (requires Postgres + Redis running)

# e2e
pnpm test:e2e           # Run e2e tests against real app (requires Postgres + Redis)
```

## Architecture

- **Config**: Environment validation via Zod, namespaced config factories (`src/config/`)
- **Database**: Knex query builder (explicit SQL, no ORM) + migrations under `database/`
- **Queues**: BullMQ + Redis (wired but no jobs yet)
- **HTTP**: Global error filter (consistent `{ error: { code, message, details } }` envelope), URI versioning `/v1`, health checks at `/health/live` and `/health/ready`
- **Logging**: pino + nestjs-pino (structured JSON, pretty-printed in dev)
- **Rate Limiting**: @nestjs/throttler
- **Docs**: Swagger at `/docs` (gated by `SWAGGER_ENABLED`)

See `docs/backend-plan.md` for the full architecture decision record.

## Development

- **Migrations**: Run explicitly (`pnpm db:migrate`), never on boot
- **Commits**: Conventional commits enforced by commitlint
- **Linting**: eslint replaced with oxlint (faster), prettier for formatting
- **Tests**: Vitest for unit tests (`*.spec.ts`), vitest e2e config for `*.e2e-spec.ts`

## Docker

```bash
# Build production image
docker build -t nframa-api .

# Run it (migrations are manual, never on boot)
docker run \
  -e DATABASE_URL=postgres://... \
  -e REDIS_URL=redis://... \
  -p 3000:3000 \
  nframa-api

# Or, before the first run, migrate:
docker run --rm \
  -e DATABASE_URL=postgres://... \
  nframa-api \
  tsx node_modules/knex/bin/cli.js migrate:latest
```

## References

- **API Contract**: See `docs/api-spec.md` (frontend-facing spec; real contract is OpenAPI generated at runtime)
- **Architecture**: See `docs/backend-plan.md`
- **Swagger**: Navigate to `/docs` when the app is running
