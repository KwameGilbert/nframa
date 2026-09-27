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
  listAdminUsers,
  createAdminUser,
  getAdminUser,
  updateAdminUser,
  deleteAdminUser,
} from "../controllers/adminUser.controller.js";

export const adminUserRouter = Router();

adminUserRouter.get("/admin", authenticate, requirePermission("admin", "read"), listAdminUsers);

adminUserRouter.post(
  "/admin",
  authenticate,
  requirePermission("admin", "create"),
  validate({ body: createAdminUserSchema }),
  createAdminUser,
);

adminUserRouter.get(
  "/admin/:userId",
  authenticate,
  requirePermission("admin", "read"),
  validate({ params: adminUserParamsSchema }),
  getAdminUser,
);

adminUserRouter.patch(
  "/admin/:userId",
  authenticate,
  requirePermission("admin", "update"),
  validate({ params: adminUserParamsSchema, body: updateAdminUserSchema }),
  updateAdminUser,
);

adminUserRouter.delete(
  "/admin/:userId",
  authenticate,
  requirePermission("admin", "delete"),
  validate({ params: adminUserParamsSchema }),
  deleteAdminUser,
);
