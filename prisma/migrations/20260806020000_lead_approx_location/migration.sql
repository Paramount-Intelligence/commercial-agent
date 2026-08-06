-- Approximate lead location (Vercel IP geo), additive nullable.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "geoCity" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "geoRegion" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "geoCountry" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "approxLocation" TEXT;
