# Paramount Intelligence Commercial Adviser

A gated AI sales and technical adviser that turns Paramount Intelligence case
studies and company knowledge into a 24/7 conversational experience for
prospects, buyer-side CTOs, Catalant representatives, and BD partners.

The application includes:

- Gated text chat and hands-free voice conversation.
- Hybrid case retrieval using SQL filters and pgvector semantic search.
- Claude tool use with deterministic citation and pricing validation.
- ElevenLabs speech-to-text and text-to-speech.
- Generated and uploaded case-study one-pagers.
- An admin portal for organizations, prompts, transcripts, assets, and usage.
- Per-organization message, Claude-token, TTS-character, and STT-second limits.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Prisma Postgres with pgvector
- Anthropic Claude for the adviser
- OpenAI embeddings for retrieval
- ElevenLabs Scribe and TTS for voice
- Nodemailer over SMTP for verification email
- Vercel Blob for durable generated assets
- Puppeteer Core and `@sparticuz/chromium` for PDF/PNG generation

## Requirements

- Node.js 20 or newer
- npm
- A PostgreSQL database compatible with the Prisma schema and pgvector
- API credentials listed below

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in real values:

   ```bash
   cp .env.example .env.local
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. Generate Prisma Client and apply existing migrations:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Environment variables

The canonical sanitized template is `.env.example`. No environment variable is
intentionally exposed to the browser; the application currently uses no
`NEXT_PUBLIC_*` variables.

### Required: database

- `DATABASE_URL` — pooled/runtime Prisma PostgreSQL connection.
- `DIRECT_URL` — direct PostgreSQL connection for migrations and administrative work.

### Required: AI and retrieval

- `ANTHROPIC_API_KEY` — Claude agent requests.
- `OPENAI_API_KEY` — case and website embeddings.

### Optional: AI overrides

- `ANTHROPIC_VOICE_MODEL` — voice-turn model; defaults to `claude-haiku-4-5`.
- `EMBEDDING_PROVIDER` — defaults to `openai`.
- `EMBEDDING_MODEL` — defaults to `text-embedding-3-small`.

### Required when voice mode is enabled

- `ELEVENLABS_API_KEY` — ElevenLabs speech-to-text and text-to-speech.

### Required: authentication and encrypted credentials

- `AUTH_COOKIE_SECRET` — HMAC secret for organization-auth cookies; use at least 32 random characters.
- `ORG_SECRET_KEY` — base64-encoded 32-byte key for organization credential encryption. Generate with:

  ```bash
  npx tsx scripts/generate-org-key.ts
  ```

### Required on Vercel: generated assets

- `BLOB_READ_WRITE_TOKEN` — Vercel Blob token for durable generated one-pagers.

Without this token, local development falls back to `public/uploads`. That
fallback is not suitable for durable serverless production storage.

### Required: transactional email

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Example Resend SMTP configuration:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_resend_api_key
SMTP_FROM="Paramount Intelligence Adviser <adviser@paramountintelligence.co>"
```

Port `465` uses implicit TLS; port `587` uses STARTTLS. `SMTP_FROM` must use an
address on a domain verified with the provider. Configure the provider's SPF and
DKIM DNS records before production delivery.

Verify SMTP connectivity and delivery with:

```bash
npm run smtp:test -- recipient@example.com
```

### Optional: local Chromium overrides

- `PUPPETEER_EXECUTABLE_PATH`
- `CHROME_PATH`

Do not set these on Vercel; serverless document generation uses
`@sparticuz/chromium`.

## Development and tests

```bash
npm run dev
npm run validator:test
npm run pricing:test
npm run smtp:test -- recipient@example.com
```

Additional maintenance and audit commands are listed in `package.json`.

## Production build

```bash
npm run build
```

The build uses Next.js with Webpack because Turbopack's Prisma symlink handling
requires Windows developer-mode privileges. The Webpack build is also used by
Vercel.

## Deploying to Vercel

1. Import the repository into Vercel.
2. Provision or connect PostgreSQL and set `DATABASE_URL` and `DIRECT_URL`.
3. Create a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`.
4. Add every required environment variable above for Production and Preview as appropriate.
5. Verify the SMTP sending domain and publish its SPF/DKIM records.
6. Apply Prisma migrations to the production database:

   ```bash
   npx prisma migrate deploy
   ```

7. Deploy. Vercel runs `npm run build`.

`vercel.json` grants document-generation routes 1024 MB/60 seconds and voice
routes 512 MB/60 seconds. API routes that use Prisma, Chromium, or Node libraries
explicitly run in the Node.js runtime.

## Architecture and operational notes

- The prompt is assembled as base behavior, editable guidelines, case index,
  and hard guardrails appended last.
- Case claims are buffer-and-gated: citations must reference cases retrieved in
  the conversation before a response can ship or be spoken.
- Pricing may only come from `lib/agent/pricing.ts`; unsupported figures,
  discount-matrix disclosures, and under-framed pricing are rejected.
- Voice follows STT → validated agent turn → TTS. Unvalidated model text is
  never synthesized.
- Usage and cost controls are enforced per organization and reset by UTC day.

## Documentation

- `docs/HANDOVER.md` — latest implementation handover.
- `docs/handover/` — historical phase handovers.
- `docs/UI-SPECIFICATION.md` — visual system reference.
- `docs/structure.md` — original architecture sketch.
