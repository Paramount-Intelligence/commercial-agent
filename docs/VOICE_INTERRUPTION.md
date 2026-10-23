# Voice interruption (Phase 4C)

Phase 4C keeps the microphone live while the assistant responds and uses a
two-stage interruption policy:

1. Local speech-like energy ducks response audio immediately after the 80 ms
   playback grace period.
2. Deepgram Flux `StartOfTurn` confirms the interruption and atomically aborts
   the model stream, TTS requests, playback and captions.
3. If the provider event is delayed, 250 ms of continuous local speech performs
   the same hard cancellation. Fish fallback uses the same 250 ms confirmation.
4. A transient local spike restores playback and is recorded as a false
   interruption candidate. No spoken acknowledgement is played over the buyer.

The current session controller gives every buyer turn a monotonic ID. All
network abort controllers register against that ID, and stale callbacks must
verify that the ID is still current before changing playback or transcript UI.

## Manual browser checks

- Start speaking over a long answer. Audio should duck immediately and stop
  within 300 ms, while the new utterance is captured in full.
- Make a short click or cough during playback. Audio may duck briefly but must
  resume without cancelling the answer.
- Interrupt during both “processing” and “speaking”; the cancelled answer must
  never resume or append a late caption.
- Press Stop and click/keyboard-activate the orb. Each path must cancel model,
  TTS and playback work and return to idle without an acknowledgement clip.
- Disable Flux with `NEXT_PUBLIC_VOICE_STT_PROVIDER=fish` and repeat the barge-in
  test to exercise the bounded local fallback.

Use the debug timing panel or its JSON export to verify interruption p95 is at
or below 300 ms and false interruptions remain below 1% across a representative
device/noise sample.
