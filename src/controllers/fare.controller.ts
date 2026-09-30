import type { Request, Response } from "express";
import { calculateFare, getFareSettings } from "../services/fare.service.js";
import { getRoute } from "../services/maps.service.js";
import { sendSuccess } from "../utils/response.js";
import type { EstimateFareInput } from "../schemas/fare.schema.js";

export async function estimateFare(req: Request, res: Response) {
  const { pickup, dropoff, waitMinutes } = req.validated.body as EstimateFareInput;

  const [route, settings] = await Promise.all([getRoute(pickup, dropoff), getFareSettings()]);
  const { currency, ...breakdown } = calculateFare({ ...route, waitMinutes }, settings);

  sendSuccess(res, "Fare estimated successfully", {
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    routeSource: route.source,
    currency,
    breakdown,
  });
}
