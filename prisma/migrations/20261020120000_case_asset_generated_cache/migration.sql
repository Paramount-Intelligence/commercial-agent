-- CaseAsset generated-document cache columns. These were in schema.prisma
-- without a migration, so a fresh database failed on one-pager generation.
-- Additive and idempotent: safe on databases that already have them.

ALTER TABLE "CaseAsset" ADD COLUMN IF NOT EXISTS "generated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CaseAsset" ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CaseAsset_caseId_kind_generated_idx" ON "CaseAsset"("caseId", "kind", "generated");
