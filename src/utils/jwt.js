import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * Create a signed JWT token for the given user.
 *
 * Uses `config.jwt.secret` (which falls back to a safe default if the
 * JWT_SECRET env var is unset — prevents confusing `secret must have a value`
 * errors on serverless/Vercel) and `config.jwt.expiresIn`.
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      customId: user.customId,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Verifies a token, returns decoded payload or null.
 */
export function verifyToken(token) {
  try {
    if (!token) return null;
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}