import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';

/**
 * Vercel serverless entrypoint.
 *
 * Exports a default handler that Vercel executes for every HTTP request.
 * It lazily boots the Express app and connects to MongoDB Atlas on first call,
 * reusing both across warm invocations to avoid cold-start re-initialisation
 * and multiple DB connections.
 *
 * NOTE: Socket.io long-lived WebSockets are NOT persisted by Vercel Functions.
 * All REST endpoints (auth, friends, messages, media, profile) work perfectly;
 * real-time features are designed to also accept short-lived fallback polls.
 */
let expressApp = null;

async function ensureApp() {
  if (!expressApp) {
    await connectDB();
    const { app } = createApp();
    expressApp = app;
  }
  return expressApp;
}

export default async function handler(req, res) {
  const app = await ensureApp();
  // eslint-disable-next-line consistent-return
  return app(req, res);
}
