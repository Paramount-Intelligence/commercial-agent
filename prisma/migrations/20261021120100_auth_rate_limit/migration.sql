-- Fixed-window counters for sign-in limits, shared across serverless
-- instances. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key", "windowStart")
);

CREATE INDEX IF NOT EXISTS "AuthRateLimit_windowStart_idx" ON "AuthRateLimit"("windowStart");
