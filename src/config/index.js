import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  clientUrl: process.env.CLIENT_URL || '*',

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/billchat',
    options: {
      autoIndex: true,
      maxPoolSize: 20,
      // Generous timeouts for cloud/MongoDB Atlas (cold starts + remote latency):
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      waitQueueTimeoutMS: 15000,
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Server-side transport secret (NOT the user-level E2EE key).
  serverSecret: process.env.APP_SERVER_SECRET || 'dev_server_secret_change_me',

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 300,
  },

  maxUploadBytes: 50 * 1024 * 1024, // 50 MB per file
};

export default config;