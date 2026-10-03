import type { Request, Response } from "express";
import { paymentMethodModel } from "../models/paymentMethod.model.js";
import { payoutMethodModel, type PayoutMethodWithPayment } from "../models/payoutMethod.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { sendPayoutMethodEmail } from "../services/email.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  AdminListPayoutMethodsQuery,
  CreatePayoutMethodInput,
  UpdatePayoutMethodInput,
} from "../schemas/payout.schema.js";

const PAYOUT_ACTIVITY = { module: "payouts", targetType: "payoutMethod" } as const;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

function notFound(id: string) {
  return AppError.notFound(`Payout method not found: ${id}`);
}

function payoutMethodView(method: PayoutMethodWithPayment) {
  return {
    id: method.id,
    driverUserId: method.driverUserId,
    paymentMethodId: method.paymentMethodId,
    isAutomatic: method.isAutomatic,
    minimumThreshold: method.minimumThreshold,
    payoutFrequency: method.payoutFrequency,
    isPrimary: method.isPrimary,
    paymentMethod: {
      type: method.paymentType,
      displayName: method.paymentDisplayName,
      verificationStatus: method.paymentVerificationStatus,
    },
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}

// Shared by the driver and the admin routes.
async function applyUpdate(method: PayoutMethodWithPayment, input: UpdatePayoutMethodInput) {
  const { isPrimary, ...settings } = input;
  if (isPrimary && method.paymentVerificationStatus !== "verified") {
    throw AppError.conflict("Only a verified payment method can be the primary payout method");
  }

  let updated: PayoutMethodWithPayment | undefined = method;
  if (Object.keys(settings).length > 0) {
    updated = await payoutMethodModel.updateSettings(method.id, settings);
  }
  if (updated && isPrimary) {
    updated = await payoutMethodModel.setPrimary(method.id, method.driverUserId);
  }
  if (!updated) {
    throw notFound(method.id);
  }
  return updated;
}

export async function createPayoutMethod(req: Request, res: Response) {
  const driverUserId = callerId(req);
  if (req.auth?.role !== "driver") {
    throw AppError.forbidden("Only drivers can set up payouts");
  }

  const { paymentMethodId, ...settings } = req.validated.body as CreatePayoutMethodInput;

  const payment = await paymentMethodModel.findOwned(paymentMethodId, driverUserId);
  if (!payment) {
    throw AppError.notFound(`Payment method not found: ${paymentMethodId}`);
  }
  if (payment.type === "card") {
    throw AppError.badRequest("Payouts go to a mobile money number or a bank account, not a card");
  }
  if (!payment.isVerified) {
    throw AppError.conflict("Verify this payment method before using it for payouts");
  }

  const method = await payoutMethodModel.createMethod(paymentMethodId, driverUserId, settings);

  sendCreated(res, "Payout method added successfully", payoutMethodView(method));
  void sendPayoutMethodEmail(driverUserId, method.paymentDisplayName, "added");

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payoutMethod.create",
    description: "Added a payout method",
    targetId: method.id,
    after: payoutMethodView(method),
  });
}

export async function listPayoutMethods(req: Request, res: Response) {
  const methods = await payoutMethodModel.listByDriver(callerId(req));

  sendSuccess(res, "Payout methods retrieved successfully", {
    items: methods.map(payoutMethodView),
  });
}

export async function updatePayoutMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdatePayoutMethodInput;

  const existing = await payoutMethodModel.findOwned(id, callerId(req));
  if (!existing) {
    throw notFound(id);
  }

  const updated = await applyUpdate(existing, input);

  sendSuccess(res, "Payout method updated successfully", payoutMethodView(updated));

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payoutMethod.update",
    description: "Updated a payout method",
    targetId: id,
    before: payoutMethodView(existing),
    after: payoutMethodView(updated),
  });
}

export async function deletePayoutMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await payoutMethodModel.findOwned(id, callerId(req));
  if (!existing) {
    throw notFound(id);
  }

  await payoutMethodModel.remove(id);

  sendSuccess(res, "Payout method removed successfully");
  void sendPayoutMethodEmail(existing.driverUserId, existing.paymentDisplayName, "removed");

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payoutMethod.delete",
    description: "Removed a payout method",
    targetId: id,
    before: payoutMethodView(existing),
  });
}

export async function adminListPayoutMethods(req: Request, res: Response) {
  const query = req.validated.query as AdminListPayoutMethodsQuery;
  const { items, totalItems } = await payoutMethodModel.adminList(query);

  sendSuccess(res, "Payout methods retrieved successfully", {
    items: items.map(payoutMethodView),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

export async function adminUpdatePayoutMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdatePayoutMethodInput;

  const existing = await payoutMethodModel.findWithPayment(id);
  if (!existing) {
    throw notFound(id);
  }

  const updated = await applyUpdate(existing, input);

  sendSuccess(res, "Payout method updated successfully", payoutMethodView(updated));

  logActivity(req, {
    ...PAYOUT_ACTIVITY,
    action: "payoutMethod.adminUpdate",
    description: "Updated a driver's payout method",
    targetId: id,
    before: payoutMethodView(existing),
    after: payoutMethodView(updated),
  });
}
