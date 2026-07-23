-- CaseStudy editor attribution + KnowledgeEntry shareable fields.
-- Idempotent: local DBs may already have these from `prisma db push`.

-- ── CaseStudy.updatedBy ─────────────────────────────────────────────────────
ALTER TABLE "CaseStudy" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

CREATE INDEX IF NOT EXISTS "CaseStudy_updatedById_idx" ON "CaseStudy"("updatedById");

DO $$ BEGIN
  ALTER TABLE "CaseStudy"
    ADD CONSTRAINT "CaseStudy_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "AdviserAdmin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── KnowledgeEntry (admin corpus; may already exist from manual_knowledge_entry) ─
CREATE TABLE IF NOT EXISTS "KnowledgeEntry" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "fileUrl" TEXT,
  "fileName" TEXT,
  "fileMime" TEXT,
  "shareable" BOOLEAN NOT NULL DEFAULT false,
  "shareLabel" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeEntry_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "AdviserAdmin"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "shareable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "shareLabel" TEXT;

CREATE INDEX IF NOT EXISTS "KnowledgeEntry_createdById_idx" ON "KnowledgeEntry"("createdById");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_createdAt_idx" ON "KnowledgeEntry"("createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_shareable_idx" ON "KnowledgeEntry"("shareable");
