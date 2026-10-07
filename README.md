# Nframa Backend API

The API behind Nframa, a fixed-route ride platform: riders book seats on drivers' commutes along set corridors. It
serves the rider and driver apps and the admin system.

Express 5 + TypeScript (ESM) + Knex/PostgreSQL + Zod, with Socket.IO for live events. Architecture notes and
conventions are in [CLAUDE.md](CLAUDE.md) and `.claude/rules/`.

## Prerequisites

- **Node 24** (CI and the Docker image use 24)
- **pnpm 11** (`devEngines` in `package.json` enforces it)
- **PostgreSQL 17**: local, or `docker compose up -d`

## Quick start

```bash
pnpm install
docker compose up -d        # Postgres on localhost:5432 (nframa / nframa / nframa)
cp .env.example .env        # then fill in the database and secrets
pnpm migrate                # migrations never run on boot
pnpm seed                   # bootstrap super admin + default settings
pnpm dev                    # http://localhost:3000, API docs at /docs
```

## Commands

| Command                                  | What it does                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                               | Watch mode (tsx)                                                           |
| `pnpm build` / `pnpm start`              | Compile to `dist/` / run the compiled server                               |
| `pnpm lint` / `pnpm lint:fix`            | ESLint                                                                     |
| `pnpm format` / `pnpm format:check`      | Prettier (applied migrations are excluded)                                 |
| `pnpm typecheck`                         | `tsc` for `src/` and `tests/`                                              |
| `pnpm test` / `pnpm test <text>`         | Vitest against a real database (`.env.test`); a filter runs matching files |
| `pnpm migrate` / `pnpm migrate:rollback` | Run pending migrations / undo the last batch                               |
| `pnpm migrate:make <name>` / `pnpm seed` | New migration / run seeds                                                  |

## API docs

OpenAPI is generated from the Zod schemas: Swagger UI at `/docs`, the raw spec at `/openapi.json`.

## Docker

The image runs the compiled server as an unprivileged user, with a healthcheck on `/health`. Migrations are a separate
target, run on purpose before a deploy:

```bash
# Migrate (and seed, first time only)
docker build --target migrate -t nframa-api-migrate .
docker run --rm --env-file .env nframa-api-migrate
docker run --rm --env-file .env nframa-api-migrate pnpm seed

# Run the server
docker build -t nframa-api .
docker run -d --env-file .env -p 3000:3000 nframa-api
```

The env file uses the same `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` (and `DB_SSL=true` for a
hosted database) as local development. See `.env.example` for everything else.

## CI

Every push to `main` and every pull request runs [.github/workflows/ci.yml](.github/workflows/ci.yml):

- **Lint, format and typecheck**
- **Migrations and tests**: every migration up, all the way down and up again on a fresh Postgres 17, then the seed
  and the full test suite (providers are mocked, nothing is sent)
- **Docker image boots**: builds both images, migrates and seeds with one, starts the other, waits for its
  healthcheck and signs in as the seeded admin
- **Dependency and secret scan**: `pnpm audit` on production dependencies and gitleaks over the whole history
- **Dependency review** (pull requests): refuses new dependencies with high or critical vulnerabilities

[CodeQL](.github/workflows/codeql.yml) scans the code on every push, pull request and weekly; Dependabot opens weekly
update pull requests for npm packages, Actions and the Docker base image. The pre-commit hook only runs `pnpm build`,
so run the affected tests before pushing.
