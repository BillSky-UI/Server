import mongoose from 'mongoose';
import config from './index.js';

/**
 * Establish connection to MongoDB with retry logic.
 * Exits the process after maxRetries consecutive failures.
 */
export async function connectDB(retries = 5) {
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
    console.error(`[DB] Connection attempt failed (${retries} retries left):`, err.message);
    if (retries <= 0) {
      console.error('[DB] Giving up. Exiting.');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
    return connectDB(retries - 1);
  }
}

/**
 * Gracefully close the connection (used in shutdown handlers).
 */
export async function disconnectDB() {
  await mongoose.disconnect();
  console.log('[DB] MongoDB disconnected');
}