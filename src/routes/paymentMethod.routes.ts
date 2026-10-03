import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  adminListPaymentMethodsQuerySchema,
  adminUpdatePaymentMethodSchema,
  createPaymentMethodSchema,
  listPaymentMethodsQuerySchema,
  paymentMethodParamsSchema,
  updatePaymentMethodSchema,
} from "../schemas/paymentMethod.schema.js";
import {
  adminDeletePaymentMethod,
  adminListPaymentMethods,
  adminUpdatePaymentMethod,
  createPaymentMethod,
  deletePaymentMethod,
  getPaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from "../controllers/paymentMethod.controller.js";

export const paymentMethodRouter = Router();

// A person's own payment methods: the controller only ever looks at the caller's rows.
paymentMethodRouter.post(
  "/payment-methods",
  authenticate,
  validate({ body: createPaymentMethodSchema }),
  createPaymentMethod,
);

paymentMethodRouter.get(
  "/payment-methods",
  authenticate,
  validate({ query: listPaymentMethodsQuerySchema }),
  listPaymentMethods,
);

paymentMethodRouter.get(
  "/payment-methods/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema }),
  getPaymentMethod,
);

paymentMethodRouter.patch(
  "/payment-methods/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema, body: updatePaymentMethodSchema }),
  updatePaymentMethod,
);

paymentMethodRouter.delete(
  "/payment-methods/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema }),
  deletePaymentMethod,
);

// Staff.
paymentMethodRouter.get(
  "/admin/payment-methods",
  authenticate,
  requirePermission("users", "read"),
  validate({ query: adminListPaymentMethodsQuerySchema }),
  adminListPaymentMethods,
);

paymentMethodRouter.patch(
  "/admin/payment-methods/:id",
  authenticate,
  requirePermission("users", "update"),
  validate({ params: paymentMethodParamsSchema, body: adminUpdatePaymentMethodSchema }),
  adminUpdatePaymentMethod,
);

paymentMethodRouter.delete(
  "/admin/payment-methods/:id",
  authenticate,
  requirePermission("users", "delete"),
  validate({ params: paymentMethodParamsSchema }),
  adminDeletePaymentMethod,
);
