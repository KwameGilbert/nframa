import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { vehicleModel, type VehiclePhotos } from "../models/vehicle.model.js";
import { assertSelfOrPermission } from "../middlewares/authorize.js";
import { logActivity } from "../services/activityLog.service.js";
import { deleteFile, uploadFile, type UploadedFile } from "../services/storage.service.js";
import { AppError } from "../utils/AppError.js";
import { sendCreated, sendSuccess } from "../utils/response.js";
import {
  VEHICLE_PHOTO_SIDES,
  type CreateVehicleInput,
  type UpdateVehicleInput,
  type VehiclePhotoSide,
} from "../schemas/vehicle.schema.js";

// Loads the vehicle and checks the caller owns it (or has the admin permission) — the owner isn't in the
// request, so this can't be done in route middleware.
async function findVehicleFor(req: Request, id: string, action: "read" | "update") {
  const vehicle = await vehicleModel.findById(id);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }
  await assertSelfOrPermission(req, vehicle.carOwnerUserId, "users", action);

  return vehicle;
}

const VEHICLE_ACTIVITY = { module: "vehicles", targetType: "vehicle" } as const;

const photoFiles = (req: Request) =>
  (req.files ?? {}) as Partial<Record<string, Express.Multer.File[]>>;

function uploadPhoto(vehicleId: string, file: Express.Multer.File) {
  return uploadFile(file.buffer, `vehicles/${vehicleId}`, file.originalname);
}

// Best effort: a leftover file costs storage, never correctness.
function discard(storageKeys: (string | undefined)[]) {
  return Promise.allSettled(storageKeys.filter(Boolean).map((key) => deleteFile(key!)));
}

export async function createVehicle(req: Request, res: Response) {
  const input = req.validated.body as CreateVehicleInput;
  const files = photoFiles(req);
  const missing = VEHICLE_PHOTO_SIDES.filter((side) => !files[side]?.[0]);
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Add a photo of each side of the vehicle; missing: ${missing.join(", ")}`,
    );
  }

  // The photos go up before the row is written; if anything fails they are taken down again.
  const id = randomUUID();
  const results = await Promise.allSettled(
    VEHICLE_PHOTO_SIDES.map((side) => uploadPhoto(id, files[side]![0])),
  );
  const uploaded = results.map((r) => (r.status === "fulfilled" ? r.value : undefined));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) {
    await discard(uploaded.map((u) => u?.storageKey));
    throw failed.reason;
  }
  const bySide = (pick: (u: UploadedFile) => string) =>
    Object.fromEntries(
      VEHICLE_PHOTO_SIDES.map((side, i) => [side, pick(uploaded[i]!)]),
    ) as VehiclePhotos;

  let vehicle;
  try {
    vehicle = await vehicleModel.createVehicle({
      ...input,
      id,
      photos: bySide((u) => u.fileUrl),
      photoKeys: bySide((u) => u.storageKey),
    });
  } catch (err) {
    await discard(uploaded.map((u) => u?.storageKey));
    throw err;
  }

  sendCreated(res, "Vehicle created successfully", vehicle);

  logActivity(req, {
    ...VEHICLE_ACTIVITY,
    action: "vehicle.create",
    description: "Added a vehicle",
    targetId: vehicle.id,
    after: vehicle,
  });
}

export async function getVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };

  const vehicle = await findVehicleFor(req, id, "read");

  sendSuccess(res, "Vehicle retrieved successfully", vehicle);
}

export async function updateVehicle(req: Request, res: Response) {
  const { id } = req.validated.params as { id: string };
  const input = req.validated.body as UpdateVehicleInput;

  const existing = await findVehicleFor(req, id, "update");
  const vehicle = await vehicleModel.updateVehicle(id, input);

  if (!vehicle) {
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, "Vehicle updated successfully", vehicle);

  logActivity(req, {
    ...VEHICLE_ACTIVITY,
    action: "vehicle.update",
    description: "Updated a vehicle",
    targetId: id,
    before: existing,
    after: vehicle,
  });
}

export async function replaceVehiclePhoto(req: Request, res: Response) {
  const { id, side } = req.validated.params as { id: string; side: VehiclePhotoSide };
  const file = photoFiles(req).photo?.[0];
  if (!file) {
    throw AppError.badRequest("Send the new photo as multipart/form-data under the 'photo' field");
  }

  const existing = await findVehicleFor(req, id, "update");
  const photo = await uploadPhoto(id, file);
  let result;
  try {
    result = await vehicleModel.replacePhoto(id, side, photo);
  } catch (err) {
    await discard([photo.storageKey]);
    throw err;
  }
  if (!result) {
    await discard([photo.storageKey]);
    throw AppError.notFound(`Vehicle not found: ${id}`);
  }

  sendSuccess(res, "Vehicle photo replaced successfully", result.vehicle);

  void discard([result.replacedKey]);
  logActivity(req, {
    ...VEHICLE_ACTIVITY,
    action: "vehicle.photo",
    description: `Replaced the vehicle's ${side} photo`,
    targetId: id,
    before: existing,
    after: result.vehicle,
  });
}
