-- Approved knowledge (assistant-owned). Additive and idempotent.

CREATE TABLE IF NOT EXISTS "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "attribution" "AttributionClass" NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'buyer',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "clientName" TEXT,
    "clientNameApproved" BOOLEAN NOT NULL DEFAULT false,
    "sources" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeDoc_slug_key" ON "KnowledgeDoc"("slug");
CREATE INDEX IF NOT EXISTS "KnowledgeDoc_status_audience_idx" ON "KnowledgeDoc"("status", "audience");
CREATE INDEX IF NOT EXISTS "KnowledgeDoc_type_idx" ON "KnowledgeDoc"("type");

CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "header" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunk_docId_ordinal_key" ON "KnowledgeChunk"("docId", "ordinal");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE IF NOT EXISTS "KnowledgeSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "KnowledgeDocFile" (
    "docId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeDocFile_pkey" PRIMARY KEY ("docId", "format")
);

DO $$ BEGIN
  ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeDocFile" ADD CONSTRAINT "KnowledgeDocFile_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
