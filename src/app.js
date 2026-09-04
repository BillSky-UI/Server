import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';

import multer from 'multer';
import config from './config/index.js';
import authRoutes from './routes/authRoutes.js';
import friendRoutes from './routes/friendRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import { initSocket } from './socket/index.js';

/**
 * Builds and configures the Express app + HTTP server + Socket.io.
 * Returns { app, server, io }.
 */
export function createApp() {
  const app = express();
  const server = http.createServer(app);

  // ---- Security & body parsing ----
  app.use(helmet());
  app.use(
    cors({
      origin: config.clientUrl === '*' ? true : config.clientUrl.split(','),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  if (config.env === 'development') {
    app.use(morgan('dev'));
  }

  // ---- Rate limiting ----
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
  });
  app.use('/api', limiter);

  // ---- Routes ----
  app.get('/', (_req, res) => {
    res.json({ success: true, name: 'BillChat API', version: '1.0.0' });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/media', mediaRoutes);

  // ---- 404 handler ----
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan' });
  });

  // ---- Error handler ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, error: `Multer: ${err.message}` });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Server error' });
  });

  // ---- Socket.io ----
  const io = new SocketServer(server, {
    cors: {
      origin: config.clientUrl === '*' ? true : config.clientUrl.split(','),
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });
  initSocket(io);

  return { app, server, io };
}