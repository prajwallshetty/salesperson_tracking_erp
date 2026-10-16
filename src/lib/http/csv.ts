type Cell = string | number | boolean | null | undefined;

const escapeCsv = (val: Cell) => {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // Neutralise spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(str) && typeof val === 'string') str = `'${str}`;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
}

export function csvResponse(filename: string, headers: string[], rows: Cell[][]): Response {
  return new Response(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
