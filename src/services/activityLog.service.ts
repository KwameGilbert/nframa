import type { Request } from "express";
import { createLogger } from "../config/logger.js";
import { activityLogModel, normalizeTargetId } from "../models/activityLog.model.js";
import type { ActivityModule } from "../schemas/activityLog.schema.js";

export interface Activity {
  module: ActivityModule;
  action: string;
  description: string;
  targetType?: string;
  targetId?: string | null;
  // The record before and after the change, in the same shape, so changedFields compares like with like.
  before?: unknown;
  after?: unknown;
  // Defaults to the signed-in user. Set it when the request carries no access token but the controller
  // knows who acted (sign-in, refresh, sign-out, password reset).
  actorId?: string | null;
  // Records a failed attempt (e.g. a wrong password) with the reason, instead of a completed action.
  error?: string;
  // Request-body keys to blank out on top of SENSITIVE_KEY (e.g. an OTP's "code").
  redact?: string[];
}

const SENSITIVE_KEY = /password|token|secret|otp|hash|storageKey/i;
const REDACTED = "[REDACTED]";
const IGNORED_FIELDS = new Set(["updatedAt"]);

const logger = createLogger("error");
const pending = new Set<Promise<unknown>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON round-trip first, so Dates become the strings clients saw and nothing non-serializable is stored.
function redact(value: unknown, extraKeys: string[] = []): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!isObject(node)) return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) || extraKeys.includes(key) ? REDACTED : strip(child),
      ]),
    );
  };
  const plain = strip(JSON.parse(JSON.stringify(value)));
  return isObject(plain) ? plain : { value: plain };
}

function changedFields(before: unknown, after: unknown, path = ""): string[] {
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
      .filter((key) => !IGNORED_FIELDS.has(key))
      .flatMap((key) => changedFields(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
}

function requestBody(req: Request, extraKeys?: string[]) {
  const file = req.file && {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  };
  const body = { ...(isObject(req.body) ? req.body : {}), ...(file && { file }) };
  return Object.keys(body).length > 0 ? redact(body, extraKeys) : null;
}

// Resolves once every entry logged so far is written. Anything reading the log straight after a request
// (tests, shutdown) waits on this first.
export async function flushActivityLogs() {
  await Promise.all([...pending]);
}

// Records what a controller just did — called at the end of every action that changes something. Not
// awaited: the write runs in the background, so the audit trail never slows a response down or fails a
// request whose change already went through (a failed write is logged as an error instead).
export function logActivity(req: Request, activity: Activity) {
  const write = Promise.resolve()
    .then(() => {
      const before = redact(activity.before);
      const after = redact(activity.after);

      return activityLogModel.record({
        actorId: activity.actorId ?? req.auth?.id ?? null,
        module: activity.module,
        action: activity.action,
        description: activity.description,
        targetType: activity.targetType ?? null,
        targetId: activity.targetId ? normalizeTargetId(activity.targetId) : null,
        result: activity.error ? "failure" : "success",
        errorMessage: activity.error ?? null,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        requestBody: requestBody(req, activity.redact),
        before,
        after,
        changedFields: before && after ? changedFields(before, after) : null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        requestId: req.id ? String(req.id) : null,
      });
    })
    .catch((err: unknown) => logger.error({ err }, "Failed to write activity log"))
    .finally(() => pending.delete(write));
  pending.add(write);
}
