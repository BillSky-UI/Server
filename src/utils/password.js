import bcrypt from 'bcrypt';

// Cost factor 10: still secure (industry-standard baseline) yet fast enough for
// remote clients. Each +1 doubles hashing time; 12 is unnecessarily slow for a
// chat app while 10 stays resistant to brute-force for years.
const SALT_ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}