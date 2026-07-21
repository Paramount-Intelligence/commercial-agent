paramount-app/
├── app/
│   ├── agent/                         # Portal A: external client-facing chat (gated)
│   │   ├── layout.tsx                 # gate: verified email / invite / partner link
│   │   ├── page.tsx                   # chat UI (stream, voice toggle later, downloads later)
│   │   └── [partnerSlug]/page.tsx     # Catalant-style entry → per-channel attribution
│   ├── admin/                         # Portal B: internal admin (role=admin only)
│   │   ├── prompts/page.tsx           # edit guidelines, versions, preview, publish, rollback
│   │   ├── transcripts/page.tsx
│   │   ├── knowledge-base/page.tsx    # cases, assets (verified flag), re-embed trigger
│   │   ├── costs/page.tsx             # tokens / EL chars / search / docs, thresholds, kill-switch
│   │   ├── leads/page.tsx
│   │   └── users/page.tsx
│   └── api/
│       ├── chat/route.ts              # main agent endpoint: SSE stream + tool loop
│       ├── auth/{register,verify}/route.ts
│       ├── leads/route.ts
│       └── admin/
│           ├── prompts/route.ts
│           ├── prompts/publish/route.ts   # runs adversarial eval BEFORE flipping live
│           ├── kb/reembed/route.ts
│           └── costs/route.ts
├── lib/
│   ├── db.ts                          # Prisma singleton
│   ├── env.ts                         # zod-validated env vars
│   ├── agent/
│   │   ├── loop.ts                    # tool-use loop + streaming orchestration
│   │   ├── systemPrompt.ts            # 4-layer assembly
│   │   ├── base-prompt.md             # base instructions (git)
│   │   ├── guardrails.ts              # HARD guardrails, appended LAST, not editable (git)
│   │   ├── validator.ts              # anti-fabrication: cited cases/clients string-matched vs DB
│   │   └── tools/
│   │       ├── index.ts               # tool registry: schemas + dispatch
│   │       ├── searchCases.ts         # thin wrapper → retrieval/searchCases
│   │       ├── fetchAsset.ts          # one-pagers/videos, verified only
│   │       ├── webSearch.ts
│   │       ├── captureLead.ts
│   │       └── rateCard.ts            # deflection; never per-project $
│   ├── retrieval/
│   │   ├── searchCases.ts             # THE hybrid helper (SQL filters + pgvector, ranked)
│   │   ├── embed.ts                   # embed() wrapper, 1536-dim
│   │   └── caseIndex.ts               # compact case index injected into the prompt
│   └── gating/
│       ├── rateLimit.ts               # per-user + global (msgs/day, tokens/day)
│       └── cost.ts                    # UsageDay metering, alert thresholds, monthly cap/kill-switch
├── scripts/                           # existing + one new
│   ├── chunk-and-embed.ts             # NEW
│   ├── extract-tech-candidates.ts
│   ├── backfill-casetech.ts
│   ├── verify-marty-query.ts
│   ├── detect-pe.ts · apply-pe.ts · audit-corpus.ts
├── evals/
│   ├── adversarial/{cases.jsonl,run.ts}   # ~60 prompts; gates every prompt-version publish
│   └── retrieval/boolean-shapes.ts        # n8n/AWS/AND/OR/PE ranked expectations
└── prisma/{schema.prisma,migrations/,seed.ts}