import { Router } from "express";
import { validate } from "../middlewares/validate.js";
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

adminUserRouter.post("/admin", validate({ body: createAdminUserSchema }), createAdminUser);
adminUserRouter.get("/admin/:userId", validate({ params: adminUserParamsSchema }), getAdminUser);
adminUserRouter.patch(
  "/admin/:userId",
  validate({ params: adminUserParamsSchema, body: updateAdminUserSchema }),
  updateAdminUser,
);
