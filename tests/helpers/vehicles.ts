import { VEHICLE_PHOTO_SIDES } from "../../src/schemas/vehicle.schema.js";
import { api, auth } from "./api.js";

// POST /vehicles the way the app does: the details as form fields and one photo per side (all four by default).
export function postVehicle(
  token: string,
  details: Record<string, unknown>,
  sides: readonly string[] = VEHICLE_PHOTO_SIDES,
) {
  let req = api.post("/vehicles").set(auth(token));
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) req = req.field(key, String(value));
  }
  for (const side of sides) {
    req = req.attach(side, Buffer.from(`${side} photo`), { filename: `${side}.jpg`, contentType: "image/jpeg" });
  }
  return req;
}
