import { Router } from "express";
import { healthRouter } from "./health.routes.js";
import { userRouter } from "./user.routes.js";
import { driverProfileRouter } from "./driverProfile.routes.js";
import { riderProfileRouter } from "./riderProfile.routes.js";
import { vehicleRouter } from "./vehicle.routes.js";
import { roleRouter } from "./role.routes.js";
import { adminUserRouter } from "./adminUser.routes.js";
import { authRouter } from "./auth.routes.js";
import { docsRouter } from "./docs.routes.js";

export const router = Router();

router.use(healthRouter);
router.use(userRouter);
router.use(driverProfileRouter);
router.use(riderProfileRouter);
router.use(vehicleRouter);
router.use(roleRouter);
router.use(adminUserRouter);
router.use(authRouter);
router.use(docsRouter);
