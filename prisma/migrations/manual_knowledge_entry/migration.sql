-- Additive: KnowledgeEntry for admin-authored company corpus.
-- Applied via `npx prisma db push` (2026-07-23). Re-run `npx prisma generate`
-- after stopping the Next.js process if EPERM locks the query engine DLL.

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
