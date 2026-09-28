import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { createUserSchema, updateUserSchema, userIdParamsSchema } from "../schemas/user.schema.js";
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
} from "../controllers/user.controller.js";

export const userRouter = Router();

// Riders and drivers only (see findAllRidersAndDrivers) — admins are listed via GET /admin instead.
userRouter.get("/users", authenticate, requirePermission("users", "read"), listUsers);

// Permission checks are in the controller: which module applies (users vs admin) depends on
// whether the target account is an admin, which is only known from the body or the loaded user.
userRouter.post("/users", authenticate, validate({ body: createUserSchema }), createUser);

userRouter.get("/users/:id", authenticate, validate({ params: userIdParamsSchema }), getUser);

userRouter.patch(
  "/users/:id",
  authenticate,
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  updateUser,
);

userRouter.delete("/users/:id", authenticate, validate({ params: userIdParamsSchema }), deleteUser);
