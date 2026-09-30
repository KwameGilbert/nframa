import type { Point } from "./geo.js";

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const TIMEOUT_MS = 5000;

interface DirectionsResponse {
  status: string;
  error_message?: string;
  routes?: { legs?: { distance: { value: number }; duration: { value: number } }[] }[];
}

// Google Directions driving distance and duration. Throws on anything but a usable route, so the caller can
// fall back. This is the only file that knows Google's API.
export async function getGoogleRoute(origin: Point, destination: Point) {
  const url = new URL(DIRECTIONS_URL);
  url.search = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: "driving",
    key: process.env.GOOGLE_MAPS_API_KEY ?? "",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Google Directions responded ${res.status}`);
  }

  const body = (await res.json()) as DirectionsResponse;
  const leg = body.routes?.[0]?.legs?.[0];
  if (body.status !== "OK" || !leg) {
    throw new Error(
      `Google Directions: ${body.status}${body.error_message ? ` (${body.error_message})` : ""}`,
    );
  }

  return { distanceMeters: leg.distance.value, durationSeconds: leg.duration.value };
}
