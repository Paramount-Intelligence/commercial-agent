-- Additive: KnowledgeEntry for admin-authored company corpus.
-- Prefer the timestamped migration
--   20260723080000_case_updated_by_and_knowledge_shareable
-- which creates KnowledgeEntry (IF NOT EXISTS) and adds shareable/shareLabel.
-- This folder is kept so environments that already recorded
-- `manual_knowledge_entry` in _prisma_migrations stay consistent.

CREATE TABLE IF NOT EXISTS "KnowledgeEntry" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "fileUrl" TEXT,
  "fileName" TEXT,
  "fileMime" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeEntry_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "AdviserAdmin"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "KnowledgeEntry_createdById_idx" ON "KnowledgeEntry"("createdById");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_createdAt_idx" ON "KnowledgeEntry"("createdAt");
