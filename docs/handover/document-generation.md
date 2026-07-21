# Paramount Intelligence — Commercial AI Agent · Build Handover

_Last updated: 2026-07-20 (both portals substantially complete). Supersedes all prior handovers._

## What this is
A GATED chat-based AI sales + technical adviser for Paramount Intelligence. Turns 45 case
studies + the company website into a 24/7 adviser for Catalant reps, prospects, buyer-side
CTOs, BD partners. Two portals over one agent core, both now built. Single Next.js app
(TypeScript), Prisma Postgres + pgvector, Claude Sonnet, OpenAI embeddings. Dev on Windows,
runs on webpack (NOT Turbopack). Requirements: "Commercial Agent Guide" (Ahmed; commercial
sign-off Marty; technical sign-off Ali).

## STATUS — DONE and working end-to-end

### Agent core + retrieval
- Hybrid ranked searchCases() (SQL tech/PE filters + pgvector semantic, best-chunk, 0.45 floor).
- 180 CaseChunk + 71 ContentChunk embeddings (OpenAI text-embedding-3-small, 1536-dim).
- 4-layer system prompt: base + editable guidelines + case index + hard guardrails (last).
- Anti-fabrication validator (code-enforced [[case:ID]] vs retrieved set), buffer-and-gate,
  regenerate-once-then-fallback, retry+graceful-degrade on 429/529.
- Two tools: search_cases (cited) + search_company_info (uncited, empty retrievedIds).

### Portal A — external gated chat (COMPLETE)
- Org-issued credentials (email+password), two-password design (bcrypt hash for login +
  AES-256-GCM enc for admin retrieval via ORG_SECRET_KEY).
- One-surface entry flow: org email -> org password (server checkpoint) -> name -> email ->
  affiliation -> OTP -> chat. One question at a time, per-step validation.
- Email verification via SMTP (nodemailer). OTP: 6-digit bcrypt-hashed, 10-min, 60s cooldown,
  5-attempt cap, replay-protected. Verify-once-per-user-per-org.
- Real 24h Session, httpOnly cookie, minted server-side at verification.
- Airtight gate: /chat redirects without session; /api/chat 401 without session. Test user retired.
- Kill switch (org.active), session resume (history by email-within-org), IDOR guard on conversations.
- 1000/day per-org message cap (OrgUsageDay, atomic, UTC reset, graceful message).
- Chat UI: dark navy theme, markdown, animated thinking indicator, referenced-cases panel with
  live "View case" URLs, em-dash renderer normalization.

### Portal B — admin backstage (COMPLETE)
- Adviser-admin auth (AdviserAdmin + AdviserAdminSession, SEPARATE from website Admin and from
  user sessions — three independent auth systems). 8h sessions. Script-created admins.
- Prompt editor: edit/preview/publish/rollback the guidelines layer. PROVEN controlling the
  live agent (canary test). Guidelines CANNOT override hard guardrails (appended last).
  Versioned, history retained, one-live-per-layer enforced in publish transaction.
- Transcript viewer: read-only conversation list + detail, cited-case titles resolved, tokens,
  tools, ratings. Filter by org, search, pagination.
- Usage & cost dashboard: message volume (from Message rows), token spend, estimated USD
  (rates in lib/gating/costRates.ts), today-vs-cap per org, daily trend, per-org totals.
- Org management: create / reveal-credentials / reset-password / activate-deactivate / set-limit.
  Shared credential logic (lib/orgs/credentials.ts) with the CLI. Sensitive actions logged.


### Doc generation (COMPLETE) — guide Section 8
- Admin asset upload per case (PDF/PNG only), stored on Vercel Blob (lib/storage/blob, local
  /uploads fallback in dev). CaseAsset extended: originalFilename, mimeType, uploadedById,
  uploadedAt, generated(bool), sourceUpdatedAt.
- Branded one-pager GENERATOR: HTML/CSS template (lib/docgen/onepagerTemplate.ts) rendered to
  PDF/PNG via serverless Chromium (puppeteer-core + @sparticuz/chromium, lib/docgen/render.ts).
  Navy rail + light content, brand palette, real logo, Montserrat. Elastic layout (fills concise
  cases, caps verbose ones) — proven across 3 case shapes. Defensive content mapper
  (mapCaseToOnepager.ts) handles flat vs grouped tech Json, prose-with-embedded-bullets, trims at
  sentence boundaries. REAL CITED FACTS ONLY — no fabrication, no pricing.
