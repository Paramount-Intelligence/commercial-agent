/**
 * Reset an AdviserAdmin password (admins reset, never retrieve).
 * Also revokes all of the admin's existing sessions.
 *
 *   npm run admin:reset -- "email@paramount.com"
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db';
import { generatePassword } from './create-adviser-admin';

const BCRYPT_ROUNDS = 12;

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run admin:reset -- "email@paramount.com"');
    process.exitCode = 1;
    return;
  }

  const admin = await prisma.adviserAdmin.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!admin) {
    console.error(`No adviser admin found with email ${email}`);
    process.exitCode = 1;
    return;
  }

  const password = generatePassword();

  await prisma.$transaction([
    prisma.adviserAdmin.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
    }),
    // A reset means the old credential may be compromised — kill live sessions
    prisma.adviserAdminSession.deleteMany({ where: { adminId: admin.id } }),
  ]);

  console.log('\nPassword reset:');
  console.log(`  name:     ${admin.name}${admin.active ? '' : '  [INACTIVE]'}`);
  console.log(`  email:    ${admin.email}`);
  console.log(`  password: ${password}       <-- shown ONCE, store it now`);
  console.log('\n(all existing sessions for this admin were revoked)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
