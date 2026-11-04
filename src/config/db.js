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
let indexesFixed = false;

async function fixIndexes() {
  if (indexesFixed) return;
  indexesFixed = true;

  try {
    const { default: Conversation } = await import('../models/Conversation.js');
    const indexes = await Conversation.collection.indexes();
    const legacy = indexes.find((i) => i.name === 'participants_1' && i.unique);
    if (legacy) {
      await Conversation.collection.dropIndex(legacy.name);
      console.log('[DB] Dropped legacy unique participants index');
    }
    await Conversation.collection.createIndex(
      { pairKey: 1 },
      { unique: true, sparse: true, name: 'pairKey_1' }
    );
  } catch (err) {
    console.warn('[DB] Conversation index sync skipped:', err.message);
  }

  try {
    const { default: User } = await import('../models/User.js');
    const indexes = await User.collection.indexes();
    for (const field of ['email', 'phone']) {
      const idx = indexes.find((i) => i.name === `${field}_1` && i.unique && !i.sparse);
      if (idx) {
        await User.collection.dropIndex(idx.name);
        await User.collection.createIndex(
          { [field]: 1 },
          { unique: true, sparse: true, name: `${field}_1` }
        );
        console.log(`[DB] Rebuilt ${field} index as sparse unique`);
      }
    }
  } catch (err) {
    console.warn('[DB] User index sync skipped:', err.message);
  }
}

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
        await fixIndexes();
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
