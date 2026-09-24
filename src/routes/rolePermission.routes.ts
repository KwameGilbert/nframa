import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  roleModuleParamsSchema,
  setModulePermissionSchema,
} from "../schemas/rolePermission.schema.js";
import {
  getRolePermissions,
  setRoleModulePermission,
  removeRoleModulePermission,
} from "../controllers/rolePermission.controller.js";

export const rolePermissionRouter = Router();

rolePermissionRouter.get(
  "/roles/:id/permissions",
  authenticate,
  requirePermission("roles", "read"),
  validate({ params: idParamsSchema }),
  getRolePermissions,
);

rolePermissionRouter.put(
  "/roles/:id/permissions/:module",
  authenticate,
  requirePermission("roles", "update"),
  validate({ params: roleModuleParamsSchema, body: setModulePermissionSchema }),
  setRoleModulePermission,
);

rolePermissionRouter.delete(
  "/roles/:id/permissions/:module",
  authenticate,
  requirePermission("roles", "update"),
  validate({ params: roleModuleParamsSchema }),
  removeRoleModulePermission,
);
