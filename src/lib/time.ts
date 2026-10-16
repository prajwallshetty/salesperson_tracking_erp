/**
 * Business-timezone date helpers.
 *
 * The legacy API used `new Date().setHours(0,0,0,0)` — i.e. the *server's* local midnight —
 * which is wrong when the host runs in UTC but the business operates in Asia/Kolkata.
 * These helpers compute day boundaries in the configured business timezone.
 */

export const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function businessDateString(date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** UTC instant of 00:00 on the given business calendar date (YYYY-MM-DD). */
export function startOfBusinessDate(ymd: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Two passes handle DST transitions for zones that have them.
  let result = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  result = new Date(guess.getTime() - zoneOffsetMs(result, timeZone));
  return result;
}

/** UTC instant of 23:59:59.999 on the given business calendar date. */
export function endOfBusinessDate(ymd: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = next.toISOString().slice(0, 10);
  return new Date(startOfBusinessDate(nextYmd, timeZone).getTime() - 1);
}

/** Start of "today" in the business timezone. */
export function startOfBusinessDay(now: Date = new Date(), timeZone = DEFAULT_TIMEZONE): Date {
  return startOfBusinessDate(businessDateString(now, timeZone), timeZone);
}

/**
 * Value for a Prisma `@db.Date` column representing the business date.
 * Prisma persists the UTC calendar date of the Date object, so use UTC midnight.
 */
export function businessDateValue(now: Date = new Date(), timeZone = DEFAULT_TIMEZONE): Date {
  return new Date(`${businessDateString(now, timeZone)}T00:00:00.000Z`);
}

/** Accepts `YYYY-MM-DD` or an ISO timestamp and returns the business calendar date. */
export function toBusinessDateString(input: string, timeZone = DEFAULT_TIMEZONE): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return businessDateString(d, timeZone);
}

/** Parses an inclusive `from`/`to` range of business dates into instants. Invalid values are ignored. */
export function parseDateRange(from?: string | null, to?: string | null, timeZone = DEFAULT_TIMEZONE) {
  const range: { gte?: Date; lte?: Date } = {};
  try {
    if (from) range.gte = startOfBusinessDate(toBusinessDateString(from, timeZone), timeZone);
  } catch {
    /* ignore invalid */
  }
  try {
    if (to) range.lte = endOfBusinessDate(toBusinessDateString(to, timeZone), timeZone);
  } catch {
    /* ignore invalid */
  }
  return Object.keys(range).length ? range : undefined;
}

/** Same as parseDateRange but for `@db.Date` columns (UTC-midnight date values). */
export function parseDateOnlyRange(from?: string | null, to?: string | null, timeZone = DEFAULT_TIMEZONE) {
  const range: { gte?: Date; lte?: Date } = {};
  try {
    if (from) range.gte = new Date(`${toBusinessDateString(from, timeZone)}T00:00:00.000Z`);
  } catch {
    /* ignore invalid */
  }
  try {
    if (to) range.lte = new Date(`${toBusinessDateString(to, timeZone)}T00:00:00.000Z`);
  } catch {
    /* ignore invalid */
  }
  return Object.keys(range).length ? range : undefined;
}