- Chat trigger: generate_case_onepager tool. Anti-fabrication guard (caseId must be in
  conversation retrievedIds). Confirm-when-ambiguous behavior (agent names its guess, waits for
  confirmation before generating). Download card in chat UI.
- Three-tier serving: uploaded real asset -> cached generated (fresh per case.updatedAt) ->
  generate-fresh. Caching by case+format, invalidated on case edit, old Blob deleted. Admin
  upload clears generated caches.
- Scripts: cleanup-generated-onepagers.

## KEY SECRETS (save durably)
- ORG_SECRET_KEY (AES for org passwordEnc). LOSE IT -> org passwords unretrievable (login OK).
- AUTH_COOKIE_SECRET (HMAC org-auth cookie). Separate by design.
- SMTP_* (Gmail App Password — TEST ONLY, swap before launch).
- Dev: webpack (next dev --webpack), NOT Turbopack (Windows symlink panic).

## OPEN — for Marty (batched; discuss together)
1. 7 real client names — which cleared for public disclosure. Public already: Schneider
   Electric, Toptal. Unconfirmed: Syngenta, Flexagon, Jazz, JazzCash, Bykea. (Client-name card
   display held pending this.)
2. Aramco/trusted-brand behavior — public brand on site, no case study. Recognize as known
   relationship or treat as unknown?
3. Humor/tone — guidelines currently permit "soft humor." Is that the register Marty wants?
4. PRICING CONTRADICTION — the live guidelines say "you can share pricing with clients" but the
   HARD GUARDRAIL forbids revealing project pricing. Guardrail WINS (appended last), so the
   agent will NOT share pricing regardless of the guideline. Marty should know his guideline
   isn't taking effect, and decide what he actually wants. Changing the guardrail is a
   deliberate dev decision, not a guideline edit.

## OPEN — for Ali (data quality; Ali handling)
1. peBacked null on 39/45 — agent under-represents PE experience.
2. 9 cases zero tech tags — invisible to tech queries.
3. Azure & GCP parent-tag gap (like AWS was).
4. Placeholder data (Ali correcting): "XX parent organization" (Multi-Agent AI Analytics),
   clientName junk "MSA Project Team" + "Fast Scaling Operations Driven Organization".

## OPEN — for the build (before launch)
- Production email: Gmail App Password -> Resend/SES (env-only; mailer transport-agnostic).
  Codes in spam = users can't log in. THE key pre-launch item.
- v3 guidelines typo cleanup ("Parah", "converstiaon", etc. — model reads verbatim). Substance
  is Marty's; typos are safe to fix. Exercises rollback.
- Client-name card display once Marty rules (allowlist: Schneider/Toptal cleared).

## COST NOTE
~13k input tokens/turn (4-layer prompt + full 45-case index sent every call). ~$0.30-0.40 per
conversation at Sonnet rates. Fine at demo scale. When optimizing: the case index (~2.5k tok
every call) is the obvious trim. Don't touch pre-launch.

## NEXT (post-both-portals)
1. Pre-launch: production email swap + send Marty the batched decisions + Ali's data fixes land.
2. Doc generation (Phase 3): branded docx/pptx/pdf of selected cases.
3. Voice (Phase 3): ElevenLabs TTS; buffer-and-gate still applies. UI mockup explored.
4. Real-time web search tool (Phase 4).
5. Lead capture (Lead model exists, unused) — push captured leads to CRM/notify Marty.

## DB MODELS
CaseStudy(45), CaseTech(195), TechAlias, CaseAsset, CaseChunk(180), ContentChunk(71),
Organization, AgentUser, EmailVerification, Session, OrgUsageDay, PartnerLink(unused),
Conversation, Message, Lead(unused), PromptVersion(guidelines: v2 live style + versions),
UsageDay, Admin(marketing-site, separate), AdviserAdmin, AdviserAdminSession.

## SCRIPTS
Data: chunk-and-embed, ingest-website, verify-marty-query, backfill-casetech, detect-pe,
apply-pe, remap-case-ids, backfill-aws-tag, audit-client-names, audit-placeholders.
Agent: print-system-prompt (prompt:print), test-tool-dispatch, test-validator, test-agent-turn.
Gating: generate-org-key, create-org, show-org-credentials, set-org-usage, test-smtp, test-otp.
Admin: create-adviser-admin, reset-adviser-admin-password, seed-guidelines.
