import type { Request, Response } from "express";
import { paymentMethodModel } from "../models/paymentMethod.model.js";
import { payoutHistoryModel } from "../models/payoutHistory.model.js";
import { payoutMethodModel } from "../models/payoutMethod.model.js";
import { walletModel } from "../models/wallet.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { paymentService } from "../services/payment.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type { CreatePayoutMethodInput, UpdatePayoutMethodInput } from "../schemas/payout.schema.js";

const PAYOUT_ACTIVITY = { module: "users", targetType: "payout" } as const;

function callerId(req: Request): string {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth.id;
}

export async function createPayoutMethod(req: Request, res: Response) {
  const driverUserId = callerId(req);

  if (req.auth?.role !== "driver") {
    throw AppError.forbidden("Only drivers can add payout methods");
  }

  const input = req.validated.body as CreatePayoutMethodInput;

  const paymentMethod = await paymentMethodModel.findById(input.paymentMethodId);
  if (!paymentMethod || paymentMethod.userId !== driverUserId) {
    throw AppError.badRequest("Payment method not found or doesn't belong to you");
  }

  if (!paymentMethod.isVerified) {
    throw AppError.badRequest("Payment method must be verified before using for payouts");
  }

  const existing = await payoutMethodModel.listByDriver(driverUserId);
  if (existing.some((m) => m.paymentMethodId === input.paymentMethodId)) {
    throw AppError.conflict("This payment method is already set up for payouts");
  }

  const payout = await payoutMethodModel.create(
    input.paymentMethodId,
    driverUserId,
    input.isAutomatic || false,
    input.minimumThreshold || 0,
    input.payoutFrequency || "daily",
  );

  sendCreated(res, "Payout method added successfully", {
    id: payout.id,
    paymentMethodId: payout.paymentMethodId,
    isAutomatic: payout.isAutomatic,
    minimumThreshold: payout.minimumThreshold,
  });

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payout.addMethod",
    description: "Added payout method",
    targetId: payout.id,
    after: {
      isAutomatic: payout.isAutomatic,
      minimumThreshold: payout.minimumThreshold,
    },
  });
}

export async function listPayoutMethods(req: Request, res: Response) {
  const driverUserId = callerId(req);

  const methods = await payoutMethodModel.listByDriver(driverUserId);
  const details = await Promise.all(
    methods.map(async (method) => {
      const payment = await paymentMethodModel.findById(method.paymentMethodId);
      return {
        id: method.id,
        paymentMethodId: method.paymentMethodId,
        displayName: payment?.displayName,
        type: payment?.type,
        isAutomatic: method.isAutomatic,
        minimumThreshold: method.minimumThreshold,
        payoutFrequency: method.payoutFrequency,
        isPrimary: method.isPrimary,
        lastPayoutAt: method.lastPayoutAt,
        nextScheduledPayout: method.nextScheduledPayout,
      };
    }),
  );

  sendSuccess(res, "Payout methods retrieved successfully", { items: details });
}

export async function updatePayoutMethod(req: Request, res: Response) {
  const driverUserId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdatePayoutMethodInput;

  const method = await payoutMethodModel.findById(id);
  if (!method || method.driverUserId !== driverUserId) {
    throw AppError.notFound(`Payout method not found: ${id}`);
  }

  if (input.isPrimary) {
    await payoutMethodModel.setPrimary(id, driverUserId);
  }

  if (input.isAutomatic !== undefined) {
    await payoutMethodModel.setAutomatic(
      id,
      input.isAutomatic,
      input.minimumThreshold,
      input.payoutFrequency,
    );
  }

  const updated = await payoutMethodModel.findById(id);

  sendSuccess(res, "Payout method updated successfully", {
    id: updated!.id,
    isAutomatic: updated!.isAutomatic,
    minimumThreshold: updated!.minimumThreshold,
    isPrimary: updated!.isPrimary,
  });

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payout.updateMethod",
    description: "Updated payout method",
    targetId: id,
  });
}

