import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, vi } from "vitest";
import db from "../src/database/knex.js";
import { logOutSuperAdmin } from "./helpers/actors.js";
import { cleanupTestData } from "./helpers/cleanup.js";
import { seed as bootstrapAdminSeed } from "../src/database/seeds/001_bootstrap_admin.js";
import { seed as defaultSettingsSeed } from "../src/database/seeds/002_default_settings.js";

// No test ever sends a real SMS or email: every message lands in these mocks instead, which is also how
// tests read OTP and reset codes (see helpers/outbox.ts).
vi.mock("../src/services/sms.service.js", () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock("../src/services/resend.service.js", () => ({ sendViaResend: vi.fn(async () => undefined) }));

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
  emitToSafetyDesk: vi.fn(),
  emitToReportsDesk: vi.fn(),
  joinSocketRooms: vi.fn(),
}));

// No test calls Google: getGoogleRoute returns a deterministic route (1.3x the straight line, 10 m/s) and the
// key is forced on, so every test takes the Google path whatever a developer's env file says. Tests of the
// fallback unset the key themselves.
process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
vi.mock("../src/services/google.service.js", async () => {
  const { haversineMeters } = await import("../src/services/geo.js");
  return {
    getGoogleRoute: vi.fn(
      async (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => {
        const distanceMeters = Math.round(haversineMeters(origin, destination) * 1.3);
        return { distanceMeters, durationSeconds: Math.round(distanceMeters / 10) };
      },
    ),
  };
});

// No test calls Paystack: starting and verifying a payment go to tests/helpers/paystack.ts, which tests steer.
// The webhook signature check stays real, against this test key.
process.env.PAYSTACK_SECRET_KEY = "test-paystack-secret";
vi.mock("../src/services/paystack.service.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/services/paystack.service.js")>();
  const { paystackMock } = await import("./helpers/paystack.js");
  return {
    ...actual,
    initializeTransaction: vi.fn(paystackMock.initialize),
    verifyTransaction: vi.fn(paystackMock.verify),
  };
});

beforeAll(async () => {
  // Run any pending migrations and seeds before tests start
  await db.migrate.latest();
  await bootstrapAdminSeed(db);
  await defaultSettingsSeed(db);
});

afterAll(async () => {
  await logOutSuperAdmin();
  await cleanupTestData();
  // Each test file gets its own connection pool; close it so the worker can exit.
  await db.destroy();
});
