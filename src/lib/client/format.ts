const TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata';

export const inr = (n: unknown, digits = 0) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;

/** "Just now", "4 min ago", "3 h ago", "2 d ago". */
export function formatAge(ts: string | number | Date | null | undefined, now = Date.now()): string {
  if (!ts) return 'Never';
  const mins = Math.floor((now - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
}

export const formatDate = (d: string | Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, ...opts });

export const formatTime = (d: string | Date) => new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (d: string | Date) => new Date(d).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');

/** Today's calendar date (YYYY-MM-DD) in the business timezone — not the UTC date. */
export const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
