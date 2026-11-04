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

  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS || '300', 10),
    cooldownSeconds: parseInt(process.env.OTP_COOLDOWN_SECONDS || '60', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    maxPerHour: parseInt(process.env.OTP_MAX_PER_HOUR || '8', 10),
    hashSecret:
      process.env.OTP_HASH_SECRET ||
      process.env.JWT_SECRET ||
      'dev_otp_hash_secret_change_me',
  },

  whatsapp: {
    provider: (process.env.WHATSAPP_PROVIDER || 'auto').toLowerCase(),
    fonnteToken: process.env.FONNTE_TOKEN || '',
    cloudPhoneId: process.env.WHATSAPP_CLOUD_PHONE_ID || '',
    cloudToken: process.env.WHATSAPP_CLOUD_TOKEN || '',
    cloudTemplate: process.env.WHATSAPP_TEMPLATE_NAME || '',
    cloudTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'id',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_WHATSAPP_FROM || '',
  },

  maxUploadBytes: 50 * 1024 * 1024, // 50 MB per file
};

export default config;