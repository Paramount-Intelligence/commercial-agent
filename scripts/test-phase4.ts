import { SentenceStream, isActionToolTurn } from '../lib/agent/sentenceStream';
import {
  DEEPGRAM_FLUX_CONFIG,
  eagerEotEnabled,
  fishSttFallbackEnabled,
  voiceSttProvider,
} from '../lib/voice/deepgramConfig';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const stream = new SentenceStream();
check('partial sentence is held', stream.push('We build practical').length === 0);
check(
  'whole checked sentence is emitted',
  stream.push(' AI systems. They ship quickly. ').join('|') ===
    'We build practical AI systems.|They ship quickly.',
);
check('abbreviation is not split', stream.push('Dr. Ali can help. ').join('|') === 'Dr. Ali can help.');
check('final fragment flushes', stream.push('Would you like an example').length === 0 && stream.flush()[0] === 'Would you like an example');

check('lead intent retains tools', isActionToolTurn('please contact me', true));
check('one-pager request retains tools', isActionToolTurn('Send the one-pager', false));
check('read-only capability turn streams without tools', !isActionToolTurn('What can you build?', false));
check(
  'affirmative follow-up retains prior offered action',
  isActionToolTurn('yes', false, 'Would you like me to share the PDF?'),
);

check('Deepgram Flux is the default STT', voiceSttProvider({}) === 'deepgram');
check('Fish listening remains selectable', voiceSttProvider({ NEXT_PUBLIC_VOICE_STT_PROVIDER: 'fish' }) === 'fish');
check('Fish fallback defaults on', fishSttFallbackEnabled({}));
check('Fish fallback can be disabled', !fishSttFallbackEnabled({ NEXT_PUBLIC_VOICE_STT_FALLBACK: '0' }));
check('eager end-of-turn defaults on', eagerEotEnabled({}));
check(
  'Flux sends provider-safe frame sizes',
  DEEPGRAM_FLUX_CONFIG.frameMs >= 20 && DEEPGRAM_FLUX_CONFIG.frameMs <= 100,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
