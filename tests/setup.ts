import { randomUUID } from "node:crypto";
import { afterAll, vi } from "vitest";
import db from "../src/database/knex.js";
import { logOutSuperAdmin } from "./helpers/actors.js";

// No test ever sends a real SMS or email: every message lands in these mocks instead, which is also how
// tests read OTP and reset codes (see helpers/outbox.ts).
vi.mock("../src/services/sms.service.js", () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock("../src/services/email.service.js", () => ({ sendEmail: vi.fn(async () => undefined) }));

// No test ever writes to disk or calls Cloudinary: uploadFile returns a plausible-looking fake URL
// (still shaped by the real inputs) instead, regardless of STORAGE_DRIVER.
vi.mock("../src/services/storage.service.js", () => ({
  uploadFile: vi.fn(async (_buffer: Buffer, folder: string, originalFilename: string) => {
    const storageKey = `${folder}/${randomUUID()}-${originalFilename}`;
    return {
      fileUrl: `https://mock-storage.test/${storageKey}`,
      storageKey,
      storageDriver: "local",
    };
  }),
  deleteFile: vi.fn(async () => undefined),
}));

afterAll(async () => {
  await logOutSuperAdmin();
  // Each test file gets its own connection pool; close it so the worker can exit.
  await db.destroy();
});
