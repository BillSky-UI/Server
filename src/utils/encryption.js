import CryptoJS from 'crypto-js';
import crypto from 'crypto';

/**
 * E2EE utility module.
 *
 * IMPORTANT ARCHITECTURAL NOTE:
 * Real End-to-End Encryption happens CLIENT-SIDE (Flutter / Dart's `encrypt`
 * package, and here with crypto-js for parity). The backend NEVER stores or
 * sees plaintext messages — it only persists and relays the ciphertext + IV.
 *
 * These helpers are provided so you can:
 *   1. Verify your client implementation produces identical, interoperable
 *      ciphertext (AES-256-CBC with a 16-byte IV — same scheme as the
 *      Flutter `encrypt` package's `AES(key, AESMode.cbc)`).
 *   2. Derive a user-specific key in a deterministic way (e.g. from the
 *      user's secret passphrase) for end-to-end testing.
 */

/**
 * Derives a 32-byte AES key from a passphrase using SHA-256.
 * The Flutter client should use the SAME derivation so both sides
 * can decrypt each other's messages.
 */
export function deriveKey(passphrase) {
  if (!passphrase) throw new Error('passphrase required');
  return CryptoJS.SHA256(passphrase).toString();
}

/**
 * Encrypt plaintext using AES-256-CBC with a random 16-byte IV.
 * @returns {{ ciphertext: string, iv: string }} both base64-encoded.
 */
export function encryptMessage(plaintext, keyBase64OrHex) {
  const iv = crypto.randomBytes(16).toString('base64');
  // key should be a 32-byte hex string (64 hex chars) — use as-is
  const key = CryptoJS.enc.Hex.parse(keyBase64OrHex);
  const ivParsed = CryptoJS.enc.Base64.parse(iv);

  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: ivParsed,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return {
    ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv,
  };
}

/**
 * Decrypt ciphertext back to plaintext.
 * Works with output of either this module or the Flutter `encrypt` package
 * (as long as both use AES-256-CBC + the same key).
 */
export function decryptMessage(ciphertext, ivBase64, keyBase64OrHex) {
  const key = CryptoJS.enc.Hex.parse(keyBase64OrHex);
  const ivParsed = CryptoJS.enc.Base64.parse(ivBase64);

  const decrypted = CryptoJS.AES.decrypt(
    {
      ciphertext: CryptoJS.enc.Base64.parse(ciphertext),
    },
    key,
    {
      iv: ivParsed,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Generates a cryptographically random 32-byte key (hex).
 * The Flutter app generates one key per user on first install and stores it
 * in FlutterSecureStorage — never transmitted in plaintext.
 */
export function generateAESKey(existingHexKey) {
  if (existingHexKey) return existingHexKey;
  return crypto.randomBytes(32).toString('hex');
}