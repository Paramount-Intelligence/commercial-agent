/**
 * Shared org credential helpers — used by scripts/create-org.ts and the
 * admin org management API. Keep password generation / email derivation /
 * hashing in ONE place so the UI and CLI never drift.
 */
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { encryptSecret } from '../crypto/orgSecret';

export const ORG_EMAIL_DOMAIN = 'paramount.com';
export const ORG_PASSWORD_LEN = 20;
export const ORG_BCRYPT_ROUNDS = 12;

const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Crypto-random strong password: guaranteed mixed case + digit + symbol. */
export function generateOrgPassword(len = ORG_PASSWORD_LEN): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < len) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function slugifyOrgName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug) throw new Error(`Org name "${name}" produces an empty email slug`);
  return slug;
}

/** slug@domain, appending 2..99 on collision. */
export async function deriveAvailableOrgEmail(name: string): Promise<string> {
  const slug = slugifyOrgName(name);
  const base = `${slug}@${ORG_EMAIL_DOMAIN}`;

  const existing = await prisma.organization.findUnique({ where: { email: base } });
  if (!existing) return base;

  for (let n = 2; n <= 99; n++) {
    const candidate = `${slug}${n}@${ORG_EMAIL_DOMAIN}`;
    const clash = await prisma.organization.findUnique({ where: { email: candidate } });
    if (!clash) return candidate;
  }
  throw new Error(`Could not find a free email for slug "${slug}" (tried up to ${slug}99)`);
}

export async function hashOrgPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ORG_BCRYPT_ROUNDS);
}

/** Store both hash (login) and encrypted copy (admin re-share). */
export async function sealOrgPassword(password: string): Promise<{
  passwordHash: string;
  passwordEnc: string;
}> {
  return {
    passwordHash: await hashOrgPassword(password),
    passwordEnc: encryptSecret(password),
  };
}
