import { afterAll, vi } from "vitest";
import db from "../src/database/knex.js";
import { logOutSuperAdmin } from "./helpers/actors.js";

// No test ever sends a real SMS or email: every message lands in these mocks instead, which is also how
// tests read OTP and reset codes (see helpers/outbox.ts).
vi.mock("../src/services/sms.service.js", () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock("../src/services/email.service.js", () => ({ sendEmail: vi.fn(async () => undefined) }));

afterAll(async () => {
  await logOutSuperAdmin();
  // Each test file gets its own connection pool; close it so the worker can exit.
  await db.destroy();
});
