/**
 * Retrieve an org's credentials for re-sharing — decrypt-on-demand from
 * passwordEnc (never stored plaintext). Later this moves into the admin UI.
 *
 *   npx tsx --env-file=.env.local scripts/show-org-credentials.ts "catalant@paramount.com"
 *   npx tsx --env-file=.env.local scripts/show-org-credentials.ts "Catalant"
 */
import { prisma } from '../lib/db';
import { decryptSecret } from '../lib/crypto/orgSecret';

async function main() {
  const query = process.argv[2]?.trim();
  if (!query) {
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/show-org-credentials.ts "<org email or name>"',
    );
    process.exitCode = 1;
    return;
  }

  const matches = await prisma.organization.findMany({
    where: query.includes('@')
      ? { email: { equals: query, mode: 'insensitive' } }
      : { name: { contains: query, mode: 'insensitive' } },
    select: {
      id: true,
      name: true,
      email: true,
      passwordEnc: true,
      dailyMsgLimit: true,
      active: true,
      createdAt: true,
    },
  });

  if (matches.length === 0) {
    console.error(`No organization found matching "${query}".`);
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    console.log(`Multiple orgs match "${query}" — be more specific (use the email):`);
    for (const o of matches) console.log(`  ${o.name}  <${o.email}>`);
    process.exitCode = 1;
    return;
  }

  const org = matches[0];
  const password = decryptSecret(org.passwordEnc);

  console.log('\nOrganization credentials (handle with care):');
  console.log(`  name:     ${org.name}`);
  console.log(`  email:    ${org.email}`);
  console.log(`  password: ${password}`);
  console.log(`  org id:   ${org.id}`);
  console.log(`  active:   ${org.active}   daily msg limit: ${org.dailyMsgLimit}`);
  console.log(`  created:  ${org.createdAt.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
