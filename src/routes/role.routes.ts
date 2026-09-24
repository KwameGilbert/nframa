import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRoleSchema, updateRoleSchema } from "../schemas/role.schema.js";
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/role.controller.js";

export const roleRouter = Router();

roleRouter.get("/roles", authenticate, requirePermission("roles", "read"), listRoles);

roleRouter.post(
  "/roles",
  authenticate,
  requirePermission("roles", "create"),
  validate({ body: createRoleSchema }),
  createRole,
);

roleRouter.get(
  "/roles/:id",
  authenticate,
  requirePermission("roles", "read"),
  validate({ params: idParamsSchema }),
  getRole,
);

roleRouter.patch(
  "/roles/:id",
  authenticate,
  requirePermission("roles", "update"),
  validate({ params: idParamsSchema, body: updateRoleSchema }),
  updateRole,
);

roleRouter.delete(
  "/roles/:id",
  authenticate,
  requirePermission("roles", "delete"),
  validate({ params: idParamsSchema }),
  deleteRole,
);
