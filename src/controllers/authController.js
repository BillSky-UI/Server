import User from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { normalizePhone } from '../utils/phone.js';
import { requestOtp, verifyOtp } from '../services/otpService.js';
import { validationResult } from 'express-validator';

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email || null,
    phone: user.phone || null,
    customId: user.customId,
    avatar: user.avatar,
    profilePic: user.profilePic,
    status: user.status,
    phoneVerified: !!user.phoneVerified,
  };
}

function otpResponse(data, message) {
  return {
    success: true,
    message,
    expiresIn: data.expiresIn,
    cooldown: data.cooldown,
    whatsappConfigured: data.configured,
    ...(data.delivery?.devCode ? { devCode: data.delivery.devCode } : {}),
  };
}

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
    // Detailed, traceable logging for Vercel/Render logs.
    console.error('[login] ERROR:', err?.message || err);
    console.error('[login] STACK:', err?.stack || '(no stack)');
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: process.env.NODE_ENV === 'production'
        ? 'Terjadi kesalahan server. Coba lagi.'
        : `Terjadi kesalahan server: ${err?.message || err}`,
    });
  }
}

/**
 * Step 1 of phone registration: validate data and send an OTP to WhatsApp.
 */
export async function requestRegisterOtp(req, res) {
  const { name, customId, phone, email } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  const normalizedId = String(customId || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';

  if (!cleanName) {
    return res.status(400).json({ success: false, error: 'Nama wajib diisi' });
  }
  if (normalizedId.length < 3 || normalizedId.length > 30) {
    return res.status(400).json({ success: false, error: 'ID Pengguna harus 3-30 karakter' });
  }
  if (!/^[a-z0-9_.-]+$/.test(normalizedId)) {
    return res.status(400).json({
      success: false,
      error: 'ID hanya boleh berisi huruf, angka, titik, underscore, dan strip',
    });
  }
  if (!normalizedPhone) {
    return res.status(400).json({
      success: false,
      error: 'Nomor WhatsApp tidak valid. Gunakan format 08xx atau +62xx.',
    });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Email tidak valid' });
  }

  try {
    const [idTaken, phoneTaken, emailTaken] = await Promise.all([
      User.findOne({ customId: normalizedId }),
      User.findOne({ phone: normalizedPhone }),
      cleanEmail ? User.findOne({ email: cleanEmail }) : Promise.resolve(null),
    ]);

    if (idTaken) {
      return res.status(409).json({
        success: false,
        error: 'customId_taken',
        message: `ID Pengguna "${normalizedId}" sudah digunakan. Pilih ID lain.`,
      });
    }
    if (phoneTaken) {
      return res.status(409).json({
        success: false,
        error: 'phone_taken',
        message: 'Nomor WhatsApp ini sudah terdaftar. Silakan masuk dengan OTP.',
      });
    }
    if (emailTaken) {
      return res.status(409).json({
        success: false,
        error: 'email_taken',
        message: 'Email ini sudah terdaftar.',
      });
    }

    const data = await requestOtp({
      phone: normalizedPhone,
      purpose: 'register',
      payload: {
        name: cleanName,
        customId: normalizedId,
        phone: normalizedPhone,
        email: cleanEmail || null,
      },
    });

    return res.status(200).json(
      otpResponse(
        data,
        'Kode OTP telah dikirim ke WhatsApp Anda untuk menyelesaikan pendaftaran.'
      )
    );
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.code || 'otp_error',
        message: err.message,
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
      });
    }
    console.error('[requestRegisterOtp]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Step 2 of phone registration: verify OTP and create the account.
 */
export async function verifyRegisterOtp(req, res) {
  const { phone, code } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp tidak valid' });
  }

  try {
    const otp = await verifyOtp({
      phone: normalizedPhone,
      purpose: 'register',
      code,
    });
    const payload = otp.payload || {};

    const [idTaken, phoneTaken] = await Promise.all([
      User.findOne({ customId: payload.customId }),
      User.findOne({ phone: normalizedPhone }),
    ]);
    if (idTaken) {
      return res.status(409).json({
        success: false,
        error: 'customId_taken',
        message: 'ID Pengguna sudah digunakan. Silakan daftar ulang dengan ID lain.',
      });
    }
    if (phoneTaken) {
      return res.status(409).json({
        success: false,
        error: 'phone_taken',
        message: 'Nomor WhatsApp ini sudah terdaftar. Silakan masuk.',
      });
    }

    const userData = {
      name: payload.name,
      customId: payload.customId,
      phone: normalizedPhone,
      phoneVerified: true,
    };
    if (payload.email) userData.email = payload.email;

    const user = await User.create(userData);
    const token = signToken(user);

    return res.status(201).json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.code || 'otp_error',
        message: err.message,
        ...(err.attemptsLeft !== undefined ? { attemptsLeft: err.attemptsLeft } : {}),
      });
    }
    console.error('[verifyRegisterOtp]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Step 1 of phone login: send an OTP to a registered WhatsApp number.
 */
export async function requestLoginOtp(req, res) {
  const normalizedPhone = normalizePhone(req.body?.phone);
  if (!normalizedPhone) {
    return res.status(400).json({
      success: false,
      error: 'Nomor WhatsApp tidak valid. Gunakan format 08xx atau +62xx.',
    });
  }

  try {
    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'phone_not_registered',
        message: 'Nomor WhatsApp belum terdaftar. Silakan daftar akun terlebih dahulu.',
      });
    }

    const data = await requestOtp({
      phone: normalizedPhone,
      purpose: 'login',
      payload: {},
    });

    return res.status(200).json(
      otpResponse(data, 'Kode OTP telah dikirim ke WhatsApp Anda.')
    );
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.code || 'otp_error',
        message: err.message,
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
      });
    }
    console.error('[requestLoginOtp]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Step 2 of phone login: verify OTP and return a JWT.
 */
export async function verifyLoginOtp(req, res) {
  const normalizedPhone = normalizePhone(req.body?.phone);
  if (!normalizedPhone) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp tidak valid' });
  }

  try {
    await verifyOtp({
      phone: normalizedPhone,
      purpose: 'login',
      code: req.body?.code,
    });

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'phone_not_registered',
        message: 'Akun tidak ditemukan.',
      });
    }

    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }

    const token = signToken(user);
    return res.status(200).json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: err.code || 'otp_error',
        message: err.message,
        ...(err.attemptsLeft !== undefined ? { attemptsLeft: err.attemptsLeft } : {}),
      });
    }
    console.error('[verifyLoginOtp]', err);
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
 * Update profile (name, status, customId/username, avatar url, profilePic url).
 */
export async function updateProfile(req, res) {
  const { name, status, customId, avatar, profilePic } = req.body;
  try {
    const update = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) update.status = status;

    // Username (customId) — editable with uniqueness check.
    if (customId !== undefined && String(customId).trim() !== req.user.customId) {
      const newId = String(customId).trim().toLowerCase();
      if (newId.length < 3) {
        return res.status(400).json({ success: false, error: 'ID Pengguna minimal 3 karakter' });
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(newId)) {
        return res.status(400).json({ success: false, error: 'ID hanya huruf, angka, titik, _, -' });
      }
      const taken = await User.findOne({ customId: newId });
      if (taken) {
        return res.status(409).json({ success: false, error: 'customId_taken', message: 'Username/ID Pengguna sudah digunakan.' });
      }
      update.customId = newId;
    }

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