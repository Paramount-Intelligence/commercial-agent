-- CaseAsset upload metadata (admin asset management via Vercel Blob / local fallback).
-- Additive only.

ALTER TABLE "CaseAsset" ADD COLUMN "originalFilename" TEXT;
ALTER TABLE "CaseAsset" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "CaseAsset" ADD COLUMN "uploadedById" TEXT;
ALTER TABLE "CaseAsset" ADD COLUMN "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CaseAsset" ADD CONSTRAINT "CaseAsset_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "AdviserAdmin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
