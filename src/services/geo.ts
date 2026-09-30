export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle distance in meters.
export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Where a point's projection falls along start->end, as a fraction clamped to 0..1. Uses a flat local plane
// (longitude scaled by cos(latitude)), which is accurate over the distances of a single commute.
export function progressAlong(point: Point, start: Point, end: Point): number {
  const cos = Math.cos(toRadians(start.lat));
  const dx = (end.lng - start.lng) * cos;
  const dy = end.lat - start.lat;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;

  const t = ((point.lng - start.lng) * cos * dx + (point.lat - start.lat) * dy) / lengthSquared;
  return Math.min(1, Math.max(0, t));
}

// Distance in meters from a point to the closest spot on the segment start->end.
export function distanceToSegmentMeters(point: Point, start: Point, end: Point): number {
  const t = progressAlong(point, start, end);
  const closest = {
    lat: start.lat + (end.lat - start.lat) * t,
    lng: start.lng + (end.lng - start.lng) * t,
  };

  return haversineMeters(point, closest);
}
