/**
 * Unit tests for failure-alert throttle (no network).
 *
 *   npm run alerts:test
 */
import {
  consumeFailureAlertThrottle,
  resetFailureAlertThrottleForTests,
} from '../lib/alerts/failureAlert';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function main() {
  resetFailureAlertThrottleForTests();
  const t0 = 1_000_000;

  const first = consumeFailureAlertThrottle('used_fallback:org1', t0);
  check('first alert in window sends', first.send && first.suppressedSinceLastSend === 0);

  const second = consumeFailureAlertThrottle('used_fallback:org1', t0 + 60_000);
  check('second alert in same window throttled', !second.send && second.suppressedSinceLastSend === 1);

  const third = consumeFailureAlertThrottle('used_fallback:org1', t0 + 120_000);
  check('third still throttled', !third.send && third.suppressedSinceLastSend === 2);

  const otherOrg = consumeFailureAlertThrottle('used_fallback:org2', t0 + 120_000);
  check('different org key is independent', otherOrg.send);

  const otherKind = consumeFailureAlertThrottle('tts_timeout:org1', t0 + 120_000);
  check('different kind key is independent', otherKind.send);

  const nextWindow = consumeFailureAlertThrottle(
    'used_fallback:org1',
    t0 + 10 * 60 * 1000,
  );
  check(
    'new window sends and reports prior suppressions',
    nextWindow.send && nextWindow.suppressedSinceLastSend === 2,
    `suppressed=${nextWindow.suppressedSinceLastSend}`,
  );

  console.log('\n' + '='.repeat(48));
  console.log(
    failed === 0
      ? `ALL PASSED (${passed})`
      : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
