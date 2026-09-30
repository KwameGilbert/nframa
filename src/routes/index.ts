import { Router } from "express";
import { healthRouter } from "./health.routes.js";
import { userRouter } from "./user.routes.js";
import { driverProfileRouter } from "./driverProfile.routes.js";
import { savedCommuteRouter } from "./savedCommute.routes.js";
import { riderProfileRouter } from "./riderProfile.routes.js";
import { vehicleRouter } from "./vehicle.routes.js";
import { roleRouter } from "./role.routes.js";
import { rolePermissionRouter } from "./rolePermission.routes.js";
import { adminUserRouter } from "./adminUser.routes.js";
import { settingRouter } from "./setting.routes.js";
import { authRouter } from "./auth.routes.js";
import { verificationRouter } from "./verification.routes.js";
import { docsRouter } from "./docs.routes.js";
import { activityLogRouter } from "./activityLog.routes.js";

export const router = Router();

router.use(healthRouter);
// Before adminUserRouter: GET /admin/:userId would otherwise match "/admin/activity-logs" and 400 it.
router.use(activityLogRouter);
router.use(userRouter);
// Before driverProfileRouter: GET/POST /driver/:userId would otherwise match "/driver/verification..."
// first (same segment count, registered-order wins), 400ing every verification-document request.
router.use(verificationRouter);
router.use(driverProfileRouter);
router.use(savedCommuteRouter);
router.use(riderProfileRouter);
router.use(vehicleRouter);
router.use(roleRouter);
router.use(rolePermissionRouter);
router.use(adminUserRouter);
router.use(settingRouter);
router.use(authRouter);
router.use(docsRouter);
