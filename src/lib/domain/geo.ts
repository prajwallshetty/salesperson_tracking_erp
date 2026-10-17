/**
 * Calculate distance between two GPS coordinates using the Haversine formula
 * @returns Distance in meters
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Calculate distance in Kilometers rounded to two decimal places
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const meters = calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2);
  return Number((meters / 1000).toFixed(2));
}

/**
 * Validate latitude and longitude range
 */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Gap between two consecutive fixes above which the route is considered interrupted (minutes). */
export const ROUTE_GAP_MINUTES = 15;
/** Movements smaller than this between consecutive fixes are treated as GPS drift, not travel. */
export const ROUTE_MIN_STEP_METERS = 5;
/** Steps implying more than this speed are impossible for a field visit and are not counted. */
export const ROUTE_MAX_SPEED_KMH = 140;
const ROUTE_MAX_ACCURACY_METERS = 150;
/** A single step this long is a bad fix, whatever the timestamps say. */
const ROUTE_MAX_STEP_METERS = 50_000;

type RoutePoint = { latitude: number; longitude: number; accuracy?: number | null; timestamp?: string | Date };

/**
 * Route distance from recorded GPS fixes — the single documented method used by the day summary,
 * route history, performance and reports:
 *
 *  1. Only fixes the device actually reported and the server accepted are used, in time order.
 *  2. The distance is the sum of Haversine (great-circle) distances between CONSECUTIVE fixes.
 *  3. A step is not counted when
 *       - either end has a reported accuracy worse than 150 m,
 *       - it is shorter than 5 m (stationary GPS drift),
 *       - the two fixes are more than 15 minutes apart — the route is interrupted there and no
 *         straight line is assumed across the gap (the gap's distance is simply unknown), or
 *       - it implies a speed above 140 km/h, or is longer than 50 km on its own (a bad fix).
 *  4. Because fixes are sampled (every 15–60 s), the result is an estimate that cuts corners and
 *     under-counts any travel inside a gap.
 */
export function calculateRouteDistanceMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!isValidCoordinate(a.latitude, a.longitude) || !isValidCoordinate(b.latitude, b.longitude)) continue;
    if ((a.accuracy && a.accuracy > ROUTE_MAX_ACCURACY_METERS) || (b.accuracy && b.accuracy > ROUTE_MAX_ACCURACY_METERS)) continue;
    const dist = calculateHaversineDistanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    if (dist < ROUTE_MIN_STEP_METERS || dist >= ROUTE_MAX_STEP_METERS) continue;
    if (a.timestamp && b.timestamp) {
      const secs = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
      if (secs > ROUTE_GAP_MINUTES * 60) continue;
      if (secs > 0 && (dist / secs) * 3.6 > ROUTE_MAX_SPEED_KMH) continue;
    }
    total += dist;
  }
  return total;
}

/** Route distance in kilometres (2 decimals); see {@link calculateRouteDistanceMeters}. */
export function calculatePathDistanceKm(points: RoutePoint[]): number {
  if (points.length < 2) return 0;
  return Number((calculateRouteDistanceMeters(points) / 1000).toFixed(2));
}
