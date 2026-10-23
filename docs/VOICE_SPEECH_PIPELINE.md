# Phase 4E — continuous response audio

## Shipped design

The browser starts Fish synthesis as soon as `/api/chat` emits the first fully
checked sentence. It does not wait for the complete model reply. This applies
to both Deepgram Flux turns and the Fish listening fallback.

`OrderedSpeechPipeline` keeps at most two speech segments active: the segment
being played and one prepared ahead. Preparation may finish out of order, but
playback is always in response order. This bounds Fish traffic while removing
most silence between sentences.

The safety boundary is unchanged. Raw model tokens are never sent to speech.
Only the server's checked `sentence` events are queued; once the final validated
reply arrives, any unsent suffix is chunked and queued. Citation tags and
speech-unfriendly formatting are removed with the existing voice cleaner.

The Phase 4C turn controller owns the chat request, all TTS requests, streamed
response bodies and active audio. Barge-in, the stop control and teardown abort
the same turn, so prefetched audio cannot play after cancellation.

## Playback details

- Fish response bytes continue to stream into MediaSource and playback starts
  after the first usable MP3 bytes arrive.
- Browsers without MP3 MediaSource support retain the Blob playback fallback.
- Object URLs are revoked after playback.
- The full validated answer replaces the progressive caption after the final
  segment, including citations and attachments.
- Voice quota and TTS failures retain the validated text answer on screen.

## Diagnostics and verification

Voice timings now record `firstSentence`, `chatToFirstSentence`, the first TTS
response measured from that sentence, segment count and maximum lookahead.

Run:

```text
npx tsx scripts/test-speech-pipeline.ts
npm run test:unit
npx tsc --noEmit
```

The pipeline test covers bounded lookahead, ordered playback when preparation
finishes out of order, and cancellation while synthesis is pending.
