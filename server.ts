/**
 * SalesGrid production/dev server: Next.js + Socket.IO on a single port.
 *
 * Socket.IO needs a long-lived Node HTTP server, which Next.js Route Handlers cannot provide.
 * Running both in one process keeps a single deployment while preserving the legacy realtime
 * channel (live GPS, order/payment/expense events). Route Handlers emit through the shared
 * instance registered in `src/lib/realtime/emitter.ts`.
 */
import './src/lib/loadEnv';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { validateConfig, config } from './src/lib/config';
import { initSocketServer, attachRedisAdapter } from './src/lib/realtime/socketServer';
import { startRetentionJob } from './src/lib/jobs/retention';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const validation = validateConfig();
if (!validation.valid) {
  const banner = ['CONFIGURATION VALIDATION FAILED', ...validation.errors.map((e) => `  * ${e}`)].join('\n');
  if (!dev) {
    console.error(banner);
    process.exit(1);
  }
  console.warn(banner);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    handle(req, res, parse(req.url || '/', true)).catch((err) => {
      console.error('Unhandled request error', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    });
  });

  const io = initSocketServer(httpServer, config.corsOrigins);
  try {
    if (await attachRedisAdapter(io)) console.log('Socket.IO Redis adapter active (multi-instance mode)');
  } catch (err) {
    // Without the adapter, realtime events would silently reach only this instance's clients.
    console.error('Could not connect to REDIS_URL for the Socket.IO adapter:', (err as Error).message);
    if (!dev) process.exit(1);
  }

  startRetentionJob();

  httpServer.listen(port, hostname, () => {
    console.log(`SalesGrid ready on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port} (${dev ? 'development' : 'production'})`);
    console.log('Socket.IO realtime channel active on the same port');
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
