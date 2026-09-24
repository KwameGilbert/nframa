import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { ownerFromIdParam, requireRole, requireSelfOrAdmin } from "../middlewares/authorize.js";
import { createUserSchema, updateUserSchema, userIdParamsSchema } from "../schemas/user.schema.js";
import { createUser, getUser, updateUser } from "../controllers/user.controller.js";

export const userRouter = Router();

userRouter.post(
  "/users",
  authenticate,
  requireRole("admin"),
  validate({ body: createUserSchema }),
  createUser,
);

userRouter.get(
  "/users/:id",
  authenticate,
  validate({ params: userIdParamsSchema }),
  requireSelfOrAdmin(ownerFromIdParam),
  getUser,
);

userRouter.patch(
  "/users/:id",
  authenticate,
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  requireSelfOrAdmin(ownerFromIdParam),
  updateUser,
);
