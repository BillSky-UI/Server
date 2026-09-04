import User from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { validationResult } from 'express-validator';

/**
 * Register a new account.
 *
 * Validations:
 *  name, email, password   -> required
 *  customId                -> required, min 3 chars, UNIQUE (checked + mongoose index)
 */
export async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, customId } = req.body;

  try {
    // 1) Explicit uniqueness check on customId (readable, precise response)
    const existingId = await User.findOne({ customId: customId.toLowerCase().trim() });
    if (existingId) {
      return res.status(409).json({
        success: false,
        error: 'customId_taken',
        message: `ID Pengguna "${customId}" sudah digunakan orang lain. Silakan pilih ID yang berbeda.`,
      });
    }

    // 2) Explicit uniqueness check on email
    const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        error: 'email_taken',
        message: 'Email ini sudah terdaftar. Gunakan email lain atau masuk.',
      });
    }

    // 3) Hash password
    const hashed = await hashPassword(password);

    // 4) Create user
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      customId: customId.toLowerCase().trim(),
      password: hashed,
    });

    // 5) Return token + public profile (password excluded automatically)
    const token = signToken(user);
    return res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        customId: user.customId,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (err) {
    // Mongoose E11000 duplicate key — a rare race-case fallback.
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({
        success: false,
        error: `${field}_taken`,
        message: field === 'customId' ? 'ID Pengguna sudah digunakan.' : 'Email sudah terdaftar.',
      });
    }
    console.error('[register]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Login — email + password.
 */
export async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'invalid_credentials',
        message: 'Email tidak terdaftar.',
      });
    }

    const ok = await comparePassword(password, user.password);
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: 'invalid_credentials',
        message: 'Password salah.',
      });
    }

    const token = signToken(user);
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        customId: user.customId,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Get the currently authenticated profile.
 */
export async function me(req, res) {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'name email customId avatar status isOnline lastSeen')
      .populate('friendRequestsReceived', 'name email customId avatar status')
      .populate('friendRequestsSent', 'name email customId avatar status');
    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error('[me]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Update profile (name, status, avatar url, profilePic url).
 */
export async function updateProfile(req, res) {
  const { name, status, avatar, profilePic } = req.body;
  try {
    const update = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) update.status = status;
    if (avatar !== undefined) update.avatar = avatar;
    // Keep avatar + profilePic in sync when updating either.
    if (profilePic !== undefined) {
      update.profilePic = profilePic;
      if (avatar === undefined) update.avatar = profilePic;
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error('[updateProfile]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}