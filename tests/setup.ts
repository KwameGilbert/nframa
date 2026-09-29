import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, vi } from "vitest";
import db from "../src/database/knex.js";
import { logOutSuperAdmin } from "./helpers/actors.js";
import { cleanupTestData } from "./helpers/cleanup.js";

// No test ever sends a real SMS or email: every message lands in these mocks instead, which is also how
// tests read OTP and reset codes (see helpers/outbox.ts).
vi.mock("../src/services/sms.service.js", () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock("../src/services/email.service.js", () => ({ sendEmail: vi.fn(async () => undefined) }));

// No test ever calls Cloudinary: uploadFile returns a plausible-looking fake URL
// (still shaped by the real inputs) instead. deleteFile is a no-op.
vi.mock("../src/services/storage.service.js", () => ({
  uploadFile: vi.fn(async (_buffer: Buffer, folder: string, originalFilename: string) => {
    const storageKey = `${folder}/${randomUUID()}-${originalFilename}`;
    return {
      fileUrl: `https://mock-storage.test/${storageKey}`,
      storageKey,
    };
  }),
  deleteFile: vi.fn(async () => undefined),
}));

// No test boots a real Socket.IO server (src/index.ts never runs — tests call app.ts directly), so
// emitToUser is mocked the same way, letting tests assert on what would have been broadcast.
vi.mock("../src/services/socket.service.js", () => ({
  initSocketService: vi.fn(),
  emitToUser: vi.fn(),
}));

beforeAll(async () => {
  // Run any pending migrations before tests start
  await db.migrate.latest();
});

afterAll(async () => {
  await logOutSuperAdmin();
  await cleanupTestData();
  // Each test file gets its own connection pool; close it so the worker can exit.
  await db.destroy();
});
