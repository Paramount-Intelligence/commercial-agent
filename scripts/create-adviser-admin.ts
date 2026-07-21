/**
 * Create an AdviserAdmin (adviser-portal admin — NOT the website Admin).
 *
 *   npm run admin:create -- "Full Name" "email@paramount.com"
 *
 * Prints the generated password ONCE. Unlike org creds there is NO encrypted
 * copy — admin passwords are reset (reset-adviser-admin-password.ts), never
 * retrieved. Refuses if the email already exists.
 */
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db';

const PASSWORD_LEN = 20;
const BCRYPT_ROUNDS = 12;

// Unambiguous character set (no lookalikes like 0/O, 1/l/I)
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Crypto-random strong password: guaranteed mixed case + digit + symbol. */
export function generatePassword(len = PASSWORD_LEN): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < len) chars.push(pick(ALL));
  // Fisher–Yates with crypto randomness so the guaranteed chars aren't positional
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const name = process.argv[2]?.trim();
  const email = process.argv[3]?.trim().toLowerCase();

  if (!name || !email) {
    console.error(
      'Usage: npm run admin:create -- "Full Name" "email@paramount.com"',
    );
    process.exitCode = 1;
    return;
  }
  if (!EMAIL_RE.test(email)) {
    console.error(`"${email}" is not a valid email address`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.adviserAdmin.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (existing) {
    console.error(
      `STOP: an adviser admin with email ${email} already exists ` +
        `("${existing.name}", id: ${existing.id}).\n` +
        'Use reset-adviser-admin-password.ts to set a new password.',
    );
    process.exitCode = 1;
    return;
  }

  const password = generatePassword();
  const admin = await prisma.adviserAdmin.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      // role defaults "admin", active defaults true (schema)
    },
    select: { id: true, name: true, email: true, role: true },
  });

  console.log('\nAdviser admin created:');
  console.log(`  name:     ${admin.name}`);
  console.log(`  email:    ${admin.email}`);
  console.log(`  password: ${password}       <-- shown ONCE, store it now`);
  console.log(`  role:     ${admin.role}`);
  console.log(`  id:       ${admin.id}`);
  console.log(
    '\n(NOT retrievable later — if lost, run: npm run admin:reset -- "' +
      admin.email +
      '")',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
