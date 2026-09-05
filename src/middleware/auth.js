import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';

/**
 * Protect routes — requires a valid Bearer token.
 * Attaches `req.user` with fresh data from the DB.
 * NOTE: token verification must use the SAME secret as signing
 * (`config.jwt.secret`); using process.env.JWT_SECRET directly here broke
 * every protected route when that env var was unset (tokens were signed with
 * the fallback secret but verified against `undefined` -> 401 on all calls).
 */
export async function protect(req, res, next) {
  try {
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Tidak diautentikasi' });
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ success: false, error: 'Token tidak valid atau kedaluwarsa' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Pengguna tidak ditemukan' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token tidak valid atau kedaluwarsa' });
  }
}

/**
 * Optional auth — doesn't fail if no token provided.
 */
export function optionalAuth(req, res, next) {
  const token =
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer')
      ? req.headers.authorization.split(' ')[1]
      : null) || (req.cookies && req.cookies.token);

  if (!token) return next();

  const decoded = verifyToken(token);
  if (decoded) {
    req.userId = decoded.id;
  }
  next();
}