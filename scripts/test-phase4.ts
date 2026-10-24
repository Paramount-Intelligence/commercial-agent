import { SentenceStream, isActionToolTurn } from '../lib/agent/sentenceStream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEEPGRAM_FLUX_CONFIG,
  eagerEotEnabled,
  fishListeningEnabled,
  fishSttFallbackEnabled,
  fluxReconnectDelayMs,
  voiceSttProvider,
} from '../lib/voice/deepgramConfig';
import { VOICE_CONFIG } from '../lib/voice/config';

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
  stream.push(' AI systems. They ship quickly. Next').join('|') ===
    'We build practical AI systems.|They ship quickly.',
);
const abbreviationStream = new SentenceStream();
check(
  'abbreviation is not split',
  abbreviationStream.push('Dr. Ali can help. Next').join('|') === 'Dr. Ali can help.',
);
const fragmentStream = new SentenceStream();
check(
  'final fragment flushes',
  fragmentStream.push('Would you like an example').length === 0 &&
    fragmentStream.flush()[0] === 'Would you like an example',
);

const citedStream = new SentenceStream();
check(
  'punctuation waits for a possible trailing citation',
  citedStream.push('We build production AI systems. ').length === 0,
);
check(
  'trailing citation stays on the checked sentence',
  citedStream.push('[[src:approved-1]] Would you like an example? ').join('|') ===
    'We build production AI systems. [[src:approved-1]]',
);

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
check(
  'explicit Fish selection stays available when fallback is disabled',
  fishListeningEnabled({
    NEXT_PUBLIC_VOICE_STT_PROVIDER: 'fish',
    NEXT_PUBLIC_VOICE_STT_FALLBACK: '0',
  }),
);
check(
  'Flux can run without Fish only when fallback is explicitly disabled',
  !fishListeningEnabled({
    NEXT_PUBLIC_VOICE_STT_PROVIDER: 'deepgram',
    NEXT_PUBLIC_VOICE_STT_FALLBACK: '0',
  }),
);
check('eager end-of-turn defaults on', eagerEotEnabled({}));
check(
  'Flux sends provider-safe frame sizes',
  DEEPGRAM_FLUX_CONFIG.frameMs >= 20 && DEEPGRAM_FLUX_CONFIG.frameMs <= 100,
);
check(
  'Flux turn thresholds favor low latency without aggressive cutoffs',
  DEEPGRAM_FLUX_CONFIG.eagerEotThreshold === 0.5 &&
    DEEPGRAM_FLUX_CONFIG.eotThreshold === 0.7 &&
    DEEPGRAM_FLUX_CONFIG.eotTimeoutMs <= 4_000,
);
check(
  'Fish first synthesis unit uses the provider minimum',
  VOICE_CONFIG.TTS_CHUNK_LENGTH === 100,
);
check('Flux reconnect starts quickly', fluxReconnectDelayMs(0) === 500);
check(
  'Flux reconnect backoff is bounded',
  fluxReconnectDelayMs(20) === DEEPGRAM_FLUX_CONFIG.reconnect.maxDelayMs,
);
check(
  'Flux sessions roll before becoming stale',
  DEEPGRAM_FLUX_CONFIG.maxSessionMs > 0 &&
    DEEPGRAM_FLUX_CONFIG.maxSessionMs <= 30 * 60 * 1_000,
);
check(
  'browser voice config uses statically replaceable NEXT_PUBLIC reads',
  readFileSync(join(process.cwd(), 'lib/voice/deepgramConfig.ts'), 'utf8').includes(
    'const BUILT_STT_PROVIDER = process.env.NEXT_PUBLIC_VOICE_STT_PROVIDER;',
  ),
);
check(
  'local barge-in ducks quickly',
  VOICE_CONFIG.VAD.BARGE_IN_GRACE_MS <= 100,
);
check(
  'local hard-cancel fallback meets interruption target',
  VOICE_CONFIG.VAD.LOCAL_HARD_CANCEL_MS <= 300 &&
    VOICE_CONFIG.VAD.BARGE_IN_SUSTAIN_MS <= 300,
);

