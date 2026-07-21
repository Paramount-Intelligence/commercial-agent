# Paramount Intelligence — Commercial AI Agent · Build Handover

## What I'm building
A gated, chat-based AI sales + technical adviser for Paramount Intelligence (a
consulting firm). It turns ~45 case studies into a 24/7 adviser for Catalant reps,
prospects, buyer-side CTOs, and BD partners. Two portals over one agent core:
external (client-facing) + internal admin (for Marty to self-tune).

Requirements come from the "Commercial Agent Guide" (author: Ahmed; commercial
sign-off: Marty; technical sign-off: Ali). I have that guide — I'll paste relevant
sections if needed.

## The non-negotiable behaviors (from the guide)
- **Pitch first, proof on request.** First reply reads like a tailored pitch, then
  progressively reveals one-pager → full case → demo video.
- **Never dead-end.** No matching case? Bridge to adjacent real experience, capture
  the lead. But: **sell strongly, NEVER fabricate** — no invented case/client/metric, ever.
- **Never reveal a project's price.** Deflect to resource types + a separate rate card.
  Must survive adversarial prompting.
- **Gated from day one.** A prior agent was killed by unrestricted traffic burning API
  spend. Email verification, per-user + global rate limits, hard monthly cost cap + kill-switch.

## Architecture decisions already made
- **Everything in the existing Next.js app** (App Router, route handlers). TypeScript
  throughout. No separate Python backend until Phase 3 (doc-gen only). Team is
  AI-assisted / simple-stack devs — keep it one repo, one language.
- **DB: Prisma Postgres (db.prisma.io) + pgvector.** Already migrated and working.
- **Retrieval is hybrid:** SQL filters for exact/structured queries (tech, PE-backed)
  + pgvector semantic search for fuzzy "we have "problem X"" queries. Both feed one
  `searchCases()` helper.
- **System prompt = 4 layers:** base (git) + editable guidelines (admin portal) +
  auto-generated case index + HARD GUARDRAILS (git, appended last, NOT editable —
  pricing + anti-fabrication live here so a prompt edit can't remove them).
- **Anti-fabrication is CODE, not prompt:** a deterministic validator string-matches
  every case/client name the model asserts against the DB before the reply ships.
  Plus a ~60-prompt adversarial eval suite that gates every prompt-version publish.

## Current DATABASE state (done this session)
Schema is live and migrated. Existing `CaseStudy` model was extended additively
(website untouched). Key tables:
- `CaseStudy` — 45 cases, all ingested. Existing website fields preserved
  (slug, image, tech JSON, solutionAgents, industry, businessFunction, etc.)
  New agent fields: peBacked, clientType, fundContext, contributors[], agentEnabled.
- `CaseTech` — normalized tech tags (192 rows, 116 distinct techs). THIS is what makes
  boolean tech queries work. Derived from `CaseStudy.tech` JSON via an alias map.
- `TechAlias` — alias → canonical (e.g. "Amazon Web Services" → "AWS").
- `CaseAsset` — one-pagers/videos, with a `verified` flag (agent won't surface unverified).
- `CaseChunk` — embedding vector(1536), currently EMPTY. Semantic search not wired yet.
- Agent tables exist but unused: AgentUser, PartnerLink, Conversation, Message
  (has citedCaseIds[] for the validator), Lead, PromptVersion (has evalPassed gate),
  UsageDay, Admin.

Prisma note: `embedding` is `Unsupported("vector(1536)")` — Prisma can't query it
natively, so all similarity search goes through `prisma.$queryRaw`. Wrap it in ONE
`searchCases()` helper, raw SQL inside, typed interface outside.

## Retrieval spec — PROVEN against real data
`searchCases()` must support every boolean shape (Marty's corrected requirement):
n8n alone / AWS alone / n8n OR AWS / n8n AND AWS / all-three-AND / etc.
- `techMatch: 'any' | 'all'` — LLM sets per query from user phrasing
- `peMatch: 'required' | 'preferred'` — filter vs. ranking boost
- **Default to RANKED, not strict filter:** score +1 per tech matched, +0.5 if
  peBacked. Partial matches still surface, ranked lower. This is the "adviser not a
  boolean box" behavior. Strict AND/OR only when the user is explicit.

Current real result counts: n8n=5, AWS=6, "n8n OR AWS"=10, "n8n AND AWS"=1,
"n8n AND AWS AND PE-backed"=0.

## Known DATA gaps (NOT code problems — flagged to Ali, may still be open)
1. **39/45 cases have peBacked = null.** So "+ PE-backed" queries return a FALSE zero.
   A `detect-pe.ts` script proposed values; Ali confirms via `pe-review.csv` →
   `apply-pe.ts` writes them.
2. **Tech is under-recorded in some write-ups.** Only 1 case names both n8n + AWS,
   likely because write-ups are terse, not because the work wasn't done. Ali reviewing.
3. Some cases are thinly tagged (1 tech) or the corpus regressed slightly on a
   re-upload (a couple lost SQL/Airflow tags).

## Enrichment loop (repeatable, already built)
Data will keep growing. The loop, safe to run forever:
1. add/enrich cases → 2. `extract-tech-candidates.ts` (MERGE version — preserves
prior canonical decisions, only new candidates blank) → 3. fill new blanks in
`tech-candidates.csv` → 4. `backfill-casetech.ts --apply` → 5. `verify-marty-query.ts`.

## Scripts that exist (in /scripts)
extract-tech-candidates.ts (merge-preserving), backfill-casetech.ts (idempotent sync),
verify-marty-query.ts (exercises all boolean shapes + ranked), detect-pe.ts, apply-pe.ts,
audit-corpus.ts.

## WHERE I AM / what's next
Structured retrieval layer is DONE and validated. Immediate next steps, in order:
1. **Chunk + embed the 45 cases into CaseChunk** (currently empty) — lights up
   semantic search. Chunk by section (overview/challenge/solution/results), embed,
   write via $queryRaw.
2. **Build the production `searchCases()` helper** — the ranked hybrid (SQL filters +
   vector) from the proven spec above.
3. Then: agent core (4-layer prompt + tool loop + streaming), then chat UI, then
   guardrails + gating.

Build order target (Phase 1, ~2 weeks, 2 devs): schema✓ → tags✓ → embeddings →
searchCases → agent core → chat UI → guardrails → gating → lead capture → ship to Marty.

---
START HERE: help me [PICK ONE: chunk-and-embed the 45 cases into CaseChunk /
build the searchCases() helper / the agent core tool loop].