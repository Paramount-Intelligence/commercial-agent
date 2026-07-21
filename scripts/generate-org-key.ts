/**
 * Print a fresh 32-byte key for ORG_SECRET_KEY (base64).
 *
 *   npx tsx scripts/generate-org-key.ts
 *
 * Add the output to .env.local:   ORG_SECRET_KEY=<value>
 * SENSITIVE: anyone with this key can decrypt every org password. Never commit it.
 */
import { randomBytes } from 'crypto';

console.log('Add this line to .env.local (keep it secret):\n');
console.log(`ORG_SECRET_KEY=${randomBytes(32).toString('base64')}`);
