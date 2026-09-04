import { createApp } from './app.js';
import config from './config/index.js';
import { connectDB, disconnectDB } from './config/db.js';

/**
 * Application entrypoint.
 */
async function bootstrap() {
  await connectDB();

  const { server } = createApp();

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

bootstrap().catch((err) => {
  console.error('[bootstrap] fatal error:', err);
  process.exit(1);
});