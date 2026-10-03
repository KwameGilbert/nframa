import { Router } from "express";
import { healthRouter } from "./health.routes.js";
import { userRouter } from "./user.routes.js";
import { driverProfileRouter } from "./driverProfile.routes.js";
import { driverCommuteRouter } from "./driverCommute.routes.js";
import { emergencyContactRouter } from "./emergencyContact.routes.js";
import { sosIncidentRouter } from "./sosIncident.routes.js";
import { reviewRouter } from "./review.routes.js";
import { riderProfileRouter } from "./riderProfile.routes.js";
import { vehicleRouter } from "./vehicle.routes.js";
import { roleRouter } from "./role.routes.js";
import { rolePermissionRouter } from "./rolePermission.routes.js";
import { adminUserRouter } from "./adminUser.routes.js";
import { settingRouter } from "./setting.routes.js";
import { authRouter } from "./auth.routes.js";
import { verificationRouter } from "./verification.routes.js";
import { fareRouter } from "./fare.routes.js";
import { walletRouter } from "./wallet.routes.js";
import { tripRouter } from "./trip.routes.js";
import { docsRouter } from "./docs.routes.js";
import { activityLogRouter } from "./activityLog.routes.js";
import { paymentMethodRouter } from "./paymentMethod.routes.js";
import { payoutRouter } from "./payout.routes.js";

export const router = Router();

router.use(healthRouter);
// Before adminUserRouter: GET /admin/:userId would otherwise match "/admin/activity-logs", "/admin/trips", etc.
router.use(activityLogRouter);
router.use(tripRouter);
router.use(userRouter);
// Before driverProfileRouter: GET/POST /driver/:userId would otherwise match "/driver/verification..."
// first (same segment count, registered-order wins), 400ing every verification-document request.
router.use(verificationRouter);
router.use(driverProfileRouter);
router.use(driverCommuteRouter);
router.use(emergencyContactRouter);
router.use(sosIncidentRouter);
router.use(reviewRouter);
router.use(riderProfileRouter);
router.use(vehicleRouter);
router.use(roleRouter);
router.use(rolePermissionRouter);
// Before adminUserRouter: GET /admin/:userId would otherwise match "/admin/payment-methods" and "/admin/payout-methods".
router.use(paymentMethodRouter);
router.use(payoutRouter);
router.use(adminUserRouter);
router.use(settingRouter);
router.use(fareRouter);
router.use(walletRouter);
router.use(authRouter);
router.use(docsRouter);
