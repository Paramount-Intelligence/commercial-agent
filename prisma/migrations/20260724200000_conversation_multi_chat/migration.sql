-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill updatedAt from createdAt for existing rows
UPDATE "Conversation" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL OR "updatedAt" < "createdAt";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Conversation_userId_deletedAt_updatedAt_idx" ON "Conversation"("userId", "deletedAt", "updatedAt");
