/**
 * Unit tests for the latency-debug gate (no database).
 *
 *   npx tsx scripts/test-timing-debug.ts
 */
import { timingDebugEnvOn, timingField } from '../lib/debug/timingDebug';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const timer = { phases: () => ({ model: 1200 }), total: () => 1500 };
ok('TIMING_DEBUG unset is off', !timingDebugEnvOn({}));
ok('TIMING_DEBUG=0 is off', !timingDebugEnvOn({ TIMING_DEBUG: '0' }));
ok('TIMING_DEBUG=1 is on', timingDebugEnvOn({ TIMING_DEBUG: '1' }));
ok('no timingMs when not allowed', !('timingMs' in timingField(false, timer)));
ok('timingMs with total when allowed', timingField(true, timer).timingMs?.total === 1500);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
