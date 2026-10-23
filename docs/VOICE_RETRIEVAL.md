# Voice retrieval latency (Phase 4D)

Substantive voice turns start approved-knowledge retrieval at the beginning of
the agent turn, in parallel with prompt assembly and conversation I/O. Obvious
greetings, thanks and small talk skip retrieval and omit tools.

The latency path has three cache levels:

1. A 60-second, 200-entry in-process result cache reuses the complete evidence
   prepared by Flux eager-end-of-turn prewarming. Keys are SHA-256 hashes of
   normalized text; raw buyer questions are not retained in this cache.
2. The existing per-instance embedding LRU avoids repeated provider calls.
3. `QueryEmbeddingCache` shares embeddings across Vercel instances for seven
   days. A shared-cache read gets 150 ms before the path continues upstream.

Voice retrieval has a real 800 ms end-to-end deadline. The deadline covers the
shared cache read, embedding, vector search, knowledge lists and document load.
If any part is slow, the turn continues without automatic evidence; existing
grounding and validation rules still prevent unsupported claims. Chat uses the
same path with a 1,200 ms deadline.

An individual cancelled prewarm/request stops waiting but does not cancel
shared embedding work that another turn may already be using. The background
work remains bounded by the embedding client ceiling and can still warm the
cache.

## Verification

- `npx tsc --noEmit`
- `npm run test:unit`
- `npx tsx scripts/test-phase4-retrieval.ts`
- On an authenticated local/staging voice session, inspect timing logs for
  `pre-retrieval`: `ms` must stay within the channel deadline and `cacheTier`
  should move from `memory-or-upstream`/`shared` to `result` after a successful
  eager prewarm.
- Confirm greetings log `tools withheld for conversational turn` and no
  `pre-retrieval` record.
