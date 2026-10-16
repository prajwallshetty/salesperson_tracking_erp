import { Response } from 'express';

export function sendCsvResponse(
  res: Response,
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const escapeCsv = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCsv).join(',');
  const rowLines = rows.map((r) => r.map(escapeCsv).join(','));

  const csvContent = [headerLine, ...rowLines].join('\n');
  res.send(csvContent);
}
