/**
 * Latency details (timingMs in API responses, the voice ?debug=1 panel) are
 * shown only to an adviser admin or when TIMING_DEBUG=1. Server logs always
 * keep timings.
 */
import { readAdminSession } from '../auth/adminSession';

export function timingDebugEnvOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.TIMING_DEBUG?.trim() === '1';
}

export async function timingDebugAllowed(): Promise<boolean> {
  if (timingDebugEnvOn()) return true;
  try {
    return Boolean(await readAdminSession());
  } catch {
    return false;
  }
}

/** Spread into a JSON response: `{ ...timingField(allowed, timer) }`. */
export function timingField(
  allowed: boolean,
  timer: { phases: () => Record<string, number>; total: () => number },
): { timingMs?: Record<string, number> } {
  return allowed ? { timingMs: { ...timer.phases(), total: timer.total() } } : {};
}
