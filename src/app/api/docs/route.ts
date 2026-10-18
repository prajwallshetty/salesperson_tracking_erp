export const dynamic = 'force-static';

const SWAGGER = 'https://unpkg.com/swagger-ui-dist@5.17.14';

export function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bharath Interior Decor API Documentation</title>
  <link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
  <style>body{margin:0;background:#fafafa}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER}/swagger-ui-bundle.js"></script>
  <script>window.onload=()=>{window.ui=SwaggerUIBundle({url:'/api/docs/spec.json',dom_id:'#swagger-ui',deepLinking:true});};</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
