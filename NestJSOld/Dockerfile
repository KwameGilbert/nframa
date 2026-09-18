# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# ---- deps: full install (incl. dev deps), used only to build -------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: compile src/ to dist/ -----------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# ---- prod-deps: production dependencies only ------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: minimal final image -----------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nframa && adduser -S nframa -G nframa

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json knexfile.ts ./
COPY database ./database

USER nframa
EXPOSE 3000

# Migrations are an explicit release step, never run on boot:
#   docker run --rm <image> node_modules/.bin/tsx node_modules/knex/bin/cli.js migrate:latest
CMD ["node", "dist/main.js"]
