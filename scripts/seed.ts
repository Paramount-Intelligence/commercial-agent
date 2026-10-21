/**
 * Seed a LOCAL or STAGING database with test data. Never production.
 *
 *   npm run seed:local                 (.env.local, must be localhost)
 *   npm run seed:staging               (.env.staging, must match STAGING_DB_FINGERPRINT)
 *   ... -- --approved-only             (only case drafts with approved_by set)
 *
 * Creates a test organization, a verified test buyer and an adviser admin
 * (credentials go to .seed/credentials.<target>.json, gitignored, never the
 * console); loads the case drafts from KNOWLEDGE_DIR/drafts/cases into
 * CaseStudy + CaseTech (clientName null); embeds their CaseChunk rows; then
 * runs the knowledge-base ingest. Idempotent: upserts by slug / email, and
 * embeddings go through the local cache so a re-run makes no API calls.
 */
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { assertLocalDatabase } from '../lib/dbGuard';
import { splitFrontMatter, stripSourceCites } from '../lib/knowledge/approved/manifest';
import { startEmbeddingCache } from './lib/embeddingCache';
import { knowledgeDir, REPO_ROOT, seedDir } from './lib/paths';

const SEED_ORG_NAME = 'Seed Test Org';
const SEED_ORG_EMAIL = 'seedtestorg@paramount.com';
const SEED_BUYER_EMAIL = 'seed-buyer@example.com';
const SEED_ADMIN_EMAIL = 'seed-admin@example.com';

const argTarget = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1];
const APPROVED_ONLY = process.argv.includes('--approved-only');

type Credentials = {
  target: string;
  updatedAt: string;
  org: { name: string; email: string; password: string };
  buyer: { email: string; note: string };
  admin: { email: string; password: string };
};

type CaseDraft = {
  slug: string;
  title: string;
  subtitle: string;
  industry: string;
  businessFunction: string;
  peBacked: boolean | null;
  tech: string[];
  approved: boolean;
  sections: Record<string, string>;
};

function readCaseDrafts(): CaseDraft[] {
  const dir = join(knowledgeDir(), 'drafts', 'cases');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const { fm, body } = splitFrontMatter(readFileSync(join(dir, file), 'utf8'));
      if (fm.type !== 'case') throw new Error(`${file}: type is not "case"`);
      const sections: Record<string, string> = {};
      for (const part of body.split(/^## /m).slice(1)) {
        const nl = part.indexOf('\n');
        sections[part.slice(0, nl).trim().toLowerCase()] = stripSourceCites(part.slice(nl + 1));
      }
      for (const key of ['overview', 'challenge', 'solution', 'results']) {
        if (!sections[key]) throw new Error(`${file}: missing "## ${key}" section`);
      }
      return {
        slug: String(fm.id),
        title: String(fm.title),
        subtitle: String(fm.subtitle ?? ''),
        industry: String(fm.industry ?? ''),
        businessFunction: String(fm.business_function ?? ''),
        peBacked: typeof fm.pe_backed === 'boolean' ? fm.pe_backed : null,
        tech: Array.isArray(fm.tech) ? fm.tech.map(String) : [],
        approved: fm.approved_by != null && fm.approved_by !== '',
        sections,
      };
    });
}

/** Run another script with the same env (and the embedding cache URL). Async, so the cache can answer it. */
function runScript(script: string, args: string[], logFile: string): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), script, ...args], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      writeFileSync(logFile, out);
      if (code === 0) ok();
      else fail(new Error(`${script} exited ${code}; see ${logFile}`));
    });
  });
}

