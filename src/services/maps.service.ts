import { createLogger } from "../config/logger.js";
import { settingModel } from "../models/setting.model.js";
import { haversineMeters, type Point } from "./geo.js";
import { getGoogleRoute } from "./google.service.js";

const log = createLogger("app");

export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  source: "google" | "haversine";
}

// Google's driving route when GOOGLE_MAPS_API_KEY is set and the call works; otherwise the straight-line
// distance, with the duration estimated at trips.fallbackSpeedKmh.
export async function getRoute(origin: Point, destination: Point): Promise<Route> {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      return { ...(await getGoogleRoute(origin, destination)), source: "google" };
    } catch (err) {
      log.warn({ err }, "Google Directions failed, falling back to straight-line distance");
    }
  }

  const speedKmh = await settingModel.getValue("trips.fallbackSpeedKmh");
  const distanceMeters = Math.round(haversineMeters(origin, destination));

  return {
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / 1000 / (speedKmh / 3600)),
    source: "haversine",
  };
}

// The driving route from a commute's start to its end, as the two columns the commute stores.
export async function commuteRoute(c: {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}) {
  const { distanceMeters, durationSeconds } = await getRoute(
    { lat: c.startLat, lng: c.startLng },
    { lat: c.endLat, lng: c.endLng },
  );

  return { distanceMeters, durationSeconds };
}
