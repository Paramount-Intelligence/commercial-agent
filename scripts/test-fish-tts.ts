/**
 * Unit tests for Fish TTS Slice 1 (no live Fish call by default).
 *
 *   npm run tts:test
 *
 * Optional live smoke (needs FISH_API_KEY + FISH_VOICE_ID):
 *   FISH_TTS_LIVE=1 npm run tts:test
 */
import { VOICE_CONFIG } from '../lib/voice/config';
import {
  estimateTtsCostUsd,
  isFishTtsFreeModel,
  resolveFishTtsModel,
} from '../lib/gating/costRates';
import {
  synthesizeSpeech,
  truncateForTts,
  TtsConfigError,
  TtsTimeoutError,
} from '../lib/voice/fishAudio';

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

async function main() {
  const short = 'Hello from Jackie.';
  const shortResult = truncateForTts(short);
  check(
    'char-cap leaves short text unchanged',
    shortResult.text === short &&
      shortResult.inputChars === short.length &&
      shortResult.truncated === false,
  );

  const long = `${'Sentence one goes here with more words. '.repeat(50)}Final line.`;
  const capped = truncateForTts(long);
  check(
    'char-cap applied before request (≤ MAX_CHARS)',
    capped.truncated === true &&
      capped.text.length <= VOICE_CONFIG.MAX_CHARS_PER_REQUEST &&
      capped.inputChars === long.trim().length &&
      capped.inputChars > VOICE_CONFIG.MAX_CHARS_PER_REQUEST,
    `len=${capped.text.length} input=${capped.inputChars} max=${VOICE_CONFIG.MAX_CHARS_PER_REQUEST} truncated=${capped.truncated}`,
  );

  const prevVoice = process.env.FISH_VOICE_ID;
  const prevKey = process.env.FISH_API_KEY;
  delete process.env.FISH_VOICE_ID;
  process.env.FISH_API_KEY = process.env.FISH_API_KEY || 'test-key-not-used';
  let unsetVoiceThrew = false;
  let unsetVoiceConfig = false;
  try {
    await synthesizeSpeech('Should not reach Fish without a voice id.');
  } catch (err) {
    unsetVoiceThrew = true;
    unsetVoiceConfig = err instanceof TtsConfigError;
  }
  check(
    'unset FISH_VOICE_ID degrades (TtsConfigError)',
    unsetVoiceThrew && unsetVoiceConfig,
  );
  if (prevVoice !== undefined) process.env.FISH_VOICE_ID = prevVoice;
  else delete process.env.FISH_VOICE_ID;
  if (prevKey !== undefined) process.env.FISH_API_KEY = prevKey;

  const prevModel = process.env.FISH_TTS_MODEL;
  process.env.FISH_TTS_MODEL = 's2.1-pro-free';
  check(
    '*-free model maps $-cost to 0',
    isFishTtsFreeModel() && estimateTtsCostUsd(50_000) === 0,
    `model=${resolveFishTtsModel()} cost=${estimateTtsCostUsd(50_000)}`,
  );
  process.env.FISH_TTS_MODEL = 's2.1-pro';
  check(
    'paid model still estimates non-zero $-cost',
    !isFishTtsFreeModel() && estimateTtsCostUsd(1_000) > 0,
    `cost=${estimateTtsCostUsd(1_000)}`,
  );
  if (prevModel !== undefined) process.env.FISH_TTS_MODEL = prevModel;
  else delete process.env.FISH_TTS_MODEL;

  // Abuse ceiling is independent of $-cost — voiceLimit still counts chars.
  // (Unit-level: free model cost is 0 while char count for metering remains.)
  check(
    'free model still exposes character metering input (chars counted)',
    truncateForTts('x'.repeat(500)).inputChars === 500,
  );

  // Timeout: abort signal already aborted → TtsTimeoutError (no network wait).
  process.env.FISH_API_KEY = process.env.FISH_API_KEY || 'test-key';
  process.env.FISH_VOICE_ID = process.env.FISH_VOICE_ID || 'test-voice-id';
  const alreadyAborted = AbortSignal.abort();
  let timedOut = false;
  try {
    await synthesizeSpeech('Timeout probe.', { signal: alreadyAborted });
  } catch (err) {
    timedOut = err instanceof TtsTimeoutError || isAbortLike(err);
  }
  check('pre-aborted signal fails closed (timeout/abort path)', timedOut);

  if (process.env.FISH_TTS_LIVE === '1') {
    const liveKey = process.env.FISH_API_KEY?.trim();
    const liveVoice = process.env.FISH_VOICE_ID?.trim();
    if (!liveKey || !liveVoice || liveVoice === 'test-voice-id') {
      check(
        'live Fish call skipped — set real FISH_API_KEY + FISH_VOICE_ID',
        false,
      );
    } else {
      try {
        const result = await synthesizeSpeech('Jackie live Fish Audio smoke test.');
        const reader = result.stream.getReader();
        const first = await reader.read();
        await reader.cancel().catch(() => {});
        check(
          'live Fish call returns playable mp3 bytes',
          Boolean(result.chars > 0 && first.value && first.value.byteLength > 0),
          `chars=${result.chars} firstBytes=${first.value?.byteLength ?? 0}`,
        );
      } catch (err) {
        check(
          'live Fish call returns playable mp3 bytes',
          false,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  console.log('\n' + '='.repeat(48));
  console.log(
    failed === 0
      ? `ALL PASSED (${passed})`
      : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

function isAbortLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    /aborted|timeout/i.test(err.message)
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
