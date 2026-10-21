/**
 * Client names that may not be shown to buyers yet, for lib/safety/buyerOutput.
 *
 * Source: every non-empty CaseStudy.clientName (no case name is approved until
 * Phase 2 adds the approval field), plus the optional CONFIDENTIAL_NAMES env
 * var (comma-separated) for names that are not in that column. Nothing is
 * hard-coded. Cached for 5 minutes per instance.
 */
import { prisma } from '../db';
import type { ClientName } from './buyerOutput';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; names: ClientName[] } | null = null;

export function envConfidentialNames(env: Record<string, string | undefined> = process.env): ClientName[] {
  return (env.CONFIDENTIAL_NAMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .map((name) => ({ name }));
}

export async function unapprovedClientNames(): Promise<ClientName[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.names;
  let fromDb: ClientName[] = [];
  try {
    const rows = await prisma.caseStudy.findMany({
      where: { clientName: { not: null } },
      select: { clientName: true },
      distinct: ['clientName'],
    });
    fromDb = rows
      .map((r) => r.clientName?.trim() ?? '')
      .filter((n) => n.length >= 3 && !/^(n\/a|na|confidential|confidential client|-)$/i.test(n))
      .map((name) => ({ name }));
  } catch (err) {
    console.error('[safety/clientNames] lookup failed; using env names only', err instanceof Error ? err.message : err);
  }
  const names = [...fromDb, ...envConfidentialNames()];
  cache = { at: Date.now(), names };
  return names;
}

/** Tests only. */
export function resetClientNameCache(): void {
  cache = null;
}
