import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { payoutLimit } from "../middlewares/rateLimit.js";
import {
  adminListPayoutMethodsQuerySchema,
  createPayoutMethodSchema,
  listPayoutsQuerySchema,
  payoutMethodParamsSchema,
  payoutParamsSchema,
  requestPayoutSchema,
  updatePayoutMethodSchema,
} from "../schemas/payout.schema.js";
import {
  adminListPayoutMethods,
  adminUpdatePayoutMethod,
  cancelPayout,
  createPayoutMethod,
  deletePayoutMethod,
  listPayoutMethods,
  listPayouts,
  requestPayout,
  updatePayoutMethod,
} from "../controllers/payout.controller.js";

export const payoutRouter = Router();

// A driver's own payout methods: the controller only ever looks at the caller's rows.
payoutRouter.post(
  "/payout-methods",
  authenticate,
  validate({ body: createPayoutMethodSchema }),
  createPayoutMethod,
);

payoutRouter.get("/payout-methods", authenticate, listPayoutMethods);

payoutRouter.patch(
  "/payout-methods/:id",
  authenticate,
  validate({ params: payoutMethodParamsSchema, body: updatePayoutMethodSchema }),
  updatePayoutMethod,
);

payoutRouter.delete(
  "/payout-methods/:id",
  authenticate,
  validate({ params: payoutMethodParamsSchema }),
  deletePayoutMethod,
);

// A driver's own payouts.
payoutRouter.post(
  "/drivers/me/payouts",
  authenticate,
  payoutLimit,
  validate({ body: requestPayoutSchema }),
  requestPayout,
);

payoutRouter.get(
  "/drivers/me/payouts",
  authenticate,
  payoutLimit,
  validate({ query: listPayoutsQuerySchema }),
  listPayouts,
);

payoutRouter.post(
  "/drivers/me/payouts/:id/cancel",
  authenticate,
  payoutLimit,
  validate({ params: payoutParamsSchema }),
  cancelPayout,
);

// Staff.
payoutRouter.get(
  "/admin/payout-methods",
  authenticate,
  requirePermission("payouts", "read"),
  validate({ query: adminListPayoutMethodsQuerySchema }),
  adminListPayoutMethods,
);

payoutRouter.patch(
  "/admin/payout-methods/:id",
  authenticate,
  requirePermission("payouts", "update"),
  validate({ params: payoutMethodParamsSchema, body: updatePayoutMethodSchema }),
  adminUpdatePayoutMethod,
);
