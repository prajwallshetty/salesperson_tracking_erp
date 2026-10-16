import { describe, it, expect } from 'vitest';
import { calculateHaversineDistanceMeters, calculatePathDistanceKm, isValidCoordinate } from '@/lib/domain/geo';

describe('geo', () => {
  it('computes haversine distance in metres', () => {
    expect(calculateHaversineDistanceMeters(12.87, 74.842, 12.87, 74.842)).toBe(0);
    // ~1 degree of latitude ≈ 111.2 km
    expect(calculateHaversineDistanceMeters(12, 74, 13, 74)).toBeGreaterThan(111000);
    expect(calculateHaversineDistanceMeters(12, 74, 13, 74)).toBeLessThan(111400);
  });

  it('validates coordinate ranges', () => {
    expect(isValidCoordinate(12.9, 74.8)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(NaN, 0)).toBe(false);
  });

  it('path distance skips low-accuracy fixes and implausible jumps', () => {
    const base = { latitude: 12.87, longitude: 74.84 };
    const near = { latitude: 12.871, longitude: 74.84 };
    expect(calculatePathDistanceKm([base, near])).toBeCloseTo(0.11, 2);
    expect(calculatePathDistanceKm([base, { ...near, accuracy: 500 }])).toBe(0);
    expect(calculatePathDistanceKm([base, { latitude: 22.5, longitude: 88.3 }])).toBe(0);
    expect(calculatePathDistanceKm([base])).toBe(0);
  });
});
