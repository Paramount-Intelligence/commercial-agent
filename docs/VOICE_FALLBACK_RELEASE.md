# Phase 4F — fallback and release hardening

## Runtime policy

Deepgram Flux is the primary browser listener. Fish transcription remains the
automatic fallback whenever Flux is connecting, temporarily unavailable or has
exhausted its bounded reconnect attempts. The fallback uses the existing local
VAD recorder and the same checked-response speech pipeline as Flux turns.

Operators can switch listening fully back to Fish with:

```text
NEXT_PUBLIC_VOICE_STT_PROVIDER=fish
```

`NEXT_PUBLIC_VOICE_STT_FALLBACK=0` disables automatic Fish capture only when
Deepgram is selected. An explicit Fish selection always remains functional.

## Recovery guarantees

- Token requests use the session abort signal and cannot outlive a closed tab,
  microphone shutdown or session rollover.
- Unexpected Flux socket closure releases its AudioContext, capture worklet and
  graph before reconnecting, preventing duplicate microphone pipelines.
- Reconnect uses fresh short-lived credentials and bounded exponential backoff.
- Fish VAD remains active during every reconnect gap.
- Intentional shutdown does not surface as a connection failure.
- Phase 4C cancellation still owns in-flight agent, TTS and playback work.

## Release checks

Before production promotion:

1. Run the complete unit suite and TypeScript check.
2. Build the production bundle.
3. Verify staging authentication and the Deepgram token route (401 signed out;
   successful short-lived grant signed in without exposing the token).
4. Run voice smoke checks for first audio, a multi-sentence reply, interruption,
   topic change and Fish fallback.
5. Compare the recorded latency/interruption report with the Phase 4A baseline.
