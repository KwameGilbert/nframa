import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import {
  createPaymentMethod,
  adminListPaymentMethods,
  adminUpdatePaymentMethod,
  deletePaymentMethod,
  getPaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
  verifyPaymentMethod,
} from "../controllers/paymentMethod.controller.js";
import {
  createPaymentMethodSchema,
  listPaymentMethodsQuerySchema,
  paymentMethodParamsSchema,
  updatePaymentMethodSchema,
  verifyPaymentMethodSchema,
  adminUpdatePaymentMethodSchema,
} from "../schemas/paymentMethod.schema.js";

const router = Router();

// User endpoints
router.post(
  "/",
  authenticate,
  validate({ body: createPaymentMethodSchema }),
  createPaymentMethod,
);

router.get(
  "/",
  authenticate,
  validate({ query: listPaymentMethodsQuerySchema }),
  listPaymentMethods,
);

router.get(
  "/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema }),
  getPaymentMethod,
);

router.patch(
  "/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema, body: updatePaymentMethodSchema }),
  updatePaymentMethod,
);

router.post(
  "/:id/verify",
  authenticate,
  validate({ params: paymentMethodParamsSchema, body: verifyPaymentMethodSchema }),
  verifyPaymentMethod,
);

router.delete(
  "/:id",
  authenticate,
  validate({ params: paymentMethodParamsSchema }),
  deletePaymentMethod,
);

// Admin endpoints
router.get(
  "/admin/users",
  authenticate,
  requirePermission("users", "read"),
  adminListPaymentMethods,
);

router.patch(
  "/admin/users/:userId/:id",
  authenticate,
  requirePermission("users", "update"),
  validate({
    params: paymentMethodParamsSchema,
    body: adminUpdatePaymentMethodSchema,
  }),
  adminUpdatePaymentMethod,
);

export default router;
