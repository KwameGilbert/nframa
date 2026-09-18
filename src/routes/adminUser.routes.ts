import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireRole } from "../middlewares/authorize.js";
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  adminUserParamsSchema,
} from "../schemas/adminUser.schema.js";
import {
  createAdminUser,
  getAdminUser,
  updateAdminUser,
} from "../controllers/adminUser.controller.js";

export const adminUserRouter = Router();

adminUserRouter.post(
  "/admin",
  authenticate,
  requireRole("admin"),
  validate({ body: createAdminUserSchema }),
  createAdminUser,
);

adminUserRouter.get(
  "/admin/:userId",
  authenticate,
  requireRole("admin"),
  validate({ params: adminUserParamsSchema }),
  getAdminUser,
);

adminUserRouter.patch(
  "/admin/:userId",
  authenticate,
  requireRole("admin"),
  validate({ params: adminUserParamsSchema, body: updateAdminUserSchema }),
  updateAdminUser,
);
