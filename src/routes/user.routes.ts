import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requirePermission } from "../middlewares/authorize.js";
import { uploadSingleFile } from "../middlewares/upload.js";
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamsSchema,
} from "../schemas/user.schema.js";
import { userActivityLogsQuerySchema } from "../schemas/activityLog.schema.js";
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  updateUserStatus,
  getUserStatusHistory,
  getUserActivityLogs,
  deleteUser,
} from "../controllers/user.controller.js";

export const userRouter = Router();

// Riders and drivers only (see findAllRidersAndDrivers) — admins are listed via GET /admin instead.
userRouter.get("/users", authenticate, requirePermission("users", "read"), listUsers);

// Permission checks are in the controller: which module applies (users vs admin) depends on
// whether the target account is an admin, which is only known from the body or the loaded user.
userRouter.post("/users", authenticate, validate({ body: createUserSchema }), createUser);

userRouter.get("/users/:id", authenticate, validate({ params: userIdParamsSchema }), getUser);

// Supports both file upload (multipart with profilePicture field) and JSON with base64
// For multipart: Content-Type: multipart/form-data, field name "profilePicture"
// For base64 JSON: Content-Type: application/json, body: { profilePicture: "data:image/png;base64,..." }
userRouter.patch(
  "/users/:id",
  authenticate,
  uploadSingleFile("profilePicture"),
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  updateUser,
);

// Permission is checked in the controller, same reason as POST /users above.
userRouter.patch(
  "/users/:id/status",
  authenticate,
  validate({ params: userIdParamsSchema, body: updateUserStatusSchema }),
  updateUserStatus,
);

userRouter.get(
  "/users/:id/status-history",
  authenticate,
  validate({ params: userIdParamsSchema }),
  getUserStatusHistory,
);

// Fixed permission (unlike the routes above, it doesn't depend on the target's role), so checked here
// rather than in the controller — same as GET /admin/activity-logs.
userRouter.get(
  "/users/:id/activity-logs",
  authenticate,
  requirePermission("activityLogs", "read"),
  validate({ params: userIdParamsSchema, query: userActivityLogsQuerySchema }),
  getUserActivityLogs,
);

userRouter.delete("/users/:id", authenticate, validate({ params: userIdParamsSchema }), deleteUser);
