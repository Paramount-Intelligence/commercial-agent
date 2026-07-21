/**
 * OTP primitives. Codes are 6-digit numeric, crypto-random, and only ever
 * stored bcrypt-hashed — same discipline as passwords.
 */
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';

const OTP_BCRYPT_ROUNDS = 10;

/** 6-digit numeric code, zero-padded ("004217" is valid). */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
