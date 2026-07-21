-- Prompt-version editor: versioning/rollback fields on PromptVersion.
-- Additive. Table is empty, so NOT NULL "version" needs no default/backfill.

-- AlterTable
ALTER TABLE "PromptVersion" ADD COLUMN "version" INTEGER NOT NULL;
ALTER TABLE "PromptVersion" ADD COLUMN "label" TEXT;
ALTER TABLE "PromptVersion" ADD COLUMN "createdById" TEXT;

-- CreateIndex: one version number per layer
CREATE UNIQUE INDEX "PromptVersion_layer_version_key" ON "PromptVersion"("layer", "version");

-- CreateIndex: the loadActiveGuidelines lookup
CREATE INDEX "PromptVersion_layer_isLive_idx" ON "PromptVersion"("layer", "isLive");

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "AdviserAdmin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
