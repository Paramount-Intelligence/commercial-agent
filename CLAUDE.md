# Working in this repo

## Release model
- `main` is production. Never push to `main`, never merge into it outside a release.
- `develop` is staging (a Vercel preview with its own database and Blob store).
- Work happens on phase branches cut from `develop` and merged back by pull request.
  `develop` merges into `main` only at a release.

## Databases
- Local work uses the local Postgres on `localhost:5432` only. `lib/dbGuard.ts` refuses
  anything else outside production, except the staging database when `DB_TARGET=staging`
  and its fingerprint match (`.env.staging`, `npm run db:fingerprint`).
- Never point a local command at the production database. Never print database URLs,
  keys or tokens.
- Test data: `npm run seed:local` (or `npm run seed:staging`). Both are idempotent.

## Migrations
- Additive and idempotent only (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- Never edit or delete an existing migration. Another app shares the production database
  and its migration table.

## Secrets and confidential content
- No secrets, credentials, client case text, knowledge drafts, golden questions or audit
  reports in the repo. `.env*` files (except `.env.example`) and `.seed/` are gitignored.
- Knowledge and eval inputs live outside the repo (`KNOWLEDGE_DIR`, `EVAL_DIR`); eval
  reports go to `EVAL_OUT`. See `.env.example`.

## Before every commit
- `npm run test:unit` (no database or API keys needed) and `npx tsc --noEmit`.
- CI runs the same checks on every pull request into `develop` or `main`.

## Evals (local, cost money: keep runs small)
- `npm run eval:retrieval`, `npm run eval:latency`, `npm run eval:confidentiality`
  (the last two need `npm run dev` and a seeded database).
