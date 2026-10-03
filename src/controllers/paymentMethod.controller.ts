import type { Request, Response } from "express";
import { paymentMethodModel, type PaymentMethod } from "../models/paymentMethod.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import type {
  AdminListPaymentMethodsQuery,
  AdminUpdatePaymentMethodInput,
  CreatePaymentMethodInput,
  ListPaymentMethodsQuery,
  UpdatePaymentMethodInput,
} from "../schemas/paymentMethod.schema.js";

const PAYMENT_ACTIVITY = { module: "users", targetType: "paymentMethod" } as const;
// The request body carries the full number: it never reaches the audit trail.
const NUMBER_FIELDS = ["phoneNumber", "accountNumber"];

const mask = (value: unknown) => `****${String(value).slice(-4)}`;

function callerId(req: Request) {
  if (!req.auth) {
    throw AppError.unauthorized();
  }

  return req.auth.id;
}

function notFound(id: string) {
  return AppError.notFound(`Payment method not found: ${id}`);
}

// What gets saved: the details, a key that stops the same one being saved twice, and a default label.
function summarize({ type, displayName, ...details }: CreatePaymentMethodInput) {
  const d = details as Record<string, string | number>;
  switch (type) {
    case "card":
      return {
        identifier: `card:${String(d.brand).toLowerCase()}:${d.lastFourDigits}:${d.expiryMonth}/${d.expiryYear}`,
        displayName: displayName ?? `${d.brand} ending ${d.lastFourDigits}`,
        metadata: details,
      };
    case "mobile_money":
      return {
        identifier: `momo:${d.network}:${d.phoneNumber}`,
        displayName: displayName ?? `${String(d.network).toUpperCase()} ${mask(d.phoneNumber)}`,
        metadata: details,
      };
    case "bank_account":
      return {
        identifier: `bank:${String(d.bankCode).toLowerCase()}:${d.accountNumber}`,
        displayName: displayName ?? `${d.bankName} ${mask(d.accountNumber)}`,
        metadata: details,
      };
  }
}

function detailsOf({ type, metadata: m }: PaymentMethod) {
  switch (type) {
    case "card":
      return {
        brand: m.brand,
        lastFourDigits: m.lastFourDigits,
        expiryMonth: m.expiryMonth,
        expiryYear: m.expiryYear,
      };
    case "mobile_money":
      return { network: m.network, phoneNumber: mask(m.phoneNumber) };
    case "bank_account":
      return {
        bankCode: m.bankCode,
        bankName: m.bankName,
        accountName: m.accountName,
        accountNumber: mask(m.accountNumber),
      };
  }
}

// Full phone and account numbers stay in the database: every response and audit entry gets this view.
export function paymentMethodView(method: PaymentMethod) {
  return {
    id: method.id,
    userId: method.userId,
    userRole: method.userRole,
    type: method.type,
    displayName: method.displayName,
    details: detailsOf(method),
    verificationStatus: method.verificationStatus,
    verifiedAt: method.verificationCompletedAt,
    isPrimary: method.isPrimary,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}

export async function createPaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const role = req.auth?.role;
  if (role !== "rider" && role !== "driver") {
    throw AppError.forbidden("Only riders and drivers can save payment methods");
  }

  const input = req.validated.body as CreatePaymentMethodInput;
  const method = await paymentMethodModel.createMethod({
    userId,
    userRole: role,
    type: input.type,
    ...summarize(input),
  });

  sendCreated(res, "Payment method saved successfully", paymentMethodView(method));

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.create",
    description: `Saved a ${method.type.replace("_", " ")} payment method`,
    targetId: method.id,
    after: paymentMethodView(method),
    redact: NUMBER_FIELDS,
  });
}

export async function listPaymentMethods(req: Request, res: Response) {
  const { verified } = req.validated.query as ListPaymentMethodsQuery;
  const methods = await paymentMethodModel.listByUser(callerId(req), verified);

  sendSuccess(res, "Payment methods retrieved successfully", {
    items: methods.map(paymentMethodView),
  });
}

export async function getPaymentMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const method = await paymentMethodModel.findOwned(id, callerId(req));
  if (!method) {
    throw notFound(id);
  }

  sendSuccess(res, "Payment method retrieved successfully", paymentMethodView(method));
}

// Only the label and which one is the default can change. Anything else means saving a new method, which
// has to be verified again, so an unverified detail can never sit on a verified method.
export async function updatePaymentMethod(req: Request, res: Response) {
  const userId = callerId(req);
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdatePaymentMethodInput;

  const existing = await paymentMethodModel.findOwned(id, userId);
  if (!existing) {
    throw notFound(id);
  }
  if (input.isPrimary && !existing.isVerified) {
    throw AppError.conflict("Only a verified payment method can be your primary one");
  }

  let updated: PaymentMethod | undefined = existing;
  if (input.displayName !== undefined) {
    updated = await paymentMethodModel.rename(id, input.displayName);
  }
  if (updated && input.isPrimary) {
    updated = await paymentMethodModel.setPrimary(id, userId);
  }
  if (!updated) {
    throw notFound(id);
  }

  sendSuccess(res, "Payment method updated successfully", paymentMethodView(updated));

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.update",
    description: "Updated a payment method",
    targetId: id,
    before: paymentMethodView(existing),
    after: paymentMethodView(updated),
  });
}

export async function deletePaymentMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await paymentMethodModel.findOwned(id, callerId(req));
  if (!existing || !(await paymentMethodModel.deactivate(id))) {
    throw notFound(id);
  }

  sendSuccess(res, "Payment method removed successfully");

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.delete",
    description: "Removed a payment method",
    targetId: id,
    before: paymentMethodView(existing),
  });
}

export async function adminListPaymentMethods(req: Request, res: Response) {
  const query = req.validated.query as AdminListPaymentMethodsQuery;
  const { items, totalItems } = await paymentMethodModel.adminList(query);

  sendSuccess(res, "Payment methods retrieved successfully", {
    items: items.map(paymentMethodView),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  });
}

// Until the payment provider verifies methods itself, staff do.
export async function adminUpdatePaymentMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const { verificationStatus } = req.validated.body as AdminUpdatePaymentMethodInput;

  const existing = await paymentMethodModel.findActive(id);
  if (!existing) {
    throw notFound(id);
  }

  const updated = await paymentMethodModel.setVerification(id, verificationStatus);
  if (!updated) {
    throw notFound(id);
  }

  sendSuccess(res, "Payment method updated successfully", paymentMethodView(updated));

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.setVerification",
    description: `Set a payment method to ${verificationStatus}`,
    targetId: id,
    before: paymentMethodView(existing),
    after: paymentMethodView(updated),
  });
}

export async function adminDeletePaymentMethod(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const existing = await paymentMethodModel.findActive(id);
  if (!existing || !(await paymentMethodModel.deactivate(id))) {
    throw notFound(id);
  }

  sendSuccess(res, "Payment method removed successfully");

  logActivity(req, {
    ...PAYMENT_ACTIVITY,
    action: "paymentMethod.adminDelete",
    description: "Removed a payment method",
    targetId: id,
    before: paymentMethodView(existing),
  });
}
