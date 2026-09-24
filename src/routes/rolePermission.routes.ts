import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireRole } from "../middlewares/authorize.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  createRolePermissionSchema,
  updateRolePermissionSchema,
  roleIdParamsSchema,
} from "../schemas/rolePermission.schema.js";
import {
  createRolePermission,
  getRolePermission,
  updateRolePermission,
  listRolePermissions,
} from "../controllers/rolePermission.controller.js";

export const rolePermissionRouter = Router();

rolePermissionRouter.post(
  "/role-permissions",
  authenticate,
  requireRole("admin"),
  validate({ body: createRolePermissionSchema }),
  createRolePermission,
);

rolePermissionRouter.get(
  "/role-permissions/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParamsSchema }),
  getRolePermission,
);

rolePermissionRouter.patch(
  "/role-permissions/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParamsSchema, body: updateRolePermissionSchema }),
  updateRolePermission,
);

rolePermissionRouter.get(
  "/roles/:roleId/permissions",
  authenticate,
  requireRole("admin"),
  validate({ params: roleIdParamsSchema }),
  listRolePermissions,
);
