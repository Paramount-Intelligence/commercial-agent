# Paramount Intelligence — Commercial AI Agent · Build Handover

_Last updated: 2026-07-16. Supersedes the prior handover (which predated embeddings,
the ID migration, and the AWS tag work — several of its "current state" claims are now
stale)._

## What this is
A gated, chat-based AI sales + technical adviser for Paramount Intelligence (a consulting
firm). It turns 45 case studies into a 24/7 adviser for Catalant reps, prospects,
buyer-side CTOs, and BD partners. Two portals over one agent core: external (client-facing
chat) + internal admin (for Marty to self-tune). Everything in the existing Next.js app,
TypeScript throughout, one repo.

Requirements source: "Commercial Agent Guide" (author Ahmed; commercial sign-off Marty;
technical sign-off Ali).

## Non-negotiable behaviors (from the guide) — STATUS
- **Pitch first, proof on request** — DONE, confirmed in live agent runs.
- **Never dead-end** — DONE (bridges to adjacent real cases; ranked-inclusive retrieval).
- **Never reveal a project's price** — DONE, hard guardrail; deflects to resource-shape +
  rate card; held under a live cost question.
- **Sell strongly, NEVER fabricate** — ENFORCED IN CODE via the citation validator (see below),
  not just prompt text.
- **Gated from day one** — NOT YET BUILT (next phase: chat UI + gating).

## Architecture decisions locked
- **DB: Prisma Postgres (db.prisma.io) + pgvector.** Migrated, live.
- **Shared Prisma singleton** at `lib/db.ts` — imported everywhere. App code NEVER calls
  `$disconnect()`; only scripts do (in `finally`). This boundary matters for the route
  handlers.
- **Retrieval is hybrid & ranked** — one `searchCases()` helper (raw SQL + pgvector inside,
  typed interface outside). Defaults to RANKED-inclusive, not strict filter.
- **System prompt = 4 layers**, assembled in order: base (git) → editable guidelines
  (admin DB) → auto case index → HARD GUARDRAILS (git, appended LAST, not overridable).
- **Anti-fabrication is CODE**: the validator string-matches every `[[case:ID]]` the model
  emits against the conversation's retrieved-ID set. Fail → regenerate once → safe fallback.
- **Model: `claude-sonnet-5`** via `@anthropic-ai/sdk`. Embeddings: OpenAI
  `text-embedding-3-small` (1536-dim, matches the committed `vector(1536)` column).
- **Buffer-and-gate**: the final composing turn is validated BEFORE the user sees it
  (non-streaming create + validate-then-return). Chosen over optimistic streaming because
  a briefly-visible fabricated citation is unacceptable for a credibility tool.

## Current DB state
- `CaseStudy` — 45 cases. **All IDs are now cuids** (see ID migration below).
- `CaseTech` — **195 rows** (was 192; +3 from AWS parent-tag backfill), 117-ish distinct techs.
- `TechAlias` — alias → canonical (prose variants only; does NOT model service→parent hierarchy).
- `CaseChunk` — **180 rows, all embedded** (45 cases × 4 sections: overview/challenge/solution/results).
  1536-dim vectors, verified non-null. `embedding` is `Unsupported("vector(1536)")` → all
  similarity via `prisma.$queryRaw` inside `searchCases()`.
- `Message` — added `retrievedCaseIds String[]` (migration applied) alongside existing
  `citedCaseIds[]`, so the validator's valid-ID set persists across turns.
- Agent tables in use: AgentUser, Conversation, Message. Still unused: PartnerLink, Lead,
  PromptVersion (has isLive/guidelines layer), UsageDay, Admin, CaseAsset.

## Retrieval spec — PROVEN
`searchCases({ query?, techs?, techMatch:'any'|'all', peMatch:'required'|'preferred', limit? })`
- Score = `1.0*techMatches + 0.5*peBacked + 0.4*bestChunkSimilarity` (best-chunk MAX, not mean).
- PE boost applies to score ONLY when tech matches exist; in pure-semantic mode PE is a
  sort tiebreak (fixed a bug where PE outranked semantic relevance).
- Pure-semantic similarity floor = 0.45; if <3 clear it, fall back to top-3 (never dead-end).
- Strict filters only on `techMatch:'all'` / `peMatch:'required'`.
- Known-good regression counts: n8n=5→(now with AWS backfill unchanged), AWS=6→**9**,
  n8n OR AWS=10, n8n AND AWS=1, n8n AND AWS AND PE=0.

## Agent core — BUILT & VALIDATED (all script-tested, real model)
Files under `lib/agent/`:
- `base-prompt.md` — role, pitch-first, never-dead-end, `[[case:ID]]` citation rule, tool hints.
  (NOTE: loaded via `readFileSync(__dirname...)` — this is bundler-unsafe under Next.js route
  handlers. Convert to a `.ts` const export before wiring the API route. OPEN.)
