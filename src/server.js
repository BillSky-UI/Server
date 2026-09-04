import { pathToFileURL } from 'url';
import { createApp } from './app.js';
import config from './config/index.js';
import { connectDB, disconnectDB } from './config/db.js';

/**
 * Main entrypoint, compatible with BOTH:
 *   - Traditional long-running Node server (local dev / Render / Railway / VPS)
 *   - Vercel serverless functions (must EXPORT the app, never call listen())
 *
 * On Vercel, `process.env.VERCEL === '1'` is set and the app is imported +
 * executed by `api/index.js` instead. When run directly (npm start), this file
 * boots the server and starts listening.
 */

// ---- 1) Build the Express app (+ attach Socket.io) lazily -----
let cached;

function getApp() {
  if (!cached) {
    cached = createApp();
  }
  return cached;
}

// ---- 2) Export the Express `app` for serverless handlers ---------
export default async function defaultHandler(req, res) {
  // Ensure the DB is connected before handling the request (reuses cached conn).
  await connectDB();
  const { app } = getApp();
  return app(req, res);
}

// Also expose app/server/io for reuse by other entrypoints.
export { getApp };

// ---- 3) Start listening ONLY when executed directly (local/VM) -----
// `import.meta.url === pathToFileURL(process.argv[1])` means "run directly".
const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

const isVercel = process.env.VERCEL === '1';

if (isDirectRun && !isVercel) {
  bootstrap().catch((err) => {
    console.error('[bootstrap] fatal error:', err);
    process.exit(1);
  });
}

async function bootstrap() {
  await connectDB();

  const { server } = getApp();

  server.listen(config.port, () => {
    console.log(`[server] BillChat API running on port ${config.port} (${config.env})`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`[server] Received ${signal}, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Force-exit after 10s if connections don't close.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
