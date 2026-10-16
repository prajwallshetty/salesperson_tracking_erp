import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { hasPermission } from '@/lib/permissions';
import { buildReport, REPORT_TYPES, type ReportType } from '@/features/reports/service';
import { csvResponse } from '@/lib/http/csv';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ type: string }>({ managerPermission: 'canViewReports' }, async ({ req, user, params }) => {
  if (!(REPORT_TYPES as readonly string[]).includes(params.type)) return json({ error: 'Unknown report type' }, 404);
  const sp = searchParams(req);
  const wantsCsv = sp.get('format') === 'csv';
  if (wantsCsv && user.role === 'MANAGER' && !hasPermission(user, 'canExportReports')) {
    return json({ error: 'Forbidden: Missing required permission [canExportReports]' }, 403);
  }
  const report = await buildReport(params.type as ReportType, user, sp);
  if (wantsCsv) return csvResponse(`${report.filePrefix}_${Date.now()}.csv`, report.csv.headers, report.csv.rows);
  return json(report.json);
});
