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
  uploadAttachment: vi.fn(
    async (
      _path: string,
      folder: string,
      { mimeType, fileName, sizeBytes }: { mimeType: string; fileName: string; sizeBytes: number },
    ) => {
      const kind = mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("video/")
          ? "video"
          : mimeType.startsWith("audio/")
            ? "audio"
            : "document";
      const id = randomUUID();
      const storageKey = `nframa/${folder}/${id}`;
      return {
        id,
        kind,
        fileUrl: `https://mock-storage.test/${storageKey}`,
        thumbnailUrl: kind === "video" ? `https://mock-storage.test/${storageKey}.jpg` : null,
        storageKey,
        resourceType: kind === "document" ? "raw" : kind === "image" ? "image" : "video",
        mimeType,
        fileName,
        sizeBytes,
        durationSeconds: kind === "video" || kind === "audio" ? 12 : null,
        width: kind === "image" || kind === "video" ? 640 : null,
        height: kind === "image" || kind === "video" ? 480 : null,
      };
    },
  ),
  deleteFile: vi.fn(async () => undefined),
}));

// No test boots a real Socket.IO server (src/index.ts never runs — tests call app.ts directly), so
// emitToUser is mocked the same way, letting tests assert on what would have been broadcast.
vi.mock("../src/services/socket.service.js", () => ({
  initSocketService: vi.fn(),
  emitToUser: vi.fn(),
  emitToSafetyDesk: vi.fn(),
  emitToReportsDesk: vi.fn(),
  emitToSupportDesk: vi.fn(),
  SUPPORT_DESK_ROOM: "admin:support",
  joinSocketRooms: vi.fn(),
}));

// Spy on notificationEvents functions but use the real implementation, which calls deliverNotification.
// This allows tests to assert on what was called while still testing the actual behavior.
vi.mock("../src/services/notificationEvents.service.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/services/notificationEvents.service.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [name, typeof value === "function" ? vi.fn(value) : value]),
  );
});

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

// No test calls Expo: sending and receipts go to tests/helpers/pushMock.ts, which tests steer and inspect.
vi.mock("../src/services/expo.service.js", async () => {
  const { expoMock } = await import("./helpers/pushMock.js");
  return {
    sendExpoPush: vi.fn(expoMock.send),
    fetchExpoReceipts: vi.fn(expoMock.receipts),
  };
});

// No test calls a web push service: sending goes to tests/helpers/pushMock.ts. Whether web push is configured and the
// public key stay real, against this throwaway VAPID pair (made once with `web-push generate-vapid-keys`).
process.env.VAPID_PUBLIC_KEY =
  "BBv2rBboQDgcEFSLIhO3tGkrB_qZfKj12yc-3LcDF_WfV11qi84vrtA7nWYnbN3xvIdyf_mdgqs3Gk4iKs_n7Ek";
process.env.VAPID_PRIVATE_KEY = "4ppL-G9bR_S6rQp5aKDsWxbz_3WJ70dNFyGSeWreA4k";
process.env.VAPID_SUBJECT = "mailto:test@example.com";
vi.mock("../src/services/webPush.service.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/services/webPush.service.js")>();
  const { webPushMock } = await import("./helpers/pushMock.js");
  return { ...actual, sendWebPush: vi.fn(webPushMock.send) };
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
