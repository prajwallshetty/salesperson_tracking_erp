/**
 * PM2 configuration for self-hosted / VPS deployments of the unified SalesGrid server.
 *   npm ci && npm run build && npx prisma migrate deploy
 *   pm2 start ecosystem.config.js --env production
 * Run exactly one instance: Socket.IO and the rate limiter keep state in process memory.
 */
module.exports = {
  apps: [
    {
      name: 'salesgrid',
      script: 'node_modules/.bin/tsx',
      args: 'server.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development', PORT: 3000 },
      env_production: { NODE_ENV: 'production', PORT: 3000 },
    },
  ],
};