const voiceSource = readFileSync(
  join(process.cwd(), 'app/(agent)/voice/VoiceConversation.tsx'),
  'utf8',
);
const agentLoopSource = readFileSync(
  join(process.cwd(), 'lib/agent/loop.ts'),
  'utf8',
);
check(
  'voice runtime omits duplicated core corpus but retains retrieved evidence',
  agentLoopSource.includes('omitCoreDocs: approved && input.voiceMode === true') &&
    agentLoopSource.includes('pre?.evidence.block'),
);
check(
  'read-only Sonnet turns disable hidden thinking at low effort',
  agentLoopSource.includes('const directReadOnly = model === MODEL && toolsOffered.length === 0') &&
    agentLoopSource.includes("thinking: { type: 'disabled' as const }") &&
    agentLoopSource.includes("output_config: { effort: 'low' as const }"),
);
check(
  'voice startup opens listening before intro playback',
  voiceSource.indexOf('await enableHandsFreeMic();') <
    voiceSource.indexOf('const intro = await playJackieIntro();'),
);
check(
  'voice startup no longer synthesizes every fixed line',
  !voiceSource.includes('prepareJackieAudio'),
);
check(
  'MSE playback is armed before the first MP3 append completes',
  voiceSource.indexOf('const playPromise = audio.play();') >= 0 &&
    voiceSource.indexOf('const playPromise = audio.play();') <
      voiceSource.indexOf('sourceBuffer.appendBuffer(copy)'),
);
check(
  'barge-in uses two-stage duck then hard cancellation',
  voiceSource.includes('duckResponseAudio()') &&
    voiceSource.includes("hardCancelActiveTurn('flux-start')") &&
    voiceSource.includes('VAD.LOCAL_HARD_CANCEL_MS'),
);
check(
  'interruption acknowledgements are not spoken',
  !voiceSource.includes('playInterruptAck') &&
    !voiceSource.includes('INTERRUPT_ACKS'),
);
const workletSource = readFileSync(
  join(process.cwd(), 'public/voice/pcm-capture-worklet.js'),
  'utf8',
);
check(
  'PCM capture worklet is registered',
  workletSource.includes("registerProcessor('pcm-capture-processor'"),
);
const fluxSource = readFileSync(
  join(process.cwd(), 'lib/voice/deepgramFluxBrowser.ts'),
  'utf8',
);
check(
  'closing a Flux session aborts an in-flight token request',
  fluxSource.includes('fetchToken(abort.signal)') &&
    fluxSource.includes('signal,'),
);
check(
  'intentional Flux shutdown does not report a connection failure',
  fluxSource.includes('if (closed || abort.signal.aborted) return;'),
);
check(
  'Flux overlaps token minting but buffers audio before awaiting it',
  fluxSource.indexOf('const accessTokenPromise = fetchToken(abort.signal)') >= 0 &&
  fluxSource.indexOf('createMediaStreamSource(stream)') >= 0 &&
    fluxSource.indexOf('createMediaStreamSource(stream)') <
      fluxSource.indexOf('await accessTokenPromise'),
);
check(
  'Fish waits for a real Flux connection failure',
  voiceSource.includes("voiceSttProvider() === 'fish' || !fluxSessionRef.current"),
);
const remoteCloseBlock = voiceSource.slice(
  voiceSource.indexOf('onClose: () => {'),
  voiceSource.indexOf('onClose: () => {') + 650,
);
check(
  'remote Flux close releases capture before reconnect',
  remoteCloseBlock.indexOf('session.close();') >= 0 &&
    remoteCloseBlock.indexOf('session.close();') <
      remoteCloseBlock.indexOf("scheduleFluxReconnect(stream, 'closed')"),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
