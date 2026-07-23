-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "transcriptPdfUrl" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "transcriptPdfThroughAt" TIMESTAMP(3);
