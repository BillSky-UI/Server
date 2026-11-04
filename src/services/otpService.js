import crypto from 'crypto';
import Otp from '../models/Otp.js';
import config from '../config/index.js';
import { sendWhatsAppMessage, whatsappConfigured } from './whatsappService.js';

function appError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function hashCode(phone, code) {
  return crypto
    .createHmac('sha256', config.otp.hashSecret)
    .update(`${phone}:${code}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function generateCode() {
  const max = 10 ** config.otp.length;
  return crypto.randomInt(0, max).toString().padStart(config.otp.length, '0');
}

export async function requestOtp({ phone, purpose, payload = {} }) {
  const now = Date.now();
  const cooldownMs = config.otp.cooldownSeconds * 1000;

  const recent = await Otp.findOne({
    phone,
    purpose,
    createdAt: { $gt: new Date(now - cooldownMs) },
  }).sort({ createdAt: -1 });

  if (recent) {
    const elapsed = now - recent.createdAt.getTime();
    const retryAfter = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
    const err = appError(
      'otp_cooldown',
      `Tunggu ${retryAfter} detik sebelum meminta kode baru.`,
      429
    );
    err.retryAfter = retryAfter;
    throw err;
  }

  const hourAgo = new Date(now - 60 * 60 * 1000);
  const hourly = await Otp.countDocuments({
    phone,
    purpose,
    createdAt: { $gt: hourAgo },
  });
  if (hourly >= config.otp.maxPerHour) {
    throw appError(
      'otp_limit',
      'Terlalu banyak permintaan kode. Coba lagi nanti.',
      429
    );
  }

  const code = generateCode();
  const expiresAt = new Date(now + config.otp.ttlSeconds * 1000);

  await Otp.deleteMany({ phone, purpose, consumedAt: null });

  const otp = await Otp.create({
    phone,
    purpose,
    codeHash: hashCode(phone, code),
    payload,
    expiresAt,
    maxAttempts: config.otp.maxAttempts,
  });

  const message =
    `Kode OTP BillChat Anda: ${code}. ` +
    `Berlaku ${Math.max(1, Math.round(config.otp.ttlSeconds / 60))} menit. ` +
    'Jangan bagikan kode ini kepada siapa pun.';

  try {
    const delivery = await sendWhatsAppMessage({ phone, message, code });
    return {
      delivery,
      expiresIn: config.otp.ttlSeconds,
      cooldown: config.otp.cooldownSeconds,
      configured: whatsappConfigured(),
      otpId: otp._id.toString(),
    };
  } catch (err) {
    await Otp.deleteOne({ _id: otp._id });
    console.error('[otp] gagal mengirim WhatsApp:', err.message);
    throw appError(
      'otp_delivery_failed',
      'Gagal mengirim kode OTP ke WhatsApp. Coba lagi.',
      502
    );
  }
}

export async function verifyOtp({ phone, purpose, code }) {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  if (normalizedCode.length !== config.otp.length) {
    throw appError('invalid_code', 'Kode OTP tidak valid.');
  }

  const otp = await Otp.findOne({
    phone,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otp) {
    throw appError(
      'otp_expired',
      'Kode OTP tidak ditemukan atau sudah kedaluwarsa. Minta kode baru.',
      400
    );
  }

  if (otp.attempts >= otp.maxAttempts) {
    otp.consumedAt = new Date();
    await otp.save();
    throw appError(
      'otp_locked',
      'Terlalu banyak percobaan salah. Minta kode OTP baru.',
      429
    );
  }

  const matches = safeEqual(hashCode(phone, normalizedCode), otp.codeHash);
  if (!matches) {
    otp.attempts += 1;
    await otp.save();
    const left = Math.max(0, otp.maxAttempts - otp.attempts);
    const err = appError(
      'invalid_code',
      left > 0
        ? `Kode OTP salah. Sisa percobaan: ${left}.`
        : 'Kode OTP salah. Minta kode baru.',
      400
    );
    err.attemptsLeft = left;
    throw err;
  }

  otp.consumedAt = new Date();
  await otp.save();
  return otp;
}
