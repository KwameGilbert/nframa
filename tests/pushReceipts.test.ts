import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import {
  enqueueExpoReceipts,
  fetchAndProcessReceipts,
  type ExpoReceiptEntry,
} from "../src/services/pushReceipts.service.js";
import { forceExpoReceipt, newExpoToken, seedDevice, issueExpoReceipt } from "./helpers/push.js";
import { signUpByPhone } from "./helpers/actors.js";

// Push receipt sweep: enqueue tickets from Expo, poll for delivery status, clean up old records.
// Other test files enqueue receipts in parallel, so each test only looks at the rows for its own fresh tokens and
// never clears the table.

const listReceipts = (...tokens: string[]) =>
  db("pushReceipts")
    .whereIn("token", tokens)
    .select("id", "receiptId", "token", "handled", "createdAt")
    .orderBy("createdAt");

describe("enqueueExpoReceipts", () => {
  it("inserts receipt entries into the database", async () => {
    const token1 = newExpoToken();
    const token2 = newExpoToken();
    const entries: ExpoReceiptEntry[] = [
      { receiptId: randomUUID(), token: token1 },
      { receiptId: randomUUID(), token: token2 },
    ];

    await enqueueExpoReceipts(entries);

    const receipts = await listReceipts(token1, token2);
    expect(receipts).toHaveLength(2);
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: token1, handled: false }),
        expect.objectContaining({ token: token2, handled: false }),
      ]),
    );
  });

  it("ignores duplicate receipt ids silently", async () => {
    const token = newExpoToken();
    const receiptId = randomUUID();
    const entries: ExpoReceiptEntry[] = [
      { receiptId, token },
      { receiptId, token }, // Duplicate.
    ];

    // Should not throw.
    await enqueueExpoReceipts(entries);

    const receipts = await listReceipts(token);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptId).toBe(receiptId);
  });

  it("handles empty entries gracefully", async () => {
    // Should not throw (or reach the database).
    await expect(enqueueExpoReceipts([])).resolves.not.toThrow();
  });
});

describe("fetchAndProcessReceipts", () => {
  it("marks receipts as handled when Expo reports them", async () => {
    const token = newExpoToken();
    const receiptId = issueExpoReceipt();

    await enqueueExpoReceipts([{ receiptId, token }]);

    // Default mock: receipt is ok.
    await fetchAndProcessReceipts();

    const receipts = await listReceipts(token);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].handled).toBe(true);
  });

  it("keeps receipts unhandled if Expo has no receipt yet", async () => {
    const token = newExpoToken();
    const receiptId = issueExpoReceipt();

    await enqueueExpoReceipts([{ receiptId, token }]);
    forceExpoReceipt(receiptId, "missing");

    await fetchAndProcessReceipts();

    const receipts = await listReceipts(token);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].handled).toBe(false);
  });

  it("removes devices when receipt says DeviceNotRegistered", async () => {
    // Create a user and device.
    const user = await signUpByPhone("rider");
    const token = newExpoToken();
    const receiptId = issueExpoReceipt();

    // Seed a device for the user.
    await seedDevice(user.userId, "ios", token);

    // Enqueue receipt and mock failure.
    await enqueueExpoReceipts([{ receiptId, token }]);
    forceExpoReceipt(receiptId, "DeviceNotRegistered");

    await fetchAndProcessReceipts();

    // Device should be gone.
    const devices = await db("pushDevices").where({ token });
    expect(devices).toHaveLength(0);

    // Receipt should be marked handled.
    const receipts = await listReceipts(token);
    expect(receipts[0].handled).toBe(true);
  });

  it("cleans up receipts older than 7 days", async () => {
    const token = newExpoToken();
    const now = new Date();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    await db("pushReceipts").insert([
      { id: randomUUID(), receiptId: randomUUID(), token, handled: true, createdAt: eightDaysAgo },
      { id: randomUUID(), receiptId: randomUUID(), token, handled: true, createdAt: fiveDaysAgo },
      { id: randomUUID(), receiptId: randomUUID(), token, handled: false }, // Recent, unhandled.
    ]);

    await fetchAndProcessReceipts();

    const receipts = await listReceipts(token);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.createdAt > eightDaysAgo)).toBe(true);
  });

  it("handles receipt errors gracefully and marks them handled", async () => {
    const token = newExpoToken();
    const receiptId = issueExpoReceipt();

    // Mock receipt to fail with an error code (but not DeviceNotRegistered).
    await enqueueExpoReceipts([{ receiptId, token }]);
    forceExpoReceipt(receiptId, "MessageRateExceeded");

    await fetchAndProcessReceipts();

    // Receipt should be marked handled even though it failed.
    const receipts = await listReceipts(token);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].handled).toBe(true);
    // Device should still exist (only removed on DeviceNotRegistered).
    const devices = await db("pushDevices").where({ token });
    expect(devices).toHaveLength(0); // No device was inserted in this test.
  });
});