export async function triggerManualPayout(req: Request, res: Response) {
  const driverUserId = callerId(req);
  const { id } = req.validated.params as { id: string };

  const payoutMethod = await payoutMethodModel.findById(id);
  if (!payoutMethod || payoutMethod.driverUserId !== driverUserId) {
    throw AppError.notFound(`Payout method not found: ${id}`);
  }

  const wallet = await walletModel.getWallet(driverUserId);
  if (!wallet || wallet.balance <= 0) {
    throw AppError.badRequest("Insufficient balance for payout");
  }

  const paymentMethod = await paymentMethodModel.findById(payoutMethod.paymentMethodId);
  if (!paymentMethod || !paymentMethod.isVerified) {
    throw AppError.badRequest("Payment method is not verified");
  }

  const amount = wallet.balance;
  const reference = `PAYOUT-${driverUserId}-${Date.now()}`;

  let history = await payoutHistoryModel.record(
    driverUserId,
    payoutMethod.id,
    amount,
    "processing",
    driverUserId,
    "manual",
    undefined,
    { initiatedManually: true },
  );

  try {
    const result = await paymentService.transfer(paymentMethod.provider, {
      recipientToken: paymentMethod.tokenizedReference,
      amount,
      currency: "GHS",
      reference,
      description: `Driver payout`,
    });

    history = (await payoutHistoryModel.updateStatus(history.id, "completed", undefined))!;
    await payoutMethodModel.recordPayout(payoutMethod.id, amount);

    sendSuccess(res, "Payout initiated successfully", {
      id: history.id,
      amount,
      status: "completed",
      reference: result.transactionId,
    });

    logActivity(req, {
      ...PAYOUT_ACTIVITY,
      action: "payout.manual",
      description: `Initiated manual payout of GHS ${amount}`,
      targetId: history.id,
      after: { amount, status: "completed" },
    });
  } catch (error) {
    await payoutHistoryModel.updateStatus(
      history.id,
      "failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw AppError.conflict("Payout failed. Please try again.");
  }
}

export async function getPayoutHistory(req: Request, res: Response) {
  const driverUserId = callerId(req);
  const query = req.validated.query as {
    status?: "pending" | "processing" | "completed" | "failed";
    page?: number;
    limit?: number;
  };

  const { items, total } = await payoutHistoryModel.listByDriver(
    driverUserId,
    query.status,
    query.limit || 20,
    ((query.page || 1) - 1) * (query.limit || 20),
  );

  sendSuccess(res, "Payout history retrieved successfully", {
    items,
    pagination: {
      page: query.page || 1,
      limit: query.limit || 20,
      total,
      totalPages: Math.ceil(total / (query.limit || 20)),
    },
  });
}

export async function getPayoutStats(req: Request, res: Response) {
  const driverUserId = callerId(req);
  const stats = await payoutHistoryModel.getStats(driverUserId);

  sendSuccess(res, "Payout statistics retrieved successfully", stats);
}

// Admin endpoints

export async function adminListPayoutMethods(req: Request, res: Response) {
  const { driverId } = req.validated.params as { driverId: string };

  const methods = await payoutMethodModel.listByDriver(driverId);
  const details = await Promise.all(
    methods.map(async (method) => {
      const payment = await paymentMethodModel.findById(method.paymentMethodId);
      return {
        ...method,
        displayName: payment?.displayName,
        type: payment?.type,
      };
    }),
  );

  sendSuccess(res, "Driver payout methods retrieved successfully", { items: details });

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payout.adminListMethods",
    description: `Admin viewed payout methods for driver ${driverId}`,
    targetId: driverId,
  });
}

export async function adminListPayoutHistory(req: Request, res: Response) {
  const { driverId } = req.validated.params as { driverId?: string };
  const query = req.validated.query as {
    status?: "pending" | "processing" | "completed" | "failed";
    page?: number;
    limit?: number;
  };

  let result;
  if (driverId) {
    result = await payoutHistoryModel.listByDriver(
      driverId,
      query.status,
      query.limit || 20,
      ((query.page || 1) - 1) * (query.limit || 20),
    );
  } else {
    result = await payoutHistoryModel.adminListAll({
      status: query.status,
      page: query.page || 1,
      limit: query.limit || 20,
    });
  }

  sendSuccess(res, "Payout history retrieved successfully", {
    items: result.items,
    pagination: {
      page: query.page || 1,
      limit: query.limit || 20,
      total: result.total,
      totalPages: Math.ceil(result.total / (query.limit || 20)),
    },
  });

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payout.adminViewHistory",
    description: `Admin viewed payout history${driverId ? ` for driver ${driverId}` : ""}`,
  });
}

export async function adminTriggerPayout(req: Request, res: Response) {
  const { driverId } = req.validated.params as { driverId: string };

  const payoutMethod = await payoutMethodModel.getPrimary(driverId);
  if (!payoutMethod) {
    throw AppError.badRequest("Driver has no primary payout method configured");
  }

  const wallet = await walletModel.getWallet(driverId);
  if (!wallet || wallet.balance <= 0) {
    throw AppError.badRequest("Insufficient balance for payout");
  }

  const paymentMethod = await paymentMethodModel.findById(payoutMethod.paymentMethodId);
  if (!paymentMethod || !paymentMethod.isVerified) {
    throw AppError.badRequest("Payment method is not verified");
  }

  const amount = wallet.balance;
  const reference = `ADMIN-PAYOUT-${driverId}-${Date.now()}`;

  let history = await payoutHistoryModel.record(
    driverId,
    payoutMethod.id,
    amount,
    "processing",
    callerId(req),
    "manual",
    undefined,
    { adminTriggered: true },
  );

  try {
    const result = await paymentService.transfer(paymentMethod.provider, {
      recipientToken: paymentMethod.tokenizedReference,
      amount,
      currency: "GHS",
      reference,
      description: `Admin-triggered payout`,
    });

    history = (await payoutHistoryModel.updateStatus(history.id, "completed", undefined))!;
    await payoutMethodModel.recordPayout(payoutMethod.id, amount);

    sendSuccess(res, "Payout initiated successfully", {
      id: history.id,
      amount,
      status: "completed",
      reference: result.transactionId,
    });

    logActivity(req, {
      ...PAYOUT_ACTIVITY,
      action: "payout.adminTrigger",
      description: `Admin initiated payout of GHS ${amount} for driver ${driverId}`,
      targetId: history.id,
    });
  } catch (error) {
    await payoutHistoryModel.updateStatus(
      history.id,
      "failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw AppError.conflict("Payout failed. Please try again.");
  }
}

export async function adminGetPayoutStats(req: Request, res: Response) {
  const { driverId } = req.validated.params as { driverId: string };
  const stats = await payoutHistoryModel.getStats(driverId);

  sendSuccess(res, "Payout statistics retrieved successfully", stats);

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payout.adminViewStats",
    description: `Admin viewed payout stats for driver ${driverId}`,
    targetId: driverId,
  });
}
