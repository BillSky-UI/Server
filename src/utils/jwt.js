import jwt from 'jsonwebtoken';

/**
 * Create a signed JWT token for the given user.
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      customId: user.customId,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * Verifies a token, returns decoded payload or null.
 */
export function verifyToken(token) {
  try {
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}