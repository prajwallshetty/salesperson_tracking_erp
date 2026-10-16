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

/**
 * Calculate total path distance from a chronological list of coordinates,
 * skipping noisy/implausible jumps (e.g. speed > 160 km/h or accuracy > maxAccuracy)
 */
export function calculatePathDistanceKm(
  points: Array<{ latitude: number; longitude: number; accuracy?: number | null; timestamp?: string | Date }>
): number {
  if (points.length < 2) return 0;

  let totalMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];

    if (!isValidCoordinate(p1.latitude, p1.longitude) || !isValidCoordinate(p2.latitude, p2.longitude)) {
      continue;
    }

    // Skip low-accuracy jumps if accuracy is above 150m
    if ((p1.accuracy && p1.accuracy > 150) || (p2.accuracy && p2.accuracy > 150)) {
      continue;
    }

    const dist = calculateHaversineDistanceMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

    // Filter out implausible jumps (>50km single jump in one point interval)
    if (dist < 50000) {
      totalMeters += dist;
    }
  }

  return Number((totalMeters / 1000).toFixed(2));
}
