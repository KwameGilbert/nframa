import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireRole } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema } from "../schemas/role.schema.js";
import { createRole, getRole, updateRole } from "../controllers/role.controller.js";

export const roleRouter = Router();

roleRouter.post(
  "/roles",
  authenticate,
  requireRole("admin"),
  validate({ body: createRoleSchema }),
  createRole,
);

roleRouter.get(
  "/roles/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParamsSchema }),
  getRole,
);

roleRouter.patch(
  "/roles/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParamsSchema, body: updateRoleSchema }),
  updateRole,
);
