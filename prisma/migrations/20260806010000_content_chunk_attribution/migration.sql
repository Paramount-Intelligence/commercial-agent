-- AlterTable
CREATE TYPE "AttributionClass" AS ENUM (
  'paramount-positioning',
  'paramount-delivery-outcome',
  'ali-personal-contract',
  'ali-prior-employment'
);

-- AlterTable
ALTER TABLE "ContentChunk" ADD COLUMN "attributionClass" "AttributionClass",
ADD COLUMN "employer" TEXT,
ADD COLUMN "startDate" TEXT,
ADD COLUMN "endDate" TEXT;

-- CreateIndex
CREATE INDEX "ContentChunk_attributionClass_idx" ON "ContentChunk"("attributionClass");

-- CreateIndex
CREATE INDEX "ContentChunk_employer_idx" ON "ContentChunk"("employer");
