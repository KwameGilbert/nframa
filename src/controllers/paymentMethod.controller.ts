import type { Request, Response } from "express";
import { paymentMethodModel } from "../models/paymentMethod.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { paymentService } from "../services/payment.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  AdminUpdatePaymentMethodInput,
  CreatePaymentMethodInput,
  UpdatePaymentMethodInput,
  VerifyPaymentMethodInput,
} from "../schemas/paymentMethod.schema.js";

const PAYMENT_ACTIVITY = { module: "users", targetType: "paymentMethod" } as const;

function callerId(req: Request): string {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth.id;
}

export async function createPaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const input = req.validated.body as CreatePaymentMethodInput;

  try {
    const { token, provider } = await paymentService.tokenize(input.type, input.metadata);

    const method = await paymentMethodModel.create(
      userId,
      req.auth!.role as "rider" | "driver",
      input.type,
      provider,
      token,
      input.displayName || deriveDisplayName(input.type, input.metadata),
      input.metadata,
    );

    sendCreated(res, "Payment method added successfully", {
      id: method.id,
      type: method.type,
      displayName: method.displayName,
      isVerified: method.isVerified,
      verificationStatus: method.verificationStatus,
      createdAt: method.createdAt,
    });

    logActivity(req, {
      ...PAYMENT_ACTIVITY,
      action: "paymentMethod.create",
      description: `Added ${method.type} payment method`,
      targetId: method.id,
      after: { id: method.id, type: method.type, provider: method.provider },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest("Failed to add payment method");
  }
}

export async function listPaymentMethods(req: Request, res: Response) {
  const userId = callerId(req);
  const query = req.validated.query as { verified?: boolean; active?: boolean };

  const { items, total } = await paymentMethodModel.listByUser(
    userId,
    query.verified,
    20,
    0,
  );

  sendSuccess(res, "Payment methods retrieved successfully", {
    items: items.map((m) => ({
      id: m.id,
      type: m.type,
      displayName: m.displayName,
      provider: m.provider,
      isVerified: m.isVerified,
      verificationStatus: m.verificationStatus,
      isPrimary: m.isPrimary,
      createdAt: m.createdAt,
    })),
    pagination: { total, page: 1, limit: 20 },
  });
}

export async function getPaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };

  const method = await paymentMethodModel.findById(id);
  if (!method || method.userId !== userId) {
    throw AppError.notFound(`Payment method not found: ${id}`);
  }

  sendSuccess(res, "Payment method retrieved successfully", {
    id: method.id,
    type: method.type,
    displayName: method.displayName,
    provider: method.provider,
    isVerified: method.isVerified,
    verificationStatus: method.verificationStatus,
    verificationCompletedAt: method.verificationCompletedAt,
    isPrimary: method.isPrimary,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  });
}

export async function updatePaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdatePaymentMethodInput;

  const existing = await paymentMethodModel.findById(id);
  if (!existing || existing.userId !== userId) {
    throw AppError.notFound(`Payment method not found: ${id}`);
  }

  let updated = existing;

  if (input.isPrimary) {
    updated = (await paymentMethodModel.setAsPrimary(id, userId)) || existing;
  }

  if (input.displayName) {
    updated = (await paymentMethodModel.updateById(id, { displayName: input.displayName })) || updated;
  }

  sendSuccess(res, "Payment method updated successfully", {
    id: updated.id,
    displayName: updated.displayName,
    isPrimary: updated.isPrimary,
  });

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.update",
    description: "Updated payment method",
    targetId: id,
    before: { displayName: existing.displayName, isPrimary: existing.isPrimary },
    after: { displayName: updated.displayName, isPrimary: updated.isPrimary },
  });
}

export async function verifyPaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as VerifyPaymentMethodInput;

  const method = await paymentMethodModel.findById(id);
  if (!method || method.userId !== userId) {
    throw AppError.notFound(`Payment method not found: ${id}`);
  }

  if (method.isVerified) {
    sendSuccess(res, "Payment method is already verified", { id, isVerified: true });
    return;
  }

  const isValid = await paymentService.verifyToken(method.provider, input.verificationToken);
  if (!isValid) {
    await paymentMethodModel.markVerificationFailed(id);
    throw AppError.badRequest("Verification failed. Please try again.");
  }

  const verified = await paymentMethodModel.verify(id);
  if (!verified) {
    throw AppError.conflict("Could not verify payment method");
  }

  sendSuccess(res, "Payment method verified successfully", {
    id: verified.id,
    isVerified: true,
    verificationStatus: "verified",
  });

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.verify",
    description: "Verified payment method",
    targetId: id,
  });
}

export async function deletePaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };

  const method = await paymentMethodModel.findById(id);
  if (!method || method.userId !== userId) {
    throw AppError.notFound(`Payment method not found: ${id}`);
  }

  await paymentMethodModel.softDelete(id);

  sendSuccess(res, "Payment method removed successfully");

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.delete",
    description: "Removed payment method",
    targetId: id,
    before: { type: method.type, provider: method.provider },
  });
}

// Admin endpoints

export async function adminListPaymentMethods(req: Request, res: Response) {
  const query = req.validated.query as {
    userId?: string;
    verified?: boolean;
    page?: number;
    limit?: number;
  };

  const { items, total } = await paymentMethodModel.adminListAll({
    userId: query.userId,
    isVerified: query.verified,
    page: query.page || 1,
    limit: query.limit || 20,
  });

  sendSuccess(res, "Payment methods retrieved successfully", {
    items,
    pagination: {
      page: query.page || 1,
      limit: query.limit || 20,
      total,
      totalPages: Math.ceil(total / (query.limit || 20)),
    },
  });

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.adminList",
    description: `Admin viewed ${items.length} payment methods`,
  });
}

export async function adminUpdatePaymentMethod(req: Request, res: Response) {
  const { userId, id } = req.validated.params as { userId: string; id: string };
  const input = req.validated.body as AdminUpdatePaymentMethodInput;

  const method = await paymentMethodModel.findById(id);
  if (!method || method.userId !== userId) {
    throw AppError.notFound(`Payment method not found: ${id}`);
  }

  const updated = await paymentMethodModel.adminUpdate(id, input);
  if (!updated) {
    throw AppError.conflict("Could not update payment method");
  }

  sendSuccess(res, "Payment method updated successfully", {
    id: updated.id,
    isVerified: updated.isVerified,
    verificationStatus: updated.verificationStatus,
  });

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.adminUpdate",
    description: "Admin updated payment method",
    targetId: id,
    before: {
      isVerified: method.isVerified,
      verificationStatus: method.verificationStatus,
    },
    after: {
      isVerified: updated.isVerified,
      verificationStatus: updated.verificationStatus,
    },
  });
}

// Helper
function deriveDisplayName(
  type: "card" | "mobile_money" | "bank_account",
  metadata: Record<string, unknown>,
): string {
  if (type === "card") {
    const last4 = String(metadata.lastFourDigits || "****");
    return `Card ending ${last4}`;
  } else if (type === "mobile_money") {
    return `Mobile (${metadata.operator})`;
  } else {
    return `Bank Account`;
  }
}
