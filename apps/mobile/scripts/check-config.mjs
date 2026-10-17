// Validates the build configuration and writes www/app-config.js (read by the offline page).
// Usage: SALESGRID_SERVER_URL=https://salesgrid.example.com npm run check
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = process.env.SALESGRID_SERVER_URL;
if (!raw) {
  console.error('SALESGRID_SERVER_URL is required (the deployed SalesGrid URL, https://…).');
  process.exit(1);
}
let url;
try {
  url = new URL(raw);
} catch {
  console.error(`SALESGRID_SERVER_URL is not a valid URL: ${raw}`);
  process.exit(1);
}
if (url.protocol !== 'https:' && process.env.SALESGRID_ALLOW_HTTP !== 'true') {
  console.error('SALESGRID_SERVER_URL must be https:// for release builds (SALESGRID_ALLOW_HTTP=true for local development only).');
  process.exit(1);
}

const out = fileURLToPath(new URL('../www/app-config.js', import.meta.url));
writeFileSync(out, `window.SALESGRID_SERVER_URL = ${JSON.stringify(url.origin + '/')};\n`);

try {
  const res = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => ({}));
  console.log(`Server ${url.origin}: HTTP ${res.status}, status=${body.status ?? 'unknown'}`);
} catch (e) {
  console.warn(`Warning: could not reach ${url.origin}/api/health (${e.message}). The build will still point at this URL.`);
}
console.log(`Android app will load ${url.origin}/`);
