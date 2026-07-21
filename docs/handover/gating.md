# Paramount Intelligence — Commercial AI Agent · Build Handover

_Last updated: 2026-07-17 (gating complete). Supersedes all prior handovers._

## What this is
A GATED, chat-based AI sales + technical adviser for Paramount Intelligence. Turns 45 case
studies + the company website into a 24/7 adviser for Catalant reps, prospects, buyer-side
CTOs, and BD partners. Two portals over one agent core: external (client-facing chat, now
gated) + internal admin (not yet built). Everything in the existing Next.js app, TypeScript,
one repo. Requirements: "Commercial Agent Guide" (Ahmed; commercial sign-off Marty; technical
sign-off Ali).

## STATUS — what's DONE and working end-to-end
- **Retrieval**: hybrid ranked searchCases() (SQL tech/PE filters + pgvector semantic,
  best-chunk, 0.45 semantic floor, PE-as-tiebreak). Validated.
- **Embeddings**: 45 cases -> 180 CaseChunk (4 sections each). Website -> 71 ContentChunk.
  All 1536-dim (OpenAI text-embedding-3-small), via $queryRaw.
- **Agent core**: 4-layer system prompt (base + editable guidelines + case index + hard
  guardrails, appended last). Tool loop (search_cases, search_company_info). Anti-fabrication
  validator (code-enforced [[case:ID]] check vs retrieved set). Buffer-and-gate (validate
  before user sees reply). Regenerate-once-then-fallback. Retry+graceful-degrade on 429/529.
- **Company knowledge**: website ingested (about/services/industries/candidates/home) into
  ContentChunk, exposed via search_company_info (separate tool, NOT case-cited, empty
  retrievedIds so it can't legitimize a fake case citation). Answers "who is Ali", services, etc.
- **Chat UI**: gated /chat, dark navy/electric-blue theme, markdown rendering, animated
  thinking indicator, referenced-cases side panel (name + blurb + "View case ->" live URL),
  case-study URLs (45/45 via slug), em-dash renderer normalization.
- **GATING (complete)** — the load-bearing requirement:
  - Org-issued credentials (email + password), script-created. Two-password design:
    passwordHash (bcrypt, login) + passwordEnc (AES-256-GCM, admin-retrievable via ORG_SECRET_KEY).
  - One-surface entry flow at /login: org email -> org password (server checkpoint) -> name ->
    email -> affiliation -> OTP code -> chat. One question at a time, arrow-advance, per-step validation.
  - Email verification via SMTP (nodemailer). OTP: 6-digit, bcrypt-hashed, 10-min expiry,
    60s resend cooldown, 5-attempt cap, replay-protected. Verify-once-per-user-per-org.
  - Real 24h Session (opaque token, httpOnly cookie), minted server-side at verification success.
  - Airtight gate: /chat page redirects to /login without session; /api/chat returns 401
    without session. Test user (agent-loop@internal.local) retired from the loop.
  - Kill switch: org.active=false invalidates all its sessions on next request. Also blocks
    blocked users.
  - Session resume: history loads by user (email-within-org) on chat entry; /login redirects
    to /chat if already authenticated. Cross-user conversation access blocked (IDOR guard).
  - 1000/day per-org message cap (OrgUsageDay counter, atomic check+increment, UTC reset).
    Graceful "let's pick this up tomorrow" message, no model call when capped.

## KEY SECRETS (save durably — losing them has consequences)
- ORG_SECRET_KEY (AES key for org passwordEnc). LOSE IT -> org passwords unrecoverable
  (login still works via hash, but org:show breaks). NOT in git.
- AUTH_COOKIE_SECRET (HMAC for org-auth cookie). Separate from ORG_SECRET_KEY by design.
- SMTP_* (currently Gmail App Password — TEST ONLY, see below).
- Dev runs on webpack (next dev --webpack), NOT Turbopack (Turbopack panics on Windows
  symlink privilege for the openai package).

## OPEN — for Marty (client decisions, send now)
1. 7 real client names: which are cleared for the agent to state publicly? Schneider
   Electric + Toptal already public. Unconfirmed: Syngenta, Flexagon, Jazz, JazzCash, Bykea.
   (Client-name display on cards is HELD pending this ruling.)
2. Aramco/trusted-brand behavior: Aramco is a public trusted-brand on the site but has no
   case study. Should the agent recognize it as a known brand relationship vs treat as unknown?

## OPEN — for Ali (data quality, parallel, non-blocking)
1. peBacked null on 39/45 — only 1 case is PE:yes; agent under-represents PE experience.
2. 9 cases have zero tech tags — semantic-only, invisible to tech queries.
3. Azure & GCP parent-tag gap — like AWS was. Repeat scripts/backfill-aws-tag.ts pattern.
4. Placeholder/junk data in case fields (NEWLY VISIBLE in card blurbs to users):
   - "XX parent organization" in Multi-Agent AI Analytics Platform overview.
   - "MSA Project Team", "Fast Scaling Operations Driven Organization" as clientName values.
   - Grep corpus for "XX"/"TODO"/"TBD"/bracketed placeholders in overview/summary/client fields.

## OPEN — for the build (code, before launch)
- Production email: replace Gmail App Password SMTP with Resend/SES (env-only change).
  Gmail = spam risk + send limits; codes in spam = users locked out.
- Client-name display on cards: build allowlist display once Marty rules.
- Migrate style decisions (case-name bolding, "Closest fit" emphasis, dash formatting) from
  git base prompt to the editable-guidelines layer so Marty can tune without a dev.

## NEXT (build priorities, post-gating)
1. Admin portal (Portal B): prompt-version editing + rollback, transcript viewer, cost
   dashboard, org management UI (create/reset/deactivate), client-name allowlist, user mgmt.
2. Doc generation (Phase 3): branded docx/pptx/pdf of selected cases.
3. Voice (Phase 3): ElevenLabs TTS; buffer-and-gate still applies (don't speak unvalidated citation).
4. Real-time web search tool (Phase 4): external context, never overriding guardrails/corpus.

## DB MODELS (current)
CaseStudy(45, all cuid ids), CaseTech(195), TechAlias, CaseAsset, CaseChunk(180),
ContentChunk(71), Organization, AgentUser(+name/affiliation/emailVerified/organizationId),
EmailVerification(+attempts), Session, OrgUsageDay, PartnerLink(unused), Conversation, Message,
Lead(unused), PromptVersion(unused), UsageDay, Admin(marketing-site, separate).

## SCRIPTS
Retrieval/data: chunk-and-embed, ingest-website, verify-marty-query, extract-tech-candidates,
backfill-casetech, detect-pe, apply-pe, audit-corpus, remap-case-ids, backfill-aws-tag,
audit-client-names, clear-test-conversations.
Agent/prompt: print-system-prompt, test-tool-dispatch, test-validator, test-agent-turn.
Gating: generate-org-key, create-org, show-org-credentials, test-smtp, test-otp, set-org-usage.
