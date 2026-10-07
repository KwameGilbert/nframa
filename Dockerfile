# syntax=docker/dockerfile:1

# pnpm and every dependency, dev ones included: the TypeScript build and the migration runner (tsx) need them.
# HUSKY=0 skips installing git hooks, which have no place in an image.
FROM node:24-alpine AS deps
WORKDIR /app
ENV HUSKY=0
RUN npm install --global pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Only what the server needs at run time. No install scripts: no production dependency builds anything native.
FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV HUSKY=0
RUN npm install --global pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# One-off migrations, never on boot (the app doesn't migrate itself):
#   docker build --target migrate -t nframa-api-migrate .
#   docker run --rm --env-file .env nframa-api-migrate
FROM deps AS migrate
COPY knexfile.ts tsconfig.json ./
COPY src ./src
USER node
CMD ["pnpm", "migrate"]

# The server. Last, so a plain `docker build .` builds it.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The logger writes daily files under logs/; the server runs as the unprivileged node user.
RUN mkdir logs && chown node:node logs
# The commit this image was built from, reported by /health and tagged on Sentry events. Set late so a new
# commit doesn't invalidate the cached layers above.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "--import", "./dist/instrument.js", "dist/index.js"]
