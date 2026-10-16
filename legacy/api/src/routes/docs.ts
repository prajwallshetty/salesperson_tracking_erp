import { Router, Request, Response } from 'express';

const router = Router();

const apiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Salesperson Tracking & Sales Management ERP API',
    version: '1.0.0',
    description: 'REST API powering Next.js Admin Dashboard and React Native Field Sales Mobile App.',
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local Development Server' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        summary: 'Authenticate employee ID, email, or phone + password',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { identifier: { type: 'string' }, password: { type: 'string' }, deviceId: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'JWT token & user details' } },
      },
    },
    '/api/auth/me': { get: { summary: 'Get current user profile and role permissions' } },
    '/api/dashboard/summary': { get: { summary: 'Admin / Manager KPI metrics and chart trends' } },
    '/api/salespersons': { get: { summary: 'List salespersons' }, post: { summary: 'Create salesperson' } },
    '/api/salespersons/live-status': { get: { summary: 'Live duty status, battery, and speed of salespersons' } },
    '/api/salespersons/:id/performance': { get: { summary: 'Salesperson performance breakdown by date range' } },
    '/api/clients': { get: { summary: 'List clients (scoped by role)' }, post: { summary: 'Create new client' } },
    '/api/clients/:id': { get: { summary: 'Get client details with ledger and history' } },
    '/api/clients/:id/assign': { post: { summary: 'Assign primary and backup salesperson' } },
    '/api/products': { get: { summary: 'Search and list product catalog' }, post: { summary: 'Create product' } },
    '/api/orders': { get: { summary: 'List orders' }, post: { summary: 'Create new order' } },
    '/api/orders/:id/status': { put: { summary: 'Update order status & approval workflow' } },
    '/api/payments': { get: { summary: 'List payments' }, post: { summary: 'Collect payment' } },
    '/api/payments/:id/verify': { post: { summary: 'Verify or reject payment' } },
    '/api/payments/:id/receipt-pdf': { get: { summary: 'Download PDF receipt' } },
    '/api/attendance/start': { post: { summary: 'Start Day work session' } },
    '/api/attendance/end': { post: { summary: 'End Day work session and compute summary' } },
    '/api/location/update': { post: { summary: 'Batch ingest GPS coordinates' } },
    '/api/location/current': { get: { summary: 'Get current locations of on-duty salespersons' } },
    '/api/location/history': { get: { summary: 'Historical route polyline and events for date' } },
    '/api/visits/start': { post: { summary: 'Start client visit with GPS distance validation' } },
    '/api/visits/:id/end': { post: { summary: 'Complete visit with outcome and notes' } },
    '/api/reports/sales': { get: { summary: 'Sales report (JSON/CSV)' } },
    '/api/reports/collections': { get: { summary: 'Collections report (JSON/CSV)' } },
    '/api/reports/attendance': { get: { summary: 'Attendance report (JSON/CSV)' } },
    '/api/reports/visits': { get: { summary: 'Visits report (JSON/CSV)' } },
    '/api/reports/product-sales': { get: { summary: 'Product sales report (JSON/CSV)' } },
    '/api/sync/batch': { post: { summary: 'Durable offline sync batch' } },
    '/api/settings': { get: { summary: 'Get system settings' }, put: { summary: 'Update system settings' } },
    '/api/audit-logs': { get: { summary: 'Search audit logs' } },
    '/api/notifications': { get: { summary: 'List in-app notifications' } },
  },
};

router.get('/spec.json', (_req: Request, res: Response) => {
  res.json(apiSpec);
});

router.get('/', (_req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Sales ERP API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/docs/spec.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
      });
    };
  </script>
</body>
</html>
  `);
});

export default router;
