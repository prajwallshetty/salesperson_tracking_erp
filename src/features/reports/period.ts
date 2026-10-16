import { businessDateString, startOfBusinessDate, startOfBusinessDay, endOfBusinessDate, toBusinessDateString } from '@/lib/time';

export function performancePeriod(range: string, from?: string | null, to?: string | null, now = new Date()) {
  const todayYmd = businessDateString(now);
  let start = startOfBusinessDay(now);
  let end = now;
  if (range === 'this_week') {
    const [y, m, d] = todayYmd.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
    const monday = new Date(Date.UTC(y, m - 1, d - (dow === 0 ? 6 : dow - 1)));
    start = startOfBusinessDate(monday.toISOString().slice(0, 10));
  } else if (range === 'this_month') {
    start = startOfBusinessDate(`${todayYmd.slice(0, 7)}-01`);
  } else if (range === 'all_time') {
    start = new Date(0);
  } else if (range === 'custom' && from && to) {
    start = startOfBusinessDate(toBusinessDateString(from));
    end = endOfBusinessDate(toBusinessDateString(to));
  }
  return { start, end };
}
