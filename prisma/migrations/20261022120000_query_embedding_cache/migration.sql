-- Phase 4: shared, privacy-preserving query-embedding cache.
-- The key is a SHA-256 digest of the normalised query; raw buyer text is never stored.
CREATE TABLE IF NOT EXISTS "QueryEmbeddingCache" (
  "key" TEXT PRIMARY KEY,
  "embedding" vector(1536) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "QueryEmbeddingCache_expiresAt_idx"
  ON "QueryEmbeddingCache"("expiresAt");
