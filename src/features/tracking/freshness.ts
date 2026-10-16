export function formatFreshness(timestamp: Date | null | undefined): { minutesAgo: number | null; label: string } {
  if (!timestamp) return { minutesAgo: null, label: 'No GPS recorded' };
  const minutesAgo = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutesAgo < 1) return { minutesAgo, label: 'Just now' };
  if (minutesAgo === 1) return { minutesAgo, label: '1 min ago' };
  if (minutesAgo < 60) return { minutesAgo, label: `${minutesAgo} mins ago` };
  if (minutesAgo < 60 * 24) return { minutesAgo, label: `${Math.floor(minutesAgo / 60)}h ago` };
  return { minutesAgo, label: `${Math.floor(minutesAgo / 1440)}d ago` };
}
