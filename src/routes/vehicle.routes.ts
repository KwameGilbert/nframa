import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireSelfOrPermission } from "../middlewares/authorize.js";
import { uploadImageFields } from "../middlewares/upload.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  VEHICLE_PHOTO_SIDES,
  createVehicleSchema,
  updateVehicleSchema,
  vehiclePhotoParamsSchema,
  type CreateVehicleInput,
} from "../schemas/vehicle.schema.js";
import {
  createVehicle,
  getVehicle,
  replaceVehiclePhoto,
  updateVehicle,
} from "../controllers/vehicle.controller.js";

export const vehicleRouter = Router();

// Multipart: the details as form fields and one photo per side, parsed before validate() (express.json() skips
// multipart bodies). The photos stay in memory until the controller uploads them, after the permission check.
vehicleRouter.post(
  "/vehicles",
  authenticate,
  uploadImageFields(VEHICLE_PHOTO_SIDES),
  validate({ body: createVehicleSchema }),
  requireSelfOrPermission(
    (req) => (req.validated.body as CreateVehicleInput).carOwnerUserId,
    "users",
    "create",
  ),
  createVehicle,
);

// The owner is only known once the vehicle is loaded, so the controller checks it.
vehicleRouter.get("/vehicles/:id", authenticate, validate({ params: idParamsSchema }), getVehicle);

vehicleRouter.patch(
  "/vehicles/:id",
  authenticate,
  validate({ params: idParamsSchema, body: updateVehicleSchema }),
  updateVehicle,
);

vehicleRouter.put(
  "/vehicles/:id/photos/:side",
  authenticate,
  uploadImageFields(["photo"]),
  validate({ params: vehiclePhotoParamsSchema }),
  replaceVehiclePhoto,
);
