-- CreateTable: ContentChunk — website-content corpus, separate from CaseStudy/CaseChunk
CREATE TABLE "ContentChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentChunk_sourceType_idx" ON "ContentChunk"("sourceType");

-- CreateIndex
CREATE INDEX "ContentChunk_sourceUrl_idx" ON "ContentChunk"("sourceUrl");
