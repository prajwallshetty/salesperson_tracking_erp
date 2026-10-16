import { describe, it, expect } from 'vitest';
import { businessDateString, businessDateValue, endOfBusinessDate, parseDateRange, startOfBusinessDate, startOfBusinessDay } from '@/lib/time';

describe('business timezone helpers (Asia/Kolkata, UTC+5:30)', () => {
  const tz = 'Asia/Kolkata';

  it('maps instants to the IST calendar date', () => {
    // 20:00 UTC on Jan 1 is 01:30 IST on Jan 2.
    expect(businessDateString(new Date('2026-01-01T20:00:00Z'), tz)).toBe('2026-01-02');
    expect(businessDateString(new Date('2026-01-01T18:00:00Z'), tz)).toBe('2026-01-01');
  });

  it('computes IST midnight as a UTC instant', () => {
    expect(startOfBusinessDate('2026-01-02', tz).toISOString()).toBe('2026-01-01T18:30:00.000Z');
    expect(endOfBusinessDate('2026-01-02', tz).toISOString()).toBe('2026-01-02T18:29:59.999Z');
    expect(startOfBusinessDay(new Date('2026-01-01T20:00:00Z'), tz).toISOString()).toBe('2026-01-01T18:30:00.000Z');
  });

  it('produces @db.Date values at UTC midnight of the business date', () => {
    expect(businessDateValue(new Date('2026-01-01T20:00:00Z'), tz).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('handles DST zones', () => {
    // New York: 2026-03-08 is the spring-forward day; midnight is still EST (UTC-5).
    expect(startOfBusinessDate('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfBusinessDate('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('parses inclusive ranges and ignores garbage', () => {
    const r = parseDateRange('2026-01-01', '2026-01-31', tz)!;
    expect(r.gte!.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(r.lte!.toISOString()).toBe('2026-01-31T18:29:59.999Z');
    expect(parseDateRange('not-a-date', null, tz)).toBeUndefined();
  });
});
