-- Pending sign-ins: the user's details wait here until the emailed code is
-- verified. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "SignInChallenge" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affiliation" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignInChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SignInChallenge_email_organizationId_idx" ON "SignInChallenge"("email", "organizationId");
CREATE INDEX IF NOT EXISTS "SignInChallenge_organizationId_createdAt_idx" ON "SignInChallenge"("organizationId", "createdAt");
