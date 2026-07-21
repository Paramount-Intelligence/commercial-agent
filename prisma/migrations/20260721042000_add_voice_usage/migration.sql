-- Voice usage metering (additive / backward-compatible).
ALTER TABLE "OrgUsageDay"
  ADD COLUMN IF NOT EXISTS "ttsChars" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sttSeconds" INTEGER NOT NULL DEFAULT 0;
