-- Lead handoff: topic + conversation PDF URL for founder notifications.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "topic" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "pdfUrl" TEXT;
