import { Router } from "express";
import { healthRouter } from "./health.routes.js";
import { userRouter } from "./user.routes.js";
import { driverProfileRouter } from "./driverProfile.routes.js";
import { riderProfileRouter } from "./riderProfile.routes.js";
import { vehicleRouter } from "./vehicle.routes.js";
import { roleRouter } from "./role.routes.js";
import { rolePermissionRouter } from "./rolePermission.routes.js";
import { adminUserRouter } from "./adminUser.routes.js";
import { settingRouter } from "./setting.routes.js";
import { authRouter } from "./auth.routes.js";
import { verificationRouter } from "./verification.routes.js";
import { docsRouter } from "./docs.routes.js";

export const router = Router();

router.use(healthRouter);
router.use(userRouter);
router.use(driverProfileRouter);
router.use(riderProfileRouter);
router.use(vehicleRouter);
router.use(roleRouter);
router.use(rolePermissionRouter);
router.use(adminUserRouter);
router.use(settingRouter);
router.use(authRouter);
router.use(verificationRouter);
router.use(docsRouter);
