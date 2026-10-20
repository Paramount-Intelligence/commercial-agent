/**
 * Apply migrations to the STAGING database from this machine, only after the
 * strict db guard confirms the URLs in .env.staging are the fingerprinted
 * staging database (Vercel project commercial-agent-staging). Its own builds
 * also run migrate deploy; this is for setup and checks from this machine.
 *
 *   npm run migrate:staging
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { assertLocalDatabase } from '../lib/dbGuard';

const target = assertLocalDatabase(process.env, { strict: true });
if (target !== 'staging') {
  console.error(`Configured database is ${target}, not staging. Refusing.`);
  process.exit(1);
}

const prismaCli = join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
child.on('close', (code) => process.exit(code ?? 1));