async function main() {
  if (argTarget !== 'local' && argTarget !== 'staging') {
    throw new Error('Pass --target=local or --target=staging (use npm run seed:local / seed:staging).');
  }
  // Strict: NODE_ENV=production does not skip the guard here.
  const target = assertLocalDatabase(process.env, { strict: true });
  if (target !== argTarget) {
    throw new Error(`--target=${argTarget} but the configured database is ${target}. Refusing.`);
  }

  const { prisma } = await import('../lib/db');
  const bcrypt = (await import('bcryptjs')).default;
  const { decryptSecret } = await import('../lib/crypto/orgSecret');
  const { generateOrgPassword, sealOrgPassword } = await import('../lib/orgs/credentials');
  const { generateAdminPassword } = await import('../lib/admin/password');
  const { replaceCaseChunks } = await import('../lib/retrieval/embedCaseChunks');

  try {
    // Second tripwire for remote databases: a staging DB is either empty or was seeded by this script.
    const seedOrg = await prisma.organization.findUnique({ where: { email: SEED_ORG_EMAIL } });
    if (target === 'staging' && !seedOrg) {
      const [cases, leads] = await Promise.all([prisma.caseStudy.count(), prisma.lead.count()]);
      if (cases > 0 || leads > 0) {
        throw new Error(
          `Remote database has ${cases} case(s) and ${leads} lead(s) but no seed organization. ` +
            'It does not look like a fresh staging database. Refusing.',
        );
      }
    }

    const credFile = join(seedDir(), `credentials.${target}.json`);
    const prev: Partial<Credentials> = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};

    // ── Organization (password kept across runs; re-sealed if it cannot be decrypted) ──
    let orgPassword: string | null = null;
    if (seedOrg) {
      try {
        orgPassword = decryptSecret(seedOrg.passwordEnc);
      } catch {
        orgPassword = null;
      }
    }
    let orgAction = 'kept';
    if (!seedOrg || !orgPassword) {
      orgPassword = generateOrgPassword();
      const sealed = await sealOrgPassword(orgPassword);
      orgAction = seedOrg ? 'password re-sealed' : 'created';
      await prisma.organization.upsert({
        where: { email: SEED_ORG_EMAIL },
        create: { name: SEED_ORG_NAME, email: SEED_ORG_EMAIL, ...sealed },
        update: { ...sealed, active: true },
      });
    }
    const org = await prisma.organization.findUniqueOrThrow({ where: { email: SEED_ORG_EMAIL } });

    // ── Verified buyer (emailVerified skips OTP at identify) ──
    await prisma.agentUser.upsert({
      where: { email: SEED_BUYER_EMAIL },
      create: {
        email: SEED_BUYER_EMAIL,
        name: 'Seed Buyer',
        affiliation: SEED_ORG_NAME,
        emailVerified: true,
        organizationId: org.id,
      },
      update: { emailVerified: true, blocked: false, organizationId: org.id },
    });

    // ── Adviser admin (bcrypt only; password reused from the credentials file when it still verifies) ──
    const admin = await prisma.adviserAdmin.findUnique({ where: { email: SEED_ADMIN_EMAIL } });
    let adminPassword = prev.admin?.password ?? '';
    let adminAction = 'kept';
    if (!admin || !adminPassword || !(await bcrypt.compare(adminPassword, admin.passwordHash))) {
      adminPassword = generateAdminPassword();
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      adminAction = admin ? 'password reset' : 'created';
      await prisma.adviserAdmin.upsert({
        where: { email: SEED_ADMIN_EMAIL },
        create: { name: 'Seed Admin', email: SEED_ADMIN_EMAIL, passwordHash },
        update: { passwordHash, active: true },
      });
    }

    const creds: Credentials = {
      target,
      updatedAt: new Date().toISOString(),
      org: { name: SEED_ORG_NAME, email: SEED_ORG_EMAIL, password: orgPassword },
      buyer: { email: SEED_BUYER_EMAIL, note: 'Email already verified: org login, then identify with this email (no OTP).' },
      admin: { email: SEED_ADMIN_EMAIL, password: adminPassword },
    };
    writeFileSync(credFile, JSON.stringify(creds, null, 2));

    // ── Cases ──
    const drafts = readCaseDrafts().filter((d) => !APPROVED_ONLY || d.approved);
    const cache = await startEmbeddingCache(`seed:${target}`);
    const caseLines: string[] = [];
    try {
      for (const d of drafts) {
        const data = {
          title: d.title,
          subtitle: d.subtitle,
          image: '',
          heroImage: '',
          industry: d.industry,
          businessFunction: d.businessFunction,
          description: d.subtitle,
          clientName: null,
          clientIndustry: d.industry || null,
          challenges: d.sections.challenge,
          solution: d.sections.solution,
          benefits: d.sections.results,
          overview: d.sections.overview,
          challenge: d.sections.challenge,
          results: d.sections.results,
          summary: d.subtitle,
          tech: d.tech.map((title) => ({ title, description: '' })),
          peBacked: d.peBacked,
          agentEnabled: true,
        };
        const row = await prisma.caseStudy.upsert({
          where: { slug: d.slug },
          create: { slug: d.slug, ...data },
          update: data,
          select: { id: true },
        });
        await prisma.caseTech.deleteMany({ where: { caseId: row.id, name: { notIn: d.tech } } });
        await prisma.caseTech.createMany({
          data: d.tech.map((name) => ({ caseId: row.id, name })),
          skipDuplicates: true,
        });
        const { chunkCount } = await replaceCaseChunks(row.id);
        caseLines.push(`  ${d.slug}: ${d.tech.length} tech, ${chunkCount} chunks${d.approved ? '' : ' (draft, not approved)'}`);
      }

      // ── Knowledge base (existing ingest script, same database and cache) ──
      await runScript('scripts/ingest-knowledge-base.ts', ['--apply'], join(seedDir(), `ingest-kb.${target}.log`));
    } finally {
      await cache.stop();
    }

    const [cases, chunks, techs, content, orgs, users, admins] = await Promise.all([
      prisma.caseStudy.count(),
      prisma.caseChunk.count(),
      prisma.caseTech.count(),
      prisma.contentChunk.count(),
      prisma.organization.count(),
      prisma.agentUser.count(),
      prisma.adviserAdmin.count(),
    ]);
    const s = cache.stats();
    console.log(`Seeded ${target} database.`);
    console.log(`  organization ${orgAction}, admin ${adminAction}, buyer upserted`);
    console.log(`  credentials: ${credFile}`);
    console.log(`Cases loaded: ${drafts.length}${APPROVED_ONLY ? ' (approved only)' : ''}`);
    caseLines.forEach((l) => console.log(l));
    console.log(
      `Totals: CaseStudy ${cases}, CaseTech ${techs}, CaseChunk ${chunks}, ContentChunk ${content}, ` +
        `Organization ${orgs}, AgentUser ${users}, AdviserAdmin ${admins}`,
    );
    console.log(`Embeddings: ${s.hits} cached, ${s.misses} new, ${s.upstreamCalls} API call(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
