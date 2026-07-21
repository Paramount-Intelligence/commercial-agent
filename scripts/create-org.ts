/**
 * Create an Organization: derive email from the name, generate a strong password,
 * store bcrypt hash + AES-256-GCM encrypted copy, print credentials ONCE.
 *
 *   npx tsx --env-file=.env.local scripts/create-org.ts "Catalant"
 *   npm run org:create -- "Battery Ventures"
 *
 * CREATE-only: if the derived email already exists, a numeric suffix is tried
 * (catalant2@...). Exact-name duplicates stop with a warning. Password resets are
 * a separate command — this never overwrites.
 */
import { prisma } from '../lib/db';
import { encryptSecret } from '../lib/crypto/orgSecret';
import {
  deriveAvailableOrgEmail,
  generateOrgPassword,
  sealOrgPassword,
} from '../lib/orgs/credentials';

async function main() {
  const name = process.argv[2]?.trim();
  if (!name) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/create-org.ts "Org Name"');
    process.exitCode = 1;
    return;
  }

  // Fail fast if ORG_SECRET_KEY is missing/invalid — before touching the DB
  encryptSecret('key-check');

  // CREATE-only guard: exact same name already registered → stop
  const sameName = await prisma.organization.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, email: true },
  });
  if (sameName) {
    console.error(
      `STOP: an organization named "${name}" already exists (email: ${sameName.email}, id: ${sameName.id}).\n` +
        'This script only CREATES. Use show-org-credentials.ts to re-share, or a reset command to change the password.',
    );
    process.exitCode = 1;
    return;
  }

  const email = await deriveAvailableOrgEmail(name);
  const password = generateOrgPassword();
  const sealed = await sealOrgPassword(password);

  const org = await prisma.organization.create({
    data: {
      name,
      email,
      passwordHash: sealed.passwordHash,
      passwordEnc: sealed.passwordEnc,
      // dailyMsgLimit defaults 1000, active defaults true (schema)
    },
    select: { id: true, name: true, email: true, dailyMsgLimit: true },
  });

  console.log('\nOrganization created:');
  console.log(`  name:     ${org.name}`);
  console.log(`  email:    ${org.email}`);
  console.log(`  password: ${password}       <-- shown once here in full`);
  console.log(`  org id:   ${org.id}`);
  console.log(`  daily msg limit: ${org.dailyMsgLimit}`);
  console.log(
    '\n(store these; password is also retrievable later via show-org-credentials.ts since it is encrypted)',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
