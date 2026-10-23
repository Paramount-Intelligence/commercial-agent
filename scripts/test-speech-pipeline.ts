import { OrderedSpeechPipeline } from '../lib/voice/speechPipeline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function main() {
  const prepared = [deferred<string>(), deferred<string>(), deferred<string>()];
  const prepareStarted: number[] = [];
  const played: string[] = [];
  const pipeline = new OrderedSpeechPipeline<string, string>(
    async (_text, index) => {
      prepareStarted.push(index);
      return prepared[index]!.promise;
    },
    async (audio) => {
      played.push(audio);
    },
    { maxAhead: 2 },
  );

  pipeline.enqueue('one');
  pipeline.enqueue('two');
  pipeline.enqueue('three');
  check(
    'pipeline bounds preparation to current plus one',
    prepareStarted.join(',') === '0,1',
  );
  prepared[1]!.resolve('audio-two');
  await Promise.resolve();
  check('later prepared audio cannot play out of order', played.length === 0);
  prepared[0]!.resolve('audio-one');
  await new Promise((resolve) => setTimeout(resolve, 0));
  check('first prepared sentence plays first', played[0] === 'audio-one');
  check('third preparation begins after first playback', prepareStarted.includes(2));
  prepared[2]!.resolve('audio-three');
  await pipeline.close();
  check(
    'all sentences play in order',
    played.join(',') === 'audio-one,audio-two,audio-three',
  );
  check('pipeline never exceeds configured lookahead', pipeline.stats().maxAheadObserved === 2);

  const abort = new AbortController();
  const blocked = deferred<string>();
  let cancelledPlay = false;
  const cancellable = new OrderedSpeechPipeline<string, string>(
    async () => blocked.promise,
    async () => {
      cancelledPlay = true;
    },
    { signal: abort.signal },
  );
  cancellable.enqueue('cancel me');
  abort.abort();
  const cancelError = await cancellable.close().catch((error: unknown) => error);
  check(
    'abort releases a blocked pipeline',
    cancelError instanceof DOMException && cancelError.name === 'AbortError',
  );
  check('aborted prepared audio never plays', !cancelledPlay);

  const voiceSource = readFileSync(
    join(process.cwd(), 'app/(agent)/voice/VoiceConversation.tsx'),
    'utf8',
  );
  check(
    'Flux and Fish fallback both use the ordered pipeline',
    voiceSource.match(/new OrderedSpeechPipeline<SpeechSegment, Response>/g)
      ?.length === 2,
  );
  check(
    'both voice paths bound synthesis to one segment ahead',
    voiceSource.match(/maxAhead: 2/g)?.length === 2,
  );
  check(
    'legacy playback-serialized promise queue is removed',
    !voiceSource.includes('speechQueue = speechQueue.then'),
  );
  check(
    'stream timing records the first checked sentence',
    voiceSource.match(/markTiming\(timing, 'firstSentence'\)/g)?.length === 2,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
