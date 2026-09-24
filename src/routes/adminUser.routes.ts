import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  adminUserParamsSchema,
} from "../schemas/adminUser.schema.js";
import {
  createAdminUser,
  getAdminUser,
  updateAdminUser,
  deleteAdminUser,
} from "../controllers/adminUser.controller.js";

export const adminUserRouter = Router();

adminUserRouter.post(
  "/admin",
  authenticate,
  requirePermission("roles", "create"),
  validate({ body: createAdminUserSchema }),
  createAdminUser,
);

adminUserRouter.get(
  "/admin/:userId",
  authenticate,
  requirePermission("roles", "read"),
  validate({ params: adminUserParamsSchema }),
  getAdminUser,
);

adminUserRouter.patch(
  "/admin/:userId",
  authenticate,
  requirePermission("roles", "update"),
  validate({ params: adminUserParamsSchema, body: updateAdminUserSchema }),
  updateAdminUser,
);

adminUserRouter.delete(
  "/admin/:userId",
  authenticate,
  requirePermission("roles", "delete"),
  validate({ params: adminUserParamsSchema }),
  deleteAdminUser,
);
