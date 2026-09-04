import mongoose from 'mongoose';
import config from './index.js';

/**
 * Establish connection to MongoDB.
 *
 * IMPORTANT (serverless/Vercel): a module-level cached promise guarantees that
 * repeated function invocations reuse ONE connection/process rather than
 * opening new connections on every warm start. Mongoose also reuses the first
 * connection when connected.
 */
let connectionPromise = null;

export function connectDB(retries = 5) {
  // Already connected -> return the existing connection.
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }

  // A connection attempt is already in-flight -> reuse it.
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await mongoose.connect(config.mongo.uri, config.mongo.options);
        console.log(`[DB] Connected to MongoDB: ${mongoose.connection.host}`);
        mongoose.connection.on('error', (err) => {
          console.error('[DB] Connection error:', err.message);
        });
        mongoose.connection.on('disconnected', () => {
          console.warn('[DB] MongoDB disconnected');
        });
        return mongoose.connection;
      } catch (err) {
        console.error(`[DB] Connection attempt failed (${retries - attempt} retries left):`, err.message);
        if (attempt >= retries) {
          connectionPromise = null;
          throw err;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();

  // Reset the cache if the promise rejects so a later call can retry.
  connectionPromise.catch(() => {
    connectionPromise = null;
  });

  return connectionPromise;
}

/**
 * Gracefully close the connection (used in shutdown handlers).
 */
export async function disconnectDB() {
  connectionPromise = null;
  await mongoose.disconnect();
  console.log('[DB] MongoDB disconnected');
}
