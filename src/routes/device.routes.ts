import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { deviceLimit } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";
import { getVapidKey, registerDevice, unregisterDevice } from "../controllers/device.controller.js";
import { registerDeviceSchema, unregisterDeviceSchema } from "../schemas/device.schema.js";

export const deviceRouter = Router();

// authenticate only: a device is registered to, and removed from, the caller's own account. Unregister is a POST
// with the token in the body because tokens must never sit in a URL (or the access logs that record URLs).
deviceRouter.post(
  "/devices",
  authenticate,
  deviceLimit,
  validate({ body: registerDeviceSchema }),
  registerDevice,
);

deviceRouter.post(
  "/devices/unregister",
  authenticate,
  deviceLimit,
  validate({ body: unregisterDeviceSchema }),
  unregisterDevice,
);

deviceRouter.get("/push/vapid-key", authenticate, getVapidKey);