- `guardrails.ts` — HARD_GUARDRAILS (pricing, anti-fabrication, instruction hierarchy).
- `caseIndex.ts` — compact title/tech/PE map, NO ids (ids only ever come from tool results).
- `systemPrompt.ts` — 4-layer assembly + `loadActiveGuidelines()` (PromptVersion isLive).
- `tools/searchCases.ts` — model-facing tool def + `runSearchCases` projecting RankedCase →
  `{id,title,matchedTechs,peBacked,summary}` (no score telemetry). Returns
  `{modelResult, retrievedIds}`.
- `tools/index.ts` — registry + `dispatchTool` (unknown tool throws).
- `validator.ts` — `extractCitedIds`, `validateCitations(text, Set)`, `buildRegenerateFeedback`.
- `loop.ts` — `runAgentTurn({conversationId?, userMessage, agentUserId?})`. Buffer-and-gate:
  tool loop (max 5 iters) → validate → regenerate once → fallback. Persists user+assistant
  Messages with cited/retrieved ids, tokens, toolsUsed. `composeFinalText` helper shared
  across the initial + retry attempt (same retrievedIds Set by reference).

## Data-integrity work done this session
- **ID migration**: 18 legacy integer IDs (range 1–20) → cuids. They were low-entropy and
  guessable, which weakened the citation validator (a model could emit `[[case:12]]`).
  Migrated via single `$executeRaw UPDATE ... FROM (VALUES ...)` with `ON UPDATE CASCADE`
  rewriting 30 CaseTech + 72 CaseChunk child rows atomically. Verified: 0 integer ids,
  0 orphans, globals intact (45/180/195... CaseTech was 192 at migration time, now 195).
  (First attempt via 18 sequential updates in an interactive `$transaction` hit P2028
  timeout on remote DB → clean rollback → rewrote as one statement. Lesson: batch remote
  writes into single statements, don't loop awaits inside a time-boxed transaction.)
- **AWS parent-tag backfill**: `TechAlias` remaps QUERY input, NOT stored tags, so it can't
  make an `AWS Bedrock`-tagged case match `techs:['AWS']`. Fixed at the TAG level: added a
  bare `AWS` CaseTech row to the 3 cases that used AWS services but lacked the parent tag
  (both AgentCore cases + Contract Intelligence). AWS-query matches 6 → 9.
- **Test transcript cleanup**: deleted the 2 smoke-test conversations (fake
  agent-loop@internal.local user) that still held integer ids in retrievedCaseIds.

## OPEN — for Ali (data, runnable in parallel, none block the build)
1. **peBacked null on 39/45 cases.** Only 1 case is PE:yes. So `+ PE-backed` queries and
   the agent's PE claims under-represent real PE experience. Run detect-pe → pe-review.csv →
   apply-pe.
2. **9 cases have zero tech tags** — invisible to any tech query, semantic-only. Needs tagging.
3. **Azure & GCP families have the same parent-tag gap AWS had.** `Azure Kubernetes Service`/
   `Azure Container Registry` don't roll up to `Azure`; `Vertex AI`/`BigQuery`/`Google Pub/Sub`/
   `Google Cloud *` don't roll up to a GCP parent. Repeat the AWS backfill pattern
   (`scripts/backfill-aws-tag.ts`) per family.

## OPEN — for the build (code)
- Convert `base-prompt.md` → `.ts` const export (bundler-safety for the API route).
- `resolveUserId` in `loop.ts` upserts a fake test AgentUser — replace with real gated
  user when the route/gating lands.

## NEXT
Chat UI + gating (this is the current task):
1. External gated chat surface (email registration/verify before chatting).
2. Streaming-status chat UI that calls the agent (buffer-and-gate: show "searching…"
   status during the tool loop, then the validated reply).
3. Per-user + global rate limits, hard monthly cost cap + kill-switch (UsageDay).
4. Then: admin portal (prompt versioning, transcripts, cost dashboard), doc-gen, voice.

## Scripts (in /scripts)
chunk-and-embed, verify-marty-query, extract-tech-candidates, backfill-casetech,
detect-pe, apply-pe, audit-corpus, remap-case-ids (id migration), backfill-aws-tag,
clear-test-conversations, print-system-prompt, test-tool-dispatch, test-validator,
test-agent-turn. npm aliases wired for each.

## UI system (from UI-SPECIFICATION.md)
Tailwind v4 CSS-first (`@theme inline` in globals.css, NO tailwind.config.js), Montserrat,
navy/electric-blue palette, `cn()` in lib/utils.ts. Existing Header/Footer. Admin uses a
SEPARATE light theme (slate). The chat UI must inherit the existing tokens/shells, not
restyle from scratch.
