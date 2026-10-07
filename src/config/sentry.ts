import * as Sentry from "@sentry/node";

// Error reporting is optional: without SENTRY_DSN nothing is initialised and captureError does nothing, so
// development, tests and CI never send anything. Only crashes and 500s are reported, not the expected 4xx errors.
let enabled = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // The commit baked into the image (see the Dockerfile), so an error points at the code that raised it.
    release: process.env.GIT_SHA || undefined,
    // Errors only; no performance tracing.
    tracesSampleRate: 0,
    // index.ts reports crashes itself and flushes before exiting; Sentry's own handlers would report them twice.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "OnUncaughtException" && i.name !== "OnUnhandledRejection"),
    // Request bodies, headers, cookies and query strings carry passwords, codes, tokens and phone numbers, and the
    // SDK collects them all by default: send the error and its stack trace only.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
  enabled = true;
}

export function captureError(err: unknown) {
  if (enabled) Sentry.captureException(err);
}

// Sends queued reports before the process exits; resolves straight away when Sentry is off.
export async function flushSentry(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs);
}
