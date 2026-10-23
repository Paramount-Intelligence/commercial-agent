import { VoiceSessionController } from '../lib/voice/sessionController';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

const session = new VoiceSessionController();
const first = session.begin();
const firstAbort = new AbortController();
check('new turn is current', session.isCurrent(first));
check('controller registers on current turn', session.register(first, firstAbort));
check('current turn transitions to responding', session.transition(first, 'responding'));

const cancelled = session.cancelActive('flux-start');
check('cancel aborts registered work', firstAbort.signal.aborted);
check('cancel records interruption reason', cancelled?.cancelReason === 'flux-start');
check('cancelled turn is no longer current', !session.isCurrent(first));
check('cancel is idempotent', session.cancelActive('local-vad') === null);

const second = session.begin();
const staleAbort = new AbortController();
check('turn ids are monotonic', second > first);
check('stale registration is rejected', !session.register(first, staleAbort));
check('stale registration is aborted immediately', staleAbort.signal.aborted);
check('stale transition cannot mutate current turn', !session.transition(first, 'responding'));
check('current turn completes', session.complete(second));
check('completed turn is no longer current', !session.isCurrent(second));

const third = session.begin();
const thirdAbort = new AbortController();
session.register(third, thirdAbort);
const fourth = session.begin();
check('new turn supersedes previous work', thirdAbort.signal.aborted);
check('superseding turn becomes current', session.isCurrent(fourth));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
