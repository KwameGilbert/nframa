import { describe, expect, it, vi } from "vitest";
import {
  notifyWallet,
  notifyReview,
  notifyPayout,
  notifyPaymentMethod,
  notifyDriverVerification,
  notifyAdminAccess,
} from "../src/services/notificationEvents.service.js";

describe("Push notifications for wallet top-ups", () => {
  it("notifies user when wallet top-up succeeds", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    await notifyWallet(userId, "topUp", {
      id: transactionId,
      amount: 50,
      currency: "GHS",
    });

    const notifications = vi.mocked(notifyWallet).mock.calls;
    const topUpCalls = notifications.filter(([uid, event]) => uid === userId && event === "topUp");
    expect(topUpCalls).toHaveLength(1);
    expect(topUpCalls[0][2]).toMatchObject({
      amount: 50,
      currency: "GHS",
    });
  });

  it("notifies user when wallet top-up fails", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    await notifyWallet(userId, "topUpFailed", {
      id: transactionId,
      amount: 100,
      currency: "GHS",
    });

    const notifications = vi.mocked(notifyWallet).mock.calls;
    const failedCalls = notifications.filter(
      ([uid, event]) => uid === userId && event === "topUpFailed",
    );
    expect(failedCalls).toHaveLength(1);
    expect(failedCalls[0][2]).toMatchObject({
      amount: 100,
      currency: "GHS",
    });
  });
});

describe("Push notifications for reviews", () => {
  it("notifies driver when they receive a review", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    await notifyReview(driverId, { rating: 5, tip: 0 });

    const notifications = vi.mocked(notifyReview).mock.calls;
    const reviewCalls = notifications.filter(([userId]) => userId === driverId);
    expect(reviewCalls).toHaveLength(1);
  });

  it("includes tip information in review notification", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    const tip = 5.5;
    await notifyReview(driverId, { rating: 4, tip });

    const notifications = vi.mocked(notifyReview).mock.calls;
    const withTip = notifications.filter(
      ([userId, data]) => userId === driverId && (data as { tip?: number }).tip === tip,
    );
    expect(withTip).toHaveLength(1);
  });
});

describe("Push notifications for payout methods", () => {
  it("notifies driver when payout method is added", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    await notifyPayout(driverId, "added");

    const notifications = vi.mocked(notifyPayout).mock.calls;
    const addedCalls = notifications.filter(
      ([userId, action]) => userId === driverId && action === "added",
    );
    expect(addedCalls).toHaveLength(1);
  });

  it("notifies driver when payout method is removed", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    await notifyPayout(driverId, "removed");

    const notifications = vi.mocked(notifyPayout).mock.calls;
    const removedCalls = notifications.filter(
      ([userId, action]) => userId === driverId && action === "removed",
    );
    expect(removedCalls).toHaveLength(1);
  });
});

describe("Push notifications for payment method verification", () => {
  it("notifies user when payment method is verified", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    await notifyPaymentMethod(userId, "verified");

    const notifications = vi.mocked(notifyPaymentMethod).mock.calls;
    const verifiedCalls = notifications.filter(
      ([uid, status]) => uid === userId && status === "verified",
    );
    expect(verifiedCalls).toHaveLength(1);
  });

  it("notifies user when payment method verification fails", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    await notifyPaymentMethod(userId, "failed");

    const notifications = vi.mocked(notifyPaymentMethod).mock.calls;
    const failedCalls = notifications.filter(
      ([uid, status]) => uid === userId && status === "failed",
    );
    expect(failedCalls).toHaveLength(1);
  });
});

describe("Push notifications for driver verification", () => {
  it("notifies driver when verification status changes to approved", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    await notifyDriverVerification(driverId, "approved");

    const notifications = vi.mocked(notifyDriverVerification).mock.calls;
    const approveCalls = notifications.filter(
      ([userId, status]) => userId === driverId && status === "approved",
    );
    expect(approveCalls).toHaveLength(1);
  });

  it("notifies driver on rejection", async () => {
    vi.clearAllMocks();

    const driverId = crypto.randomUUID();
    await notifyDriverVerification(driverId, "rejected");

    const notifications = vi.mocked(notifyDriverVerification).mock.calls;
    const rejectCalls = notifications.filter(
      ([userId, status]) => userId === driverId && status === "rejected",
    );
    expect(rejectCalls).toHaveLength(1);
  });
});

describe("Push notifications for admin access", () => {
  it("notifies when admin access is granted", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    await notifyAdminAccess(userId, "granted");

    const notifications = vi.mocked(notifyAdminAccess).mock.calls;
    const grantCalls = notifications.filter(
      ([uid, change]) => uid === userId && change === "granted",
    );
    expect(grantCalls).toHaveLength(1);
  });

  it("notifies when admin access is changed", async () => {
    vi.clearAllMocks();

    const userId = crypto.randomUUID();
    await notifyAdminAccess(userId, "changed");

    const notifications = vi.mocked(notifyAdminAccess).mock.calls;
    const changedCalls = notifications.filter(
      ([uid, change]) => uid === userId && change === "changed",
    );
    expect(changedCalls).toHaveLength(1);
  });
});
