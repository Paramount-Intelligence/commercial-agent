import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isConversationalNoToolsTurn } from '../lib/agent/conversationalTurn';
import {
  RetrievalDeadlineError,
  waitForRetrieval,
} from '../lib/retrieval/deadline';
import { TimedResultCache } from '../lib/retrieval/timedResultCache';

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

async function main() {
  const quick = await waitForRetrieval(Promise.resolve('ready'), {
    deadlineMs: 100,
  });
  check('retrieval returns work completed before deadline', quick === 'ready');

  let deadlineCallback = false;
  let deadlineError: unknown;
  try {
    await waitForRetrieval(
      new Promise((resolve) => setTimeout(resolve, 80)),
      {
        deadlineMs: 10,
        onDeadline: () => {
          deadlineCallback = true;
        },
      },
    );
  } catch (error) {
    deadlineError = error;
  }
  check(
    'retrieval deadline releases the critical path',
    deadlineError instanceof RetrievalDeadlineError && deadlineCallback,
  );

  const abort = new AbortController();
  const abortedWait = waitForRetrieval(
    new Promise((resolve) => setTimeout(resolve, 80)),
    { deadlineMs: 100, signal: abort.signal },
  ).catch((error: unknown) => error);
  abort.abort();
  const abortError = await abortedWait;
  check(
    'caller cancellation releases retrieval wait',
    abortError instanceof DOMException && abortError.name === 'AbortError',
  );

  let now = 1_000;
  const cache = new TimedResultCache<number>(2, 50, () => now);
  cache.set('one', 1);
  cache.set('two', 2);
  check('prewarm result cache returns a warm value', cache.get('one') === 1);
  cache.set('three', 3);
  check(
    'prewarm result cache evicts least-recently-used value',
    cache.get('two') === undefined,
  );
  now += 51;
  check('prewarm result cache expires values', cache.get('one') === undefined);

  check('greeting skips retrieval', isConversationalNoToolsTurn('Hello there'));
  check(
    'thanks skips retrieval',
    isConversationalNoToolsTurn('Thanks, appreciate it'),
  );
  check(
    'substantive question keeps retrieval',
    !isConversationalNoToolsTurn(
      'What field service systems have we built?',
    ),
  );
  check(
    'affirmative follow-up keeps retrieval',
    !isConversationalNoToolsTurn('Yes, tell me more'),
  );

  const turnSource = readFileSync(
    join(process.cwd(), 'lib/knowledge/approved/turn.ts'),
    'utf8',
  );
  const cacheSource = readFileSync(
    join(process.cwd(), 'lib/retrieval/sharedQueryEmbedding.ts'),
    'utf8',
  );
  check(
    'end-to-end pre-retrieval work is deadline bounded',
    turnSource.includes('waitForRetrieval(') &&
      turnSource.includes('onDeadline: () => deadline.abort()'),
  );
  check(
    'prewarm cache keys do not retain raw buyer text',
    turnSource.includes(
      "createHash('sha256').update(normaliseQuery(message))",
    ),
  );
  check(
    'shared embedding work survives one cancelled waiter',
    cacheSource.includes('Shared work is deliberately independent') &&
      !cacheSource.includes('embedQuery(text, { signal: opts.signal })'),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
