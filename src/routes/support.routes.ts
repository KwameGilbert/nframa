import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { supportBrowseLimit } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";
import {
  adminListSupportCategories,
  createSupportCategory,
  deleteSupportCategory,
  listSupportCategories,
  updateSupportCategory,
} from "../controllers/supportCategory.controller.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createSupportCategorySchema,
  updateSupportCategorySchema,
} from "../schemas/supportCategory.schema.js";

export const supportRouter = Router();

// Riders and drivers.
supportRouter.get("/support/categories", authenticate, supportBrowseLimit, listSupportCategories);

// Staff.
supportRouter.get(
  "/admin/support/categories",
  authenticate,
  requirePermission("support", "read"),
  adminListSupportCategories,
);

supportRouter.post(
  "/admin/support/categories",
  authenticate,
  requirePermission("support", "create"),
  validate({ body: createSupportCategorySchema }),
  createSupportCategory,
);

supportRouter.patch(
  "/admin/support/categories/:id",
  authenticate,
  requirePermission("support", "update"),
  validate({ params: idParamsSchema, body: updateSupportCategorySchema }),
  updateSupportCategory,
);

supportRouter.delete(
  "/admin/support/categories/:id",
  authenticate,
  requirePermission("support", "delete"),
  validate({ params: idParamsSchema }),
  deleteSupportCategory,
);
