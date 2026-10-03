import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import {
  createPayoutMethod,
  listPayoutMethods,
  updatePayoutMethod,
  triggerManualPayout,
  getPayoutHistory,
  getPayoutStats,
  adminListPayoutMethods,
  adminListPayoutHistory,
  adminTriggerPayout,
  adminGetPayoutStats,
} from "../controllers/payout.controller.js";
import {
  createPayoutMethodSchema,
  updatePayoutMethodSchema,
  payoutMethodParamsSchema,
  payoutAdminDriverIdParamsSchema,
  listPayoutHistoryQuerySchema,
} from "../schemas/payout.schema.js";

const router = Router();

// Driver endpoints
router.post(
  "/methods",
  authenticate,
  validate({ body: createPayoutMethodSchema }),
  createPayoutMethod,
);

router.get("/methods", authenticate, listPayoutMethods);

router.patch(
  "/methods/:id",
  authenticate,
  validate({ params: payoutMethodParamsSchema, body: updatePayoutMethodSchema }),
  updatePayoutMethod,
);

router.post(
  "/methods/:id/trigger",
  authenticate,
  validate({ params: payoutMethodParamsSchema }),
  triggerManualPayout,
);

router.get(
  "/history",
  authenticate,
  validate({ query: listPayoutHistoryQuerySchema }),
  getPayoutHistory,
);

router.get("/stats", authenticate, getPayoutStats);

// Admin endpoints
router.get(
  "/admin/users/:driverId/methods",
  authenticate,
  requirePermission("users", "read"),
  validate({ params: payoutAdminDriverIdParamsSchema }),
  adminListPayoutMethods,
);

router.get(
  "/admin/history",
  authenticate,
  requirePermission("payouts", "read"),
  validate({ query: listPayoutHistoryQuerySchema }),
  adminListPayoutHistory,
);

router.get(
  "/admin/users/:driverId/history",
  authenticate,
  requirePermission("payouts", "read"),
  validate({
    params: payoutAdminDriverIdParamsSchema,
    query: listPayoutHistoryQuerySchema,
  }),
  adminListPayoutHistory,
);

router.post(
  "/admin/users/:driverId/trigger",
  authenticate,
  requirePermission("payouts", "update"),
  validate({ params: payoutAdminDriverIdParamsSchema }),
  adminTriggerPayout,
);

router.get(
  "/admin/users/:driverId/stats",
  authenticate,
  requirePermission("payouts", "read"),
  validate({ params: payoutAdminDriverIdParamsSchema }),
  adminGetPayoutStats,
);

export default router;
