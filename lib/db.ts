import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Keep the pool small for Next.js (dev HMR + concurrent voice/chat routes).
 * Long ElevenLabs STT calls must not pin many idle connections against
 * Prisma Postgres (db.prisma.io), or later session reads hit P2024/P1001.
 */
function databaseUrlWithPoolLimits(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set(
        'connection_limit',
        process.env.PRISMA_CONNECTION_LIMIT?.trim() || '5',
      );
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set(
        'pool_timeout',
        process.env.PRISMA_POOL_TIMEOUT?.trim() || '20',
      );
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function createPrismaClient(): PrismaClient {
  const url = databaseUrlWithPoolLimits();
  return new PrismaClient(
    url
      ? {
          datasources: { db: { url } },
        }
      : undefined,
  );
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** True for pool exhaustion / unreachable Postgres (transient infra). */
export function isPrismaConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code =
    'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  if (
    code === 'P1001' ||
    code === 'P1017' ||
    code === 'P2024' ||
    code === 'P1002'
  ) {
    return true;
  }
  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("can't reach database server") ||
    message.includes('timed out fetching a new connection') ||
    message.includes('connection pool') ||
    message.includes('server has closed the connection')
  );
}
